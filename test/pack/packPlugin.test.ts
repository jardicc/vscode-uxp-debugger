import AdmZip from "adm-zip";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
    LanguageModelTextPart: class LanguageModelTextPart {
        constructor(readonly value: string) {}
    },
    LanguageModelToolResult: class LanguageModelToolResult {
        constructor(readonly content: unknown[]) {}
    },
}));

import { ManifestValidationError } from "../../src/core/errors";
import {
    defaultPackFileName,
    packPluginFolder,
    rawHostEntries,
    resolveHostOverride,
    sanitizeFileNamePart,
    validateManifestForPack,
    validatePackOutputPath,
    withSingleHost,
} from "../../src/core/pack/packPlugin";
import type { UxpPluginManifest } from "../../src/core/protocol/types";
import type { ParsedManifest } from "../../src/core/manifest/manifest";
import { UxpPackPluginTool } from "../../src/vscode/tools/uxpPackPluginTool";

describe("sanitizeFileNamePart", () => {
    it("replaces illegal file name characters", () => {
        expect(sanitizeFileNamePart("a/b\\c:d*e?f\"g<h>i|j")).toBe("a_b_c_d_e_f_g_h_i_j");
    });

    it("falls back to a placeholder for an empty/whitespace-only value", () => {
        expect(sanitizeFileNamePart("   ")).toBe("plugin");
    });
});

describe("defaultPackFileName", () => {
    it("combines the sanitized name and version", () => {
        expect(defaultPackFileName({ name: "My Plugin", version: "1.2.0" })).toBe(
            "My Plugin-1.2.0.ccx",
        );
    });
});

describe("rawHostEntries / withSingleHost", () => {
    const base: UxpPluginManifest = {
        id: "com.example.demo",
        name: "Demo",
        main: "index.html",
        version: "1.0.0",
        host: [
            { app: "PS", minVersion: "23.0.0" },
            { app: "XD", minVersion: "34.0.0" },
        ],
    };

    it("wraps a single (non-array) host into a one-element array", () => {
        expect(rawHostEntries({ ...base, host: { app: "PS" } })).toEqual([{ app: "PS" }]);
    });

    it("returns array hosts as-is, extra fields included", () => {
        expect(rawHostEntries(base)).toEqual(base.host);
    });

    it("collapses to the chosen entry, keeping other manifest fields and the host key's position", () => {
        const collapsed = withSingleHost(base, 1);
        expect(collapsed.host).toEqual({ app: "XD", minVersion: "34.0.0" });
        expect(Object.keys(collapsed)).toEqual(Object.keys(base));
    });
});

describe("resolveHostOverride", () => {
    function parsedFor(manifest: UxpPluginManifest): ParsedManifest {
        return {
            manifest,
            hosts: rawHostEntries(manifest).map((h) => (typeof h === "string" ? { app: h } : h)),
        };
    }

    it("returns undefined for a manifest with a single, non-array host", () => {
        const parsed = parsedFor({
            id: "com.example.demo",
            name: "Demo",
            main: "index.html",
            version: "1.0.0",
            host: { app: "PS", minVersion: "23.0.0" },
        });
        expect(resolveHostOverride(parsed)).toBeUndefined();
    });

    it("collapses a single-item array host silently, without needing an explicit host input", () => {
        const parsed = parsedFor({
            id: "com.example.demo",
            name: "Demo",
            main: "index.html",
            version: "1.0.0",
            host: [{ app: "PS", minVersion: "23.0.0" }],
        });
        expect(JSON.parse(resolveHostOverride(parsed)!).host).toEqual({ app: "PS", minVersion: "23.0.0" });
    });

    it("throws when a multi-entry host array is ambiguous and no host input is given", () => {
        const parsed = parsedFor({
            id: "com.example.demo",
            name: "Demo",
            main: "index.html",
            version: "1.0.0",
            host: [
                { app: "PS", minVersion: "23.0.0" },
                { app: "XD", minVersion: "34.0.0" },
            ],
        });
        expect(() => resolveHostOverride(parsed)).toThrow(/multiple host apps/);
    });

    it("throws when the given host input does not match any host app entry", () => {
        const parsed = parsedFor({
            id: "com.example.demo",
            name: "Demo",
            main: "index.html",
            version: "1.0.0",
            host: [
                { app: "PS", minVersion: "23.0.0" },
                { app: "XD", minVersion: "34.0.0" },
            ],
        });
        expect(() => resolveHostOverride(parsed, "ID")).toThrow(/not one of this manifest's host apps/);
    });

    it("collapses to the matching host when a valid host input is given", () => {
        const parsed = parsedFor({
            id: "com.example.demo",
            name: "Demo",
            main: "index.html",
            version: "1.0.0",
            host: [
                { app: "PS", minVersion: "23.0.0" },
                { app: "XD", minVersion: "34.0.0" },
            ],
        });
        expect(JSON.parse(resolveHostOverride(parsed, "XD")!).host).toEqual({ app: "XD", minVersion: "34.0.0" });
    });
});

describe("validateManifestForPack / packPluginFolder", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-pack-test-"));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function writeManifest(content: unknown): string {
        const file = path.join(dir, "manifest.json");
        fs.writeFileSync(file, JSON.stringify(content), "utf-8");
        return file;
    }

    it("returns the parsed manifest for a valid manifest.json", () => {
        const manifestPath = writeManifest({
            id: "com.example.demo",
            name: "Demo",
            main: "index.html",
            version: "1.0.0",
            host: { app: "PS", minVersion: "23.0.0" },
        });
        const parsed = validateManifestForPack(manifestPath);
        expect(parsed.manifest.name).toBe("Demo");
        expect(parsed.hosts).toEqual([{ app: "PS", minVersion: "23.0.0" }]);
    });

    it("throws ManifestValidationError for an invalid manifest.json", () => {
        const manifestPath = writeManifest({ name: "Demo" });
        expect(() => validateManifestForPack(manifestPath)).toThrow(ManifestValidationError);
    });

    it("zips the plugin folder while excluding .git, .DS_Store, .env*, and outputPath", () => {
        writeManifest({
            id: "com.example.demo",
            name: "Demo",
            main: "index.html",
            version: "1.0.0",
            host: { app: "PS", minVersion: "23.0.0" },
        });
        fs.writeFileSync(path.join(dir, "index.html"), "<html></html>", "utf-8");
        fs.mkdirSync(path.join(dir, "node_modules"));
        fs.writeFileSync(path.join(dir, "node_modules", "dep.js"), "// dep", "utf-8");

        // Excluded entries
        fs.mkdirSync(path.join(dir, ".git", "objects"), { recursive: true });
        fs.writeFileSync(path.join(dir, ".git", "config"), "[core]", "utf-8");
        fs.writeFileSync(path.join(dir, ".DS_Store"), "mac metadata", "utf-8");
        fs.writeFileSync(path.join(dir, ".env"), "SECRET=1", "utf-8");
        fs.writeFileSync(path.join(dir, ".env.local"), "SECRET=2", "utf-8");
        fs.writeFileSync(path.join(dir, ".env.example"), "SECRET=", "utf-8");

        // Pre-existing output archive inside pluginDir itself
        const outputInPluginDir = path.join(dir, "bundle.ccx");
        fs.writeFileSync(outputInPluginDir, "old archive", "utf-8");

        packPluginFolder(dir, outputInPluginDir);

        const zip = new AdmZip(outputInPluginDir);
        const entryNames = zip.getEntries().map((e) => e.entryName.replace(/\\/g, "/"));
        expect(entryNames).toContain("manifest.json");
        expect(entryNames).toContain("index.html");
        expect(entryNames).toContain("node_modules/dep.js");
        expect(entryNames).not.toContain(".DS_Store");
        expect(entryNames).not.toContain(".env");
        expect(entryNames).not.toContain(".env.local");
        expect(entryNames).not.toContain(".env.example");
        expect(entryNames).not.toContain("bundle.ccx");
        expect(entryNames.some((n) => n === ".git" || n.startsWith(".git/"))).toBe(false);
    });

    it("rejects outputPath values that do not end with .ccx", () => {
        expect(() => validatePackOutputPath("C:\\out\\plugin.zip")).toThrow(/must end with \.ccx/);
        expect(() => packPluginFolder(dir, path.join(dir, "plugin.txt"))).toThrow(/must end with \.ccx/);
    });

    it("rewrites manifest.json in the archive when a manifestJsonOverride is given", () => {
        writeManifest({
            id: "com.example.demo",
            name: "Demo",
            main: "index.html",
            version: "1.0.0",
            host: [
                { app: "PS", minVersion: "23.0.0" },
                { app: "XD", minVersion: "34.0.0" },
            ],
        });
        fs.writeFileSync(path.join(dir, "index.html"), "<html></html>", "utf-8");

        const parsed = validateManifestForPack(path.join(dir, "manifest.json"));
        const override = JSON.stringify(withSingleHost(parsed.manifest, 0), null, 2);
        const outputPath = path.join(dir, "..", "packed-override.ccx");
        packPluginFolder(dir, outputPath, override);

        const zip = new AdmZip(outputPath);
        const packedManifest = JSON.parse(zip.readAsText("manifest.json"));
        expect(packedManifest.host).toEqual({ app: "PS", minVersion: "23.0.0" });
        // untouched file on disk still has the original array (override is archive-only).
        expect(JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf-8")).host).toHaveLength(2);

        fs.rmSync(outputPath, { force: true });
    });
});

describe("UxpPackPluginTool", () => {
    const tool = new UxpPackPluginTool();

    it("includes both manifestPath and outputPath in prepareInvocation", () => {
        const prepared = tool.prepareInvocation({
            input: {
                manifestPath: "C:\\plugin\\manifest.json",
                outputPath: "C:\\out\\plugin.ccx",
            },
        });

        expect(prepared.invocationMessage).toContain("C:\\plugin\\manifest.json");
        expect(prepared.invocationMessage).toContain("C:\\out\\plugin.ccx");
        expect(String(prepared.confirmationMessages?.message)).toContain("C:\\plugin\\manifest.json");
        expect(String(prepared.confirmationMessages?.message)).toContain("C:\\out\\plugin.ccx");
    });

    it("rejects outputPath without a .ccx extension before reading manifest.json", async () => {
        const result = await tool.invoke({
            input: {
                manifestPath: "C:\\nonexistent\\manifest.json",
                outputPath: "C:\\out\\overwrite.js",
            },
        } as Parameters<typeof tool.invoke>[0]);

        const text = (result as unknown as { content: { value: string }[] }).content[0].value;
        expect(text).toContain("must end with .ccx");
    });
});
