/**
 * `uxp._exp_hostAppMethods` — experimental, manual test harness for every
 * `IHostAppController` method (ARCHITECTURE-UDT2-DIFF.md §6). Prompts for
 * arguments in the UI and prints the raw return value to the output
 * channel (plus a toast). Not a supported end-user feature.
 */

import * as vscode from "vscode";
import { HOST_APPS } from "../../core/vulcan/hostAppCatalog";
import type { UxpService } from "../UxpService";

interface ExpAction {
    label: string;
    description: string;
    run: (service: UxpService, output: vscode.OutputChannel) => Promise<void>;
}

function promptString(prompt: string, placeHolder?: string): Thenable<string | undefined> {
    return vscode.window.showInputBox({ prompt, placeHolder });
}

async function promptBoolean(prompt: string): Promise<boolean | undefined> {
    const pick = await vscode.window.showQuickPick(["true", "false"], { placeHolder: prompt });
    return pick === undefined ? undefined : pick === "true";
}

function report(output: vscode.OutputChannel, call: string, result: unknown): void {
    const text = `[_exp_] ${call} => ${JSON.stringify(result)}`;
    output.appendLine(text);
    output.show(true);
    void vscode.window.showInformationMessage(text);
}

const SAP_CODE_PLACEHOLDER = "e.g. PHSP, IDSN, PPRO";

const ACTIONS: ExpAction[] = [
    {
        label: "getSpecifiers()",
        description: "Raw installed-product specifiers, e.g. PHSP-26.0.0",
        // eslint-disable-next-line @typescript-eslint/require-await
        async run(service, output) {
            const result = service.getHostAppController().getSpecifiers();
            report(output, "getSpecifiers()", result);
        },
    },
    {
        label: "getInstalledApps(topLevelOnly)",
        description: "Installed app ids",
        async run(service, output) {
            const topLevelOnly = await promptBoolean("topLevelOnly?");
            if (topLevelOnly === undefined) {
                return;
            }
            const result = service.getHostAppController().getInstalledApps(topLevelOnly);
            report(output, `getInstalledApps(${topLevelOnly})`, result);
        },
    },
    {
        label: "isInstalled(sapCode)",
        description: SAP_CODE_PLACEHOLDER,
        async run(service, output) {
            const sapCode = await promptString("SAP code", "PHSP");
            if (!sapCode) {
                return;
            }
            const result = service.getHostAppController().isInstalled(sapCode);
            report(output, `isInstalled(${sapCode})`, result);
        },
    },
    {
        label: "isRunning(sapCode)",
        description: SAP_CODE_PLACEHOLDER,
        async run(service, output) {
            const sapCode = await promptString("SAP code", "PHSP");
            if (!sapCode) {
                return;
            }
            const result = service.getHostAppController().isRunning(sapCode);
            report(output, `isRunning(${sapCode})`, result);
        },
    },
    {
        label: "isRunningByName(processName)",
        description: "e.g. \"Adobe Photoshop\"",
        async run(service, output) {
            const processName = await promptString("Process name", "Adobe Photoshop");
            if (!processName) {
                return;
            }
            const result = service.getHostAppController().isRunningByName(processName);
            report(output, `isRunningByName(${processName})`, result);
        },
    },
    {
        label: "getProcessId(sapCode)",
        description: SAP_CODE_PLACEHOLDER,
        async run(service, output) {
            const sapCode = await promptString("SAP code", "PHSP");
            if (!sapCode) {
                return;
            }
            const result = service.getHostAppController().getProcessId(sapCode);
            report(output, `getProcessId(${sapCode})`, result);
        },
    },
    {
        label: "getVersion(sapCode)",
        description: SAP_CODE_PLACEHOLDER,
        async run(service, output) {
            const sapCode = await promptString("SAP code", "PHSP");
            if (!sapCode) {
                return;
            }
            const result = service.getHostAppController().getVersion(sapCode);
            report(output, `getVersion(${sapCode})`, result);
        },
    },
    {
        label: "getInstalledCandidates(app)",
        description: "All installed versions across an app's sapCodes, newest first",
        async run(service, output) {
            const pick = await vscode.window.showQuickPick(
                HOST_APPS.map((app) => ({ label: app.name, description: app.sapCodes.join(", "), app })),
                { placeHolder: "Select a host application" },
            );
            if (!pick) {
                return;
            }
            const result = service.getHostAppController().getInstalledCandidates(pick.app);
            report(output, `getInstalledCandidates(${pick.app.name})`, result);
        },
    },
    {
        label: "launch(app)",
        description: "Pick from the host-app catalog and attempt to launch it",
        async run(service, output) {
            const pick = await vscode.window.showQuickPick(
                HOST_APPS.map((app) => ({ label: app.name, description: app.sapCodes.join(", "), app })),
                { placeHolder: "Select a host application to launch" },
            );
            if (!pick) {
                return;
            }
            const result = await service.launchHostApp(pick.app);
            report(output, `launch(${pick.app.name})`, result);
        },
    },
    {
        label: "launchSapCode(sapCode)",
        description: "Raw launch by a specific SAP code, no checks",
        async run(service, output) {
            const sapCode = await promptString("SAP code", "PHSP");
            if (!sapCode) {
                return;
            }
            const result = await service.getHostAppController().launchSapCode(sapCode);
            report(output, `launchSapCode(${sapCode})`, result);
        },
    },
    {
        label: "setLibraryPath(dir)",
        description: "Point the native adapter's DLL loader at a folder",
        async run(service, output) {
            const dir = await promptString("Directory containing VulcanControl.dll / AID.dll");
            if (!dir) {
                return;
            }
            service.getHostAppController().setLibraryPath(dir);
            report(output, `setLibraryPath(${dir})`, undefined);
        },
    },
];

export async function expHostAppMethodsCommand(
    service: UxpService,
    output: vscode.OutputChannel,
): Promise<void> {
    const pick = await vscode.window.showQuickPick(
        ACTIONS.map((action) => ({ label: action.label, description: action.description, action })),
        { placeHolder: "Select an IHostAppController method to test" },
    );
    if (!pick) {
        return;
    }
    await pick.action.run(service, output);
}
