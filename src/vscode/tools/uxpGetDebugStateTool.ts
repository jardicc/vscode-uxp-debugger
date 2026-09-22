import * as fs from "fs";
import * as path from "path";
import type * as vscode from "vscode";
import { parseManifestContent } from "../../core/manifest/manifest";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import type { PluginRegistry } from "../panel/PluginRegistry";
import type { UxpService } from "../UxpService";
import { buildDebugState, type DebugStateInputs, type ManifestFacts, type SessionFact } from "./debugStateSnapshot";
import { textResult } from "./toolResult";

function readManifestFacts(manifestPath: string): ManifestFacts {
    try {
        const parsed = parseManifestContent(fs.readFileSync(manifestPath, "utf-8"), manifestPath);
        return {
            name: parsed.manifest.name,
            id: parsed.manifest.id,
            hostApps: [...new Set(parsed.hosts.map((host) => host.app))],
        };
    }
    catch (err) {
        return {
            name: path.basename(path.dirname(manifestPath)),
            id: "",
            hostApps: [],
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

/**
 * `uxp_get_debug_state` (LANGUAGE-MODEL-TOOLS.md §3) — which plugins/scripts are
 * registered, which have a live session, and which of those are actually
 * attached (or waiting for a debugger, break-on-start).
 */
export class UxpGetDebugStateTool implements vscode.LanguageModelTool<Record<string, never>> {
    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly service: UxpService,
        private readonly debugManager: UxpDebugSessionManager,
    ) {}

    // eslint-disable-next-line @typescript-eslint/require-await
    async invoke(): Promise<vscode.LanguageModelToolResult> {
        const sessions: SessionFact[] = this.service.sessions.map((s) => ({
            clientSessionId: s.clientSessionId,
            kind: s.kind,
            manifestPath: s.manifestPath,
            pluginPath: s.pluginPath,
            name: s.name,
            scriptSourcePath: s.scriptSourcePath,
            appId: s.app.appId,
            appName: s.app.appName,
            appVersion: s.app.appVersion,
        }));

        const inputs: DebugStateInputs = {
            registry: this.pluginRegistry.snapshot,
            brokerStatus: this.service.brokerState,
            brokerError: this.service.brokerError,
            sessions,
            attachedSessionIds: new Set(this.debugManager.activeSessionIds),
            pendingBreakSessionIds: new Set(
                sessions
                    .filter((s) => this.debugManager.isPendingBreakOnStart(s.clientSessionId))
                    .map((s) => s.clientSessionId),
            ),
            readManifest: readManifestFacts,
            fileExists: (filePath) => fs.existsSync(filePath),
        };

        return textResult(JSON.stringify(buildDebugState(inputs), null, 2));
    }
}
