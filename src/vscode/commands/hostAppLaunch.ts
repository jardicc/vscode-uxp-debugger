/**
 * Auto-detect + offer-to-launch resolution for `HostAppNotRunningError`
 * (ARCHITECTURE-UDT2-DIFF.md §6). Replaces the plain Retry-only dialog when
 * the required host app is a recognized, Vulcan-launchable catalog entry.
 */

import * as vscode from "vscode";
import { NativeAddonUnavailableError } from "../../core/errors";
import { type HostAppDescriptor, HOST_APPS, isDebuggableVersion } from "../../core/vulcan/hostAppCatalog";
import { sleep } from "../../core/sleep";
import type { IHostAppController } from "../../core/vulcan/IHostAppController";
import type { UxpService } from "../UxpService";
import { hostAppNotRunningDialog, offerLaunchHostAppDialog } from "../ui/dialogs";

interface InstalledCandidate { sapCode: string; version: string; locales: string[] }

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
 * Control-panel Apps-section click: QuickPick over every installed version
 * of the app (debuggable ones first, each marked), launch the chosen one.
 * Any installed version may be launched — the catalog `minVersion` only
 * gates debugging. Returns `undefined` when nothing was launched; otherwise
 * whether the launched version is debuggable, so the caller (panel) knows
 * whether to wait for a broker connection that an old version will never
 * make. This function itself never waits for the connection.
 */
export async function launchHostAppByValue(
    service: UxpService,
    output: vscode.OutputChannel,
    appValue: string,
): Promise<{ debuggable: boolean } | undefined> {
    const app = HOST_APPS.find((candidate) => candidate.value === appValue);
    if (!app) {
        void vscode.window.showInformationMessage(
            `UXP: "${appValue}" is not a launchable host application.`,
        );
        return undefined;
    }

    const controller = service.getHostAppController();
    let candidates: InstalledCandidate[];
    try {
        candidates = controller.getInstalledCandidates(app);
    }
    catch (err) {
        if (err instanceof NativeAddonUnavailableError) {
            void vscode.window.showErrorMessage(
                "UXP: Host app detection is not available on this platform.",
            );
            return undefined;
        }
        throw err;
    }

    if (candidates.length === 0) {
        void vscode.window.showErrorMessage(
            `UXP: ${app.name} does not appear to be installed on this machine.`,
        );
        return undefined;
    }

    const picked = await pickVersion(app, candidates, true);
    if (!picked) {
        return undefined;
    }

    output.appendLine(`[hostapp] launching ${picked.sapCode}-${picked.version}`);
    const launched = await launchCandidate(controller, picked);
    if (!launched) {
        void vscode.window.showErrorMessage(`UXP: Failed to launch ${app.name} ${picked.version}.`);
        return undefined;
    }
    const debuggable = isDebuggableVersion(app, picked.version);
    void vscode.window.showInformationMessage(
        `UXP: Launching ${app.name} ${picked.version}...`
        + (debuggable ? "" : ` Debugging is unavailable for this version (requires ${app.minVersion} or newer).`),
    );
    return { debuggable };
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

    let candidates: InstalledCandidate[];
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

    // The launch is requested for debugging, so only debuggable versions are offered.
    const debuggable = candidates.filter((candidate) => isDebuggableVersion(app, candidate.version));
    if (debuggable.length === 0) {
        void vscode.window.showErrorMessage(
            `UXP: ${app.name} is installed (${candidates.map((c) => c.version).join(", ")}), `
            + `but UXP debugging requires ${app.minVersion} or newer.`,
        );
        return false;
    }

    // A bare SAP code only matches Vulcan's default version, so each debuggable
    // version is checked; a running pre-UXP version must not block the launch.
    if (debuggable.some((candidate) => controller.isRunning(`${candidate.sapCode}-${candidate.version}`))) {
    // Already running (just not connected to the broker yet) — nothing to
    // launch; fall back to the plain Retry dialog.
        return hostAppNotRunningDialog(requiredApps);
    }

    if (!(await offerLaunchHostAppDialog(app.name))) {
        return false;
    }

    // Exactly one debuggable version is launched without asking; two or more are offered.
    const picked = await pickVersion(app, debuggable, false);
    if (!picked) {
        return false;
    }

    output.appendLine(`[hostapp] launching ${picked.sapCode}-${picked.version}`);
    const launched = await launchCandidate(controller, picked);
    if (!launched) {
        void vscode.window.showErrorMessage(`UXP: Failed to launch ${app.name} ${picked.version}.`);
        return false;
    }

    return waitForConnection(service, output, app, requiredApps);
}

const LAUNCH_VERIFY_TIMEOUT_MS = 15_000;

/**
 * Launches one specific installed version. A bare SAP code makes Vulcan start
 * the default (newest) version, so the `<sapCode>-<version>` specifier is
 * used. Vulcan reports success even when nothing started (seen with very old
 * versions), hence the check that the exact version really is running.
 */
async function launchCandidate(
    controller: IHostAppController,
    candidate: InstalledCandidate,
): Promise<boolean> {
    const specifier = `${candidate.sapCode}-${candidate.version}`;
    if (!(await controller.launchSapCode(specifier))) {
        return false;
    }
    const deadline = Date.now() + LAUNCH_VERIFY_TIMEOUT_MS;
    while (!controller.isRunning(specifier)) {
        if (Date.now() >= deadline) {
            return false;
        }
        await sleep(500);
    }
    return true;
}

/**
 * Single candidate: returned as is. Otherwise a QuickPick — debuggable
 * versions first (newest first, so Enter picks the best default), and with
 * `markSupport` each entry is flagged as debuggable or launch-only.
 */
async function pickVersion(
    app: HostAppDescriptor,
    candidates: InstalledCandidate[],
    markSupport: boolean,
): Promise<InstalledCandidate | undefined> {
    if (candidates.length === 1) {
        return candidates[0];
    }
    const supported = candidates.filter((candidate) => isDebuggableVersion(app, candidate.version));
    const unsupported = candidates.filter((candidate) => !isDebuggableVersion(app, candidate.version));
    const pick = await vscode.window.showQuickPick(
        [...supported, ...unsupported].map((candidate) => {
            const debuggable = isDebuggableVersion(app, candidate.version);
            const locales = candidate.locales.length > 0 ? ` (${candidate.locales.join(", ")})` : "";
            return {
                label: `${markSupport ? (debuggable ? "$(check) " : "$(warning) ") : ""}${app.name} ${candidate.version}${locales}`,
                description: !markSupport
                    ? candidate.sapCode
                    : debuggable
                        ? `${candidate.sapCode} · debuggable`
                        : `${candidate.sapCode} · launch only — debugging requires ${app.minVersion}+`,
                candidate,
            };
        }),
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
            await sleep(POST_CONNECT_SETTLE_MS);
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
