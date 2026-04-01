import * as path from "path";
import * as vscode from "vscode";
import { normalizeScriptUrl, rewriteInlineSourceMapRoot } from "./sourceMapRewriter";

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

  /** Tracks pending Runtime.evaluate request IDs to intercept error responses. */
  private readonly pendingEvaluateIds = new Set<number>();

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

  constructor(
    private readonly pluginDir: string,
    private readonly log: vscode.OutputChannel,
    private readonly sendToClient: (msg: string) => void,
    private readonly stopProxy: () => void,
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
   * Start a timer that warns the user if no execution context is received.
   * Called by the proxy when the target WebSocket opens.
   */
  startContextTimeout(): void {
    this.noContextTimer = setTimeout(() => {
      if (!this.executionContextUniqueId) {
        this.log.appendLine(
          "[CDP] Warning: no execution context received within " +
          `${CdpMessageRewriter.CONTEXT_TIMEOUT_MS / 1000}s — plugin may not be loaded. Disconnecting.`
        );
        vscode.window.showWarningMessage(
          "UXP Debugger: Connected to the relay but no response from the plugin. " +
          "Make sure the plugin is loaded in the host application (e.g. via UDT 'uxp plugin load')."
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
          `[CDP] Deferring ${msg.method} (grace period ${CdpMessageRewriter.CONTEXT_RELOAD_GRACE_MS}ms)`
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
              this.sendToClient(deferred);
            }
            this.deferredContextMessages.length = 0;
          }, CdpMessageRewriter.CONTEXT_RELOAD_GRACE_MS);
        }
        return null;
      }

      // Rewrite script URLs and inline source maps so that js-debug can
      // map them to local files.
      if (msg.method === "Debugger.scriptParsed" && typeof msg.params?.url === "string") {
        msg.params.url = normalizeScriptUrl(msg.params.url);

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
          msg.params.sourceMapURL = rewriteInlineSourceMapRoot(
            msg.params.sourceMapURL,
            this.pluginDir,
            scriptSubdir,
            this.log,
          );
        }

        return JSON.stringify(msg);
      }

      return raw;
    } catch {
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
      const msg = JSON.parse(raw);

      // UXP does not support NodeWorker — swallow the request and send a
      // synthetic success response so that js-debug does not stall.
      if (msg.method === "NodeWorker.enable" && msg.id !== undefined) {
        this.log.appendLine(`[CDP] Swallowed unsupported method NodeWorker.enable (id=${msg.id})`);
        this.sendToClient(JSON.stringify({ id: msg.id, result: {} }));
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
}
