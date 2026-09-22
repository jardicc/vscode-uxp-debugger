import type * as vscode from "vscode";
import type { UxpService } from "../UxpService";
import { textResult } from "./toolResult";
import { resolveSessionsForManifest } from "./toolSessionResolution";

interface UnloadPluginInput {
    manifestPath: string;
    /** Narrow to one live session — only needed when the plugin is loaded into several apps at once. */
    sessionId?: string;
}

/**
 * `uxp_unload_plugin` (LANGUAGE-MODEL-TOOLS.md §7.3) — unloads every live session
 * for a manifest (or just `sessionId`). Always requires confirmation.
 */
export class UxpUnloadPluginTool implements vscode.LanguageModelTool<UnloadPluginInput> {
    constructor(private readonly service: UxpService) {}

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<UnloadPluginInput>,
    ): vscode.PreparedToolInvocation {
        const { manifestPath } = options.input;
        return {
            invocationMessage: `Unloading the plugin at ${manifestPath}…`,
            confirmationMessages: {
                title: "Unload UXP Plugin",
                message: `This unloads the live session(s) of \`${manifestPath}\` from the host application.`,
            },
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<UnloadPluginInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const { manifestPath, sessionId } = options.input;
        await this.service.ensureStarted();

        let sessions;
        try {
            sessions = resolveSessionsForManifest(this.service, manifestPath, sessionId);
        }
        catch (err) {
            return textResult(err instanceof Error ? err.message : String(err));
        }
        if (sessions.length === 0) {
            return textResult("This plugin has no live session — there is nothing to unload.");
        }

        for (const session of sessions) {
            await this.service.unloadPlugin(session);
        }
        return textResult(
            `Unloaded ${String(sessions.length)} session(s): ${sessions.map((s) => s.clientSessionId).join(", ")}.`,
        );
    }
}
