import * as http from "http";
import * as vscode from "vscode";
import WebSocket, { WebSocketServer } from "ws";

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
  private readonly log: vscode.OutputChannel;
  private httpServer: http.Server | undefined;
  private targetWs: WebSocket | undefined;
  private clientWs: WebSocket | undefined;

  /** IDs used for proxy-initiated CDP messages (not forwarded back to js-debug).
   *  Must be positive – UXP uses jsoncpp which deserializes `id` as UInt and
   *  rejects negative values with "LargestInt out of UInt range". */
  private nextInternalId = 900_000;
  private readonly internalIds = new Map<number, string>();

  /** Tracks pending Runtime.evaluate request IDs to intercept error responses. */
  private readonly pendingEvaluateIds = new Set<number>();

  /** The uniqueId from the latest Runtime.executionContextCreated event. */
  private executionContextUniqueId: string | undefined;

  constructor(targetWsUrl: string, targetLabel: string, log: vscode.OutputChannel) {
    this.targetWsUrl = targetWsUrl;
    this.targetLabel = targetLabel;
    this.log = log;
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
    // Fetch the real target ID from the UXP host's /json/list endpoint.
    const targetId = await this.fetchTargetId();
    this.log.appendLine(`Using target ID: ${targetId}`);

    return new Promise<number>((resolve, reject) => {

      this.httpServer = http.createServer((req, res) => {
        const url = req.url ?? "/";
        res.writeHead(200, { "Content-Type": "application/json" });

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
      });

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
  }

  /**
   * Gracefully shut down the proxy and close all WebSocket connections.
   */
  async stop(): Promise<void> {
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

      // Connect to the real UXP target
      this.targetWs = new WebSocket(this.targetWsUrl);

      this.targetWs.on("open", () => {
        this.log.appendLine(`Connected to UXP target: ${this.targetWsUrl}`);

        // Enable the Runtime domain so that Runtime.evaluate works.
        // UXP may ignore this, but some runtimes require it.
        const enableId = this.nextInternalId++;
        this.internalIds.set(enableId, "Runtime.enable");
        this.targetWs?.send(
          JSON.stringify({ id: enableId, method: "Runtime.enable", params: {} })
        );
      });

      // ------ Forward: UXP target → js-debug (client) ------
      this.targetWs.on("message", (data) => {
        const raw = data.toString();
        const rewritten = this.rewriteFromTarget(raw);
        if (rewritten !== null) {
          this.logTraffic("UXP → js-debug", rewritten);
          clientWs.send(rewritten);
        }
      });

      // ------ Forward: js-debug (client) → UXP target ------
      clientWs.on("message", (data) => {
        const raw = data.toString();
        const rewritten = this.rewriteFromClient(raw);
        if (rewritten !== null) {
          this.logTraffic("js-debug → UXP", rewritten);
          this.targetWs?.send(rewritten);
        }
      });

      // ------ Connection lifecycle ------
      this.targetWs.on("close", () => {
        this.log.appendLine("UXP target WebSocket closed.");
        clientWs.close();
      });

      clientWs.on("close", () => {
        this.log.appendLine("js-debug WebSocket closed.");
        this.targetWs?.close();
      });

      this.targetWs.on("error", (err) => {
        this.log.appendLine(`UXP target WS error: ${err.message}`);
      });

      clientWs.on("error", (err) => {
        this.log.appendLine(`js-debug client WS error: ${err.message}`);
      });
    });
  }

  // -----------------------------------------------------------------------
  // Message rewriting hooks
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
  private rewriteFromTarget(raw: string): string | null {
    try {
      const msg = JSON.parse(raw);

      // Swallow responses to proxy-internal requests (e.g. Runtime.enable)
      if (msg.id !== undefined && this.internalIds.has(msg.id)) {
        const method = this.internalIds.get(msg.id);
        this.internalIds.delete(msg.id);
        this.log.appendLine(`[CDP] Swallowed internal response id=${msg.id} method=${method}`);
        return null;
      }

      // If UXP returned an error for a Runtime.evaluate request,
      // send back a synthetic result so the debug console shows a
      // helpful message instead of crashing or being silent.
      if (
        msg.id !== undefined &&
        this.pendingEvaluateIds.has(msg.id) &&
        msg.error
      ) {
        this.pendingEvaluateIds.delete(msg.id);
        const errText = msg.error.message || "Evaluation not supported";
        this.log.appendLine(
          `[CDP] Runtime.evaluate failed (id=${msg.id}): ${errText}`
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

      // Capture the uniqueId from execution context creation.
      if (
        msg.method === "Runtime.executionContextCreated" &&
        typeof msg.params?.context?.uniqueId === "string"
      ) {
        this.executionContextUniqueId = msg.params.context.uniqueId;
        this.log.appendLine(`[CDP] Captured executionContext uniqueId: ${this.executionContextUniqueId}`);
      }

      // Rewrite script URLs so that js-debug can map them to local files.
      if (msg.method === "Debugger.scriptParsed" && typeof msg.params?.url === "string") {
        msg.params.url = this.normalizeScriptUrl(msg.params.url);
        return JSON.stringify(msg);
      }

      return raw;
    } catch {
      return raw;
    }
  }

  /**
   * Rewrite / filter a CDP message coming FROM js-debug BEFORE it reaches
   * the UXP target. Return `null` to swallow the message entirely.
   */
	private rewriteFromClient(raw: string): string | null {
		try {
			const msg = JSON.parse(raw);

			// UXP does not support NodeWorker — swallow the request and send a
			// synthetic success response so that js-debug does not stall.
			if (msg.method === "NodeWorker.enable" && msg.id !== undefined) {
				this.log.appendLine(`[CDP] Swallowed unsupported method NodeWorker.enable (id=${msg.id})`);
				this.clientWs?.send(JSON.stringify({id: msg.id, result: {}}));
				return null;
			}

			// Track Runtime.evaluate requests so we can intercept UXP errors.
			// Append the captured uniqueContextId so UXP can resolve the context.
			if (msg.method === "Runtime.evaluate" && msg.id !== undefined) {
				this.pendingEvaluateIds.add(msg.id);
				if (!this.executionContextUniqueId) {
					throw new Error("No execution context uniqueId captured yet");
				}
				msg.params = msg.params ?? {};
				if (msg.params.contextId !== undefined) {
					delete msg.params.contextId;
				}
				msg.params.uniqueContextId = this.executionContextUniqueId;
				return JSON.stringify(msg);
			}

			return raw;
		} catch {
			return raw;
		}
	}

  // -----------------------------------------------------------------------
  // URL normalization
  // -----------------------------------------------------------------------

  /**
   * Normalize a UXP script URL to a form that the built-in JS debugger
   * can map to local files.
   *
   * Common UXP URL schemes:
   *   uxp://com.adobe.plugin/index.js  →  /index.js
   *   file:///path/to/plugin/index.js  →  kept as-is
   *   http(s)://...                    →  kept as-is
   */
  private normalizeScriptUrl(url: string): string {
    if (url.startsWith("uxp://")) {
      // Strip the scheme and plugin-id prefix, keep the relative path
      const withoutScheme = url.replace(/^uxp:\/\/[^/]+/, "");
      return withoutScheme || url;
    }
    return url;
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
