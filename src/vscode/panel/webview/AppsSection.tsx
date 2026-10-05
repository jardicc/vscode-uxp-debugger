/**
 * Apps section: static host-app catalog rows with live connected status and
 * a "Start" action reusing the existing version-picker QuickPick
 * (APP-DISCOVERY.md §3).
 */

import clsx from "clsx";
import type { ReactNode } from "react";
import { HOST_APPS, type RunningApp } from "../../../core/vulcan/hostAppCatalog";
import type { ConnectedAppView, PanelState } from "../panelProtocol";
import { IconButton, Spinner } from "./common";
import { dispatch } from "./vscodeApi";

interface AppStatus {
    connected: ConnectedAppView | undefined;
    /** Running instances other than the connected one. */
    otherRunning: RunningApp[];
    running: boolean;
    launching: boolean;
    unsupported: boolean;
    notInstalled: boolean;
}

export function AppsSection({ state }: { state: PanelState }): ReactNode {
    return (
        <div className="section-body apps-section">
            {HOST_APPS.map((app) => (
                <AppRow key={app.value} appName={app.name} appId={app.value} state={state} />
            ))}
        </div>
    );
}

function getAppStatus(appId: string, state: PanelState): AppStatus {
    const connected = state.connectedApps.find((a) => a.appId === appId);
    // Vulcan also lists the connected instance — only the others are extra info.
    const otherRunning = state.runningApps.filter((a) => a.appId === appId && a.version !== connected?.version);
    const running = !!connected || otherRunning.length > 0;
    // A supported connection wins; otherwise an unsupported connected/running version is flagged.
    const unsupported = connected
        ? !!connected.unsupportedReason
        : otherRunning.some((a) => a.unsupportedReason);
    // undefined installedApps = detection unavailable — don't assume "not installed".
    const notInstalled = !running && !!state.installedApps && !state.installedApps.includes(appId);

    return {
        connected,
        otherRunning,
        running,
        launching: state.launchingApps.includes(appId),
        unsupported,
        notInstalled,
    };
}

function getStatusIconClass({ unsupported, connected, running, notInstalled }: AppStatus): string {
    if (unsupported) return "codicon-warning";
    if (connected) return "codicon-vm-connect";
    if (running) return "codicon-vm-running";
    if (notInstalled) return "codicon-vm-outline";
    return "codicon-vm";
}

function getUnsupportedTitle({ connected, otherRunning }: AppStatus): string | undefined {
    return [connected?.unsupportedReason, ...otherRunning.map((a) => a.unsupportedReason)]
        .filter(Boolean)
        .join("\n") || undefined;
}

function getStatusText({ connected, otherRunning, launching, notInstalled }: AppStatus): string {
    const otherRunningText = otherRunning
        .map((a) => `${a.version} running — ${a.unsupportedReason ? "unsupported version" : "not connected"}`)
        .join(" · ");

    if (connected) {
        const unsupportedSuffix = connected.unsupportedReason ? " — unsupported version" : "";
        const connectedText = `${connected.name} ${connected.version} (${connected.uxpVersion})${unsupportedSuffix}`;
        return [connectedText, otherRunningText].filter(Boolean).join(" · ");
    }
    if (launching) return "starting…";
    if (otherRunningText) return otherRunningText;
    return notInstalled ? "not installed" : "not connected";
}

function AppRow({
    appName,
    appId,
    state,
}: {
    appName: string;
    appId: string;
    state: PanelState;
}): ReactNode {
    const status = getAppStatus(appId, state);
    const { connected, running, launching, unsupported, notInstalled } = status;

    const statusIcon = launching
        ? <Spinner />
        : (
                <span
                    className={clsx("codicon row-icon status-icon", getStatusIconClass(status), {
                        unsupported,
                        loaded: !unsupported && !!connected,
                        "not-installed": notInstalled,
                    })}
                />
            );

    return (
        <div className="row app-row" title={getUnsupportedTitle(status)}>
            {statusIcon}
            <div className="row-text">
                <div className="row-line">
                    <span className="row-title">{appName}</span>
                </div>
                <div className="row-sub">{getStatusText(status)}</div>
            </div>
            <div className="row-actions">
                {!launching && !running && (
                    <IconButton
                        icon="play"
                        label="Start…"
                        disabled={notInstalled}
                        disabledReason={`${appName} is not installed on this machine`}
                        onClick={() => { dispatch({ kind: "launchHostApp", appId }); }}
                    />
                )}
            </div>
        </div>
    );
}
