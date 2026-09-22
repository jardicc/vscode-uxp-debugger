/**
 * Root component: receives `PanelState` snapshots, renders the Apps /
 * Plugins / Scripts sections (CONTROL-PANEL.md §3/§4).
 */

import { type ChangeEvent, type ReactNode, useEffect, useState } from "react";
import clsx from "clsx";
import type { PanelState, ToWebviewMessage } from "../panelProtocol";
import { AppsSection } from "./AppsSection";
import { PluginsSection } from "./PluginsSection";
import { AddScriptButton, ScriptsSection, ScriptTargetSelect } from "./ScriptsSection";
import { OverflowMenu, SectionHeader, Spinner } from "./common";
import { dispatch, getUiState, saveUiState } from "./vscodeApi";

export function App(): ReactNode {
    const [state, setState] = useState<PanelState | undefined>(undefined);
    const [collapsed, setCollapsed] = useState(() => ({
        apps: getUiState().collapsed?.apps ?? false,
        plugins: getUiState().collapsed?.plugins ?? false,
        scripts: getUiState().collapsed?.scripts ?? false,
    }));

    useEffect(() => {
        const onMessage = (event: MessageEvent<ToWebviewMessage>) => {
            // Preserve validation at the untrusted window-message boundary.
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (event.data?.type === "panelState") {
                setState(event.data.state);
            }
        };
        window.addEventListener("message", onMessage);
        dispatch({ kind: "ready" });
        return () => {
            window.removeEventListener("message", onMessage);
        };
    }, []);

    const toggleSection = (section: "apps" | "plugins" | "scripts") => {
        setCollapsed((prev) => {
            const next = { ...prev, [section]: !prev[section] };
            saveUiState({ collapsed: next });
            return next;
        });
    };

    if (!state) {
        return (
            <div className="panel-root">
                <div className="panel-content-wrapper">
                    <div className="panel-content loading">Loading…</div>
                </div>
                <AttributionFooter />
            </div>
        );
    }

    return (
        <div className={clsx("panel-root", state.compactView && "compact")}>
            <div className="panel-content-wrapper">
                <BrokerBlockedOverlay state={state} />
                <div className="panel-content">
                    <SectionHeader title="Apps" collapsed={collapsed.apps} onToggle={() => { toggleSection("apps"); }} />
                    <BrokerStatusBanner state={state} />
                    {!collapsed.apps && <AppsSection state={state} />}

                    <SectionHeader
                        title="Plugins"
                        collapsed={collapsed.plugins}
                        onToggle={() => { toggleSection("plugins"); }}
                    >
                        <BreakOnLoadCheckbox
                            checked={state.breakOnLoad.plugins}
                            scope="plugins"
                            title="Load plugins paused, waiting for a debugger (break on start)"
                        />
                        <OverflowMenu
                            icon="add"
                            label="Add plugin…"
                            items={[
                                {
                                    icon: "file-code",
                                    label: "Add manifest.json manually…",
                                    onClick: () => { dispatch({ kind: "addPluginPick" }); },
                                },
                                {
                                    icon: "file-code",
                                    label: "Add active manifest.json",
                                    disabled: !state.activeEditor.isManifest,
                                    onClick: () => { dispatch({ kind: "addActiveManifest" }); },
                                },
                            ]}
                        />
                    </SectionHeader>
                    {!collapsed.plugins && <PluginsSection state={state} />}

                    <SectionHeader
                        title="Scripts"
                        collapsed={collapsed.scripts}
                        onToggle={() => { toggleSection("scripts"); }}
                    >
                        <ScriptTargetSelect state={state} />
                        <AddScriptButton state={state} />
                    </SectionHeader>
                    {!collapsed.scripts && <ScriptsSection state={state} />}
                </div>
            </div>
            <AttributionFooter />
        </div>
    );
}

function AttributionFooter(): ReactNode {
    return (
        <footer className="attribution-footer">
            Created by
            {" "}
            <a href="https://bereza.cz">Jaroslav Bereza</a>
        </footer>
    );
}

function BreakOnLoadCheckbox({
    checked,
    scope,
    title,
}: {
    checked: boolean;
    scope: "plugins" | "scripts";
    title: string;
}): ReactNode {
    return (
        <label className="checkbox-label" title={title} onClick={(e) => { e.stopPropagation(); }}>
            <input
                type="checkbox"
                checked={checked}
                onChange={(e: ChangeEvent<HTMLInputElement>) => { dispatch({ kind: "setBreakOnLoad", scope, value: e.target.checked }); }}
            />
            Break on load
        </label>
    );
}

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
function BrokerStatusBanner({ state }: { state: PanelState }): ReactNode {
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
function BrokerBlockedOverlay({ state }: { state: PanelState }): ReactNode {
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
