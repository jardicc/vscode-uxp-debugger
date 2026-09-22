/**
 * `uxp.configureLaunchJson` — open the workspace's launch.json, or start the
 * "Add Configuration" flow if none exists yet.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export async function configureLaunchJsonCommand(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const launchJson = folder
        ? path.join(folder.uri.fsPath, ".vscode", "launch.json")
        : undefined;
    if (launchJson && fs.existsSync(launchJson)) {
        const doc = await vscode.workspace.openTextDocument(launchJson);
        await vscode.window.showTextDocument(doc, { preview: false });
        return;
    }
    await vscode.commands.executeCommand("workbench.action.debug.configure");
}
