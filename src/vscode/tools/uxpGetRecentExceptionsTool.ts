import type * as vscode from "vscode";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import type { CdpProxyRegistry } from "../proxy/CdpProxyRegistry";
import { textResult } from "./toolResult";
import { tryResolveAttachedSessionId } from "./toolSessionResolution";

interface RecentExceptionsInput {
    limit?: number;
    /** Which attached session to read from — only needed when several are attached at once. */
    sessionId?: string;
}

/**
 * `uxp_get_recent_exceptions` (LANGUAGE-MODEL-TOOLS.md §4.3) — the last N uncaught
 * exceptions/rejections captured from the CDP tap, no pause required.
 */
export class UxpGetRecentExceptionsTool implements vscode.LanguageModelTool<RecentExceptionsInput> {
    constructor(
        private readonly debugManager: UxpDebugSessionManager,
        private readonly proxyRegistry: CdpProxyRegistry,
    ) {}

    // eslint-disable-next-line @typescript-eslint/require-await
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<RecentExceptionsInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const resolution = tryResolveAttachedSessionId(this.debugManager, options.input.sessionId);
        if ("errorMessage" in resolution) {
            return textResult(resolution.errorMessage);
        }
        const { sessionId } = resolution;

        const buffer = this.proxyRegistry.getEventBuffer(sessionId);
        if (!buffer) {
            return textResult(`No CDP connection found for session "${sessionId}".`);
        }

        const limit = options.input.limit ?? 20;
        const entries = buffer.exceptions.slice(-limit);
        if (entries.length === 0) {
            return textResult("No exceptions captured yet for this session.");
        }

        const blocks = entries.map((e) => {
            const location = e.sourceUrl ? ` (${e.sourceUrl}${e.line !== undefined ? ":" + (e.line + 1) : ""})` : "";
            const stack = e.stackTrace ? `\n${e.stackTrace}` : "";
            return `[${new Date(e.timestamp).toISOString()}] ${e.text}${location}${stack}`;
        });
        return textResult(blocks.join("\n\n"));
    }
}
