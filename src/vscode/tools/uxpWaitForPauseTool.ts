import type * as vscode from "vscode";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import type { PauseTracker } from "../debug/pauseTracker";
import { probePauseSnapshot } from "../debug/pauseTrackerRegistration";
import { textResult } from "./toolResult";
import { tryResolveAttachedSessionId } from "./toolSessionResolution";

interface WaitForPauseInput {
    timeoutMs?: number;
    /** Which attached session to wait on — only needed when several are attached at once. */
    sessionId?: string;
}

/**
 * `uxp_wait_for_pause` (LANGUAGE-MODEL-TOOLS.md §5.3) — resolves immediately if the
 * target is already paused, otherwise waits for the next DAP `stopped` event
 * (cancellable, e.g. by the user cancelling the chat request).
 *
 * Not every investigation needs this: a pause is only useful for stepping/
 * inspecting local frame state. If the bug can be reproduced by calling an
 * exported function directly, or the needed data already lives on a global/
 * module object, prefer `uxp_evaluate_global` (no pause needed) instead of
 * waiting here — only fall back to asking the user to trigger the action
 * through the plugin's own UI when it can't be reproduced programmatically.
 */
export class UxpWaitForPauseTool implements vscode.LanguageModelTool<WaitForPauseInput> {
    constructor(
        private readonly debugManager: UxpDebugSessionManager,
        private readonly pauseTracker: PauseTracker,
        private readonly output: vscode.OutputChannel,
    ) {}

    prepareInvocation(): vscode.PreparedToolInvocation {
        return {
            invocationMessage:
        "Waiting for the plugin/script to pause — trigger the action that reproduces the bug now.",
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<WaitForPauseInput>,
        token: vscode.CancellationToken,
    ): Promise<vscode.LanguageModelToolResult> {
        const resolution = tryResolveAttachedSessionId(this.debugManager, options.input.sessionId);
        if ("errorMessage" in resolution) {
            return textResult(resolution.errorMessage);
        }
        const { sessionId } = resolution;

        const dapSession = this.debugManager.getDapSession(sessionId);
        if (!dapSession) {
            return textResult(`Session "${sessionId}" has no active VS Code debug session yet — try again shortly.`);
        }

        const timeoutMs = options.input.timeoutMs ?? 30_000;
        this.output.appendLine(
            `[uxp_wait_for_pause] session=${sessionId} dapSessionId=${dapSession.id} timeoutMs=${String(timeoutMs)}`,
        );
        try {
            if (!this.pauseTracker.getSnapshot(sessionId)) {
                // Recover a pause whose stopped-event snapshot build failed (js-debug
                // can drop stackTrace right after a pause — see probePauseSnapshot).
                const probed = await probePauseSnapshot(dapSession);
                if (probed) {
                    this.output.appendLine("[uxp_wait_for_pause] target is already paused (recovered via probe)");
                    this.pauseTracker.recordPause(sessionId, probed);
                }
            }
            const snapshot = await this.pauseTracker.waitForPause(sessionId, timeoutMs, token);
            this.output.appendLine(
                `[uxp_wait_for_pause] resolved: threadId=${String(snapshot.threadId)} frames=${String(snapshot.frames.length)}`,
            );
            return textResult(JSON.stringify({ sessionId, ...snapshot }, null, 2));
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.output.appendLine(`[uxp_wait_for_pause] failed: ${message}`);
            return textResult(message);
        }
    }
}
