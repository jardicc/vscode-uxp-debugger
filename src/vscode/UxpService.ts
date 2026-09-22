/**
 * The single seam between the VS Code layer and the core broker
 * (UXP-DEBUGGER-ARCHITECTURE.md §1.2). Owns broker lifecycle, performs the dev-mode
 * pre-check, resolves plugin operations to one selected app, and adapts core
 * events to `vscode.EventEmitter`s.
 *
 * Commands depend on this class only, which keeps command flows trivially
 * mockable in tests.
 */

import * as fs from "fs";
import type * as http from "http";
import * as path from "path";
import * as vscode from "vscode";
import { type ConnectedApp, UxpBroker } from "../core/broker/UxpBroker";
import type { PluginSession } from "../core/broker/SessionRegistry";
import type { HostLogEvent } from "../core/broker/AppConnection";
import { probeBrokerIdentity, type BrokerIdentity } from "../core/broker/identify";
import { requestTakeover } from "../core/broker/takeover";
import { HostAppNotRunningError, MultipleAppsMatchError, PortInUseError, UxpError } from "../core/errors";
import { matchApps, requiredAppIds } from "../core/manifest/appMatching";
import { parseManifestContent, type ParsedManifest } from "../core/manifest/manifest";
import { isDevModeEnabled } from "../core/devmode/devMode";
import { DEFAULT_BROKER_PORT } from "../core/protocol/types";
import type { HostAppDescriptor } from "../core/vulcan/hostAppCatalog";
import type { IHostAppController, LaunchResult } from "../core/vulcan/IHostAppController";
import { VulcanAnnouncer } from "../core/vulcan/VulcanAnnouncer";
import { VulcanHostAppController } from "../core/vulcan/VulcanHostAppController";
import { ensureDevModeInteractive } from "./commands/enableDevMode";
import { portInUseDialog, takeoverConfirmDialog } from "./ui/dialogs";

/** Thrown when the user dismisses a required dialog — commands abort silently. */
export class OperationCancelledError extends Error {
    constructor() {
        super("Operation cancelled by the user.");
        this.name = "OperationCancelledError";
    }
}

/** Result of a fan-out load: at least one success, or the call throws. */
export interface LoadResult {
    sessions: PluginSession[];
    failures: { app: ConnectedApp; error: Error }[];
}

/**
 * See `UxpBrokerOptions.extraRequestHandler` — same shape, re-exported so `extension.ts`/`hooks/`
 * don't import `UxpBroker` just for the type.
 */
export type HookRequestHandler = (req: http.IncomingMessage, res: http.ServerResponse, url: string) => boolean;

/** How long to wait for host apps reacting to the start-up announcement. */
const INITIAL_CONNECT_WAIT_MS = 500;
/** How long to wait for host apps after a re-announcement before failing. */
const REANNOUNCE_WAIT_MS = 500;
/** Poll interval while waiting for host apps to connect. */
const APP_POLL_INTERVAL_MS = 100;

export class UxpService implements vscode.Disposable {
    private broker: UxpBroker | undefined;
    private starting: Promise<void> | undefined;
    /**
   * Created once, lazily, and reused for every broker restart in this
   * window's process (incl. re-taking ownership after a takeover) — the
   * native Vulcan adapter it wraps is NOT safe to tear down and
   * re-instantiate more than once per process (crashes the extension host,
   * verified live 2026-07-30). Only ever disposed once, in {@link dispose}.
   */
    private announcer: VulcanAnnouncer | undefined;
    /**
   * Same one-instance-per-process rule as {@link announcer}, for the
   * separate native `VulcanControlAdapter` (host-app launch, dev-only
   * `_launchHostApp` command). Created lazily on first use.
   */
    private hostAppController: IHostAppController | undefined;
    /**
   * Called before the broker stops itself in response to a takeover request
   * from another VS Code window. Set once from `extension.ts` (which owns
   * the `UxpDebugSessionManager` instance) — see
   * {@link setBeforeTakeoverStopHook}.
   */
    private beforeTakeoverStopHook: (() => Promise<void>) | undefined;
    /**
   * Extra HTTP route handler for build-tool REST hooks (`src/vscode/hooks/`),
   * threaded into every `UxpBroker` instance this service creates so hooks
   * share the broker's existing port instead of opening a second server.
   * Set once from `extension.ts` (after the hooks' own dependencies exist),
   * before the first `ensureStarted()` call.
   */
    private hookRequestHandler: HookRequestHandler | undefined;

    private readonly appsChangedEmitter = new vscode.EventEmitter<void>();
    private readonly sessionStartedEmitter = new vscode.EventEmitter<PluginSession>();
    private readonly sessionEndedEmitter = new vscode.EventEmitter<PluginSession>();
    private readonly hostLogEmitter = new vscode.EventEmitter<HostLogEvent>();
    private readonly brokerStateChangedEmitter = new vscode.EventEmitter<void>();
    /** `true` after another VS Code window took broker ownership from us. */
    private takenOver = false;
    /** `true` after an explicit "Stop UXP Debugger" until the broker starts again. */
    private stoppedByUser = false;
    /**
   * Pre-broker lifecycle phase, only meaningful while `broker` is undefined
    * and we're not `takenOver` (APP-DISCOVERY.md §2). Driven by
   * {@link startDiscoverySilently} (activation, never prompts) and by
   * `ensureStarted()` (interactive commands, unchanged).
   */
    private lifecyclePhase: "idle" | "starting" | "devModeRequired" | "error" = "idle";
    /** Set alongside `lifecyclePhase === "error"`; shown verbatim in the panel. */
    private lifecycleError: string | undefined;

    /** Fired when a host app connects or disconnects. */
    readonly onAppsChanged = this.appsChangedEmitter.event;
    /** Fired when a plugin/script session is created (load / runScript). */
    readonly onSessionStarted = this.sessionStartedEmitter.event;
    /** Fired when a plugin/script session ends for any reason. */
    readonly onSessionEnded = this.sessionEndedEmitter.event;
    /** Fired for every host-app log line. */
    readonly onHostLog = this.hostLogEmitter.event;
    /** Fired when the broker starts or ownership moves to another window. */
    readonly onBrokerStateChanged = this.brokerStateChangedEmitter.event;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly output: vscode.OutputChannel,
    ) {}

    /**
   * Wire the hook run before the broker tears itself down in response to a
   * takeover request (must stop any active debug sessions first — see
    * MULTI-WINDOW-TAKEOVER.md §4.4). Call once, before `ensureStarted()`
   * ever runs.
   */
    setBeforeTakeoverStopHook(hook: () => Promise<void>): void {
        this.beforeTakeoverStopHook = hook;
    }

    /** See {@link hookRequestHandler}. Call once, before `ensureStarted()` ever runs. */
    setHookRequestHandler(handler: HookRequestHandler): void {
        this.hookRequestHandler = handler;
    }

    // -------------------------------------------------------------------------
    // State snapshots
    // -------------------------------------------------------------------------

    get connectedApps(): ConnectedApp[] {
        return this.broker?.connectedApps ?? [];
    }

    /** Current broker ownership state for UI surfaces (control panel). */
    get brokerState():
        | "stopped"
        | "starting"
        | "devModeRequired"
        | "running"
        | "ownedElsewhere"
        | "stoppedByUser"
        | "error" {
        if (this.broker?.isRunning) {
            return "running";
        }
        if (this.takenOver) {
            return "ownedElsewhere";
        }
        if (this.stoppedByUser) {
            return "stoppedByUser";
        }
        return this.lifecyclePhase === "idle" ? "stopped" : this.lifecyclePhase;
    }

    /** Message for the `error` broker state, if any (APP-DISCOVERY.md §2). */
    get brokerError(): string | undefined {
        return this.lifecyclePhase === "error" ? this.lifecycleError : undefined;
    }

    get sessions(): PluginSession[] {
        return this.broker?.liveSessions ?? [];
    }

    sessionsForManifest(manifestPath: string): PluginSession[] {
        return this.broker?.sessionsForManifest(path.normalize(manifestPath)) ?? [];
    }

    /** ws:// URL of the CDT endpoint for a session (input for the CDP proxy). */
    cdtUrlFor(session: PluginSession): string {
        const broker = this.requireBroker();
        return `ws://127.0.0.1:${broker.port}${broker.cdtPath(session.clientSessionId)}`;
    }

    /**
   * Lazy singleton (see the field doc above) — used directly by the
   * `_exp_` experimental commands and by {@link launchHostApp}.
   */
    getHostAppController(): IHostAppController {
        if (!this.hostAppController) {
            const nativeRoot = path.join(this.context.extensionPath, "native");
            const log = (message: string) => {
                this.output.appendLine(`[hostapp] ${message}`);
            };
            this.hostAppController = new VulcanHostAppController(nativeRoot, log);
        }
        return this.hostAppController;
    }

    /** Launch a host application via Adobe Vulcan. */
    async launchHostApp(app: HostAppDescriptor): Promise<LaunchResult> {
        return this.getHostAppController().launch(app);
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /**
   * Start the broker lazily (idempotent, re-entrant). Handles the dev-mode
   * consent flow and the port-in-use retry dialog.
   * @throws {OperationCancelledError} when the user declines a required step.
   */
    async ensureStarted(): Promise<void> {
    // Let any in-flight silent auto-start (see `startDiscoverySilently`)
    // settle first so we don't race it into starting the broker twice.
        if (this.starting) {
            await this.starting;
        }
        if (this.broker?.isRunning) {
            return;
        }
        this.starting ??= this.startBroker().finally(() => {
            this.starting = undefined;
        });
        return this.starting;
    }

    /**
   * Non-interactive discovery start for extension activation
    * (APP-DISCOVERY.md §1). Never shows the dev-mode consent/elevation
   * dialog or any error dialog — failures only update `brokerState`/
   * `brokerError` for the panel to render. Safe to call whenever; no-op once
   * the broker is running, taken over, or already starting.
   */
    async startDiscoverySilently(): Promise<void> {
        if (this.broker?.isRunning || this.starting || this.takenOver) {
            return;
        }
        if (!isDevModeEnabled()) {
            this.lifecyclePhase = "devModeRequired";
            this.brokerStateChangedEmitter.fire();
            return;
        }
        this.starting = this.startBrokerSilently().finally(() => {
            this.starting = undefined;
        });
        return this.starting;
    }

    /**
   * Shared broker construction (announcer/log/options) for both the
   * interactive and silent start paths.
   */
    private createBrokerInstance(): UxpBroker {
        const nativeRoot = path.join(this.context.extensionPath, "native");
        const log = (message: string) => {
            this.output.appendLine(`[broker] ${message}`);
        };
        this.announcer ??= new VulcanAnnouncer(nativeRoot, log);
        // VS Code exposes extension package metadata as `any`.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const extensionVersion = String(this.context.extension.packageJSON.version ?? "0.0.0");
        // validateBeforeLoad:false — no observed host answers Plugin/validate;
        // skipping it saves a pointless 3 s pause per load (LIFECYCLE-NOTES.md).
        return new UxpBroker({
            announcer: this.announcer,
            log,
            validateBeforeLoad: false,
            extensionVersion,
            onBeforeTakeoverStop: this.beforeTakeoverStopHook,
            extraRequestHandler: this.hookRequestHandler,
        });
    }

    /** Wire adapter events → `vscode.EventEmitter`s, shared by both start paths. */
    private wireBrokerEvents(broker: UxpBroker): void {
        broker.onTakenOver.on(() => {
            this.takenOver = true;
            this.brokerStateChangedEmitter.fire();
            void vscode.window.showInformationMessage(
                "UXP Debugger was taken over by another VS Code window.",
            );
        });
        broker.onAppConnected.on((app) => {
            this.output.appendLine(
                `Host app connected: ${app.info.appName} ${app.info.appVersion}`,
            );
            this.appsChangedEmitter.fire();
        });
        broker.onAppDisconnected.on((app) => {
            this.output.appendLine(
                `Host app disconnected: ${app.info.appName} ${app.info.appVersion}`,
            );
            this.appsChangedEmitter.fire();
        });
        broker.onSessionEnded.on((session) => {
            this.sessionEndedEmitter.fire(session);
        });
        broker.onHostLog.on((event) => {
            this.hostLogEmitter.fire(event);
        });
    }

    private async startBroker(): Promise<void> {
    // 1. Developer-mode flag (direct file read; elevation only on consent).
        if (!isDevModeEnabled()) {
            const enabled = await ensureDevModeInteractive(this.context, this.output);
            if (!enabled) {
                throw new OperationCancelledError();
            }
        }

        // 2. Broker + Vulcan announcer (reuse the one native adapter for this
        // process's whole lifetime — see the `announcer` field doc above).
        const broker = this.createBrokerInstance();

        for (;;) {
            try {
                await broker.start(DEFAULT_BROKER_PORT);
                break;
            }
            catch (err) {
                if (err instanceof PortInUseError) {
                    // Distinguish our own broker (another VS Code window) from an
                    // unrelated occupant (typically Adobe UDT) before blaming Adobe.
                    const identity = await probeBrokerIdentity(err.port);
                    if (identity) {
                        if (await this.tryTakeover(identity, err.port)) {
                            continue;
                        }
                        throw new OperationCancelledError();
                    }
                    const retry = await portInUseDialog(err.port);
                    if (retry) {
                        continue;
                    }
                    throw new OperationCancelledError();
                }
                throw err;
            }
        }

        this.wireBrokerEvents(broker);
        this.broker = broker;
        this.takenOver = false;
        this.stoppedByUser = false;
        this.lifecyclePhase = "idle";
        this.brokerStateChangedEmitter.fire();
    }

    /**
   * Silent counterpart of {@link startBroker}: same port-in-use handling
   * minus any dialog — a foreign occupant becomes the `error` state instead
   * of a retry prompt, and an owning sibling window becomes `ownedElsewhere`
   * without offering takeover (manual takeover stays available as before).
   */
    private async startBrokerSilently(): Promise<void> {
        this.lifecyclePhase = "starting";
        this.lifecycleError = undefined;
        this.brokerStateChangedEmitter.fire();

        const broker = this.createBrokerInstance();
        try {
            await broker.start(DEFAULT_BROKER_PORT);
        }
        catch (err) {
            if (err instanceof PortInUseError) {
                const identity = await probeBrokerIdentity(err.port);
                if (identity) {
                    this.takenOver = true;
                    this.lifecyclePhase = "idle";
                    this.brokerStateChangedEmitter.fire();
                    return;
                }
                this.lifecycleError = err.message;
            }
            else {
                this.lifecycleError = err instanceof Error ? err.message : String(err);
            }
            this.output.appendLine(`[broker] auto-start failed: ${this.lifecycleError}`);
            this.lifecyclePhase = "error";
            this.brokerStateChangedEmitter.fire();
            return;
        }

        this.wireBrokerEvents(broker);
        this.broker = broker;
        this.takenOver = false;
        this.stoppedByUser = false;
        this.lifecyclePhase = "idle";
        this.brokerStateChangedEmitter.fire();
    }

    /**
   * Offer to take over the broker owned by another VS Code window
    * (MULTI-WINDOW-TAKEOVER.md). Returns `true` when the takeover
   * succeeded and the caller should retry `broker.start()`.
   */
    private async tryTakeover(identity: BrokerIdentity, port: number): Promise<boolean> {
        if (!(await takeoverConfirmDialog(identity, port))) {
            return false;
        }
        if (await requestTakeover(port)) {
            return true;
        }
        // The other window didn't respond in time — fall back to the ordinary
        // "port in use" wording (e.g. it may have already been closed manually).
        return portInUseDialog(port);
    }

    /**
   * Takeover initiated from the panel's blocking overlay (`ownedElsewhere`)
   * — the overlay's own text/button IS the confirmation, so unlike
   * {@link ensureStarted}'s interactive path (still used by non-panel entry
   * points such as the Command Palette or an F5 attach), this skips
   * `takeoverConfirmDialog` entirely. Idempotent/re-entrant like
   * {@link ensureStarted}.
   */
    async takeOverFromPanel(): Promise<void> {
        if (this.starting) {
            await this.starting;
        }
        if (!this.takenOver) {
            return;
        }
        this.starting = this.doTakeOverFromPanel().finally(() => {
            this.starting = undefined;
        });
        return this.starting;
    }

    private async doTakeOverFromPanel(): Promise<void> {
    // Ignore the result: either way, the right next step is "try to start".
    // Success frees the port immediately; a failed/timed-out request most
    // likely means the other window already closed on its own (port free
    // too) — and `startBrokerSilently()` re-derives `ownedElsewhere`/`error`
    // correctly from whatever actually happens on the real `broker.start()`
    // attempt, so there's nothing extra to branch on here.
        await requestTakeover(DEFAULT_BROKER_PORT);
        await this.startBrokerSilently();
    }

    /**
   * Explicit "Stop UXP Debugger" (command/icon). Runs the same teardown as
   * the takeover hook (stop debug sessions, close inspectors/proxies) then
   * stops the broker — but, like {@link stopBrokerForTest}, does NOT dispose
   * the Vulcan announcer, so a later start in this window reuses the one
   * native adapter instance for this process (see the `announcer` field doc
   * above). No-op if the broker isn't running locally (e.g. already owned
   * elsewhere — there is nothing here to stop).
   */
    async stopDiscovery(): Promise<void> {
        if (this.starting) {
            await this.starting;
        }
        if (!this.broker?.isRunning) {
            return;
        }
        await this.beforeTakeoverStopHook?.();
        const broker = this.broker;
        this.broker = undefined;
        await broker.stop();
        this.takenOver = false;
        this.stoppedByUser = true;
        this.lifecyclePhase = "idle";
        this.brokerStateChangedEmitter.fire();
    }

    /**
   * e2e-only: stop the broker (release the port) WITHOUT disposing the
   * Vulcan announcer, so a later `ensureStarted()` call in the same test
   * run can cleanly restart it — unlike {@link dispose}, which permanently
   * tears the native adapter down. Lets tests simulate "something else is
   * squatting on port 14001" by freeing it up first.
   */
    async stopBrokerForTest(): Promise<void> {
        const broker = this.broker;
        this.broker = undefined;
        await broker?.stop();
    }

    // -------------------------------------------------------------------------
    // Plugin operations
    // -------------------------------------------------------------------------

    /** Parse + pre-validate a manifest file from disk. */
    readManifest(manifestPath: string): ParsedManifest {
        const content = fs.readFileSync(manifestPath, "utf-8");
        return parseManifestContent(content, manifestPath);
    }

    /**
   * Load the plugin into a single applicable connected app (validate →
   * load). When more than one connected app matches and `targetAppId` isn't
   * given, throws {@link MultipleAppsMatchError} instead of fanning out to
   * all of them — the caller (command layer) must ask the user which one
   * and retry with that `appId` pinned.
   * @throws {HostAppNotRunningError} when no applicable app is connected, or
   * when `targetAppId` was given but that specific app isn't connected
   * anymore (e.g. it was closed since the last load/reload).
   * @throws {MultipleAppsMatchError} when ≥ 2 apps match and no
   * `targetAppId` was given.
   */
    async loadPlugin(
        manifestPath: string,
        breakOnStart = false,
        targetAppId?: string,
    ): Promise<LoadResult> {
        manifestPath = path.normalize(manifestPath);
        const { manifest, hosts } = this.readManifest(manifestPath);
        await this.ensureStarted();
        const broker = this.requireBroker();

        const matched = await this.applicableAppsWithRetry(hosts);
        if (matched.length === 0) {
            throw new HostAppNotRunningError(requiredAppIds(hosts));
        }

        let apps: ConnectedApp[];
        if (targetAppId !== undefined) {
            apps = matched.filter((app) => app.info.appId === targetAppId);
            if (apps.length === 0) {
                throw new HostAppNotRunningError([targetAppId]);
            }
        }
        else if (matched.length > 1) {
            throw new MultipleAppsMatchError(matched);
        }
        else {
            apps = matched;
        }

        const pluginDir = path.dirname(manifestPath);
        const results = await Promise.allSettled(
            apps.map((app) =>
                broker.loadPlugin(app.connectionId, pluginDir, manifestPath, manifest, breakOnStart),
            ),
        );

        const outcome: LoadResult = { sessions: [], failures: [] };
        results.forEach((result, index) => {
            if (result.status === "fulfilled") {
                outcome.sessions.push(result.value);
            }
            else {
                const reason
                    = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
                outcome.failures.push({ app: apps[index], error: reason });
            }
        });

        if (outcome.sessions.length === 0) {
            // Every app failed — surface the first (usually only) error verbatim.
            throw outcome.failures[0].error;
        }
        for (const session of outcome.sessions) {
            this.sessionStartedEmitter.fire(session);
        }
        return outcome;
    }

    async unloadPlugin(session: PluginSession): Promise<void> {
        await this.requireBroker().unloadPlugin(session.clientSessionId);
    }

    async reloadPlugin(session: PluginSession): Promise<void> {
        await this.requireBroker().reloadPlugin(session.clientSessionId);
    }

    /**
   * Run a script file in one connected app (UDT 2.x `Plugin/runScript`).
   * `sourcePath`, when given, is the original (pre-strip) script path used to
   * match the resulting session back to its registry entry — pass it when
   * `scriptPath` points at a generated temp file (e.g. stripped `.ts`).
   */
    async runScript(
        scriptPath: string,
        app: ConnectedApp,
        userArgs: unknown[],
        sourcePath?: string,
    ): Promise<PluginSession> {
        await this.ensureStarted();
        const broker = this.requireBroker();
        const session = await broker.runScript(
            app.connectionId,
            path.dirname(scriptPath),
            path.basename(scriptPath),
            userArgs,
            sourcePath ?? scriptPath,
        );
        this.sessionStartedEmitter.fire(session);
        return session;
    }

    /**
   * Wait for connected apps matching `hosts` (passively first; one
   * re-announce only as a last resort — see {@link waitForHostApps}) and
   * return them. May return an empty array; the caller shows the
   * "host app not running" error.
   */
    private async applicableAppsWithRetry(
        hosts: Parameters<typeof matchApps>[0],
    ): Promise<ConnectedApp[]> {
        await this.waitForHostApps(() => matchApps(hosts, this.connectedApps).length > 0);
        return matchApps(hosts, this.connectedApps);
    }

    /**
   * Give already-running host apps a chance to connect before the caller
   * shows a "host app not running" error.
   *
   * Order matters: the broker's start-up announcement reaches running apps
   * in under a second, so we first wait **passively**. Only when no app at
   * all has connected do we send one re-announcement and wait again — a
   * second `server.info` arriving while a stable UXP 9.3 host is still
   * reacting to the first wedges its devtools layer (connection stays up,
   * App/info answers, but every Plugin/* request is silently dropped;
   * root cause of the 2026-07 lifecycle bug, see LIFECYCLE-NOTES.md).
   * Re-announcing is a last resort, never a reflex.
   */
    async waitForHostApps(
        hasMatch: () => boolean = () => this.connectedApps.length > 0,
    ): Promise<void> {
        if (hasMatch()) {
            return;
        }
        await this.pollUntil(hasMatch, INITIAL_CONNECT_WAIT_MS);
        if (hasMatch() || this.connectedApps.length > 0) {
            return;
        }
        this.output.appendLine(
            "[broker] no host app reacted to the start-up announcement — re-announcing once",
        );
        this.broker?.reannounce();
        await this.pollUntil(hasMatch, REANNOUNCE_WAIT_MS);
    }

    private async pollUntil(
        condition: () => boolean,
        timeoutMs: number,
    ): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (!condition() && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, APP_POLL_INTERVAL_MS));
        }
    }

    /**
   * Cancellable poll up to `timeoutMs`, returning whether `hasMatch()` came
   * true — used by the "host app not running -> launch it" flow to wait for
   * a freshly-launched app to connect before retrying `loadPlugin()`.
   */
    async waitForConnection(
        hasMatch: () => boolean,
        timeoutMs: number,
        cancelToken?: vscode.CancellationToken,
    ): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (!hasMatch()) {
            if (cancelToken?.isCancellationRequested || Date.now() >= deadline) {
                return hasMatch();
            }
            await new Promise((resolve) => setTimeout(resolve, APP_POLL_INTERVAL_MS));
        }
        return true;
    }

    private requireBroker(): UxpBroker {
        if (!this.broker?.isRunning) {
            throw new UxpError("The UXP broker is not running.");
        }
        return this.broker;
    }

    dispose(): void {
        const broker = this.broker;
        this.broker = undefined;
        void broker?.stop();
        // Real extension deactivation — safe to tear the native adapter down
        // for good now (nothing will restart the broker in this process again).
        this.announcer?.dispose();
        this.announcer = undefined;
        this.hostAppController?.dispose();
        this.hostAppController = undefined;
        this.appsChangedEmitter.dispose();
        this.sessionStartedEmitter.dispose();
        this.sessionEndedEmitter.dispose();
        this.hostLogEmitter.dispose();
        this.brokerStateChangedEmitter.dispose();
    }
}
