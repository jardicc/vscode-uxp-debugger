/**
 * Control-panel brain (CONTROL-PANEL.md §4): single source of truth for the
 * webview. Builds `PanelState` snapshots from the registry + live services
 * and executes `PanelAction` messages by delegating to the exact same flows
 * the Command Palette commands use (§6.1 — behavior must never diverge).
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { NativeAddonUnavailableError, RequestTimeoutError } from "../../core/errors";
import { parseManifestContent } from "../../core/manifest/manifest";
import { parseArgsText } from "../../core/protocol/messages";
import type { PluginSession } from "../../core/broker/SessionRegistry";
import { HOST_APPS } from "../../core/vulcan/hostAppCatalog";
import type { UxpService } from "../UxpService";
import { attachDebuggerCommand } from "../commands/attachDebugger";
import { debugScriptCommand } from "../commands/debugScript";
import { CONNECT_TIMEOUT_MS, launchHostAppByValue } from "../commands/hostAppLaunch";
import { loadWithDialogs, reportLoadResult } from "../commands/loadPlugin";
import { openInspectorForSession } from "../commands/openHtmlInspector";
import { packManifest } from "../commands/packPlugin";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import { UxpInspectorPanel } from "../inspector/UxpInspectorPanel";
import type { CdpProxyRegistry } from "../proxy/CdpProxyRegistry";
import { errorWithRetryDialog } from "../ui/dialogs";
import { pickSession } from "../ui/picks";
import { type PluginRegistry, pathKey } from "./PluginRegistry";
import { sessionsForScript } from "./scriptSessions";
import {
    type FromWebviewMessage,
    type PanelAction,
    type PanelState,
    rowKeyForAction,
} from "./panelProtocol";
import { type ManifestFacts, buildPanelState } from "./panelState";

const SCRIPT_EXTENSIONS = [".js", ".ts", ".ccjs", ".psjs", ".idjs"];

/** Safety net against pathological loops (symlink cycles, etc.) — see CONTROL-PANEL.md §3.3. */
const MAX_ANCESTOR_DEPTH = 50;

/**
 * Ancestor directories from the manifest's own folder up to (and including)
 * the first one containing a `.git` entry, or up to the filesystem root if
 * none is found (CONTROL-PANEL.md §3.3).
 */
export function collectAncestorCandidates(manifestPath: string): string[] {
    const candidates: string[] = [];
    let dir = path.dirname(manifestPath);
    for (let i = 0; i < MAX_ANCESTOR_DEPTH; i++) {
        candidates.push(dir);
        if (fs.existsSync(path.join(dir, ".git"))) {
            break; // include the .git root itself, then stop
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            break; // reached the filesystem root
        }
        dir = parent;
    }
    return candidates;
}

/**
 * First candidate (most-nested-first order) containing a marker, checked in
 * priority order `.git` → `.vscode` → `src`; falls back to the manifest's
 * own folder (`candidates[0]`) when none match.
 */
export function recommendedFolder(candidates: string[]): string {
    for (const marker of [".git", ".vscode", "src"]) {
        const hit = candidates.find((dir) => fs.existsSync(path.join(dir, marker)));
        if (hit) {
            return hit;
        }
    }
    return candidates[0];
}

export class PanelController implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly unsubscribes: (() => void)[] = [];
    private webview: vscode.Webview | undefined;
    /** Row key → in-flight action kind (one action per row, §9.5). */
    private readonly busyRows = new Map<string, string>();
    /** Row key → current action chain, used to serialize watch-triggered work. */
    private readonly rowTasks = new Map<string, Promise<void>>();
    private postScheduled = false;
    /** Cache for {@link getInstalledAppIds} — see its doc comment. */
    private installedAppIds: string[] | undefined;

    constructor(
        private readonly service: UxpService,
        private readonly pluginRegistry: PluginRegistry,
        private readonly debugManager: UxpDebugSessionManager,
        private readonly proxyRegistry: CdpProxyRegistry,
        private readonly context: vscode.ExtensionContext,
        private readonly output: vscode.OutputChannel,
    ) {
        const refresh = () => {
            this.postState();
        };
        this.disposables.push(
            this.service.onAppsChanged(refresh),
            this.service.onSessionStarted(refresh),
            this.service.onSessionEnded(refresh),
            this.service.onBrokerStateChanged(refresh),
            vscode.debug.onDidStartDebugSession(refresh),
            vscode.debug.onDidTerminateDebugSession(refresh),
            vscode.window.onDidChangeActiveTextEditor(refresh),
            vscode.workspace.onDidChangeWorkspaceFolders(refresh),
        );
        this.unsubscribes.push(
            this.pluginRegistry.onDidChange.on(() => {
                this.postState();
            }),
            UxpInspectorPanel.onDidChangeInstances.on(refresh),
        );
    }

    /** Hook up (or replace) the webview this controller renders into. */
    attachWebview(webview: vscode.Webview): vscode.Disposable {
        this.webview = webview;
        const receiver = webview.onDidReceiveMessage((message: FromWebviewMessage) => {
            // Preserve validation at the untrusted webview-message boundary.
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (message?.type === "panelAction") {
                this.dispatch(message.action);
            }
        });
        return new vscode.Disposable(() => {
            receiver.dispose();
            if (this.webview === webview) {
                this.webview = undefined;
            }
        });
    }

    // -------------------------------------------------------------------------
    // State snapshots
    // -------------------------------------------------------------------------

    buildState(): PanelState {
        const activeEditorPath
            = vscode.window.activeTextEditor?.document.uri.scheme === "file"
                ? vscode.window.activeTextEditor.document.uri.fsPath
                : undefined;

        return buildPanelState({
            registry: this.pluginRegistry.snapshot,
            brokerStatus: this.service.brokerState,
            brokerError: this.service.brokerError,
            connectedApps: this.service.connectedApps.map((app) => ({
                appId: app.info.appId,
                name: app.info.appName,
                version: app.info.appVersion,
                uxpVersion: app.info.uxpVersion,
                supportsScripts: app.info.supportedFeatures?.debugScripts === true,
            })),
            installedApps: this.getInstalledAppIds(),
            sessions: this.service.sessions.map((session) => ({
                clientSessionId: session.clientSessionId,
                kind: session.kind,
                manifestPath: session.manifestPath,
                pluginPath: session.pluginPath,
                name: session.name,
                scriptSourcePath: session.scriptSourcePath,
            })),
            attachedSessionIds: new Set(this.debugManager.activeSessionIds),
            pendingBreakSessionIds: new Set(
                this.service.sessions
                    .filter((s) => this.debugManager.isPendingBreakOnStart(s.clientSessionId))
                    .map((s) => s.clientSessionId),
            ),
            inspectorSessionIds: new Set(UxpInspectorPanel.openSessionIds()),
            busyRows: this.busyRows,
            activeEditor: {
                isManifest:
          !!activeEditorPath
          && path.basename(activeEditorPath).toLowerCase() === "manifest.json",
                isScript:
          !!activeEditorPath
          && SCRIPT_EXTENSIONS.includes(path.extname(activeEditorPath).toLowerCase()),
                path: activeEditorPath,
            },
            workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
            readManifest: (manifestPath) => this.readManifestFacts(manifestPath),
            fileExists: (filePath) => fs.existsSync(filePath),
        });
    }

    /** Post a fresh snapshot to the webview (coalesced per tick). */
    postState(): void {
        if (this.postScheduled || !this.webview) {
            return;
        }
        this.postScheduled = true;
        setTimeout(() => {
            this.postScheduled = false;
            if (this.webview) {
                void this.webview.postMessage({ type: "panelState", state: this.buildState() });
            }
        }, 0);
    }

    private readManifestFacts(manifestPath: string): ManifestFacts {
        const fallbackName = path.basename(path.dirname(manifestPath));
        try {
            const content = fs.readFileSync(manifestPath, "utf-8");
            const parsed = parseManifestContent(content, manifestPath);
            return {
                name: parsed.manifest.name,
                id: parsed.manifest.id,
                hostApps: [...new Set(parsed.hosts.map((host) => host.app))],
            };
        }
        catch (err) {
            return {
                name: fallbackName,
                id: "",
                hostApps: [],
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    // -------------------------------------------------------------------------
    // Action dispatch
    // -------------------------------------------------------------------------

    /** Dispatch an interactive action immediately, ignoring duplicate work for a busy row. */
    dispatch(action: PanelAction): void {
        const key = rowKeyForAction(action);
        if (key && this.busyRows.has(key)) {
            this.output.appendLine(
                `[panel] Ignoring "${action.kind}" — "${this.busyRows.get(key)}" is still running for ${key}.`,
            );
            return;
        }
        const task = this.executeAction(action, key);
        if (key) {
            this.trackRowTask(key, task);
        }
    }

    /** Queue a watch-triggered action behind any operation already running for the same row. */
    dispatchQueued(action: PanelAction): Promise<void> {
        const key = rowKeyForAction(action);
        if (!key) {
            return this.executeAction(action, key);
        }
        const previous = this.rowTasks.get(key) ?? Promise.resolve();
        const task = previous.then(() => this.executeAction(action, key));
        this.trackRowTask(key, task);
        return task;
    }

    private trackRowTask(key: string, task: Promise<void>): void {
        this.rowTasks.set(key, task);
        void task.finally(() => {
            if (this.rowTasks.get(key) === task) {
                this.rowTasks.delete(key);
            }
        });
    }

    private executeAction(action: PanelAction, key: string | undefined): Promise<void> {
        if (key) {
            this.busyRows.set(key, action.kind);
            this.postState();
        }
        return this.execute(action)
            .catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err);
                this.output.appendLine(`[panel] "${action.kind}" failed: ${message}`);
                void vscode.window.showErrorMessage(`UXP: ${message}`);
            })
            .finally(() => {
                if (key) {
                    this.busyRows.delete(key);
                }
                this.postState();
            });
    }

    private async execute(action: PanelAction): Promise<void> {
        switch (action.kind) {
            case "ready":
                this.postState();
                return;
            case "loadPlugin":
                return this.loadPlugin(action.manifestPath, action.breakOnLoad);
            case "unloadPlugin":
                return this.unloadPlugin(action.manifestPath);
            case "refreshPlugin":
                return this.refreshPlugin(action.manifestPath);
            case "reloadPlugin":
                return this.reloadPlugin(action.manifestPath, action.breakOnLoad);
            case "attachDebugger":
                return attachDebuggerCommand(
                    this.service,
                    this.debugManager,
                    this.output,
                    action.manifestPath,
                );
            case "detachDebugger":
                return this.detachDebugger(action.manifestPath);
            case "openInspector":
                return this.openInspector(action.manifestPath);
            case "closeInspector":
                return this.closeInspector(action.manifestPath);
            case "addPluginPick":
                return this.addPluginPick();
            case "addActiveManifest":
                return this.addActiveManifest();
            case "removePlugin":
                return this.removePluginWithUndo(action.manifestPath);
            case "openPluginFolder":
                return this.openPluginFolder(action.manifestPath, action.folder, action.mode);
            case "openManifestFile":
                return this.openManifestFile(action.manifestPath);
            case "packPlugin":
                return packManifest(action.manifestPath, this.output);
            case "launchHostApp":
                return this.launchHostApp(action.appId);
            case "startDiscovery":
            case "enableDevModeAndStart":
                // Both route through the existing interactive flow (dev-mode
                // consent/elevation + port dialogs) — only the automatic path at
                // activation uses the silent variant (APP-DISCOVERY.md §1).
                return this.service.ensureStarted();
            case "requestTakeover":
                return this.service.takeOverFromPanel();
            case "debugScript":
                return this.debugScript(action.scriptPath);
            case "stopScript":
                return this.stopScript(action.scriptPath);
            case "restartScript":
                return this.restartScript(action.scriptPath);
            case "editScriptArgs":
                return this.editScriptArgs(action.scriptPath);
            case "openScriptFile": {
                const doc = await vscode.workspace.openTextDocument(action.scriptPath);
                await vscode.window.showTextDocument(doc, { preview: false });
                return;
            }
            case "addScriptPick":
                return this.addScriptPick();
            case "addActiveScript":
                return this.addActiveScript(action.andDebug);
            case "removeScript":
                return this.removeScriptWithUndo(action.scriptPath);
            case "setBreakOnLoad":
                return this.pluginRegistry.setBreakOnLoad(action.scope, action.value);
            case "setScriptTargetApp":
                return this.pluginRegistry.setScriptTargetApp(action.appId);
            case "setWatch":
                return this.pluginRegistry.setWatch(action.target, action.value);
            default: {
                // Exhaustiveness guard — webview messages are untrusted, so an
                // unknown kind is also reachable at runtime.
                const unhandled: never = action;
                this.output.appendLine(`[panel] Ignored unknown panel action: ${JSON.stringify(unhandled)}`);
                return;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Remove-with-undo (removal is immediate; native notification offers Undo)
    // -------------------------------------------------------------------------

    /** Fire-and-forget: shows the notification and restores on "Undo", without blocking the caller. */
    private offerUndo(message: string, restore: () => Promise<void>): void {
        void vscode.window.showInformationMessage(`UXP: ${message}`, "Undo").then((choice) => {
            if (choice === "Undo") {
                void restore();
            }
        });
    }

    private async removePluginWithUndo(manifestPath: string): Promise<void> {
        const plugin = this.pluginRegistry.pluginByManifest(manifestPath);
        const plugins = this.pluginRegistry.snapshot.plugins;
        const index = plugins.findIndex(
            (pl) => pathKey(pl.manifestPath) === pathKey(manifestPath),
        );
        // Anchor Undo to the preceding neighbour — other removals before the
        // user clicks Undo would shift a raw index.
        const previousKey = index > 0 ? pathKey(plugins[index - 1].manifestPath) : undefined;
        await this.pluginRegistry.removePlugin(manifestPath);
        if (plugin) {
            const name = this.readManifestFacts(manifestPath).name;
            this.offerUndo(`Plugin "${name}" removed.`, () =>
                this.pluginRegistry.restorePlugin(plugin, this.restoreIndexFor(
                    this.pluginRegistry.snapshot.plugins,
                    (pl) => pathKey(pl.manifestPath),
                    previousKey,
                    index,
                )),
            );
        }
    }

    private async removeScriptWithUndo(scriptPath: string): Promise<void> {
        const script = this.pluginRegistry.scriptByPath(scriptPath);
        const scripts = this.pluginRegistry.snapshot.scripts;
        const index = scripts.findIndex(
            (s) => pathKey(s.scriptPath) === pathKey(scriptPath),
        );
        const previousKey = index > 0 ? pathKey(scripts[index - 1].scriptPath) : undefined;
        await this.pluginRegistry.removeScript(scriptPath);
        if (script) {
            this.offerUndo(`Script "${path.basename(script.scriptPath)}" removed.`, () =>
                this.pluginRegistry.restoreScript(script, this.restoreIndexFor(
                    this.pluginRegistry.snapshot.scripts,
                    (s) => pathKey(s.scriptPath),
                    previousKey,
                    index,
                )),
            );
        }
    }

    /**
     * Undo insertion point: right after the removed item's original preceding
     * neighbour (falls back to the original index when that neighbour is gone too).
     */
    private restoreIndexFor<T>(
        items: readonly T[],
        keyOf: (item: T) => string,
        previousKey: string | undefined,
        originalIndex: number,
    ): number {
        if (previousKey === undefined) {
            return 0;
        }
        const anchor = items.findIndex((item) => keyOf(item) === previousKey);
        return anchor >= 0 ? anchor + 1 : Math.min(originalIndex, items.length);
    }

    // -------------------------------------------------------------------------
    // Plugin actions
    // -------------------------------------------------------------------------

    private async loadPlugin(manifestPath: string, breakOnLoad: boolean): Promise<void> {
        const result = await loadWithDialogs(this.service, manifestPath, this.output, breakOnLoad);
        if (!result) {
            return;
        }
        reportLoadResult(result, this.output);
        if (breakOnLoad) {
            this.debugManager.markPendingBreakOnStart(result.sessions);
        }
    }

    private sessionsFor(manifestPath: string): PluginSession[] {
        return this.service.sessionsForManifest(manifestPath);
    }

    private requireLiveSessions(manifestPath: string, emptyMessage: string): PluginSession[] | undefined {
        const sessions = this.sessionsFor(manifestPath);
        if (sessions.length === 0) {
            void vscode.window.showInformationMessage(emptyMessage);
            return undefined;
        }
        return sessions;
    }

    private async unloadPlugin(manifestPath: string): Promise<void> {
        await this.service.ensureStarted();
        const sessions = this.requireLiveSessions(
            manifestPath,
            "UXP: This plugin has no live session — there is nothing to unload.",
        );
        if (!sessions) {
            return;
        }
        for (const session of sessions) {
            await this.service.unloadPlugin(session);
        }
    }

    private async refreshPlugin(manifestPath: string): Promise<void> {
        await this.service.ensureStarted();
        const sessions = this.requireLiveSessions(
            manifestPath,
            "UXP: This plugin has no live session to refresh.",
        );
        if (!sessions) {
            return;
        }
        for (const session of sessions) {
            for (;;) {
                try {
                    await this.service.reloadPlugin(session);
                    break;
                }
                catch (err) {
                    if (err instanceof RequestTimeoutError && (await errorWithRetryDialog(err.message))) {
                        continue;
                    }
                    throw err;
                }
            }
        }
    }

    /**
   * Reload = Unload + Load with debugger/inspector auto-restore
    * (CONTROL-PANEL.md §9.10). Pins the app the plugin was already loaded
   * into (`targetAppId`) so it reloads into the same one silently — only a
   * fresh "Load" re-prompts when several apps match.
   */
    private async reloadPlugin(manifestPath: string, breakOnLoad: boolean): Promise<void> {
        await this.service.ensureStarted();
        const sessions = this.sessionsFor(manifestPath);
        const wasDebugging = sessions.some((s) =>
            this.debugManager.isAttached(s.clientSessionId),
        );
        const wasInspectorOpen = sessions.some((s) =>
            UxpInspectorPanel.isOpen(s.clientSessionId),
        );
        const targetAppId = sessions[0]?.app.appId;

        for (const session of sessions) {
            UxpInspectorPanel.disposeForSession(session.clientSessionId);
            await this.service.unloadPlugin(session);
        }

        const result = await loadWithDialogs(
            this.service,
            manifestPath,
            this.output,
            breakOnLoad,
            targetAppId,
        );
        if (!result) {
            return; // load failed/cancelled — nothing to restore (§9.10)
        }
        reportLoadResult(result, this.output);
        if (breakOnLoad) {
            this.debugManager.markPendingBreakOnStart(result.sessions);
        }

        const restored = result.sessions[0];
        // Keep this boundary guard in case a future service implementation returns an empty session list.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!restored) {
            return;
        }
        if (wasDebugging) {
            await this.debugManager.attach(restored, path.dirname(manifestPath));
        }
        if (wasInspectorOpen) {
            if (breakOnLoad && !wasDebugging) {
                // Break-on-start sessions have no execution context until a debugger
                // attaches (§9.4) — cannot restore the inspector yet.
                this.output.appendLine(
                    "[panel] Skipping inspector restore — session is waiting for a debugger.",
                );
                return;
            }
            await openInspectorForSession(
                restored,
                this.service,
                this.proxyRegistry,
                this.context,
                this.output,
            );
        }
    }

    private async detachDebugger(manifestPath: string): Promise<void> {
        const attached = this.sessionsFor(manifestPath).filter((s) =>
            this.debugManager.isAttached(s.clientSessionId),
        );
        if (attached.length === 0) {
            void vscode.window.showInformationMessage("UXP: No debugger is attached to this plugin.");
            return;
        }
        await this.stopDebuggingSessions(attached);
    }

    private async stopDebuggingSessions(sessions: PluginSession[]): Promise<void> {
        for (const session of sessions) {
            const vsSession = this.debugManager.getVsSession(session.clientSessionId);
            if (vsSession) {
                await vscode.debug.stopDebugging(vsSession);
            }
            else {
                await this.debugManager.stopSession(session.clientSessionId);
            }
        }
    }

    private async openInspector(manifestPath: string): Promise<void> {
        await this.service.ensureStarted();
        const inspectable = this.sessionsFor(manifestPath).filter(
            (s) =>
                s.kind === "plugin" && !this.debugManager.isPendingBreakOnStart(s.clientSessionId),
        );
        if (inspectable.length === 0) {
            const pending = this.sessionsFor(manifestPath).length > 0;
            void vscode.window.showInformationMessage(
                pending
                    ? "UXP: The plugin is waiting for a debugger (break on start) — attach the debugger before opening the inspector."
                    : "UXP: No live plugin session. Load the plugin first.",
            );
            return;
        }
        const session
            = inspectable.length === 1
                ? inspectable[0]
                : await pickSession(inspectable, "Inspect Plugin UI (HTML/CSS)");
        if (!session) {
            return;
        }
        await openInspectorForSession(
            session,
            this.service,
            this.proxyRegistry,
            this.context,
            this.output,
        );
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    private async closeInspector(manifestPath: string): Promise<void> {
        for (const session of this.sessionsFor(manifestPath)) {
            UxpInspectorPanel.disposeForSession(session.clientSessionId);
        }
    }

    // -------------------------------------------------------------------------
    // Plugin registration actions (CONTROL-PANEL.md §3)
    // -------------------------------------------------------------------------

    private async addPluginPick(): Promise<void> {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { "UXP manifest": ["json"] },
            openLabel: "Add Plugin",
            title: "Select the plugin's manifest.json",
        });
        const manifestPath = picked?.[0]?.fsPath;
        if (manifestPath) {
            await this.addPluginValidated(manifestPath);
        }
    }

    private async addActiveManifest(): Promise<void> {
        const active = vscode.window.activeTextEditor?.document;
        if (active?.uri.scheme !== "file") {
            void vscode.window.showErrorMessage("UXP: Open the plugin's manifest.json first.");
            return;
        }
        await this.addPluginValidated(active.uri.fsPath);
    }

    private async addPluginValidated(manifestPath: string): Promise<void> {
        if (path.basename(manifestPath).toLowerCase() !== "manifest.json") {
            void vscode.window.showErrorMessage("UXP: The selected file is not a manifest.json.");
            return;
        }
        const normalized = path.normalize(manifestPath);
        try {
            parseManifestContent(fs.readFileSync(normalized, "utf-8"), normalized);
        }
        catch (err) {
            void vscode.window.showErrorMessage(
                `UXP: ${err instanceof Error ? err.message : String(err)}`,
            );
            return;
        }
        const error = await this.pluginRegistry.addPlugin(normalized);
        if (error) {
            void vscode.window.showErrorMessage(`UXP: ${error}`);
        }
    }

    private async openManifestFile(manifestPath: string): Promise<void> {
        const doc = await vscode.workspace.openTextDocument(manifestPath);
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    /**
    * Ancestor-folder picker (CONTROL-PANEL.md §3.3): walks up from the
   * manifest's own directory to (and including) the first folder containing
   * `.git`, or up to the filesystem root if none is found. The most-nested
   * candidate containing `.git`, else `.vscode`, else `src` is recommended.
   */
    private async openPluginFolder(
        manifestPath: string,
        chosenFolder: string | undefined,
        mode: "reveal" | "addToWorkspace" | "newWindow" | undefined,
    ): Promise<void> {
        let folder = chosenFolder;
        if (!folder) {
            const candidates = collectAncestorCandidates(manifestPath);
            const recommended = recommendedFolder(candidates);
            const pick = await vscode.window.showQuickPick(
                candidates.map((dir) => ({
                    label: `${dir === recommended ? "$(star-full) " : ""}${path.basename(dir) || dir}`,
                    description: dir,
                    folder: dir,
                })),
                { placeHolder: "Which folder do you want to open?" },
            );
            if (!pick) {
                return;
            }
            folder = pick.folder;
        }
        const uri = vscode.Uri.file(folder);

        if (!mode) {
            const pick = await vscode.window.showQuickPick(
                [
                    {
                        label: "$(folder-opened) Open folder",
                        description: "replaces the current workspace",
                        mode: "reveal" as const,
                    },
                    {
                        label: "$(root-folder) Add to workspace",
                        mode: "addToWorkspace" as const,
                    },
                    {
                        label: "$(empty-window) Open in new window",
                        mode: "newWindow" as const,
                    },
                ],
                { placeHolder: `Open ${folder}` },
            );
            if (!pick) {
                return;
            }
            mode = pick.mode;
        }

        switch (mode) {
            case "newWindow":
                await vscode.commands.executeCommand("vscode.openFolder", uri, {
                    forceNewWindow: true,
                });
                return;
            case "addToWorkspace": {
                const count = vscode.workspace.workspaceFolders?.length ?? 0;
                vscode.workspace.updateWorkspaceFolders(count, 0, { uri });
                return;
            }
            case "reveal": {
                // Same-window folder switch — tear down live state first (§9.2),
                // mirroring the takeover hook's order in extension.ts.
                const proceed = "Open Folder";
                const choice = await vscode.window.showWarningMessage(
                    "Opening this folder will replace the current workspace. "
                    + "Active debug sessions and inspectors will be stopped.",
                    { modal: true },
                    proceed,
                );
                if (choice !== proceed) {
                    return;
                }
                UxpInspectorPanel.disposeAll();
                await this.debugManager.stopAll();
                await vscode.commands.executeCommand("vscode.openFolder", uri, {
                    forceNewWindow: false,
                });
                return;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Host app actions
    // -------------------------------------------------------------------------

    /**
   * Keeps the row busy (Apps-section spinner) until the launched app either
   * connects or the connect timeout elapses, instead of only for the
   * QuickPick + launch call itself.
   */
    private async launchHostApp(appId: string): Promise<void> {
        const launched = await launchHostAppByValue(this.service, this.output, appId);
        if (!launched) {
            return;
        }
        await this.service.waitForConnection(
            () => this.service.connectedApps.some((app) => app.info.appId === appId),
            CONNECT_TIMEOUT_MS,
        );
    }

    /**
   * Installed-app detection is a native call per catalog entry — cache once
   * per window instead of recomputing on every snapshot (state rebuilds
   * happen on unrelated events too, e.g. active-editor changes). Returns
   * `undefined` when detection itself is unsupported on this platform, so
   * the Apps section leaves the Start button enabled rather than assuming
   * nothing is installed.
   */
    private getInstalledAppIds(): string[] | undefined {
        if (this.installedAppIds) {
            return this.installedAppIds;
        }
        const controller = this.service.getHostAppController();
        const ids: string[] = [];
        for (const app of HOST_APPS) {
            try {
                if (controller.getInstalledCandidates(app).length > 0) {
                    ids.push(app.value);
                }
            }
            catch (err) {
                if (err instanceof NativeAddonUnavailableError) {
                    return undefined;
                }
                throw err;
            }
        }
        this.installedAppIds = ids;
        return ids;
    }

    // -------------------------------------------------------------------------
    // Script actions
    // -------------------------------------------------------------------------

    /**
   * Panel script runs never prompt for arguments (§9.11) — the stored Args
   * text is parsed and passed through explicitly, which makes
   * `debugScriptCommand` skip its InputBox.
   */
    private async debugScript(scriptPath: string): Promise<void> {
        const stored = this.pluginRegistry.scriptByPath(scriptPath);
        const userArgs = parseArgsText(stored?.args ?? "") ?? [];
        await debugScriptCommand(this.service, this.debugManager, this.context, this.output, {
            script: scriptPath,
            app: this.pluginRegistry.snapshot.scriptTargetApp,
            userArgs,
            promptToRetry: false,
        });
    }

    private async stopScript(scriptPath: string): Promise<void> {
        const sessions = sessionsForScript(this.service, scriptPath);
        const attached = sessions.filter((s) => this.debugManager.isAttached(s.clientSessionId));
        if (attached.length === 0) {
            void vscode.window.showInformationMessage("UXP: This script is not being debugged.");
            return;
        }
        await this.stopDebuggingSessions(attached);
    }

    /**
   * Watch-mode restart: stop, then re-run with the stored args. UXP has no
   * "unload script" RPC, so the previous run may still be tearing down in
   * the host — `debugScriptCommand` retries on the resulting "is modal"
   * error instead of guessing a fixed delay here.
   */
    private async restartScript(scriptPath: string): Promise<void> {
        await this.stopScript(scriptPath);
        await this.debugScript(scriptPath);
    }

    private async editScriptArgs(scriptPath: string): Promise<void> {
        const stored = this.pluginRegistry.scriptByPath(scriptPath);
        const text = await vscode.window.showInputBox({
            title: `Script arguments — ${path.basename(scriptPath)}`,
            prompt: "JSON values, comma separated — e.g. 2, \"text\", true. Leave empty for none.",
            value: stored?.args ?? "",
            validateInput: (value) =>
                parseArgsText(value) === undefined ? "Not valid JSON values." : undefined,
        });
        if (text === undefined || parseArgsText(text) === undefined) {
            return; // Esc / invalid
        }
        await this.pluginRegistry.setScriptArgs(scriptPath, text);
    }

    private async addScriptPick(): Promise<void> {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { "UXP scripts": ["ccjs", "psjs", "idjs", "js", "ts"] },
            openLabel: "Add Script",
        });
        const scriptPath = picked?.[0]?.fsPath;
        if (scriptPath) {
            await this.pluginRegistry.addScript(scriptPath);
        }
    }

    private async addActiveScript(andDebug: boolean): Promise<void> {
        const active = vscode.window.activeTextEditor?.document;
        if (active?.uri.scheme !== "file") {
            void vscode.window.showErrorMessage("UXP: Open a UXP script file in the editor first.");
            return;
        }
        const scriptPath = active.uri.fsPath;
        if (!SCRIPT_EXTENSIONS.includes(path.extname(scriptPath).toLowerCase())) {
            void vscode.window.showErrorMessage(
                "UXP: The active file is not a UXP script (.ccjs / .psjs / .idjs / .js / .ts).",
            );
            return;
        }
        if (active.isDirty) {
            await active.save();
        }
        await this.pluginRegistry.addScript(scriptPath);
        if (andDebug) {
            await this.debugScript(scriptPath);
        }
    }

    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        for (const unsubscribe of this.unsubscribes) {
            unsubscribe();
        }
    }
}
