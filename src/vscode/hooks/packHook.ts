/**
 * POST /__uxp_debugger__/hooks/pack — build the plugin's distributable
 * `.ccx` archive. Reuses the exact same pure core functions as
 * `uxp_pack_plugin` (LM tool): `validateManifestForPack` /
 * `resolveHostOverride` / `packPluginFolder` (`core/pack/packPlugin.ts`).
 */

import * as path from "path";
import { packPluginFolder, resolveHostOverride, validateManifestForPack } from "../../core/pack/packPlugin";
import { requireStringField, optionalStringField, type HookResult } from "./hooksHttp";
import { notRegisteredResult } from "./hookErrors";
import type { HookDependencies } from "./hooksTypes";

export function handlePack(input: Record<string, unknown>, deps: HookDependencies): HookResult {
    const manifestPath = requireStringField(input, "manifestPath");
    const outputPath = requireStringField(input, "outputPath");
    const host = optionalStringField(input, "host");

    // Unauthenticated localhost surface — only panel-registered plugins may be
    // packed, and only into a .ccx file (no arbitrary file writes).
    if (!deps.pluginRegistry.pluginByManifest(manifestPath)) {
        return notRegisteredResult(manifestPath);
    }
    if (path.extname(outputPath).toLowerCase() !== ".ccx") {
        return {
            status: 400,
            body: { ok: false, error: `"outputPath" must end with .ccx (got "${outputPath}").` },
        };
    }

    let parsed;
    try {
        parsed = validateManifestForPack(manifestPath);
    }
    catch (err) {
        return { status: 400, body: { ok: false, error: err instanceof Error ? err.message : String(err) } };
    }

    let manifestOverride: string | undefined;
    try {
        manifestOverride = resolveHostOverride(parsed, host);
    }
    catch (err) {
        return { status: 400, body: { ok: false, error: err instanceof Error ? err.message : String(err) } };
    }

    try {
        packPluginFolder(path.dirname(manifestPath), outputPath, manifestOverride);
    }
    catch (err) {
        return {
            status: 500,
            body: { ok: false, error: `Failed to write the archive: ${err instanceof Error ? err.message : String(err)}` },
        };
    }

    return { status: 200, body: { ok: true, name: parsed.manifest.name, outputPath } };
}
