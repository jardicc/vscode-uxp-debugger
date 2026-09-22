import * as fs from "fs";
import * as path from "path";
import type * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Source-map & URL rewriting (pure functions)
// ---------------------------------------------------------------------------

interface SourceMapV3 {
    [key: string]: unknown;
    version: 3;
    sources: string[];
    mappings: string;
    names?: string[];
    sourceRoot?: string;
    sourcesContent?: (string | null)[];
    file?: string;
}

/** Sets `map.sourceRoot` (in place) to a `file://` URL under `pluginDir/scriptSubdir`. */
function setSourceRootForPluginDir(
    map: SourceMapV3,
    pluginDir: string,
    scriptSubdir: string,
): { oldRoot: string | undefined; newRoot: string } {
    const baseDir = pluginDir.replace(/\\/g, "/") + (scriptSubdir ? "/" + scriptSubdir : "");
    const root = "file:///" + baseDir + "/";
    const oldRoot = map.sourceRoot;
    map.sourceRoot = root;
    return { oldRoot, newRoot: root };
}

function logResolvedSourceFiles(map: SourceMapV3, sourceRoot: string, log: vscode.OutputChannel): void {
    // Avoid flooding the output for bundles whose source maps contain hundreds of files.
    const sourcesToLog = map.sources.slice(0, 5);
    for (const source of sourcesToLog) {
        const resolvedSource = new URL(source, sourceRoot).href;
        log.appendLine(`[CDP] Final source file: ${JSON.stringify(source)} → ${JSON.stringify(resolvedSource)}`);
    }
    if (map.sources.length > sourcesToLog.length) {
        log.appendLine(`[CDP] Final source files: ${String(map.sources.length - sourcesToLog.length)} more omitted`);
    }
}

/** Encodes `map` back into an inline `data:application/json;base64,...` URL. */
function encodeInlineSourceMap(map: SourceMapV3): string {
    const payload = Buffer.from(JSON.stringify(map), "utf-8").toString("base64");
    return "data:application/json;charset=utf-8;base64," + payload;
}

/** Matches a Windows drive-letter absolute path, e.g. `a:\foo` or `C:/foo`. */
const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[\\/]/;

/**
 * True when `url` already has a real URI scheme (`file:`, `http(s):`, ...).
 * A bare Windows drive letter (`a:\...`) matches a naive `scheme:` regex
 * too — excluded explicitly so absolute Windows paths aren't mistaken for
 * already-resolved URLs.
 */
function hasUriScheme(url: string): boolean {
    return !WINDOWS_DRIVE_PATH.test(url) && /^[a-z][a-z0-9+.-]*:/i.test(url);
}

/**
 * Schemes that always denote a real, externally-resolvable resource and must
 * never be reinterpreted as an opaque plugin-relative path (`uxp:` is
 * excluded too — it already has its own dedicated handling in
 * `normalizeScriptUrl`, by the time these checks run it's either already
 * stripped or genuinely meant to stay untouched).
 */
const KNOWN_EXTERNAL_SCHEMES = new Set(["file:", "http:", "https:", "ws:", "wss:", "data:", "uxp:"]);

/**
 * Returns the lowercased `scheme:` prefix of `url`, or `undefined` if it has none
 * (a bare Windows drive letter never counts).
 */
function getUriScheme(url: string): string | undefined {
    if (WINDOWS_DRIVE_PATH.test(url)) {
        return undefined;
    }
    const match = /^([a-z][a-z0-9+.-]*):/i.exec(url);
    return match ? match[1].toLowerCase() + ":" : undefined;
}

/**
 * True for custom/unrecognized URI schemes — e.g. `uxp-script://assets/x.js`,
 * injected by some bundlers' hot-reload tooling (observed: vite-uxp-plugin's
 * `debugger: "udt"` build mode) — that encode a *plugin-relative file path*
 * after `scheme://` rather than a real, externally-resolvable URL. Since
 * there's no fixed list of every such scheme a third-party tool might
 * invent, any scheme outside `KNOWN_EXTERNAL_SCHEMES` is treated as one of
 * these and resolved by checking the filesystem (see `resolveVerifiedSubdir`
 * / `resolveScriptFileUrl`) instead of guessed from the URL's shape alone.
 */
function isOpaqueCustomScheme(url: string): boolean {
    const scheme = getUriScheme(url);
    return scheme !== undefined && !KNOWN_EXTERNAL_SCHEMES.has(scheme);
}

/** Strips `scheme://` from an opaque custom-scheme url, returning the remainder as a root-relative path — e.g. `uxp-script://assets/x.js` → `/assets/x.js`. */
function stripOpaqueScheme(url: string): string {
    const idx = url.indexOf("://");
    const rest = idx === -1 ? url : url.slice(idx + 3);
    return "/" + rest.replace(/^\/+/, "");
}

/**
 * Normalize a UXP script URL to a form that the built-in JS debugger
 * can map to local files.
 *
 * Common UXP URL schemes:
 *   uxp://com.adobe.plugin/index.js  →  /index.js
 *   file:///path/to/plugin/index.js  →  kept as-is
 *   http(s)://...                    →  kept as-is
 */
export function normalizeScriptUrl(url: string): string {
    if (url.startsWith("uxp://")) {
    // Strip the scheme and plugin-id prefix, keep the relative path
        const withoutScheme = url.replace(/^uxp:\/\/[^/]+/, "");
        return withoutScheme || url;
    }
    return url;
}

/**
 * Resolve a normalized (root-relative) script url — e.g. `/index.js` — to an
 * absolute `file://` URL under `pluginDir`.
 *
 * When a script has no source map, its `Debugger.scriptParsed` url is the
 * only thing js-debug has to locate the file: a root-relative path like
 * `/index.js` doesn't resolve to anything on disk, so js-debug falls back
 * to fetching the source over CDP and showing it in a read-only virtual
 * document instead of the real, editable file. Since a `uxp://` url always
 * refers to a real file inside the plugin/script directory, rewriting it to
 * an absolute `file://` path lets js-debug open that file directly.
 *
 * Already-absolute urls (`file:`, `http(s):`, ...) are left untouched.
 */
export function resolveScriptFileUrl(url: string, pluginDir: string): string {
    if (isOpaqueCustomScheme(url)) {
    // Verify against disk rather than trusting the scheme's shape: the
    // "host"-looking segment right after `://` is actually part of the
    // plugin-relative path for these schemes (unlike `uxp://`, where it's a
    // plugin id to strip) — confirming the file exists avoids resolving to
    // a wrong/garbage path when that assumption doesn't hold.
        const relative = stripOpaqueScheme(url).replace(/^\/+/, "");
        if (fs.existsSync(path.join(pluginDir, relative))) {
            const baseDir = pluginDir.replace(/\\/g, "/");
            return "file:///" + baseDir + (relative ? "/" + relative : "");
        }
        return url;
    }
    if (hasUriScheme(url)) {
        return url;
    }
    if (WINDOWS_DRIVE_PATH.test(url)) {
    // UXP sometimes reports the script's raw absolute OS path instead of a
    // uxp:// url (observed on Windows: "a:\...\index.js") — already absolute,
    // just needs a file:// prefix, not joining with pluginDir below.
        return "file:///" + url.replace(/\\/g, "/");
    }
    const relative = url.replace(/^\.?\/+/, "");
    const baseDir = pluginDir.replace(/\\/g, "/");
    return "file:///" + baseDir + (relative ? "/" + relative : "");
}

/**
 * Synthesizes an inline "identity" source map for a script that has none of
 * its own — mapping every generated line 1:1 (column 0) onto the same line
 * of `absoluteFilePath`, which is valid since there is no actual
 * transformation between what's on disk and what UXP executes.
 *
 * This exists because js-debug (`pwa-node`) only treats a script as an
 * "authored", always-editable source when it comes through a source map;
 * a script resolved solely via its (even if correct, absolute) `url` is
 * instead verified against the on-disk file's content hash before being
 * treated as editable — and that check is Node-specific (it accounts for
 * the CommonJS module wrapper `require()` adds around every file's source
 * before compiling it), so it always fails for UXP scripts, which are
 * never wrapped that way. Routing the script through an identity source
 * map sidesteps that hash check entirely, exactly like `stripTypeScript.ts`
 * already does for `.ts` scripts (see `buildIdentitySourceMap` there).
 */
export function buildIdentitySourceMapUrl(absoluteFilePath: string, lineCount: number): string {
    const sourceUrl = "file:///" + absoluteFilePath.replace(/\\/g, "/");
    // VLQ segments: [genColumn=0, sourceIndexDelta=0, sourceLineDelta, sourceColumn=0].
    const lines = Array.from({ length: Math.max(lineCount, 1) }, (_, i) => (i === 0 ? "AAAA" : "AACA"));
    return encodeInlineSourceMap({
        version: 3,
        sources: [sourceUrl],
        names: [],
        mappings: lines.join(";"),
    });
}

/**
 * Extracts the string entries from a source map's `sources` array, if any.
 * Used to sample real source paths for `resolveVerifiedSubdir`'s
 * filesystem-existence check.
 */
function extractStringSources(map: SourceMapV3): string[] {
    return map.sources;
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSourceMapV3(value: unknown): value is SourceMapV3 {
    if (!isRecord(value)) {
        return false;
    }
    return value.version === 3
        && isStringArray(value.sources)
        && typeof value.mappings === "string"
        && (value.names === undefined || isStringArray(value.names))
        && (value.sourceRoot === undefined || typeof value.sourceRoot === "string")
        && (value.file === undefined || typeof value.file === "string");
}

function parseSourceMap(json: string): SourceMapV3 {
    const parsed: unknown = JSON.parse(json);
    if (!isSourceMapV3(parsed)) {
        throw new TypeError("Invalid Source Map v3 JSON");
    }
    return parsed;
}

/**
 * Naive, purely-string-based guess at a script's subdirectory (relative to
 * `pluginDir`): normalizes `url` and takes its directory name. Correct for
 * the common cases (`uxp://` urls already stripped to a root-relative path
 * by `normalizeScriptUrl`, or a plain relative path) — used as the first
 * candidate and final fallback in `resolveVerifiedSubdir`.
 */
export function deriveNaiveSubdir(url: string): string {
    const cleanUrl = path.posix.normalize(url);
    const dir = path.posix.dirname(cleanUrl);
    return dir === "/" || dir === "." ? "" : dir.replace(/^\//, "");
}

/**
 * Builds an ordered, de-duplicated list of subdirectory candidates to try
 * for `url`: the naive dirname-based guess first, then — for opaque custom
 * schemes like `uxp-script://` — the same dirname logic applied to the
 * scheme-stripped path (since there the "host"-looking segment is actually
 * part of the relative path, not something to discard), and finally the
 * plugin root itself as a last resort.
 */
function buildSubdirCandidates(url: string): string[] {
    const candidates = [deriveNaiveSubdir(url)];
    if (isOpaqueCustomScheme(url)) {
        candidates.push(deriveNaiveSubdir(stripOpaqueScheme(url)));
    }
    candidates.push("");
    return [...new Set(candidates)];
}

/**
 * Resolves the subdirectory (relative to `pluginDir`) that a script's
 * *original* source files actually live under, verifying candidates against
 * the real filesystem instead of trusting `url`'s shape alone.
 *
 * Why this exists: `Debugger.scriptParsed.url` isn't always a well-behaved
 * `uxp://` or root-relative path — some bundlers report scripts under a
 * custom scheme (e.g. `uxp-script://assets/index.js`, emitted by
 * vite-uxp-plugin's `debugger: "udt"` build mode) whose "host" segment is
 * actually part of the relative path. Naively running `path.posix.dirname`
 * on such a url produces a garbage subdirectory, which then corrupts
 * `sourceRoot` and makes every `sources` entry resolve to the wrong file
 * (e.g. `dist/src/main.tsx` — a read-only, CDP-fetched preview — instead of
 * the real, editable `src/main.tsx`).
 *
 * `relativePathsToVerify` should be a small sample of paths that are
 * expected to resolve to real files once the correct subdir is found (e.g.
 * a source map's `sources` entries, or an external `.map` file's own name).
 * Each candidate subdir is scored by how many samples resolve to a file
 * that actually exists on disk; the first perfect-score candidate wins, and
 * the best-scoring one is used otherwise. If NO sample paths are available,
 * or none of them exist anywhere, this falls back to the naive guess —
 * exactly today's behavior — so already-working url shapes never regress.
 */
export function resolveVerifiedSubdir(
    url: string,
    pluginDir: string,
    relativePathsToVerify: string[],
): string {
    const fallback = deriveNaiveSubdir(url);
    if (relativePathsToVerify.length === 0) {
        return fallback;
    }

    // Cap how many samples are probed on disk per candidate — enough for a
    // reliable signal without doing excessive I/O for bundles with hundreds
    // of original sources.
    const samples = relativePathsToVerify.slice(0, 5);

    let best = fallback;
    let bestScore = -1;
    for (const candidate of buildSubdirCandidates(url)) {
        const baseDir = path.join(pluginDir, candidate);
        const score = samples.reduce(
            (count, sample) => count + (fs.existsSync(path.resolve(baseDir, sample)) ? 1 : 0),
            0,
        );
        if (score === samples.length) {
            return candidate; // every sample verified — good enough, stop looking.
        }
        if (score > bestScore) {
            bestScore = score;
            best = candidate;
        }
    }
    return best;
}

// ! This is bad for performance. Find out a way to avoid this if possible.
/**
 * Rewrite the `sourceRoot` inside an inline (data-URL) source map so that
 * relative `sources` entries resolve to the correct local files.
 *
 * Webpack source maps typically contain paths like `../src/shared/store.ts`
 * which are relative to the output directory (one level below the project
 * root).  The correct subdirectory is derived from `scriptUrl` and verified
 * against disk (see `resolveVerifiedSubdir`) before being used to build
 * `sourceRoot`, so that `../<path>` resolves back to the real source file
 * even when `scriptUrl` uses an unusual/custom scheme.
 */
export function rewriteInlineSourceMapRoot(
    dataUrl: string,
    pluginDir: string,
    scriptUrl: string,
    log: vscode.OutputChannel,
): string {
    try {
    // data:application/json;base64,<payload>
    // data:application/json;charset=utf-8;base64,<payload>
    // Do not change if this is not data URL or does not look like an inline source map.
        const requiredPrefix = "data:application/json";
        if (!dataUrl.slice(0, requiredPrefix.length).toLowerCase().startsWith(requiredPrefix)) {
            log.appendLine(`[CDP] Not an inline source map: ${dataUrl}`);
            return dataUrl;
        }
        const commaIdx = dataUrl.indexOf(",");
        if (commaIdx === -1) {
            return dataUrl;
        }
        const header = dataUrl.slice(0, commaIdx); // everything before the comma
        const payload = dataUrl.slice(commaIdx + 1);

        const json = Buffer.from(payload, "base64").toString("utf-8");
        const map = parseSourceMap(json);

        // Use a file:// URL so that js-debug resolves paths as local files.
        // Include the script's subdirectory so relative source entries resolve correctly.
        const scriptSubdir = resolveVerifiedSubdir(scriptUrl, pluginDir, extractStringSources(map));
        const { oldRoot, newRoot } = setSourceRootForPluginDir(map, pluginDir, scriptSubdir);
        log.appendLine(
            `[CDP] Rewrote sourceRoot: ${JSON.stringify(oldRoot)} → ${JSON.stringify(newRoot)}`,
        );
        logResolvedSourceFiles(map, newRoot, log);

        const newJson = JSON.stringify(map);
        const newPayload = Buffer.from(newJson, "utf-8").toString("base64");
        return header + "," + newPayload;
    }
    catch (e) {
        log.appendLine(
            `[CDP] Failed to rewrite inline source map: ${e instanceof Error ? e.message : String(e)}`,
        );
        return dataUrl;
    }
}

/**
 * Resolves an *external* `sourceMapURL` (a plain filename/relative path, as
 * opposed to an inline `data:` URL) by reading the `.map` file straight off
 * disk — the plugin's local directory (`pluginDir`) is already known here,
 * so there's no need for js-debug to fetch it over the network/CDP itself.
 * The result is re-emitted as an inline `data:` URL (with `sourceRoot`
 * rewritten exactly like {@link rewriteInlineSourceMapRoot}) so both cases
 * converge on the same code path downstream.
 *
 * Absolute URLs (`http(s):`, `file:`, ...) are left untouched — this only
 * handles the common bundler case of a relative `.map` filename sitting
 * next to its `.js` file.
 */
export function resolveExternalSourceMap(
    sourceMapURL: string,
    pluginDir: string,
    scriptUrl: string,
    log: vscode.OutputChannel,
): string {
    try {
        if (hasUriScheme(sourceMapURL)) {
            log.appendLine(`[CDP] Not a relative external source map, leaving as-is: ${sourceMapURL}`);
            return sourceMapURL;
        }

        // The .map file's own name doubles as the sample to verify the
        // subdirectory against — it must exist there for this to succeed anyway.
        const scriptSubdir = resolveVerifiedSubdir(scriptUrl, pluginDir, [sourceMapURL]);
        const mapPath = path.join(pluginDir, scriptSubdir, sourceMapURL);
        const json = fs.readFileSync(mapPath, "utf-8");
        const map = parseSourceMap(json);

        const { oldRoot, newRoot } = setSourceRootForPluginDir(map, pluginDir, scriptSubdir);
        log.appendLine(
            `[CDP] Read external source map ${mapPath}, rewrote sourceRoot: `
            + `${JSON.stringify(oldRoot)} → ${JSON.stringify(newRoot)}`,
        );
        logResolvedSourceFiles(map, newRoot, log);

        return encodeInlineSourceMap(map);
    }
    catch (e) {
        log.appendLine(
            `[CDP] Failed to resolve external source map "${sourceMapURL}": ${e instanceof Error ? e.message : String(e)}`,
        );
        return sourceMapURL;
    }
}
