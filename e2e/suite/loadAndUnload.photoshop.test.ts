/**
 * Simplest possible live test against a REAL, already-running Photoshop
 * (dev mode enabled, this extension able to bind broker port 14001):
 * load the fixture plugin, then unload it, and confirm the session
 * bookkeeping reflects both. Skipped unless explicitly opted into — see
 * e2e/README.md.
 *
 * Enable with (PowerShell):
 *   $env:UXP_E2E_PHOTOSHOP = "1"; npm run test:e2e
 *
 * Debugger-attach flows (breakOnStart, DAP `stopped` events, breakpoints,
 * ...) belong in their own `*.photoshop.test.ts` files built on top of the
 * shared helpers in `liveHelpers.ts`, so a failure in one flow doesn't mask
 * the others.
 */

import * as assert from "assert";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import { activateExtension, describeLive, manifestPath, TIMEOUT_DEFAULT, unloadAllSessions } from "./liveHelpers";

describeLive("Load/unload plugin (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
    // Best-effort cleanup so a failed assertion doesn't leave the plugin
    // loaded for the next run.
        await unloadAllSessions(api, manifestPath);
    });

    it("loads the fixture plugin and unloads it again", async () => {
        const loadResult = await api.service.loadPlugin(manifestPath);
        assert.ok(loadResult.sessions.length > 0, "expected at least one loaded session");
        console.log(`[e2e] loaded ${loadResult.sessions.length} session(s)`);

        assert.strictEqual(
            api.service.sessionsForManifest(manifestPath).length,
            loadResult.sessions.length,
            "expected sessionsForManifest to reflect the just-loaded session(s)",
        );

        for (const session of loadResult.sessions) {
            await api.service.unloadPlugin(session);
        }

        assert.strictEqual(
            api.service.sessionsForManifest(manifestPath).length,
            0,
            "expected no sessions to remain after unload",
        );
    });
});
