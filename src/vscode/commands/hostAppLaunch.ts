/**
 * Auto-detect + offer-to-launch resolution for `HostAppNotRunningError`
 * (ARCHITECTURE-UDT2-DIFF.md §6). Replaces the plain Retry-only dialog when
 * the required host app is a recognized, Vulcan-launchable catalog entry.
 */

import * as vscode from "vscode";
import { NativeAddonUnavailableError } from "../../core/errors";
import { type HostAppDescriptor, HOST_APPS } from "../../core/vulcan/hostAppCatalog";
import type { UxpService } from "../UxpService";
import { hostAppNotRunningDialog, offerLaunchHostAppDialog } from "../ui/dialogs";

/** Adobe apps can take a while to cold-start (ARCHITECTURE-UDT2-DIFF.md §6.5 caveat #4). */
export const CONNECT_TIMEOUT_MS = 120_000;
/**
 * Extra grace period after the app's WS handshake completes, on top of the
 * broker's own `appSettleMs` (UxpBroker.ts, default 500ms). The handshake
 * finishing does NOT mean the host app is ready to answer `Plugin/load` yet
 * — a cold-started app can lag noticeably behind it, which is why an
 * immediate retry can still hit the broker's 5000ms load timeout. First-pass
 * value, not verified against a real cold start — tune if timeouts persist.
 */
const POST_CONNECT_SETTLE_MS = 3_000;

/**
 * Resolves a `HostAppNotRunningError`. Returns `true` when the caller
 * should retry `service.loadPlugin(...)` (the user started the app
 * themselves and clicked Retry, or we launched it and it connected in
 * time). `false` means give up.
 */
export async function resolveHostAppNotRunning(
    service: UxpService,
    output: vscode.OutputChannel,
    requiredApps: string[],
): Promise<boolean> {
    const recognized = requiredApps
        .map((id) => HOST_APPS.find((app) => app.value === id))
        .filter((app): app is HostAppDescriptor => app !== undefined);

    if (recognized.length === 0) {
        return hostAppNotRunningDialog(requiredApps);
    }

    const app = recognized.length === 1 ? recognized[0] : await pickAppToLaunch(recognized);
    if (!app) {
        return false;
    }

    return launchAndWaitFor(service, output, app, requiredApps);
}

/**
 * Control-panel host-badge / Apps-section click (CONTROL-PANEL.md §2.3 #5):
 * QuickPick over every installed version of the app, launch the chosen one.
 * Returns whether a launch was actually kicked off — the caller (panel) uses
 * that to decide whether to keep showing a "starting…" spinner while waiting
 * for the connection; this function itself never waits for it.
 */
export async function launchHostAppByValue(
    service: UxpService,
    output: vscode.OutputChannel,
    appValue: string,
): Promise<boolean> {
    const app = HOST_APPS.find((candidate) => candidate.value === appValue);
    if (!app) {
        void vscode.window.showInformationMessage(
            `UXP: "${appValue}" is not a launchable host application.`,
        );
        return false;
    }

    const controller = service.getHostAppController();
    let candidates: { sapCode: string; version: string; locales: string[] }[];
    try {
        candidates = controller.getInstalledCandidates(app);
    }
    catch (err) {
        if (err instanceof NativeAddonUnavailableError) {
            void vscode.window.showErrorMessage(
                "UXP: Host app detection is not available on this platform.",
            );
            return false;
        }
        throw err;
    }

    if (candidates.length === 0) {
        void vscode.window.showErrorMessage(
            `UXP: ${app.name} does not appear to be installed on this machine.`,
        );
        return false;
    }

    const picked = await pickVersion(app, candidates);
    if (!picked) {
        return false;
    }

    output.appendLine(`[hostapp] launching ${picked.sapCode}-${picked.version}`);
    const launched = await controller.launchSapCode(picked.sapCode);
    if (!launched) {
        void vscode.window.showErrorMessage(`UXP: Failed to launch ${app.name}.`);
        return false;
    }
    void vscode.window.showInformationMessage(`UXP: Launching ${app.name} ${picked.version}...`);
    return true;
}

async function pickAppToLaunch(
    apps: HostAppDescriptor[],
): Promise<HostAppDescriptor | undefined> {
    const pick = await vscode.window.showQuickPick(
        apps.map((app) => ({ label: app.name, description: app.sapCodes.join(", "), app })),
        { placeHolder: "None of these host applications are connected — pick one to launch" },
    );
    return pick?.app;
}

async function launchAndWaitFor(
    service: UxpService,
    output: vscode.OutputChannel,
    app: HostAppDescriptor,
    requiredApps: string[],
): Promise<boolean> {
    const controller = service.getHostAppController();

    let candidates: { sapCode: string; version: string; locales: string[] }[];
    try {
        candidates = controller.getInstalledCandidates(app);
    }
    catch (err) {
        if (err instanceof NativeAddonUnavailableError) {
            return hostAppNotRunningDialog(requiredApps);
        }
        throw err;
    }

    if (candidates.length === 0) {
        void vscode.window.showErrorMessage(
            `UXP: ${app.name} does not appear to be installed on this machine.`,
        );
        return hostAppNotRunningDialog(requiredApps);
    }

    if (app.sapCodes.some((sapCode) => controller.isRunning(sapCode))) {
    // Already running (just not connected to the broker yet) — nothing to
    // launch; fall back to the plain Retry dialog.
        return hostAppNotRunningDialog(requiredApps);
    }

    if (!(await offerLaunchHostAppDialog(app.name))) {
        return false;
    }

    const picked = await pickVersion(app, candidates);
    if (!picked) {
        return false;
    }

    output.appendLine(`[hostapp] launching ${picked.sapCode}-${picked.version}`);
    const launched = await controller.launchSapCode(picked.sapCode);
    if (!launched) {
        void vscode.window.showErrorMessage(`UXP: Failed to launch ${app.name}.`);
        return false;
    }

    return waitForConnection(service, output, app, requiredApps);
}

async function pickVersion(
    app: HostAppDescriptor,
    candidates: { sapCode: string; version: string; locales: string[] }[],
): Promise<{ sapCode: string; version: string; locales: string[] } | undefined> {
    if (candidates.length === 1) {
        return candidates[0];
    }
    // Sorted newest-first by the caller — first item is naturally the
    // default when the user just hits Enter.
    const pick = await vscode.window.showQuickPick(
        candidates.map((candidate, index) => ({
            label:
        `${app.name} ${candidate.version}`
        + (candidate.locales.length > 0 ? ` (${candidate.locales.join(", ")})` : ""),
            description: index === 0 ? `${candidate.sapCode} · newest` : candidate.sapCode,
            candidate,
        })),
        { placeHolder: `Select the ${app.name} version to launch` },
    );
    return pick?.candidate;
}

async function waitForConnection(
    service: UxpService,
    output: vscode.OutputChannel,
    app: HostAppDescriptor,
    requiredApps: string[],
): Promise<boolean> {
    const hasMatch = () =>
        requiredApps.some((id) => service.connectedApps.some((connected) => connected.info.appId === id));

    const connected = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `UXP: Waiting for ${app.name} to start...`,
            cancellable: true,
        },
        async (progress, token) => {
            const ok = await service.waitForConnection(hasMatch, CONNECT_TIMEOUT_MS, token);
            if (!ok || token.isCancellationRequested) {
                return ok;
            }
            output.appendLine(
                `[hostapp] ${app.name} connected — settling ${String(POST_CONNECT_SETTLE_MS)}ms before retrying load`,
            );
            progress.report({ message: "connected, letting it finish starting up..." });
            await new Promise((resolve) => setTimeout(resolve, POST_CONNECT_SETTLE_MS));
            return true;
        },
    );

    if (!connected) {
        output.appendLine(`[hostapp] ${app.name} did not connect within ${String(CONNECT_TIMEOUT_MS)}ms`);
        void vscode.window.showWarningMessage(
            `UXP: ${app.name} did not connect within ${String(CONNECT_TIMEOUT_MS / 1000)}s. `
            + "It may still be starting — run \"Load Plugin\" again in a moment.",
        );
    }
    return connected;
}
