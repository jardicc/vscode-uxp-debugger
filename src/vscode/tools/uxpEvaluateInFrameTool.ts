import type * as vscode from "vscode";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import { raceWithTimeout, textResult } from "./toolResult";
import { tryResolveAttachedSessionId } from "./toolSessionResolution";

interface EvaluateInFrameInput {
    expression: string;
    frameId: number;
    /** Which attached session's paused frame to evaluate against — only needed when several are attached at once. */
    sessionId?: string;
}

/**
 * `uxp_evaluate_in_frame` (LANGUAGE-MODEL-TOOLS.md §5.3) — evaluates an expression
 * against a paused call frame via DAP (source-map-aware, authored variable
 * names) instead of raw CDP. Always requires confirmation — arbitrary
 * expressions can have side effects.
 */
export class UxpEvaluateInFrameTool implements vscode.LanguageModelTool<EvaluateInFrameInput> {
    private static readonly EVALUATE_TIMEOUT_MS = 15_000;

    constructor(
        private readonly debugManager: UxpDebugSessionManager,
        private readonly output: vscode.OutputChannel,
    ) {}

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<EvaluateInFrameInput>,
    ): vscode.PreparedToolInvocation {
        const { expression } = options.input;
        return {
            invocationMessage: `Evaluating \`${expression}\` in the paused UXP target…`,
            confirmationMessages: {
                title: "Evaluate expression in UXP target",
                message: `This runs \`${expression}\` in the paused plugin/script — it can have side effects (e.g. calling a function). Continue?`,
            },
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<EvaluateInFrameInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const { expression, frameId } = options.input;

        const resolution = tryResolveAttachedSessionId(this.debugManager, options.input.sessionId);
        if ("errorMessage" in resolution) {
            return textResult(resolution.errorMessage);
        }
        const { sessionId } = resolution;

        const dapSession = this.debugManager.getDapSession(sessionId);
        if (!dapSession) {
            return textResult(`Session "${sessionId}" has no active VS Code debug session yet — try again shortly.`);
        }

        this.output.appendLine(
            `[uxp_evaluate_in_frame] session=${sessionId} frameId=${String(frameId)} expression=${expression}`,
        );
        try {
            const result: unknown = await raceWithTimeout(
                dapSession.customRequest("evaluate", { expression, frameId, context: "repl" }),
                UxpEvaluateInFrameTool.EVALUATE_TIMEOUT_MS,
                `Timed out after ${String(UxpEvaluateInFrameTool.EVALUATE_TIMEOUT_MS)}ms waiting for the debug adapter's `
                + "\"evaluate\" response — it never replied. The target may have resumed since the last pause; call "
                + "uxp_wait_for_pause again and retry with a fresh frameId.",
            );
            this.output.appendLine(`[uxp_evaluate_in_frame] result: ${JSON.stringify(result)}`);
            return textResult(JSON.stringify(result, null, 2));
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.output.appendLine(`[uxp_evaluate_in_frame] failed: ${message}`);
            return textResult(
                `Evaluate failed: ${message}\n`
                + "The target may have resumed since the last pause — call uxp_wait_for_pause again and retry "
                + "with a fresh frameId, don't retry blindly.",
            );
        }
    }
}
