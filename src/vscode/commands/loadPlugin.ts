/**
 * `uxp.loadPlugin` (F3) — pick manifest → ensure broker → fan-out load with
 * the retry dialogs from the error-handling matrix (§14).
 */

import * as vscode from "vscode";
import { HostAppNotRunningError, MultipleAppsMatchError, RequestTimeoutError } from "../../core/errors";
import type { PluginRegistry } from "../panel/PluginRegistry";
import type { LoadResult, UxpService } from "../UxpService";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import { resolveHostAppNotRunning } from "./hostAppLaunch";
import { pickApp, pickManifest } from "../ui/picks";
import { errorWithRetryDialog } from "../ui/dialogs";

/**
 * Run the load fan-out with Retry dialogs for "host app not running" and
 * timeout situations. Returns the result, or `undefined` when the user gave up.
 *
 * When the manifest matches more than one connected app, prompts for which
 * one to load into (edge case: previously fanned out to all of them at
 * once) — pass `targetAppId` to skip that prompt and pin a specific app
 * (used by "Reload", which remembers the app the plugin was already loaded
 * into; a fresh "Load" always re-prompts).
 */
export async function loadWithDialogs(
    service: UxpService,
    manifestPath: string,
    output: vscode.OutputChannel,
    breakOnStart = false,
    targetAppId?: string,
): Promise<LoadResult | undefined> {
    for (;;) {
        try {
            return await service.loadPlugin(manifestPath, breakOnStart, targetAppId);
        }
        catch (err) {
            if (err instanceof MultipleAppsMatchError) {
                const picked = await pickApp(err.candidates, "Select which app to load the plugin into");
                if (!picked) {
                    return undefined;
                }
                targetAppId = picked.info.appId;
                continue;
            }
            if (err instanceof HostAppNotRunningError) {
                if (await resolveHostAppNotRunning(service, output, err.requiredApps)) {
                    continue;
                }
                return undefined;
            }
            if (err instanceof RequestTimeoutError) {
                if (await errorWithRetryDialog(err.message)) {
                    continue;
                }
                return undefined;
            }
            output.appendLine(`Load failed: ${String(err instanceof Error ? err.message : err)}`);
            throw err;
        }
    }
}

export function reportLoadResult(result: LoadResult, output: vscode.OutputChannel): void {
    const loadedInto = result.sessions
        .map((s) => `${s.app.appName} ${s.app.appVersion}`)
        .join(", ");
    const name = result.sessions[0]?.name ?? "plugin";
    void vscode.window.showInformationMessage(`UXP: Loaded "${name}" into ${loadedInto}.`);

    for (const failure of result.failures) {
        const appLabel = `${failure.app.info.appName} ${failure.app.info.appVersion}`;
        output.appendLine(`Load failed for ${appLabel}: ${failure.error.message}`);
        void vscode.window.showWarningMessage(
            `UXP: Loading into ${appLabel} failed — ${failure.error.message}`,
        );
    }
}

export async function loadPluginCommand(
    service: UxpService,
    pluginRegistry: PluginRegistry,
    output: vscode.OutputChannel,
): Promise<void> {
    const manifestPath = await pickManifest(pluginRegistry);
    if (!manifestPath) {
        return;
    }
    const result = await loadWithDialogs(service, manifestPath, output);
    if (result) {
        reportLoadResult(result, output);
    }
}

/**
 * `uxp.loadPluginBreakOnStart` — load the plugin with `breakOnStart:true` so
 * the host pauses it right after load, waiting for a debugger. Loading and
 * attaching are deliberately separate steps: use the plugin's Debug action
 * in the UXP Devtools panel afterwards to connect and let the paused runtime
 * continue past its startup code.
 */
export async function loadPluginBreakOnStartCommand(
    service: UxpService,
    pluginRegistry: PluginRegistry,
    debugManager: UxpDebugSessionManager,
    output: vscode.OutputChannel,
): Promise<void> {
    const manifestPath = await pickManifest(pluginRegistry);
    if (!manifestPath) {
        return;
    }
    const result = await loadWithDialogs(service, manifestPath, output, true);
    if (!result) {
        return;
    }
    reportLoadResult(result, output);
    debugManager.markPendingBreakOnStart(result.sessions);
    void vscode.window.showInformationMessage(
        "UXP: Plugin loaded and paused, waiting for a debugger. "
        + "Use its Debug action in the UXP Devtools panel to continue.",
    );
}
