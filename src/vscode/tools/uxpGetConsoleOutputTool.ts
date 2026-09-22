import type * as vscode from "vscode";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import type { CdpProxyRegistry } from "../proxy/CdpProxyRegistry";
import { textResult } from "./toolResult";
import { tryResolveAttachedSessionId } from "./toolSessionResolution";

interface ConsoleOutputInput {
    limit?: number;
    /** Which attached session to read from — only needed when several are attached at once. */
    sessionId?: string;
}

/**
 * `uxp_get_console_output` (LANGUAGE-MODEL-TOOLS.md §4.3) — the last N console
 * messages captured from the CDP tap, no pause required.
 */
export class UxpGetConsoleOutputTool implements vscode.LanguageModelTool<ConsoleOutputInput> {
    constructor(
        private readonly debugManager: UxpDebugSessionManager,
        private readonly proxyRegistry: CdpProxyRegistry,
    ) {}

    // eslint-disable-next-line @typescript-eslint/require-await
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ConsoleOutputInput>,
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

        const limit = options.input.limit ?? 50;
        const entries = buffer.console.slice(-limit);
        if (entries.length === 0) {
            return textResult("No console output captured yet for this session.");
        }

        const lines = entries.map((e) => {
            const location = e.sourceUrl ? ` (${e.sourceUrl}${e.line !== undefined ? ":" + (e.line + 1) : ""})` : "";
            return `[${new Date(e.timestamp).toISOString()}] ${e.level.toUpperCase()}: ${e.args.join(" ")}${location}`;
        });
        return textResult(lines.join("\n"));
    }
}
