/**
 * Apps section: static host-app catalog rows with live connected status and
 * a "Start" action reusing the existing version-picker QuickPick
 * (APP-DISCOVERY.md §3).
 */

import clsx from "clsx";
import type { ReactNode } from "react";
import { HOST_APPS } from "../../../core/vulcan/hostAppCatalog";
import type { PanelState } from "../panelProtocol";
import { IconButton, Spinner } from "./common";
import { dispatch } from "./vscodeApi";

export function AppsSection({ state }: { state: PanelState }): ReactNode {
    return (
        <div className="section-body apps-section">
            {HOST_APPS.map((app) => (
                <AppRow key={app.value} appName={app.name} appId={app.value} state={state} />
            ))}
        </div>
    );
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
    const connected = state.connectedApps.find((a) => a.appId === appId);
    const launching = state.launchingApps.includes(appId);
    // undefined installedApps = detection unavailable — don't assume "not installed".
    const notInstalled = !connected && !!state.installedApps && !state.installedApps.includes(appId);

    return (
        <div className="row app-row">
            {launching
                ? (
                        <Spinner />
                    )
                : (
                        <span
                            className={clsx(
                                "codicon",
                                connected ? "codicon-vm-connect" : notInstalled ? "codicon-vm-outline" : "codicon-vm",
                                "row-icon status-icon",
                                connected && "loaded",
                                notInstalled && "not-installed",
                            )}
                        />
                    )}
            <div className="row-text">
                <div className="row-line">
                    <span className="row-title">{appName}</span>
                </div>
                <div className="row-sub">
                    {connected
                        ? `${connected.name} ${connected.version} (${connected.uxpVersion})`
                        : launching
                            ? "starting…"
                            : notInstalled
                                ? "not installed"
                                : "not connected"}
                </div>
            </div>
            <div className="row-actions">
                {!launching && !connected && (
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
