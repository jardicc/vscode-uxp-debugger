/**
 * Frame builders and type guards for the UXP wire protocol.
 *
 * Builders produce fully-typed outgoing frames; guards validate incoming
 * parsed JSON so the broker never trusts the shape of a raw frame.
 */

import type {
    AppInfoRequest,
    AppToBrokerMessage,
    CdtTunnelMessage,
    InitRuntimeClientMessage,
    PluginCdtStateRequest,
    PluginLoadRequest,
    PluginReloadRequest,
    PluginRunScriptRequest,
    PluginUnloadRequest,
    PluginValidateRequest,
    ReadyMessage,
    ReplyMessage,
    UxpHostAppLogEvent,
    UxpPluginUnloadedEvent,
    UxpPluginManifest,
} from "./types";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Safely parse a raw WebSocket text frame. Returns `undefined` for anything
 * that is not a JSON object (never throws).
 */
export function parseFrame(raw: string): Record<string, unknown> | undefined {
    try {
        const value: unknown = JSON.parse(raw);
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            return value as Record<string, unknown>;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Type guards (incoming, app → broker)
// ---------------------------------------------------------------------------

function record(msg: unknown): Record<string, unknown> | undefined {
    return typeof msg === "object" && msg !== null
        ? (msg as Record<string, unknown>)
        : undefined;
}

export function isReply(msg: unknown): msg is ReplyMessage {
    const m = record(msg);
    return m?.command === "reply" && typeof m.requestId === "number";
}

export function isInitRuntimeClient(msg: unknown): msg is InitRuntimeClientMessage {
    return record(msg)?.command === "initRuntimeClient";
}

export function isCdtTunnelMessage(msg: unknown): msg is CdtTunnelMessage {
    const m = record(msg);
    return (
        m?.command === "CDT"
        && typeof m.pluginSessionId === "string"
        && typeof m.cdtMessage === "string"
    );
}

export function isPluginUnloadedEvent(msg: unknown): msg is UxpPluginUnloadedEvent {
    const m = record(msg);
    return (
        m?.command === "UXP"
        && m.action === "unloaded"
        && typeof m.pluginSessionId === "string"
    );
}

export function isHostAppLogEvent(msg: unknown): msg is UxpHostAppLogEvent {
    const m = record(msg);
    return (
        m?.command === "UXP"
        && m.action === "log"
        && typeof m.message === "string"
    );
}

/** Narrow an arbitrary parsed frame into the app→broker union (or undefined). */
export function asAppMessage(
    msg: Record<string, unknown>,
): AppToBrokerMessage | undefined {
    if (
        isReply(msg)
        || isInitRuntimeClient(msg)
        || isCdtTunnelMessage(msg)
        || isPluginUnloadedEvent(msg)
        || isHostAppLogEvent(msg)
    ) {
        return msg;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Builders (outgoing, broker → app)
// ---------------------------------------------------------------------------

export function buildReady(): ReadyMessage {
    return { command: "ready" };
}

export function buildAppInfoRequest(requestId: number): AppInfoRequest {
    return { command: "App", action: "info", requestId };
}

export function buildPluginLoad(
    requestId: number,
    pluginPath: string,
    breakOnStart = false,
): PluginLoadRequest {
    return {
        command: "Plugin",
        action: "load",
        requestId,
        params: { provider: { type: "disk", path: pluginPath } },
        breakOnStart,
    };
}

export function buildPluginValidate(
    requestId: number,
    pluginPath: string,
    manifest: UxpPluginManifest,
): PluginValidateRequest {
    return {
        command: "Plugin",
        action: "validate",
        requestId,
        params: { provider: { type: "disk", path: pluginPath } },
        manifest,
    };
}

export function buildPluginReload(
    requestId: number,
    hostSessionId: string,
): PluginReloadRequest {
    return {
        command: "Plugin",
        action: "reload",
        requestId,
        pluginSessionId: hostSessionId,
    };
}

export function buildPluginUnload(
    requestId: number,
    hostSessionId: string,
): PluginUnloadRequest {
    return {
        command: "Plugin",
        action: "unload",
        requestId,
        pluginSessionId: hostSessionId,
    };
}

export function buildPluginRunScript(
    requestId: number,
    scriptDir: string,
    fileName: string,
    userArgs: unknown[],
): PluginRunScriptRequest {
    return {
        command: "Plugin",
        action: "runScript",
        requestId,
        params: {
            provider: { type: "disk", path: scriptDir },
            fileName,
            userArgs,
        },
    };
}

export function buildCdtState(
    requestId: number,
    hostSessionId: string,
    connected: boolean,
): PluginCdtStateRequest {
    return {
        command: "Plugin",
        action: connected ? "cdtConnected" : "cdtDisconnected",
        requestId,
        pluginSessionId: hostSessionId,
    };
}

export function buildCdtTunnelFrame(
    hostSessionId: string,
    rawCdpFrame: string,
): CdtTunnelMessage {
    return {
        command: "CDT",
        pluginSessionId: hostSessionId,
        cdtMessage: rawCdpFrame,
    };
}

/**
 * Normalise `userArgs` for `Plugin/runScript`: must be a JSON-serialisable
 * array. Fails fast on BigInt / circular references.
 */
export function normalizeUserArgs(input: unknown): unknown[] {
    if (input === undefined || input === null) {
        return [];
    }
    if (!Array.isArray(input)) {
        throw new Error("userArgs must be an array of JSON values");
    }
    JSON.stringify(input); // throws on BigInt / circular refs
    return input;
}

/**
 * Parses the InputBox syntax used for script arguments: the user types the
 * array *contents* without the enclosing brackets (UDT-compatible, e.g.
 * `2, "text", true`). Returns `undefined` for invalid JSON or a result that
 * isn't an array (a stray `]` could otherwise break out of the wrapper).
 * Lives here (not src/vscode/commands/debugScript.ts) — vscode-free logic
 * so it can be unit-tested with vitest without a real VS Code host.
 */
export function parseArgsText(text: string): unknown[] | undefined {
    try {
        const parsed: unknown = JSON.parse(`[${text}]`);
        return Array.isArray(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
