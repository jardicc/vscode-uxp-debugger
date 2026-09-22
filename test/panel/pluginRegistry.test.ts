import { describe, expect, it } from "vitest";
import {
    type MementoLike,
    PluginRegistry,
    REGISTRY_STATE_KEY,
    type RegistryData,
} from "../../src/vscode/panel/PluginRegistry";

class FakeMemento implements MementoLike {
    private store = new Map<string, unknown>();

    get<T>(key: string, defaultValue: T): T {
        return (this.store.has(key) ? (this.store.get(key) as T) : defaultValue);
    }

    update(key: string, value: unknown): Thenable<void> {
        this.store.set(key, JSON.parse(JSON.stringify(value)));
        return Promise.resolve();
    }

    raw(key: string): unknown {
        return this.store.get(key);
    }
}

describe("PluginRegistry", () => {
    it("starts empty with default settings", () => {
        const registry = new PluginRegistry(new FakeMemento());
        expect(registry.snapshot.plugins).toEqual([]);
        expect(registry.snapshot.scripts).toEqual([]);
        expect(registry.snapshot.breakOnLoad).toEqual({ plugins: false, scripts: false });
        expect(registry.snapshot.scriptTargetApp).toBeUndefined();
    });

    it("round-trips persisted data through the memento", async () => {
        const memento = new FakeMemento();
        const first = new PluginRegistry(memento);
        await first.addPlugin("C:\\plugins\\sample\\manifest.json");
        await first.addScript("C:\\scripts\\align.psjs");
        await first.setBreakOnLoad("plugins", true);
        await first.setScriptTargetApp("PS");

        const second = new PluginRegistry(memento);
        expect(second.snapshot.plugins).toHaveLength(1);
        expect(second.snapshot.plugins[0].manifestPath).toBe(
            "C:\\plugins\\sample\\manifest.json",
        );
        expect(second.snapshot.scripts[0].scriptPath).toBe("C:\\scripts\\align.psjs");
        expect(second.snapshot.breakOnLoad.plugins).toBe(true);
        expect(second.snapshot.scriptTargetApp).toBe("PS");
    });

    it("ignores stored data with an unknown/old schema version", () => {
        const memento = new FakeMemento();
        void memento.update(REGISTRY_STATE_KEY, { v: 1, projects: [{}] });
        const registry = new PluginRegistry(memento);
        expect(registry.snapshot.plugins).toEqual([]);
    });

    it("rejects registering the same manifest twice", async () => {
        const registry = new PluginRegistry(new FakeMemento());
        expect(await registry.addPlugin("C:\\one\\manifest.json")).toBeUndefined();
        expect(await registry.addPlugin("C:\\one\\manifest.json")).toMatch(
            /already registered/,
        );
    });

    it("removes plugins", async () => {
        const registry = new PluginRegistry(new FakeMemento());
        await registry.addPlugin("C:\\one\\manifest.json");
        await registry.removePlugin("C:\\one\\manifest.json");
        expect(registry.snapshot.plugins).toEqual([]);
    });

    it("restores a removed plugin at its original index (undo)", async () => {
        const registry = new PluginRegistry(new FakeMemento());
        await registry.addPlugin("C:\\one\\manifest.json");
        await registry.addPlugin("C:\\two\\manifest.json");
        const plugin = registry.pluginByManifest("C:\\one\\manifest.json")!;
        await registry.removePlugin("C:\\one\\manifest.json");
        await registry.restorePlugin(plugin, 0);
        expect(registry.snapshot.plugins.map((p) => p.manifestPath)).toEqual([
            "C:\\one\\manifest.json",
            "C:\\two\\manifest.json",
        ]);
    });

    it("stores script args and watch toggles", async () => {
        const registry = new PluginRegistry(new FakeMemento());
        await registry.addPlugin("C:\\one\\manifest.json");
        await registry.addScript("C:\\scripts\\a.psjs");

        await registry.setScriptArgs("C:\\scripts\\a.psjs", "2, \"text\", true");
        await registry.setWatch({ scriptPath: "C:\\scripts\\a.psjs" }, true);
        await registry.setWatch({ manifestPath: "C:\\one\\manifest.json" }, true);

        expect(registry.scriptByPath("C:\\scripts\\a.psjs")?.args).toBe("2, \"text\", true");
        expect(registry.scriptByPath("C:\\scripts\\a.psjs")?.watch).toBe(true);
        expect(registry.pluginByManifest("C:\\one\\manifest.json")?.watch).toBe(true);
    });

    it("addScript is idempotent and keeps existing args", async () => {
        const registry = new PluginRegistry(new FakeMemento());
        await registry.addScript("C:\\scripts\\a.psjs");
        await registry.setScriptArgs("C:\\scripts\\a.psjs", "1");
        const again = await registry.addScript("C:\\scripts\\a.psjs");
        expect(again.args).toBe("1");
        expect(registry.snapshot.scripts).toHaveLength(1);
    });

    it("emits onDidChange after every mutation", async () => {
        const registry = new PluginRegistry(new FakeMemento());
        let fired = 0;
        registry.onDidChange.on(() => fired++);
        await registry.addPlugin("C:\\one\\manifest.json");
        await registry.setBreakOnLoad("scripts", true);
        await registry.removePlugin("C:\\one\\manifest.json");
        expect(fired).toBe(3);
    });

    it("persists via the memento on every mutation", async () => {
        const memento = new FakeMemento();
        const registry = new PluginRegistry(memento);
        await registry.addPlugin("C:\\one\\manifest.json");
        const raw = memento.raw(REGISTRY_STATE_KEY) as RegistryData;
        expect(raw.v).toBe(2);
        expect(raw.plugins).toHaveLength(1);
    });
});
