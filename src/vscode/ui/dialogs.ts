/**
 * User-facing dialogs — one function per situation from the error-handling
 * matrix (UXP-DEBUGGER-ARCHITECTURE.md §8.8), so wording lives in exactly one place.
 */

import * as vscode from "vscode";
import type { BrokerIdentity } from "../../core/broker/identify";

function hostAppNotRunningMessage(requiredApps: string[]): string {
    const apps = requiredApps.length > 0 ? requiredApps.join(", ") : "the host application";
    return `${apps} is not running or not connected. Start the application, wait a few seconds and retry.`;
}

/**
 * Port 14001 occupied (most likely Adobe UDT). Returns `true` to retry.
 *
 * Deliberately `modal: true` — `ensureStarted()` awaits this from inside its
 * single shared `starting` promise, so a non-modal notification let the user
 * dismiss/ignore it (or just lose track of it) and trigger "Load Plugin"
 * again, which silently joined the same still-pending promise and appeared
 * to hang forever until the *original* notification was finally answered.
 * Modal forces the user to resolve this one before doing anything else,
 * so there's never a second, stale, in-flight attempt to get confused with.
 */
export async function portInUseDialog(port: number): Promise<boolean> {
    const retry = "Retry";
    const choice = await vscode.window.showErrorMessage(
        `Port ${String(port)} is already in use — most likely the Adobe UXP Developer Tools app is running.`,
        { modal: true, detail: "Close it, then click Retry." },
        retry,
    );
    return choice === retry;
}

/**
 * Port occupied by our own broker in another VS Code window. Offers to take
 * over ownership (stopping the other window's debugger) instead of asking
 * the user to close it manually. Returns `true` when the user confirmed the
 * takeover (see MULTI-WINDOW-TAKEOVER.md).
 */
export async function takeoverConfirmDialog(identity: BrokerIdentity, port: number): Promise<boolean> {
    const takeOver = "Take Over";
    const choice = await vscode.window.showWarningMessage(
        `UXP Debugger is already active in another VS Code window (pid ${String(identity.pid)}, port ${String(port)}). `
        + "Only one window can debug at a time.",
        {
            modal: true,
            detail:
        "Taking over will end that window's active debug session(s) so this window can start "
        + "its own broker on the same port.",
        },
        takeOver,
    );
    return choice === takeOver;
}

/** Required host app not connected. Returns `true` to retry. */
export async function hostAppNotRunningDialog(requiredApps: string[]): Promise<boolean> {
    const retry = "Retry";
    const choice = await vscode.window.showErrorMessage(
        hostAppNotRunningMessage(requiredApps),
        retry,
    );
    return choice === retry;
}

/** Report a missing host without keeping the calling operation pending on a Retry choice. */
export function showHostAppNotRunningError(requiredApps: string[]): void {
    void vscode.window.showErrorMessage(hostAppNotRunningMessage(requiredApps));
}

/** Generic failure with a Retry affordance (timeouts etc.). Returns `true` to retry. */
export async function errorWithRetryDialog(message: string): Promise<boolean> {
    const retry = "Retry";
    const choice = await vscode.window.showErrorMessage(message, retry);
    return choice === retry;
}

/** Offer to launch an installed-but-not-running host app via Vulcan. Returns `true` on consent. */
export async function offerLaunchHostAppDialog(appName: string): Promise<boolean> {
    const launch = "Launch";
    const choice = await vscode.window.showWarningMessage(
        `${appName} is not running.`,
        { modal: true, detail: "UXP Debugger can try launching it via Adobe Vulcan." },
        launch,
    );
    return choice === launch;
}

/** Modal consent before the elevated developer-mode write. Returns `true` on consent. */
export async function devModeConsentDialog(settingsPath: string): Promise<boolean> {
    const enable = "Enable Developer Mode";
    const choice = await vscode.window.showWarningMessage(
        "Adobe UXP developer mode is disabled on this machine. Host applications ignore "
        + "plugin development workflows without it.",
        {
            modal: true,
            detail:
        `This will write {"developer": true} to:\n${settingsPath}\n\n`
        + "Writing this file requires administrator privileges — your operating system "
        + "will show an elevation prompt.",
        },
        enable,
    );
    return choice === enable;
}
