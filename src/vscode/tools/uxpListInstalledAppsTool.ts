import type * as vscode from "vscode";
import { NativeAddonUnavailableError } from "../../core/errors";
import { connectedAppUnsupportedReason, HOST_APPS, isDebuggableVersion } from "../../core/vulcan/hostAppCatalog";
import type { UxpService } from "../UxpService";
import { textResult } from "./toolResult";

/**
 * `uxp_list_installed_apps` (LANGUAGE-MODEL-TOOLS.md §3) — which cataloged host
 * apps (Photoshop, InDesign, …) are installed, which are currently running
 * as an OS process (whether or not they've connected to our broker yet —
 * e.g. dev mode disabled, or still announcing), and which are currently
 * connected to the broker.
 */
export class UxpListInstalledAppsTool implements vscode.LanguageModelTool<Record<string, never>> {
    constructor(private readonly service: UxpService) {}

    // eslint-disable-next-line @typescript-eslint/require-await
    async invoke(): Promise<vscode.LanguageModelToolResult> {
        const controller = this.service.getHostAppController();
        let catalog: {
            app: string;
            name: string;
            installed: boolean | undefined;
            running: boolean | undefined;
            runningVersions: string[];
            versions: string[];
            debuggableVersions: string[];
        }[];
        try {
            catalog = HOST_APPS.map((app) => {
                const candidates = controller.getInstalledCandidates(app);
                // A bare SAP code only matches Vulcan's default version — check each installed one.
                const runningVersions = candidates
                    .filter((c) => controller.isRunning(`${c.sapCode}-${c.version}`))
                    .map((c) => c.version);
                return {
                    app: app.value,
                    name: app.name,
                    installed: candidates.length > 0,
                    running: runningVersions.length > 0,
                    runningVersions,
                    versions: candidates.map((c) => c.version),
                    debuggableVersions: candidates
                        .filter((c) => isDebuggableVersion(app, c.version))
                        .map((c) => c.version),
                };
            });
        }
        catch (err) {
            if (err instanceof NativeAddonUnavailableError) {
                catalog = HOST_APPS.map((app) => ({
                    app: app.value,
                    name: app.name,
                    installed: undefined,
                    running: undefined,
                    runningVersions: [],
                    versions: [],
                    debuggableVersions: [],
                }));
            }
            else {
                throw err;
            }
        }

        const connected = this.service.connectedApps.map((a) => ({
            appId: a.info.appId,
            name: a.info.appName,
            version: a.info.appVersion,
            uxpVersion: a.info.uxpVersion,
            debuggable: connectedAppUnsupportedReason(a.info.appId, a.info.appVersion) === undefined,
        }));

        return textResult(JSON.stringify({ catalog, connected }, null, 2));
    }
}
