/**
 * Broker state presentation: a status banner pinned to the Apps section and
 * a blocking overlay for states where the panel cannot act.
 */

import type { ReactNode } from "react";
import type { PanelState } from "../panelProtocol";
import { Spinner } from "./components";
import { dispatch } from "./vscodeApi";

/**
 * Status row pinned to the Apps section, reflecting the richer
 * `BrokerStatus` state machine (APP-DISCOVERY.md §2) — discovery starts
 * automatically on activation. `running` needs no banner of its own: the
 * Apps section already shows each app's connected/not-connected status.
 * `ownedElsewhere`/`stoppedByUser` render as a full blocking overlay instead
 * (see `BrokerBlockedOverlay`) — the rest of the panel isn't usable in
 * either state, so a passive banner alongside still-clickable rows was
 * misleading.
 */
export function BrokerStatusBanner({ state }: { state: PanelState }): ReactNode {
    switch (state.brokerStatus) {
        case "devModeRequired":
            return (
                <div className="banner" role="status">
                    <span className="codicon codicon-warning" />
                    <span>
                        Developer Mode is off — Adobe apps won't discover this extension until it's
                        enabled.
                    </span>
                    <button
                        className="banner-action"
                        onClick={() => { dispatch({ kind: "enableDevModeAndStart" }); }}
                    >
                        Enable &amp; start
                    </button>
                </div>
            );
        case "starting":
            return (
                <div className="banner banner-info" role="status">
                    <Spinner />
                    <span>Looking for Adobe apps…</span>
                </div>
            );
        case "error":
            return (
                <div className="banner banner-error" role="status">
                    <span className="codicon codicon-error" />
                    <span>{state.brokerError ?? "The UXP broker failed to start."}</span>
                    <button className="banner-action" onClick={() => { dispatch({ kind: "startDiscovery" }); }}>
                        Retry
                    </button>
                </div>
            );
        case "running":
        case "stopped":
        case "ownedElsewhere":
        case "stoppedByUser":
        default:
            return null;
    }
}

/**
 * Full-panel blocking overlay for the two states where nothing in the panel
 * can meaningfully act (`ownedElsewhere`, `stoppedByUser`): rather than
 * leaving every row individually clickable and letting an action implicitly
 * trigger a takeover/start as a side effect, one overlay physically blocks
 * all interaction and offers the single relevant action. Renders `null`
 * (nothing, no DOM) for every other state.
 */
export function BrokerBlockedOverlay({ state }: { state: PanelState }): ReactNode {
    switch (state.brokerStatus) {
        case "ownedElsewhere":
            return (
                <div className="broker-overlay" role="alertdialog">
                    <span className="codicon codicon-debug-disconnect broker-overlay-icon" />
                    <p>
                        The UXP broker is owned by another VS Code window. Taking over ends that
                        window's active debug sessions.
                    </p>
                    <button className="banner-action" onClick={() => { dispatch({ kind: "requestTakeover" }); }}>
                        Take Over
                    </button>
                </div>
            );
        case "stoppedByUser":
            return (
                <div className="broker-overlay" role="alertdialog">
                    <span className="codicon codicon-circle-slash broker-overlay-icon" />
                    <p>UXP Debugger is stopped.</p>
                    <button className="banner-action" onClick={() => { dispatch({ kind: "startDiscovery" }); }}>
                        Start
                    </button>
                </div>
            );
        default:
            return null;
    }
}
