import type * as vscode from "vscode";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import type { UxpService } from "../UxpService";
import { describeLoadError } from "./toolErrors";
import { textResult } from "./toolResult";

interface LoadPluginInput {
    manifestPath: string;
    /** Host app id (e.g. "PS") to load into, only needed when several connected apps match. */
    appId?: string;
    /** Pause the plugin right after load, waiting for a debugger (see uxp_attach_debugger). */
    breakOnStart?: boolean;
}

/**
 * `uxp_load_plugin` (LANGUAGE-MODEL-TOOLS.md §7.3) — loads a plugin into a
 * connected host app. Spawns a real, visible session in the app, so it
 * always requires confirmation.
 */
export class UxpLoadPluginTool implements vscode.LanguageModelTool<LoadPluginInput> {
    constructor(
        private readonly service: UxpService,
        private readonly debugManager: UxpDebugSessionManager,
    ) {}

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<LoadPluginInput>,
    ): vscode.PreparedToolInvocation {
        const { manifestPath, breakOnStart } = options.input;
        return {
            invocationMessage: `Loading the plugin from ${manifestPath}…`,
            confirmationMessages: {
                title: "Load UXP Plugin",
                message:
          `This loads the plugin at \`${manifestPath}\` into a running host application`
          + (breakOnStart ? ", paused and waiting for a debugger." : "."),
            },
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<LoadPluginInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const { manifestPath, appId, breakOnStart } = options.input;
        await this.service.ensureStarted();

        let result;
        try {
            result = await this.service.loadPlugin(manifestPath, breakOnStart ?? false, appId);
        }
        catch (err) {
            return textResult(describeLoadError(err));
        }

        if (breakOnStart) {
            this.debugManager.markPendingBreakOnStart(result.sessions);
        }

        const name = result.sessions[0]?.name ?? "plugin";
        const loadedInto = result.sessions
            .map((s) => `${s.app.appName} ${s.app.appVersion} (sessionId: ${s.clientSessionId})`)
            .join(", ");
        const lines = [`Loaded "${name}" into ${loadedInto}.`];
        if (result.failures.length > 0) {
            lines.push(
                `Failed for: ${result.failures.map((f) => `${f.app.info.appName} ${f.app.info.appVersion}: ${f.error.message}`).join("; ")}`,
            );
        }
        return textResult(lines.join("\n"));
    }
}
