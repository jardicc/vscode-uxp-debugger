/**
 * Scripts section (CONTROL-PANEL.md §2.2 / §3). Script runs never prompt for
 * arguments — the Args editor is the only edit path (§9.11).
 */

import clsx from "clsx";
import type { ChangeEvent, ReactNode } from "react";
import type { PanelState, ScriptView } from "../panelProtocol";
import { dispatch } from "./vscodeApi";
import { IconButton, OverflowMenu, PathLabel, Spinner } from "./common";

export function ScriptsSection({ state }: { state: PanelState }): ReactNode {
    if (state.scripts.length === 0) {
        return (
            <div className="empty-state">
                <p>No scripts yet.</p>
                <p>
                    Register a
                    {" "}
                    <code>.psjs</code>
                    {" "}
                    /
                    {" "}
                    <code>.idjs</code>
                    {" "}
                    /
                    {" "}
                    <code>.ccjs</code>
                    {" "}
                    /
                    {" "}
                    <code>.js</code>
                    {" "}
                    /
                    <code>.ts</code>
                    {" "}
                    file to run and debug it in a host app.
                </p>
            </div>
        );
    }

    return (
        <div className="section-body scripts-section">
            {state.scripts.map((script) => (
                <ScriptRow key={script.scriptPath} script={script} />
            ))}
        </div>
    );
}

/** "+" add-script control for the Scripts section header. */
export function AddScriptButton({ state }: { state: PanelState }): ReactNode {
    const hasScript = state.activeEditor.isScript;
    return (
        <OverflowMenu
            icon="add"
            label="Add script…"
            items={[
                {
                    icon: "search",
                    label: "Add script (pick)…",
                    onClick: () => { dispatch({ kind: "addScriptPick" }); },
                },
                {
                    icon: "debug-alt",
                    label: "Add active file & debug",
                    disabled: !hasScript,
                    onClick: () => { dispatch({ kind: "addActiveScript", andDebug: true }); },
                },
                {
                    icon: "file-code",
                    label: "Add active file",
                    disabled: !hasScript,
                    onClick: () => { dispatch({ kind: "addActiveScript", andDebug: false }); },
                },
            ]}
        />
    );
}

/** "Target host app" dropdown for the Scripts section header (§9.9). */
export function ScriptTargetSelect({ state }: { state: PanelState }): ReactNode {
    return (
        <select
            className="target-select"
            title="Which connected host app runs the scripts"
            value={state.scriptTargetApp ?? ""}
            onClick={(e) => { e.stopPropagation(); }}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => { dispatch({ kind: "setScriptTargetApp", appId: e.target.value || undefined }); }}
        >
            <option value="">Any host app</option>
            {state.connectedApps.map((app) => (
                <option
                    key={app.appId}
                    value={app.appId}
                    disabled={!app.supportsScripts}
                    title={app.supportsScripts ? undefined : "This app does not report script-debugging support"}
                >
                    {app.name}
                    {" "}
                    {app.version}
                    {!app.supportsScripts && " (no script support)"}
                </option>
            ))}
            {state.scriptTargetApp
                && !state.connectedApps.some((a) => a.appId === state.scriptTargetApp) && (
                <option value={state.scriptTargetApp}>
                    {state.scriptTargetApp}
                    {" "}
                    (not connected)
                </option>
            )}
        </select>
    );
}

function ScriptRow({ script }: { script: ScriptView }): ReactNode {
    const busy = !!script.busy;
    const disabled = busy || !script.exists;
    const missingReason = script.exists ? undefined : "Script file not found on disk";

    const statusIcon = busy
        ? (
                <Spinner />
            )
        : !script.exists
                ? (
                        <span className="codicon codicon-warning status-icon error" title="File not found" />
                    )
                : script.debugging
                    ? (
                            <span className="codicon codicon-debug-alt status-icon debugging" title="Debugging" />
                        )
                    : (
                            <span className="codicon codicon-file status-icon" />
                        );

    return (
        <div className={clsx("row script-row", script.isActiveFile && "active-item")}>
            {statusIcon}
            <div className="row-text">
                <div className="row-line">
                    <span className="row-title">{script.name}</span>
                    <span className="host-badge static" title="Host app implied by the file extension">
                        {script.hostApp}
                    </span>
                </div>
                <div className="row-sub">
                    <PathLabel
                        fullPath={script.scriptPath}
                        matchLength={script.isActiveFile ? Infinity : undefined}
                    />
                    {script.debugging && <span className="state-suffix"> · debugging</span>}
                    {script.args && (
                        <span className="state-suffix" title={`Arguments: ${script.args}`}>
                            {" "}
                            · args:
                            {" "}
                            {script.args}
                        </span>
                    )}
                </div>
            </div>
            <div className="row-actions">
                {script.debugging
                    ? (
                            <IconButton
                                icon="debug-stop"
                                label="Stop debugging"
                                disabled={busy}
                                onClick={() => { dispatch({ kind: "stopScript", scriptPath: script.scriptPath }); }}
                            />
                        )
                    : (
                            <IconButton
                                icon="debug-alt"
                                label="Run & debug"
                                disabled={disabled}
                                disabledReason={missingReason}
                                onClick={() => {
                                    dispatch({
                                        kind: "debugScript",
                                        scriptPath: script.scriptPath,
                                    });
                                }}
                            />
                        )}
                <IconButton
                    icon={script.watching ? "eye-closed" : "eye"}
                    label={script.watching ? "Unwatch" : "Watch"}
                    disabled={disabled}
                    disabledReason={missingReason}
                    onClick={() => {
                        dispatch({
                            kind: "setWatch",
                            target: { scriptPath: script.scriptPath },
                            value: !script.watching,
                        });
                    }}
                />
                <IconButton
                    icon="go-to-file"
                    label="Open file"
                    disabled={busy || !script.exists}
                    disabledReason={missingReason}
                    onClick={() => { dispatch({ kind: "openScriptFile", scriptPath: script.scriptPath }); }}
                />
                <IconButton
                    icon="symbol-parameter"
                    label={script.args ? `Pass arguments… (${script.args})` : "Pass arguments…"}
                    disabled={busy}
                    onClick={() => { dispatch({ kind: "editScriptArgs", scriptPath: script.scriptPath }); }}
                />
                <IconButton
                    icon="close-small"
                    label="Remove script"
                    disabled={busy}
                    onClick={() => { dispatch({ kind: "removeScript", scriptPath: script.scriptPath }); }}
                />
            </div>
        </div>
    );
}
