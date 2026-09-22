/**
 * Shared command wrapper: maps typed core errors onto user-facing messages
 * and swallows user cancellations. Keeps individual commands free of
 * boilerplate try/catch blocks.
 */

import * as vscode from "vscode";
import { UxpError } from "../../core/errors";
import { OperationCancelledError } from "../UxpService";

export async function runUxpCommand(
    output: vscode.OutputChannel,
    label: string,
    action: () => Promise<void>,
): Promise<void> {
    try {
        await action();
    }
    catch (err) {
        if (err instanceof OperationCancelledError) {
            return;
        }
        const message = err instanceof Error ? err.message : String(err);
        output.appendLine(`[${label}] Error: ${message}`);
        if (err instanceof Error && err.stack && !(err instanceof UxpError)) {
            output.appendLine(err.stack);
        }
        void vscode.window.showErrorMessage(`UXP: ${message}`);
    }
}
