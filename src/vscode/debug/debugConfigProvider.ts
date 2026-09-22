/**
 * Debug configuration providers for the `"uxp"` (attach to plugin) and
 * `"uxp-script"` (run + debug a script) launch types. Both delegate to the
 * corresponding command after VS Code has substituted variables like
 * `${workspaceFolder}` / `${file}`, then cancel the original session — the
 * real session is the delegated `pwa-node` attach started by the command.
 */

import * as vscode from "vscode";
import type { DebugScriptArgs } from "../commands/debugScript";

interface UxpScriptDebugConfiguration extends vscode.DebugConfiguration {
    type: "uxp-script";
    request: "launch";
    script: string;
    app?: string;
    userArgs?: unknown[];
}

export class UxpDebugConfigProvider implements vscode.DebugConfigurationProvider {
    constructor(private readonly log: vscode.OutputChannel) {}

    provideDebugConfigurations(): vscode.ProviderResult<vscode.DebugConfiguration[]> {
        return [
            {
                type: "uxp",
                request: "attach",
                name: "Attach to UXP Plugin",
                manifestPath: "${workspaceFolder}/manifest.json",
            },
        ];
    }

    resolveDebugConfiguration(
        _folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
    // Empty config = F5 with no launch.json → sensible defaults.
        if (!config.type && !config.request && !config.name) {
            config.type = "uxp";
            config.request = "attach";
            config.name = "Attach to UXP Plugin";
        }
        return config;
    }

    async resolveDebugConfigurationWithSubstitutedVariables(
        _folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
    ): Promise<vscode.DebugConfiguration | undefined> {
        this.log.appendLine(`Resolving "uxp" debug config: ${JSON.stringify(config)}`);
        await vscode.commands.executeCommand("uxp.attachDebugger", config.manifestPath);
        return undefined; // cancel — the command started the real session
    }
}

export class UxpScriptDebugConfigProvider implements vscode.DebugConfigurationProvider {
    constructor(private readonly log: vscode.OutputChannel) {}

    provideDebugConfigurations(): vscode.ProviderResult<UxpScriptDebugConfiguration[]> {
        return [
            {
                type: "uxp-script",
                request: "launch",
                name: "Debug UXP Script",
                script: "${file}",

                userArgs: [],
            },
        ];
    }

    async resolveDebugConfigurationWithSubstitutedVariables(
        _folder: vscode.WorkspaceFolder | undefined,
        config: UxpScriptDebugConfiguration,
    ): Promise<vscode.DebugConfiguration | undefined> {
        this.log.appendLine(`Resolving "uxp-script" debug config: ${JSON.stringify(config)}`);
        const args: DebugScriptArgs = {
            script: config.script,
            app: config.app,
            userArgs: config.userArgs,
        };
        await vscode.commands.executeCommand("uxp.debugScript", args);
        return undefined;
    }
}
