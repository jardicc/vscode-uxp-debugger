import * as path from "path";
import type * as vscode from "vscode";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import type { UxpService } from "../UxpService";
import { describeLoadError } from "./toolErrors";
import { textResult } from "./toolResult";
import { resolveSessionsForManifest } from "./toolSessionResolution";

interface AttachDebuggerInput {
    manifestPath: string;
    /** Narrow to one live session — only needed when the plugin is loaded into several apps at once. */
    sessionId?: string;
    /**
     * Host app id (e.g. "PS") to load into first, only used when the plugin isn't loaded yet
     * and several apps match.
     */
    appId?: string;
}

/**
 * `uxp_attach_debugger` (LANGUAGE-MODEL-TOOLS.md §7.3) — attaches the JS debugger
 * to a live session, loading the plugin first if it isn't loaded yet
 * (mirrors the interactive `uxp.attachDebugger` command). Confirmation is
 * conditional — see `prepareInvocation` and LANGUAGE-MODEL-TOOLS.md §7.2.
 */
export class UxpAttachDebuggerTool implements vscode.LanguageModelTool<AttachDebuggerInput> {
    constructor(
        private readonly service: UxpService,
        private readonly debugManager: UxpDebugSessionManager,
    ) {}

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<AttachDebuggerInput>,
    ): vscode.PreparedToolInvocation {
        const { manifestPath } = options.input;
        const hasLiveSession = this.service.sessionsForManifest(manifestPath).length > 0;
        if (hasLiveSession) {
            return { invocationMessage: `Attaching the debugger to ${manifestPath}…` };
        }
        // No live session yet — this call will load the plugin first, same as
        // uxp_load_plugin, which always confirms (LANGUAGE-MODEL-TOOLS.md §7.2).
        return {
            invocationMessage: `Loading and attaching the debugger to ${manifestPath}…`,
            confirmationMessages: {
                title: "Load and Attach UXP Debugger",
                message:
          `\`${manifestPath}\` has no live session yet — this will load the plugin into a running `
          + "host application first, then attach the debugger.",
            },
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<AttachDebuggerInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const { manifestPath, sessionId, appId } = options.input;
        await this.service.ensureStarted();

        let sessions;
        try {
            sessions = resolveSessionsForManifest(this.service, manifestPath, sessionId);
        }
        catch (err) {
            return textResult(err instanceof Error ? err.message : String(err));
        }

        if (sessions.length === 0) {
            let result;
            try {
                result = await this.service.loadPlugin(manifestPath, false, appId);
            }
            catch (err) {
                return textResult(describeLoadError(err));
            }
            sessions = result.sessions;
            if (sessions.length === 0) {
                return textResult("The plugin was loaded but no matching session was found afterwards.");
            }
        }

        if (sessions.length > 1) {
            return textResult(
                `Multiple live sessions for this manifest (${sessions.map((s) => s.clientSessionId).join(", ")}). `
                + "Specify \"sessionId\" — call uxp_get_debug_state to see which belongs to which app.",
            );
        }

        const session = sessions[0];
        if (this.debugManager.isAttached(session.clientSessionId)) {
            return textResult(`Already attached to session "${session.clientSessionId}".`);
        }

        const started = await this.debugManager.attach(session, path.dirname(manifestPath));
        return textResult(
            started
                ? `Attached the debugger to session "${session.clientSessionId}" (${session.app.appName} ${session.app.appVersion}).`
                : "Failed to start the JS debug session. Check the UXP Debugger output for details.",
        );
    }
}
