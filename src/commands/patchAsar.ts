import * as path from "path";
import * as vscode from "vscode";
import { patchAsarFile } from "../patch-asar";

export async function patchAsarCommand(outputChannel: vscode.OutputChannel): Promise<void> {
  const defaultPath = process.platform === "darwin"
    ? "/Applications/Adobe UXP Developer Tools/Contents/Resources"
    : String.raw`C:\Program Files\Adobe\Adobe UXP Developer Tools\resources`;
  const defaultUri = vscode.Uri.file(defaultPath);
  const uris = await vscode.window.showOpenDialog({
    defaultUri,
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { "ASAR archive": ["asar"] },
    title: "Select app.asar to patch",
    openLabel: "Patch",
  });
  if (!uris || uris.length === 0) {
    return;
  }
  const asarPath = uris[0].fsPath;
  outputChannel.show(true);
  outputChannel.appendLine(`[patch] Patching: ${asarPath}`);

  try {
    let result: Awaited<ReturnType<typeof patchAsarFile>>;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `UXP Patch: patching ${path.basename(asarPath)}`,
        cancellable: false,
      },
      async (progress) => {
        result = await patchAsarFile(asarPath, (message, increment) => {
          progress.report({ message, increment });
        });
      },
    );
    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    outputChannel.appendLine(`[patch] ${result!.summary}`);
    const { bundleStatus, sourceStatus, summary } = result!;
    /* eslint-enable */

    const name = path.basename(asarPath);
    if (bundleStatus === "already" &&
        (sourceStatus === "already" || sourceStatus === "skipped")) {
      vscode.window.showInformationMessage(
        `UXP Patch: ${name} is already patched \u2014 no changes made.`,
      );
    } else if (bundleStatus === "patched" || sourceStatus === "patched") {
      vscode.window.showInformationMessage(
        `UXP Patch: ${name} patched successfully. ${summary}`,
      );
    } else {
      vscode.window.showErrorMessage(
        `UXP Patch: Failed for ${name}. ${summary}`,
      );
    }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    const isPermError = code === "EACCES" || code === "EPERM";
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[patch] Error: ${message}`);
    if (isPermError) {
      const tip = process.platform === "darwin"
        ? "try fixing file permissions (e.g. sudo chown -R $(whoami) <path>)"
        : "run VS Code as Administrator";
      vscode.window.showErrorMessage(
        `UXP Patch: Permission denied \u2014 ${tip} to patch ${path.basename(asarPath)}.`,
      );
    } else {
      vscode.window.showErrorMessage(
        `UXP Patch: Failed to patch ${path.basename(asarPath)}: ${message}`,
      );
    }
  }
}
