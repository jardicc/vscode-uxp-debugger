/**
 * Plugins section: a flat list of plugin rows, no project/folder container
 * (CONTROL-PANEL.md §3).
 */

import clsx from "clsx";
import type { ChangeEvent, ReactNode } from "react";
import type { ConnectedAppView, PluginView } from "../panelProtocol";
import { parentFolder } from "./pathUtils";
import { dispatch } from "./vscodeApi";
import {
    HostBadge,
    IconButton,
    type MenuItem,
    OverflowMenu,
    PathLabel,
    SectionHeader,
    Spinner,
    ToggleIconButton,
} from "./components";
import { getUICodeByValue } from "../../../core/vulcan/hostAppCatalog";

export function PluginsSection({
    plugins,
    breakOnLoad,
    connectedApps,
    activeEditorIsManifest,
    collapsed,
    onToggle,
}: {
    plugins: PluginView[];
    breakOnLoad: boolean;
    connectedApps: ConnectedAppView[];
    activeEditorIsManifest: boolean;
    collapsed: boolean;
    onToggle: () => void;
}): ReactNode {
    const connectedIds = new Set(connectedApps.map((a) => a.appId));

    return (
        <>
            <PluginsHeader
                breakOnLoad={breakOnLoad}
                activeEditorIsManifest={activeEditorIsManifest}
                collapsed={collapsed}
                onToggle={onToggle}
            />
            {!collapsed && (
                plugins.length === 0
                    ? (
                            <div className="empty-state">
                                <p>No plugins registered yet. Click the plus icon above to add one.</p>
                            </div>
                        )
                    : (
                            <div className="section-body plugins-section">
                                {plugins.map((plugin) => (
                                    <PluginRow
                                        key={plugin.manifestPath}
                                        plugin={plugin}
                                        breakOnLoad={breakOnLoad}
                                        connectedIds={connectedIds}
                                    />
                                ))}
                            </div>
                        )
            )}
        </>
    );
}

function PluginsHeader({
    breakOnLoad,
    activeEditorIsManifest,
    collapsed,
    onToggle,
}: {
    breakOnLoad: boolean;
    activeEditorIsManifest: boolean;
    collapsed: boolean;
    onToggle: () => void;
}): ReactNode {
    return (
        <SectionHeader title="Plugins" collapsed={collapsed} onToggle={onToggle}>
            <label
                className="checkbox-label"
                title="Load plugins paused, waiting for a debugger (break on start)"
                onClick={(e) => { e.stopPropagation(); }}
            >
                <input
                    type="checkbox"
                    checked={breakOnLoad}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        dispatch({ kind: "setBreakOnLoad", scope: "plugins", value: e.target.checked });
                    }}
                />
                Break on load
            </label>
            <OverflowMenu
                icon="add"
                label="Add plugin…"
                items={[
                    {
                        label: "Browse for manifest.json…",
                        onClick: () => { dispatch({ kind: "addPluginPick" }); },
                    },
                    {
                        label: "Currently opened manifest.json",
                        disabled: !activeEditorIsManifest,
                        onClick: () => { dispatch({ kind: "addActiveManifest" }); },
                    },
                ]}
            />
        </SectionHeader>
    );
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
                className={clsx("codicon status-icon", {
                    "codicon-window-active": plugin.loaded,
                    "codicon-window": !plugin.loaded,
                    loaded: plugin.loaded,
                })}
                title={plugin.loaded ? "Loaded" : "Not loaded"}
            />
        ),
    };
}

function PluginRow({
    plugin,
    breakOnLoad,
    connectedIds,
}: {
    plugin: PluginView;
    breakOnLoad: boolean;
    connectedIds: ReadonlySet<string>;
}): ReactNode {
    const busy = !!plugin.busy;
    const { manifestPath } = plugin;
    const { label: stateLabel, icon: statusIcon } = pluginStatus(plugin, busy);

    const menuItems: MenuItem[] = [
        {
            icon: "folder-opened",
            label: "Open folder…",
            disabled: busy,
            onClick: () => { dispatch({ kind: "openPluginFolder", manifestPath }); },
        },
        {
            icon: "go-to-file",
            label: "Open manifest.json",
            disabled: busy,
            onClick: () => { dispatch({ kind: "openManifestFile", manifestPath }); },
        },
        {
            icon: "json",
            label: "Create launch.json configuration",
            disabled: busy,
            onClick: () => { dispatch({ kind: "createPluginLaunchConfig", manifestPath }); },
        },
        {
            icon: "package",
            label: "Create installer…",
            disabled: busy || !!plugin.manifestError,
            onClick: () => { dispatch({ kind: "packPlugin", manifestPath }); },
        },
        {
            icon: "sync",
            label: "Reload (unload + load)",
            disabled: busy || !plugin.loaded,
            onClick: () => { dispatch({ kind: "reloadPlugin", manifestPath, breakOnLoad }); },
        },
    ];

    return (
        <div className={clsx("row plugin-row", { "active-item": plugin.hasActiveFile })}>
            {statusIcon}
            <div className="row-text">
                <div className="row-line">
                    <span className="row-title">{plugin.name}</span>
                    {plugin.hostApps.map((appId) => (
                        <HostBadge
                            key={appId}
                            uiCode={getUICodeByValue(appId)}
                            connected={connectedIds.has(appId)}
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
                        fullPath={parentFolder(plugin.manifestPath)}
                        matchLength={plugin.matchedFolderLength}
                    />
                </div>
                <div className="row-sub" title={plugin.manifestError ?? plugin.manifestPath}>
                    {`${plugin.id || plugin.manifestError} · ${stateLabel}`}
                </div>
            </div>
            <div className="row-actions">
                <ToggleIconButton
                    active={plugin.loaded}
                    whenActive={{
                        icon: "debug-stop",
                        label: "Unload",
                        disabled: busy,
                        onClick: () => { dispatch({ kind: "unloadPlugin", manifestPath }); },
                    }}
                    whenInactive={{
                        icon: "play",
                        label: breakOnLoad ? "Load (break on load)" : "Load",
                        disabled: busy || !!plugin.manifestError,
                        disabledReason: plugin.manifestError,
                        onClick: () => { dispatch({ kind: "loadPlugin", manifestPath, breakOnLoad }); },
                    }}
                />
                <ToggleIconButton
                    active={plugin.debugging}
                    whenActive={{
                        icon: "debug-disconnect",
                        label: "Stop debugging",
                        disabled: busy,
                        onClick: () => { dispatch({ kind: "detachDebugger", manifestPath }); },
                    }}
                    whenInactive={{
                        icon: "debug",
                        label: plugin.pendingBreakOnStart ? "Attach debugger (plugin is paused)" : "Debug",
                        emphasized: plugin.pendingBreakOnStart,
                        disabled: busy || !!plugin.manifestError,
                        disabledReason: plugin.manifestError,
                        onClick: () => { dispatch({ kind: "attachDebugger", manifestPath, breakOnLoad }); },
                    }}
                />
                <ToggleIconButton
                    active={plugin.inspectorOpen}
                    whenActive={{
                        icon: "right-panel-hide",
                        label: "Close inspector",
                        disabled: busy,
                        onClick: () => { dispatch({ kind: "closeInspector", manifestPath }); },
                    }}
                    whenInactive={{
                        icon: "inspect",
                        label: plugin.pendingBreakOnStart
                            ? "Inspector unavailable — attach the debugger first"
                            : "Open HTML/CSS inspector",
                        disabled: busy || !plugin.loaded || plugin.pendingBreakOnStart,
                        disabledReason: plugin.pendingBreakOnStart
                            ? "Attach the debugger first (break on start)"
                            : "Load the plugin first",
                        onClick: () => { dispatch({ kind: "openInspector", manifestPath }); },
                    }}
                />
                <IconButton
                    icon="refresh"
                    label="Refresh (in-place reload)"
                    disabled={busy || !plugin.loaded}
                    onClick={() => { dispatch({ kind: "refreshPlugin", manifestPath }); }}
                />
                <ToggleIconButton
                    active={plugin.watching}
                    whenActive={{
                        icon: "eye-closed",
                        label: "Unwatch",
                        disabled: busy,
                        onClick: () => { dispatch({ kind: "setWatch", target: { manifestPath }, value: false }); },
                    }}
                    whenInactive={{
                        icon: "eye",
                        label: "Watch",
                        disabled: busy,
                        onClick: () => { dispatch({ kind: "setWatch", target: { manifestPath }, value: true }); },
                    }}
                />
                <OverflowMenu items={menuItems} disabled={busy} />
                <IconButton
                    icon="close-small"
                    label="Remove plugin from this list"
                    disabled={busy}
                    onClick={() => { dispatch({ kind: "removePlugin", manifestPath }); }}
                />
            </div>
        </div>
    );
}
