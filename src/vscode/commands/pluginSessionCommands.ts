/**
 * `uxp.unloadPlugin` and `uxp.reloadPlugin` (F3) — both operate on a live
 * session of the picked manifest.
 */

import * as vscode from "vscode";
import { RequestTimeoutError } from "../../core/errors";
import type { PluginRegistry } from "../panel/PluginRegistry";
import type { UxpService } from "../UxpService";
import { errorWithRetryDialog } from "../ui/dialogs";
import { pickManifest, pickSession } from "../ui/picks";
import { loadWithDialogs, reportLoadResult } from "./loadPlugin";

export async function unloadPluginCommand(
    service: UxpService,
    pluginRegistry: PluginRegistry,
    _output: vscode.OutputChannel,
): Promise<void> {
    const manifestPath = await pickManifest(pluginRegistry);
    if (!manifestPath) {
        return;
    }
    await service.ensureStarted();

    const sessions = service.sessionsForManifest(manifestPath);
    if (sessions.length === 0) {
        void vscode.window.showInformationMessage(
            "UXP: This plugin has no live session — there is nothing to unload.",
        );
        return;
    }

    const session = await pickSession(sessions, "Unload UXP Plugin");
    if (!session) {
        return;
    }
    await service.unloadPlugin(session);
    void vscode.window.showInformationMessage(
        `UXP: Unloaded "${session.name}" from ${session.app.appName} ${session.app.appVersion}.`,
    );
}

export async function reloadPluginCommand(
    service: UxpService,
    pluginRegistry: PluginRegistry,
    output: vscode.OutputChannel,
): Promise<void> {
    const manifestPath = await pickManifest(pluginRegistry);
    if (!manifestPath) {
        return;
    }
    await service.ensureStarted();

    const sessions = service.sessionsForManifest(manifestPath);
    if (sessions.length === 0) {
        const load = "Load now";
        const choice = await vscode.window.showErrorMessage(
            "UXP: This plugin has no live session to reload.",
            load,
        );
        if (choice === load) {
            const result = await loadWithDialogs(service, manifestPath, output);
            if (result) {
                reportLoadResult(result, output);
            }
        }
        return;
    }

    const session = await pickSession(sessions, "Reload UXP Plugin");
    if (!session) {
        return;
    }

    for (;;) {
        try {
            await service.reloadPlugin(session);
            break;
        }
        catch (err) {
            if (err instanceof RequestTimeoutError && (await errorWithRetryDialog(err.message))) {
                continue;
            }
            throw err;
        }
    }
    void vscode.window.showInformationMessage(
        `UXP: Reloaded "${session.name}" in ${session.app.appName} ${session.app.appVersion}.`,
    );
}
