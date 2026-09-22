import * as vscode from "vscode";
import type { PauseTracker } from "../debug/pauseTracker";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import type { PluginRegistry } from "../panel/PluginRegistry";
import type { CdpProxyRegistry } from "../proxy/CdpProxyRegistry";
import type { UxpService } from "../UxpService";
import { UxpAttachDebuggerTool } from "./uxpAttachDebuggerTool";
import { UxpDebugScriptTool } from "./uxpDebugScriptTool";
import { UxpDetachDebuggerTool } from "./uxpDetachDebuggerTool";
import { UxpEvaluateGlobalTool } from "./uxpEvaluateGlobalTool";
import { UxpEvaluateInFrameTool } from "./uxpEvaluateInFrameTool";
import { UxpGetConsoleOutputTool } from "./uxpGetConsoleOutputTool";
import { UxpGetDebugStateTool } from "./uxpGetDebugStateTool";
import { UxpGetFrameVariablesTool } from "./uxpGetFrameVariablesTool";
import { UxpGetRecentExceptionsTool } from "./uxpGetRecentExceptionsTool";
import { UxpGetVariableChildrenTool } from "./uxpGetVariableChildrenTool";
import { UxpLaunchHostAppTool } from "./uxpLaunchHostAppTool";
import { UxpListBreakpointsTool } from "./uxpListBreakpointsTool";
import { UxpListInstalledAppsTool } from "./uxpListInstalledAppsTool";
import { UxpLoadPluginTool } from "./uxpLoadPluginTool";
import { UxpPackPluginTool } from "./uxpPackPluginTool";
import { UxpRefreshPluginTool } from "./uxpRefreshPluginTool";
import { UxpRemoveBreakpointTool } from "./uxpRemoveBreakpointTool";
import { UxpResumeTool } from "./uxpResumeTool";
import { UxpSetBreakpointTool } from "./uxpSetBreakpointTool";
import { UxpUnloadPluginTool } from "./uxpUnloadPluginTool";
import { UxpValidateManifestTool } from "./uxpValidateManifestTool";
import { UxpWaitForPauseTool } from "./uxpWaitForPauseTool";

export interface ToolDependencies {
    pluginRegistry: PluginRegistry;
    service: UxpService;
    debugManager: UxpDebugSessionManager;
    proxyRegistry: CdpProxyRegistry;
    pauseTracker: PauseTracker;
    context: vscode.ExtensionContext;
    output: vscode.OutputChannel;
}

/**
 * The tool instances themselves, keyed by name — exposed (via
 * `UxpDebuggerTestApi`) so the e2e harness can call `invoke()` directly
 * against the SAME instances the running extension registered, instead of
 * constructing a second copy from source. A second copy would bundle its
 * own separate module graph (its own `HostAppNotRunningError` class, etc.),
 * breaking `instanceof` checks against errors thrown by the real extension
 * (`dist/extension.js`) — confirmed live 2026-08-21.
 */
export interface UxpLanguageModelTools {
    getDebugState: UxpGetDebugStateTool;
    validateManifest: UxpValidateManifestTool;
    listInstalledApps: UxpListInstalledAppsTool;
    packPlugin: UxpPackPluginTool;
    getConsoleOutput: UxpGetConsoleOutputTool;
    getRecentExceptions: UxpGetRecentExceptionsTool;
    waitForPause: UxpWaitForPauseTool;
    setBreakpoint: UxpSetBreakpointTool;
    removeBreakpoint: UxpRemoveBreakpointTool;
    listBreakpoints: UxpListBreakpointsTool;
    resume: UxpResumeTool;
    getFrameVariables: UxpGetFrameVariablesTool;
    getVariableChildren: UxpGetVariableChildrenTool;
    evaluateInFrame: UxpEvaluateInFrameTool;
    evaluateGlobal: UxpEvaluateGlobalTool;
    debugScript: UxpDebugScriptTool;
    loadPlugin: UxpLoadPluginTool;
    unloadPlugin: UxpUnloadPluginTool;
    refreshPlugin: UxpRefreshPluginTool;
    attachDebugger: UxpAttachDebuggerTool;
    detachDebugger: UxpDetachDebuggerTool;
    launchHostApp: UxpLaunchHostAppTool;
}

function createUxpLanguageModelTools(deps: ToolDependencies): UxpLanguageModelTools {
    return {
        getDebugState: new UxpGetDebugStateTool(deps.pluginRegistry, deps.service, deps.debugManager),
        validateManifest: new UxpValidateManifestTool(),
        listInstalledApps: new UxpListInstalledAppsTool(deps.service),
        packPlugin: new UxpPackPluginTool(),
        getConsoleOutput: new UxpGetConsoleOutputTool(deps.debugManager, deps.proxyRegistry),
        getRecentExceptions: new UxpGetRecentExceptionsTool(deps.debugManager, deps.proxyRegistry),
        waitForPause: new UxpWaitForPauseTool(deps.debugManager, deps.pauseTracker, deps.output),
        setBreakpoint: new UxpSetBreakpointTool(),
        removeBreakpoint: new UxpRemoveBreakpointTool(),
        listBreakpoints: new UxpListBreakpointsTool(),
        resume: new UxpResumeTool(deps.debugManager, deps.pauseTracker, deps.output),
        getFrameVariables: new UxpGetFrameVariablesTool(deps.debugManager, deps.pauseTracker, deps.output),
        getVariableChildren: new UxpGetVariableChildrenTool(deps.debugManager, deps.pauseTracker, deps.output),
        evaluateInFrame: new UxpEvaluateInFrameTool(deps.debugManager, deps.output),
        evaluateGlobal: new UxpEvaluateGlobalTool(deps.debugManager, deps.proxyRegistry, deps.output),
        debugScript: new UxpDebugScriptTool(deps.service, deps.debugManager, deps.context, deps.output),
        loadPlugin: new UxpLoadPluginTool(deps.service, deps.debugManager),
        unloadPlugin: new UxpUnloadPluginTool(deps.service),
        refreshPlugin: new UxpRefreshPluginTool(deps.service),
        attachDebugger: new UxpAttachDebuggerTool(deps.service, deps.debugManager),
        detachDebugger: new UxpDetachDebuggerTool(deps.service, deps.debugManager),
        launchHostApp: new UxpLaunchHostAppTool(deps.service),
    };
}

/**
 * Registers every "audience 2" (end-user-facing) Language Model Tool —
 * LANGUAGE-MODEL-TOOLS.md §3-5, §7. Always registered (no dev-only gating — that's
 * §8, not implemented here).
 */
export function registerUxpLanguageModelTools(
    deps: ToolDependencies,
): { disposables: vscode.Disposable[]; tools: UxpLanguageModelTools } {
    const tools = createUxpLanguageModelTools(deps);
    const disposables = [
        vscode.lm.registerTool("uxp_get_debug_state", tools.getDebugState),
        vscode.lm.registerTool("uxp_validate_manifest", tools.validateManifest),
        vscode.lm.registerTool("uxp_list_installed_apps", tools.listInstalledApps),
        vscode.lm.registerTool("uxp_pack_plugin", tools.packPlugin),
        vscode.lm.registerTool("uxp_get_console_output", tools.getConsoleOutput),
        vscode.lm.registerTool("uxp_get_recent_exceptions", tools.getRecentExceptions),
        vscode.lm.registerTool("uxp_wait_for_pause", tools.waitForPause),
        vscode.lm.registerTool("uxp_set_breakpoint", tools.setBreakpoint),
        vscode.lm.registerTool("uxp_remove_breakpoint", tools.removeBreakpoint),
        vscode.lm.registerTool("uxp_list_breakpoints", tools.listBreakpoints),
        vscode.lm.registerTool("uxp_resume", tools.resume),
        vscode.lm.registerTool("uxp_get_frame_variables", tools.getFrameVariables),
        vscode.lm.registerTool("uxp_get_variable_children", tools.getVariableChildren),
        vscode.lm.registerTool("uxp_evaluate_in_frame", tools.evaluateInFrame),
        vscode.lm.registerTool("uxp_evaluate_global", tools.evaluateGlobal),
        vscode.lm.registerTool("uxp_debug_script", tools.debugScript),
        vscode.lm.registerTool("uxp_load_plugin", tools.loadPlugin),
        vscode.lm.registerTool("uxp_unload_plugin", tools.unloadPlugin),
        vscode.lm.registerTool("uxp_refresh_plugin", tools.refreshPlugin),
        vscode.lm.registerTool("uxp_attach_debugger", tools.attachDebugger),
        vscode.lm.registerTool("uxp_detach_debugger", tools.detachDebugger),
        vscode.lm.registerTool("uxp_launch_host_app", tools.launchHostApp),
    ];
    return { disposables, tools };
}
