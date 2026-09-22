/**
 * Live "debug active-editor script" flow: run the fixture's `index.js` as a
 * standalone script (UDT 2.x `Plugin/runScript`) directly through
 * `UxpService.runScript`, the same call `debugScriptCommand` makes once it
 * has resolved the active editor file and a target app — bypassing the
 * active-editor/QuickPick wiring so the flow can be driven headlessly.
 * Confirms a script pseudo-session is registered, then attaches and lets it
 * tear down.
 *
 * IMPORTANT: UXP always pauses a freshly run script waiting for a debugger,
 * *regardless* of `breakOnStart` (that's a UXP behaviour, not something this
 * extension requests) — only attaching resumes it via the CDP proxy's
 * bootstrap handshake. A script session that's never attached to (or
 * unloaded) stays paused forever, which makes the *entire* host app appear
 * busy/modal to every subsequent broker request — confirmed live: leaving
 * this out made every later test in the suite time out on `Plugin/load`.
 *
 * NOTE: the fixture's `index.js` just logs a line and returns, so once
 * attaching resumes it, the script (and its pseudo-session) finishes almost
 * immediately on its own — racing an explicit `detachAndAssertStopped` call
 * (confirmed live: `vscode.debug.activeDebugSession` can already be
 * `undefined` again by the time we'd check for it). So this only asserts
 * `attach()` started the session, then waits for `UxpDebugSessionManager`'s
 * own auto-teardown (`onSessionEnded`, same mechanism covered by
 * `attachDebugger.photoshop.test.ts`'s "unloaded host-side" case) to clear
 * `hasActiveSession` — no manual detach needed or expected.
 * Skipped unless explicitly opted into — see e2e/README.md.
 */

import * as assert from "assert";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import {
    activateExtension,
    describeLive,
    TIMEOUT_DEFAULT,
    detachStrandedScriptSessions,
    fixturePluginDir,
    scriptUri,
    stopActiveDebugSessionIfAny,
    waitFor,
} from "./liveHelpers";

describeLive("Run script (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
        await stopActiveDebugSessionIfAny(api);
        await detachStrandedScriptSessions(api, fixturePluginDir);
    });

    it("runs index.js as a script, attaches, and tears down on its own", async () => {
        await api.service.ensureStarted();
        await api.service.waitForHostApps();
        const app = api.service.connectedApps[0];
        assert.ok(app, "expected at least one connected host app");

        const session = await api.service.runScript(scriptUri.fsPath, app, []);
        assert.strictEqual(session.kind, "script");
        assert.strictEqual(session.name, "index.js");

        await waitFor(
            () => api.service.sessions.some((s) => s.clientSessionId === session.clientSessionId),
            5_000,
        );

        // Resume the script (paused waiting for a debugger, see module doc
        // above). Don't assert on `vscode.debug.activeDebugSession` staying set
        // afterwards — the script finishes almost immediately and may already
        // be gone by the time we'd check.
        const started = await api.debugManager.attach(session, fixturePluginDir);
        assert.strictEqual(started, true, "expected the JS debug session to start");

        // The script runs to completion on its own; wait for the manager's
        // auto-teardown to clear the active session rather than detaching
        // manually.
        await waitFor(() => !api.debugManager.hasActiveSession, 5_000);
        assert.strictEqual(api.debugManager.hasActiveSession, false);
    });
});
