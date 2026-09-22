import type * as vscode from "vscode";
import { NativeAddonUnavailableError } from "../../core/errors";
import { HOST_APPS } from "../../core/vulcan/hostAppCatalog";
import type { UxpService } from "../UxpService";
import { textResult } from "./toolResult";

interface LaunchHostAppInput {
    /** Host app id from the `uxp_list_installed_apps` catalog, e.g. "PS". */
    appId: string;
}

/**
 * `uxp_launch_host_app` (LANGUAGE-MODEL-TOOLS.md §7.3) — starts a cataloged host
 * application (newest installed, version-compatible candidate). Fire-and-
 * report, like the panel's own launch action: does NOT wait for the app to
 * finish starting/connecting (can take up to ~2 minutes) — call
 * `uxp_list_installed_apps`/`uxp_get_debug_state` afterwards to check, or
 * just retry `uxp_load_plugin`/`uxp_attach_debugger` once it's ready.
 * Starts a real, visible application — always requires confirmation.
 */
export class UxpLaunchHostAppTool implements vscode.LanguageModelTool<LaunchHostAppInput> {
    constructor(private readonly service: UxpService) {}

    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<LaunchHostAppInput>,
    ): vscode.PreparedToolInvocation {
        const { appId } = options.input;
        return {
            invocationMessage: `Launching ${appId}…`,
            confirmationMessages: {
                title: "Launch Host Application",
                message: `This starts "${appId}" on this machine.`,
            },
        };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<LaunchHostAppInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const { appId } = options.input;
        const app = HOST_APPS.find((candidate) => candidate.value === appId);
        if (!app) {
            return textResult(
                `"${appId}" is not a recognized host app id. Known ids: ${HOST_APPS.map((a) => a.value).join(", ")}.`,
            );
        }

        try {
            const result = await this.service.launchHostApp(app);
            switch (result.status) {
                case "launched":
                    return textResult(
                        `Launching ${app.name}. It can take a while to fully start and connect — `
                        + "call uxp_list_installed_apps or uxp_get_debug_state afterwards to check.",
                    );
                case "notInstalled":
                    return textResult(`${app.name} does not appear to be installed on this machine.`);
                case "versionUnsupported":
                    return textResult(
                        `${app.name} is installed (${result.installed.join(", ") || "unknown version"}) but doesn't meet `
                        + `the minimum required version ${result.minVersion}.`,
                    );
                case "launchFailed":
                    return textResult(`Failed to launch ${app.name}.`);
            }
        }
        catch (err) {
            if (err instanceof NativeAddonUnavailableError) {
                return textResult("Host app detection/launch is not available on this platform.");
            }
            throw err;
        }
    }
}
