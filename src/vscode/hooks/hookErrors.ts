/**
 * Maps `UxpService.loadPlugin`'s known error types to HTTP status codes for
 * hook responses — pairs with `describeLoadError` (`../tools/toolErrors.ts`,
 * reused as-is for the message text) so load/reload hooks and the
 * `uxp_load_plugin`/`uxp_attach_debugger` LM tools describe failures
 * identically, just wrapped in a status code here for REST callers.
 */

import { HostAppNotRunningError, MultipleAppsMatchError, RequestTimeoutError } from "../../core/errors";
import type { HookResult } from "./hooksHttp";

/** Shared 404 for hooks that refuse manifests not registered in the panel's plugin list. */
export function notRegisteredResult(manifestPath: string): HookResult {
    return {
        status: 404,
        body: {
            ok: false,
            error: `Plugin "${manifestPath}" is not registered in the UXP panel. Add it there first, then retry.`,
        },
    };
}

export function loadErrorStatus(err: unknown): number {
    if (err instanceof MultipleAppsMatchError) {
        return 409; // ambiguous — caller must pick an appId
    }
    if (err instanceof HostAppNotRunningError) {
        return 503; // nothing to act on yet
    }
    if (err instanceof RequestTimeoutError) {
        return 504;
    }
    return 500;
}
