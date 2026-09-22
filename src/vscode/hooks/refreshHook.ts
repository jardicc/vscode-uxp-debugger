/**
 * POST /__uxp_debugger__/hooks/refresh — fast in-place `Plugin/reload` for
 * every live session of a manifest (debugger/inspector stay attached).
 * Mirrors `uxp_refresh_plugin` (LM tool) exactly, reusing the same
 * `resolveSessionsForManifest` helper — "no live session" is a normal,
 * idempotent no-op for a build-watcher hook, not an error.
 */

import { requireStringField, optionalStringField, type HookResult } from "./hooksHttp";
import { resolveSessionsForManifest } from "../tools/toolSessionResolution";
import type { HookDependencies } from "./hooksTypes";

export async function handleRefresh(
    input: Record<string, unknown>,
    deps: HookDependencies,
): Promise<HookResult> {
    const manifestPath = requireStringField(input, "manifestPath");
    const sessionId = optionalStringField(input, "sessionId");

    await deps.service.ensureStarted();

    let sessions;
    try {
        sessions = resolveSessionsForManifest(deps.service, manifestPath, sessionId);
    }
    catch (err) {
        return { status: 400, body: { ok: false, error: err instanceof Error ? err.message : String(err) } };
    }
    if (sessions.length === 0) {
        return { status: 200, body: { ok: true, sessions: [], message: "No live session — nothing to refresh." } };
    }

    for (const session of sessions) {
        try {
            await deps.service.reloadPlugin(session);
        }
        catch (err) {
            return {
                status: 502,
                body: {
                    ok: false,
                    error: `Refresh failed for session "${session.clientSessionId}": ${err instanceof Error ? err.message : String(err)}`,
                },
            };
        }
    }
    return { status: 200, body: { ok: true, sessions: sessions.map((s) => s.clientSessionId) } };
}
