/**
 * "Pack" feature (CONTROL-PANEL.md §8): zips a UXP plugin folder into a
 * distributable `.ccx` archive (plain zip content, `.ccx` extension per
 * user decision) after validating `manifest.json`. v1 has no exclusion
 * rules — the entire plugin folder is packed as-is.
 */

import * as fs from "fs";
import AdmZip from "adm-zip";
import { type ParsedManifest, parseManifestContent } from "../manifest/manifest";
import type { UxpManifestHost, UxpPluginManifest } from "../protocol/types";

type HostEntry = UxpManifestHost | string;

/** Reads and validates `manifest.json`, throwing `ManifestValidationError` on problems. */
export function validateManifestForPack(manifestPath: string): ParsedManifest {
    const content = fs.readFileSync(manifestPath, "utf-8");
    return parseManifestContent(content, manifestPath);
}

/**
 * Raw `host` entries in manifest order (always an array, single entry wrapped) —
 * unlike `normalizeHosts`, these are the original objects/strings, so packing can
 * re-embed the exact entry the user picked, extra fields included.
 */
export function rawHostEntries(manifest: UxpPluginManifest): HostEntry[] {
    const host = manifest.host;
    return Array.isArray(host) ? (host) : [host];
}

/**
 * Adobe's UXP Manifest v4 docs: an array `host` is only allowed during
 * development — marketplace submission requires exactly one HostDefinition.
 * Returns a copy of `manifest` with `host` collapsed to the chosen single entry.
 */
export function withSingleHost(manifest: UxpPluginManifest, chosenIndex: number): UxpPluginManifest {
    return { ...manifest, host: rawHostEntries(manifest)[chosenIndex] };
}

/**
 * Resolves the `manifest.json` override string for a non-interactive caller
 * (e.g. the `uxp_pack_plugin` Language Model Tool, which can't show a
 * QuickPick) — mirrors the interactive `packManifest` command's host-collapsing
 * rules (`src/vscode/commands/packPlugin.ts`): a single-entry array is
 * collapsed silently, a multi-entry array requires the caller to name which
 * host to target via `host`.
 * @throws Error when `host` is required to disambiguate but missing/invalid.
 */
export function resolveHostOverride(parsed: ParsedManifest, host?: string): string | undefined {
    const entries = rawHostEntries(parsed.manifest);
    if (entries.length > 1) {
        if (!host) {
            throw new Error(
                `This manifest lists multiple host apps (dev-only): ${parsed.hosts.map((h) => h.app).join(", ")}. `
                + "Specify \"host\" to pick which one the packed manifest.json should target.",
            );
        }
        const index = parsed.hosts.findIndex((h) => h.app === host);
        if (index === -1) {
            throw new Error(
                `"${host}" is not one of this manifest's host apps (${parsed.hosts.map((h) => h.app).join(", ")}).`,
            );
        }
        return JSON.stringify(withSingleHost(parsed.manifest, index), null, 2);
    }
    if (Array.isArray(parsed.manifest.host)) {
        return JSON.stringify(withSingleHost(parsed.manifest, 0), null, 2);
    }
    return undefined;
}

/** Replaces characters illegal in Windows/macOS file names with `_`. */
export function sanitizeFileNamePart(value: string): string {
    const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
    return cleaned || "plugin";
}

/** Default suggested archive name: `<manifest name>-<version>.ccx`. */
export function defaultPackFileName(manifest: { name: string; version: string }): string {
    return `${sanitizeFileNamePart(manifest.name)}-${sanitizeFileNamePart(manifest.version)}.ccx`;
}

/**
 * Zips the entire plugin folder (no exclusions) into `outputPath`. When
 * `manifestJsonOverride` is given, it replaces `manifest.json`'s content in
 * the archive (used to collapse an array `host` down to a single entry).
 */
export function packPluginFolder(
    pluginDir: string,
    outputPath: string,
    manifestJsonOverride?: string,
): void {
    const zip = new AdmZip();
    zip.addLocalFolder(pluginDir);
    if (manifestJsonOverride !== undefined) {
        zip.updateFile("manifest.json", Buffer.from(manifestJsonOverride, "utf-8"));
    }
    zip.writeZip(outputPath);
}
