/**
 * POST /__uxp_debugger__/hooks/reload — "full reload" (Unload + Load), the
 * same operation as the panel's "Reload" button (`PanelController.reloadPlugin`)
 * composed from the same building blocks (service.unloadPlugin/loadPlugin,
 * `UxpInspectorPanel`, `debugManager`), just without the interactive
 * retry/QuickPick dialogs — ambiguous/failed loads are reported as REST
 * errors instead. If a debugger or the HTML inspector was attached to the
 * old session, both are restored on the new one (same as the panel).
 */

import * as path from "path";
import { requireStringField, optionalStringField, optionalBooleanField, type HookResult } from "./hooksHttp";
import { loadErrorStatus } from "./hookErrors";
import { describeLoadError } from "../tools/toolErrors";
import { UxpInspectorPanel } from "../inspector/UxpInspectorPanel";
import { openInspectorForSession } from "../commands/openHtmlInspector";
import type { HookDependencies } from "./hooksTypes";

export async function handleReload(
    input: Record<string, unknown>,
    deps: HookDependencies,
): Promise<HookResult> {
    const manifestPath = requireStringField(input, "manifestPath");
    const breakOnLoad = optionalBooleanField(input, "breakOnLoad");
    const appId = optionalStringField(input, "appId");

    await deps.service.ensureStarted();
    const sessions = deps.service.sessionsForManifest(manifestPath);
    const wasDebugging = sessions.some((s) => deps.debugManager.isAttached(s.clientSessionId));
    const wasInspectorOpen = sessions.some((s) => UxpInspectorPanel.isOpen(s.clientSessionId));
    const targetAppId = appId ?? sessions[0]?.app.appId;

    for (const session of sessions) {
        UxpInspectorPanel.disposeForSession(session.clientSessionId);
        await deps.service.unloadPlugin(session);
    }

    let result;
    try {
        result = await deps.service.loadPlugin(manifestPath, breakOnLoad, targetAppId);
    }
    catch (err) {
        return { status: loadErrorStatus(err), body: { ok: false, error: describeLoadError(err) } };
    }
    if (breakOnLoad) {
        deps.debugManager.markPendingBreakOnStart(result.sessions);
    }

    let restoredDebugging = false;
    let restoredInspector = false;
    const restored = result.sessions[0];
    // Keep this boundary guard in case a future service implementation returns an empty session list.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (restored) {
        if (wasDebugging) {
            restoredDebugging = await deps.debugManager.attach(restored, path.dirname(manifestPath));
        }
        if (wasInspectorOpen && !(breakOnLoad && !wasDebugging)) {
            // Break-on-start sessions have no execution context until a debugger
            // attaches — can't restore the inspector yet (same rule as the panel).
            await openInspectorForSession(restored, deps.service, deps.proxyRegistry, deps.context, deps.output);
            restoredInspector = true;
        }
    }

    return {
        status: 200,
        body: {
            ok: true,
            sessions: result.sessions.map((s) => s.clientSessionId),
            failures: result.failures.map((f) => ({ appId: f.app.info.appId, error: f.error.message })),
            restoredDebugging,
            restoredInspector,
        },
    };
}
