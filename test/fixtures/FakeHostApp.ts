/**
 * FakeHostApp — a scripted WebSocket client that impersonates an Adobe host
 * application speaking the documented UXP protocol (ARCHITECTURE.md §5.2).
 *
 * Drives the real broker over a real loopback socket, so tests exercise the
 * full path (upgrade routing → handshake → request/reply → events) in
 * milliseconds with zero external dependencies.
 */

import WebSocket from "ws";
import type { AppInfo } from "../../src/core/protocol/types";

type Frame = Record<string, unknown>;

export interface FakeHostAppOptions {
    appInfo?: Partial<AppInfo>;
    /** Reply-field factories per Plugin action. Return `null` to stay silent (timeout tests). */
    behaviors?: Partial<Behaviors>;
    /** Do not auto-send `initRuntimeClient` after `ready` (handshake tests). */
    suppressInit?: boolean;
}

export interface Behaviors {
    validate(request: Frame): Frame | null;
    load(request: Frame): Frame | null;
    reload(request: Frame): Frame | null;
    unload(request: Frame): Frame | null;
    runScript(request: Frame): Frame | null;
    info(request: Frame): Frame | null;
}

export const DEFAULT_APP_INFO: AppInfo = {
    appId: "PS",
    appVersion: "27.9.0",
    appName: "Photoshop",
    uxpVersion: "8.1.0",
    platform: "win32",
    sandbox: false,
    supportedFeatures: { debugScripts: true },
};

export class FakeHostApp {
    readonly received: Frame[] = [];
    readonly appInfo: AppInfo;

    private ws: WebSocket | undefined;
    private nextHostSessionId = 1;
    private readonly behaviors: Partial<Behaviors>;
    private readonly suppressInit: boolean;
    private readonly waiters: {
        predicate: (frame: Frame) => boolean;
        resolve: (frame: Frame) => void;
    }[] = [];

    constructor(options: FakeHostAppOptions = {}) {
        this.appInfo = { ...DEFAULT_APP_INFO, ...options.appInfo };
        this.behaviors = options.behaviors ?? {};
        this.suppressInit = options.suppressInit ?? false;
    }

    /** Connect to the broker like a real host app (path `/socket/app`). */
    async connect(port: number): Promise<void> {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/socket/app`);
        this.ws = ws;
        ws.on("message", (data) => this.handleFrame(JSON.parse(String(data)) as Frame));
        await new Promise<void>((resolve, reject) => {
            ws.once("open", resolve);
            ws.once("error", reject);
        });
    }

    close(): void {
        this.ws?.close();
    }

    send(frame: Frame): void {
        this.ws!.send(JSON.stringify(frame));
    }

    // -- Unsolicited events ----------------------------------------------------

    sendUnloaded(hostSessionId: string): void {
        this.send({ command: "UXP", action: "unloaded", pluginSessionId: hostSessionId });
    }

    sendLog(level: string, message: string): void {
        this.send({ command: "UXP", action: "log", level, message });
    }

    sendCdtFrame(hostSessionId: string, rawCdp: string): void {
        this.send({ command: "CDT", pluginSessionId: hostSessionId, cdtMessage: rawCdp });
    }

    // -- Assertions --------------------------------------------------------------

    /** Wait for a received frame matching the predicate (also checks history). */
    waitForFrame(predicate: (frame: Frame) => boolean, timeoutMs = 2000): Promise<Frame> {
        const already = this.received.find(predicate);
        if (already) {
            return Promise.resolve(already);
        }
        return new Promise<Frame>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error("FakeHostApp.waitForFrame timed out")),
                timeoutMs,
            );
            this.waiters.push({
                predicate,
                resolve: (frame) => {
                    clearTimeout(timer);
                    resolve(frame);
                },
            });
        });
    }

    // -- Protocol behaviour ------------------------------------------------------

    private handleFrame(frame: Frame): void {
        this.received.push(frame);
        for (let i = this.waiters.length - 1; i >= 0; i--) {
            if (this.waiters[i].predicate(frame)) {
                const [waiter] = this.waiters.splice(i, 1);
                waiter.resolve(frame);
            }
        }

        if (frame.command === "ready") {
            if (!this.suppressInit) {
                this.send({ command: "initRuntimeClient", platform: this.appInfo.platform });
            }
            return;
        }

        if (frame.command === "App" && frame.action === "info") {
            const custom = this.behaviors.info?.(frame);
            if (custom === null) {
                return; // silent
            }
            this.reply(frame, custom ?? { ...this.appInfo });
            return;
        }

        if (frame.command === "Plugin") {
            this.handlePluginFrame(frame);
        }
    }

    private handlePluginFrame(frame: Frame): void {
        switch (frame.action) {
            case "validate": {
                const fields = this.invokeBehavior("validate", frame, { success: true });
                if (fields) {
                    this.reply(frame, fields);
                }
                return;
            }
            case "load": {
                const fields = this.invokeBehavior("load", frame, {
                    pluginSessionId: `host-session-${this.nextHostSessionId++}`,
                });
                if (fields) {
                    this.reply(frame, fields);
                }
                return;
            }
            case "reload": {
                const fields = this.invokeBehavior("reload", frame, {});
                if (fields) {
                    this.reply(frame, fields);
                }
                return;
            }
            case "unload": {
                const fields = this.invokeBehavior("unload", frame, {});
                if (fields) {
                    this.reply(frame, fields);
                }
                return;
            }
            case "runScript": {
                const fields = this.invokeBehavior("runScript", frame, {
                    pluginSessionId: `host-script-${this.nextHostSessionId++}`,
                });
                if (fields) {
                    this.reply(frame, fields);
                }
                return;
            }
            case "cdtConnected":
            case "cdtDisconnected":
                this.reply(frame, {});
                return;
        }
    }

    private invokeBehavior(
        name: keyof Behaviors,
        frame: Frame,
        defaults: Frame,
    ): Frame | undefined {
        const behavior = this.behaviors[name];
        if (!behavior) {
            return defaults;
        }
        const result = behavior(frame);
        return result === null ? undefined : result;
    }

    private reply(request: Frame, fields: Frame): void {
        this.send({ command: "reply", requestId: request.requestId, ...fields });
    }
}
