/**
 * LM tools' `HostAppNotRunningError` handling (LANGUAGE-MODEL-TOOLS.md §7.4) —
 * exercised with the real fixture manifest but WITHOUT any host app
 * connected. Deliberately written to require Photoshop to be OFF (or at
 * least not connected as "PS"): a guard assertion in each test fails fast
 * with a clear message if a connected app is unexpectedly found, so this
 * never silently passes/fails for the wrong reason.
 *
 * Run standalone with Photoshop closed, e.g.:
 *   $env:MOCHA_GREP = "host app not running"; npm run test:e2e:live
 *
 * Uses `api.tools.*` (the exact tool instances the running extension
 * registered) rather than constructing new ones from source — a second,
 * separately-bundled copy would carry its own `HostAppNotRunningError`
 * class, silently breaking the tool's `instanceof` check against the error
 * actually thrown by `api.service` (confirmed live 2026-08-21: fell through
 * to the generic fallback message instead of the intended one).
 */

import * as assert from "assert";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import {
    activateExtension,
    describeLive,
    invokeTool,
    manifestPath,
    TIMEOUT_DEFAULT,
    toolResultText,
    unloadAllSessions,
} from "./liveHelpers";

describeLive("LM tools: host app not running (no Photoshop needed)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
        await api.service.ensureStarted();
    });

    afterEach(async () => {
        await unloadAllSessions(api, manifestPath);
    });

    function assertNoAppConnected(): void {
        assert.strictEqual(
            api.service.connectedApps.length,
            0,
            "expected no connected host apps — this test requires Photoshop to be OFF (or disconnected)",
        );
    }

    // SKIPPED: requires Photoshop to be off; run this suite separately with
    // MOCHA_GREP="host app not running" as documented above.
    it.skip("uxp_load_plugin returns an actionable error instead of hanging", async () => {
        assertNoAppConnected();

        const result = await invokeTool(api.tools.loadPlugin, { manifestPath });

        const text = toolResultText(result);
        assert.match(text, /No connected app matches this plugin\. Required: PS\./);
        assert.match(text, /Start the app and retry\./);
    });

    // SKIPPED: same isolated, Photoshop-off requirement as the test above.
    it.skip("uxp_attach_debugger surfaces the same actionable error via its implicit-load path", async () => {
        assertNoAppConnected();

        const result = await invokeTool(api.tools.attachDebugger, { manifestPath });

        const text = toolResultText(result);
        assert.match(text, /No connected app matches this plugin\. Required: PS\./);
        assert.strictEqual(api.debugManager.hasActiveSession, false, "nothing should have attached");
    });

    it("uxp_launch_host_app rejects an unrecognized appId without launching anything", async () => {
    // Deliberately does NOT depend on `assertNoAppConnected()` — the
    // unrecognized-appId check happens before `service.launchHostApp` is
    // ever called, so this is safe to run regardless of whether Photoshop
    // happens to be connected.
        const result = await invokeTool(api.tools.launchHostApp, { appId: "NOT_A_REAL_APP_ID" });

        const text = toolResultText(result);
        assert.match(text, /"NOT_A_REAL_APP_ID" is not a recognized host app id/);
    });
});
