/**
 * Root component: receives `PanelState` snapshots, renders the Apps /
 * Plugins / Scripts sections (CONTROL-PANEL.md §3/§4).
 */

import { type ReactNode, useEffect, useState } from "react";
import clsx from "clsx";
import type { PanelState, ToWebviewMessage } from "../panelProtocol";
import { AppsSection } from "./AppsSection";
import { BrokerBlockedOverlay, BrokerStatusBanner } from "./BrokerStatus";
import { PluginsHeader, PluginsSection } from "./PluginsSection";
import { ScriptsHeader, ScriptsSection } from "./ScriptsSection";
import { SectionHeader } from "./components";
import { dispatch, getUiState, saveUiState, type SectionId } from "./vscodeApi";

export function App(): ReactNode {
    const [state, setState] = useState<PanelState | undefined>(undefined);
    const [collapsed, setCollapsed] = useState(() => {
        const saved = getUiState().collapsed;
        return {
            apps: saved?.apps ?? false,
            plugins: saved?.plugins ?? false,
            scripts: saved?.scripts ?? false,
        };
    });

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

    const toggleSection = (section: SectionId) => {
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
        <div className={clsx("panel-root", { compact: state.compactView })}>
            <div className="panel-content-wrapper">
                <BrokerBlockedOverlay state={state} />
                <div className="panel-content">
                    <SectionHeader title="Apps" collapsed={collapsed.apps} onToggle={() => { toggleSection("apps"); }} />
                    <BrokerStatusBanner state={state} />
                    {!collapsed.apps && <AppsSection state={state} />}

                    <PluginsHeader
                        state={state}
                        collapsed={collapsed.plugins}
                        onToggle={() => { toggleSection("plugins"); }}
                    />
                    {!collapsed.plugins && <PluginsSection state={state} />}

                    <ScriptsHeader
                        state={state}
                        collapsed={collapsed.scripts}
                        onToggle={() => { toggleSection("scripts"); }}
                    />
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
