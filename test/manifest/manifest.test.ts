import { describe, expect, it } from "vitest";
import { ManifestValidationError } from "../../src/core/errors";
import {
    collectManifestIconPaths,
    isIconFileMatch,
    normalizeHosts,
    parseManifestContent,
} from "../../src/core/manifest/manifest";

const VALID = JSON.stringify({
    id: "com.example.demo",
    name: "Demo",
    main: "index.html",
    version: "1.0.0",
    host: { app: "PS", minVersion: "23.0.0" },
});

describe("parseManifestContent", () => {
    it("parses a valid manifest and normalises hosts", () => {
        const parsed = parseManifestContent(VALID, "manifest.json");
        expect(parsed.manifest.id).toBe("com.example.demo");
        expect(parsed.hosts).toEqual([{ app: "PS", minVersion: "23.0.0" }]);
    });

    it("rejects invalid JSON with a specific message", () => {
        expect(() => parseManifestContent("{ nope", "manifest.json")).toThrow(
            ManifestValidationError,
        );
        expect(() => parseManifestContent("{ nope", "manifest.json")).toThrow(/not valid JSON/);
    });

    it("collects every missing required field", () => {
        try {
            parseManifestContent(JSON.stringify({ name: "x" }), "manifest.json");
            expect.unreachable();
        }
        catch (err) {
            const error = err as ManifestValidationError;
            expect(error.issues.join("\n")).toMatch(/"id"/);
            expect(error.issues.join("\n")).toMatch(/"main"/);
            expect(error.issues.join("\n")).toMatch(/"version"/);
            expect(error.issues.join("\n")).toMatch(/host/);
        }
    });

    it("rejects non-object manifests", () => {
        expect(() => parseManifestContent("[1,2]", "m.json")).toThrow(/JSON object/);
    });
});

describe("normalizeHosts", () => {
    it("accepts a single object", () => {
        expect(normalizeHosts({ app: "PS" })).toEqual([{ app: "PS", minVersion: undefined }]);
    });

    it("accepts arrays of objects", () => {
        expect(
            normalizeHosts([
                { app: "PS", minVersion: "23.0.0" },
                { app: "ID" },
            ]),
        ).toEqual([
            { app: "PS", minVersion: "23.0.0" },
            { app: "ID", minVersion: undefined },
        ]);
    });

    it("supports the \"PS@22.0\" id@version string form", () => {
        expect(normalizeHosts("PS@22.0")).toEqual([{ app: "PS", minVersion: "22.0" }]);
        expect(normalizeHosts(["PS", "ID@18.5.0"])).toEqual([
            { app: "PS" },
            { app: "ID", minVersion: "18.5.0" },
        ]);
    });

    it("supports id@version inside the object \"app\" field", () => {
        expect(normalizeHosts({ app: "PS@22.0" })).toEqual([
            { app: "PS", minVersion: "22.0" },
        ]);
        // explicit minVersion wins over the @ form
        expect(normalizeHosts({ app: "PS@22.0", minVersion: "23.0.0" })).toEqual([
            { app: "PS", minVersion: "23.0.0" },
        ]);
    });

    it("throws on unusable entries", () => {
        expect(() => normalizeHosts({ notApp: true })).toThrow(/app/);
        expect(() => normalizeHosts(42)).toThrow(/unsupported/);
        expect(() => normalizeHosts("@1.0")).toThrow(/invalid app id/);
    });
});

describe("collectManifestIconPaths", () => {
    it("finds top-level icons[].path entries", () => {
        const manifest = { icons: [{ path: "icons/plugin-icon.png", scale: [1, 2] }] };
        expect(collectManifestIconPaths(manifest)).toEqual(["icons/plugin-icon.png"]);
    });

    it("finds icons nested anywhere in the manifest (panels, commands, ...)", () => {
        const manifest = {
            icons: [{ path: "icon.png" }],
            entrypoints: [{ type: "panel", icons: [{ path: "panel-icon.svg" }] }],
        };
        expect(collectManifestIconPaths(manifest).sort()).toEqual(
            ["icon.png", "panel-icon.svg"].sort(),
        );
    });

    it("ignores non-image strings", () => {
        const manifest = { id: "com.example.demo", main: "index.html", host: "PS" };
        expect(collectManifestIconPaths(manifest)).toEqual([]);
    });

    it("de-duplicates repeated paths", () => {
        const manifest = { icons: [{ path: "icon.png" }, { path: "icon.png" }] };
        expect(collectManifestIconPaths(manifest)).toEqual(["icon.png"]);
    });
});

describe("isIconFileMatch", () => {
    const pluginDir = "C:\\plugins\\sample";

    it("matches the exact declared file", () => {
        expect(isIconFileMatch("C:\\plugins\\sample\\icon.png", pluginDir, ["icon.png"])).toBe(true);
    });

    it("matches a scaled @2x/@3x disk variant (manifest never lists the suffix)", () => {
        expect(isIconFileMatch("C:\\plugins\\sample\\icon@2x.png", pluginDir, ["icon.png"])).toBe(true);
        expect(isIconFileMatch("C:\\plugins\\sample\\icon@3x.png", pluginDir, ["icon.png"])).toBe(true);
    });

    it("does not match a different directory", () => {
        expect(
            isIconFileMatch("C:\\plugins\\sample\\sub\\icon.png", pluginDir, ["icon.png"]),
        ).toBe(false);
    });

    it("does not match a different extension", () => {
        expect(isIconFileMatch("C:\\plugins\\sample\\icon.svg", pluginDir, ["icon.png"])).toBe(false);
    });

    it("does not match an unrelated file name", () => {
        expect(isIconFileMatch("C:\\plugins\\sample\\logo.png", pluginDir, ["icon.png"])).toBe(false);
    });

    it.skipIf(process.platform === "linux")("is case-insensitive on win32/darwin", () => {
        expect(isIconFileMatch("C:\\plugins\\sample\\ICON@2X.PNG", pluginDir, ["icon.png"])).toBe(true);
    });
});
