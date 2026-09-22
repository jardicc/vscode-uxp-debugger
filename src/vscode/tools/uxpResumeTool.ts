import type * as vscode from "vscode";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import type { PauseTracker } from "../debug/pauseTracker";
import { probePauseSnapshot } from "../debug/pauseTrackerRegistration";
import { raceWithTimeout, textResult } from "./toolResult";
import { tryResolveAttachedSessionId } from "./toolSessionResolution";

interface ResumeInput {
    /** Which attached session to resume — only needed when several are attached at once. */
    sessionId?: string;
}

/**
 * `uxp_resume` — sends DAP `continue` for the thread from the last
 * uxp_wait_for_pause snapshot. Only resume/continue is exposed (no
 * step-over/into/out) — for finer-grained tracing than a plain resume
 * gives you, set/remove breakpoints (uxp_set_breakpoint/uxp_remove_breakpoint)
 * at the points you actually need to stop at, instead of single-stepping.
 */
export class UxpResumeTool implements vscode.LanguageModelTool<ResumeInput> {
    private static readonly CONTINUE_TIMEOUT_MS = 15_000;

    constructor(
        private readonly debugManager: UxpDebugSessionManager,
        private readonly pauseTracker: PauseTracker,
        private readonly output: vscode.OutputChannel,
    ) {}

    prepareInvocation(): vscode.PreparedToolInvocation {
        return { invocationMessage: "Resuming the paused UXP target…" };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ResumeInput>,
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

        let snapshot = this.pauseTracker.getSnapshot(sessionId);
        if (!snapshot) {
            // Recover a pause whose stopped-event snapshot build failed (js-debug
            // can drop stackTrace right after a pause — see probePauseSnapshot).
            snapshot = await probePauseSnapshot(dapSession);
            if (snapshot) {
                this.output.appendLine("[uxp_resume] recovered pause state via probe");
                this.pauseTracker.recordPause(sessionId, snapshot);
            }
        }
        if (!snapshot) {
            return textResult(
                `Session "${sessionId}" is not currently paused — nothing to resume. Call uxp_wait_for_pause first `
                + "if you're expecting a pause.",
            );
        }

        this.output.appendLine(`[uxp_resume] session=${sessionId} threadId=${String(snapshot.threadId)}`);
        try {
            await raceWithTimeout(
                dapSession.customRequest("continue", { threadId: snapshot.threadId }),
                UxpResumeTool.CONTINUE_TIMEOUT_MS,
                `Timed out after ${String(UxpResumeTool.CONTINUE_TIMEOUT_MS)}ms waiting for the debug adapter's "continue" `
                + "response — it never replied.",
            );
            this.output.appendLine(`[uxp_resume] resumed threadId=${String(snapshot.threadId)}`);
            return textResult(`Resumed. Call uxp_wait_for_pause again if you expect it to hit another breakpoint.`);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.output.appendLine(`[uxp_resume] failed: ${message}`);
            return textResult(`Resume failed: ${message}`);
        }
    }
}
