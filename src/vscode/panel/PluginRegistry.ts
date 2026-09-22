/**
 * Global (user-level) plugins/scripts registry for the control panel
 * (CONTROL-PANEL.md §6). Backed by `context.globalState` so the same
 * list appears in every VS Code window, UDT-style.
 *
 * Depends only on a minimal `Memento`-like interface (not `vscode`) so the
 * whole store is unit-testable under vitest.
 */

import { TypedEvent } from "../../core/events";
import { foldPathCase } from "../../core/pathCase";

export { foldPathCase as pathKey };

export const REGISTRY_STATE_KEY = "uxp.projectRegistry";

export interface StoredPlugin {
    /** Absolute path of the plugin's manifest.json. */
    manifestPath: string;
    /** Persisted Watch toggle. */
    watch: boolean;
}

export interface StoredScript {
    /** Absolute script file path. */
    scriptPath: string;
    /** Raw `2, "text", true` text as typed in the Args InputBox. */
    args: string;
    watch: boolean;
}

export interface RegistryData {
    /** Schema version for future migrations. Bumped to 2 for the flat plugin list (no project container). */
    v: 2;
    plugins: StoredPlugin[];
    scripts: StoredScript[];
    breakOnLoad: { plugins: boolean; scripts: boolean };
    /** Host app id restriction for script runs, or undefined = any. */
    scriptTargetApp?: string;
    /** Hides the secondary detail line(s) on Apps/Plugins/Scripts rows. */
    compactView: boolean;
}

/** The subset of `vscode.Memento` the registry needs. */
export interface MementoLike {
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: unknown): Thenable<void>;
}

function emptyData(): RegistryData {
    return {
        v: 2,
        plugins: [],
        scripts: [],
        breakOnLoad: { plugins: false, scripts: false },
        scriptTargetApp: undefined,
        compactView: false,
    };
}

export class PluginRegistry {
    private data: RegistryData;

    /** Fired after every mutation (already persisted when it fires). */
    readonly onDidChange = new TypedEvent<void>();

    constructor(private readonly state: MementoLike) {
        const stored = this.state.get<RegistryData | undefined>(REGISTRY_STATE_KEY, undefined);
        // Old (v1, project-container) data is intentionally discarded, not migrated
        // (CONTROL-PANEL.md §6) — it fails this check and resets to empty.
        this.data = stored?.v === 2 ? stored : emptyData();
    }

    // -------------------------------------------------------------------------
    // Snapshots
    // -------------------------------------------------------------------------

    /** Deep-ish snapshot — callers must not mutate the returned structures. */
    get snapshot(): RegistryData {
        return this.data;
    }

    pluginByManifest(manifestPath: string): StoredPlugin | undefined {
        const key = foldPathCase(manifestPath);
        return this.data.plugins.find((pl) => foldPathCase(pl.manifestPath) === key);
    }

    scriptByPath(scriptPath: string): StoredScript | undefined {
        const key = foldPathCase(scriptPath);
        return this.data.scripts.find((s) => foldPathCase(s.scriptPath) === key);
    }

    // -------------------------------------------------------------------------
    // Plugins
    // -------------------------------------------------------------------------

    /**
   * Register a plugin manifest. Returns an error string when the manifest is
   * already registered, `undefined` on success.
   */
    async addPlugin(manifestPath: string): Promise<string | undefined> {
        if (this.pluginByManifest(manifestPath)) {
            return "This manifest is already registered.";
        }
        this.data.plugins.push({ manifestPath, watch: false });
        await this.persist();
        return undefined;
    }

    async removePlugin(manifestPath: string): Promise<void> {
        const key = foldPathCase(manifestPath);
        this.data.plugins = this.data.plugins.filter(
            (pl) => foldPathCase(pl.manifestPath) !== key,
        );
        await this.persist();
    }

    /** Undo support: re-insert a previously removed plugin at (or near) its original index. */
    async restorePlugin(plugin: StoredPlugin, index: number): Promise<void> {
        if (this.pluginByManifest(plugin.manifestPath)) {
            return;
        }
        const clampedIndex = Math.min(Math.max(index, 0), this.data.plugins.length);
        this.data.plugins.splice(clampedIndex, 0, plugin);
        await this.persist();
    }

    // -------------------------------------------------------------------------
    // Scripts
    // -------------------------------------------------------------------------

    /** Register a script file. No-op when already present. */
    async addScript(scriptPath: string): Promise<StoredScript> {
        const existing = this.scriptByPath(scriptPath);
        if (existing) {
            return existing;
        }
        const script: StoredScript = { scriptPath, args: "", watch: false };
        this.data.scripts.push(script);
        await this.persist();
        return script;
    }

    async removeScript(scriptPath: string): Promise<void> {
        const key = foldPathCase(scriptPath);
        this.data.scripts = this.data.scripts.filter((s) => foldPathCase(s.scriptPath) !== key);
        await this.persist();
    }

    /** Undo support: re-insert a previously removed script at (or near) its original index. */
    async restoreScript(script: StoredScript, index: number): Promise<void> {
        if (this.scriptByPath(script.scriptPath)) {
            return;
        }
        const clampedIndex = Math.min(Math.max(index, 0), this.data.scripts.length);
        this.data.scripts.splice(clampedIndex, 0, script);
        await this.persist();
    }

    async setScriptArgs(scriptPath: string, args: string): Promise<void> {
        const script = this.scriptByPath(scriptPath);
        if (script) {
            script.args = args;
            await this.persist();
        }
    }

    // -------------------------------------------------------------------------
    // Settings
    // -------------------------------------------------------------------------

    async setBreakOnLoad(scope: "plugins" | "scripts", value: boolean): Promise<void> {
        this.data.breakOnLoad[scope] = value;
        await this.persist();
    }

    async setScriptTargetApp(appId: string | undefined): Promise<void> {
        this.data.scriptTargetApp = appId;
        await this.persist();
    }

    async setCompactView(value: boolean): Promise<void> {
        this.data.compactView = value;
        await this.persist();
    }

    /** Persist the watch toggle for a plugin (by manifest) or script (by path). */
    async setWatch(
        target: { manifestPath: string } | { scriptPath: string },
        value: boolean,
    ): Promise<void> {
        const entry
            = "manifestPath" in target
                ? this.pluginByManifest(target.manifestPath)
                : this.scriptByPath(target.scriptPath);
        if (entry) {
            entry.watch = value;
            await this.persist();
        }
    }

    private async persist(): Promise<void> {
        await this.state.update(REGISTRY_STATE_KEY, this.data);
        this.onDidChange.emit();
    }
}
