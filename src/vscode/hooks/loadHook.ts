/**
 * POST /__uxp_debugger__/hooks/load — load the plugin into a connected app
 * (validate → load). Same underlying call as `uxp_load_plugin` (LM tool)
 * and the interactive Load command, just without any dialogs: ambiguous
 * `appId`/no matching app are reported as REST errors instead of prompting.
 */

import { requireStringField, optionalStringField, optionalBooleanField, type HookResult } from "./hooksHttp";
import { loadErrorStatus } from "./hookErrors";
import { describeLoadError } from "../tools/toolErrors";
import type { HookDependencies } from "./hooksTypes";

export async function handleLoad(
    input: Record<string, unknown>,
    deps: HookDependencies,
): Promise<HookResult> {
    const manifestPath = requireStringField(input, "manifestPath");
    const breakOnLoad = optionalBooleanField(input, "breakOnLoad");
    const appId = optionalStringField(input, "appId");

    try {
        await deps.service.ensureStarted();
        const result = await deps.service.loadPlugin(manifestPath, breakOnLoad, appId);
        if (breakOnLoad) {
            deps.debugManager.markPendingBreakOnStart(result.sessions);
        }
        return {
            status: 200,
            body: {
                ok: true,
                sessions: result.sessions.map((s) => s.clientSessionId),
                failures: result.failures.map((f) => ({ appId: f.app.info.appId, error: f.error.message })),
            },
        };
    }
    catch (err) {
        return { status: loadErrorStatus(err), body: { ok: false, error: describeLoadError(err) } };
    }
}
