/**
 * Session-identity helpers shared by `UxpDebugSessionManager` and
 * `pauseTrackerRegistration` — pure/vscode-free (same convention as
 * `pauseTracker.ts`) so the chain walk is unit-testable.
 */

/** Marker key stamped into the delegated debug configuration (root `pwa-node` session only). */
export const UXP_SESSION_KEY = "__uxpClientSessionId";

/** Debug configuration carrying the UXP broker session identity. */
export interface UxpStampedDebugConfiguration {
    readonly [UXP_SESSION_KEY]?: string;
}

/** Minimal shape of `vscode.DebugSession` this module needs — a real session satisfies it structurally. */
export interface DebugSessionChainLike {
    readonly configuration: Readonly<Record<string, unknown>>;
    readonly parentSession?: DebugSessionChainLike;
}

/** Reads the UXP identity stamped directly on a debug configuration. */
export function getStampedUxpClientSessionId(
    configuration: Readonly<Record<string, unknown>>,
): string | undefined {
    const id = configuration[UXP_SESSION_KEY];
    return typeof id === "string" ? id : undefined;
}

/**
 * Resolves the `clientSessionId` a debug session belongs to, walking up the
 * `parentSession` chain — js-debug delegates the actual target (threads,
 * stack traces, evaluation) to a CHILD session whose configuration does NOT
 * carry the stamp; only the root `pwa-node` session we start does.
 */
export function findUxpClientSessionId(session: DebugSessionChainLike): string | undefined {
    for (let cur: DebugSessionChainLike | undefined = session; cur; cur = cur.parentSession) {
        const id = getStampedUxpClientSessionId(cur.configuration);
        if (id !== undefined) {
            return id;
        }
    }
    return undefined;
}
