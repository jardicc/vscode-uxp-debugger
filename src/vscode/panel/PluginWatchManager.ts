/**
 * Watch-mode backend (CONTROL-PANEL.md §8): keeps a `vscode.FileSystemWatcher`
 * alive for every plugin/script that has `watch: true` in the registry AND is
 * currently "active" — a not-loaded plugin or a script with no attached
 * debugger creates no watcher at all (dormant, per §8's design note).
 *
 * Plugin changes: every changed path within a 350 ms debounce window is
 * batched, then a full Unload+Load ("reload") runs when the batch includes
 * `manifest.json` itself, a `*.uxpaddon` file, or a manifest-declared icon
 * (matched by stripping the on-disk `@2x`/`@3x` scale suffix — the manifest
 * never lists it); otherwise a fast in-place `Plugin/reload` ("refresh").
 *
 * Script changes: a single-file watcher restarts the script's debug session
 * (stop + re-run with the stored args) — only while it is actively being
 * debugged; otherwise the change is ignored.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { collectManifestIconPaths, isIconFileMatch, parseManifestContent } from "../../core/manifest/manifest";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import type { UxpService } from "../UxpService";
import type { PanelController } from "./PanelController";
import { type PluginRegistry, pathKey } from "./PluginRegistry";
import { sessionsForScript } from "./scriptSessions";

const DEBOUNCE_MS = 350;
const ADDON_EXTENSION = ".uxpaddon";

interface PluginWatchEntry {
    subscriptions: vscode.Disposable[];
    pending: Set<string>;
    timer?: ReturnType<typeof setTimeout>;
}

interface ScriptWatchEntry {
    subscriptions: vscode.Disposable[];
    timer?: ReturnType<typeof setTimeout>;
}

export class PluginWatchManager implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly unsubscribes: (() => void)[] = [];
    private readonly pluginWatchers = new Map<string, PluginWatchEntry>();
    private readonly scriptWatchers = new Map<string, ScriptWatchEntry>();

    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly service: UxpService,
        private readonly debugManager: UxpDebugSessionManager,
        private readonly panelController: PanelController,
        private readonly output: vscode.OutputChannel,
    ) {
        const reconcile = () => {
            this.reconcile();
        };
        this.disposables.push(
            this.service.onSessionStarted(reconcile),
            this.service.onSessionEnded(reconcile),
            vscode.debug.onDidStartDebugSession(reconcile),
            vscode.debug.onDidTerminateDebugSession(reconcile),
        );
        this.unsubscribes.push(this.pluginRegistry.onDidChange.on(reconcile));
        this.reconcile();
    }

    // -------------------------------------------------------------------------
    // Reconciliation — decide which watchers should exist right now
    // -------------------------------------------------------------------------

    private reconcile(): void {
        this.reconcilePlugins();
        this.reconcileScripts();
    }

    /** Whether the manager has installed a live filesystem watcher for this plugin. */
    isWatching(manifestPath: string): boolean {
        return this.pluginWatchers.has(pathKey(path.normalize(manifestPath)));
    }

    private reconcilePlugins(): void {
        const desired = new Map<string, string>(); // pathKey -> manifestPath
        for (const plugin of this.pluginRegistry.snapshot.plugins) {
            if (plugin.watch && this.service.sessionsForManifest(plugin.manifestPath).length > 0) {
                desired.set(pathKey(path.normalize(plugin.manifestPath)), plugin.manifestPath);
            }
        }
        for (const [key, entry] of this.pluginWatchers) {
            if (!desired.has(key)) {
                this.disposeEntry(entry);
                this.pluginWatchers.delete(key);
            }
        }
        for (const [key, manifestPath] of desired) {
            if (!this.pluginWatchers.has(key)) {
                this.pluginWatchers.set(key, this.createPluginWatcher(manifestPath));
            }
        }
    }

    private reconcileScripts(): void {
        const desired = new Map<string, string>(); // pathKey -> scriptPath
        for (const script of this.pluginRegistry.snapshot.scripts) {
            if (!script.watch) {
                continue;
            }
            const debugging = sessionsForScript(this.service, script.scriptPath).some((s) =>
                this.debugManager.isAttached(s.clientSessionId),
            );
            if (debugging) {
                desired.set(pathKey(path.normalize(script.scriptPath)), script.scriptPath);
            }
        }
        for (const [key, entry] of this.scriptWatchers) {
            if (!desired.has(key)) {
                this.disposeEntry(entry);
                this.scriptWatchers.delete(key);
            }
        }
        for (const [key, scriptPath] of desired) {
            if (!this.scriptWatchers.has(key)) {
                this.scriptWatchers.set(key, this.createScriptWatcher(scriptPath));
            }
        }
    }

    // -------------------------------------------------------------------------
    // Plugin watcher
    // -------------------------------------------------------------------------

    private createPluginWatcher(manifestPath: string): PluginWatchEntry {
        const pluginDir = path.dirname(manifestPath);
        const pattern = new vscode.RelativePattern(vscode.Uri.file(pluginDir), "**/*");
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        const entry: PluginWatchEntry = { subscriptions: [watcher], pending: new Set() };

        const onEvent = (uri: vscode.Uri): void => {
            entry.pending.add(uri.fsPath);
            if (entry.timer) {
                clearTimeout(entry.timer);
            }
            entry.timer = setTimeout(() => {
                this.flushPluginChanges(manifestPath, entry);
            }, DEBOUNCE_MS);
        };
        entry.subscriptions.push(
            watcher.onDidCreate(onEvent),
            watcher.onDidChange(onEvent),
            watcher.onDidDelete(onEvent),
        );
        return entry;
    }

    private flushPluginChanges(manifestPath: string, entry: PluginWatchEntry): void {
        const changed = [...entry.pending];
        entry.pending.clear();
        entry.timer = undefined;

        if (this.service.sessionsForManifest(manifestPath).length === 0) {
            return; // unloaded during the debounce window — nothing to refresh/reload
        }

        const special = changed.some((file) => this.isSpecialPluginFile(file, manifestPath));
        this.output.appendLine(
            `[watch] ${String(changed.length)} file(s) changed under ${path.basename(path.dirname(manifestPath))} — `
            + (special ? "reloading (manifest/addon/icon changed)." : "refreshing."),
        );
        if (special) {
            void this.panelController.dispatchQueued({
                kind: "reloadPlugin",
                manifestPath,
                breakOnLoad: this.pluginRegistry.snapshot.breakOnLoad.plugins,
            });
        }
        else {
            void this.panelController.dispatchQueued({ kind: "refreshPlugin", manifestPath });
        }
    }

    /** manifest.json itself, any `*.uxpaddon` file, or a manifest-declared icon. */
    private isSpecialPluginFile(changedFilePath: string, manifestPath: string): boolean {
        if (pathKey(path.normalize(changedFilePath)) === pathKey(path.normalize(manifestPath))) {
            return true;
        }
        if (path.extname(changedFilePath).toLowerCase() === ADDON_EXTENSION) {
            return true;
        }
        try {
            const content = fs.readFileSync(manifestPath, "utf-8");
            const { manifest } = parseManifestContent(content, manifestPath);
            const iconPaths = collectManifestIconPaths(manifest);
            return isIconFileMatch(changedFilePath, path.dirname(manifestPath), iconPaths);
        }
        catch {
            return false; // unreadable/invalid manifest right now — treat as no icon match
        }
    }

    // -------------------------------------------------------------------------
    // Script watcher
    // -------------------------------------------------------------------------

    private createScriptWatcher(scriptPath: string): ScriptWatchEntry {
        const pattern = new vscode.RelativePattern(
            vscode.Uri.file(path.dirname(scriptPath)),
            path.basename(scriptPath),
        );
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        const entry: ScriptWatchEntry = { subscriptions: [watcher] };

        const onEvent = (): void => {
            if (entry.timer) {
                clearTimeout(entry.timer);
            }
            entry.timer = setTimeout(() => {
                this.flushScriptChange(scriptPath, entry);
            }, DEBOUNCE_MS);
        };
        entry.subscriptions.push(
            watcher.onDidCreate(onEvent),
            watcher.onDidChange(onEvent),
            watcher.onDidDelete(onEvent),
        );
        return entry;
    }

    private flushScriptChange(scriptPath: string, entry: ScriptWatchEntry): void {
        entry.timer = undefined;
        const stillDebugging = sessionsForScript(this.service, scriptPath).some((s) =>
            this.debugManager.isAttached(s.clientSessionId),
        );
        if (!stillDebugging) {
            return; // debugger detached during the debounce window — nothing to restart
        }
        this.output.appendLine(`[watch] ${path.basename(scriptPath)} changed — restarting debug session.`);
        void this.panelController.dispatchQueued({ kind: "restartScript", scriptPath });
    }

    // -------------------------------------------------------------------------
    // Disposal
    // -------------------------------------------------------------------------

    private disposeEntry(entry: PluginWatchEntry | ScriptWatchEntry): void {
        if (entry.timer) {
            clearTimeout(entry.timer);
        }
        for (const d of entry.subscriptions) {
            d.dispose();
        }
    }

    dispose(): void {
        for (const entry of this.pluginWatchers.values()) {
            this.disposeEntry(entry);
        }
        this.pluginWatchers.clear();
        for (const entry of this.scriptWatchers.values()) {
            this.disposeEntry(entry);
        }
        this.scriptWatchers.clear();
        for (const d of this.disposables) {
            d.dispose();
        }
        for (const unsubscribe of this.unsubscribes) {
            unsubscribe();
        }
    }
}
