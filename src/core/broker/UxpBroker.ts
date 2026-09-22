/**
 * The UDT-compatible broker: an HTTP + WebSocket server on 127.0.0.1 that
 * Adobe host applications connect to (after a Vulcan port announcement), plus
 * the per-plugin CDT tunnel endpoint used by the debugger.
 *
 * Endpoints (UXP-DEBUGGER-ARCHITECTURE.md §3):
 *  - WS `/socket/cdt/<clientSessionId>` → DevTools frontend tunnel
 *  - WS anything else (host apps use `/socket/app`) → {@link AppConnection}
 *  - HTTP `GET /json/version` → static CDP bootstrap JSON (compatibility only)
 *
 * Pure Node — no `vscode` imports. All UI concerns live in the vscode layer.
 */

import * as http from "http";
import type { Duplex } from "stream";
import { WebSocketServer } from "ws";
import { TypedEvent } from "../events";
import {
    HostReplyError,
    PortInUseError,
    RequestTimeoutError,
    SandboxedHostError,
    SessionNotFoundError,
    ValidationRejectedError,
} from "../errors";
import type { IPortAnnouncer } from "../vulcan/IPortAnnouncer";
import { type AppInfo, CDT_SOCKET_PREFIX, type UxpPluginManifest } from "../protocol/types";
import { AppConnection, DEFAULT_TIMEOUTS, type HostLogEvent, type TimeoutConfig } from "./AppConnection";
import { CdtTunnelManager } from "./CdtTunnel";
import { BROKER_SERVICE_MARKER, type BrokerIdentity, IDENTIFY_PATH } from "./identify";
import { type PluginSession, SessionRegistry } from "./SessionRegistry";
import { TAKEOVER_PATH } from "./takeover";

export interface ConnectedApp {
    /** Broker-assigned id of the app connection. */
    connectionId: number;
    info: AppInfo;
}

export interface UxpBrokerOptions {
    announcer: IPortAnnouncer;
    log?: (message: string) => void;
    /** Override protocol timeouts (tests). Defaults to Adobe's constants. */
    timeouts?: TimeoutConfig;
    /**
   * Send `Plugin/validate` before `Plugin/load` (Adobe UDT behaviour).
   * Defaults to `true`. The vscode layer disables this: no observed host
   * answers validate, so skipping it removes a pointless 3 s pause per
   * load (LIFECYCLE-NOTES.md).
   */
    validateBeforeLoad?: boolean;
    /**
   * Minimum time (ms) between an app's `App/info` handshake completing and
   * the first `Plugin/*` request sent to it. Defaults to
   * {@link DEFAULT_APP_SETTLE_MS}; tests pass 0.
   *
   * Defence-in-depth: hosts that connect mid-session are still
   * initialising their devtools layer right after the handshake; Adobe's
   * UDT never sends plugin ops that early because a human clicks "Load".
   * (Not the root cause of the 2026-07 wedge — that was the double
   * announcement, see LIFECYCLE-NOTES.md — but kept as a cheap guard.)
   */
    appSettleMs?: number;
    /** Reported on {@link IDENTIFY_PATH}; used by other windows to recognise our own broker. */
    extensionVersion?: string;
    /**
   * Awaited before the broker stops itself in response to a takeover
    * request (MULTI-WINDOW-TAKEOVER.md §4.1). `UxpBroker` stays
   * vscode-agnostic, so it doesn't know how to gracefully stop a delegated
   * `pwa-node` debug session itself — the vscode layer injects that here.
   */
    onBeforeTakeoverStop?: () => Promise<void>;
    /**
   * Extra HTTP route handler consulted for any request whose path isn't one
   * of the broker's own internal routes (takeover/identify/json-version) —
   * lets the vscode layer plug build-tool REST hooks (refresh/reload/load/
   * unload/watch/pack, see `src/vscode/hooks/`) onto the SAME port instead
   * of opening a second server. Must return synchronously: `true` means "I'm
   * handling this request myself (asynchronously)", `false` means "not mine,
   * fall through to the broker's default response". Kept as a plain function
   * so `UxpBroker` itself stays vscode-free (core layer rule).
   */
    extraRequestHandler?: (req: http.IncomingMessage, res: http.ServerResponse, url: string) => boolean;
}

/**
 * Default settle window before the first plugin op on a fresh connection.
 * */
export const DEFAULT_APP_SETTLE_MS = 500;

export class UxpBroker {
    readonly onAppConnected = new TypedEvent<ConnectedApp>();
    readonly onAppDisconnected = new TypedEvent<ConnectedApp>();
    readonly onSessionEnded = new TypedEvent<PluginSession>();
    readonly onHostLog = new TypedEvent<HostLogEvent>();
    /** Fired after the broker has fully stopped in response to a takeover request. */
    readonly onTakenOver = new TypedEvent<void>();

    private readonly announcer: IPortAnnouncer;
    private readonly log: (message: string) => void;
    private readonly timeouts: TimeoutConfig;
    private readonly validateBeforeLoad: boolean;
    private readonly appSettleMs: number;
    private readonly extensionVersion: string;
    private readonly onBeforeTakeoverStop: (() => Promise<void>) | undefined;
    private readonly extraRequestHandler:
    | ((req: http.IncomingMessage, res: http.ServerResponse, url: string) => boolean)
    | undefined;

    private readonly sessions = new SessionRegistry();
    private readonly tunnels: CdtTunnelManager;
    private readonly connections = new Map<number, AppConnection>();
    private nextConnectionId = 1;

    private httpServer: http.Server | undefined;
    private wss: WebSocketServer | undefined;
    private port_: number | undefined;
    /** In-flight `stop()` — `start()` must wait it out or it EADDRINUSEs on our own dying server. */
    private stopInFlight: Promise<void> | undefined;

    constructor(options: UxpBrokerOptions) {
        this.announcer = options.announcer;
        this.log = options.log ?? (() => undefined);
        this.timeouts = options.timeouts ?? DEFAULT_TIMEOUTS;
        this.validateBeforeLoad = options.validateBeforeLoad ?? true;
        this.appSettleMs = options.appSettleMs ?? DEFAULT_APP_SETTLE_MS;
        this.extensionVersion = options.extensionVersion ?? "0.0.0";
        this.onBeforeTakeoverStop = options.onBeforeTakeoverStop;
        this.extraRequestHandler = options.extraRequestHandler;
        this.tunnels = new CdtTunnelManager(this.log);
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    get isRunning(): boolean {
        return this.httpServer !== undefined;
    }

    get port(): number | undefined {
        return this.port_;
    }

    /**
   * Start listening on `127.0.0.1:<port>` (`port` 0 → OS-assigned, for tests)
   * and announce the port over Vulcan. Resolves with the actual port.
   * @throws {PortInUseError} when the port is occupied.
   */
    async start(port: number): Promise<number> {
        // A quick restart (e.g. takeover back) can race the previous stop's
        // async `server.close()` — wait it out instead of failing on our own
        // dying server still holding the port.
        if (this.stopInFlight) {
            await this.stopInFlight;
        }
        if (this.httpServer) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return this.port_!;
        }

        const server = http.createServer((req, res) => {
            this.handleHttpRequest(req, res);
        });
        const wss = new WebSocketServer({ noServer: true });
        server.on("upgrade", (req, socket, head) => {
            this.handleUpgrade(wss, req, socket, head);
        });

        await new Promise<void>((resolve, reject) => {
            const onError = (err: NodeJS.ErrnoException) => {
                server.close();
                reject(err.code === "EADDRINUSE" ? new PortInUseError(port) : err);
            };
            server.once("error", onError);
            server.listen(port, "127.0.0.1", () => {
                server.removeListener("error", onError);
                resolve();
            });
        });

        const address = server.address();
        this.port_ = typeof address === "object" && address ? address.port : port;
        this.httpServer = server;
        this.wss = wss;
        this.log(`broker listening on ws://127.0.0.1:${String(this.port_)}`);

        this.announcer.announce(this.port_);
        return this.port_;
    }

    /** Re-broadcast the Vulcan announcement (used before "app not running" errors). */
    reannounce(): void {
        if (this.port_ !== undefined) {
            this.announcer.announce(this.port_);
        }
    }

    /**
   * Withdraw the announcement, close all sockets, stop listening.
   *
   * Deliberately does NOT call `announcer.dispose()` — the broker may be
   * restarted in the same process later (e.g. re-taking ownership after a
    * takeover, see MULTI-WINDOW-TAKEOVER.md), and the real
   * (`VulcanAnnouncer`) implementation wraps a native addon object that is
   * NOT safe to tear down and re-instantiate more than once per process —
   * doing so crashed the host extension outright (verified live
   * 2026-07-30: 2nd takeover-back in the same window). Disposal is the
   * announcer owner's responsibility (`UxpService.dispose()`), called
   * exactly once, at real extension deactivation.
   */
    async stop(): Promise<void> {
        if (this.stopInFlight) {
            return this.stopInFlight;
        }
        if (!this.httpServer) {
            return;
        }
        const stopping = this.doStop().finally(() => {
            this.stopInFlight = undefined;
        });
        this.stopInFlight = stopping;
        return stopping;
    }

    private async doStop(): Promise<void> {
        const server = this.httpServer;
        if (!server) {
            return;
        }
        this.httpServer = undefined;

        try {
            if (this.port_ !== undefined) {
                this.announcer.withdraw(this.port_);
            }
        }
        catch (err) {
            this.log(`announcer withdraw failed: ${String(err instanceof Error ? err.message : err)}`);
        }

        this.tunnels.closeAll();
        for (const connection of [...this.connections.values()]) {
            connection.close();
        }
        this.connections.clear();
        this.wss?.close();
        this.wss = undefined;

        await new Promise<void>((resolve) => server.close(() => {
            resolve();
        }));
        this.port_ = undefined;
        this.log("broker stopped");
    }

    // -------------------------------------------------------------------------
    // Public state
    // -------------------------------------------------------------------------

    /** Snapshot of host apps that completed the `App/info` handshake. */
    get connectedApps(): ConnectedApp[] {
        const apps: ConnectedApp[] = [];
        for (const connection of this.connections.values()) {
            if (connection.appInfo) {
                apps.push({ connectionId: connection.id, info: connection.appInfo });
            }
        }
        return apps;
    }

    /** Snapshot of live plugin/script sessions. */
    get liveSessions(): PluginSession[] {
        return this.sessions.list();
    }

    sessionsForManifest(manifestPath: string): PluginSession[] {
        return this.sessions.forManifest(manifestPath);
    }

    /** WebSocket path of the CDT endpoint for a session. */
    cdtPath(clientSessionId: string): string {
        return `${CDT_SOCKET_PREFIX}${clientSessionId}`;
    }

    // -------------------------------------------------------------------------
    // Plugin operations (single app; fan-out lives in the vscode layer)
    // -------------------------------------------------------------------------

    /**
   * Validate (host-side, best-effort) and load a plugin into one connected app.
   * Returns the registered session.
   *
   * Validation is authoritative only when the host actually answers it:
   * an explicit `success: false` fails the load, but newer hosts (e.g.
   * Photoshop 27 / UXP 9.4) ignore `Plugin/validate` entirely — Adobe's own
   * service sends it without a timeout — so a timeout or an error reply is
   * logged and the load proceeds (`Plugin/load` reports real failures itself).
   */
    async loadPlugin(
        connectionId: number,
        pluginPath: string,
        manifestPath: string,
        manifest: UxpPluginManifest,
        breakOnStart = false,
    ): Promise<PluginSession> {
        const connection = this.requireConnection(connectionId);
        this.rejectSandboxedHost(connection);
        await this.waitForAppSettle(connection);

        if (this.validateBeforeLoad) {
            try {
                const validation = await connection.validatePlugin(pluginPath, manifest);
                if (validation.success === false) {
                    throw new ValidationRejectedError(
                        typeof validation.errorMessage === "string"
                            ? validation.errorMessage
                            : "no reason given",
                    );
                }
            }
            catch (err) {
                if (err instanceof ValidationRejectedError) {
                    throw err;
                }
                if (err instanceof RequestTimeoutError) {
                    this.log(
                        "Plugin/validate was not answered by the host — proceeding with load "
                        + "(this host app version likely does not implement validate)",
                    );
                }
                else if (err instanceof HostReplyError) {
                    this.log(`Plugin/validate replied with an error — proceeding with load (${err.hostError})`);
                }
                else {
                    throw err;
                }
            }
        }

        const hostSessionId = await connection.loadPlugin(pluginPath, breakOnStart);
        return this.sessions.add({
            hostSessionId,
            kind: "plugin",
            pluginId: manifest.id,
            name: manifest.name,
            pluginPath,
            manifestPath,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            app: connection.appInfo!,
            appConnectionId: connection.id,
        });
    }

    async reloadPlugin(clientSessionId: string): Promise<void> {
        const session = this.requireSession(clientSessionId);
        const connection = this.requireConnection(session.appConnectionId);
        const reply = await connection.reloadPlugin(session.hostSessionId);
        // Some hosts may hand back a fresh host session id on reload; re-bind it
        // under the stable client id so debuggers keep working.
        if (typeof reply.pluginSessionId === "string" && reply.pluginSessionId.length > 0) {
            session.hostSessionId = reply.pluginSessionId;
        }
    }

    async unloadPlugin(clientSessionId: string): Promise<void> {
        const session = this.requireSession(clientSessionId);
        const connection = this.requireConnection(session.appConnectionId);
        await connection.unloadPlugin(session.hostSessionId);
        this.endSession(session, /* notifyApp */ false);
    }

    /** Run a script file (UDT 2.x `Plugin/runScript`) and register a pseudo-session. */
    async runScript(
        connectionId: number,
        scriptDir: string,
        fileName: string,
        userArgs: unknown[],
        sourcePath?: string,
    ): Promise<PluginSession> {
        const connection = this.requireConnection(connectionId);
        this.rejectSandboxedHost(connection);
        await this.waitForAppSettle(connection);

        const hostSessionId = await connection.runScript(scriptDir, fileName, userArgs);
        return this.sessions.add({
            hostSessionId,
            kind: "script",
            pluginId: `__uxpScript:${fileName}`,
            name: fileName,
            pluginPath: scriptDir,
            scriptSourcePath: sourcePath,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            app: connection.appInfo!,
            appConnectionId: connection.id,
        });
    }

    // -------------------------------------------------------------------------
    // HTTP / upgrade routing
    // -------------------------------------------------------------------------

    private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = req.url ?? "/";
        if (req.method === "POST" && url.startsWith(TAKEOVER_PATH)) {
            void this.handleTakeoverRequest(res);
            return;
        }
        if (this.extraRequestHandler?.(req, res, url)) {
            return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        if (url.startsWith(IDENTIFY_PATH)) {
            res.end(JSON.stringify(this.identity()));
            return;
        }
        if (url.startsWith("/json/version")) {
            res.end(
                JSON.stringify({
                    Browser: "Adobe UXP/1.0.0",
                    "Protocol-Version": "1.3",
                }),
            );
            return;
        }
        res.end("{}");
    }

    private identity(): BrokerIdentity {
        return { service: BROKER_SERVICE_MARKER, extensionVersion: this.extensionVersion, pid: process.pid };
    }

    /**
   * Tear the broker down in response to another window's takeover request,
   * then reply 200 OK only once the requester can safely bind the port.
   *
   * `stop()` runs synchronously (announcer withdraw, tunnels/connections
   * closed, `server.close()` invoked — which stops accepting new
   * connections and frees the port immediately) right up until it has to
   * await this very HTTP connection finishing. So calling `stop()` without
   * awaiting it first, THEN sending the response, lets the port-freeing
   * side effects happen before the response goes out, without deadlocking
   * on the connection that response itself is sent over. `Connection:
   * close` makes sure this response's socket doesn't linger keep-alive,
   * so `stop()`'s own `server.close()` callback resolves promptly too.
   */
    private async handleTakeoverRequest(res: http.ServerResponse): Promise<void> {
        this.log("takeover requested by another window — stopping");
        await this.onBeforeTakeoverStop?.();
        const stopped = this.stop();
        res.writeHead(200, { "Content-Type": "application/json", Connection: "close" });
        res.end(JSON.stringify({ ok: true }));
        await stopped;
        this.onTakenOver.emit();
    }

    private handleUpgrade(
        wss: WebSocketServer,
        req: http.IncomingMessage,
        socket: Duplex,
        head: Buffer,
    ): void {
        const url = req.url ?? "/";

        if (url.startsWith(CDT_SOCKET_PREFIX)) {
            const clientSessionId = url.slice(CDT_SOCKET_PREFIX.length).split("?")[0];
            const session = this.sessions.byClientId(clientSessionId);
            const connection = session ? this.connections.get(session.appConnectionId) : undefined;
            if (!session || !connection) {
                this.log(`cdt: rejected frontend for unknown session "${clientSessionId}"`);
                socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
                socket.destroy();
                return;
            }
            wss.handleUpgrade(req, socket, head, (ws) => {
                this.tunnels.attach(ws, session, connection);
            });
            return;
        }

        // Any other path is a host application (they use /socket/app).
        wss.handleUpgrade(req, socket, head, (ws) => {
            this.registerAppConnection(
                new AppConnection(this.nextConnectionId++, ws, this.log, this.timeouts),
            );
        });
    }

    // -------------------------------------------------------------------------
    // App connection wiring
    // -------------------------------------------------------------------------

    private registerAppConnection(connection: AppConnection): void {
        this.connections.set(connection.id, connection);
        this.log(`app connection #${String(connection.id)} opened`);

        connection.onReady.on((info) => {
            this.onAppConnected.emit({ connectionId: connection.id, info });
        });

        connection.onPluginUnloaded.on((hostSessionId) => {
            const session = this.sessions.byHostId(connection.id, hostSessionId);
            if (session) {
                this.endSession(session, /* notifyApp */ false);
            }
        });

        connection.onHostLog.on((event) => {
            this.onHostLog.emit(event);
        });

        connection.onClose.on(() => {
            this.connections.delete(connection.id);
            for (const session of this.sessions.removeAllForApp(connection.id)) {
                this.tunnels.closeForSession(session.clientSessionId, false);
                this.onSessionEnded.emit(session);
            }
            if (connection.appInfo) {
                this.onAppDisconnected.emit({
                    connectionId: connection.id,
                    info: connection.appInfo,
                });
            }
            this.log(`app connection #${String(connection.id)} closed`);
        });
    }

    private endSession(session: PluginSession, notifyApp: boolean): void {
        this.sessions.remove(session.clientSessionId);
        this.tunnels.closeForSession(session.clientSessionId, notifyApp);
        this.onSessionEnded.emit(session);
    }

    private requireConnection(connectionId: number): AppConnection {
        const connection = this.connections.get(connectionId);
        if (!connection?.appInfo) {
            throw new SessionNotFoundError(`app-connection-${String(connectionId)}`);
        }
        return connection;
    }

    private requireSession(clientSessionId: string): PluginSession {
        const session = this.sessions.byClientId(clientSessionId);
        if (!session) {
            throw new SessionNotFoundError(clientSessionId);
        }
        return session;
    }

    private rejectSandboxedHost(connection: AppConnection): void {
        if (connection.appInfo?.sandbox) {
            throw new SandboxedHostError(connection.appInfo.appName);
        }
    }

    /**
   * Wait out the remainder of the settle window on a freshly-connected app
   * before the first plugin operation (see {@link UxpBrokerOptions.appSettleMs}).
   */
    private async waitForAppSettle(connection: AppConnection): Promise<void> {
        if (connection.readyAtMs === undefined) {
            return;
        }
        const remaining = this.appSettleMs - (Date.now() - connection.readyAtMs);
        if (remaining > 0) {
            this.log(
                `waiting ${String(remaining)} ms for ${connection.appInfo?.appId ?? "app"} to finish `
                + "initialising its devtools layer (connected moments ago)",
            );
            await new Promise((resolve) => setTimeout(resolve, remaining));
        }
    }
}
