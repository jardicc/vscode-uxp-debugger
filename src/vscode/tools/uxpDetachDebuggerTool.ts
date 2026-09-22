import * as vscode from "vscode";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import type { UxpService } from "../UxpService";
import { textResult } from "./toolResult";
import { resolveSessionsForManifest } from "./toolSessionResolution";

interface DetachDebuggerInput {
    manifestPath: string;
    /** Narrow to one attached session — only needed when the plugin has several. */
    sessionId?: string;
}

/**
 * `uxp_detach_debugger` (LANGUAGE-MODEL-TOOLS.md §7.3) — detaches every currently
 * attached session for a manifest (or just `sessionId`). Routine/reversible,
 * no confirmation.
 */
export class UxpDetachDebuggerTool implements vscode.LanguageModelTool<DetachDebuggerInput> {
    constructor(
        private readonly service: UxpService,
        private readonly debugManager: UxpDebugSessionManager,
    ) {}

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<DetachDebuggerInput>,
    ): vscode.PreparedToolInvocation {
        return { invocationMessage: `Detaching the debugger from ${options.input.manifestPath}…` };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<DetachDebuggerInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const { manifestPath, sessionId } = options.input;

        let sessions;
        try {
            sessions = resolveSessionsForManifest(this.service, manifestPath, sessionId);
        }
        catch (err) {
            return textResult(err instanceof Error ? err.message : String(err));
        }

        const attached = sessions.filter((s) => this.debugManager.isAttached(s.clientSessionId));
        if (attached.length === 0) {
            return textResult("No debugger is attached to this plugin.");
        }

        for (const session of attached) {
            const vsSession = this.debugManager.getVsSession(session.clientSessionId);
            if (vsSession) {
                await vscode.debug.stopDebugging(vsSession);
            }
            else {
                await this.debugManager.stopSession(session.clientSessionId);
            }
        }
        return textResult(
            `Detached ${String(attached.length)} session(s): ${attached.map((s) => s.clientSessionId).join(", ")}.`,
        );
    }
}
