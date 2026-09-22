/**
 * GET /__uxp_debugger__/hooks/watch?manifestPath=... and
 * POST /__uxp_debugger__/hooks/watch/enable | /watch/disable — read/toggle
 * the persisted watch flag for a plugin already registered in the panel's
 * list (`PluginRegistry`). Same "active" condition `PluginWatchManager`
 * itself uses (`plugin.watch && sessionsForManifest(...).length > 0`) —
 * reused here, not reimplemented, so the two never drift apart.
 *
 * Per explicit design decision: a manifest that isn't registered in the
 * panel yet returns 404 rather than being silently auto-added — add it via
 * the panel (or `uxp.loadPlugin`) first.
 */

import type { HookResult } from "./hooksHttp";
import { notRegisteredResult } from "./hookErrors";
import type { HookDependencies } from "./hooksTypes";

export function handleWatchState(manifestPath: string, deps: HookDependencies): HookResult {
    const plugin = deps.pluginRegistry.pluginByManifest(manifestPath);
    if (!plugin) {
        return notRegisteredResult(manifestPath);
    }
    const active = deps.service.sessionsForManifest(manifestPath).length > 0;
    return { status: 200, body: { ok: true, watch: plugin.watch, watcherActive: plugin.watch && active } };
}

export async function handleSetWatch(
    manifestPath: string,
    value: boolean,
    deps: HookDependencies,
): Promise<HookResult> {
    const plugin = deps.pluginRegistry.pluginByManifest(manifestPath);
    if (!plugin) {
        return notRegisteredResult(manifestPath);
    }
    await deps.pluginRegistry.setWatch({ manifestPath }, value);
    return { status: 200, body: { ok: true, watch: value } };
}
