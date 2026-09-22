import type * as vscode from "vscode";
import type { PauseTracker } from "../debug/pauseTracker";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import { raceWithTimeout, textResult } from "./toolResult";
import { tryResolveAttachedSessionId } from "./toolSessionResolution";
import { type DapVariable, positiveInteger, toVariableSummary } from "./variableInspection";

interface GetVariableChildrenInput {
    variablesReference: number;
    sessionId?: string;
    filter?: "named" | "indexed";
    start?: number;
    count?: number;
}

interface VariablesResponse {
    variables?: DapVariable[];
}

/** Expands a DAP variable handle from the current paused state without evaluating code. */
export class UxpGetVariableChildrenTool implements vscode.LanguageModelTool<GetVariableChildrenInput> {
    private static readonly REQUEST_TIMEOUT_MS = 15_000;
    private static readonly DEFAULT_COUNT = 100;

    constructor(
        private readonly debugManager: UxpDebugSessionManager,
        private readonly pauseTracker: PauseTracker,
        private readonly output: vscode.OutputChannel,
    ) {}

    prepareInvocation(): vscode.PreparedToolInvocation {
        return { invocationMessage: "Reading child variables from the paused UXP target…" };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<GetVariableChildrenInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const { variablesReference, filter } = options.input;
        if (!Number.isInteger(variablesReference) || variablesReference <= 0) {
            return textResult("\"variablesReference\" must be a positive integer returned by a variable inspection tool.");
        }
        const start = options.input.start ?? 0;
        if (!Number.isInteger(start) || start < 0) {
            return textResult("\"start\" must be a non-negative integer.");
        }
        const count = positiveInteger(options.input.count, UxpGetVariableChildrenTool.DEFAULT_COUNT);
        if (count === undefined) {
            return textResult("\"count\" must be a positive integer.");
        }

        const resolution = tryResolveAttachedSessionId(this.debugManager, options.input.sessionId);
        if ("errorMessage" in resolution) {
            return textResult(resolution.errorMessage);
        }
        const { sessionId } = resolution;
        if (!this.pauseTracker.getSnapshot(sessionId)) {
            return textResult(
                `Session "${sessionId}" is not currently paused. Call uxp_wait_for_pause, then obtain a fresh `
                + "variablesReference from uxp_get_frame_variables.",
            );
        }

        const dapSession = this.debugManager.getDapSession(sessionId);
        if (!dapSession) {
            return textResult(`Session "${sessionId}" has no active VS Code debug session yet — try again shortly.`);
        }

        this.output.appendLine(
            `[uxp_get_variable_children] session=${sessionId} variablesReference=${String(variablesReference)}`,
        );
        try {
            const reply = await raceWithTimeout(
                dapSession.customRequest("variables", {
                    variablesReference,
                    ...(filter ? { filter } : {}),
                    start,
                    count,
                }) as Promise<VariablesResponse>,
                UxpGetVariableChildrenTool.REQUEST_TIMEOUT_MS,
                "Timed out waiting for the debug adapter's variables response.",
            );
            const variables = Array.isArray(reply.variables) ? reply.variables : [];
            return textResult(JSON.stringify({
                sessionId,
                variablesReference,
                ...(filter ? { filter } : {}),
                start,
                count,
                variables: variables.map(toVariableSummary),
                pageLimitReached: variables.length >= count,
                nextStart: variables.length >= count ? start + variables.length : undefined,
                nextAction: "Expand any child variablesReference > 0 with this tool. References expire when execution resumes.",
            }, null, 2));
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.output.appendLine(`[uxp_get_variable_children] failed: ${message}`);
            return textResult(
                `Reading child variables failed: ${message}\nThe reference may be stale; call uxp_wait_for_pause and `
                + "uxp_get_frame_variables again.",
            );
        }
    }
}
