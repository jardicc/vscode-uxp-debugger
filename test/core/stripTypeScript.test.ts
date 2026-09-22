import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { NonErasableTypeScriptError } from "../../src/core/errors";
import {
    buildIdentitySourceMap,
    cleanupAllStrippedScripts,
    stripTypeScript,
    stripTypeScriptFile,
} from "../../src/core/stripTypeScript";

describe("stripTypeScript", () => {
    it("blanks out simple type annotations, preserving runtime behavior", () => {
    // No console.log inside the evaluated code: Wallaby's console interception
    // crashes on stack frames from `new Function`-created code.
        const js = stripTypeScript(
            "const x: string = \"hi\";\nconst shout = (s: string): string => s.toUpperCase();",
            "test.ts",
        );

        expect(new Function(`${js}\nreturn shout(x);`)()).toBe("HI");
        expect(js).not.toContain(": string");
    });

    it("preserves line count/positions (no repositioning)", () => {
        const ts = "const a: number = 1;\nconst b: number = 2;\nconsole.log(a + b);";
        const js = stripTypeScript(ts, "test.ts");

        expect(js.split("\n").length).toBe(ts.split("\n").length);
    });

    it("throws NonErasableTypeScriptError for parameter properties", () => {
        const ts = "class C {\n  constructor(private x: number) {}\n}\n";

        expect(() => stripTypeScript(ts, "a/b/c.ts")).toThrowError(
            NonErasableTypeScriptError,
        );
    });

    it("throws NonErasableTypeScriptError for an enum with values", () => {
        const ts = "enum Color { Red = 1, Green = 2 }\n";

        try {
            stripTypeScript(ts, "colors.ts");
            expect.fail("expected stripTypeScript to throw");
        }
        catch (err) {
            expect(err).toBeInstanceOf(NonErasableTypeScriptError);
            expect((err as NonErasableTypeScriptError).tsPath).toBe("colors.ts");
            expect((err as NonErasableTypeScriptError).issues.length).toBeGreaterThan(0);
            expect((err as NonErasableTypeScriptError).message).toContain("colors.ts");
        }
    });

    it("accepts plain JavaScript unchanged (no type syntax to strip)", () => {
        const js = "console.log(\"hello\");";

        expect(stripTypeScript(js, "test.ts").replace(/\r?\n$/, "")).toBe(js);
    });
});

describe("buildIdentitySourceMap", () => {
    it("produces a version-3 map with one absolute file:// source", () => {
        const map = JSON.parse(buildIdentitySourceMap(3, "A:/plugins/p/original.ts"));

        expect(map.version).toBe(3);
        expect(map.sources).toEqual(["file:///A:/plugins/p/original.ts"]);
        expect(map.names).toEqual([]);
    });

    it("emits one mapping segment per line, first absolute and the rest +1 deltas", () => {
        const map = JSON.parse(buildIdentitySourceMap(4, "A:/p/original.ts"));

        expect(map.mappings).toBe("AAAA;AACA;AACA;AACA");
    });

    it("normalizes Windows backslashes to a forward-slash file:// URL", () => {
        const map = JSON.parse(buildIdentitySourceMap(1, "A:\\plugins\\p\\original.ts"));

        expect(map.sources).toEqual(["file:///A:/plugins/p/original.ts"]);
    });

    it("emits at least one mapping segment even for an empty file", () => {
        const map = JSON.parse(buildIdentitySourceMap(0, "A:/p/original.ts"));

        expect(map.mappings).toBe("AAAA");
    });
});

describe("stripTypeScriptFile", () => {
    let tsPath: string | undefined;

    afterEach(() => {
        cleanupAllStrippedScripts();
        if (tsPath) {
            fs.rmSync(path.dirname(tsPath), { recursive: true, force: true });
            tsPath = undefined;
        }
    });

    function writeTsFixture(content: string): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-strip-test-"));
        const file = path.join(dir, "original.ts");
        fs.writeFileSync(file, content, "utf-8");
        tsPath = file;
        return file;
    }

    it("writes a stripped .js with an inline identity source map next to a fresh temp dir", () => {
        const file = writeTsFixture("const marker: string = \"hi\";\nconsole.log(marker);\n");

        const { jsPath, cleanup } = stripTypeScriptFile(file);
        try {
            expect(jsPath.endsWith("original.js")).toBe(true);
            expect(fs.existsSync(jsPath)).toBe(true);

            const written = fs.readFileSync(jsPath, "utf-8");
            expect(written).not.toContain(": string");
            expect(written).toContain("//# sourceMappingURL=data:application/json;charset=utf-8;base64,");

            const dataUrl = written.slice(written.indexOf("sourceMappingURL=") + "sourceMappingURL=".length).trim();
            const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
            const map = JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
            expect(map.sources[0]).toBe(`file:///${file.replace(/\\/g, "/")}`);
        }
        finally {
            cleanup();
        }
    });

    it("cleanup() removes only that run's temp directory", () => {
        const file = writeTsFixture("console.log(1);\n");

        const { jsPath, cleanup } = stripTypeScriptFile(file);
        expect(fs.existsSync(jsPath)).toBe(true);
        cleanup();
        expect(fs.existsSync(jsPath)).toBe(false);
    });

    it("propagates NonErasableTypeScriptError without writing any file", () => {
        const file = writeTsFixture("enum Color { Red = 1 }\n");

        expect(() => stripTypeScriptFile(file)).toThrow(NonErasableTypeScriptError);
    });
});
