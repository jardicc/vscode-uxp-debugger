/**
 * `uxp.packPlugin` — zip the plugin folder into a `.ccx` archive after
 * validating `manifest.json` (CONTROL-PANEL.md §8 "Pack"). Shared by the
 * Command Palette command and the panel's "Pack…" menu item so behavior
 * never diverges (§6.1 convention).
 */

import * as path from "path";
import * as vscode from "vscode";
import {
    defaultPackFileName,
    packPluginFolder,
    rawHostEntries,
    validateManifestForPack,
    withSingleHost,
} from "../../core/pack/packPlugin";
import type { PluginRegistry } from "../panel/PluginRegistry";
import { pickManifest } from "../ui/picks";

export async function packPluginCommand(
    pluginRegistry: PluginRegistry,
    output: vscode.OutputChannel,
): Promise<void> {
    const manifestPath = await pickManifest(pluginRegistry);
    if (!manifestPath) {
        return;
    }
    await packManifest(manifestPath, output);
}

export async function packManifest(manifestPath: string, output: vscode.OutputChannel): Promise<void> {
    const parsed = validateManifestForPack(manifestPath);

    // Adobe only allows one HostDefinition at marketplace-submission time (an
    // array is dev-only) — collapse silently when there's just one entry,
    // otherwise ask which host the packed manifest should target.
    let manifestOverride: string | undefined;
    if (rawHostEntries(parsed.manifest).length > 1) {
        const picked = await vscode.window.showQuickPick(
            parsed.hosts.map((host, index) => ({
                label: host.minVersion ? `${host.app}@${host.minVersion}` : host.app,
                index,
            })),
            {
                placeHolder:
          "This manifest lists multiple host apps (dev-only) — pick the one to target in the packed manifest.json",
            },
        );
        if (!picked) {
            return;
        }
        manifestOverride = JSON.stringify(withSingleHost(parsed.manifest, picked.index), null, 2);
    }
    else if (Array.isArray(parsed.manifest.host)) {
        manifestOverride = JSON.stringify(withSingleHost(parsed.manifest, 0), null, 2);
    }

    const pluginDir = path.dirname(manifestPath);
    const defaultUri = vscode.Uri.file(
        path.join(path.dirname(pluginDir), defaultPackFileName(parsed.manifest)),
    );
    const saveUri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { "UXP Package": ["ccx"] },
        title: "Pack UXP Plugin",
    });
    if (!saveUri) {
        return;
    }

    packPluginFolder(pluginDir, saveUri.fsPath, manifestOverride);
    output.appendLine(`Packed "${parsed.manifest.name}" to ${saveUri.fsPath}.`);
    void vscode.window.showInformationMessage(
        `UXP: Packed "${parsed.manifest.name}" to ${saveUri.fsPath}.`,
    );
}
