import * as http from "http";
import * as path from "path";
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

  /** IDs used for proxy-initiated CDP messages (not forwarded back to js-debug).
   *  Must be positive – UXP uses jsoncpp which deserializes `id` as UInt and
   *  rejects negative values with "LargestInt out of UInt range". */
  private nextInternalId = 900_000;
  private readonly internalIds = new Map<number, string>();

  /** Tracks pending Runtime.evaluate request IDs to intercept error responses. */
  private readonly pendingEvaluateIds = new Set<number>();

  /** The uniqueId from the latest Runtime.executionContextCreated event. */
  private executionContextUniqueId: string | undefined;

  /** Timer handle for the "no execution context" warning. */
  private noContextTimer: ReturnType<typeof setTimeout> | undefined;

  /** Deferred context-destruction messages awaiting a possible reload. */
  private deferredContextMessages: string[] = [];
  private deferredContextTimer: ReturnType<typeof setTimeout> | undefined;

  /** How long (ms) to wait for a new execution context after destruction
   *  before forwarding the destruction event to js-debug (reload grace period). */
  private static readonly CONTEXT_RELOAD_GRACE_MS = 2_000;

  /** How long (ms) to wait for an execution context before warning the user. */
  private static readonly CONTEXT_TIMEOUT_MS = 8_000;

  /** Max number of reconnect attempts before giving up. */
  private static readonly MAX_RECONNECT_ATTEMPTS = 20;

  /** Delay (ms) between reconnect attempts. */
  private static readonly RECONNECT_DELAY_MS = 1_500;

  constructor(targetWsUrl: string, targetLabel: string, pluginDir: string, log: vscode.OutputChannel) {
    this.targetWsUrl = targetWsUrl;
    this.targetLabel = targetLabel;
    this.pluginDir = pluginDir;
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
    if (this.noContextTimer) {
      clearTimeout(this.noContextTimer);
      this.noContextTimer = undefined;
    }
    if (this.deferredContextTimer) {
      clearTimeout(this.deferredContextTimer);
      this.deferredContextTimer = undefined;
      this.deferredContextMessages.length = 0;
    }
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
        const rewritten = this.rewriteFromClient(raw);
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
      this.noContextTimer = setTimeout(() => {
        if (!this.executionContextUniqueId) {
          this.log.appendLine(
            "[CDP] Warning: no execution context received within " +
            `${CdpProxyServer.CONTEXT_TIMEOUT_MS / 1000}s — plugin may not be loaded. Disconnecting.`
          );
          vscode.window.showWarningMessage(
            "UXP Debugger: Connected to the relay but no response from the plugin. " +
            "Make sure the plugin is loaded in the host application (e.g. via UDT 'uxp plugin load')."
          );
          this.stop();
        }
      }, CdpProxyServer.CONTEXT_TIMEOUT_MS);

      // Enable the Runtime domain so that Runtime.evaluate works.
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
        this.clientWs?.send(rewritten);
      }
    });

    this.targetWs.on("close", () => {
      this.log.appendLine("UXP target WebSocket closed.");
      this.targetOpen = false;
      this.executionContextUniqueId = undefined;
      if (this.noContextTimer) {
        clearTimeout(this.noContextTimer);
        this.noContextTimer = undefined;
      }
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
        this.executionContextUniqueId = undefined;
        if (this.noContextTimer) {
          clearTimeout(this.noContextTimer);
          this.noContextTimer = undefined;
        }
        onCloseRetry();
      });
    }, CdpProxyServer.RECONNECT_DELAY_MS);
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
            `[CDP] New context arrived — discarding ${this.deferredContextMessages.length} deferred destruction event(s) (reload)`
          );
          this.deferredContextMessages.length = 0;
        }
        this.log.appendLine(`[CDP] Captured executionContext uniqueId: ${this.executionContextUniqueId}`);
      }

      // Defer executionContextDestroyed / executionContextsCleared:
      // Hold the message for a short grace period. If a new
      // executionContextCreated arrives (reload), we discard it.
      // Otherwise (unload / real termination), we forward it to js-debug.
      if (
        msg.method === "Runtime.executionContextDestroyed" ||
        msg.method === "Runtime.executionContextsCleared"
      ) {
        this.log.appendLine(
          `[CDP] Deferring ${msg.method} (grace period ${CdpProxyServer.CONTEXT_RELOAD_GRACE_MS}ms)`
        );
        this.executionContextUniqueId = undefined;
        this.deferredContextMessages.push(raw);

        // (Re)start the grace timer — only one timer is active at a time.
        if (!this.deferredContextTimer) {
          this.deferredContextTimer = setTimeout(() => {
            this.deferredContextTimer = undefined;
            // Grace period elapsed with no new context — forward to js-debug.
            this.log.appendLine(
              `[CDP] Grace period elapsed — forwarding ${this.deferredContextMessages.length} deferred destruction event(s)`
            );
            for (const deferred of this.deferredContextMessages) {
              this.clientWs?.send(deferred);
            }
            this.deferredContextMessages.length = 0;
          }, CdpProxyServer.CONTEXT_RELOAD_GRACE_MS);
        }
        return null;
      }

      // Rewrite script URLs and inline source maps so that js-debug can
      // map them to local files.
      if (msg.method === "Debugger.scriptParsed" && typeof msg.params?.url === "string") {
        msg.params.url = this.normalizeScriptUrl(msg.params.url);

        // Fix the sourceRoot inside inline source maps so that relative
        // source paths (e.g. "../src/shared/store.ts") resolve to the
        // correct local files under webRoot.
        if (
          typeof msg.params.sourceMapURL === "string" &&
          msg.params.sourceMapURL.startsWith("data:")
        ) {
          // Derive the subdirectory from the normalized script URL.
          // normalize() resolves "./" and "../" segments first, then dirname()
          // extracts the directory. e.g. "./bundle/index.js" → "bundle"
          const cleanUrl = path.posix.normalize(msg.params.url as string);
          const dir = path.posix.dirname(cleanUrl);
          const scriptSubdir = (dir === "/" || dir === ".") ? "" : dir.replace(/^\//, "");
          msg.params.sourceMapURL = this.rewriteInlineSourceMapRoot(
            msg.params.sourceMapURL,
            scriptSubdir
          );
        }

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
  // Source-map rewriting
  // -----------------------------------------------------------------------
  // ! This is bad for performance. Find out a way to avoid this if possible.
  /**
   * Rewrite the `sourceRoot` inside an inline (data-URL) source map so that
   * relative `sources` entries resolve to the correct local files.
   *
   * Webpack source maps typically contain paths like `../src/shared/store.ts`
   * which are relative to the output directory (one level below the project
   * root).  By setting `sourceRoot` to `<projectDir>/_/` we ensure that
   * `../<path>` resolves back to `<projectDir>/<path>`.
   */
  private rewriteInlineSourceMapRoot(dataUrl: string, scriptSubdir = ""): string {
    try {
      // data:application/json;base64,<payload>
      // data:application/json;charset=utf-8;base64,<payload>
      // Do not change if this is not data URL or does not look like an inline source map.
      const requiredPrefix = "data:application/json";
      if (!dataUrl.slice(0, requiredPrefix.length).toLowerCase().startsWith(requiredPrefix)) {
        this.log.appendLine(`[CDP] Not an inline source map: ${dataUrl}`);
        return dataUrl;
      }
      const commaIdx = dataUrl.indexOf(",");
      if (commaIdx === -1) { return dataUrl; }
      const header = dataUrl.slice(0, commaIdx);  // everything before the comma
      const payload = dataUrl.slice(commaIdx + 1);

      const json = Buffer.from(payload, "base64").toString("utf-8");
      const map = JSON.parse(json);

      // Use a file:// URL so that js-debug resolves paths as local files.
      // Include the script's subdirectory so relative source entries resolve correctly.
      const baseDir = this.pluginDir.replace(/\\/g, "/") + (scriptSubdir ? "/" + scriptSubdir : "");
      const root = "file:///" + baseDir + "/";
      const oldRoot = map.sourceRoot;
      map.sourceRoot = root;

      this.log.appendLine(
        `[CDP] Rewrote sourceRoot: ${JSON.stringify(oldRoot)} → ${JSON.stringify(root)}`
      );

      const newJson = JSON.stringify(map);
      const newPayload = Buffer.from(newJson, "utf-8").toString("base64");
      return header + "," + newPayload;
    } catch (e) {
      this.log.appendLine(
        `[CDP] Failed to rewrite inline source map: ${e instanceof Error ? e.message : e}`
      );
      return dataUrl;
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
