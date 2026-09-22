/**
 * Developer-mode enablement (UXP-DEBUGGER-ARCHITECTURE.md §2.4).
 *
 * Detection is a direct file read (core/devmode); only the *write* needs
 * elevation, performed by Adobe's own scripts (shipped in
 * `native/devtools-scripts/`) exactly as UDT invokes them:
 *  - win32:  powershell Start-Process <win32.bat> -ArgumentList 'true' -Verb runas -Wait
 *  - darwin: osascript 'do shell script "sh <mac.sh> true" with administrator privileges'
 */

import { spawn } from "child_process";
import * as path from "path";
import * as vscode from "vscode";
import { getDevSettingsPath, isDevModeEnabled } from "../../core/devmode/devMode";
import { devModeConsentDialog } from "../ui/dialogs";

/**
 * Ensure developer mode is enabled, asking for consent + elevation when it
 * is not. Returns `true` when enabled (either already, or after the script).
 */
export async function ensureDevModeInteractive(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
): Promise<boolean> {
    if (isDevModeEnabled()) {
        return true;
    }

    const settingsPath = getDevSettingsPath();
    const consent = await devModeConsentDialog(settingsPath);
    if (!consent) {
        output.appendLine("Developer-mode enablement declined by the user.");
        return false;
    }

    try {
        await runElevatedEnableScript(context.extensionPath, output);
    }
    catch (err) {
        output.appendLine(
            `Developer-mode script failed: ${String(err instanceof Error ? err.message : err)}`,
        );
    }

    // The file on disk is the only truth — verify regardless of exit code.
    if (isDevModeEnabled()) {
        output.appendLine("Developer mode enabled.");
        return true;
    }
    void vscode.window.showErrorMessage(
        "UXP: Developer mode could not be enabled (the elevation prompt may have been declined). "
        + `Host applications ignore plugin development workflows until ${settingsPath} contains {"developer": true}.`,
    );
    return false;
}

/** Command handler for `uxp.enableDevMode`. */
export async function enableDevModeCommand(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
): Promise<void> {
    if (isDevModeEnabled()) {
        void vscode.window.showInformationMessage(
            "UXP developer mode is already enabled on this machine.",
        );
        return;
    }
    const enabled = await ensureDevModeInteractive(context, output);
    if (enabled) {
        void vscode.window.showInformationMessage(
            "UXP developer mode has been enabled. Restart your Adobe applications if they are running.",
        );
    }
}

function runElevatedEnableScript(
    extensionPath: string,
    output: vscode.OutputChannel,
): Promise<void> {
    const scriptsDir = path.join(extensionPath, "native", "devtools-scripts");

    let command: string;
    let args: string[];
    if (process.platform === "win32") {
        const batPath = path.join(scriptsDir, "win32.bat");
        command = "powershell.exe";
        args = [
            "-NoProfile",
            "-Command",
            `Start-Process -FilePath '${batPath}' -ArgumentList 'true' -Verb runas -Wait`,
        ];
    }
    else if (process.platform === "darwin") {
        const shPath = path.join(scriptsDir, "mac.sh");
        command = "osascript";
        args = ["-e", `do shell script "sh \\"${shPath}\\" true" with administrator privileges`];
    }
    else {
        return Promise.reject(
            new Error(`UXP developer mode is not supported on platform "${process.platform}"`),
        );
    }

    output.appendLine(`Running elevated developer-mode script: ${command} ${args.join(" ")}`);
    return new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
        child.on("error", reject);
        child.on("exit", (code) => {
            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error(`elevation script exited with code ${code}`));
            }
        });
    });
}
