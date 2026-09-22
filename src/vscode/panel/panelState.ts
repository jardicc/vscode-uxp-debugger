/**
 * Pure `PanelState` snapshot builder (CONTROL-PANEL.md §4) — no `vscode`
 * imports, all runtime facts arrive as plain inputs so this is fully
 * unit-testable under vitest.
 */

import * as path from "path";
import { type RegistryData, pathKey } from "./PluginRegistry";
import type {
    BrokerStatus,
    ConnectedAppView,
    PanelState,
    PluginView,
    ScriptView,
} from "./panelProtocol";

/** The subset of a broker `PluginSession` the snapshot builder needs. */
export interface SessionFact {
    clientSessionId: string;
    kind: "plugin" | "script";
    /** Absolute manifest path (plugin sessions only). */
    manifestPath?: string;
    /** Absolute plugin/script folder path. */
    pluginPath: string;
    /** Display name (script sessions: the script file name). */
    name: string;
    /**
   * Original script path as registered in the panel (script sessions only) —
   * differs from `pluginPath`/`name` when run from a generated temp file
   * (e.g. stripped `.ts`).
   */
    scriptSourcePath?: string;
}

export interface ManifestFacts {
    name: string;
    id: string;
    /** Host app ids, e.g. ["PS"]. */
    hostApps: string[];
    error?: string;
}

export interface SnapshotInputs {
    registry: RegistryData;
    brokerStatus: BrokerStatus;
    /** Message for the `error` broker status, if any. */
    brokerError?: string;
    connectedApps: ConnectedAppView[];
    /** Catalog app ids confirmed installed, or undefined when unknown (see `PanelState`). */
    installedApps?: string[];
    sessions: SessionFact[];
    /** clientSessionIds with an attached debugger. */
    attachedSessionIds: ReadonlySet<string>;
    /** clientSessionIds loaded break-on-start, awaiting first attach. */
    pendingBreakSessionIds: ReadonlySet<string>;
    /** clientSessionIds with an open HTML inspector panel. */
    inspectorSessionIds: ReadonlySet<string>;
    /** Row keys (see rowKeyForAction) with an in-flight action → action kind. */
    busyRows: ReadonlyMap<string, string>;
    activeEditor: { isManifest: boolean; isScript: boolean; path?: string };
    /** Absolute paths of the open workspace folders, for plugin-path highlighting. */
    workspaceFolders: readonly string[];
    /** Parse a manifest from disk; must not throw. */
    readManifest: (manifestPath: string) => ManifestFacts;
    fileExists: (filePath: string) => boolean;
}

function normalizeSlashes(p: string): string {
    return p.replace(/\\/g, "/");
}

/**
 * Length of the longest open workspace-folder path that is a prefix of
 * `folderPath` (case-insensitive on win32/darwin, via `pathKey`), for
 * highlighting the matching part of a plugin's folder path. Undefined when
 * no open workspace folder contains `folderPath`.
 */
export function matchingWorkspaceFolderLength(
    folderPath: string,
    workspaceFolders: readonly string[],
): number | undefined {
    const normalized = normalizeSlashes(folderPath);
    const normalizedKey = pathKey(normalized);
    let best: number | undefined;
    for (const ws of workspaceFolders) {
        const wsNormalized = normalizeSlashes(ws).replace(/\/$/, "");
        const wsKey = pathKey(wsNormalized);
        if (normalizedKey === wsKey || normalizedKey.startsWith(wsKey + "/")) {
            if (best === undefined || wsNormalized.length > best) {
                best = wsNormalized.length;
            }
        }
    }
    return best;
}

/** Extension → implied host-app badge for scripts (ANY when unrestricted). */
export function scriptHostBadge(scriptPath: string): string {
    switch (path.extname(scriptPath).toLowerCase()) {
        case ".psjs":
            return "PS";
        case ".idjs":
            return "ID";
        default:
            return "ANY";
    }
}

function commonPathPrefixLength(a: string, b: string): number {
    let i = 0;
    const len = Math.min(a.length, b.length);
    while (i < len && a[i] === b[i]) {
        i++;
    }
    if (i === a.length && i === b.length) {
        return i;
    }
    while (i > 0 && a[i - 1] !== "/") {
        i--;
    }
    return i;
}

export function buildPanelState(inputs: SnapshotInputs): PanelState {
    const sessionsByManifest = new Map<string, SessionFact[]>();
    for (const session of inputs.sessions) {
        if (session.kind === "plugin" && session.manifestPath) {
            const key = pathKey(path.normalize(session.manifestPath));
            const list = sessionsByManifest.get(key) ?? [];
            list.push(session);
            sessionsByManifest.set(key, list);
        }
    }

    const scriptSessionsByPath = new Map<string, SessionFact[]>();
    for (const session of inputs.sessions) {
        if (session.kind === "script") {
            const key = pathKey(
                path.normalize(session.scriptSourcePath ?? path.join(session.pluginPath, session.name)),
            );
            const list = scriptSessionsByPath.get(key) ?? [];
            list.push(session);
            scriptSessionsByPath.set(key, list);
        }
    }

    const normalizedActivePath = inputs.activeEditor.path ? path.normalize(inputs.activeEditor.path) : undefined;
    const activePathKey = normalizedActivePath ? pathKey(normalizedActivePath) : undefined;

    let activeScriptKey: string | undefined;
    if (activePathKey) {
        const matchingScript = inputs.registry.scripts.find(
            (script) => pathKey(path.normalize(script.scriptPath)) === activePathKey,
        );
        if (matchingScript) {
            activeScriptKey = activePathKey;
        }
    }

    let activePluginManifestKey: string | undefined;
    if (activePathKey && !activeScriptKey) {
        // `activePathKey` is only populated alongside `normalizedActivePath`.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const activeNormalized = normalizeSlashes(normalizedActivePath!);
        const activeKey = pathKey(activeNormalized);

        let activeWs: string | undefined;
        let activeWsLen = -1;
        for (const ws of inputs.workspaceFolders) {
            const wsNorm = normalizeSlashes(ws).replace(/\/$/, "");
            const wsKey = pathKey(wsNorm);
            if (activeKey === wsKey || activeKey.startsWith(wsKey + "/")) {
                if (wsNorm.length > activeWsLen) {
                    activeWsLen = wsNorm.length;
                    activeWs = wsKey;
                }
            }
        }

        let bestScore = -1;
        for (const plugin of inputs.registry.plugins) {
            const pluginDir = normalizeSlashes(path.dirname(plugin.manifestPath)).replace(/\/$/, "");
            const pluginDirKey = pathKey(pluginDir);

            const inSameWs = activeWs && (pluginDirKey === activeWs || pluginDirKey.startsWith(activeWs + "/"));
            const isParent = activeKey === pluginDirKey || activeKey.startsWith(pluginDirKey + "/");

            if (inSameWs || isParent) {
                const score = commonPathPrefixLength(activeKey, pluginDirKey);
                if (score > bestScore) {
                    bestScore = score;
                    activePluginManifestKey = pathKey(path.normalize(plugin.manifestPath));
                }
            }
        }
    }

    const plugins: PluginView[] = inputs.registry.plugins.map((plugin) => {
        const manifestKey = pathKey(path.normalize(plugin.manifestPath));
        const sessions = sessionsByManifest.get(manifestKey) ?? [];
        const facts = inputs.readManifest(plugin.manifestPath);
        const folderPath = normalizeSlashes(path.dirname(plugin.manifestPath));
        return {
            manifestPath: plugin.manifestPath,
            name: facts.name,
            id: facts.id,
            hostApps: facts.hostApps,
            manifestError: facts.error,
            loaded: sessions.length > 0,
            debugging: sessions.some((s) => inputs.attachedSessionIds.has(s.clientSessionId)),
            pendingBreakOnStart: sessions.some((s) =>
                inputs.pendingBreakSessionIds.has(s.clientSessionId),
            ),
            inspectorOpen: sessions.some((s) =>
                inputs.inspectorSessionIds.has(s.clientSessionId),
            ),
            watching: plugin.watch,
            busy: inputs.busyRows.get(`plugin:${plugin.manifestPath}`),
            matchedFolderLength: matchingWorkspaceFolderLength(folderPath, inputs.workspaceFolders),
            hasActiveFile: activePluginManifestKey === manifestKey,
        };
    });

    const scripts: ScriptView[] = inputs.registry.scripts.map((script) => {
        const scriptKey = pathKey(path.normalize(script.scriptPath));
        const sessions = scriptSessionsByPath.get(scriptKey) ?? [];
        return {
            scriptPath: script.scriptPath,
            name: path.basename(script.scriptPath),
            hostApp: scriptHostBadge(script.scriptPath),
            args: script.args,
            exists: inputs.fileExists(script.scriptPath),
            // A broker session outlives debugger detach (UXP has no "unload
            // script" RPC) — track the actual attachment, not session presence.
            debugging: sessions.some((s) => inputs.attachedSessionIds.has(s.clientSessionId)),
            watching: script.watch,
            busy: inputs.busyRows.get(`script:${script.scriptPath}`),
            isActiveFile: activeScriptKey === scriptKey,
        };
    });

    const launchingApps = [...inputs.busyRows.keys()]
        .filter((key) => key.startsWith("app:"))
        .map((key) => key.slice("app:".length));

    return {
        brokerStatus: inputs.brokerStatus,
        brokerError: inputs.brokerError,
        connectedApps: inputs.connectedApps,
        launchingApps,
        installedApps: inputs.installedApps,
        breakOnLoad: inputs.registry.breakOnLoad,
        scriptTargetApp: inputs.registry.scriptTargetApp,
        compactView: inputs.registry.compactView,
        activeEditor: inputs.activeEditor,
        plugins,
        scripts,
    };
}
