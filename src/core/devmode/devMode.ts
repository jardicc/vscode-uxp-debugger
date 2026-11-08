/**
 * Developer-mode flag detection (ARCHITECTURE.md §3.1).
 *
 * Host apps only join the dev workflow when a machine-global settings file
 * contains `{"developer": true}`. Reading requires no elevation — only
 * writing does (handled by the enableDevMode command in the vscode layer).
 */

import * as fs from "fs";
import * as path from "path";

/** Resolve the OS-specific path of Adobe's UXP developer settings file. */
export function getDevSettingsPath(
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
): string {
    if (platform === "win32") {
        const commonFiles = env.CommonProgramFiles ?? "C:\\Program Files\\Common Files";
        return path.join(commonFiles, "Adobe", "UXP", "Developer", "settings.json");
    }
    if (platform === "darwin") {
        return "/Library/Application Support/Adobe/UXP/Developer/settings.json";
    }
    throw new Error(`UXP developer mode is not supported on platform "${platform}"`);
}

/**
 * Check whether developer mode is enabled by reading the settings file
 * directly. Never throws — a missing/corrupt file simply means "disabled".
 */
export function isDevModeEnabled(settingsPath: string = getDevSettingsPath()): boolean {
    try {
        const content = fs.readFileSync(settingsPath, "utf-8");
        const parsed: unknown = JSON.parse(content);
        return (
            typeof parsed === "object"
            && parsed !== null
            && (parsed as Record<string, unknown>).developer === true
        );
    }
    catch {
        return false;
    }
}

export interface ElevationCommand {
    command: string;
    args: string[];
}

/**
 * Build the OS-specific command and arguments that invoke Adobe's elevated
 * developer-mode script (`native/devtools-scripts/{win32.bat,mac.sh}`).
 */
export function buildElevationCommand(
    extensionPath: string,
    platform: NodeJS.Platform = process.platform,
): ElevationCommand {
    const pathMod = platform === "win32" ? path.win32 : path.posix;
    const scriptsDir = pathMod.join(extensionPath, "native", "devtools-scripts");

    if (platform === "win32") {
        const batPath = pathMod.join(scriptsDir, "win32.bat");
        const escapedBatPath = batPath.replace(/'/g, "''");
        return {
            command: "powershell.exe",
            args: [
                "-NoProfile",
                "-Command",
                `Start-Process -FilePath '${escapedBatPath}' -ArgumentList 'true' -Verb runas -Wait`,
            ],
        };
    }
    if (platform === "darwin") {
        const shPath = pathMod.join(scriptsDir, "mac.sh");
        const shSingleQuoted = `'${shPath.replace(/'/g, "'\\''")}'`;
        const appleScriptEscaped = shSingleQuoted.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
        return {
            command: "osascript",
            args: ["-e", `do shell script "sh ${appleScriptEscaped} true" with administrator privileges`],
        };
    }
    throw new Error(`UXP developer mode is not supported on platform "${platform}"`);
}
