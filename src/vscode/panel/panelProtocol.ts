/**
 * Shared message protocol between the control-panel webview and the
 * extension host (CONTROL-PANEL.md §4.1). Types only — NO `vscode` imports
 * and no runtime dependencies, so the browser bundle can import it too.
 */

// ---------------------------------------------------------------------------
// Persisted per-entry settings (CONTROL-PANEL.md §5.2)
// ---------------------------------------------------------------------------

/** Row identity for actions that apply to either a plugin or a script. */
export type TargetRef = { manifestPath: string } | { scriptPath: string };

// ---------------------------------------------------------------------------
// webview → extension
// ---------------------------------------------------------------------------

export type PanelAction
    = | { kind: "loadPlugin"; manifestPath: string; breakOnLoad: boolean }
        | { kind: "unloadPlugin"; manifestPath: string }
  /** `Plugin/reload` wire command — in-place, attached debugger survives. */
        | { kind: "refreshPlugin"; manifestPath: string }
  /** Unload + Load sequence (full reset) with debugger/inspector auto-restore. */
        | { kind: "reloadPlugin"; manifestPath: string; breakOnLoad: boolean }
        | { kind: "attachDebugger"; manifestPath: string }
        | { kind: "detachDebugger"; manifestPath: string }
        | { kind: "openInspector"; manifestPath: string }
        | { kind: "closeInspector"; manifestPath: string }
        | { kind: "addPluginPick" }
        | { kind: "addActiveManifest" }
        | { kind: "removePlugin"; manifestPath: string }
    /** Ancestor-folder picker; see CONTROL-PANEL.md §3.3. */
        | {
            kind: "openPluginFolder";
            manifestPath: string;
            /** Omitted → the host shows the folder picker, then the mode picker. */
            folder?: string;
            mode?: "reveal" | "addToWorkspace" | "newWindow";
        }
        | { kind: "openManifestFile"; manifestPath: string }
  /** Host badge click → installed-version QuickPick + launch (host side). */
        | { kind: "launchHostApp"; appId: string }
        | { kind: "debugScript"; scriptPath: string }
        | { kind: "stopScript"; scriptPath: string }
  /** Watch-mode restart (stop + re-run) — not sent by the webview, only dispatched internally. */
        | { kind: "restartScript"; scriptPath: string }
  /** Host shows the args InputBox (prefilled from the registry). */
        | { kind: "editScriptArgs"; scriptPath: string }
        | { kind: "openScriptFile"; scriptPath: string }
        | { kind: "addScriptPick" }
        | { kind: "addActiveScript"; andDebug: boolean }
        | { kind: "removeScript"; scriptPath: string }
        | { kind: "setBreakOnLoad"; scope: "plugins" | "scripts"; value: boolean }
        | { kind: "setScriptTargetApp"; appId: string | undefined }
  /** Persists §5.2; the watch feature itself is a v1 stub. */
        | { kind: "setWatch"; target: TargetRef; value: boolean }
  /** Validates manifest.json, then shows a Save dialog and writes a `.ccx` zip. */
        | { kind: "packPlugin"; manifestPath: string }
  /** Manual retry after `error`, or manual start from `stopped` (rare). */
        | { kind: "startDiscovery" }
  /** `devModeRequired` banner button — runs the interactive enable-then-start flow. */
        | { kind: "enableDevModeAndStart" }
  /**
   * Blocking-overlay "Take Over" button (`ownedElsewhere`) — unlike the
   * interactive `ensureStarted()` path used by non-panel entry points, this
   * skips the modal confirm dialog (the overlay itself is the confirmation).
   */
        | { kind: "requestTakeover" }
  /** Webview booted — request the first snapshot. */
        | { kind: "ready" };

// ---------------------------------------------------------------------------
// extension → webview
// ---------------------------------------------------------------------------

export type BrokerStatus
    = | "stopped"
        | "starting"
        | "devModeRequired"
        | "running"
        | "ownedElsewhere"
  /** Explicitly stopped via the "Stop UXP Debugger" command/icon. */
        | "stoppedByUser"
        | "error";

export interface ConnectedAppView {
    appId: string;
    name: string;
    version: string;
    uxpVersion: string;
    /** From `App/info.supportedFeatures.debugScripts` — false/undefined on older UXP runtimes. */
    supportsScripts: boolean;
}

export interface PluginView {
    manifestPath: string;
    /** Manifest display name, or the folder name when the manifest is broken. */
    name: string;
    /** Manifest plugin id (empty when unreadable). */
    id: string;
    /** Host-app badges from the manifest `host` entries, e.g. ["PS"]. */
    hostApps: string[];
    /** Human-readable manifest problem (missing file / invalid JSON), if any. */
    manifestError?: string;
    loaded: boolean;
    debugging: boolean;
    /** Loaded with break-on-start and still waiting for its first attach. */
    pendingBreakOnStart: boolean;
    inspectorOpen: boolean;
    /** Persisted toggle (§5.2); feature dormant in v1. */
    watching: boolean;
    /** PanelAction kind currently in flight for this row. */
    busy?: string;
    /**
   * Length of the leading part of the plugin's (forward-slash-normalized)
   * folder path that matches an open workspace folder, for highlighting.
   * Undefined when no open workspace folder contains this plugin.
   */
    matchedFolderLength?: number;
    /** True when the active editor is a file inside this plugin's folder. */
    hasActiveFile?: boolean;
}

export interface ScriptView {
    scriptPath: string;
    name: string;
    /** Badge: extension-implied host app id, or "ANY". */
    hostApp: string;
    /** Raw args text as typed in the Args InputBox. */
    args: string;
    exists: boolean;
    debugging: boolean;
    watching: boolean;
    busy?: string;
    /** True when this script's file is the currently active editor, for highlighting. */
    isActiveFile: boolean;
}

export interface PanelState {
    brokerStatus: BrokerStatus;
    /** Message for the `error` broker status, if any. */
    brokerError?: string;
    connectedApps: ConnectedAppView[];
    /** App ids launched but not yet connected — Apps section shows a spinner. */
    launchingApps: string[];
    /**
   * Catalog app ids confirmed installed on this machine, or `undefined` when
   * detection isn't available (e.g. unsupported platform) — the Apps
   * section only disables the Start button when this is a defined array
   * that omits the app.
   */
    installedApps?: string[];
    breakOnLoad: { plugins: boolean };
    /** Host app id restriction for script runs, or undefined = any. */
    scriptTargetApp: string | undefined;
    /** Persisted, global toggle — hides the secondary detail line(s) on rows (view/title button). */
    compactView: boolean;
    /** Whether an active editor file is eligible for "Add active …" actions. */
    activeEditor: { isManifest: boolean; isScript: boolean };
    plugins: PluginView[];
    scripts: ScriptView[];
}

export interface PanelStateMessage {
    type: "panelState";
    state: PanelState;
}

export interface PanelActionMessage {
    type: "panelAction";
    action: PanelAction;
}

export type ToWebviewMessage = PanelStateMessage;
export type FromWebviewMessage = PanelActionMessage;

/** Stable row key used for busy-tracking and per-row action serialization. */
export function rowKeyForAction(action: PanelAction): string | undefined {
    switch (action.kind) {
        case "loadPlugin":
        case "unloadPlugin":
        case "refreshPlugin":
        case "reloadPlugin":
        case "attachDebugger":
        case "detachDebugger":
        case "openInspector":
        case "closeInspector":
        case "openPluginFolder":
        case "openManifestFile":
        case "removePlugin":
        case "packPlugin":
            return `plugin:${action.manifestPath}`;
        case "debugScript":
        case "stopScript":
        case "restartScript":
        case "editScriptArgs":
        case "removeScript":
            return `script:${action.scriptPath}`;
        case "launchHostApp":
            return `app:${action.appId}`;
        default:
            return undefined;
    }
}
