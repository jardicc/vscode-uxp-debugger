import { describe, expect, it } from "vitest";
import type { RegistryData } from "../../src/vscode/panel/PluginRegistry";
import { buildDebugState, type DebugStateInputs, type SessionFact } from "../../src/vscode/tools/debugStateSnapshot";

function baseRegistry(overrides: Partial<RegistryData> = {}): RegistryData {
    return {
        v: 2,
        plugins: [],
        scripts: [],
        breakOnLoad: { plugins: false, scripts: false },
        compactView: false,
        ...overrides,
    };
}

function baseInputs(overrides: Partial<DebugStateInputs> = {}): DebugStateInputs {
    return {
        registry: baseRegistry(),
        brokerStatus: "running",
        sessions: [],
        attachedSessionIds: new Set(),
        pendingBreakSessionIds: new Set(),
        readManifest: () => ({ name: "Demo", id: "com.example.demo", hostApps: ["PS"] }),
        fileExists: () => true,
        ...overrides,
    };
}

function pluginSession(overrides: Partial<SessionFact> = {}): SessionFact {
    return {
        clientSessionId: "uxp-session-1",
        kind: "plugin",
        manifestPath: "A:/plugin/manifest.json",
        pluginPath: "A:/plugin",
        name: "Demo",
        appId: "PS",
        appName: "Photoshop",
        appVersion: "26.0.0",
        ...overrides,
    };
}

describe("buildDebugState", () => {
    it("marks a registered plugin with no live session as having no sessions", () => {
        const state = buildDebugState(
            baseInputs({ registry: baseRegistry({ plugins: [{ manifestPath: "A:/plugin/manifest.json", watch: false }] }) }),
        );
        expect(state.plugins).toHaveLength(1);
        expect(state.plugins[0].sessions).toEqual([]);
    });

    it("reports a live but unattached session as attached: false", () => {
        const state = buildDebugState(
            baseInputs({
                registry: baseRegistry({ plugins: [{ manifestPath: "A:/plugin/manifest.json", watch: false }] }),
                sessions: [pluginSession()],
            }),
        );
        expect(state.plugins[0].sessions).toEqual([
            {
                clientSessionId: "uxp-session-1",
                appId: "PS",
                appName: "Photoshop",
                appVersion: "26.0.0",
                attached: false,
                pendingBreakOnStart: false,
            },
        ]);
    });

    it("marks a session as attached only via attachedSessionIds, not just session presence", () => {
        const state = buildDebugState(
            baseInputs({
                registry: baseRegistry({ plugins: [{ manifestPath: "A:/plugin/manifest.json", watch: false }] }),
                sessions: [pluginSession()],
                attachedSessionIds: new Set(["uxp-session-1"]),
            }),
        );
        expect(state.plugins[0].sessions[0].attached).toBe(true);
    });

    it("matches manifest paths case-insensitively on win32/darwin (pathKey)", () => {
        const state = buildDebugState(
            baseInputs({
                registry: baseRegistry({ plugins: [{ manifestPath: "A:/Plugin/Manifest.json", watch: false }] }),
                sessions: [pluginSession({ manifestPath: "a:/plugin/manifest.json" })],
            }),
        );
        expect(state.plugins[0].sessions).toHaveLength(1);
    });

    it("surfaces a manifest parse error via manifestError", () => {
        const state = buildDebugState(
            baseInputs({
                registry: baseRegistry({ plugins: [{ manifestPath: "A:/plugin/manifest.json", watch: false }] }),
                readManifest: () => ({ name: "plugin", id: "", hostApps: [], error: "not valid JSON" }),
            }),
        );
        expect(state.plugins[0].manifestError).toBe("not valid JSON");
    });

    it("groups script sessions by scriptSourcePath, falling back to pluginPath/name", () => {
        const state = buildDebugState(
            baseInputs({
                registry: baseRegistry({ scripts: [{ scriptPath: "A:/plugin/run.ccjs", args: "", watch: false }] }),
                sessions: [
                    pluginSession({
                        kind: "script",
                        manifestPath: undefined,
                        scriptSourcePath: "A:/plugin/run.ccjs",
                        name: "run.ccjs",
                        clientSessionId: "uxp-session-2",
                    }),
                ],
                attachedSessionIds: new Set(["uxp-session-2"]),
            }),
        );
        expect(state.scripts).toHaveLength(1);
        expect(state.scripts[0].sessions[0].attached).toBe(true);
    });

    it("passes through brokerStatus/brokerError untouched", () => {
        const state = buildDebugState(baseInputs({ brokerStatus: "error", brokerError: "boom" }));
        expect(state.brokerStatus).toBe("error");
        expect(state.brokerError).toBe("boom");
    });
});
