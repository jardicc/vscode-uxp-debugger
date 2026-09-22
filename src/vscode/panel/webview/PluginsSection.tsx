/**
 * Plugins section: a flat list of plugin rows, no project/folder container
 * (CONTROL-PANEL.md §3).
 */

import clsx from "clsx";
import type { ReactNode } from "react";
import type { PanelState, PluginView } from "../panelProtocol";
import { dispatch } from "./vscodeApi";
import {
    HostBadge,
    IconButton,
    type MenuItem,
    OverflowMenu,
    PathLabel,
    Spinner,
} from "./common";

export function PluginsSection({ state }: { state: PanelState }): ReactNode {
    if (state.plugins.length === 0) {
        return (
            <div className="empty-state">
                <p>No plugins registered yet. Click the plus icon above to add one.</p>
            </div>
        );
    }

    return (
        <div className="section-body plugins-section">
            {state.plugins.map((plugin) => (
                <PluginRow key={plugin.manifestPath} plugin={plugin} state={state} />
            ))}
        </div>
    );
}

/** The plugin's folder (everything before `manifest.json`), for the path label. */
function pluginFolderPath(manifestPath: string): string {
    const normalized = manifestPath.replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    return idx >= 0 ? normalized.slice(0, idx) : normalized;
}

function pluginStatus(plugin: PluginView, busy: boolean): { label: string; icon: ReactNode } {
    const busyIcon = busy ? <Spinner /> : undefined;
    if (plugin.manifestError) {
        return {
            label: "manifest error",
            icon: busyIcon ?? (
                <span className="codicon codicon-warning status-icon error" title={plugin.manifestError} />
            ),
        };
    }
    if (plugin.pendingBreakOnStart) {
        return {
            label: "paused — attach debugger",
            icon: busyIcon ?? (
                <span className="codicon codicon-debug-pause status-icon pending" title="Paused, waiting for a debugger" />
            ),
        };
    }
    if (plugin.debugging) {
        return {
            label: "debugging",
            icon: busyIcon ?? (
                <span className="codicon codicon-debug-alt status-icon debugging" title="Debugger attached" />
            ),
        };
    }
    return {
        label: plugin.loaded ? "loaded" : "not loaded",
        icon: busyIcon ?? (
            <span
                className={clsx(
                    "codicon",
                    plugin.loaded ? "codicon-window-active" : "codicon-window",
                    "status-icon",
                    plugin.loaded && "loaded",
                )}
                title={plugin.loaded ? "Loaded" : "Not loaded"}
            />
        ),
    };
}

function PluginRow({ plugin, state }: { plugin: PluginView; state: PanelState }): ReactNode {
    const busy = !!plugin.busy;
    const breakOnLoad = state.breakOnLoad.plugins;
    const connectedIds = new Set(state.connectedApps.map((a) => a.appId));
    const { label: stateLabel, icon: statusIcon } = pluginStatus(plugin, busy);

    const menuItems: MenuItem[] = [
        {
            icon: "folder-opened",
            label: "Open folder…",
            disabled: busy,
            onClick: () => { dispatch({ kind: "openPluginFolder", manifestPath: plugin.manifestPath }); },
        },
        {
            icon: "go-to-file",
            label: "Open manifest.json",
            disabled: busy,
            onClick: () => { dispatch({ kind: "openManifestFile", manifestPath: plugin.manifestPath }); },
        },
        {
            icon: "package",
            label: "Create installer…",
            disabled: busy || !!plugin.manifestError,
            onClick: () => { dispatch({ kind: "packPlugin", manifestPath: plugin.manifestPath }); },
        },
        {
            icon: "sync",
            label: "Reload (unload + load)",
            disabled: busy || !plugin.loaded,
            onClick: () => { dispatch({ kind: "reloadPlugin", manifestPath: plugin.manifestPath, breakOnLoad }); },
        },
    ];

    return (
        <div className={clsx("row plugin-row", plugin.hasActiveFile && "active-item")}>
            {statusIcon}
            <div className="row-text">
                <div className="row-line">
                    <span className="row-title">{plugin.name}</span>
                    {plugin.hostApps.map((appId) => (
                        <HostBadge
                            key={appId}
                            appId={appId}
                            connected={connectedIds.has(appId)}
                            onLaunch={(id) => { dispatch({ kind: "launchHostApp", appId: id }); }}
                        />
                    ))}
                    {plugin.matchedFolderLength !== undefined && (
                        <span
                            className="codicon codicon-circle-small-filled open-in-vscode-icon"
                            title="Open in this VS Code workspace"
                        />
                    )}
                </div>
                <div className="row-sub">
                    <PathLabel
                        fullPath={pluginFolderPath(plugin.manifestPath)}
                        matchLength={plugin.matchedFolderLength}
                    />
                </div>
                <div className="row-sub" title={plugin.manifestError ?? plugin.manifestPath}>
                    {plugin.id || plugin.manifestError}
                    {" "}
                    ·
                    {stateLabel}
                </div>
            </div>
            <div className="row-actions">
                {plugin.loaded
                    ? (
                            <IconButton
                                icon="debug-stop"
                                label="Unload"
                                disabled={busy}
                                onClick={() => { dispatch({ kind: "unloadPlugin", manifestPath: plugin.manifestPath }); }}
                            />
                        )
                    : (
                            <IconButton
                                icon="play"
                                label={breakOnLoad ? "Load (break on load)" : "Load"}
                                disabled={busy || !!plugin.manifestError}
                                disabledReason={plugin.manifestError}
                                onClick={() => { dispatch({ kind: "loadPlugin", manifestPath: plugin.manifestPath, breakOnLoad }); }}
                            />
                        )}
                {plugin.debugging
                    ? (
                            <IconButton
                                icon="debug-disconnect"
                                label="Stop debugging"
                                disabled={busy}
                                onClick={() => { dispatch({ kind: "detachDebugger", manifestPath: plugin.manifestPath }); }}
                            />
                        )
                    : (
                            <IconButton
                                icon="debug"
                                label={
                                    plugin.pendingBreakOnStart ? "Attach debugger (plugin is paused)" : "Debug"
                                }
                                emphasized={plugin.pendingBreakOnStart}
                                disabled={busy || !!plugin.manifestError}
                                disabledReason={plugin.manifestError}
                                onClick={() => { dispatch({ kind: "attachDebugger", manifestPath: plugin.manifestPath }); }}
                            />
                        )}
                {plugin.inspectorOpen
                    ? (
                            <IconButton
                                icon="right-panel-hide"
                                label="Close inspector"
                                disabled={busy}
                                onClick={() => { dispatch({ kind: "closeInspector", manifestPath: plugin.manifestPath }); }}
                            />
                        )
                    : (
                            <IconButton
                                icon="inspect"
                                label={
                                    plugin.pendingBreakOnStart
                                        ? "Inspector unavailable — attach the debugger first"
                                        : "Open HTML/CSS inspector"
                                }
                                disabled={busy || !plugin.loaded || plugin.pendingBreakOnStart}
                                disabledReason={
                                    plugin.pendingBreakOnStart
                                        ? "Attach the debugger first (break on start)"
                                        : "Load the plugin first"
                                }
                                onClick={() => { dispatch({ kind: "openInspector", manifestPath: plugin.manifestPath }); }}
                            />
                        )}
                <IconButton
                    icon="refresh"
                    label="Refresh (in-place reload)"
                    disabled={busy || !plugin.loaded}
                    onClick={() => { dispatch({ kind: "refreshPlugin", manifestPath: plugin.manifestPath }); }}
                />
                <IconButton
                    icon={plugin.watching ? "eye-closed" : "eye"}
                    label={plugin.watching ? "Unwatch" : "Watch"}
                    disabled={busy}
                    onClick={() => {
                        dispatch({
                            kind: "setWatch",
                            target: { manifestPath: plugin.manifestPath },
                            value: !plugin.watching,
                        });
                    }}
                />
                <OverflowMenu items={menuItems} disabled={busy} />
                <IconButton
                    icon="close-small"
                    label="Remove plugin from this list"
                    disabled={busy}
                    onClick={() => { dispatch({ kind: "removePlugin", manifestPath: plugin.manifestPath }); }}
                />
            </div>
        </div>
    );
}
