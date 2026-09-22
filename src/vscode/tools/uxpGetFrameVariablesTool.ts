import type * as vscode from "vscode";
import type { PauseTracker } from "../debug/pauseTracker";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import { raceWithTimeout, textResult } from "./toolResult";
import { tryResolveAttachedSessionId } from "./toolSessionResolution";
import {
    type DapScope,
    type DapVariable,
    positiveInteger,
    scopeSortRank,
    toVariableSummary,
} from "./variableInspection";

interface GetFrameVariablesInput {
    frameId: number;
    sessionId?: string;
    includeExpensive?: boolean;
    maxVariablesPerScope?: number;
}

interface ScopesResponse {
    scopes?: DapScope[];
}

interface VariablesResponse {
    variables?: DapVariable[];
}

/** Reads a paused frame's scopes and top-level variables without evaluating code. */
export class UxpGetFrameVariablesTool implements vscode.LanguageModelTool<GetFrameVariablesInput> {
    private static readonly REQUEST_TIMEOUT_MS = 15_000;
    private static readonly DEFAULT_MAX_VARIABLES = 200;

    constructor(
        private readonly debugManager: UxpDebugSessionManager,
        private readonly pauseTracker: PauseTracker,
        private readonly output: vscode.OutputChannel,
    ) {}

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<GetFrameVariablesInput>,
    ): vscode.PreparedToolInvocation {
        return { invocationMessage: `Reading variables from paused frame ${String(options.input.frameId)}…` };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<GetFrameVariablesInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const { frameId } = options.input;
        if (!Number.isInteger(frameId)) {
            return textResult(`"frameId" must be an integer returned by uxp_wait_for_pause. Got ${String(frameId)}.`);
        }
        const maxVariables = positiveInteger(
            options.input.maxVariablesPerScope,
            UxpGetFrameVariablesTool.DEFAULT_MAX_VARIABLES,
        );
        if (maxVariables === undefined) {
            return textResult("\"maxVariablesPerScope\" must be a positive integer.");
        }

        const resolution = tryResolveAttachedSessionId(this.debugManager, options.input.sessionId);
        if ("errorMessage" in resolution) {
            return textResult(resolution.errorMessage);
        }
        const { sessionId } = resolution;
        const snapshot = this.pauseTracker.getSnapshot(sessionId);
        if (!snapshot) {
            return textResult(
                `Session "${sessionId}" is not currently paused. Call uxp_wait_for_pause and use a frame id it returns.`,
            );
        }
        if (!snapshot.frames.some((frame) => frame.id === frameId)) {
            return textResult(
                `Frame ${String(frameId)} is not in the current pause snapshot for session "${sessionId}". `
                + "Call uxp_wait_for_pause again and choose a returned frame id.",
            );
        }

        const dapSession = this.debugManager.getDapSession(sessionId);
        if (!dapSession) {
            return textResult(`Session "${sessionId}" has no active VS Code debug session yet — try again shortly.`);
        }

        this.output.appendLine(`[uxp_get_frame_variables] session=${sessionId} frameId=${String(frameId)}`);
        try {
            const scopeReply = await raceWithTimeout(
                dapSession.customRequest("scopes", { frameId }) as Promise<ScopesResponse>,
                UxpGetFrameVariablesTool.REQUEST_TIMEOUT_MS,
                "Timed out waiting for the debug adapter's scopes response.",
            );
            const scopes = (Array.isArray(scopeReply.scopes) ? scopeReply.scopes : [])
                .filter((scope) => options.input.includeExpensive === true || scope.expensive !== true)
                .sort((left, right) => scopeSortRank(left) - scopeSortRank(right));

            const summaries = [];
            for (const scope of scopes) {
                const variablesReference = typeof scope.variablesReference === "number"
                    ? scope.variablesReference
                    : 0;
                const variableReply = variablesReference > 0
                    ? await raceWithTimeout(
                            dapSession.customRequest("variables", {
                                variablesReference,
                                start: 0,
                                count: maxVariables,
                            }) as Promise<VariablesResponse>,
                            UxpGetFrameVariablesTool.REQUEST_TIMEOUT_MS,
                            `Timed out waiting for variables in scope "${typeof scope.name === "string" ? scope.name : ""}".`,
                        )
                    : {};
                const variables = Array.isArray(variableReply.variables) ? variableReply.variables : [];
                summaries.push({
                    name: typeof scope.name === "string" ? scope.name : "",
                    ...(typeof scope.presentationHint === "string"
                        ? { presentationHint: scope.presentationHint }
                        : {}),
                    expensive: scope.expensive === true,
                    variablesReference,
                    ...(typeof scope.namedVariables === "number" ? { namedVariables: scope.namedVariables } : {}),
                    ...(typeof scope.indexedVariables === "number" ? { indexedVariables: scope.indexedVariables } : {}),
                    variables: variables.map(toVariableSummary),
                    pageLimitReached: variables.length >= maxVariables,
                });
            }

            return textResult(JSON.stringify({
                sessionId,
                frameId,
                scopes: summaries,
                nextAction: "Expand any variablesReference > 0 with uxp_get_variable_children. References expire when execution resumes.",
            }, null, 2));
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.output.appendLine(`[uxp_get_frame_variables] failed: ${message}`);
            return textResult(
                `Reading frame variables failed: ${message}\nCall uxp_wait_for_pause again if the target resumed.`,
            );
        }
    }
}
