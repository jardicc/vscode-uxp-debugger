/**
 * Shared dependency bundle for every build-tool REST hook handler in this
 * folder (see `hooksRouter.ts`) — same "bundle the vscode-layer collaborators
 * a handler needs" pattern as `ToolDependencies` in `../tools/registerTools.ts`.
 */

import type * as vscode from "vscode";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import type { CdpProxyRegistry } from "../proxy/CdpProxyRegistry";
import type { PluginRegistry } from "../panel/PluginRegistry";
import type { UxpService } from "../UxpService";

export interface HookDependencies {
    service: UxpService;
    pluginRegistry: PluginRegistry;
    debugManager: UxpDebugSessionManager;
    proxyRegistry: CdpProxyRegistry;
    context: vscode.ExtensionContext;
    output: vscode.OutputChannel;
}
