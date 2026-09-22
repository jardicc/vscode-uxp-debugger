import * as path from "path";
import { describe, expect, it } from "vitest";
import {
    type ManifestFacts,
    type SnapshotInputs,
    buildPanelState,
    scriptHostBadge,
} from "../../src/vscode/panel/panelState";
import type { RegistryData } from "../../src/vscode/panel/PluginRegistry";

const PLUGIN_DIR = path.join("C:", "plugins", "sample");
const MANIFEST = path.join(PLUGIN_DIR, "manifest.json");
const SCRIPT = path.join("C:", "scripts", "align.psjs");

function registryWith(overrides: Partial<RegistryData> = {}): RegistryData {
    return {
        v: 2,
        plugins: [{ manifestPath: MANIFEST, watch: false }],
        scripts: [{ scriptPath: SCRIPT, args: "", watch: false }],
        breakOnLoad: { plugins: false, scripts: false },
        scriptTargetApp: undefined,
        compactView: false,
        ...overrides,
    };
}

function inputsWith(overrides: Partial<SnapshotInputs> = {}): SnapshotInputs {
    const manifestFacts: ManifestFacts = {
        name: "Sample plugin",
        id: "cz.bereza.sample",
        hostApps: ["PS"],
    };
    return {
        registry: registryWith(),
        brokerStatus: "running",
        connectedApps: [
            { appId: "PS", name: "Photoshop", version: "27.0.0", uxpVersion: "8.1.0", supportsScripts: true },
        ],
        sessions: [],
        attachedSessionIds: new Set(),
        pendingBreakSessionIds: new Set(),
        inspectorSessionIds: new Set(),
        busyRows: new Map(),
        activeEditor: { isManifest: false, isScript: false },
        workspaceFolders: [],
        readManifest: () => manifestFacts,
        fileExists: () => true,
        ...overrides,
    };
}

describe("scriptHostBadge", () => {
    it("maps extensions to host badges", () => {
        expect(scriptHostBadge("a\\b\\Align.psjs")).toBe("PS");
        expect(scriptHostBadge("x.IDJS")).toBe("ID");
        expect(scriptHostBadge("x.ccjs")).toBe("ANY");
        expect(scriptHostBadge("x.ts")).toBe("ANY");
        expect(scriptHostBadge("x.js")).toBe("ANY");
    });
});

describe("buildPanelState", () => {
    it("builds a flat plugin list from the registry", () => {
        const state = buildPanelState(inputsWith());
        expect(state.plugins[0].manifestPath).toBe(MANIFEST);
        expect(state.plugins[0].name).toBe("Sample plugin");
    });

    it("derives plugin loaded/debugging/pending/inspector from sessions", () => {
        const session = {
            clientSessionId: "s1",
            kind: "plugin" as const,
            manifestPath: MANIFEST,
            pluginPath: PLUGIN_DIR,
            name: "Sample plugin",
        };
        const base = { sessions: [session] };

        const loaded = buildPanelState(inputsWith(base)).plugins[0];
        expect(loaded.loaded).toBe(true);
        expect(loaded.debugging).toBe(false);

        const debugging = buildPanelState(
            inputsWith({ ...base, attachedSessionIds: new Set(["s1"]) }),
        ).plugins[0];
        expect(debugging.debugging).toBe(true);

        const pending = buildPanelState(
            inputsWith({ ...base, pendingBreakSessionIds: new Set(["s1"]) }),
        ).plugins[0];
        expect(pending.pendingBreakOnStart).toBe(true);

        const inspecting = buildPanelState(
            inputsWith({ ...base, inspectorSessionIds: new Set(["s1"]) }),
        ).plugins[0];
        expect(inspecting.inspectorOpen).toBe(true);
    });

    it.skipIf(process.platform === "linux")(
        "matches manifest paths case-insensitively on win32/darwin",
        () => {
            const session = {
                clientSessionId: "s1",
                kind: "plugin" as const,
                manifestPath: MANIFEST.toUpperCase(),
                pluginPath: PLUGIN_DIR,
                name: "Sample plugin",
            };
            const state = buildPanelState(inputsWith({ sessions: [session] }));
            expect(state.plugins[0].loaded).toBe(true);
        },
    );

    it("surfaces manifest errors without breaking the row", () => {
        const state = buildPanelState(
            inputsWith({
                readManifest: () => ({
                    name: "sample",
                    id: "",
                    hostApps: [],
                    error: "not valid JSON",
                }),
            }),
        );
        const plugin = state.plugins[0];
        expect(plugin.manifestError).toBe("not valid JSON");
        expect(plugin.name).toBe("sample");
    });

    it("marks a script debugging when its session has an attached debugger", () => {
        const session = {
            clientSessionId: "s2",
            kind: "script" as const,
            pluginPath: path.dirname(SCRIPT),
            name: path.basename(SCRIPT),
        };
        const state = buildPanelState(
            inputsWith({ sessions: [session], attachedSessionIds: new Set(["s2"]) }),
        );
        expect(state.scripts[0].debugging).toBe(true);
        expect(state.scripts[0].hostApp).toBe("PS");
    });

    it("marks a script debugging via scriptSourcePath when run from a temp file (stripped .ts)", () => {
        const session = {
            clientSessionId: "s2",
            kind: "script" as const,
            pluginPath: path.join("C:", "temp", "uxp-debugger-scripts-xyz", "run-1"),
            name: "align.js",
            scriptSourcePath: SCRIPT,
        };
        const state = buildPanelState(
            inputsWith({ sessions: [session], attachedSessionIds: new Set(["s2"]) }),
        );
        expect(state.scripts[0].debugging).toBe(true);
    });

    it("does not mark a script debugging from a live session alone (UXP has no unload-script RPC)", () => {
    // Regression test: a script session outlives debugger detach, so
    // "debugging" must track attachedSessionIds, not session presence.
        const session = {
            clientSessionId: "s2",
            kind: "script" as const,
            pluginPath: path.dirname(SCRIPT),
            name: path.basename(SCRIPT),
        };
        const state = buildPanelState(inputsWith({ sessions: [session] }));
        expect(state.scripts[0].debugging).toBe(false);
    });

    it("threads busy flags through by row key", () => {
        const state = buildPanelState(
            inputsWith({
                busyRows: new Map([
                    [`plugin:${MANIFEST}`, "loadPlugin"],
                    [`script:${SCRIPT}`, "debugScript"],
                ]),
            }),
        );
        expect(state.plugins[0].busy).toBe("loadPlugin");
        expect(state.scripts[0].busy).toBe("debugScript");
    });

    it("reports missing script files", () => {
        const state = buildPanelState(inputsWith({ fileExists: () => false }));
        expect(state.scripts[0].exists).toBe(false);
    });

    it("passes settings and broker status through", () => {
        const state = buildPanelState(
            inputsWith({
                brokerStatus: "ownedElsewhere",
                registry: registryWith({
                    breakOnLoad: { plugins: true, scripts: false },
                    scriptTargetApp: "PS",
                }),
            }),
        );
        expect(state.brokerStatus).toBe("ownedElsewhere");
        expect(state.breakOnLoad.plugins).toBe(true);
        expect(state.scriptTargetApp).toBe("PS");
        expect(state.connectedApps[0].appId).toBe("PS");
    });
});

describe("matchingWorkspaceFolderLength (plugin folder highlighting)", () => {
    it("matches when the plugin folder is inside an open workspace folder", () => {
        const wsFolder = path.join("C:", "plugins");
        const state = buildPanelState(inputsWith({ workspaceFolders: [wsFolder] }));
        expect(state.plugins[0].matchedFolderLength).toBe(wsFolder.replace(/\\/g, "/").length);
    });

    it("picks the longest (most specific) match across multiple workspace folders", () => {
        const state = buildPanelState(
            inputsWith({ workspaceFolders: [path.join("C:", "plugins"), PLUGIN_DIR] }),
        );
        expect(state.plugins[0].matchedFolderLength).toBe(PLUGIN_DIR.replace(/\\/g, "/").length);
    });

    it("is undefined when no open workspace folder contains the plugin", () => {
        const state = buildPanelState(
            inputsWith({ workspaceFolders: [path.join("C:", "elsewhere")] }),
        );
        expect(state.plugins[0].matchedFolderLength).toBeUndefined();
    });
});

describe("ScriptView.isActiveFile and PluginView.hasActiveFile", () => {
    it("highlights script row when script path matches, and ignores plugin", () => {
    // SCRIPT is a:\scripts\align.psjs. Let's say we have a plugin in a:\scripts
        const state = buildPanelState(
            inputsWith({
                registry: registryWith({
                    plugins: [{ manifestPath: path.join("C:", "scripts", "manifest.json"), watch: false }],
                }),
                activeEditor: { isManifest: false, isScript: true, path: SCRIPT },
            }),
        );
        expect(state.scripts[0].isActiveFile).toBe(true);
        expect(state.plugins[0].hasActiveFile).toBe(false);
    });

    it("highlights the deepest matching plugin when no script matches", () => {
        const parentPlugin = path.join("C:", "workspace", "manifest.json");
        const childPlugin = path.join("C:", "workspace", "packages", "pluginA", "manifest.json");

        const state = buildPanelState(
            inputsWith({
                registry: registryWith({
                    plugins: [
                        { manifestPath: parentPlugin, watch: false },
                        { manifestPath: childPlugin, watch: false },
                    ],
                }),
                activeEditor: {
                    isManifest: false,
                    isScript: false,
                    path: path.join("C:", "workspace", "packages", "pluginA", "src", "index.js"),
                },
            }),
        );

        const parent = state.plugins.find((p) => p.manifestPath === parentPlugin)!;
        const child = state.plugins.find((p) => p.manifestPath === childPlugin)!;

        expect(parent.hasActiveFile).toBe(false);
        expect(child.hasActiveFile).toBe(true);
    });

    it("highlights the closest plugin inside the same workspace even if active file is not inside the plugin folder", () => {
        const wsRoot = path.join("C:", "workspace");
        const pluginDist = path.join(wsRoot, "dist", "manifest.json");
        const pluginOther = path.join(wsRoot, "lib", "manifest.json");

        const state = buildPanelState(
            inputsWith({
                workspaceFolders: [wsRoot],
                registry: registryWith({
                    plugins: [
                        { manifestPath: pluginDist, watch: false },
                        { manifestPath: pluginOther, watch: false },
                    ],
                }),
                activeEditor: {
                    isManifest: false,
                    isScript: false,
                    path: path.join(wsRoot, "src", "index.js"), // Not under /dist or /lib!
                },
            }),
        );

        // Picked the first one if neither is structurally closer (both score up to "C:/workspace/"),
        // but the point is ONE of them gets highlighted because it's in the same workspace.
        const distMatches = state.plugins.find((p) => p.manifestPath === pluginDist)!.hasActiveFile;
        const otherMatches = state.plugins.find((p) => p.manifestPath === pluginOther)!.hasActiveFile;
        expect(distMatches || otherMatches).toBe(true);
    });

    it("is false when no editor is active or a different file is open", () => {
        const state = buildPanelState(inputsWith());
        expect(state.scripts[0].isActiveFile).toBe(false);
        expect(state.plugins[0].hasActiveFile).toBe(false);

        const other = buildPanelState(
            inputsWith({
                activeEditor: { isManifest: false, isScript: true, path: path.join("C:", "other.js") },
            }),
        );
        expect(other.scripts[0].isActiveFile).toBe(false);
        expect(other.plugins[0].hasActiveFile).toBe(false);
    });
});
