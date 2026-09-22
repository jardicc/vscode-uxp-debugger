/**
 * Pure snapshot builder for the `uxp_get_debug_state` LM tool
 * (LANGUAGE-MODEL-TOOLS.md §3) — deliberately separate from `panelState.ts`
 * (webview-facing shape/booleans only) since tool consumers need the raw
 * `clientSessionId`s to disambiguate calls to the Tier 1/2 tools when
 * several sessions are attached concurrently.
 *
 * No `vscode` import (same convention as `panelState.ts`) — fully
 * unit-testable under vitest.
 */

import * as path from "path";
import { type RegistryData, pathKey } from "../panel/PluginRegistry";

export interface SessionFact {
    clientSessionId: string;
    kind: "plugin" | "script";
    manifestPath?: string;
    pluginPath: string;
    name: string;
    scriptSourcePath?: string;
    appId: string;
    appName: string;
    appVersion: string;
}

export interface ManifestFacts {
    name: string;
    id: string;
    hostApps: string[];
    error?: string;
}

export interface DebugStateSessionView {
    clientSessionId: string;
    appId: string;
    appName: string;
    appVersion: string;
    attached: boolean;
    pendingBreakOnStart: boolean;
}

export interface DebugStatePluginView {
    manifestPath: string;
    name: string;
    id: string;
    hostApps: string[];
    manifestError?: string;
    watching: boolean;
    sessions: DebugStateSessionView[];
}

export interface DebugStateScriptView {
    scriptPath: string;
    name: string;
    exists: boolean;
    watching: boolean;
    sessions: DebugStateSessionView[];
}

export interface DebugState {
    brokerStatus: string;
    brokerError?: string;
    plugins: DebugStatePluginView[];
    scripts: DebugStateScriptView[];
}

export interface DebugStateInputs {
    registry: RegistryData;
    brokerStatus: string;
    brokerError?: string;
    sessions: SessionFact[];
    attachedSessionIds: ReadonlySet<string>;
    pendingBreakSessionIds: ReadonlySet<string>;
    readManifest: (manifestPath: string) => ManifestFacts;
    fileExists: (filePath: string) => boolean;
}

function toSessionView(
    session: SessionFact,
    attachedSessionIds: ReadonlySet<string>,
    pendingBreakSessionIds: ReadonlySet<string>,
): DebugStateSessionView {
    return {
        clientSessionId: session.clientSessionId,
        appId: session.appId,
        appName: session.appName,
        appVersion: session.appVersion,
        attached: attachedSessionIds.has(session.clientSessionId),
        pendingBreakOnStart: pendingBreakSessionIds.has(session.clientSessionId),
    };
}

export function buildDebugState(inputs: DebugStateInputs): DebugState {
    const sessionsByManifest = new Map<string, SessionFact[]>();
    const sessionsByScript = new Map<string, SessionFact[]>();
    for (const session of inputs.sessions) {
        if (session.kind === "plugin" && session.manifestPath) {
            const key = pathKey(path.normalize(session.manifestPath));
            const list = sessionsByManifest.get(key) ?? [];
            list.push(session);
            sessionsByManifest.set(key, list);
        }
        else if (session.kind === "script") {
            const key = pathKey(
                path.normalize(session.scriptSourcePath ?? path.join(session.pluginPath, session.name)),
            );
            const list = sessionsByScript.get(key) ?? [];
            list.push(session);
            sessionsByScript.set(key, list);
        }
    }

    const plugins: DebugStatePluginView[] = inputs.registry.plugins.map((plugin) => {
        const key = pathKey(path.normalize(plugin.manifestPath));
        const facts = inputs.readManifest(plugin.manifestPath);
        const sessions = (sessionsByManifest.get(key) ?? []).map((s) =>
            toSessionView(s, inputs.attachedSessionIds, inputs.pendingBreakSessionIds),
        );
        return {
            manifestPath: plugin.manifestPath,
            name: facts.name,
            id: facts.id,
            hostApps: facts.hostApps,
            manifestError: facts.error,
            watching: plugin.watch,
            sessions,
        };
    });

    const scripts: DebugStateScriptView[] = inputs.registry.scripts.map((script) => {
        const key = pathKey(path.normalize(script.scriptPath));
        const sessions = (sessionsByScript.get(key) ?? []).map((s) =>
            toSessionView(s, inputs.attachedSessionIds, inputs.pendingBreakSessionIds),
        );
        return {
            scriptPath: script.scriptPath,
            name: path.basename(script.scriptPath),
            exists: inputs.fileExists(script.scriptPath),
            watching: script.watch,
            sessions,
        };
    });

    return {
        brokerStatus: inputs.brokerStatus,
        brokerError: inputs.brokerError,
        plugins,
        scripts,
    };
}
