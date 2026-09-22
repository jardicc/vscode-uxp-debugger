/**
 * One connected Adobe host application (Photoshop, InDesign, …).
 *
 * Owns the handshake (`ready` → `initRuntimeClient` → `App/info`), the
 * request/reply correlation map with per-operation timeouts, and translates
 * unsolicited app events into typed emitter events.
 *
 * Transport-agnostic: takes anything that looks like a `ws` WebSocket
 * (`SocketLike`), so tests can drive it without network if needed.
 */

import { TypedEvent } from "../events";
import { HostReplyError, RequestTimeoutError } from "../errors";
import {
    asAppMessage,
    buildAppInfoRequest,
    buildCdtState,
    buildCdtTunnelFrame,
    buildPluginLoad,
    buildPluginReload,
    buildPluginRunScript,
    buildPluginUnload,
    buildPluginValidate,
    buildReady,
    parseFrame,
} from "../protocol/messages";
import {
    type AppInfo,
    type BrokerToAppMessage,
    ProtocolTimeouts,
    type ReplyMessage,
    type UxpPluginManifest,
} from "../protocol/types";

/** The subset of the `ws` WebSocket API the connection needs. */
export interface SocketLike {
    send(data: string): void;
    close(): void;
    on(event: "message", listener: (data: unknown) => void): void;
    on(event: "close", listener: () => void): void;
    on(event: "error", listener: (err: Error) => void): void;
}

/** Overridable request timeouts (defaults = Adobe's constants). */
export interface TimeoutConfig {
    pluginOpMs: number;
    appInfoMs: number;
    /**
   * `Plugin/validate` only. Adobe's own service sends validate without any
   * timeout, and newer hosts (e.g. Photoshop 27 / UXP 9.4) never reply to it.
   * The broker treats a validate timeout as "unsupported" and proceeds to load.
   */
    validateMs: number;
}

export const DEFAULT_TIMEOUTS: TimeoutConfig = {
    pluginOpMs: ProtocolTimeouts.pluginOpMs,
    appInfoMs: ProtocolTimeouts.appInfoMs,
    validateMs: 3000,
};

/** Cap for wire-level frame logging. */
const WIRE_LOG_MAX_CHARS = 600;

function truncateForLog(text: string): string {
    return text.length > WIRE_LOG_MAX_CHARS
        ? `${text.slice(0, WIRE_LOG_MAX_CHARS)}… (${String(text.length)} chars)`
        : text;
}

interface PendingRequest {
    operation: string;
    resolve: (reply: ReplyMessage) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

export interface CdtFrameEvent {
    hostSessionId: string;
    /** Raw CDP JSON frame. */
    cdtMessage: string;
}

export interface HostLogEvent {
    level: string;
    message: string;
    appInfo: AppInfo;
}

export class AppConnection {
    /** Populated once the `App/info` handshake completes. */
    appInfo: AppInfo | undefined;
    /** Epoch ms when the `App/info` handshake completed (settle-guard input). */
    readyAtMs: number | undefined;

    readonly onReady = new TypedEvent<AppInfo>();
    readonly onClose = new TypedEvent<void>();
    readonly onPluginUnloaded = new TypedEvent<string>(); // host session id
    readonly onHostLog = new TypedEvent<HostLogEvent>();
    readonly onCdtFrame = new TypedEvent<CdtFrameEvent>();

    private nextRequestId = 1;
    private readonly pending = new Map<number, PendingRequest>();
    private closed = false;

    constructor(
        public readonly id: number,
        private readonly socket: SocketLike,
        private readonly log: (message: string) => void = () => undefined,
        private readonly timeouts: TimeoutConfig = DEFAULT_TIMEOUTS,
    ) {
        socket.on("message", (data) => {
            this.handleRaw(String(data));
        });
        socket.on("close", () => {
            this.handleClose();
        });
        socket.on("error", (err) => {
            this.log(`app connection #${String(id)} socket error: ${err.message}`);
        });
        // Handshake step 1: greet the app.
        this.sendFrame(buildReady());
    }

    get isReady(): boolean {
        return this.appInfo !== undefined;
    }

    // -------------------------------------------------------------------------
    // High-level plugin operations
    // -------------------------------------------------------------------------

    async validatePlugin(
        pluginPath: string,
        manifest: UxpPluginManifest,
    ): Promise<ReplyMessage> {
        return this.request(
            (id) => buildPluginValidate(id, pluginPath, manifest),
            "Plugin/validate",
            this.timeouts.validateMs,
        );
    }

    async loadPlugin(pluginPath: string, breakOnStart = false): Promise<string> {
        const reply = await this.request(
            (id) => buildPluginLoad(id, pluginPath, breakOnStart),
            "Plugin/load",
            this.timeouts.pluginOpMs,
        );
        return this.extractSessionId(reply, "Plugin/load");
    }

    async reloadPlugin(hostSessionId: string): Promise<ReplyMessage> {
        return this.request(
            (id) => buildPluginReload(id, hostSessionId),
            "Plugin/reload",
            this.timeouts.pluginOpMs,
        );
    }

    async unloadPlugin(hostSessionId: string): Promise<ReplyMessage> {
        return this.request(
            (id) => buildPluginUnload(id, hostSessionId),
            "Plugin/unload",
            this.timeouts.pluginOpMs,
        );
    }

    async runScript(
        scriptDir: string,
        fileName: string,
        userArgs: unknown[],
    ): Promise<string> {
        const reply = await this.request(
            (id) => buildPluginRunScript(id, scriptDir, fileName, userArgs),
            "Plugin/runScript",
            this.timeouts.pluginOpMs,
        );
        return this.extractSessionId(reply, "Plugin/runScript");
    }

    /** Fire-and-forget CDT attach/detach notification (errors are logged only). */
    notifyCdtState(hostSessionId: string, connected: boolean): void {
        const requestId = this.nextRequestId++;
        try {
            this.sendFrame(buildCdtState(requestId, hostSessionId, connected));
        }
        catch (err) {
            this.log(`cdt state notify failed: ${String(err instanceof Error ? err.message : err)}`);
        }
    }

    /** Forward a raw CDP frame from a DevTools frontend to the plugin. */
    sendCdtFrame(hostSessionId: string, rawCdpFrame: string): void {
        this.sendFrame(buildCdtTunnelFrame(hostSessionId, rawCdpFrame));
    }

    /** Close the underlying socket (used on broker shutdown). */
    close(): void {
        this.socket.close();
    }

    // -------------------------------------------------------------------------
    // Request / reply plumbing
    // -------------------------------------------------------------------------

    private request(
        build: (requestId: number) => BrokerToAppMessage,
        operation: string,
        timeoutMs: number,
    ): Promise<ReplyMessage> {
        const requestId = this.nextRequestId++;
        return new Promise<ReplyMessage>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new RequestTimeoutError(operation, timeoutMs));
            }, timeoutMs);
            this.pending.set(requestId, { operation, resolve, reject, timer });
            try {
                this.sendFrame(build(requestId));
            }
            catch (err) {
                clearTimeout(timer);
                this.pending.delete(requestId);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }

    private sendFrame(frame: BrokerToAppMessage): void {
        const json = JSON.stringify(frame);
        if (frame.command !== "CDT") {
            this.log(`app #${String(this.id)} ← ${truncateForLog(json)}`);
        }
        this.socket.send(json);
    }

    private extractSessionId(reply: ReplyMessage, operation: string): string {
        const sessionId = reply.pluginSessionId;
        if (typeof sessionId !== "string" || sessionId.length === 0) {
            throw new HostReplyError(operation, "host reply is missing pluginSessionId");
        }
        return sessionId;
    }

    // -------------------------------------------------------------------------
    // Incoming frames
    // -------------------------------------------------------------------------

    private handleRaw(raw: string): void {
        const parsed = parseFrame(raw);
        if (!parsed) {
            this.log(`app #${String(this.id)}: ignoring malformed frame: ${truncateForLog(raw)}`);
            return;
        }
        if (parsed.command !== "CDT") {
            this.log(`app #${String(this.id)} → ${truncateForLog(raw)}`);
        }
        const msg = asAppMessage(parsed);
        if (!msg) {
            this.log(`app #${String(this.id)}: ignoring unknown frame command=${String(parsed.command)}`);
            return;
        }

        switch (msg.command) {
            case "initRuntimeClient":
                void this.performInfoHandshake();
                return;
            case "reply": {
                const pending = this.pending.get(msg.requestId);
                if (!pending) {
                    // Reply after timeout — dropped by design.
                    this.log(`app #${String(this.id)}: dropping late reply requestId=${String(msg.requestId)}`);
                    return;
                }
                this.pending.delete(msg.requestId);
                clearTimeout(pending.timer);
                if (typeof msg.error === "string" && msg.error.length > 0) {
                    pending.reject(new HostReplyError(pending.operation, msg.error));
                }
                else {
                    pending.resolve(msg);
                }
                return;
            }
            case "CDT":
                this.onCdtFrame.emit({
                    hostSessionId: msg.pluginSessionId,
                    cdtMessage: msg.cdtMessage,
                });
                return;
            case "UXP":
                if (msg.action === "unloaded") {
                    this.onPluginUnloaded.emit(msg.pluginSessionId);
                }
                else if (this.appInfo) {
                    this.onHostLog.emit({
                        level: msg.level,
                        message: msg.message,
                        appInfo: this.appInfo,
                    });
                }
                return;
        }
    }

    private async performInfoHandshake(): Promise<void> {
        try {
            const reply = await this.request(
                (id) => buildAppInfoRequest(id),
                "App/info",
                this.timeouts.appInfoMs,
            );
            const { command: _c, requestId: _r, error: _e, ...info } = reply;
            this.appInfo = info as unknown as AppInfo;
            this.readyAtMs = Date.now();
            this.log(
                `app #${String(this.id)} identified: ${this.appInfo.appName} ${this.appInfo.appVersion} `
                + `(uxp ${this.appInfo.uxpVersion})`,
            );
            this.onReady.emit(this.appInfo);
        }
        catch (err) {
            this.log(
                `app #${String(this.id)}: App/info handshake failed — ${String(
                    err instanceof Error ? err.message : err,
                )}`,
            );
            this.socket.close();
        }
    }

    private handleClose(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        for (const [, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(new HostReplyError(pending.operation, "host application disconnected"));
        }
        this.pending.clear();
        this.onClose.emit();
    }
}
