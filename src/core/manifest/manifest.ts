/**
 * Local `manifest.json` parsing and pre-validation (port of the checks in
 * Adobe's `ManifestHelper`). The host-side `Plugin/validate` remains the
 * authoritative check — this exists for fast, actionable local errors.
 */

import * as path from "path";
import { ManifestValidationError } from "../errors";
import { foldPathCase } from "../pathCase";
import type { UxpManifestHost, UxpPluginManifest } from "../protocol/types";

/** A normalised `host` entry: app id + optional minimum version. */
export interface NormalizedHost {
    /** Host application id, e.g. `"PS"`. */
    app: string;
    /** Minimum supported app version (`"x.y.z"`), when specified. */
    minVersion?: string;
}

export interface ParsedManifest {
    /** The raw parsed manifest — forwarded verbatim to `Plugin/validate`. */
    manifest: UxpPluginManifest;
    /** Normalised host entries (always an array, `"PS@22.0"` forms split). */
    hosts: NormalizedHost[];
}

/**
 * Parse manifest file content and validate the protocol-required fields
 * (`id`, `name`, `main`, `version`, `host`).
 * @throws {ManifestValidationError} listing every problem found.
 */
export function parseManifestContent(
    content: string,
    manifestPath: string,
): ParsedManifest {
    let raw: unknown;
    try {
        raw = JSON.parse(content);
    }
    catch (err) {
        throw new ManifestValidationError(manifestPath, [
            `not valid JSON (${err instanceof Error ? err.message : String(err)})`,
        ]);
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new ManifestValidationError(manifestPath, ["manifest must be a JSON object"]);
    }

    const manifest = raw as Record<string, unknown>;
    const issues: string[] = [];
    for (const field of ["id", "name", "main", "version"] as const) {
        if (typeof manifest[field] !== "string" || manifest[field] === "") {
            issues.push(`missing or invalid "${field}" (string required)`);
        }
    }

    let hosts: NormalizedHost[] = [];
    if (manifest.host === undefined) {
        issues.push("missing \"host\" entry (which app should load this plugin?)");
    }
    else {
        try {
            hosts = normalizeHosts(manifest.host);
            if (hosts.length === 0) {
                issues.push("\"host\" does not contain any usable app entry");
            }
        }
        catch (err) {
            issues.push(err instanceof Error ? err.message : String(err));
        }
    }

    if (issues.length > 0) {
        throw new ManifestValidationError(manifestPath, issues);
    }
    return { manifest: manifest as unknown as UxpPluginManifest, hosts };
}

/**
 * Normalise the manifest `host` field. Accepts a single object, an array of
 * objects, a plain string (`"PS"` / `"PS@22.0"`), or an array of strings.
 */
export function normalizeHosts(host: unknown): NormalizedHost[] {
    const entries = Array.isArray(host) ? host : [host];
    const result: NormalizedHost[] = [];

    for (const entry of entries) {
        if (typeof entry === "string") {
            result.push(parseAppIdString(entry));
            continue;
        }
        if (typeof entry === "object" && entry !== null) {
            const record = entry as UxpManifestHost;
            if (typeof record.app !== "string" || record.app === "") {
                throw new Error("\"host\" entry is missing its \"app\" id");
            }
            const fromId = parseAppIdString(record.app);
            result.push({
                app: fromId.app,
                minVersion:
          typeof record.minVersion === "string" && record.minVersion !== ""
              ? record.minVersion
              : fromId.minVersion,
            });
            continue;
        }
        throw new Error(`unsupported "host" entry: ${JSON.stringify(entry)}`);
    }
    return result;
}

/** Split the `"PS@22.0"` id\@version form. */
function parseAppIdString(value: string): NormalizedHost {
    const atIndex = value.indexOf("@");
    if (atIndex === -1) {
        return { app: value };
    }
    const app = value.slice(0, atIndex);
    const minVersion = value.slice(atIndex + 1);
    if (app === "") {
        throw new Error(`invalid app id "${value}"`);
    }
    return minVersion === "" ? { app } : { app, minVersion };
}

// ---------------------------------------------------------------------------
// Icon path detection (watch-mode "reload vs refresh" decision, §8)
// ---------------------------------------------------------------------------

const ICON_EXTENSIONS = [".png", ".svg", ".ico", ".jpg", ".jpeg"];

/**
 * Recursively scan an already-parsed manifest object for every string value
 * that looks like an image file path (regardless of where in the manifest
 * schema it lives — top-level `icons[]`, per-panel/command icons, etc.).
 */
export function collectManifestIconPaths(manifest: unknown): string[] {
    const found = new Set<string>();
    const visit = (value: unknown): void => {
        if (typeof value === "string") {
            if (ICON_EXTENSIONS.includes(path.extname(value).toLowerCase())) {
                found.add(value);
            }
        }
        else if (Array.isArray(value)) {
            value.forEach(visit);
        }
        else if (value !== null && typeof value === "object") {
            Object.values(value).forEach(visit);
        }
    };
    visit(manifest);
    return [...found];
}

/**
 * Whether `changedFilePath` is the on-disk file for one of
 * `iconRelativePaths` (declared in the manifest, resolved relative to
 * `pluginDir`). Manifest icon paths never carry the `@2x`/`@3x` scale suffix
 * even though the actual files on disk do (e.g. manifest lists `icon.png`,
 * disk has `icon.png` + `icon@2x.png`) — strip it before comparing.
 */
export function isIconFileMatch(
    changedFilePath: string,
    pluginDir: string,
    iconRelativePaths: string[],
): boolean {
    const changedExt = path.extname(changedFilePath);
    const changedStem = foldPathCase(
        path.basename(changedFilePath, changedExt).replace(/@\d+(\.\d+)?x$/i, ""),
    );
    const changedDir = foldPathCase(path.dirname(changedFilePath));

    for (const relPath of iconRelativePaths) {
        const iconAbsPath = path.resolve(pluginDir, relPath);
        const iconExt = path.extname(iconAbsPath);
        const iconStem = foldPathCase(path.basename(iconAbsPath, iconExt));
        if (
            foldPathCase(path.dirname(iconAbsPath)) === changedDir
            && changedStem === iconStem
            && changedExt.toLowerCase() === iconExt.toLowerCase()
        ) {
            return true;
        }
    }
    return false;
}
