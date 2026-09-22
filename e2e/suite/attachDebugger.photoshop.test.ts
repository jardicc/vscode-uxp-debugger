/**
 * Live attach/detach flow: load the fixture plugin (with or without
 * `breakOnStart`), attach the JS debugger through `UxpDebugSessionManager`
 * (the same path driven by the control panel / `uxp.attachDebugger` command),
 * confirm the debug session actually starts
 * and the "waiting for debugger" bookkeeping clears, then detach and confirm
 * teardown. Regression coverage for the `autoAttachChildProcesses: false`
 * fix (see repo memory / project notes) — a prior version of this attach
 * flow crashed a real, already-running Photoshop outright.
 *
 * Does NOT assert on breakpoints or `stopped` DAP events — js-debug's
 * disk-path breakpoint prediction doesn't match UXP's relative script URLs
 * yet (see BREAK-ON-START.md). Skipped unless explicitly opted into —
 * see e2e/README.md.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import type { PluginSession } from "../../src/core/broker/SessionRegistry";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import {
    activateExtension,
    attachAndAssertStarted,
    describeLive,
    TIMEOUT_DEFAULT,
    detachAndAssertStopped,
    manifestPath,
    stopActiveDebugSessionIfAny,
    unloadAllSessions,
    waitFor,
} from "./liveHelpers";

/** Loads the fixture plugin, marking it pending-break-on-start when relevant. */
async function loadPluginSession(
    api: UxpDebuggerTestApi,
    breakOnStart: boolean,
): Promise<PluginSession> {
    const loadResult = await api.service.loadPlugin(manifestPath, breakOnStart);
    assert.ok(loadResult.sessions.length > 0, "expected at least one loaded session");
    const session = loadResult.sessions[0];
    if (breakOnStart) {
        api.debugManager.markPendingBreakOnStart([session]);
    }
    return session;
}

describeLive("Attach/detach debugger (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
        await stopActiveDebugSessionIfAny(api);
        await unloadAllSessions(api, manifestPath);
    });

    it("attaches to a breakOnStart session and detaches cleanly", async () => {
        const session = await loadPluginSession(api, /* breakOnStart */ true);
        const vsSession = await attachAndAssertStarted(api, session);
        await detachAndAssertStopped(api, vsSession);
    });

    it("attaches to an already-running (non-breakOnStart) session and detaches cleanly", async () => {
        const session = await loadPluginSession(api, /* breakOnStart */ false);
        const vsSession = await attachAndAssertStarted(api, session);
        await detachAndAssertStopped(api, vsSession);
    });

    it("re-attaches to the same session after detaching (debug, detach, debug again)", async () => {
        const session = await loadPluginSession(api, /* breakOnStart */ false);

        const firstVsSession = await attachAndAssertStarted(api, session);
        await detachAndAssertStopped(api, firstVsSession);

        const secondVsSession = await attachAndAssertStarted(api, session);
        await detachAndAssertStopped(api, secondVsSession);
    });

    it("stops the debug session automatically when the plugin is unloaded host-side", async () => {
        const session = await loadPluginSession(api, /* breakOnStart */ false);
        await attachAndAssertStarted(api, session);

        // Unload while the debugger is still attached — UxpDebugSessionManager
        // listens for `service.onSessionEnded` and tears the debug session down
        // on its own, without anyone calling `stopDebugging` directly.
        await api.service.unloadPlugin(session);

        await waitFor(() => !api.debugManager.hasActiveSession, 5_000);
        assert.strictEqual(api.debugManager.hasActiveSession, false);
        await waitFor(() => vscode.debug.activeDebugSession === undefined, 5_000);
    });
});
