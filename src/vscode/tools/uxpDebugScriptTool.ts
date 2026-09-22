import type * as vscode from "vscode";
import { debugScriptCommand } from "../commands/debugScript";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import type { UxpService } from "../UxpService";
import { textResult } from "./toolResult";

interface DebugScriptInput {
    /** Absolute path to a standalone UXP script. */
    scriptPath: string;
    /** Host app id (e.g. "PS") to run the script in. */
    appId?: string;
    /** JSON values exposed to the script as its invocation arguments. */
    userArgs?: unknown;
}

/** Runs a standalone UXP script and attaches the debugger to its new session. */
export class UxpDebugScriptTool implements vscode.LanguageModelTool<DebugScriptInput> {
    constructor(
        private readonly service: UxpService,
        private readonly debugManager: UxpDebugSessionManager,
        private readonly context: vscode.ExtensionContext,
        private readonly output: vscode.OutputChannel,
    ) {}

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<DebugScriptInput>,
    ): vscode.PreparedToolInvocation {
        const { scriptPath, appId } = options.input;
        return {
            invocationMessage: `Running and debugging ${scriptPath}…`,
            confirmationMessages: {
                title: "Run UXP Script",
                message: `This runs \`${scriptPath}\` in ${appId ? `the ${appId} host application` : "a running host application"} and attaches the debugger. The script can modify the open document and application state.`,
            },
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<DebugScriptInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const { scriptPath, appId, userArgs } = options.input;
        try {
            const session = await debugScriptCommand(
                this.service,
                this.debugManager,
                this.context,
                this.output,
                { script: scriptPath, app: appId, userArgs: userArgs ?? [] },
            );
            if (!session) {
                return textResult(
                    "The script did not start an attached debug session. Check the UXP Debugger output for details.",
                );
            }
            return textResult(
                `Running and attached to script session "${session.clientSessionId}" `
                + `(${session.app.appName} ${session.app.appVersion}). `
                + "Call uxp_wait_for_pause with this sessionId to wait for a breakpoint, then inspect the returned frame.",
            );
        }
        catch (err) {
            return textResult(err instanceof Error ? err.message : String(err));
        }
    }
}
