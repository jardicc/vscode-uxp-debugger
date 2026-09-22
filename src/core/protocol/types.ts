/**
 * Curated UXP DevTools wire-protocol types — the subset actually used by this
 * extension's broker. Derived from `uxp-cli-v1/uxp-devtools-protocol.types.ts`
 * (the authoritative, complete typing of Adobe's protocol).
 *
 * Transport: JSON text frames over WebSocket between the broker (us) and the
 * Adobe host application (Photoshop, InDesign, …).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default TCP port of the UDT-compatible broker (host apps expect this via Vulcan). */
export const DEFAULT_BROKER_PORT = 14001;

/** WebSocket path prefix for per-plugin Chrome DevTools frontends. */
export const CDT_SOCKET_PREFIX = "/socket/cdt/";

/** Protocol timeouts in milliseconds (verbatim from Adobe's `AppClient.js`). */
export const ProtocolTimeouts = {
    /** `Plugin/load`, `Plugin/reload`, `Plugin/runScript`. */
    pluginOpMs: 5000,
    /** `Plugin/list`. */
    refreshListMs: 1500,
    /** `App/info` handshake reply. */
    appInfoMs: 5000,
} as const;

// ---------------------------------------------------------------------------
// Shared data shapes
// ---------------------------------------------------------------------------

/** Host-app capability flags reported in `App/info` (UDT 2.x). */
export interface SupportedFeatures {
    /** Host supports `Plugin/runScript` debugging. */
    debugScripts?: boolean;
    [key: string]: unknown;
}

/** Identity of a host application as reported by the app itself in the `App/info` reply. */
export interface AppInfo {
    /** Host application id, e.g. `"PS"`. */
    appId: string;
    /** Host application version, e.g. `"27.9.0"`. */
    appVersion: string;
    /** Human-readable application name, e.g. `"Photoshop"`. */
    appName: string;
    /** Version of the embedded UXP runtime. */
    uxpVersion: string;
    /** OS platform of the host app process (`"win32"`, `"darwin"`). */
    platform?: string;
    /** `true` for sandboxed (UWP-style) hosts — unsupported by this extension (v1). */
    sandbox?: boolean;
    /** Sandbox-writable base folder (sandboxed hosts only). */
    sandboxStoragePath?: string;
    /** Runtime capability negotiation (UDT 2.x hosts). */
    supportedFeatures?: SupportedFeatures;
}

/** Source location descriptor of a plugin. Only `disk` exists. */
export interface PluginProvider {
    type: "disk";
    /** Absolute path of the plugin folder (the folder containing `manifest.json`). */
    path: string;
}

/** One `host` entry of a UXP plugin manifest. */
export interface UxpManifestHost {
    /** Target application id — plain `"PS"` or the `"PS@22.0"` id\@version form. */
    app: string;
    /** Minimum supported app version, `"x.y.z"` form. */
    minVersion?: string;
    [key: string]: unknown;
}

/** Minimal shape of `manifest.json` relied upon by the protocol. */
export interface UxpPluginManifest {
    id: string;
    name: string;
    main: string;
    version: string;
    host: UxpManifestHost | UxpManifestHost[] | string | string[];
    manifestVersion?: number;
    [key: string]: unknown;
}

/** Log severity emitted by host apps. */
export type HostAppLogLevel
    = | "verbose"
        | "log"
        | "info"
        | "warn"
        | "error"
        | (string & {});

// ---------------------------------------------------------------------------
// Frames: broker → host app
// ---------------------------------------------------------------------------

/** Sent once immediately after the app's WebSocket connects. No reply expected. */
export interface ReadyMessage {
    command: "ready";
}

/** Request the host app's identity. Reply: {@link AppInfoReply}. */
export interface AppInfoRequest {
    command: "App";
    action: "info";
    requestId: number;
}

/** Load a development plugin from disk. Timeout: {@link ProtocolTimeouts.pluginOpMs}. */
export interface PluginLoadRequest {
    command: "Plugin";
    action: "load";
    requestId: number;
    params: { provider: PluginProvider };
    /** When `true`, the plugin blocks on startup until a CDT debugger attaches. */
    breakOnStart?: boolean;
}

/** Host-side manifest validation — always executed before a load. */
export interface PluginValidateRequest {
    command: "Plugin";
    action: "validate";
    requestId: number;
    params: { provider: PluginProvider };
    /** The parsed content of the plugin's `manifest.json`. */
    manifest: UxpPluginManifest;
}

/** Reload an already-loaded plugin. */
export interface PluginReloadRequest {
    command: "Plugin";
    action: "reload";
    requestId: number;
    /** Host session id (this is the app socket — host id space). */
    pluginSessionId: string;
}

/** Unload a loaded plugin. */
export interface PluginUnloadRequest {
    command: "Plugin";
    action: "unload";
    requestId: number;
    pluginSessionId: string;
}

/** Run a `.ccjs` / `.psjs` / `.idjs` script (UDT 2.x hosts). */
export interface PluginRunScriptRequest {
    command: "Plugin";
    action: "runScript";
    requestId: number;
    params: {
        provider: PluginProvider;
        /** Script file name (with extension), relative to `provider.path`. */
        fileName: string;
        /** Arbitrary JSON values passed to the script. */
        userArgs: unknown[];
    };
}

/** Notify the runtime that a per-plugin DevTools frontend attached / detached. */
export interface PluginCdtStateRequest {
    command: "Plugin";
    action: "cdtConnected" | "cdtDisconnected";
    requestId: number;
    pluginSessionId: string;
}

// ---------------------------------------------------------------------------
// Frames: host app → broker (unsolicited)
// ---------------------------------------------------------------------------

/** Handshake opener; the broker answers with {@link AppInfoRequest}. */
export interface InitRuntimeClientMessage {
    command: "initRuntimeClient";
    platform?: string;
}

/** A plugin was unloaded on the host side (e.g. via the app's own UI). */
export interface UxpPluginUnloadedEvent {
    command: "UXP";
    action: "unloaded";
    pluginSessionId: string;
}

/** A log line from the host app / UXP runtime. */
export interface UxpHostAppLogEvent {
    command: "UXP";
    action: "log";
    level: HostAppLogLevel;
    message: string;
}

// ---------------------------------------------------------------------------
// Frames: both directions
// ---------------------------------------------------------------------------

/**
 * Per-plugin Chrome DevTools Protocol tunnel frame. Fire-and-forget in both
 * directions. `pluginSessionId` is always in the **host** id space on this socket.
 */
export interface CdtTunnelMessage {
    command: "CDT";
    pluginSessionId: string;
    /** The raw CDP JSON frame, as a string. */
    cdtMessage: string;
}

/**
 * Universal response frame. Success replies spread result fields next to
 * `command`/`requestId`; failure replies carry `error`.
 */
export interface ReplyMessage {
    command: "reply";
    requestId: number;
    /** Presence of this field means the request failed. */
    error?: string;
    [key: string]: unknown;
}

/** Reply payload of `App/info`. */
export interface AppInfoReply extends ReplyMessage, Omit<AppInfo, "platform"> {
    platform: string;
}

/** Reply payload of `Plugin/load` and `Plugin/runScript`. */
export interface PluginSessionReply extends ReplyMessage {
    pluginSessionId: string;
}

/** Reply payload of `Plugin/validate`. */
export interface PluginValidateReply extends ReplyMessage {
    success: boolean;
    errorMessage?: string;
}

/** Every frame the broker can send to a host application. */
export type BrokerToAppMessage
    = | ReadyMessage
        | AppInfoRequest
        | PluginLoadRequest
        | PluginValidateRequest
        | PluginReloadRequest
        | PluginUnloadRequest
        | PluginRunScriptRequest
        | PluginCdtStateRequest
        | CdtTunnelMessage;

/** Every frame a host application can send to the broker. */
export type AppToBrokerMessage
    = | InitRuntimeClientMessage
        | UxpPluginUnloadedEvent
        | UxpHostAppLogEvent
        | CdtTunnelMessage
        | ReplyMessage;
