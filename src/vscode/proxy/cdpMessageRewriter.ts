import * as vscode from "vscode";
import type { Protocol } from "devtools-protocol";
import { CdpEventBuffer } from "./cdpEventBuffer";
import type { CdpMessage, CdpPayload } from "./cdpTypes";
import {
    buildIdentitySourceMapUrl,
    normalizeScriptUrl,
    resolveExternalSourceMap,
    resolveScriptFileUrl,
    rewriteInlineSourceMapRoot,
} from "./sourceMapRewriter";

// ---------------------------------------------------------------------------
// CDP Message Rewriter
// ---------------------------------------------------------------------------

/**
 * Handles all CDP message rewriting logic and associated state
 * (internal IDs, execution context tracking, deferred destruction, etc.).
 *
 * Separated from the proxy transport layer so that message-level concerns
 * are isolated from WebSocket lifecycle management.
 */
export class CdpMessageRewriter {
    /** The uniqueId from the latest Runtime.executionContextCreated event. */
    executionContextUniqueId: string | undefined;

    /** IDs used for proxy-initiated CDP messages (not forwarded back to js-debug).
   *  Must be positive – UXP uses jsoncpp which deserializes `id` as UInt and
   *  rejects negative values with "LargestInt out of UInt range". */
    private nextInternalId = 900_000;
    private readonly internalIds = new Map<number, string>();

    /** Resolvers for internal requests sent via `sendRawRequestToTarget`, keyed by id. */
    private readonly internalRequestWaiters = new Map<
        number,
        { resolve: (msg: Record<string, unknown>) => void; reject: (err: Error) => void }
    >();

    /** Tracks pending Runtime.evaluate request IDs to intercept error responses. */
    private readonly pendingEvaluateIds = new Set<number>();

    /** Timer handle for the "no execution context" warning. */
    private noContextTimer: ReturnType<typeof setTimeout> | undefined;

    /** Deferred context-destruction messages awaiting a possible reload. */
    private deferredContextMessages: string[] = [];
    private deferredContextTimer: ReturnType<typeof setTimeout> | undefined;

    /**
   * `Runtime.evaluate` requests received while no execution context uniqueId
   * has been captured yet (e.g. right after a target reconnect, before the
   * new `Runtime.executionContextCreated` event arrives). Held here instead
   * of being forwarded with a stale/missing context id — UXP rejects those
   * with "Cannot find default execution context" — and flushed once a
   * context becomes available.
   */
    private pendingContextMessages: { id: number; raw: Record<string, unknown> }[] = [];

    /**
   * The last `Runtime.executionContextCreated` message seen, and every
   * `Debugger.scriptParsed` message seen since (keyed by scriptId, in parse
   * order). UXP only emits these ONCE per context/script — a js-debug
   * client that attaches to an already-open target connection (e.g. after
   * a debug-toolbar Restart, which keeps the target alive — see
   * `cdpProxy.ts`) would otherwise never learn about already-parsed
   * scripts: breakpoints stay unbound and paused locations can't be mapped
   * back to source. Replayed to each newly-attached client once it sends
   * its own `Debugger.enable` (see `markNewClient` / the Debugger.enable
   * handling in `rewriteFromClient`).
   */
    private lastExecutionContextCreatedRaw: string | undefined;
    private readonly scriptParsedCache = new Map<string, string>();

    /**
   * Breakpoint IDs currently registered on the UXP target (via
   * `Debugger.setBreakpoint`/`setBreakpointByUrl`), and the request IDs
   * awaiting a reply for those calls. UXP breakpoints (including unbound,
   * pending `setBreakpointByUrl` ones) are never automatically cleared when
   * a client disconnects — since the target connection is kept alive across
   * a debug-toolbar Restart, a fresh client re-requesting the same
   * breakpoint gets a "Breakpoint at specified location already exists"
   * error instead of a normal (verified) response. Cleared out for every
   * newly-attached client (see `markNewClient`).
   */
    private readonly liveBreakpointIds = new Set<string>();
    private readonly pendingBreakpointRequestIds = new Set<number>();

    /** Whether cached state has already been replayed for the current client. */
    private hasReplayedForCurrentClient = false;

    /** Rolling console/exception capture for LM tools (LANGUAGE-MODEL-TOOLS.md §4). */
    private readonly eventBuffer = new CdpEventBuffer();

    /** How long (ms) to wait for a new execution context after destruction
   *  before forwarding the destruction event to js-debug (reload grace period). */
    private static readonly CONTEXT_RELOAD_GRACE_MS = 2_000;

    /** How long (ms) to wait for an execution context before warning the user. */
    private static readonly CONTEXT_TIMEOUT_MS = 8_000;

    constructor(
        private readonly pluginDir: string,
        private readonly log: vscode.OutputChannel,
        private readonly sendToClient: (msg: string) => void,
        private readonly stopProxy: () => void,
        private readonly sendToTarget: (msg: string) => void = () => undefined,
    ) {}

    // -----------------------------------------------------------------------
    // Public helpers for the proxy orchestrator
    // -----------------------------------------------------------------------

    /** Allocate an internal CDP message ID and track it by method name. */
    allocateInternalId(method: string): number {
        const id = this.nextInternalId++;
        this.internalIds.set(id, method);
        return id;
    }

    /**
   * Sends a CDP request straight to the UXP target and resolves with its raw
   * reply (`{result}` or `{error}`) — bypasses DAP entirely. Added for
   * `uxp_evaluate_global`: js-debug's own DAP `evaluate` request never sends
   * anything over CDP when called without a `frameId` (confirmed via a live
   * trace — no live thread/frame reference for it to bind to), whereas raw
   * CDP `Runtime.evaluate` against the target's `uniqueContextId` works fine
   * without a pause (js-debug itself relies on exactly this for its own
   * startup probes, e.g. the `process`/`WebAssembly` evals visible in the
   * CDP log right after attach).
   */
    sendRawRequestToTarget(
        method: string,
        params: Record<string, unknown>,
        timeoutMs = 15_000,
    ): Promise<Record<string, unknown>> {
        const id = this.allocateInternalId(method);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.internalRequestWaiters.delete(id);
                reject(new Error(
                    `Timed out after ${String(timeoutMs)}ms waiting for the UXP target's reply to ${method}.`,
                ));
            }, timeoutMs);
            this.internalRequestWaiters.set(id, {
                resolve: (msg) => {
                    clearTimeout(timer);
                    resolve(msg);
                },
                reject: (err) => {
                    clearTimeout(timer);
                    reject(err);
                },
            });
            this.sendToTarget(JSON.stringify({ id, method, params }));
        });
    }

    /**
   * The last `Runtime.executionContextCreated` message seen (raw JSON), if
   * any — used to replay it to inspector-panel clients that connect after
   * the context already exists (see `handlePanelUpgrade` in `cdpProxy.ts`).
   * Without it, the DevTools frontend's Console never learns of a context
   * to evaluate against.
   */
    getLastExecutionContextCreatedRaw(): string | undefined {
        return this.lastExecutionContextCreatedRaw;
    }

    /** Rolling console/exception capture for this session — see `CdpEventBuffer`. */
    getEventBuffer(): CdpEventBuffer {
        return this.eventBuffer;
    }

    /**
   * Start a timer that warns the user if no execution context is received.
   * Called by the proxy when the target WebSocket opens.
   */
    startContextTimeout(): void {
        this.noContextTimer = setTimeout(() => {
            if (!this.executionContextUniqueId) {
                this.log.appendLine(
                    "[CDP] Warning: no execution context received within "
                    + `${String(CdpMessageRewriter.CONTEXT_TIMEOUT_MS / 1000)}s — plugin may not be loaded. Disconnecting.`,
                );
                vscode.window.showWarningMessage(
                    "UXP Debugger: Connected to the plugin endpoint but no response from the plugin. "
                    + "Make sure the plugin is loaded in the host application (UXP: Load Plugin).",
                );
                this.stopProxy();
            }
        }, CdpMessageRewriter.CONTEXT_TIMEOUT_MS);
    }

    /**
   * Reset context-related state when the target WebSocket closes.
   * Clears the execution context and the "no context" timer.
   */
    resetContextState(): void {
        this.executionContextUniqueId = undefined;
        if (this.noContextTimer) {
            clearTimeout(this.noContextTimer);
            this.noContextTimer = undefined;
        }
        // The target connection is gone — any in-flight sendRawRequestToTarget
        // call will never get a reply now.
        for (const waiter of this.internalRequestWaiters.values()) {
            waiter.reject(new Error("The UXP target connection closed before it replied."));
        }
        this.internalRequestWaiters.clear();
        // A genuine target reconnect gets a fresh context and fresh scripts —
        // cached state from the old context would be stale/wrong to replay.
        this.lastExecutionContextCreatedRaw = undefined;
        this.scriptParsedCache.clear();
        // A brand-new V8 session on the target has no memory of previous
        // breakpoints either.
        this.liveBreakpointIds.clear();
        this.pendingBreakpointRequestIds.clear();
    }

    /**
   * Called by the proxy whenever a new client WebSocket attaches (e.g. a
   * debug-toolbar Restart reusing the same target connection), so cached
   * script/context state gets replayed once for each new client.
   */
    markNewClient(): void {
        this.hasReplayedForCurrentClient = false;

        if (this.liveBreakpointIds.size > 0) {
            this.log.appendLine(
                `[CDP] Removing ${String(this.liveBreakpointIds.size)} breakpoint(s) left over from the `
                + "previous client on this (reused) target connection.",
            );
            for (const breakpointId of this.liveBreakpointIds) {
                const id = this.allocateInternalId("Debugger.removeBreakpoint");
                this.sendToTarget(JSON.stringify({ id, method: "Debugger.removeBreakpoint", params: { breakpointId } }));
            }
            this.liveBreakpointIds.clear();
        }
        this.pendingBreakpointRequestIds.clear();
    }

    /**
   * Replay the last known execution context + all cached scriptParsed
   * events to the (newly attached) client. See `scriptParsedCache` above.
   */
    private replayCachedState(): void {
        if (!this.lastExecutionContextCreatedRaw && this.scriptParsedCache.size === 0) {
            return;
        }
        this.log.appendLine(
            `[CDP] Replaying cached execution context + ${String(this.scriptParsedCache.size)} `
            + "scriptParsed event(s) to the newly (re)attached client.",
        );
        if (this.lastExecutionContextCreatedRaw) {
            this.sendToClient(this.lastExecutionContextCreatedRaw);
        }
        for (const scriptParsed of this.scriptParsedCache.values()) {
            this.sendToClient(scriptParsed);
        }
    }

    /** Clean up all timers. Called by the proxy on stop(). */
    dispose(): void {
        if (this.noContextTimer) {
            clearTimeout(this.noContextTimer);
            this.noContextTimer = undefined;
        }
        if (this.deferredContextTimer) {
            clearTimeout(this.deferredContextTimer);
            this.deferredContextTimer = undefined;
            this.deferredContextMessages.length = 0;
        }
        this.pendingContextMessages.length = 0;
        this.lastExecutionContextCreatedRaw = undefined;
        this.scriptParsedCache.clear();
        this.liveBreakpointIds.clear();
        this.pendingBreakpointRequestIds.clear();
    }

    // -----------------------------------------------------------------------
    // Message rewriting: UXP target → js-debug
    // -----------------------------------------------------------------------

    /**
   * Rewrite / filter a CDP message coming FROM the UXP target BEFORE it
   * reaches js-debug. Return `null` to swallow the message entirely.
   *
   * This is the main extension point for UXP-specific quirks:
   *  - Patch `Debugger.scriptParsed` URLs for correct source-map resolution
   *  - Inject missing events that js-debug expects
   *  - Translate non-standard domain methods
   */
    rewriteFromTarget(raw: string): string | null {
        try {
            const msg = JSON.parse(raw) as CdpMessage;

            // Side-effecting tap for LM tools (console output / exceptions) — never
            // blocks or alters the forwarding decision made below.
            this.eventBuffer.captureFromTarget(msg);

            // Swallow responses to proxy-internal requests (e.g. Runtime.enable)
            if (msg.id !== undefined && this.internalIds.has(msg.id)) {
                const method = this.internalIds.get(msg.id);
                this.internalIds.delete(msg.id);
                this.log.appendLine(
                    `[CDP] Swallowed internal response id=${String(msg.id)} method=${String(method)}`,
                );
                const waiter = this.internalRequestWaiters.get(msg.id);
                if (waiter) {
                    this.internalRequestWaiters.delete(msg.id);
                    waiter.resolve(msg);
                }
                return null;
            }

            // If UXP returned an error for a Runtime.evaluate request,
            // send back a synthetic result so the debug console shows a
            // helpful message instead of crashing or being silent.
            if (
                msg.id !== undefined
                && this.pendingEvaluateIds.has(msg.id)
                && msg.error
            ) {
                this.pendingEvaluateIds.delete(msg.id);
                const errText = msg.error.message ?? "Evaluation not supported";
                this.log.appendLine(
                    `[CDP] Runtime.evaluate failed (id=${String(msg.id)}): ${errText}`,
                );
                return JSON.stringify({
                    id: msg.id,
                    result: {
                        result: {
                            type: "string",
                            value: `[UXP] ${errText}`,
                        },
                    },
                });
            }

            // Clean up successful evaluate tracking
            if (msg.id !== undefined && this.pendingEvaluateIds.has(msg.id)) {
                this.pendingEvaluateIds.delete(msg.id);
            }

            // Track breakpoint IDs returned for setBreakpoint/setBreakpointByUrl
            // requests so they can be cleared out for the next client (see
            // `markNewClient`).
            if (msg.id !== undefined && this.pendingBreakpointRequestIds.has(msg.id)) {
                this.pendingBreakpointRequestIds.delete(msg.id);
                const result: CdpPayload<Protocol.Debugger.SetBreakpointByUrlResponse> | undefined = msg.result;
                if (typeof result?.breakpointId === "string") {
                    this.liveBreakpointIds.add(result.breakpointId);
                }
            }

            // Capture the uniqueId from execution context creation.
            const executionContextCreatedParams:
                CdpPayload<Protocol.Runtime.ExecutionContextCreatedEvent> | undefined = msg.params;
            if (
                msg.method === "Runtime.executionContextCreated"
                && typeof executionContextCreatedParams?.context?.uniqueId === "string"
            ) {
                this.executionContextUniqueId = executionContextCreatedParams.context.uniqueId;
                if (this.noContextTimer) {
                    clearTimeout(this.noContextTimer);
                    this.noContextTimer = undefined;
                }
                // A new context arrived — this is a reload. Discard any deferred
                // destruction messages so js-debug keeps running.
                if (this.deferredContextTimer) {
                    clearTimeout(this.deferredContextTimer);
                    this.deferredContextTimer = undefined;
                    this.log.appendLine(
                        "[CDP] New context arrived — discarding "
                        + `${String(this.deferredContextMessages.length)} deferred destruction event(s) (reload)`,
                    );
                    this.deferredContextMessages.length = 0;
                }
                this.log.appendLine(`[CDP] Captured executionContext uniqueId: ${this.executionContextUniqueId}`);
                this.lastExecutionContextCreatedRaw = raw;

                // Flush any Runtime.evaluate requests that arrived before this
                // context existed (see `pendingContextMessages`) now that we have
                // a uniqueContextId to attach to them.
                if (this.pendingContextMessages.length > 0) {
                    this.log.appendLine(
                        `[CDP] Flushing ${String(this.pendingContextMessages.length)} deferred Runtime.evaluate `
                        + "request(s) now that an execution context exists.",
                    );
                    for (const { raw: deferred } of this.pendingContextMessages) {
                        deferred.params = deferred.params ?? {};
                        (deferred.params as Record<string, unknown>).uniqueContextId
                            = this.executionContextUniqueId;
                        this.sendToTarget(JSON.stringify(deferred));
                    }
                    this.pendingContextMessages.length = 0;
                }
            }

            // Defer executionContextDestroyed / executionContextsCleared:
            // Hold the message for a short grace period. If a new
            // executionContextCreated arrives (reload), we discard it.
            // Otherwise (unload / real termination), we forward it to js-debug.
            if (
                msg.method === "Runtime.executionContextDestroyed"
                || msg.method === "Runtime.executionContextsCleared"
            ) {
                this.log.appendLine(
                    `[CDP] Deferring ${msg.method} (grace period `
                    + `${String(CdpMessageRewriter.CONTEXT_RELOAD_GRACE_MS)}ms)`,
                );
                this.executionContextUniqueId = undefined;
                this.deferredContextMessages.push(raw);

                // (Re)start the grace timer — only one timer is active at a time.
                this.deferredContextTimer ??= setTimeout(() => {
                    this.deferredContextTimer = undefined;
                    // Grace period elapsed with no new context — forward to js-debug.
                    this.log.appendLine(
                        "[CDP] Grace period elapsed — forwarding "
                        + `${String(this.deferredContextMessages.length)} deferred destruction event(s)`,
                    );
                    for (const deferred of this.deferredContextMessages) {
                        this.sendToClient(deferred);
                    }
                    this.deferredContextMessages.length = 0;
                }, CdpMessageRewriter.CONTEXT_RELOAD_GRACE_MS);
                return null;
            }

            // Rewrite script URLs and source maps (inline or external) so that
            // js-debug can map them to local files.
            const scriptParsedParams: CdpPayload<Protocol.Debugger.ScriptParsedEvent> | undefined = msg.params;
            if (msg.method === "Debugger.scriptParsed" && typeof scriptParsedParams?.url === "string") {
                scriptParsedParams.url = normalizeScriptUrl(scriptParsedParams.url);

                // Fix the sourceRoot inside the source map so that relative
                // source paths (e.g. "../src/shared/store.ts") resolve to the
                // correct local files under webRoot. Handles both inline (data:)
                // maps and external .map files referenced by a plain filename.
                // The script's subdirectory is derived (and verified against disk)
                // from the url itself inside these two functions — see
                // `resolveVerifiedSubdir` in sourceMapRewriter.ts.
                if (typeof scriptParsedParams.sourceMapURL === "string" && scriptParsedParams.sourceMapURL.length > 0) {
                    scriptParsedParams.sourceMapURL = scriptParsedParams.sourceMapURL.startsWith("data:")
                        ? rewriteInlineSourceMapRoot(
                                scriptParsedParams.sourceMapURL,
                                this.pluginDir,
                                scriptParsedParams.url,
                                this.log,
                            )
                        : resolveExternalSourceMap(
                                scriptParsedParams.sourceMapURL,
                                this.pluginDir,
                                scriptParsedParams.url,
                                this.log,
                            );
                }
                else {
                    // No source map: point the url at the real file on disk, then
                    // synthesize an identity source map pointing back at that same
                    // file. The url rewrite alone isn't enough — js-debug only skips
                    // its on-disk content-hash check (which UXP scripts always fail,
                    // see `buildIdentitySourceMapUrl`) for sources that arrive via a
                    // source map, so without one it still shows a read-only,
                    // CDP-fetched copy even once the url resolves correctly.
                    const resolvedUrl = resolveScriptFileUrl(scriptParsedParams.url, this.pluginDir);
                    this.log.appendLine(
                        `[CDP] Final source file: ${JSON.stringify(scriptParsedParams.url)} → ${JSON.stringify(resolvedUrl)}`,
                    );
                    scriptParsedParams.url = resolvedUrl;
                    if (resolvedUrl.startsWith("file:///")) {
                        const absoluteFilePath = resolvedUrl.slice("file:///".length);
                        const lineCount = typeof scriptParsedParams.endLine === "number" ? scriptParsedParams.endLine + 1 : 1;
                        scriptParsedParams.sourceMapURL = buildIdentitySourceMapUrl(absoluteFilePath, lineCount);
                    }
                }

                const rewritten = JSON.stringify(msg);
                if (typeof scriptParsedParams.scriptId === "string") {
                    this.scriptParsedCache.set(scriptParsedParams.scriptId, rewritten);
                }
                return rewritten;
            }

            return raw;
        }
        catch {
            return raw;
        }
    }

    // -----------------------------------------------------------------------
    // Message rewriting: js-debug → UXP target
    // -----------------------------------------------------------------------

    /**
   * Rewrite / filter a CDP message coming FROM js-debug BEFORE it reaches
   * the UXP target. Return `null` to swallow the message entirely.
   */
    rewriteFromClient(raw: string): string | null {
        try {
            const msg = JSON.parse(raw) as CdpMessage;

            // UXP does not support NodeWorker — swallow the request and send a
            // synthetic success response so that js-debug does not stall.
            if (msg.method === "NodeWorker.enable" && msg.id !== undefined) {
                this.log.appendLine(
                    `[CDP] Swallowed unsupported method NodeWorker.enable (id=${String(msg.id)})`,
                );
                this.sendToClient(JSON.stringify({ id: msg.id, result: {} }));
                return null;
            }

            // A fresh js-debug client's first Debugger.enable — replay cached
            // execution-context/scriptParsed state (see `scriptParsedCache`) in
            // case this client attached to an already-open target connection
            // (e.g. reused across a debug-toolbar Restart) and would otherwise
            // never learn about scripts UXP already parsed. Forwarded normally
            // afterwards — UXP tolerates a redundant Debugger.enable.
            if (msg.method === "Debugger.enable" && !this.hasReplayedForCurrentClient) {
                this.hasReplayedForCurrentClient = true;
                this.replayCachedState();
            }

            // Track setBreakpoint/setBreakpointByUrl requests so the returned
            // breakpointId can be tracked (see `liveBreakpointIds`).
            if (
                (msg.method === "Debugger.setBreakpoint" || msg.method === "Debugger.setBreakpointByUrl")
                && msg.id !== undefined
            ) {
                this.pendingBreakpointRequestIds.add(msg.id);
            }

            // The client removed a breakpoint itself — stop tracking it.
            const removeBreakpointParams:
                CdpPayload<Protocol.Debugger.RemoveBreakpointRequest> | undefined = msg.params;
            if (msg.method === "Debugger.removeBreakpoint" && typeof removeBreakpointParams?.breakpointId === "string") {
                this.liveBreakpointIds.delete(removeBreakpointParams.breakpointId);
            }

            // Track Runtime.evaluate requests so we can intercept UXP errors.
            // Append the captured uniqueContextId so UXP can resolve the context.
            if (msg.method === "Runtime.evaluate" && msg.id !== undefined) {
                this.pendingEvaluateIds.add(msg.id);
                msg.params ??= {};
                const evaluateParams: CdpPayload<Protocol.Runtime.EvaluateRequest> = msg.params;
                if (evaluateParams.contextId !== undefined) {
                    delete evaluateParams.contextId;
                }
                if (!this.executionContextUniqueId) {
                    // No context yet — e.g. mid-reconnect, before the new
                    // Runtime.executionContextCreated event has arrived. Forwarding
                    // this as-is (with a stale/missing context id) makes UXP reply
                    // "Cannot find default execution context"; hold it instead and
                    // flush it (see the executionContextCreated handling above) once
                    // a context is captured.
                    this.log.appendLine(
                        `[CDP] Deferring Runtime.evaluate (id=${String(msg.id)}) — no execution context yet.`,
                    );
                    this.pendingContextMessages.push({ id: msg.id, raw: msg });
                    return null;
                }
                evaluateParams.uniqueContextId = this.executionContextUniqueId;
                return JSON.stringify(msg);
            }

            return raw;
        }
        catch {
            return raw;
        }
    }
}
