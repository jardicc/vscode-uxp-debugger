import * as http from "http";
import type { Duplex } from "stream";
import * as vscode from "vscode";
import type { Protocol } from "devtools-protocol";
import WebSocket, { WebSocketServer } from "ws";
import type { CdpEventBuffer } from "./cdpEventBuffer";
import { CdpMessageRewriter } from "./cdpMessageRewriter";
import type { CdpMessage, CdpPayload } from "./cdpTypes";

interface CdpDiscoveryEntry {
    id?: unknown;
    webSocketDebuggerUrl?: unknown;
}

// ---------------------------------------------------------------------------
// CDP Proxy Server
// ---------------------------------------------------------------------------

/**
 * A lightweight CDP (Chrome DevTools Protocol) proxy that sits between
 * the VS Code built-in JS debugger (js-debug / pwa-chrome) and the
 * actual UXP WebSocket endpoint exposed by the Adobe host application.
 *
 * Why do we need this?
 * --------------------
 * The UXP runtime may not behave exactly like a standard Chrome target.
 * The proxy allows us to:
 *  1. Translate / filter CDP messages if the UXP runtime uses a slightly
 *     different dialect or is missing expected domains.
 *  2. Inject synthetic responses (e.g. for Runtime.executionContextCreated)
 *     that js-debug expects but UXP might not send.
 *  3. Rewrite paths in Debugger.scriptParsed so that local source maps
 *     resolve correctly.
 *  4. Log all traffic for diagnostics without touching either endpoint.
 *
 * Architecture (inspired by microsoft/vscode-cdp-proxy):
 *
 *   js-debug  <──WebSocket──>  CdpProxyServer  <──WebSocket──>  UXP host
 *              (localhost:N)                      (target ws URL)
 */
export class CdpProxyServer {
    /** URL path DevTools-panel clients (HTML inspector webviews) connect to. */
    static readonly PANEL_PATH = "/panel";

    /**
   * CDP method prefixes never forwarded from panel clients. Precedent: an
   * unexpected eval (js-debug's autoAttachChildProcesses probe) crashed
   * Photoshop outright — a modern DevTools frontend sends many methods the
   * UXP runtime has never seen, so anything with no business against UXP is
   * answered locally with a "not supported" error instead of forwarded.
   */
    private static readonly PANEL_METHOD_DENYLIST = [
        "Page.startScreencast",
        "Target.",
        "Emulation.",
        "ServiceWorker.",
        "Storage.",
        "Tracing.",
    ];

    private readonly targetWsUrl: string;
    private readonly targetLabel: string;
    private readonly log: vscode.OutputChannel;
    private httpServer: http.Server | undefined;
    private targetWs: WebSocket | undefined;
    private clientWs: WebSocket | undefined;

    /** Connected DevTools-panel clients (HTML inspector webviews). */
    private readonly panelClients = new Set<WebSocket>();

    /**
   * Remap table for panel-client request ids. Panel ids start at 1 like
   * js-debug's, so they are rewritten into a private range before being
   * forwarded and restored on the way back (`nextPanelForwardId`). `method`
   * is tracked so the reply route can react to specific methods (see
   * `routeToPanelClients`'s `Runtime.enable` handling).
   */
    private readonly panelPendingRequests = new Map<
        number,
        { ws: WebSocket; originalId: number; method: string | undefined }
    >();

    /**
   * Panel clients that already had the cached execution context replayed
   * to them (see `routeToPanelClients`) — guards against replaying it more
   * than once per connection.
   */
    private readonly panelContextReplayed = new WeakSet<WebSocket>();

    /** Outgoing ids for panel requests — above js-debug's ids and the rewriter's 900k internals. */
    private nextPanelForwardId = 1_000_000;

    /** Guards against parallel connectToTarget() calls when two clients connect at once. */
    private targetConnecting = false;

    /** Whether the proxy is intentionally stopping (suppress reconnect). */
    private stopping = false;

    /** Whether the target WebSocket is open and ready to receive messages. */
    private targetOpen = false;

    /** Messages queued while (re)connecting to the UXP target. */
    private readonly pendingMessages: string[] = [];

    /** Handles all CDP message rewriting and context-tracking state. */
    private readonly rewriter: CdpMessageRewriter;

    /**
   * Whether this session was loaded with `breakOnStart:true` and is still
   * paused waiting for the debugger.
   *
   * UXP freezes *before* creating an execution context, while js-debug
   * refuses to configure anything until a context exists — so the proxy has
   * to send the resume nudge itself. To keep startup breakpoints from being
   * missed, it first arms V8's native
   * `Debugger.setInstrumentationBreakpoint({instrumentation:
   * "beforeScriptWithSourceMapExecution"})`: the runtime then pauses before
   * executing each sourcemapped script (reason "instrumentation"), and
   * js-debug handles those pauses natively — it loads the script's source
   * map, binds the pending breakpoints and silently resumes. This is the
   * same mechanism Chrome DevTools uses for sourcemapped page scripts.
   */
    private breakOnStartPending: boolean;

    /**
   * Set once the instrumentation breakpoint was armed. UXP's own
   * break-on-start fires on the *first statement executed* — typically one
   * of js-debug's `Runtime.evaluate` probes, not plugin code. That spurious
   * pause (and its `Debugger.resumed`) is swallowed and auto-resumed; the
   * flag clears on the first instrumentation pause, which js-debug handles
   * itself (see `breakOnStartPending`).
   */
    private awaitingBreakOnStartPause = false;

    /** Request id of the internal `Debugger.setInstrumentationBreakpoint` (reply logging). */
    private instrumentationRequestId: number | undefined;

    /**
   * Breakpoint id of the armed instrumentation breakpoint. js-debug
   * (`pauseForSourceMap: true`) arms the same breakpoint itself, but UXP
   * rejects the duplicate ("already enabled") and js-debug then wouldn't
   * recognise the startup pause as its own sourcemap pause. The proxy
   * therefore swallows js-debug's request and replies with this id, making
   * js-debug adopt the breakpoint and handle its pauses natively.
   */
    private instrumentationBreakpointId: string | undefined;

    /**
   * scriptIds seen in a `Debugger.scriptParsed` whose (pre-rewrite) `url` is
   * neither one of js-debug's own `eval-*.cdp` probes nor a
   * `uxp://uxp-internal/...` host script — i.e. real plugin/script code.
   * Confirmed via a live trace (2026-08-19): UXP's instrumentation
   * breakpoint does NOT reliably pause before the entry script's own
   * top-level code runs, so a `debugger;` statement (or a user breakpoint)
   * hit inside it was being misclassified as the expected "spurious /
   * pre-context" pause and silently swallowed — see `handleBreakOnStartMessage`.
   * A pause whose top frame is in this set is never spurious, regardless of
   * `reason`.
   */
    private readonly realScriptIds = new Set<string>();

    /** js-debug's own dynamic probe/REPL evals (`//# sourceURL=eval-<hex>.cdp`) — never real plugin code. */
    private static readonly EVAL_PROBE_URL = /^eval-[0-9a-f]+\.cdp$/;

    /** Max number of reconnect attempts before giving up. */
    private static readonly MAX_RECONNECT_ATTEMPTS = 20;

    /** Delay (ms) between reconnect attempts. */
    private static readonly RECONNECT_DELAY_MS = 1_500;

    constructor(
        targetWsUrl: string,
        targetLabel: string,
        pluginDir: string,
        log: vscode.OutputChannel,
        breakOnStartPending = false,
    ) {
        this.targetWsUrl = targetWsUrl;
        this.targetLabel = targetLabel;
        this.log = log;
        this.breakOnStartPending = breakOnStartPending;
        this.rewriter = new CdpMessageRewriter(
            pluginDir,
            log,
            (msg) => {
                if (this.clientWs?.readyState === WebSocket.OPEN) {
                    this.clientWs.send(msg);
                }
            },
            () => {
                void this.stop();
            },
            (msg) => {
                if (this.targetOpen) {
                    this.logTraffic("js-debug → UXP", msg);
                    this.targetWs?.send(msg);
                }
                else {
                    this.pendingMessages.push(msg);
                }
            },
        );
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
   * Start the proxy on a random available port and return that port number.
   * The proxy will accept exactly one WebSocket connection from js-debug,
   * and forward traffic to/from the UXP target.
   */
    async start(): Promise<number> {
    // Determine target ID based on connection type.
        let targetId: string;
        if (this.targetWsUrl.includes("/socket/cdt/")) {
            // Broker CDT endpoint – extract session ID from URL path.
            // /json/list is not available on the broker port (returns {}).
            targetId = this.targetWsUrl.split("/").pop() ?? "uxp-target";
            this.log.appendLine(`Broker CDT mode – using session ID as target: ${targetId}`);
        }
        else {
            // Direct plugin port – fetch real target ID from /json/list.
            targetId = await this.fetchTargetId();
        }
        this.log.appendLine(`Using target ID: ${targetId}`);

        const startServerRes = new Promise<number>((resolve, reject) => {
            this.httpServer = http.createServer((req, res) => {
                this.handleHttpRequest(req, res, targetId);
            });

            // Upgrade handler – when js-debug opens a WebSocket to us
            this.httpServer.on("upgrade", (req, socket, head) => {
                this.handleUpgrade(req, socket, head);
            });

            this.httpServer.on("error", reject);

            // Listen on port 0 → OS assigns a free port
            this.httpServer.listen(0, "127.0.0.1", () => {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const addr = this.httpServer!.address();
                if (addr && typeof addr === "object") {
                    resolve(addr.port);
                }
                else {
                    reject(new Error("Could not determine proxy port"));
                }
            });
        });

        return startServerRes;
    }

    /**
   * Arm (or disarm) break-on-start handling after construction — used when
   * the proxy was created by the inspector panel first and a debugger
   * attaches later. Only effective while the target connection hasn't
   * opened yet (once connected, the resume nudge has already been sent).
   */
    setBreakOnStartPending(pending: boolean): void {
        if (this.targetOpen || this.targetConnecting) {
            if (pending) {
                this.log.appendLine(
                    "[CDP] Ignoring breakOnStart request — target connection already established.",
                );
            }
            return;
        }
        this.breakOnStartPending = pending;
    }

    /** Rolling console/exception capture for this session's LM tools (LANGUAGE-MODEL-TOOLS.md §4). */
    getEventBuffer(): CdpEventBuffer {
        return this.rewriter.getEventBuffer();
    }

    /**
   * Evaluates a JS expression directly against the target's global execution
   * context via raw CDP `Runtime.evaluate` — used by `uxp_evaluate_global`.
   * Does not go through js-debug/DAP (see `sendRawRequestToTarget`'s doc
   * comment for why: DAP `evaluate` without a `frameId` never reaches the
   * target at all in this setup).
   */
    async evaluateInGlobalContext(
        expression: string,
    ): Promise<{ result?: unknown; error?: { message: string } }> {
        if (!this.rewriter.executionContextUniqueId) {
            throw new Error("No execution context yet for this session — the target may not be fully connected.");
        }
        const reply = await this.rewriter.sendRawRequestToTarget("Runtime.evaluate", {
            expression,
            returnByValue: true,
            includeCommandLineAPI: true,
            uniqueContextId: this.rewriter.executionContextUniqueId,
        });
        return reply;
    }

    /**
   * Gracefully shut down the proxy and close all WebSocket connections.
   */
    async stop(): Promise<void> {
        this.stopping = true;
        this.rewriter.dispose();
        this.clientWs?.close();
        for (const panelWs of this.panelClients) {
            panelWs.close();
        }
        this.panelClients.clear();
        this.panelPendingRequests.clear();
        this.targetWs?.close();
        return new Promise<void>((resolve) => {
            if (this.httpServer) {
                this.httpServer.close(() => {
                    resolve();
                });
            }
            else {
                resolve();
            }
        });
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    /**
   * Handle an incoming HTTP request from js-debug.
   * Returns synthetic CDP discovery responses for /json/version and /json/list.
   */
    private handleHttpRequest(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        targetId: string,
    ): void {
        const url = req.url ?? "/";
        res.writeHead(200, { "Content-Type": "application/json" });

        // Return custom made synthetic responses for the two "discovery" endpoints that js-debug calls
        if (url.startsWith("/json/version")) {
            // Return browser info WITHOUT a webSocketDebuggerUrl so that
            // js-debug does not attempt a browser-level CDP connection.
            // We always connect as a page target via /json/list.
            res.end(
                JSON.stringify({
                    Browser: "Adobe UXP",
                    "Protocol-Version": "1.3",
                }),
            );
        }
        else if (url.startsWith("/json/list") || url === "/json" || url === "/json/") {
            // Match the format returned by a real plugin port (e.g. 9917/json/list).
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const addr = this.httpServer!.address();
            const port = addr && typeof addr === "object" ? addr.port : 0;
            const wsUrl = `ws://127.0.0.1:${String(port)}/devtools/page/${targetId}`;
            res.end(
                JSON.stringify([
                    {
                        description: "Adobe UXP",
                        devtoolsFrontendUrl: `devtools://devtools/bundled/inspector.html?experiments=true&ws=127.0.0.1:${String(port)}/devtools/page/${targetId}`,
                        documentName: "",
                        faviconUrl: "https://wwwimages2.adobe.com/favicon.ico",
                        id: targetId,
                        title: this.targetLabel,
                        type: "page",
                        url: "",
                        webSocketDebuggerUrl: wsUrl,
                    },
                ]),
            );
        }
        else {
            res.end("{}");
        }
    }

    /**
   * Handle the WebSocket upgrade request from js-debug or from an
   * inspector-panel client (routed by URL path).
   */
    private handleUpgrade(
        _req: http.IncomingMessage,
        socket: Duplex,
        head: Buffer,
    ): void {
        const url = _req.url ?? "/";
        if (
            url === CdpProxyServer.PANEL_PATH
            || url.startsWith(`${CdpProxyServer.PANEL_PATH}?`)
        ) {
            this.handlePanelUpgrade(_req, socket, head);
            return;
        }

        // Create a WebSocket server just for this single connection
        const wss = new WebSocketServer({ noServer: true });

        wss.handleUpgrade(_req, socket, head, (clientWs) => {
            this.clientWs = clientWs;
            this.log.appendLine("js-debug connected to CDP proxy.");
            this.rewriter.markNewClient();

            // A "Restart" (debug-toolbar / F5-while-attached) closes js-debug's
            // old WebSocket to this proxy and opens a brand-new one — WITHOUT
            // going through UxpDebugSessionManager.attach() again, so this same
            // CdpProxyServer instance is reused. If the UXP target connection is
            // still open at this point, reuse it as-is instead of reconnecting:
            // the execution context, breakpoints, etc. are all still valid, and
            // forcing a reconnect here raced the target's own close→reconnect
            // (triggered below when the *old* client disconnected) — two
            // concurrent attempts to reattach to the same broker CDT session,
            // which made the broker repeatedly "replace the existing frontend",
            // reset the captured execution context, and made js-debug's
            // Runtime.evaluate probes fail with "Cannot find default execution
            // context" until the churn happened to settle.
            if (this.targetOpen || this.targetConnecting) {
                this.log.appendLine("[CDP] Reusing existing UXP target connection for new client.");
            }
            else {
                this.connectToTarget();
            }

            // ------ Forward: js-debug (client) → UXP target ------
            clientWs.on("message", (data) => {
                // WebSocket.RawData provides a meaningful text conversion for received frames.
                // eslint-disable-next-line @typescript-eslint/no-base-to-string
                const raw = data.toString();

                // breakOnStart: hand our armed instrumentation breakpoint over to
                // js-debug instead of letting UXP reject the duplicate request
                // (see `instrumentationBreakpointId`).
                if (
                    this.instrumentationBreakpointId !== undefined
                    && raw.includes("\"Debugger.setInstrumentationBreakpoint\"")
                ) {
                    try {
                        const msg = JSON.parse(raw) as CdpMessage;
                        if (msg.id !== undefined) {
                            this.log.appendLine(
                                "[CDP] Adopting js-debug's setInstrumentationBreakpoint — replying with the armed id.",
                            );
                            clientWs.send(
                                JSON.stringify({
                                    id: msg.id,
                                    result: { breakpointId: this.instrumentationBreakpointId },
                                }),
                            );
                            return;
                        }
                    }
                    catch {
                        // Fall through and forward as-is.
                    }
                }

                const rewritten = this.rewriter.rewriteFromClient(raw);
                if (rewritten !== null) {
                    if (this.targetOpen) {
                        this.logTraffic("js-debug → UXP", rewritten);
                        this.targetWs?.send(rewritten);
                    }
                    else {
                        this.pendingMessages.push(rewritten);
                    }
                }
            });

            clientWs.on("close", () => {
                this.log.appendLine("js-debug WebSocket closed.");
                // Do NOT close the UXP target connection here — a "Restart" swaps
                // js-debug's client WebSocket but expects the same target/session
                // to still be there afterwards (see the comment above, in
                // `handleUpgrade`). Only a real proxy shutdown (`stop()`) should
                // tear down the target connection; `stopping` already does that.
                if (this.stopping) {
                    this.targetWs?.close();
                }
            });

            clientWs.on("error", (err) => {
                this.log.appendLine(`js-debug client WS error: ${err.message}`);
            });
        });
    }

    // -----------------------------------------------------------------------
    // Inspector-panel clients (HTML inspector webview)
    // -----------------------------------------------------------------------

    /**
   * Handle the WebSocket upgrade of an inspector-panel client. Unlike the
   * js-debug client, panel traffic bypasses the `CdpMessageRewriter`
   * (whose logic is js-debug-specific) — it is only id-remapped and
   * safety-filtered. Multiple panel clients may be connected at once.
   */
    private handlePanelUpgrade(
        req: http.IncomingMessage,
        socket: Duplex,
        head: Buffer,
    ): void {
        const wss = new WebSocketServer({ noServer: true });
        wss.handleUpgrade(req, socket, head, (panelWs) => {
            this.panelClients.add(panelWs);
            this.log.appendLine(
                `Inspector panel connected to CDP proxy (${String(this.panelClients.size)} panel client(s)).`,
            );

            if (this.targetOpen || this.targetConnecting) {
                this.log.appendLine("[CDP] Reusing existing UXP target connection for the inspector panel.");
            }
            else {
                this.connectToTarget();
            }

            panelWs.on("message", (data) => {
                // WebSocket.RawData provides a meaningful text conversion for received frames.
                // eslint-disable-next-line @typescript-eslint/no-base-to-string
                this.handlePanelMessage(panelWs, data.toString());
            });

            panelWs.on("close", () => {
                this.panelClients.delete(panelWs);
                this.panelContextReplayed.delete(panelWs);
                for (const [forwardId, entry] of this.panelPendingRequests) {
                    if (entry.ws === panelWs) {
                        this.panelPendingRequests.delete(forwardId);
                    }
                }
                this.log.appendLine("Inspector panel WebSocket closed.");
            });

            panelWs.on("error", (err) => {
                this.log.appendLine(`Inspector panel WS error: ${err.message}`);
            });
        });
    }

    /** Whether a panel-client CDP method is blocked from reaching the host. */
    private static isPanelMethodDenied(method: string): boolean {
        return CdpProxyServer.PANEL_METHOD_DENYLIST.some((prefix) => method.startsWith(prefix));
    }

    /** Forward one message from a panel client to the target (id-remapped + filtered). */
    private handlePanelMessage(panelWs: WebSocket, raw: string): void {
        let msg: CdpMessage;
        try {
            msg = JSON.parse(raw) as CdpMessage;
        }
        catch {
            this.log.appendLine("[CDP][panel] Dropped unparseable message from the inspector panel.");
            return;
        }

        const method = typeof msg.method === "string" ? msg.method : undefined;
        if (method !== undefined && CdpProxyServer.isPanelMethodDenied(method)) {
            this.log.appendLine(`[CDP][panel] Denied method (answered locally): ${method}`);
            if (typeof msg.id === "number" && panelWs.readyState === WebSocket.OPEN) {
                panelWs.send(
                    JSON.stringify({
                        id: msg.id,
                        error: { code: -32601, message: `'${method}' is not supported by UXP` },
                    }),
                );
            }
            return;
        }

        // UXP identifies the execution context by `uniqueContextId` (a string),
        // not the standard CDP context param the DevTools frontend's Console
        // sends with every evaluation/call — `contextId` for Runtime.evaluate,
        // `executionContextId` for Runtime.callFunctionOn. Without this
        // translation (done for js-debug's own requests in
        // `CdpMessageRewriter.rewriteFromClient`) UXP rejects the request and
        // the Console never shows a result.
        const params:
            | CdpPayload<Protocol.Runtime.EvaluateRequest>
            | CdpPayload<Protocol.Runtime.CallFunctionOnRequest>
            | undefined = msg.params;
        const hasContextParam = params !== undefined
            && ("contextId" in params || "executionContextId" in params);
        if (params && hasContextParam) {
            delete params.contextId;
            delete params.executionContextId;
            if (this.rewriter.executionContextUniqueId) {
                params.uniqueContextId = this.rewriter.executionContextUniqueId;
            }
            else if (typeof msg.id === "number" && panelWs.readyState === WebSocket.OPEN) {
                this.log.appendLine(
                    `[CDP][panel] ${String(method)} — no execution context yet, answering locally.`,
                );
                panelWs.send(
                    JSON.stringify({
                        id: msg.id,
                        error: { code: -32000, message: "No execution context available yet." },
                    }),
                );
                return;
            }
        }

        let outgoing = JSON.stringify(msg);
        if (typeof msg.id === "number") {
            const forwardId = this.nextPanelForwardId++;
            this.panelPendingRequests.set(forwardId, { ws: panelWs, originalId: msg.id, method });
            outgoing = JSON.stringify({ ...msg, id: forwardId });
        }

        if (this.targetOpen) {
            this.logTraffic("panel → UXP", outgoing);
            this.targetWs?.send(outgoing);
        }
        else {
            this.pendingMessages.push(outgoing);
        }
    }

    /**
   * Deliver target messages belonging to panel clients. Returns `true` when
   * the message was a reply to a panel request (fully consumed); events
   * (no id) are broadcast raw to every panel client but still flow on to
   * js-debug via the normal rewriter path.
   */
    private routeToPanelClients(raw: string): boolean {
        if (this.panelClients.size === 0 && this.panelPendingRequests.size === 0) {
            return false;
        }
        let msg: CdpMessage;
        try {
            msg = JSON.parse(raw) as CdpMessage;
        }
        catch {
            return false;
        }

        if (typeof msg.id === "number") {
            const pending = this.panelPendingRequests.get(msg.id);
            if (!pending) {
                return false; // js-debug's or an internal reply — not ours
            }
            this.panelPendingRequests.delete(msg.id);
            if (pending.ws.readyState === WebSocket.OPEN) {
                this.logTraffic("UXP → panel", raw);
                pending.ws.send(JSON.stringify({ ...msg, id: pending.originalId }));

                // Only once its own `Runtime.enable` is acknowledged does the
                // DevTools frontend's RuntimeModel trust `executionContextCreated`
                // events — replaying the cached one any earlier (e.g. right on
                // connect, before the frontend's own bootstrap even runs) gets it
                // silently ignored, leaving the Console with no context to
                // evaluate against.
                if (
                    pending.method === "Runtime.enable"
                    && !this.panelContextReplayed.has(pending.ws)
                ) {
                    const cachedContext = this.rewriter.getLastExecutionContextCreatedRaw();
                    if (cachedContext) {
                        this.panelContextReplayed.add(pending.ws);
                        this.log.appendLine(
                            "[CDP][panel] Replaying cached execution context after Runtime.enable ack.",
                        );
                        pending.ws.send(cachedContext);
                    }
                }
            }
            return true;
        }

        // Event — broadcast the unrewritten stream to every panel client.
        for (const panelWs of this.panelClients) {
            if (panelWs.readyState === WebSocket.OPEN) {
                panelWs.send(raw);
            }
        }
        return false;
    }

    // -----------------------------------------------------------------------
    // Target WebSocket connection (with reconnect support)
    // -----------------------------------------------------------------------

    /**
   * Open a WebSocket to the UXP target. On close, automatically reconnect
   * (with retries) unless the proxy is intentionally stopping, so that
   * operations like `location.reload()` don't kill the debug session.
   */
    private connectToTarget(): void {
        this.targetOpen = false;
        this.targetConnecting = true;
        this.targetWs = new WebSocket(this.targetWsUrl);

        this.targetWs.on("open", () => {
            this.log.appendLine(`Connected to UXP target: ${this.targetWsUrl}`);
            this.targetOpen = true;
            this.targetConnecting = false;

            // Flush any messages that arrived while we were (re)connecting.
            for (const queued of this.pendingMessages) {
                this.logTraffic("js-debug → UXP (queued)", queued);
                this.targetWs?.send(queued);
            }
            this.pendingMessages.length = 0;

            // Start a timer — if we don't receive an execution context within
            // the timeout the plugin is probably not loaded in the host app.
            this.rewriter.startContextTimeout();

            // Enable the Runtime domain so that Runtime.evaluate works.
            const enableId = this.rewriter.allocateInternalId("Runtime.enable");
            this.targetWs?.send(
                JSON.stringify({ id: enableId, method: "Runtime.enable", params: {} }),
            );

            // Some hosts (e.g. UXP `runScript`, and `Plugin/load` with
            // `breakOnStart:true`) pause the runtime immediately on connect and
            // log "Waiting for the debugger to attach ... to continue the
            // execution" — they need an explicit nudge to resume, exactly like
            // Chrome DevTools itself sends unconditionally right after
            // `Runtime.enable`. Without this, UXP never creates an execution
            // context and js-debug (which waits for that context before doing
            // anything else) stalls until our own timeout tears the session down.
            // A no-op if the target wasn't actually waiting.
            //
            // For a `breakOnStart` session, arm V8's instrumentation breakpoint
            // *before* the nudge — the runtime then pauses before executing each
            // sourcemapped (plugin) script and js-debug binds the startup
            // breakpoints during that pause (see `breakOnStartPending`).
            if (this.breakOnStartPending) {
                this.breakOnStartPending = false;
                this.awaitingBreakOnStartPause = true;
                this.log.appendLine(
                    "[CDP] breakOnStart session — arming an instrumentation breakpoint before resuming the runtime.",
                );
                const debuggerEnableId = this.rewriter.allocateInternalId("Debugger.enable");
                this.targetWs?.send(
                    JSON.stringify({ id: debuggerEnableId, method: "Debugger.enable", params: {} }),
                );
                this.instrumentationRequestId = this.rewriter.allocateInternalId(
                    "Debugger.setInstrumentationBreakpoint",
                );
                this.targetWs?.send(
                    JSON.stringify({
                        id: this.instrumentationRequestId,
                        method: "Debugger.setInstrumentationBreakpoint",
                        params: { instrumentation: "beforeScriptWithSourceMapExecution" },
                    }),
                );
            }
            this.sendResumeNudge();
        });

        // ------ Forward: UXP target → clients ------
        this.targetWs.on("message", (data) => {
            // WebSocket.RawData provides a meaningful text conversion for received frames.
            // eslint-disable-next-line @typescript-eslint/no-base-to-string
            let raw: string | null = data.toString();

            // Replies to inspector-panel requests are consumed here; events are
            // broadcast to panel clients and continue to js-debug below.
            if (this.routeToPanelClients(raw)) {
                return;
            }

            this.trackRealScriptId(raw);

            if (this.awaitingBreakOnStartPause) {
                raw = this.handleBreakOnStartMessage(raw);
                if (raw === null) {
                    return; // swallowed (spurious pause / its resumed event)
                }
            }

            const rewritten = this.rewriter.rewriteFromTarget(raw);
            if (rewritten !== null) {
                this.logTraffic("UXP → js-debug", rewritten);
                // During the brief gap of a "Restart" (old client gone, new one not
                // attached yet) the target connection is kept alive and may still
                // emit messages — guard against sending into an already-closed
                // socket rather than throwing.
                if (this.clientWs?.readyState === WebSocket.OPEN) {
                    this.clientWs.send(rewritten);
                }
            }
        });

        this.targetWs.on("close", () => {
            this.log.appendLine("UXP target WebSocket closed.");
            this.targetOpen = false;
            this.targetConnecting = false;
            this.rewriter.resetContextState();
            if (!this.stopping) {
                this.reconnectToTarget();
            }
        });

        this.targetWs.on("error", (err) => {
            this.log.appendLine(`UXP target WS error: ${err.message}`);
        });
    }

    /**
   * Records `scriptId`s belonging to real plugin/script code (as opposed to
   * js-debug's own `eval-*.cdp` probes) from `Debugger.scriptParsed` events —
   * see `realScriptIds`. Called unconditionally (not just during
   * break-on-start) since it's cheap and the set is only ever consulted
   * during that phase.
   */
    private trackRealScriptId(raw: string): void {
        try {
            const msg = JSON.parse(raw) as CdpMessage;
            const params: CdpPayload<Protocol.Debugger.ScriptParsedEvent> | undefined = msg.params;
            if (
                msg.method === "Debugger.scriptParsed"
                && typeof params?.url === "string"
                && typeof params.scriptId === "string"
                && !CdpProxyServer.EVAL_PROBE_URL.test(params.url)
                && !params.url.startsWith("uxp://uxp-internal/")
            ) {
                this.realScriptIds.add(params.scriptId);
            }
        }
        catch {
            // Not parseable — nothing to track.
        }
    }

    /**
   * Send the "go ahead" nudge that resumes a runtime paused waiting for the
   * debugger. A no-op if the target wasn't actually waiting.
   */
    private sendResumeNudge(): void {
        const runIfWaitingId = this.rewriter.allocateInternalId(
            "Runtime.runIfWaitingForDebugger",
        );
        this.targetWs?.send(
            JSON.stringify({ id: runIfWaitingId, method: "Runtime.runIfWaitingForDebugger", params: {} }),
        );
    }

    /**
   * Target-message handling while the break-on-start startup phase is
   * active (see `awaitingBreakOnStartPause`).
   *
   *  - The first pause with reason "instrumentation", a hit user breakpoint,
   *    or whose top frame belongs to real plugin/script code (`realScriptIds`
   *    — e.g. a `debugger;` statement in the entry script) ends the phase
   *    and is forwarded. The last case was added 2026-08-19 after a live
   *    trace showed UXP does not always actually pause on
   *    "beforeScriptWithSourceMapExecution" before the entry script's own
   *    top-level code runs — without it, a `debugger;` statement (or a real
   *    breakpoint) hit inside that code was wrongly swallowed as spurious.
   *  - Any earlier pause is UXP's own break-on-start firing on the first
   *    statement executed (typically a js-debug `Runtime.evaluate` probe);
   *    it is swallowed and auto-resumed, as is its `Debugger.resumed`.
   *
   * Returns the message, or `null` to swallow it.
   */
    private handleBreakOnStartMessage(raw: string): string | null {
        try {
            const msg = JSON.parse(raw) as CdpMessage;

            if (msg.id !== undefined && msg.id === this.instrumentationRequestId) {
                // Reply is swallowed as internal by the rewriter; log it verbatim so
                // missing host support (an error reply) is diagnosable.
                const result:
                    CdpPayload<Protocol.Debugger.SetInstrumentationBreakpointResponse> | undefined = msg.result;
                this.instrumentationBreakpointId = result?.breakpointId;
                this.log.appendLine(`[CDP] Instrumentation breakpoint reply: ${raw}`);
                return raw;
            }

            if (msg.method === "Debugger.paused") {
                const params: CdpPayload<Protocol.Debugger.PausedEvent> | undefined = msg.params;
                const hitUserBp
                    = Array.isArray(params?.hitBreakpoints) && params.hitBreakpoints.length > 0;
                const topScriptId = params?.callFrames?.[0]?.location?.scriptId;
                const inRealScript = typeof topScriptId === "string" && this.realScriptIds.has(topScriptId);
                if (params?.reason === "instrumentation" || hitUserBp || inRealScript) {
                    this.awaitingBreakOnStartPause = false;
                    this.log.appendLine(
                        inRealScript && params?.reason !== "instrumentation" && !hitUserBp
                            ? "[CDP] Pause inside real plugin/script code (e.g. a debugger; statement) — handing over to js-debug."
                            : "[CDP] Startup instrumentation pause — handing over to js-debug.",
                    );
                    return raw;
                }
                // Spurious pause — swallow it and resume so execution reaches the
                // plugin's sourcemapped scripts, where the instrumentation
                // breakpoint is waiting.
                this.log.appendLine("[CDP] Swallowed spurious break-on-start pause — auto-resuming.");
                const resumeId = this.rewriter.allocateInternalId("Debugger.resume");
                this.targetWs?.send(
                    JSON.stringify({ id: resumeId, method: "Debugger.resume", params: {} }),
                );
                return null;
            }

            if (msg.method === "Debugger.resumed") {
                // Follows a swallowed spurious pause — js-debug never saw the pause,
                // so hide the resume as well.
                return null;
            }
        }
        catch {
            // Not parseable — forward as-is.
        }
        return raw;
    }

    /**
   * Retry connecting to the UXP target with exponential-ish backoff.
   * Gives up after MAX_RECONNECT_ATTEMPTS and closes the client connection.
   */
    private reconnectToTarget(attempt = 1): void {
        if (this.stopping) {
            return;
        }
        if (attempt > CdpProxyServer.MAX_RECONNECT_ATTEMPTS) {
            this.log.appendLine(
                `[CDP] Gave up reconnecting after ${String(CdpProxyServer.MAX_RECONNECT_ATTEMPTS)} attempts.`,
            );
            vscode.window.showErrorMessage(
                "UXP Debugger: Lost connection to the plugin and could not reconnect.",
            );
            this.clientWs?.close();
            for (const panelWs of this.panelClients) {
                panelWs.close();
            }
            return;
        }

        this.log.appendLine(
            `[CDP] Reconnect attempt ${String(attempt)}/${String(CdpProxyServer.MAX_RECONNECT_ATTEMPTS)} `
            + `in ${String(CdpProxyServer.RECONNECT_DELAY_MS)}ms…`,
        );

        setTimeout(() => {
            if (this.stopping) {
                return;
            }
            this.connectToTarget();

            // If this attempt fails (target WS closes immediately), the "close"
            // handler in connectToTarget will call reconnectToTarget(attempt + 1).
            const currentWs = this.targetWs;
            // Replace the default close→reconnect handler for this attempt so
            // the counter increments properly.
            currentWs?.removeAllListeners("close");
            currentWs?.on("close", () => {
                this.log.appendLine("UXP target WebSocket closed.");
                // Capture before clearing — reaching OPEN means this attempt succeeded.
                const reachedOpen = this.targetOpen;
                this.targetOpen = false;
                this.targetConnecting = false;
                this.rewriter.resetContextState();
                if (this.stopping) {
                    return;
                }
                // A drop after a successful reconnect starts a fresh retry cycle;
                // a failed attempt bumps the counter.
                this.reconnectToTarget(reachedOpen ? 1 : attempt + 1);
            });
        }, CdpProxyServer.RECONNECT_DELAY_MS);
    }

    // -----------------------------------------------------------------------
    // Target ID fetching
    // -----------------------------------------------------------------------

    /**
   * Fetch `/json/list` from the real UXP host and return the `id` of the
   * matching target entry. Rejects if the ID cannot be determined.
   */
    private fetchTargetId(): Promise<string> {
        const parsed = new URL(this.targetWsUrl);
        const listUrl = `http://${parsed.hostname}:${parsed.port}/json/list`;

        return new Promise<string>((resolve, reject) => {
            const req = http.get(listUrl, { timeout: 2000 }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`/json/list returned HTTP ${String(res.statusCode)}`));
                    return;
                }
                const chunks: Buffer[] = [];
                res.on("data", (chunk: Buffer) => chunks.push(chunk));
                res.on("end", () => {
                    try {
                        const entries = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as unknown;
                        if (Array.isArray(entries)) {
                            // Try to find the entry whose webSocketDebuggerUrl matches ours
                            const discoveryEntries = entries.filter(
                                (entry): entry is CdpDiscoveryEntry => entry !== null && typeof entry === "object",
                            );
                            const match = discoveryEntries.find(
                                (entry) => entry.webSocketDebuggerUrl === this.targetWsUrl,
                            );
                            const entry = match ?? discoveryEntries[0];
                            if (typeof entry.id === "string") {
                                resolve(entry.id);
                                return;
                            }
                        }
                    }
                    catch { /* parse error */ }
                    reject(new Error("Could not determine target ID from /json/list"));
                });
                res.on("error", (err) => {
                    reject(err);
                });
            });
            req.on("timeout", () => {
                req.destroy();
                reject(new Error("/json/list request timed out"));
            });
            req.on("error", (err) => {
                reject(err);
            });
        });
    }

    // -----------------------------------------------------------------------
    // Diagnostic logging
    // -----------------------------------------------------------------------

    /**
   * Log a CDP message to the output channel (truncated for readability).
   */
    private logTraffic(direction: string, raw: string): void {
        const maxLen = 500;
        const truncated = raw.length > maxLen ? raw.slice(0, maxLen) + "…" : raw;
        this.log.appendLine(`[CDP] ${direction}: ${truncated}`);
    }
}
