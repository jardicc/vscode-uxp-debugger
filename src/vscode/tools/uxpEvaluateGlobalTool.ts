import type * as vscode from "vscode";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import type { CdpProxyRegistry } from "../proxy/CdpProxyRegistry";
import { textResult } from "./toolResult";
import { tryResolveAttachedSessionId } from "./toolSessionResolution";

interface EvaluateGlobalInput {
    expression: string;
    /** Which attached session to evaluate against — only needed when several are attached at once. */
    sessionId?: string;
}

/**
 * `uxp_evaluate_global` — evaluates a JavaScript expression against the
 * target's global execution context via raw CDP `Runtime.evaluate` (see
 * `CdpProxyServer.evaluateInGlobalContext`). Unlike `uxp_evaluate_in_frame`,
 * this does NOT require the target to be paused — it works exactly like
 * typing into the Debug Console while the program runs freely. Useful for
 * reading global/module state, or calling an exported function directly to
 * reproduce a bug programmatically instead of asking the user to trigger it
 * through the plugin's UI.
 *
 * NOT implemented via DAP `evaluate` (unlike `uxp_evaluate_in_frame`):
 * confirmed via a live trace that js-debug's DAP `evaluate` request never
 * sends anything over CDP at all when called without a `frameId` — it has no
 * paused thread/frame to bind the evaluation to and just silently never
 * replies. Raw CDP against the target's `uniqueContextId` is exactly what
 * js-debug itself uses for its own startup probes before any pause, so it's
 * known to work here.
 */
export class UxpEvaluateGlobalTool implements vscode.LanguageModelTool<EvaluateGlobalInput> {
    constructor(
        private readonly debugManager: UxpDebugSessionManager,
        private readonly proxyRegistry: CdpProxyRegistry,
        private readonly output: vscode.OutputChannel,
    ) {}

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<EvaluateGlobalInput>,
    ): vscode.PreparedToolInvocation {
        const { expression } = options.input;
        return {
            invocationMessage: `Evaluating \`${expression}\` in the UXP target's global context…`,
            confirmationMessages: {
                title: "Evaluate expression in UXP target",
                message: `This runs \`${expression}\` in the running plugin/script — it can have side effects (e.g. calling a function). Continue?`,
            },
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<EvaluateGlobalInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const { expression } = options.input;

        const resolution = tryResolveAttachedSessionId(this.debugManager, options.input.sessionId);
        if ("errorMessage" in resolution) {
            return textResult(resolution.errorMessage);
        }
        const { sessionId } = resolution;

        this.output.appendLine(`[uxp_evaluate_global] session=${sessionId} expression=${expression}`);
        try {
            const reply = await this.proxyRegistry.evaluateGlobal(sessionId, expression);
            this.output.appendLine(`[uxp_evaluate_global] result: ${JSON.stringify(reply)}`);
            if (reply.error) {
                return textResult(`Evaluate failed: ${reply.error.message}`);
            }
            return textResult(JSON.stringify(reply.result, null, 2));
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.output.appendLine(`[uxp_evaluate_global] failed: ${message}`);
            return textResult(`Evaluate failed: ${message}`);
        }
    }
}
