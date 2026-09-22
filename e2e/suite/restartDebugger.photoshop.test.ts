/**
 * Live "restart the debugger" flow: attach normally, then trigger VS Code's
 * built-in debug-toolbar "Restart" (`workbench.action.debug.restart`)
 * instead of a manual detach+re-attach. This is a distinct code path from
 * `attachDebugger.photoshop.test.ts`'s "re-attach after detach" case — a
 * restart terminates the existing `pwa-node` session and asks js-debug to
 * start a new one *using the exact same resolved debug configuration*
 * (including the CDP proxy's port), WITHOUT going through
 * `UxpDebugSessionManager.attach()` again. If the manager's
 * `onDidTerminateDebugSession` handler has already torn down the CDP proxy
 * (and cleared `this.active`) by the time the new session tries to connect,
 * the restart fails to reconnect — reported live by the user as "problems"
 * restarting the debugger. Skipped unless explicitly opted into — see
 * e2e/README.md.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import {
    activateExtension,
    assertCanEvaluate,
    attachAndAssertStarted,
    describeLive,
    TIMEOUT_DEFAULT,
    detachAndAssertStopped,
    manifestPath,
    stopActiveDebugSessionIfAny,
    unloadAllSessions,
    waitFor,
} from "./liveHelpers";

describeLive("Restart debugger (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
        await stopActiveDebugSessionIfAny(api);
        await unloadAllSessions(api, manifestPath);
    });

    it("recovers after workbench.action.debug.restart", async () => {
        const loadResult = await api.service.loadPlugin(manifestPath, /* breakOnStart */ false);
        assert.ok(loadResult.sessions.length > 0, "expected at least one loaded session");
        const session = loadResult.sessions[0];

        await attachAndAssertStarted(api, session);

        // Trigger VS Code's own "Restart" (debug toolbar / F5-while-attached),
        // the same command a user invokes — NOT a manual detach+attach through
        // our extension's code.
        await vscode.commands.executeCommand("workbench.action.debug.restart");

        // A restart terminates the old session and starts a new one; wait for
        // that churn to settle rather than assuming the old session reference
        // stays valid.
        await waitFor(() => vscode.debug.activeDebugSession !== undefined, 10_000);
        const restartedVsSession = vscode.debug.activeDebugSession;
        assert.ok(restartedVsSession, "expected a new active debug session after restart");

        assert.strictEqual(
            api.debugManager.hasActiveSession,
            true,
            "expected the debug manager to still consider a session active after restart",
        );

        // `hasActiveSession` only proves VS Code's bookkeeping survived — confirm
        // the CDP proxy is actually forwarding to the real UXP target again by
        // round-tripping a real evaluate through it.
        await assertCanEvaluate(restartedVsSession);

        await detachAndAssertStopped(api, restartedVsSession);
    });

    it("recovers after restarting twice in a row", async () => {
        const loadResult = await api.service.loadPlugin(manifestPath, /* breakOnStart */ false);
        const session = loadResult.sessions[0];

        await attachAndAssertStarted(api, session);

        for (let i = 0; i < 2; i++) {
            await vscode.commands.executeCommand("workbench.action.debug.restart");
            await waitFor(() => vscode.debug.activeDebugSession !== undefined, 10_000);
        }

        assert.strictEqual(
            api.debugManager.hasActiveSession,
            true,
            "expected the debug manager to still consider a session active after two restarts",
        );

        // Same real round-trip check as the single-restart case, above.
        await assertCanEvaluate(vscode.debug.activeDebugSession!);

        await detachAndAssertStopped(api, vscode.debug.activeDebugSession!);
    });

    it("recovers after restarting a breakOnStart session", async () => {
        const loadResult = await api.service.loadPlugin(manifestPath, /* breakOnStart */ true);
        const session = loadResult.sessions[0];
        api.debugManager.markPendingBreakOnStart([session]);

        await attachAndAssertStarted(api, session);

        await vscode.commands.executeCommand("workbench.action.debug.restart");
        await waitFor(() => vscode.debug.activeDebugSession !== undefined, 10_000);

        assert.strictEqual(
            api.debugManager.hasActiveSession,
            true,
            "expected the debug manager to still consider a session active after restart",
        );

        // Same real round-trip check — confirms the proxy re-armed correctly
        // for a restarted breakOnStart session too.
        await assertCanEvaluate(vscode.debug.activeDebugSession!);

        await detachAndAssertStopped(api, vscode.debug.activeDebugSession!);
    });
});
