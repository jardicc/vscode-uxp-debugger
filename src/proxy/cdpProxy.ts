import * as http from "http";
import * as vscode from "vscode";
import WebSocket, { WebSocketServer } from "ws";
import { CdpMessageRewriter } from "./cdpMessageRewriter";

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
  private readonly targetWsUrl: string;
  private readonly targetLabel: string;
  private readonly pluginDir: string;
  private readonly log: vscode.OutputChannel;
  private httpServer: http.Server | undefined;
  private targetWs: WebSocket | undefined;
  private clientWs: WebSocket | undefined;

  /** Whether the proxy is intentionally stopping (suppress reconnect). */
  private stopping = false;

  /** Whether the target WebSocket is open and ready to receive messages. */
  private targetOpen = false;

  /** Messages queued while (re)connecting to the UXP target. */
  private readonly pendingMessages: string[] = [];

  /** Handles all CDP message rewriting and context-tracking state. */
  private readonly rewriter: CdpMessageRewriter;

  /** Max number of reconnect attempts before giving up. */
  private static readonly MAX_RECONNECT_ATTEMPTS = 20;

  /** Delay (ms) between reconnect attempts. */
  private static readonly RECONNECT_DELAY_MS = 1_500;

  constructor(targetWsUrl: string, targetLabel: string, pluginDir: string, log: vscode.OutputChannel) {
    this.targetWsUrl = targetWsUrl;
    this.targetLabel = targetLabel;
    this.pluginDir = pluginDir;
    this.log = log;
    this.rewriter = new CdpMessageRewriter(
      pluginDir,
      log,
      (msg) => this.clientWs?.send(msg),
      () => this.stop(),
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
      // UDT Service relay – extract session ID from URL path.
      // /json/list is not available on the UDT Service port (returns {}).
      targetId = this.targetWsUrl.split("/").pop() || "uxp-target";
      this.log.appendLine(`UDT relay mode – using session ID as target: ${targetId}`);
    } else {
      // Direct plugin port – fetch real target ID from /json/list.
      targetId = await this.fetchTargetId();
    }
    this.log.appendLine(`Using target ID: ${targetId}`);

    const startServerRes = new Promise<number>((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => this.handleHttpRequest(req, res, targetId));

      // Upgrade handler – when js-debug opens a WebSocket to us
      this.httpServer.on("upgrade", (req, socket, head) => {
        this.handleUpgrade(req, socket, head);
      });

      this.httpServer.on("error", reject);

      // Listen on port 0 → OS assigns a free port
      this.httpServer.listen(0, "127.0.0.1", () => {
        const addr = this.httpServer!.address();
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        } else {
          reject(new Error("Could not determine proxy port"));
        }
      });
    });

    return startServerRes;
  }

  /**
   * Gracefully shut down the proxy and close all WebSocket connections.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    this.rewriter.dispose();
    this.clientWs?.close();
    this.targetWs?.close();
    return new Promise<void>((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => resolve());
      } else {
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
    targetId: string
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
        })
      );
    } else if (url.startsWith("/json/list") || url === "/json" || url === "/json/") {
      // Match the format returned by a real plugin port (e.g. 9917/json/list).
      const addr = this.httpServer!.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      const wsUrl = `ws://127.0.0.1:${port}/devtools/page/${targetId}`;
      res.end(
        JSON.stringify([
          {
            description: "Adobe UXP",
            devtoolsFrontendUrl: `devtools://devtools/bundled/inspector.html?experiments=true&ws=127.0.0.1:${port}/devtools/page/${targetId}`,
            documentName: "",
            faviconUrl: "https://wwwimages2.adobe.com/favicon.ico",
            id: targetId,
            title: this.targetLabel,
            type: "page",
            url: "",
            webSocketDebuggerUrl: wsUrl,
          },
        ])
      );
    } else {
      res.end("{}");
    }
  }

  /**
   * Handle the WebSocket upgrade request from js-debug.
   */
  private handleUpgrade(
    _req: http.IncomingMessage,
    socket: import("stream").Duplex,
    head: Buffer
  ): void {
    // Create a WebSocket server just for this single connection
    const wss = new WebSocketServer({ noServer: true });

    wss.handleUpgrade(_req, socket, head, (clientWs) => {
      this.clientWs = clientWs;
      this.log.appendLine("js-debug connected to CDP proxy.");

      this.connectToTarget();

      // ------ Forward: js-debug (client) → UXP target ------
      clientWs.on("message", (data) => {
        const raw = data.toString();
        const rewritten = this.rewriter.rewriteFromClient(raw);
        if (rewritten !== null) {
          if (this.targetOpen) {
            this.logTraffic("js-debug → UXP", rewritten);
            this.targetWs?.send(rewritten);
          } else {
            this.pendingMessages.push(rewritten);
          }
        }
      });

      clientWs.on("close", () => {
        this.log.appendLine("js-debug WebSocket closed.");
        this.targetWs?.close();
      });

      clientWs.on("error", (err) => {
        this.log.appendLine(`js-debug client WS error: ${err.message}`);
      });
    });
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
    this.targetWs = new WebSocket(this.targetWsUrl);

    this.targetWs.on("open", () => {
      this.log.appendLine(`Connected to UXP target: ${this.targetWsUrl}`);
      this.targetOpen = true;

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
        JSON.stringify({ id: enableId, method: "Runtime.enable", params: {} })
      );
    });

    // ------ Forward: UXP target → js-debug (client) ------
    this.targetWs.on("message", (data) => {
      const raw = data.toString();
      const rewritten = this.rewriter.rewriteFromTarget(raw);
      if (rewritten !== null) {
        this.logTraffic("UXP → js-debug", rewritten);
        this.clientWs?.send(rewritten);
      }
    });

    this.targetWs.on("close", () => {
      this.log.appendLine("UXP target WebSocket closed.");
      this.targetOpen = false;
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
   * Retry connecting to the UXP target with exponential-ish backoff.
   * Gives up after MAX_RECONNECT_ATTEMPTS and closes the client connection.
   */
  private reconnectToTarget(attempt = 1): void {
    if (this.stopping) { return; }
    if (attempt > CdpProxyServer.MAX_RECONNECT_ATTEMPTS) {
      this.log.appendLine(
        `[CDP] Gave up reconnecting after ${CdpProxyServer.MAX_RECONNECT_ATTEMPTS} attempts.`
      );
      vscode.window.showErrorMessage(
        "UXP Debugger: Lost connection to the plugin and could not reconnect."
      );
      this.clientWs?.close();
      return;
    }

    this.log.appendLine(
      `[CDP] Reconnect attempt ${attempt}/${CdpProxyServer.MAX_RECONNECT_ATTEMPTS} ` +
      `in ${CdpProxyServer.RECONNECT_DELAY_MS}ms…`
    );

    setTimeout(() => {
      if (this.stopping) { return; }
      this.connectToTarget();

      // If this attempt fails (target WS closes immediately), the "close"
      // handler in connectToTarget will call reconnectToTarget(attempt + 1).
      const currentWs = this.targetWs;
      const onCloseRetry = () => {
        // Only bump attempt if we never reached OPEN state.
        if (!this.targetOpen && !this.stopping) {
          this.reconnectToTarget(attempt + 1);
        }
      };
      // Replace the default close→reconnect handler for this attempt so
      // the counter increments properly.
      currentWs?.removeAllListeners("close");
      currentWs?.on("close", () => {
        this.log.appendLine("UXP target WebSocket closed.");
        this.targetOpen = false;
        this.rewriter.resetContextState();
        onCloseRetry();
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
          reject(new Error(`/json/list returned HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const entries = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            if (Array.isArray(entries)) {
              // Try to find the entry whose webSocketDebuggerUrl matches ours
              const match = entries.find(
                (e: Record<string, unknown>) => e.webSocketDebuggerUrl === this.targetWsUrl
              );
              const entry = match ?? entries[0];
              if (entry && typeof entry.id === "string") {
                resolve(entry.id);
                return;
              }
            }
          } catch { /* parse error */ }
          reject(new Error("Could not determine target ID from /json/list"));
        });
        res.on("error", (err) => reject(err));
      });
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("/json/list request timed out"));
      });
      req.on("error", (err) => reject(err));
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
