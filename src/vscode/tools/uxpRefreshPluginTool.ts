import type * as vscode from "vscode";
import type { UxpService } from "../UxpService";
import { textResult } from "./toolResult";
import { resolveSessionsForManifest } from "./toolSessionResolution";

interface RefreshPluginInput {
    manifestPath: string;
    /** Narrow to one live session — only needed when the plugin is loaded into several apps at once. */
    sessionId?: string;
}

/**
 * `uxp_refresh_plugin` (LANGUAGE-MODEL-TOOLS.md §7.3) — fast in-place `Plugin/reload`
 * for every live session of a manifest (or just `sessionId`); the debugger
 * and inspector stay attached throughout. No confirmation (low-risk, routine
 * dev-loop action) — deliberately NOT the heavier Unload+Load "Reload" the
 * panel also offers (out of scope for this pass, see LANGUAGE-MODEL-TOOLS.md §11).
 */
export class UxpRefreshPluginTool implements vscode.LanguageModelTool<RefreshPluginInput> {
    constructor(private readonly service: UxpService) {}

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<RefreshPluginInput>,
    ): vscode.PreparedToolInvocation {
        return { invocationMessage: `Refreshing the plugin at ${options.input.manifestPath}…` };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<RefreshPluginInput>,
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
            return textResult("This plugin has no live session to refresh.");
        }

        // Refresh every session even when one fails — stopping at the first
        // error would silently leave the remaining apps on stale code.
        const refreshed: string[] = [];
        const failures: string[] = [];
        for (const session of sessions) {
            try {
                await this.service.reloadPlugin(session);
                refreshed.push(session.clientSessionId);
            }
            catch (err) {
                failures.push(
                    `"${session.clientSessionId}": ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }
        if (failures.length > 0) {
            return textResult(
                `Refresh failed for ${String(failures.length)} of ${String(sessions.length)} session(s):\n${failures.join("\n")}`
                + (refreshed.length > 0 ? `\nRefreshed OK: ${refreshed.join(", ")}.` : "")
                + "\nYou can retry the tool call once the host app is responsive again.",
            );
        }
        return textResult(
            `Refreshed ${String(sessions.length)} session(s): ${sessions.map((s) => s.clientSessionId).join(", ")}.`,
        );
    }
}
