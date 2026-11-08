/**
 * Rolling in-memory capture of `Runtime.consoleAPICalled` /
 * `Runtime.exceptionThrown` CDP events, one instance per active
 * `CdpProxyServer` session (LANGUAGE-MODEL-TOOLS.md §4). Fed by
 * `CdpMessageRewriter.rewriteFromTarget` as a side-effecting tap — never
 * blocks or mutates the message being forwarded to js-debug.
 *
 * Pure/vscode-free by design (same convention as `panelState.ts`) so it's
 * unit-testable under vitest without mocking the `vscode` module.
 *
 * Source locations in captured entries and exception stack frames are resolved
 * through the source maps parsed by `SourceMapRewriter` whenever available
 * (using `@jridgewell/trace-mapping`), falling back to the rewritten script
 * `file:` URL or the raw CDP-reported URL/line when no mapping matches.
 */

import type { Protocol } from "devtools-protocol";
import type { CdpMessage, CdpPayload } from "./cdpTypes";

export type ResolvedCallFrameLocation = Pick<Protocol.Runtime.CallFrame, "url" | "lineNumber">
    & Partial<Pick<Protocol.Runtime.CallFrame, "columnNumber">>;

export type SourceLocationResolver = (
    location: CdpPayload<Protocol.Runtime.CallFrame>,
) => ResolvedCallFrameLocation | undefined;

export interface ConsoleEntry {
    timestamp: number;
    level: string;
    args: string[];
    sourceUrl?: string;
    line?: number;
}

export interface ExceptionEntry {
    timestamp: number;
    text: string;
    stackTrace?: string;
    sourceUrl?: string;
    line?: number;
}

/** A single CDP `Runtime.RemoteObject`-ish value, formatted for display. */
function formatRemoteObject(obj: unknown): string {
    if (obj === null || typeof obj !== "object") {
        return String(obj);
    }
    const remote = obj as CdpPayload<Protocol.Runtime.RemoteObject>;
    if (remote.type === "undefined") {
        return "undefined";
    }
    if ("value" in remote) {
        try {
            return typeof remote.value === "string" ? (remote.value) : JSON.stringify(remote.value);
        }
        catch {
            return String(remote.value);
        }
    }
    if (typeof remote.description === "string") {
        return remote.description;
    }
    return `[${typeof remote.type === "string" ? remote.type : "object"}]`;
}

function resolveCallFrameLocation(
    frame: CdpPayload<Protocol.Runtime.CallFrame> | undefined,
    resolveLocation?: SourceLocationResolver,
): Partial<ResolvedCallFrameLocation> {
    if (!frame) {
        return {};
    }
    const resolved = resolveLocation?.(frame);
    return {
        url: resolved?.url ?? frame.url,
        lineNumber: resolved?.lineNumber ?? frame.lineNumber,
        columnNumber: resolved?.columnNumber ?? frame.columnNumber,
    };
}

function toConsoleEntry(
    params: CdpPayload<Protocol.Runtime.ConsoleAPICalledEvent>,
    resolveLocation?: SourceLocationResolver,
): ConsoleEntry {
    const args = Array.isArray(params.args) ? (params.args as unknown[]).map(formatRemoteObject) : [];
    const firstFrame = (params.stackTrace as { callFrames?: CdpPayload<Protocol.Runtime.CallFrame>[] } | undefined)
        ?.callFrames?.[0];
    const loc = resolveCallFrameLocation(firstFrame, resolveLocation);
    return {
        timestamp: typeof params.timestamp === "number" ? params.timestamp : Date.now(),
        level: typeof params.type === "string" ? params.type : "log",
        args,
        sourceUrl: loc.url,
        line: loc.lineNumber,
    };
}

function toExceptionEntry(
    params: CdpPayload<Protocol.Runtime.ExceptionThrownEvent>,
    resolveLocation?: SourceLocationResolver,
): ExceptionEntry {
    const details = params.exceptionDetails as CdpPayload<Protocol.Runtime.ExceptionDetails> | undefined;
    const exception = details?.exception as CdpPayload<Protocol.Runtime.RemoteObject> | undefined;
    const text
        = (typeof exception?.description === "string" && exception.description)
            || (typeof details?.text === "string" && details.text)
            || "Uncaught exception";
    const callFrames = (details?.stackTrace as { callFrames?: CdpPayload<Protocol.Runtime.CallFrame>[] } | undefined)
        ?.callFrames;
    const stackTrace = callFrames
        ?.map((f) => {
            const loc = resolveCallFrameLocation(f, resolveLocation);
            return `    at ${f.functionName === "" ? "<anonymous>" : f.functionName} (${loc.url ?? "?"}:${String((loc.lineNumber ?? 0) + 1)}:${String((loc.columnNumber ?? 0) + 1)})`;
        })
        .join("\n");

    const topFrame: CdpPayload<Protocol.Runtime.CallFrame> = {
        url: typeof details?.url === "string" ? details.url : callFrames?.[0]?.url,
        lineNumber: typeof details?.lineNumber === "number" ? details.lineNumber : callFrames?.[0]?.lineNumber,
        columnNumber: typeof details?.columnNumber === "number" ? details.columnNumber : callFrames?.[0]?.columnNumber,
        scriptId: typeof details?.scriptId === "string" ? details.scriptId : callFrames?.[0]?.scriptId,
    };
    const resolvedTop = resolveLocation?.(topFrame);

    return {
        timestamp: typeof params.timestamp === "number" ? params.timestamp : Date.now(),
        text,
        stackTrace,
        sourceUrl: resolvedTop?.url ?? topFrame.url,
        line: resolvedTop?.lineNumber ?? topFrame.lineNumber,
    };
}

/** A minimal parsed CDP message — matches the `{method, params}` shape rewriteFromTarget already parses. */
export type CdpEventMessage = Pick<CdpMessage, "method" | "params">;

export class CdpEventBuffer {
    private static readonly MAX_ENTRIES = 200;

    readonly console: ConsoleEntry[] = [];
    readonly exceptions: ExceptionEntry[] = [];

    constructor(private readonly resolveLocation?: SourceLocationResolver) {}

    /** Side-effecting tap — call for every message received from the target, forwarded or not. */
    captureFromTarget(msg: CdpEventMessage): void {
        switch (msg.method) {
            case "Runtime.consoleAPICalled":
                this.push(this.console, toConsoleEntry(msg.params ?? {}, this.resolveLocation));
                break;
            case "Runtime.exceptionThrown":
                this.push(this.exceptions, toExceptionEntry(msg.params ?? {}, this.resolveLocation));
                break;
            default:
                break;
        }
    }

    private push<T>(buf: T[], entry: T): void {
        buf.push(entry);
        if (buf.length > CdpEventBuffer.MAX_ENTRIES) {
            buf.shift();
        }
    }
}
