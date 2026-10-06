import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
    SCRIPT_EXTENSIONS,
    describeSupportedScripts,
    isAppAllowedForScript,
    isScriptPath,
    isTypeScriptExtension,
    scriptDialogExtensions,
    scriptExtensionOf,
    scriptHostAppIds,
    scriptHostBadge,
} from "../../src/core/scriptCatalog";
import { HOST_APPS } from "../../src/core/vulcan/hostAppCatalog";

const UNIVERSAL_SCRIPT_EXTENSIONS = SCRIPT_EXTENSIONS.filter((ext) => scriptHostAppIds(ext) === undefined);
const HOST_SCRIPT_EXTENSIONS = SCRIPT_EXTENSIONS.filter((ext) => scriptHostAppIds(ext) !== undefined);

describe("script catalog composition", () => {
    it("contains universal and host-specific extensions without duplicates", () => {
        expect([...UNIVERSAL_SCRIPT_EXTENSIONS].sort()).toEqual([".ccjs", ".js", ".ts"]);
        expect([...HOST_SCRIPT_EXTENSIONS].sort()).toEqual([".idjs", ".psjs"]);
        expect(new Set(SCRIPT_EXTENSIONS).size).toBe(SCRIPT_EXTENSIONS.length);
    });

    it("keeps every extension lowercase with a dot", () => {
        for (const ext of SCRIPT_EXTENSIONS) {
            expect(ext).toMatch(/^\.[a-z]+$/);
        }
    });
});

describe("scriptExtensionOf / isScriptPath", () => {
    it("is case-insensitive and rejects non-scripts", () => {
        expect(scriptExtensionOf("C:\\a\\B.PSJS")).toBe(".psjs");
        expect(isScriptPath("x.IdJs")).toBe(true);
        expect(isScriptPath("x.ccjs")).toBe(true);
        expect(isScriptPath("manifest.json")).toBe(false);
        expect(isScriptPath("noext")).toBe(false);
    });
});

describe("host restriction", () => {
    it("restricts .psjs to Photoshop only", () => {
        expect(scriptHostAppIds(".psjs")).toEqual(["PS"]);
        expect(isAppAllowedForScript(".psjs", "PS")).toBe(true);
        expect(isAppAllowedForScript(".psjs", "ID")).toBe(false);
        expect(isAppAllowedForScript(".psjs", "premierepro")).toBe(false);
    });

    it("restricts .idjs to InDesign and InDesign Server (incl. aliases)", () => {
        expect(scriptHostAppIds(".idjs")).toEqual(["ID", "IDS"]);
        for (const id of ["ID", "IDS", "indesign", "indesignserver"]) {
            expect(isAppAllowedForScript(".idjs", id)).toBe(true);
        }
        expect(isAppAllowedForScript(".idjs", "PS")).toBe(false);
    });

    it("lets universal extensions run anywhere", () => {
        for (const ext of UNIVERSAL_SCRIPT_EXTENSIONS) {
            expect(scriptHostAppIds(ext)).toBeUndefined();
            expect(isAppAllowedForScript(ext, "PS")).toBe(true);
            expect(isAppAllowedForScript(ext, "anything")).toBe(true);
        }
    });

    it("only references hosts that exist in the catalog", () => {
        for (const ext of HOST_SCRIPT_EXTENSIONS) {
            for (const id of scriptHostAppIds(ext) ?? []) {
                expect(HOST_APPS.some((app) => app.value === id)).toBe(true);
            }
        }
    });
});

describe("scriptHostBadge", () => {
    it("maps host extensions to the host UI code and others to ANY", () => {
        expect(scriptHostBadge("a\\b\\Align.psjs")).toBe("PS");
        expect(scriptHostBadge("x.IDJS")).toBe("ID");
        expect(scriptHostBadge("x.ccjs")).toBe("ANY");
        expect(scriptHostBadge("x.ts")).toBe("ANY");
        expect(scriptHostBadge("x.txt")).toBe("ANY");
    });
});

describe("helpers", () => {
    it("flags only .ts for type stripping", () => {
        expect(isTypeScriptExtension(".ts")).toBe(true);
        expect(isTypeScriptExtension(".js")).toBe(false);
    });

    it("builds dialog filters and descriptions from the catalog", () => {
        expect(scriptDialogExtensions()).toEqual(expect.arrayContaining(["js", "ts", "ccjs", "psjs", "idjs"]));
        expect(describeSupportedScripts()).toContain(".psjs (Photoshop)");
        expect(describeSupportedScripts()).toContain(".idjs (InDesign / InDesign Server)");
        expect(describeSupportedScripts()).toContain(".ts (stripped on the fly)");
    });
});

describe("package.json stays in sync with the catalog", () => {
    const pkg = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"),
    ) as { contributes: { menus: Record<string, { when?: string }[]> } };

    it("uses every catalog extension in script `when` clauses", () => {
        const text = JSON.stringify(pkg.contributes.menus);
        const regexes = text.match(/resourceExtname =~ \/\^\\\\\.\(([^)]+)\)\$\//g) ?? [];
        expect(regexes.length).toBeGreaterThan(0);
        for (const clause of regexes) {
            const listed = /\(([^)]+)\)/.exec(clause)![1].split("|").sort();
            expect(listed).toEqual(SCRIPT_EXTENSIONS.map((ext) => ext.slice(1)).sort());
        }
    });
});
