import * as vscode from "vscode";
import { textResult } from "./toolResult";

interface RemoveBreakpointInput {
    filePath: string;
    /** 1-indexed line number, matching what's shown in the editor. */
    line: number;
}

/** `uxp_remove_breakpoint` — removes a line breakpoint previously added via uxp_set_breakpoint (or the editor). */
export class UxpRemoveBreakpointTool implements vscode.LanguageModelTool<RemoveBreakpointInput> {
    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<RemoveBreakpointInput>,
    ): vscode.PreparedToolInvocation {
        return {
            invocationMessage: `Removing the breakpoint at ${options.input.filePath}:${String(options.input.line)}…`,
        };
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<RemoveBreakpointInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const { filePath, line } = options.input;
        const targetPath = vscode.Uri.file(filePath).fsPath;
        const targetLine = line - 1;

        const matches = vscode.debug.breakpoints.filter(
            (bp): bp is vscode.SourceBreakpoint =>
                bp instanceof vscode.SourceBreakpoint
                && bp.location.uri.fsPath === targetPath
                && bp.location.range.start.line === targetLine,
        );

        if (matches.length === 0) {
            return textResult(`No breakpoint found at ${filePath}:${String(line)}.`);
        }

        vscode.debug.removeBreakpoints(matches);
        return textResult(`Removed ${String(matches.length)} breakpoint(s) at ${filePath}:${String(line)}.`);
    }
}
