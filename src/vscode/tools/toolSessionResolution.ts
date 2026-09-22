import type { PluginSession } from "../../core/broker/SessionRegistry";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";

/**
 * The subset of `UxpService` this module needs — kept minimal so `resolveSessionsForManifest`
 * is unit-testable without a real (vscode-importing) `UxpService`.
 */
export interface SessionSourceLike {
    sessionsForManifest(manifestPath: string): PluginSession[];
}

/**
 * Resolves which attached `clientSessionId` a Tier 1/2 tool call should act
 * on: the explicit `sessionId` input when given, or the sole attached
 * session when there's exactly one. Throws an actionable error otherwise
 * (multiple/zero attached sessions) instead of guessing.
 */
export function resolveAttachedSessionId(
    debugManager: UxpDebugSessionManager,
    explicitSessionId?: string,
): string {
    if (explicitSessionId) {
        if (!debugManager.isAttached(explicitSessionId)) {
            throw new Error(
                `No attached debug session with id "${explicitSessionId}". Call uxp_get_debug_state to see current session ids.`,
            );
        }
        return explicitSessionId;
    }

    const ids = debugManager.activeSessionIds;
    if (ids.length === 0) {
        throw new Error(
            "No debug session is currently attached. Attach the debugger to the plugin/script first, then retry "
            + "(call uxp_get_debug_state to check).",
        );
    }
    if (ids.length > 1) {
        throw new Error(
            `Multiple debug sessions are attached (${ids.join(", ")}). Specify "sessionId" — call uxp_get_debug_state `
            + "to see which session id belongs to which plugin/script.",
        );
    }
    return ids[0];
}

export function tryResolveAttachedSessionId(
    debugManager: UxpDebugSessionManager,
    explicitSessionId?: string,
): { sessionId: string } | { errorMessage: string } {
    try {
        return { sessionId: resolveAttachedSessionId(debugManager, explicitSessionId) };
    }
    catch (err) {
        return { errorMessage: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Resolves the live sessions (not necessarily attached) a Tier 3 tool call
 * should act on: every live session for `manifestPath`, narrowed to just
 * `sessionId` when given. Throws when an explicit `sessionId` doesn't match
 * any live session — an empty result (no `sessionId` given, nothing live)
 * is returned as-is, since "no live session" is a normal, expected state
 * for e.g. Load/Attach's callers to handle themselves.
 */
export function resolveSessionsForManifest(
    service: SessionSourceLike,
    manifestPath: string,
    sessionId?: string,
): PluginSession[] {
    const sessions = service.sessionsForManifest(manifestPath);
    if (!sessionId) {
        return sessions;
    }
    const match = sessions.find((s) => s.clientSessionId === sessionId);
    if (!match) {
        throw new Error(
            `No live session "${sessionId}" for manifest "${manifestPath}". Call uxp_get_debug_state to see current session ids.`,
        );
    }
    return [match];
}
