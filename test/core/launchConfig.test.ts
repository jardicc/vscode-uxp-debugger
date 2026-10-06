import { describe, expect, it } from "vitest";
import * as path from "path";
import {
    buildPluginLaunchConfig,
    buildScriptLaunchConfig,
    toLaunchPath,
    uniqueConfigName,
} from "../../src/core/launchConfig";

const folder = path.resolve("/work/proj");

describe("launchConfig", () => {
    it("uses ${workspaceFolder} for paths inside the folder", () => {
        expect(toLaunchPath(path.join(folder, "plugin", "manifest.json"), folder))
            .toBe("${workspaceFolder}/plugin/manifest.json");
    });

    it("keeps absolute paths outside the folder", () => {
        const outside = path.resolve("/other/manifest.json");
        expect(toLaunchPath(outside, folder)).toBe(outside);
    });

    it("builds a plugin attach config", () => {
        expect(buildPluginLaunchConfig("My Plugin", path.join(folder, "manifest.json"), folder)).toEqual({
            type: "uxp",
            request: "attach",
            name: "Attach to UXP Plugin: My Plugin",
            manifestPath: "${workspaceFolder}/manifest.json",
        });
    });

    it("builds a script launch config with app and args", () => {
        expect(buildScriptLaunchConfig(path.join(folder, "a.psjs"), folder, { app: "PS", userArgs: [1, "x"] })).toEqual({
            type: "uxp-script",
            request: "launch",
            name: "Debug UXP Script: a.psjs",
            script: "${workspaceFolder}/a.psjs",
            app: "PS",
            userArgs: [1, "x"],
        });
    });

    it("omits app when unset and defaults userArgs", () => {
        const config = buildScriptLaunchConfig(path.join(folder, "a.js"), folder, {});
        expect(config).not.toHaveProperty("app");
        expect(config.userArgs).toEqual([]);
    });

    it("makes names unique", () => {
        expect(uniqueConfigName("A", ["B"])).toBe("A");
        expect(uniqueConfigName("A", ["A", "A (2)"])).toBe("A (3)");
    });
});
