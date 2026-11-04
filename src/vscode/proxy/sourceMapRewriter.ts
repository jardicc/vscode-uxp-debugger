import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type * as vscode from "vscode";
import { foldPathCase } from "../../core/pathCase";

/** The subset of `Debugger.scriptParsed` params rewritten here. */
export interface ScriptParsedParams {
    url?: string;
    sourceMapURL?: string;
    endLine?: number;
}

interface SourceMapV3 {
    [key: string]: unknown;
    version: 3;
    sources: string[];
    sourceRoot?: string;
}

const MAX_ANCESTORS = 5;
const MAX_LOGGED_UNRESOLVED = 15;
const STOP_DIRS = new Set([os.homedir(), os.tmpdir()].map((d) => foldPathCase(path.resolve(d))));
const LEADING_DOTS_AND_SLASHES = /^(?:\.{0,2}[\\/])+/;

// ---------------------------------------------------------------------------
// Path helpers (pure, apart from read-only fs probes)
// ---------------------------------------------------------------------------

function isFile(p: string): boolean {
    try {
        return fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
    }
    catch {
        // e.g. characters invalid in a path on this OS (virtual bundler modules).
        return false;
    }
}

function dirUrl(dir: string): string {
    return pathToFileURL(path.join(dir, path.sep)).href;
}

/** Splits `ref` into its path part and a `?query` / `#hash` suffix that has to survive the rewrite. */
function splitSuffix(ref: string): [string, string] {
    const i = ref.search(/[?#]/);
    return i === -1 ? [ref, ""] : [ref.slice(0, i), ref.slice(i)];
}

/**
 * Turns a script url or a source map `sources` entry into the file paths it
 * may denote, without knowing anything about specific URL schemes:
 * - an OS path (relative or absolute) → itself,
 * - a `file:` URL → its path,
 * - any other `scheme://rest` URL → `rest` from its first `./` or `../`
 *   anchor (dropping a bundler namespace such as `webpack://@scope/pkg/./`),
 *   otherwise `rest` both with and without its first segment, since that
 *   segment may be an id (`uxp://<plugin-id>/index.js`) or already part of
 *   the path (`uxp-script://assets/index.js`),
 * - opaque URLs (`data:`, ...) → nothing.
 *
 * The disk decides which candidate is right (see {@link findFile}).
 */
function pathCandidates(ref: string): string[] {
    if (path.isAbsolute(ref) || !URL.canParse(ref)) {
        return [ref];
    }
    const url = new URL(ref);
    try {
        return [fileURLToPath(url)];
    }
    catch {
        // Not a file: URL.
    }
    if (!ref.slice(url.protocol.length).startsWith("//")) {
        return [];
    }
    const rest = ref.slice(url.protocol.length + 2).replace(/^\/+/, "");
    const anchored = /(?:^|\/)(\.\.?\/.*)$/.exec(rest)?.[1];
    const candidates = anchored ? [anchored] : [rest, rest.slice(rest.indexOf("/") + 1)];
    // Webpack 1-4 `~/pkg` alias for node_modules.
    return [...new Set(candidates.map((c) => c.replace(/^(?:\.\/)?~\//, "./node_modules/")))].filter(Boolean);
}

/**
 * Finds the existing file `ref` points to. Each candidate path is tried
 * as-is relative to `dirs[0]`, then with its leading `./`, `../` and `/`
 * stripped against every directory in `dirs`, nearest first.
 */
function findFile(ref: string, dirs: readonly string[]): string | undefined {
    for (const candidate of pathCandidates(ref)) {
        const tail = candidate.replace(LEADING_DOTS_AND_SLASHES, "");
        const hit = [path.resolve(dirs[0], candidate), ...dirs.map((d) => path.join(d, tail))].find(isFile);
        if (hit) {
            return hit;
        }
    }
    return undefined;
}

function isStopDir(dir: string): boolean {
    return path.dirname(dir) === dir || STOP_DIRS.has(foldPathCase(dir));
}

/**
 * `dir` and its ancestors, nearest first, up to the repository root (`.git`)
 * or a stop boundary (filesystem root, home, temp).
 */
function ancestors(dir: string): string[] {
    const dirs = [path.resolve(dir)];
    while (dirs.length <= MAX_ANCESTORS && !fs.existsSync(path.join(dirs[dirs.length - 1], ".git"))) {
        const parent = path.dirname(dirs[dirs.length - 1]);
        if (isStopDir(parent)) {
            break;
        }
        dirs.push(parent);
    }
    return dirs;
}

function subdirs(dir: string): string[] {
    try {
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
            .map((e) => path.join(dir, e.name));
    }
    catch {
        return [];
    }
}

/**
 * Directories a source map's `sources` may be relative to, most likely
 * first: the script's own directory, then every ancestor followed by its
 * immediate subdirectories — which covers bundler contexts outside the
 * plugin folder (`<project>/src/` next to `<project>/plugin/`), hoisted
 * monorepo `node_modules`, and bundles moved after the map was emitted.
 */
function searchDirs(scriptDir: string): string[] {
    return [...new Set(ancestors(scriptDir).flatMap((d) => [d, ...subdirs(d)]))];
}

// ---------------------------------------------------------------------------
// Source map encoding
// ---------------------------------------------------------------------------

function isSourceMapV3(value: unknown): value is SourceMapV3 {
    const map = value as Partial<SourceMapV3> | null;
    return typeof map === "object" && map !== null && map.version === 3
        && Array.isArray(map.sources) && map.sources.every((s) => typeof s === "string");
}

function toDataUrl(map: object): string {
    return "data:application/json;charset=utf-8;base64," + Buffer.from(JSON.stringify(map), "utf-8").toString("base64");
}

/** Decodes a `data:` URL payload (base64 or percent-encoded), or returns `undefined` for anything else. */
function decodeDataUrl(ref: string): string | undefined {
    if (!URL.canParse(ref) || new URL(ref).protocol !== "data:") {
        return undefined;
    }
    const comma = ref.indexOf(",");
    if (comma === -1) {
        return undefined;
    }
    const payload = ref.slice(comma + 1);
    return /;base64$/i.test(ref.slice(0, comma))
        ? Buffer.from(payload, "base64").toString("utf-8")
        : decodeURIComponent(payload);
}

/**
 * Synthesizes an inline "identity" source map for a script that has none of
 * its own — mapping every generated line 1:1 (column 0) onto the same line
 * of `file`, which is valid since UXP executes the file exactly as on disk.
 *
 * js-debug (`pwa-node`) only treats a script as an always-editable authored
 * source when it comes through a source map; a script resolved solely via
 * its url is verified against the on-disk content hash first, and that
 * check accounts for Node's CommonJS wrapper, so it always fails for UXP.
 */
function identitySourceMapUrl(file: string, lineCount: number): string {
    // VLQ segments: [genColumn=0, sourceIndexDelta=0, sourceLineDelta, sourceColumn=0].
    const mappings = Array.from({ length: Math.max(lineCount, 1) }, (_, i) => (i === 0 ? "AAAA" : "AACA"));
    return toDataUrl({ version: 3, sources: [pathToFileURL(file).href], names: [], mappings: mappings.join(";") });
}

// ---------------------------------------------------------------------------
// Rewriter
// ---------------------------------------------------------------------------

/**
 * Rewrites `Debugger.scriptParsed` events so js-debug maps UXP scripts and
 * their source maps onto the real, editable files on disk.
 *
 * Every url / source is resolved purely by probing the filesystem (see
 * {@link pathCandidates}), so no URL scheme is special-cased.
 */
export class SourceMapRewriter {
    constructor(
        private readonly pluginDir: string,
        private readonly log: vscode.OutputChannel,
    ) {}

    /** Rewrites `params` in place. */
    rewriteScriptParsed(params: ScriptParsedParams): void {
        if (typeof params.url !== "string") {
            return;
        }
        const scriptFile = findFile(params.url, [this.pluginDir]);
        if (scriptFile) {
            const url = pathToFileURL(scriptFile).href;
            this.log.appendLine(`[CDP] Script: ${JSON.stringify(params.url)} → ${JSON.stringify(url)}`);
            params.url = url;
        }
        const scriptDir = scriptFile ? path.dirname(scriptFile) : this.pluginDir;

        if (params.sourceMapURL) {
            params.sourceMapURL = this.rewriteSourceMap(params.sourceMapURL, scriptDir);
        }
        else if (scriptFile) {
            params.sourceMapURL = identitySourceMapUrl(scriptFile, (params.endLine ?? 0) + 1);
        }
    }

    /**
     * Loads an inline (`data:`) or external (`.map` next to the script) source
     * map and re-emits it inline with every resolvable source as an absolute
     * `file:` URL. Returns `sourceMapURL` unchanged when it can't be loaded.
     */
    private rewriteSourceMap(sourceMapURL: string, scriptDir: string): string {
        try {
            const inline = decodeDataUrl(sourceMapURL);
            const mapFile = inline === undefined ? findFile(sourceMapURL, [scriptDir]) : undefined;
            const json = inline ?? (mapFile && fs.readFileSync(mapFile, "utf-8"));
            if (json === undefined) {
                this.log.appendLine(`[CDP] Source map not found: ${sourceMapURL}`);
                return sourceMapURL;
            }
            const map: unknown = JSON.parse(json);
            if (!isSourceMapV3(map)) {
                throw new TypeError("Invalid Source Map v3 JSON");
            }
            this.resolveSources(map, scriptDir);
            return toDataUrl(map);
        }
        catch (e) {
            this.log.appendLine(`[CDP] Failed to rewrite source map: ${e instanceof Error ? e.message : String(e)}`);
            return sourceMapURL;
        }
    }

    private resolveSources(map: SourceMapV3, scriptDir: string): void {
        const dirs = searchDirs(scriptDir);
        const root = map.sourceRoot ? map.sourceRoot.replace(/\/?$/, "/") : "";
        let resolved = 0;
        const unresolved: string[] = [];

        map.sources = map.sources.map((source) => {
            const [bare, suffix] = splitSuffix(source);
            const file = (root ? findFile(root + bare, dirs) : undefined) ?? findFile(bare, dirs);
            if (!file) {
                unresolved.push(source);
                return source;
            }
            const url = pathToFileURL(file).href + suffix;
            if (resolved++ < 5) {
                this.log.appendLine(`[CDP] Source: ${JSON.stringify(source)} → ${JSON.stringify(url)}`);
            }
            return url;
        });
        // Unresolved relative sources fall back to the script's own directory.
        map.sourceRoot = dirUrl(scriptDir);
        this.log.appendLine(`[CDP] Resolved ${String(resolved)}/${String(map.sources.length)} source map sources on disk`);
        for (const source of unresolved.slice(0, MAX_LOGGED_UNRESOLVED)) {
            this.log.appendLine(`[CDP] Unresolved source: ${JSON.stringify(source)}`);
        }
        if (unresolved.length > MAX_LOGGED_UNRESOLVED) {
            this.log.appendLine(`[CDP] ...and ${String(unresolved.length - MAX_LOGGED_UNRESOLVED)} more unresolved`);
        }
    }
}
