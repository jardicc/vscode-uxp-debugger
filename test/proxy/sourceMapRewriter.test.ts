import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeLog } from "../fixtures/fakeVscode";
import {
    buildIdentitySourceMapUrl,
    deriveNaiveSubdir,
    normalizeScriptUrl,
    resolveExternalSourceMap,
    resolveScriptFileUrl,
    resolveVerifiedSubdir,
    rewriteInlineSourceMapRoot,
} from "../../src/vscode/proxy/sourceMapRewriter";

/** Builds an inline (data-URL) source map, mirroring what webpack/UXP emit. */
function buildInlineSourceMap(
    map: Record<string, unknown>,
    mimeHeader = "data:application/json;charset=utf-8;base64",
): string {
    const payload = Buffer.from(JSON.stringify(map), "utf-8").toString("base64");
    return `${mimeHeader},${payload}`;
}

/** Decodes an inline (data-URL) source map back into its JSON object. */
function decodeInlineSourceMap(dataUrl: string): Record<string, unknown> {
    const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
}

describe("normalizeScriptUrl", () => {
    it("strips the uxp:// scheme and plugin-id, keeping only the path", () => {
        expect(normalizeScriptUrl("uxp://com.adobe.plugin/index.js")).toBe("/index.js");
    });

    it("keeps nested paths after stripping the plugin-id prefix", () => {
        expect(normalizeScriptUrl("uxp://com.adobe.plugin/assets/index-abc123.js")).toBe(
            "/assets/index-abc123.js",
        );
    });

    it("falls back to the original url when nothing remains after the scheme", () => {
    // "uxp://com.adobe.plugin" (no trailing path) → the regex consumes the
    // whole string, leaving an empty string, which is falsy → the original
    // url is returned unchanged instead of an empty string.
        expect(normalizeScriptUrl("uxp://com.adobe.plugin")).toBe("uxp://com.adobe.plugin");
    });

    it("leaves file:// URLs untouched", () => {
        const url = "file:///C:/plugins/my-plugin/index.js";
        expect(normalizeScriptUrl(url)).toBe(url);
    });

    it("leaves http(s):// URLs untouched", () => {
        expect(normalizeScriptUrl("https://example.com/index.js")).toBe("https://example.com/index.js");
    });

    it("leaves already-relative urls untouched", () => {
        expect(normalizeScriptUrl("./index.js")).toBe("./index.js");
    });
});

describe("resolveScriptFileUrl", () => {
    it("resolves a root-relative url to an absolute file:// path under pluginDir", () => {
        expect(resolveScriptFileUrl("/index.js", "A:/plugins/my-plugin")).toBe(
            "file:///A:/plugins/my-plugin/index.js",
        );
    });

    it("resolves a nested root-relative url, preserving subdirectories", () => {
        expect(resolveScriptFileUrl("/assets/sub/index-abc123.js", "A:/plugins/my-plugin")).toBe(
            "file:///A:/plugins/my-plugin/assets/sub/index-abc123.js",
        );
    });

    it("resolves a script at the plugin root (empty relative path) without a trailing slash", () => {
        expect(resolveScriptFileUrl("/", "A:/plugins/my-plugin")).toBe("file:///A:/plugins/my-plugin");
    });

    it("normalizes backslashes in pluginDir", () => {
        expect(resolveScriptFileUrl("/index.js", "A:\\plugins\\my-plugin")).toBe(
            "file:///A:/plugins/my-plugin/index.js",
        );
    });

    it("resolves a raw Windows absolute path (drive letter, no scheme) to file://, not root-relative", () => {
    // Real bug (2026-08-10): a naive "already has a scheme" check mistook
    // the "a:" drive letter for a URI scheme and left the path completely
    // untouched — UXP reports scripts this way (instead of uxp://) at least
    // for the initial Plugin/runScript entry point.
        expect(
            resolveScriptFileUrl(
                "a:\\VS-projects\\uxp-debugger2\\e2e\\fixtures\\plugin\\index.js",
                "a:\\VS-projects\\uxp-debugger2\\e2e\\fixtures\\plugin",
            ),
        ).toBe("file:///a:/VS-projects/uxp-debugger2/e2e/fixtures/plugin/index.js");
    });

    it("leaves already-absolute urls (file:, http(s):) untouched", () => {
        expect(resolveScriptFileUrl("file:///C:/plugins/my-plugin/index.js", "A:/plugins/my-plugin")).toBe(
            "file:///C:/plugins/my-plugin/index.js",
        );
        expect(resolveScriptFileUrl("https://example.com/index.js", "A:/plugins/my-plugin")).toBe(
            "https://example.com/index.js",
        );
    });

    it("resolves an opaque custom-scheme url (e.g. uxp-script://) when the file exists under pluginDir", () => {
    // Real case (2026-08-10): vite-uxp-plugin's `debugger: "udt"` build mode
    // appends `//# sourceURL=uxp-script://<outputRelativePath>` — the whole
    // "host" position is part of the relative path, not something to strip.
        const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-scriptfileurl-test-"));
        try {
            fs.mkdirSync(path.join(pluginDir, "assets"));
            fs.writeFileSync(path.join(pluginDir, "assets", "index-abc123.js"), "// bundle");

            expect(resolveScriptFileUrl("uxp-script://assets/index-abc123.js", pluginDir)).toBe(
                `file:///${pluginDir.replace(/\\/g, "/")}/assets/index-abc123.js`,
            );
        }
        finally {
            fs.rmSync(pluginDir, { recursive: true, force: true });
        }
    });

    it("leaves an opaque custom-scheme url unchanged when it doesn't resolve to a real file", () => {
        expect(resolveScriptFileUrl("uxp-script://assets/missing.js", "A:/plugins/my-plugin")).toBe(
            "uxp-script://assets/missing.js",
        );
    });
});

describe("deriveNaiveSubdir", () => {
    it("returns the directory of a nested root-relative url", () => {
        expect(deriveNaiveSubdir("/assets/sub/index.js")).toBe("assets/sub");
    });

    it("returns an empty string for a script at the plugin root", () => {
        expect(deriveNaiveSubdir("/index.js")).toBe("");
        expect(deriveNaiveSubdir("./index.js")).toBe("");
    });
});

describe("resolveVerifiedSubdir", () => {
    it("falls back to the naive dirname guess when there are no samples to verify", () => {
        expect(resolveVerifiedSubdir("/bundle/index.js", "A:/plugins/my-plugin", [])).toBe("bundle");
    });

    it("falls back to the naive dirname guess when no candidate verifies against disk", () => {
        expect(resolveVerifiedSubdir("/bundle/index.js", "A:/plugins/my-plugin", ["../src/index.ts"])).toBe(
            "bundle",
        );
    });

    it("fixes the real vite-uxp-plugin uxp-script:// bug: resolves to the real source, not a garbage subdir", () => {
    // Reproduces the exact reported shape: pluginDir is the built "dist"
    // folder, the bundle sits under "assets/", and the original source lives
    // two levels up in the project's "src/" folder — `sources` entries are
    // relative to "dist/assets/", e.g. "../../src/main.tsx".
        const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-verifiedsubdir-test-"));
        try {
            const pluginDir = path.join(projectDir, "dist");
            fs.mkdirSync(path.join(pluginDir, "assets"), { recursive: true });
            fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
            fs.writeFileSync(path.join(projectDir, "src", "main.tsx"), "// real source");

            const subdir = resolveVerifiedSubdir("uxp-script://assets/index-abc123.js", pluginDir, [
                "../../src/main.tsx",
            ]);

            expect(subdir).toBe("assets");
            expect(path.resolve(pluginDir, subdir, "../../src/main.tsx")).toBe(
                path.join(projectDir, "src", "main.tsx"),
            );
        }
        finally {
            fs.rmSync(projectDir, { recursive: true, force: true });
        }
    });
});

describe("buildIdentitySourceMapUrl", () => {
    it("maps every generated line 1:1 onto the same absolute file", () => {
        const dataUrl = buildIdentitySourceMapUrl("A:/plugins/my-plugin/index.js", 3);
        const map = decodeInlineSourceMap(dataUrl);

        expect(map.sources).toEqual(["file:///A:/plugins/my-plugin/index.js"]);
        expect((map.mappings as string).split(";")).toEqual(["AAAA", "AACA", "AACA"]);
    });

    it("produces at least one mapped line even for a zero/negative line count", () => {
        const map = decodeInlineSourceMap(buildIdentitySourceMapUrl("A:/plugins/my-plugin/index.js", 0));
        expect((map.mappings as string).split(";")).toEqual(["AAAA"]);
    });
});

describe("rewriteInlineSourceMapRoot", () => {
    it("rewrites sourceRoot to a file:// URL under pluginDir + scriptSubdir", () => {
        const log = fakeLog();
        const dataUrl = buildInlineSourceMap({
            version: 3,
            sources: ["../src/shared/store.ts"],
            names: [],
            mappings: "AAAA",
            file: "index.js",
        });

        const result = rewriteInlineSourceMapRoot(dataUrl, "A:/plugins/my-plugin", "/bundle/index.js", log);
        const map = decodeInlineSourceMap(result);

        expect(map.sourceRoot).toBe("file:///A:/plugins/my-plugin/bundle/");
        // Everything else in the map must be preserved untouched.
        expect(map.sources).toEqual(["../src/shared/store.ts"]);
        expect(map.mappings).toBe("AAAA");
        expect(map.file).toBe("index.js");
    });

    it("omits the subdir segment when the script lives at the plugin root", () => {
        const log = fakeLog();
        const dataUrl = buildInlineSourceMap({ version: 3, sources: [], mappings: "" });

        const result = rewriteInlineSourceMapRoot(dataUrl, "A:/plugins/my-plugin", "/index.js", log);

        expect(decodeInlineSourceMap(result).sourceRoot).toBe("file:///A:/plugins/my-plugin/");
    });

    it("normalizes Windows backslashes in pluginDir to forward slashes", () => {
        const log = fakeLog();
        const dataUrl = buildInlineSourceMap({ version: 3, sources: [], mappings: "" });

        const result = rewriteInlineSourceMapRoot(dataUrl, "A:\\plugins\\my-plugin", "/assets/sub/index.js", log);

        expect(decodeInlineSourceMap(result).sourceRoot).toBe(
            "file:///A:/plugins/my-plugin/assets/sub/",
        );
    });

    it("overwrites a pre-existing sourceRoot rather than merging with it", () => {
        const log = fakeLog();
        const dataUrl = buildInlineSourceMap({
            version: 3,
            sourceRoot: "webpack:///./",
            sources: ["index.ts"],
            mappings: "",
        });

        const result = rewriteInlineSourceMapRoot(dataUrl, "A:/plugins/p", "/index.js", log);

        expect(decodeInlineSourceMap(result).sourceRoot).toBe("file:///A:/plugins/p/");
    });

    it("logs the old and new sourceRoot values", () => {
        const log = fakeLog();
        const dataUrl = buildInlineSourceMap({ version: 3, sourceRoot: "old-root", sources: [], mappings: "" });

        rewriteInlineSourceMapRoot(dataUrl, "A:/plugins/p", "/index.js", log);

        expect(log.lines.some((l) => l.includes("Rewrote sourceRoot"))).toBe(true);
        expect(log.lines.some((l) => l.includes("\"old-root\""))).toBe(true);
    });

    it("logs the final source file resolved from sourceRoot and the source entry", () => {
        const log = fakeLog();
        const dataUrl = buildInlineSourceMap({
            version: 3,
            sources: ["../src/main.ts"],
            mappings: "AAAA",
        });

        rewriteInlineSourceMapRoot(dataUrl, "A:/plugins/p", "/dist/index.js", log);

        expect(log.lines).toContain(
            "[CDP] Final source file: \"../src/main.ts\" → \"file:///A:/plugins/p/src/main.ts\"",
        );
    });

    it("accepts the charset-less data:application/json;base64 header form", () => {
        const log = fakeLog();
        const dataUrl = buildInlineSourceMap(
            { version: 3, sources: [], mappings: "" },
            "data:application/json;base64",
        );

        const result = rewriteInlineSourceMapRoot(dataUrl, "A:/plugins/p", "/sub/index.js", log);

        expect(result.startsWith("data:application/json;base64,")).toBe(true);
        expect(decodeInlineSourceMap(result).sourceRoot).toBe("file:///A:/plugins/p/sub/");
    });

    it("is case-insensitive when detecting the data:application/json prefix", () => {
        const log = fakeLog();
        const dataUrl = buildInlineSourceMap(
            { version: 3, sources: [], mappings: "" },
            "DATA:APPLICATION/JSON;base64",
        );

        const result = rewriteInlineSourceMapRoot(dataUrl, "A:/plugins/p", "/index.js", log);

        expect(decodeInlineSourceMap(result).sourceRoot).toBe("file:///A:/plugins/p/");
    });

    it("returns the input unchanged when it is not a data: URL at all", () => {
        const log = fakeLog();
        const url = "https://cdn.example.com/index.js.map";

        expect(rewriteInlineSourceMapRoot(url, "A:/plugins/p", "/index.js", log)).toBe(url);
        expect(log.lines.some((l) => l.includes("Not an inline source map"))).toBe(true);
    });

    it("returns the input unchanged for a non-JSON data: mime type", () => {
        const log = fakeLog();
        const dataUrl = "data:text/plain;base64," + Buffer.from("hello").toString("base64");

        expect(rewriteInlineSourceMapRoot(dataUrl, "A:/plugins/p", "/index.js", log)).toBe(dataUrl);
    });

    it("returns the input unchanged when the data: URL has no comma separator", () => {
        const log = fakeLog();
        const malformed = "data:application/json;base64";

        expect(rewriteInlineSourceMapRoot(malformed, "A:/plugins/p", "/index.js", log)).toBe(malformed);
    });

    it("falls back to the original dataUrl when the payload is not valid JSON", () => {
        const log = fakeLog();
        const payload = Buffer.from("{ this is not json", "utf-8").toString("base64");
        const dataUrl = `data:application/json;base64,${payload}`;

        const result = rewriteInlineSourceMapRoot(dataUrl, "A:/plugins/p", "/index.js", log);

        expect(result).toBe(dataUrl);
        expect(log.lines.some((l) => l.includes("Failed to rewrite inline source map"))).toBe(true);
    });

    it("falls back to the original dataUrl when the base64 payload cannot decode to text at all", () => {
    // An empty payload decodes to an empty string, which fails JSON.parse —
    // exercising the same catch path with a degenerate (not just malformed) input.
        const log = fakeLog();
        const dataUrl = "data:application/json;base64,";

        expect(rewriteInlineSourceMapRoot(dataUrl, "A:/plugins/p", "/index.js", log)).toBe(dataUrl);
    });

    it("supports a deeply nested scriptSubdir (multi-level /assets/ path)", () => {
        const log = fakeLog();
        const dataUrl = buildInlineSourceMap({ version: 3, sources: [], mappings: "" });

        const result = rewriteInlineSourceMapRoot(dataUrl, "A:/plugins/p", "/assets/sub/deep/index.js", log);

        expect(decodeInlineSourceMap(result).sourceRoot).toBe("file:///A:/plugins/p/assets/sub/deep/");
    });

    it("produces a quadruple-slash root when pluginDir is itself posix-absolute (documented quirk)", () => {
    // pluginDir starting with "/" is not de-duplicated against the fixed
    // "file:///" prefix — this repo only ever passes Windows-style drive
    // paths in practice, so this is captured as a known quirk, not "fixed".
        const log = fakeLog();
        const dataUrl = buildInlineSourceMap({ version: 3, sources: [], mappings: "" });

        const result = rewriteInlineSourceMapRoot(dataUrl, "/plugins/p", "/index.js", log);

        expect(decodeInlineSourceMap(result).sourceRoot).toBe("file:////plugins/p/");
    });
});

describe("resolveExternalSourceMap", () => {
    let pluginDir: string;

    beforeEach(() => {
        pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-sourcemap-test-"));
    });

    afterEach(() => {
        fs.rmSync(pluginDir, { recursive: true, force: true });
    });

    it("reads a .map file next to the script and rewrites its sourceRoot to an inline data: URL", () => {
        const log = fakeLog();
        fs.writeFileSync(
            path.join(pluginDir, "bundle.js.map"),
            JSON.stringify({ version: 3, sources: ["original.ts"], mappings: "AAAA" }),
        );

        const result = resolveExternalSourceMap("bundle.js.map", pluginDir, "/bundle.js", log);

        expect(result.startsWith("data:application/json;")).toBe(true);
        const map = decodeInlineSourceMap(result);
        expect(map.sourceRoot).toBe(`file:///${pluginDir.replace(/\\/g, "/")}/`);
        expect(map.sources).toEqual(["original.ts"]);
        expect(log.lines).toContain(
            `[CDP] Final source file: \"original.ts\" → \"file:///${pluginDir.replace(/\\/g, "/")}/original.ts\"`,
        );
    });

    it("resolves the .map path under the script's own subdirectory", () => {
        const log = fakeLog();
        fs.mkdirSync(path.join(pluginDir, "assets"));
        fs.writeFileSync(
            path.join(pluginDir, "assets", "bundle.js.map"),
            JSON.stringify({ version: 3, sources: [], mappings: "" }),
        );

        const result = resolveExternalSourceMap("bundle.js.map", pluginDir, "/assets/bundle.js", log);

        expect(decodeInlineSourceMap(result).sourceRoot).toBe(
            `file:///${pluginDir.replace(/\\/g, "/")}/assets/`,
        );
    });

    it("returns the input unchanged when the .map file does not exist on disk", () => {
        const log = fakeLog();

        const result = resolveExternalSourceMap("missing.js.map", pluginDir, "/missing.js", log);

        expect(result).toBe("missing.js.map");
        expect(log.lines.some((l) => l.includes("Failed to resolve external source map"))).toBe(true);
    });

    it("leaves absolute URLs (http/https/file schemes) untouched", () => {
        const log = fakeLog();
        const url = "https://cdn.example.com/bundle.js.map";

        expect(resolveExternalSourceMap(url, pluginDir, "/index.js", log)).toBe(url);
        expect(log.lines.some((l) => l.includes("Not a relative external source map"))).toBe(true);
    });

    it("falls back to the original value when the .map file is not valid JSON", () => {
        const log = fakeLog();
        fs.writeFileSync(path.join(pluginDir, "bundle.js.map"), "{ not json");

        const result = resolveExternalSourceMap("bundle.js.map", pluginDir, "/bundle.js", log);

        expect(result).toBe("bundle.js.map");
    });

    it("resolves an opaque custom-scheme url (uxp-script://) by verifying the .map file's real location", () => {
        const log = fakeLog();
        fs.mkdirSync(path.join(pluginDir, "assets"));
        fs.writeFileSync(
            path.join(pluginDir, "assets", "index-abc123.js.map"),
            JSON.stringify({ version: 3, sources: [], mappings: "" }),
        );

        const result = resolveExternalSourceMap(
            "index-abc123.js.map",
            pluginDir,
            "uxp-script://assets/index-abc123.js",
            log,
        );

        expect(decodeInlineSourceMap(result).sourceRoot).toBe(
            `file:///${pluginDir.replace(/\\/g, "/")}/assets/`,
        );
    });
});
