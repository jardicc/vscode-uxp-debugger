/**
 * Extension entry point — wiring only. All behaviour lives in the command
 * modules, `UxpService` (broker facade) and the pure-Node `core/` layer.
 */

import * as path from "path";
import * as vscode from "vscode";
import { isDevModeEnabled } from "../core/devmode/devMode";
import { cleanupAllStrippedScripts } from "../core/stripTypeScript";
import { UxpService } from "./UxpService";
import { attachDebuggerCommand } from "./commands/attachDebugger";
import { configureLaunchJsonCommand } from "./commands/configureLaunchJson";
import { debugScriptCommand } from "./commands/debugScript";
import { enableDevModeCommand } from "./commands/enableDevMode";
import { expHostAppMethodsCommand } from "./commands/expHostAppMethods";
import { loadPluginBreakOnStartCommand, loadPluginCommand } from "./commands/loadPlugin";
import { openHtmlInspectorCommand } from "./commands/openHtmlInspector";
import { packPluginCommand } from "./commands/packPlugin";
import {
    reloadPluginCommand,
    unloadPluginCommand,
} from "./commands/pluginSessionCommands";
import { runUxpCommand } from "./commands/runCommand";
import {
    UxpDebugConfigProvider,
    UxpScriptDebugConfigProvider,
} from "./debug/debugConfigProvider";
import { PauseTracker } from "./debug/pauseTracker";
import { registerPauseTracker } from "./debug/pauseTrackerRegistration";
import { findUxpClientSessionId, UxpDebugSessionManager } from "./debug/UxpDebugSessionManager";
import { createHooksRequestHandler } from "./hooks/hooksRouter";
import { createInspectorStaticHandler } from "./inspector/inspectorStaticServer";
import { UxpInspectorPanel } from "./inspector/UxpInspectorPanel";
import { CONTROL_PANEL_VIEW_ID, ControlPanelProvider } from "./panel/ControlPanelProvider";
import { PanelController } from "./panel/PanelController";
import { PluginWatchManager } from "./panel/PluginWatchManager";
import { PluginRegistry } from "./panel/PluginRegistry";
import { CdpProxyRegistry } from "./proxy/CdpProxyRegistry";
import { registerUxpLanguageModelTools, type UxpLanguageModelTools } from "./tools/registerTools";
import { HostLogChannels } from "./ui/output";

function setBoolContext(key: string, value: boolean): void {
    void vscode.commands.executeCommand("setContext", key, value);
}

/**
 * Sets a boolean `setContext` key from `compute()` right away, and again
 * whenever any of `events` fires — shared by every "only show this command
 * when it's actually usable" context key below. Accepts both vscode's own
 * `Event<T>` (subscribe returns a `Disposable`) and `TypedEvent.on` (subscribe
 * returns a plain unsubscribe function) so either kind of emitter can be
 * passed directly.
 */
function watchBoolContext(
    key: string,
    compute: () => boolean,
    ...events: ((listener: () => void) => vscode.Disposable | (() => void))[]
): vscode.Disposable[] {
    const update = () => {
        setBoolContext(key, compute());
    };
    update();
    return events.map((subscribe) => {
        const result = subscribe(update);
        return typeof result === "function" ? { dispose: result } : result;
    });
}

/**
 * Minimal, unstable API surface exported from `activate()` exclusively for
 * the `e2e/` test harness (see e2e/README.md). It bypasses all interactive
 * quick-pick UI so an automated flow can call `service.loadPlugin(...)` /
 * `service.unloadPlugin(...)` directly against a real, already-running host
 * app. NOT a supported public API — other extensions must not depend on it,
 * and it may change or disappear without notice.
 */
export interface UxpDebuggerTestApi {
    service: UxpService;
    debugManager: UxpDebugSessionManager;
    proxyRegistry: CdpProxyRegistry;
    pluginRegistry: PluginRegistry;
    watchManager: PluginWatchManager;
    /**
   * The registered LM tool instances — call `.invoke()` on these directly
   * in e2e tests instead of constructing a new tool from source (a second
   * copy would bundle its own module graph, breaking `instanceof` checks
   * against errors thrown by this running extension).
   */
    tools: UxpLanguageModelTools;
}

export function activate(context: vscode.ExtensionContext): UxpDebuggerTestApi {
    const output = vscode.window.createOutputChannel("UXP Debugger");
    output.appendLine("UXP Debugger extension activated.");

    // e2e/ diagnostics only: OutputChannel has no read-back API, so when the
    // live E2E test is running, tee every line to stdout (visible in the
    // `npm run test:e2e` terminal) as well. No effect on normal usage.
    if (process.env.UXP_E2E_PHOTOSHOP === "1") {
        const originalAppendLine = output.appendLine.bind(output);
        output.appendLine = (value: string) => {
            originalAppendLine(value);
            // eslint-disable-next-line no-console -- E2E diagnostics must be visible in the test runner.
            console.log(`[UXP Debugger] ${value}`);
        };
    }

    const service = new UxpService(context, output);
    const proxyRegistry = new CdpProxyRegistry(output);
    const debugManager = new UxpDebugSessionManager(service, proxyRegistry, output);
    const hostLogs = new HostLogChannels();
    const pluginRegistry = new PluginRegistry(context.globalState);
    // Absolute paths are machine-specific — keep the registry out of Settings Sync.
    context.globalState.setKeysForSync([]);
    const panelController = new PanelController(
        service,
        pluginRegistry,
        debugManager,
        proxyRegistry,
        context,
        output,
    );
    const watchManager = new PluginWatchManager(
        pluginRegistry,
        service,
        debugManager,
        panelController,
        output,
    );

    // Tier 2 LM tools (uxp_wait_for_pause / uxp_evaluate_in_frame) need to know
    // when a UXP-delegated debug session pauses — see LANGUAGE-MODEL-TOOLS.md §5.2.
    const pauseTracker = new PauseTracker();
    context.subscriptions.push(registerPauseTracker(pauseTracker, output));
    context.subscriptions.push(
        vscode.debug.onDidTerminateDebugSession((session) => {
            // Pause state is keyed by clientSessionId (see pauseTrackerRegistration).
            const clientSessionId = findUxpClientSessionId(session);
            if (clientSessionId !== undefined) {
                pauseTracker.forgetSession(clientSessionId);
            }
        }),
    );
    const { disposables: toolDisposables, tools } = registerUxpLanguageModelTools({
        pluginRegistry,
        service,
        debugManager,
        proxyRegistry,
        pauseTracker,
        context,
        output,
    });
    context.subscriptions.push(...toolDisposables);

    // Stop our own debug sessions and inspector panels before handing broker
    // ownership over to another VS Code window (MULTI-WINDOW-TAKEOVER.md
    // §4.4 and docs/UI-DEBUGGING.md).
    service.setBeforeTakeoverStopHook(async () => {
        UxpInspectorPanel.disposeAll();
        await debugManager.stopAll();
        await proxyRegistry.stopAll();
    });

    // Build-tool REST hooks (refresh/reload/load/unload/watch/pack) — ride on
    // the broker's own HTTP server/port, only reachable while it's running.
    const hooksRequestHandler = createHooksRequestHandler({
        service,
        pluginRegistry,
        debugManager,
        proxyRegistry,
        context,
        output,
    });
    // Self-hosted DevTools-frontend static assets (UxpInspectorPanel's iframe target) —
    // rides the same port/handler chain; without this the iframe's requests fell through
    // to the broker's generic `{}` JSON fallback response.
    const inspectorStaticHandler = createInspectorStaticHandler(
        path.join(context.extensionPath, "dist", "devtools"),
    );
    service.setHookRequestHandler(
        (req, res, url) => hooksRequestHandler(req, res, url) || inspectorStaticHandler(req, res, url),
    );

    // Auto-start discovery so the panel reflects reality without waiting for
    // the first Load/Attach/Debug Script action (APP-DISCOVERY.md).
    // Fire-and-forget: never blocks activation, never shows a dialog — any
    // failure only updates `brokerState`/`brokerError` for the panel.
    service.startDiscoverySilently().catch((err: unknown) => {
        output.appendLine(
            `[broker] auto-start threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
        );
    });

    context.subscriptions.push(output, service, debugManager, hostLogs, panelController, watchManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            CONTROL_PANEL_VIEW_ID,
            new ControlPanelProvider(context, panelController),
        ),
    );
    context.subscriptions.push(service.onHostLog((event) => {
        hostLogs.append(event);
    }));
    context.subscriptions.push({ dispose: cleanupAllStrippedScripts });
    context.subscriptions.push({
        dispose: () => {
            UxpInspectorPanel.disposeAll();
        },
    });
    context.subscriptions.push({ dispose: () => void proxyRegistry.stopAll() });
    // Plugin unloaded host-side / app disconnected → close its inspector panel.
    context.subscriptions.push(
        service.onSessionEnded((session) => { UxpInspectorPanel.disposeForSession(session.clientSessionId); },
        ),
    );

    // ---- Commands -----------------------------------------------------------

    const register = (
        id: string,
        handler: (...args: unknown[]) => Promise<void>,
    ): void => {
        context.subscriptions.push(
            vscode.commands.registerCommand(id, (...args: unknown[]) =>
                runUxpCommand(output, id, () => handler(...args)),
            ),
        );
    };

    register("uxp.loadPlugin", () => loadPluginCommand(service, pluginRegistry, output));
    register("uxp.loadPluginBreakOnStart", () =>
        loadPluginBreakOnStartCommand(service, pluginRegistry, debugManager, output),
    );
    register("uxp.unloadPlugin", () => unloadPluginCommand(service, pluginRegistry, output));
    register("uxp.reloadPlugin", () => reloadPluginCommand(service, pluginRegistry, output));
    register("uxp.attachDebugger", (manifestPath) => {
        if (typeof manifestPath !== "string") {
            throw new Error("\"uxp.attachDebugger\" requires a manifestPath argument.");
        }
        return attachDebuggerCommand(service, debugManager, output, manifestPath);
    });
    register("uxp.debugScript", async (args) => {
        await debugScriptCommand(
            service,
            debugManager,
            context,
            output,
            (args ?? undefined),
        );
    });
    register("uxp.openHtmlInspector", () =>
        openHtmlInspectorCommand(service, debugManager, proxyRegistry, context, output),
    );
    register("uxp.packPlugin", () => packPluginCommand(pluginRegistry, output));
    register("uxp.enableDevMode", async () => {
        await enableDevModeCommand(context, output);
        // Re-read from disk rather than trust the command's outcome — it may have
        // been enabled already, or the elevation prompt may have been declined.
        setBoolContext("uxp.devModeEnabled", isDevModeEnabled());
    });
    register("uxp.configureLaunchJson", () => configureLaunchJsonCommand());

    // Command Palette visibility (package.json menus.commandPalette "when"
    // clauses) for commands that are only ever useful in certain states.
    setBoolContext("uxp.devModeEnabled", isDevModeEnabled());
    context.subscriptions.push(
        ...watchBoolContext(
            "uxp.hasPlugins",
            () => pluginRegistry.snapshot.plugins.length > 0,
            (listener) => pluginRegistry.onDidChange.on(listener),
        ),
        ...watchBoolContext(
            "uxp.hasInspectableSessions",
            () =>
                service.sessions.some(
                    (s) => s.kind === "plugin" && !debugManager.isPendingBreakOnStart(s.clientSessionId),
                ),
            service.onSessionStarted,
            service.onSessionEnded,
            vscode.debug.onDidStartDebugSession,
            vscode.debug.onDidTerminateDebugSession,
        ),
    );

    // Compact-view toggle (view/title): two mutually-exclusive icon buttons
    // gated by the "uxp.compactView" context key, both driving the same
    // global, persisted setting.
    const setCompactViewContext = (value: boolean) =>
        vscode.commands.executeCommand("setContext", "uxp.compactView", value);
    void setCompactViewContext(pluginRegistry.snapshot.compactView);
    register("uxp.enableCompactView", async () => {
        await pluginRegistry.setCompactView(true);
        await setCompactViewContext(true);
    });
    register("uxp.disableCompactView", async () => {
        await pluginRegistry.setCompactView(false);
        await setCompactViewContext(false);
    });

    register("uxp._exp_hostAppMethods", () => expHostAppMethodsCommand(service, output));

    // Start/Stop UXP Debugger (view/title icon pair + Command Palette), same
    // two-command-plus-context-key pattern as the compact-view toggle above.
    context.subscriptions.push(
        ...watchBoolContext(
            "uxp.debuggerRunning",
            () => service.brokerState === "running",
            service.onBrokerStateChanged,
        ),
    );
    register("uxp.startDebugger", () => service.ensureStarted());
    register("uxp.stopDebugger", () => service.stopDiscovery());

    // ---- Debug configuration providers --------------------------------------

    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider(
            "uxp",
            new UxpDebugConfigProvider(output),
        ),
        vscode.debug.registerDebugConfigurationProvider(
            "uxp-script",
            new UxpScriptDebugConfigProvider(output),
        ),
    );

    return { service, debugManager, proxyRegistry, pluginRegistry, watchManager, tools };
}

export function deactivate(): void {
    // Disposal of subscriptions (incl. UxpService → broker.stop() → Vulcan
    // withdraw) is handled by VS Code via context.subscriptions.
}
