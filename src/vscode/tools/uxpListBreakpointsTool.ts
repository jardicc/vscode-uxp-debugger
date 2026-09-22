import * as vscode from "vscode";
import { textResult } from "./toolResult";

interface ListBreakpointsInput {
    /** Restrict the listing to breakpoints in this file. Omit to list every breakpoint in the workspace. */
    filePath?: string;
}

interface BreakpointInfo {
    filePath: string;
    /** 1-indexed, matching what's shown in the editor. */
    line: number;
    enabled: boolean;
    condition?: string;
    hitCondition?: string;
    logMessage?: string;
}

/**
 * `uxp_list_breakpoints` — lists every currently-set source breakpoint
 * (whether added via uxp_set_breakpoint or manually in the editor), since
 * neither of those two tools alone tells the agent what's already there.
 */
export class UxpListBreakpointsTool implements vscode.LanguageModelTool<ListBreakpointsInput> {
    prepareInvocation(): vscode.PreparedToolInvocation {
        return { invocationMessage: "Listing current breakpoints…" };
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ListBreakpointsInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const filterPath = options.input.filePath ? vscode.Uri.file(options.input.filePath).fsPath : undefined;

        const breakpoints: BreakpointInfo[] = vscode.debug.breakpoints
            .filter((bp): bp is vscode.SourceBreakpoint => bp instanceof vscode.SourceBreakpoint)
            .filter((bp) => !filterPath || bp.location.uri.fsPath === filterPath)
            .map((bp) => ({
                filePath: bp.location.uri.fsPath,
                line: bp.location.range.start.line + 1,
                enabled: bp.enabled,
                condition: bp.condition,
                hitCondition: bp.hitCondition,
                logMessage: bp.logMessage,
            }));

        if (breakpoints.length === 0) {
            return textResult(
                filterPath ? `No breakpoints set in ${options.input.filePath}.` : "No breakpoints are currently set.",
            );
        }
        return textResult(JSON.stringify(breakpoints, null, 2));
    }
}
