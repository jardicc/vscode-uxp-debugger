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
 * NOTE: stack traces/source locations here are the raw, CDP-reported
 * (compiled) urls/lines — NOT resolved through source maps. Good enough to
 * point a human/agent at the right file for typical UXP plugins (no bundler
 * minification during development), but a full source-mapped resolution
 * would need the same machinery as `sourceMapRewriter.ts` and is left as a
 * possible future improvement (see LANGUAGE-MODEL-TOOLS.md §4.2).
 */

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
    const remote = obj as Record<string, unknown>;
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

function toConsoleEntry(params: Record<string, unknown>): ConsoleEntry {
    const args = Array.isArray(params.args) ? (params.args as unknown[]).map(formatRemoteObject) : [];
    const firstFrame = (params.stackTrace as { callFrames?: unknown[] } | undefined)?.callFrames?.[0] as
        | { url?: string; lineNumber?: number }
        | undefined;
    return {
        timestamp: typeof params.timestamp === "number" ? params.timestamp : Date.now(),
        level: typeof params.type === "string" ? params.type : "log",
        args,
        sourceUrl: firstFrame?.url,
        line: firstFrame?.lineNumber,
    };
}

function toExceptionEntry(params: Record<string, unknown>): ExceptionEntry {
    const details = params.exceptionDetails as Record<string, unknown> | undefined;
    const exception = details?.exception as Record<string, unknown> | undefined;
    const text
        = (typeof exception?.description === "string" && exception.description)
            || (typeof details?.text === "string" && details.text)
            || "Uncaught exception";
    const callFrames = (details?.stackTrace as { callFrames?: unknown[] } | undefined)?.callFrames as
        | { functionName?: string; url?: string; lineNumber?: number; columnNumber?: number }[]
        | undefined;
    const stackTrace = callFrames
        ?.map((f) => `    at ${f.functionName === "" ? "<anonymous>" : f.functionName} (${f.url ?? "?"}:${String((f.lineNumber ?? 0) + 1)}:${String((f.columnNumber ?? 0) + 1)})`)
        .join("\n");
    return {
        timestamp: typeof params.timestamp === "number" ? params.timestamp : Date.now(),
        text,
        stackTrace,
        sourceUrl: typeof details?.url === "string" ? (details.url) : callFrames?.[0]?.url,
        line: typeof details?.lineNumber === "number" ? (details.lineNumber) : callFrames?.[0]?.lineNumber,
    };
}

/** A minimal parsed CDP message — matches the `{method, params}` shape rewriteFromTarget already parses. */
export interface CdpEventMessage {
    method?: string;
    params?: Record<string, unknown>;
}

export class CdpEventBuffer {
    private static readonly MAX_ENTRIES = 200;

    readonly console: ConsoleEntry[] = [];
    readonly exceptions: ExceptionEntry[] = [];

    /** Side-effecting tap — call for every message received from the target, forwarded or not. */
    captureFromTarget(msg: CdpEventMessage): void {
        switch (msg.method) {
            case "Runtime.consoleAPICalled":
                this.push(this.console, toConsoleEntry(msg.params ?? {}));
                break;
            case "Runtime.exceptionThrown":
                this.push(this.exceptions, toExceptionEntry(msg.params ?? {}));
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
