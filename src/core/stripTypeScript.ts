/**
 * "Debug Script" TypeScript support: strips type annotations from a single
 * `.ts` file (Node/Deno/Bun-style type erasure via `ts-blank-space`) and
 * writes the result to a throwaway `.js` file so it can be run through the
 * existing `Plugin/runScript` flow — no user-facing build step, no bundler.
 *
 * Deliberately scoped to single files with no imports (matches the
 * "debug active-editor script" use case): a real multi-module TypeScript
 * plugin still needs a real bundler (webpack/esbuild), which this is not.
 *
 * `ts-blank-space` preserves every character's line/column position exactly
 * (types are replaced with blank space, never repositioned), so the
 * generated `.js` needs only a simple line-for-line "identity" source map —
 * built by hand below, no source-map library required.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type * as ts from "typescript";
import tsBlankSpace from "ts-blank-space";
import { NonErasableTypeScriptError } from "./errors";

/**
 * Best-effort "line N: text" description of an unsupported-syntax node. Some synthesized nodes
 * (e.g. modifier tokens) can't render their own text/position, so this never throws.
 */
function describeErrorNode(node: ts.Node): string {
    try {
        const sourceFile = node.getSourceFile();
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        return `line ${String(line + 1)}: "${node.getText(sourceFile)}"`;
    }
    catch {
        return `offset ${String(node.pos)}`;
    }
}

/**
 * Strips TypeScript syntax from `tsSource`, throwing
 * {@link NonErasableTypeScriptError} if it contains constructs that can't be
 * safely erased in place (enum with values, parameter properties, namespace
 * with code, legacy decorators, ...).
 */
export function stripTypeScript(tsSource: string, tsPathForErrors: string): string {
    const issues: string[] = [];
    const js = tsBlankSpace(tsSource, (node) => {
        issues.push(`  ${describeErrorNode(node)}`);
    });
    if (issues.length > 0) {
        throw new NonErasableTypeScriptError(tsPathForErrors, issues);
    }
    return js;
}

/**
 * Builds a minimal source map that maps every generated line 1:1 onto the
 * same line (column 0) of `sourceAbsolutePath` — valid because
 * `ts-blank-space` never repositions surviving source characters. The
 * `sources` entry is an absolute `file://` URL, so it resolves correctly
 * regardless of any `sourceRoot`/`pluginDir` rewriting done further
 * downstream (see `sourceMapRewriter.ts`).
 */
export function buildIdentitySourceMap(lineCount: number, sourceAbsolutePath: string): string {
    const sourceUrl = "file:///" + path.resolve(sourceAbsolutePath).replace(/\\/g, "/");
    // VLQ segments: [genColumn=0, sourceIndexDelta=0, sourceLineDelta, sourceColumn=0].
    // First line's fields are absolute (0,0,0,0) = "AAAA"; every following line
    // only advances the source line by 1 relative to the previous one = "AACA".
    const lines = Array.from({ length: Math.max(lineCount, 1) }, (_, i) => (i === 0 ? "AAAA" : "AACA"));
    return JSON.stringify({
        version: 3,
        sources: [sourceUrl],
        names: [],
        mappings: lines.join(";"),
    });
}

/** A stripped script's generated `.js` path, plus a cleanup callback for its temp directory. */
export interface StrippedScript {
    jsPath: string;
    cleanup: () => void;
}

/** Shared parent temp directory for every stripped script this extension instance produces. */
let tempRoot: string | undefined;

function getTempRoot(): string {
    tempRoot ??= fs.mkdtempSync(path.join(os.tmpdir(), "uxp-debugger-scripts-"));
    return tempRoot;
}

/** Deletes every temp file/directory produced by {@link stripTypeScriptFile} so far. Call on extension deactivate. */
export function cleanupAllStrippedScripts(): void {
    if (tempRoot) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
        tempRoot = undefined;
    }
}

/**
 * Reads `tsPath`, strips its TypeScript types, and writes the result (with
 * an inline identity source map) to a fresh temp `.js` file — ready to pass
 * straight to `UxpService.runScript()`.
 */
export function stripTypeScriptFile(tsPath: string): StrippedScript {
    const tsSource = fs.readFileSync(tsPath, "utf-8");
    const js = stripTypeScript(tsSource, tsPath);
    const lineCount = tsSource.split("\n").length;
    const mapPayload = Buffer.from(buildIdentitySourceMap(lineCount, tsPath), "utf-8").toString("base64");
    const jsWithMap = `${js}\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${mapPayload}\n`;

    const runDir = fs.mkdtempSync(path.join(getTempRoot(), "run-"));
    const jsPath = path.join(runDir, path.basename(tsPath, path.extname(tsPath)) + ".js");
    fs.writeFileSync(jsPath, jsWithMap, "utf-8");

    return {
        jsPath,
        cleanup: () => {
            try {
                fs.rmSync(runDir, { recursive: true, force: true });
            }
            catch {
                // best-effort only
            }
        },
    };
}
