/**
 * Live "replace an active session" flow: `UxpDebugSessionManager.attach`
 * shows a modal warning ("A UXP debug session is already active") before
 * swapping out an already-attached session for a new attach request. An
 * automated test can't click a real native modal, so these tests
 * temporarily stub `vscode.window.showWarningMessage` to answer as if the
 * user had clicked "Detach and reconnect" (confirm) or dismissed the dialog
 * (decline), restoring the original implementation afterwards either way.
 * Skipped unless explicitly opted into — see e2e/README.md.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import {
    activateExtension,
    attachAndAssertStarted,
    describeLive,
    TIMEOUT_DEFAULT,
    fixturePluginDir,
    manifestPath,
    stopActiveDebugSessionIfAny,
    unloadAllSessions,
    waitFor,
} from "./liveHelpers";

/**
 * Temporarily replaces `vscode.window.showWarningMessage` so the "replace
 * active session?" modal auto-answers without a real user click. Returns a
 * function that restores the original implementation — always call it in a
 * `finally` block.
 */
function stubShowWarningMessage(answer: string | undefined): () => void {
    const target = vscode.window as unknown as { showWarningMessage: unknown };
    const original = target.showWarningMessage;
    // Disabled for compatibility with original
    // eslint-disable-next-line @typescript-eslint/require-await
    target.showWarningMessage = async () => answer;
    return () => {
        target.showWarningMessage = original;
    };
}

describeLive("Replace an active debug session (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
        await stopActiveDebugSessionIfAny(api);
        await unloadAllSessions(api, manifestPath);
    });

    it("keeps the active session when the user dismisses the prompt", async () => {
        const loadResult = await api.service.loadPlugin(manifestPath, /* breakOnStart */ false);
        const session = loadResult.sessions[0];
        const firstVsSession = await attachAndAssertStarted(api, session);

        const restore = stubShowWarningMessage(undefined); // simulate dismissing the modal
        try {
            const started = await api.debugManager.attach(session, fixturePluginDir);
            assert.strictEqual(started, false, "expected the replace attempt to be declined");
        }
        finally {
            restore();
        }

        assert.strictEqual(api.debugManager.hasActiveSession, true);
        assert.strictEqual(vscode.debug.activeDebugSession, firstVsSession);
    });

    it("detaches the previous session and re-attaches when the user confirms", async () => {
        const loadResult = await api.service.loadPlugin(manifestPath, /* breakOnStart */ false);
        const session = loadResult.sessions[0];
        await attachAndAssertStarted(api, session);

        const restore = stubShowWarningMessage("Detach and reconnect");
        try {
            const started = await api.debugManager.attach(session, fixturePluginDir);
            assert.strictEqual(started, true, "expected the replace attempt to succeed");
        }
        finally {
            restore();
        }

        assert.strictEqual(api.debugManager.hasActiveSession, true);
        await waitFor(() => vscode.debug.activeDebugSession !== undefined, 5_000);
        assert.ok(vscode.debug.activeDebugSession, "expected a new active debug session");
    });
});
