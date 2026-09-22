import * as vscode from "vscode";
import { textResult } from "./toolResult";

interface SetBreakpointInput {
    filePath: string;
    /** 1-indexed line number, matching what's shown in the editor. */
    line: number;
}

/**
 * `uxp_set_breakpoint` — adds a plain line breakpoint via the standard
 * `vscode.debug` breakpoint API (not a raw per-session DAP `setBreakpoints`
 * request), so it shows up in the editor gutter/Breakpoints view exactly
 * like a manually-set one and survives detach/reattach. No condition/
 * hitCondition/logMessage support — line breakpoints only.
 */
export class UxpSetBreakpointTool implements vscode.LanguageModelTool<SetBreakpointInput> {
    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<SetBreakpointInput>,
    ): vscode.PreparedToolInvocation {
        return {
            invocationMessage: `Setting a breakpoint at ${options.input.filePath}:${String(options.input.line)}…`,
        };
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<SetBreakpointInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const { filePath, line } = options.input;
        if (!Number.isInteger(line) || line < 1) {
            return textResult(`"line" must be a positive integer (1-indexed). Got ${String(line)}.`);
        }

        const uri = vscode.Uri.file(filePath);
        const location = new vscode.Location(uri, new vscode.Position(line - 1, 0));
        const breakpoint = new vscode.SourceBreakpoint(location, true);
        vscode.debug.addBreakpoints([breakpoint]);

        return textResult(
            `Breakpoint set at ${filePath}:${String(line)}. It stays until removed with uxp_remove_breakpoint or by the `
            + "user in the editor — remember to clean it up once you're done investigating.",
        );
    }
}
