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
