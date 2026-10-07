/**
 * Appends a generated `"uxp"` / `"uxp-script"` configuration to the
 * workspace folder's `.vscode/launch.json` (created if missing) and opens it.
 * Goes through the `launch` configuration section so VS Code edits the JSONC
 * file in place and keeps existing comments/formatting.
 */

import * as path from "path";
import * as vscode from "vscode";
import { type LaunchConfigEntry, uniqueConfigName } from "../../core/launchConfig";

/** Workspace folder owning `filePath`, falling back to the first open folder. */
export function launchFolderFor(filePath: string): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))
        ?? vscode.workspace.workspaceFolders?.[0];
}

export async function addLaunchConfiguration(
    folder: vscode.WorkspaceFolder,
    config: LaunchConfigEntry,
): Promise<void> {
    const launch = vscode.workspace.getConfiguration("launch", folder.uri);
    const existing = launch.inspect<LaunchConfigEntry[]>("configurations")?.workspaceFolderValue ?? [];
    const entry = { ...config, name: uniqueConfigName(config.name, existing.map((c) => c.name)) };

    await launch.update("configurations", [...existing, entry], vscode.ConfigurationTarget.WorkspaceFolder);
    if (!launch.inspect("version")?.workspaceFolderValue) {
        await launch.update("version", "0.2.0", vscode.ConfigurationTarget.WorkspaceFolder);
    }

    const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(path.join(folder.uri.fsPath, ".vscode", "launch.json")),
    );
    await vscode.window.showTextDocument(doc, { preview: false });
    void vscode.window.showInformationMessage(`UXP: Added launch configuration "${entry.name}".`);
}
