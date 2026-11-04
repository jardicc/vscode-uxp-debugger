import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeLog } from "../fixtures/fakeVscode";
import { type ScriptParsedParams, SourceMapRewriter } from "../../src/vscode/proxy/sourceMapRewriter";

function inlineMap(map: Record<string, unknown>, header = "data:application/json;charset=utf-8;base64"): string {
    return `${header},${Buffer.from(JSON.stringify(map), "utf-8").toString("base64")}`;
}

function decodeMap(dataUrl: string): { sources: string[]; sourceRoot?: string; mappings: string } {
    return JSON.parse(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64").toString("utf-8"));
}

const fileUrl = (p: string) => pathToFileURL(p).href;

let root: string;

/** Creates `files` (relative to the temp project root) with dummy content. */
function project(...files: string[]): void {
    for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), "// " + file);
    }
}

function rewrite(pluginDir: string, params: ScriptParsedParams) {
    const log = fakeLog();
    new SourceMapRewriter(pluginDir, log).rewriteScriptParsed(params);
    return { params, log };
}

/** Rewrites a script whose inline map lists `sources`, returning the rewritten map. */
function rewriteSources(pluginDir: string, url: string, sources: string[], extra: Record<string, unknown> = {}) {
    const { params } = rewrite(pluginDir, { url, sourceMapURL: inlineMap({ version: 3, sources, mappings: "AAAA", ...extra }) });
    return decodeMap(params.sourceMapURL!);
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-sourcemap-test-"));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("SourceMapRewriter — script url (no source map)", () => {
    it.each([
        ["uxp://com.adobe.plugin/index.js", "index.js"],
        ["uxp://com.adobe.plugin/assets/sub/index-abc.js", "assets/sub/index-abc.js"],
        ["uxp-script://assets/index-abc.js", "assets/index-abc.js"],
        ["/index.js", "index.js"],
        ["./index.js", "index.js"],
    ])("resolves %s to the real file under pluginDir", (url, file) => {
        project(`plugin/${file}`);
        const { params } = rewrite(path.join(root, "plugin"), { url, endLine: 2 });

        const expected = fileUrl(path.join(root, "plugin", file));
        expect(params.url).toBe(expected);
        const map = decodeMap(params.sourceMapURL!);
        expect(map.sources).toEqual([expected]);
        expect(map.mappings.split(";")).toEqual(["AAAA", "AACA", "AACA"]);
    });

    it("resolves a raw absolute OS path inside pluginDir without doubling it", () => {
        project("plugin/dist/index.js");
        const scriptFile = path.join(root, "plugin", "dist", "index.js");

        const { params } = rewrite(path.join(root, "plugin"), { url: scriptFile });

        expect(params.url).toBe(fileUrl(scriptFile));
    });

    it("keeps a file: url that points at an existing script", () => {
        project("index.js");
        const url = fileUrl(path.join(root, "index.js"));

        expect(rewrite(root, { url }).params.url).toBe(url);
    });

    it("still emits one mapped line when endLine is missing", () => {
        project("index.js");
        const { params } = rewrite(root, { url: "/index.js" });

        expect(decodeMap(params.sourceMapURL!).mappings).toBe("AAAA");
    });

    it.each([
        "uxp-script://assets/missing.js",
        "https://example.com/index.js",
        "/missing.js",
        "uxp://com.adobe.plugin",
        "file:///missing/index.js",
    ])(
        "leaves %s untouched when it doesn't exist on disk",
        (url) => {
            const { params } = rewrite(root, { url, sourceMapURL: "" });

            expect(params).toEqual({ url, sourceMapURL: "" });
        },
    );
});

describe("SourceMapRewriter — loading source maps", () => {
    it("re-emits an inline map with its sourceRoot pointing at the script's directory", () => {
        project("plugin/bundle/index.js", "plugin/src/index.ts");
        const map = rewriteSources(path.join(root, "plugin"), "/bundle/index.js", ["../src/index.ts"], {
            sourceRoot: "webpack:///",
            file: "index.js",
        });

        expect(map).toMatchObject({
            sources: [fileUrl(path.join(root, "plugin", "src", "index.ts"))],
            sourceRoot: fileUrl(path.join(root, "plugin", "bundle")) + "/",
            mappings: "AAAA",
            file: "index.js",
        });
    });

    it.each(["data:application/json;base64", "DATA:APPLICATION/JSON;BASE64", "data:application/json;charset=utf-8;base64"])(
        "accepts the %s header",
        (header) => {
            project("index.js", "index.ts");
            const sourceMapURL = inlineMap({ version: 3, sources: ["index.ts"], mappings: "" }, header);
            const { params } = rewrite(root, { url: "/index.js", sourceMapURL });

            expect(decodeMap(params.sourceMapURL!).sources).toEqual([fileUrl(path.join(root, "index.ts"))]);
        },
    );

    it("accepts a percent-encoded (non-base64) inline map", () => {
        project("index.js", "index.ts");
        const json = JSON.stringify({ version: 3, sources: ["index.ts"], mappings: "" });
        const { params } = rewrite(root, { url: "/index.js", sourceMapURL: "data:application/json," + encodeURIComponent(json) });

        expect(decodeMap(params.sourceMapURL!).sources).toEqual([fileUrl(path.join(root, "index.ts"))]);
    });

    it("reads an external .map file next to the script and inlines it", () => {
        project("plugin/assets/index-abc.js", "src/main.tsx");
        fs.writeFileSync(
            path.join(root, "plugin", "assets", "index-abc.js.map"),
            JSON.stringify({ version: 3, sources: ["../../src/main.tsx"], mappings: "AAAA" }),
        );

        const { params, log } = rewrite(path.join(root, "plugin"), {
            url: "uxp-script://assets/index-abc.js",
            sourceMapURL: "index-abc.js.map",
        });

        expect(params.sourceMapURL!.startsWith("data:application/json;")).toBe(true);
        expect(decodeMap(params.sourceMapURL!).sources).toEqual([fileUrl(path.join(root, "src", "main.tsx"))]);
        expect(log.lines.some((l) => l.includes("Resolved 1/1"))).toBe(true);
    });

    it.each([
        ["a missing external .map", "missing.js.map", "Source map not found"],
        ["a remote map url", "https://cdn.example.com/index.js.map", "Source map not found"],
        ["a non-JSON payload", "data:application/json;base64," + Buffer.from("{ nope").toString("base64"), "Failed"],
        ["a non-JSON mime type", "data:text/plain;base64," + Buffer.from("hello").toString("base64"), "Failed"],
        ["an empty payload", "data:application/json;base64,", "Failed"],
        ["a non-v3 map", inlineMap({ version: 2, sources: [] }), "Failed"],
        ["a data url without a payload separator", "data:application/json;base64", "Source map not found"],
        ["an external .map that is not valid JSON", "bad.js.map", "Failed"],
    ])("leaves %s untouched", (_, sourceMapURL, logged) => {
        project("index.js");
        fs.writeFileSync(path.join(root, "bad.js.map"), "{ not json");
        const { params, log } = rewrite(root, { url: "/index.js", sourceMapURL });

        expect(params.sourceMapURL).toBe(sourceMapURL);
        expect(log.lines.some((l) => l.includes(logged))).toBe(true);
    });

    it("logs at most 5 resolved sources plus a summary", () => {
        const files = Array.from({ length: 7 }, (_, i) => `src/f${String(i)}.ts`);
        project("index.js", ...files);
        const { log } = rewrite(root, { url: "/index.js", sourceMapURL: inlineMap({ version: 3, sources: files, mappings: "" }) });

        expect(log.lines).toContain(
            `[CDP] Source: "src/f0.ts" → ${JSON.stringify(fileUrl(path.join(root, "src", "f0.ts")))}`,
        );
        expect(log.lines.filter((l) => l.startsWith("[CDP] Source:"))).toHaveLength(5);
        expect(log.lines).toContain("[CDP] Resolved 7/7 source map sources on disk");
        expect(log.lines.some((l) => l.startsWith("[CDP] Unresolved source:"))).toBe(false);
    });

    it("logs a sample of at most 15 unresolved sources", () => {
        const missing = Array.from({ length: 17 }, (_, i) => `webpack:///./missing${String(i)}.ts`);
        project("index.js", "found.ts");
        const { log } = rewrite(root, {
            url: "/index.js",
            sourceMapURL: inlineMap({ version: 3, sources: ["found.ts", ...missing], mappings: "" }),
        });

        expect(log.lines).toContain("[CDP] Resolved 1/18 source map sources on disk");
        const sample = log.lines.filter((l) => l.startsWith("[CDP] Unresolved source:"));
        expect(sample).toHaveLength(15);
        expect(sample[0]).toBe("[CDP] Unresolved source: \"webpack:///./missing0.ts\"");
        expect(log.lines).toContain("[CDP] ...and 2 more unresolved");
    });
});

describe("SourceMapRewriter — resolving sources across project layouts", () => {
    it("resolves a webpack PSX layout (context src/ next to plugin/), keeping queries and virtual modules", () => {
        fs.mkdirSync(path.join(root, ".git"));
        project(
            "plugin/bundle/bundled.js",
            "src/Log.ts",
            "src/UI/Accordion.tsx",
            "src/UI/Accordion.less",
            "tests/assets/GradientMatrix.ts",
            "node_modules/@reduxjs/toolkit/dist/rtk.mjs",
        );

        const map = rewriteSources(path.join(root, "plugin"), "uxp://com.adobe.plugin/bundle/bundled.js", [
            "webpack:///../node_modules/@reduxjs/toolkit/dist/rtk.mjs",
            "webpack:///./UI/Accordion.less?b7cf",
            "webpack:///../tests/assets/GradientMatrix.ts",
            "webpack:///./Log.ts",
            "webpack:///./UI/Accordion.tsx",
            "webpack:///webpack/bootstrap",
            "webpack:///external commonjs2 \"photoshop\"",
        ]);

        expect(map.sources).toEqual([
            fileUrl(path.join(root, "node_modules", "@reduxjs", "toolkit", "dist", "rtk.mjs")),
            fileUrl(path.join(root, "src", "UI", "Accordion.less")) + "?b7cf",
            fileUrl(path.join(root, "tests", "assets", "GradientMatrix.ts")),
            fileUrl(path.join(root, "src", "Log.ts")),
            fileUrl(path.join(root, "src", "UI", "Accordion.tsx")),
            "webpack:///webpack/bootstrap",
            "webpack:///external commonjs2 \"photoshop\"",
        ]);
    });

    it("drops a webpack 5 package namespace before the ./ anchor", () => {
        fs.mkdirSync(path.join(root, ".git"));
        project("dist/bundle.js", "src/index.ts", "node_modules/immer/dist/immer.mjs");

        const map = rewriteSources(path.join(root, "dist"), "/bundle.js", [
            "webpack://@scope/my-plugin/./src/index.ts",
            "webpack://@scope/my-plugin/./node_modules/immer/dist/immer.mjs",
        ]);

        expect(map.sources).toEqual([
            fileUrl(path.join(root, "src", "index.ts")),
            fileUrl(path.join(root, "node_modules", "immer", "dist", "immer.mjs")),
        ]);
    });

    it("finds hoisted node_modules in a monorepo", () => {
        fs.mkdirSync(path.join(root, ".git"));
        project("packages/ps/plugin/bundled.js", "packages/ps/src/index.ts", "node_modules/reselect/dist/reselect.mjs");

        const map = rewriteSources(path.join(root, "packages", "ps", "plugin"), "/bundled.js", [
            "webpack:///./index.ts",
            "webpack:///../node_modules/reselect/dist/reselect.mjs",
        ]);

        expect(map.sources).toEqual([
            fileUrl(path.join(root, "packages", "ps", "src", "index.ts")),
            fileUrl(path.join(root, "node_modules", "reselect", "dist", "reselect.mjs")),
        ]);
    });

    it("rebases sources of a bundle moved to a shallower folder after the map was emitted", () => {
        project("dist/bundle.js", "src/main.tsx");

        const map = rewriteSources(path.join(root, "dist"), "/bundle.js", ["../../src/main.tsx"]);

        expect(map.sources).toEqual([fileUrl(path.join(root, "src", "main.tsx"))]);
    });

    it("strips a namespace segment without an anchor (turbopack [project]) and maps the legacy ~/ alias", () => {
        project("dist/bundle.js", "src/index.ts", "node_modules/redux/dist/redux.mjs");

        const map = rewriteSources(path.join(root, "dist"), "/bundle.js", [
            "turbopack:///[project]/src/index.ts",
            "webpack:///./~/redux/dist/redux.mjs",
        ]);

        expect(map.sources).toEqual([
            fileUrl(path.join(root, "src", "index.ts")),
            fileUrl(path.join(root, "node_modules", "redux", "dist", "redux.mjs")),
        ]);
    });

    it.each([
        "webpack-internal:///./src/index.ts",
        "future-bundler://custom-ns/./src/index.ts",
        "webpack://my-plugin/src/index.ts",
        "src/index.ts",
    ])("resolves %s without knowing its scheme", (source) => {
        project("dist/bundle.js", "src/index.ts");

        expect(rewriteSources(path.join(root, "dist"), "/bundle.js", [source]).sources).toEqual([
            fileUrl(path.join(root, "src", "index.ts")),
        ]);
    });

    it("leaves remote and opaque sources untouched", () => {
        project("index.js");
        const sources = ["https://example.com/app.js", "uxp://com.adobe.plugin/missing.js", "data:text/plain,x"];

        expect(rewriteSources(root, "/index.js", sources).sources).toEqual(sources);
    });

    it("honors the map's original sourceRoot before falling back to a plain lookup", () => {
        project("dist/bundle.js", "dist/a.ts", "src/a.ts");

        const map = rewriteSources(path.join(root, "dist"), "/bundle.js", ["a.ts"], { sourceRoot: "../src" });

        expect(map.sources).toEqual([fileUrl(path.join(root, "src", "a.ts"))]);
    });

    it("keeps absolute file: sources that exist (e.g. stripped TypeScript scripts)", () => {
        project("index.js", "original.ts");
        const source = fileUrl(path.join(root, "original.ts"));

        expect(rewriteSources(root, "/index.js", [source]).sources).toEqual([source]);
    });

    it("leaves unresolvable sources untouched, relative to the script's directory", () => {
        project("dist/bundle.js");

        const map = rewriteSources(path.join(root, "dist"), "/bundle.js", ["../src/missing.ts"]);

        expect(map.sources).toEqual(["../src/missing.ts"]);
        expect(map.sourceRoot).toBe(fileUrl(path.join(root, "dist")) + "/");
    });
});
