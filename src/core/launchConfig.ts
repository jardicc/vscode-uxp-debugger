/**
 * Pure builders for the `"uxp"` / `"uxp-script"` launch.json entries the
 * control panel generates. No `vscode` imports so they stay unit-testable.
 */

import * as path from "path";

export interface LaunchConfigEntry {
    type: string;
    request: string;
    name: string;
    [key: string]: unknown;
}

/**
 * `${workspaceFolder}/relative/path` when `filePath` is inside `folderPath`,
 * otherwise the path unchanged.
 */
export function toLaunchPath(filePath: string, folderPath: string | undefined): string {
    if (!folderPath) {
        return filePath;
    }
    const relative = path.relative(folderPath, filePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        return filePath;
    }
    return `\${workspaceFolder}/${relative.split(path.sep).join("/")}`;
}

export function buildPluginLaunchConfig(
    pluginName: string,
    manifestPath: string,
    folderPath: string | undefined,
): LaunchConfigEntry {
    return {
        type: "uxp",
        request: "attach",
        name: `Attach to UXP Plugin: ${pluginName}`,
        manifestPath: toLaunchPath(manifestPath, folderPath),
    };
}

export function buildScriptLaunchConfig(
    scriptPath: string,
    folderPath: string | undefined,
    options: { app?: string; userArgs?: unknown[] },
): LaunchConfigEntry {
    const config: LaunchConfigEntry = {
        type: "uxp-script",
        request: "launch",
        name: `Debug UXP Script: ${path.basename(scriptPath)}`,
        script: toLaunchPath(scriptPath, folderPath),
    };
    if (options.app) {
        config.app = options.app;
    }
    config.userArgs = options.userArgs ?? [];
    return config;
}

/** Appends " (2)", " (3)", … until `name` doesn't collide with an existing configuration name. */
export function uniqueConfigName(name: string, existingNames: readonly string[]): string {
    const taken = new Set(existingNames);
    if (!taken.has(name)) {
        return name;
    }
    for (let n = 2; ; n++) {
        const candidate = `${name} (${n})`;
        if (!taken.has(candidate)) {
            return candidate;
        }
    }
}
