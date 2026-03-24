import * as http from "http";
import * as vscode from "vscode";
import WebSocket from "ws";

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
  private readonly log: vscode.OutputChannel;
  private httpServer: http.Server | undefined;
  private targetWs: WebSocket | undefined;
  private clientWs: WebSocket | undefined;

  constructor(targetWsUrl: string, log: vscode.OutputChannel) {
    this.targetWsUrl = targetWsUrl;
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
    return new Promise<number>((resolve, reject) => {
      this.httpServer = http.createServer((_req, res) => {
        // Respond to /json/version so js-debug thinks this is a real Chrome target
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            Browser: "Adobe UXP/1.0",
            "Protocol-Version": "1.3",
            "WebKit-Version": "0.0",
          })
        );
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
    const wss = new WebSocket.Server({ noServer: true });

    wss.handleUpgrade(_req, socket, head, (clientWs) => {
      this.clientWs = clientWs;
      this.log.appendLine("js-debug connected to CDP proxy.");

      // Connect to the real UXP target
      this.targetWs = new WebSocket(this.targetWsUrl);

      this.targetWs.on("open", () => {
        this.log.appendLine(`Connected to UXP target: ${this.targetWsUrl}`);
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

      // Example: rewrite script URLs so that js-debug can map them to local files.
      // UXP might report URLs like "uxp://pluginId/index.js" which have no
      // meaning on the local filesystem.  We translate them to relative paths
      // so that the webRoot / sourceMapPathOverrides in the debug config
      // can resolve them.
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
    // Pass through by default.  Override this to handle any domains
    // or methods that UXP does not support, and return synthetic
    // responses instead.
    return raw;
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
