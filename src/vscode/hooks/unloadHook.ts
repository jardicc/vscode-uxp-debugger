/**
 * POST /__uxp_debugger__/hooks/unload — unload every live session of a
 * manifest (or just `sessionId`). "No live session" is treated as an
 * idempotent no-op, same reasoning as `refreshHook.ts`.
 */

import { requireStringField, optionalStringField, type HookResult } from "./hooksHttp";
import { resolveSessionsForManifest } from "../tools/toolSessionResolution";
import type { HookDependencies } from "./hooksTypes";

export async function handleUnload(
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
        return { status: 200, body: { ok: true, sessions: [], message: "No live session — nothing to unload." } };
    }

    for (const session of sessions) {
        try {
            await deps.service.unloadPlugin(session);
        }
        catch (err) {
            return {
                status: 502,
                body: {
                    ok: false,
                    error: `Unload failed for session "${session.clientSessionId}": ${err instanceof Error ? err.message : String(err)}`,
                },
            };
        }
    }
    return { status: 200, body: { ok: true, sessions: sessions.map((s) => s.clientSessionId) } };
}
