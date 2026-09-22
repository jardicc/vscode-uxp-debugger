/**
 * Live reload flow: load the fixture plugin, reload it, and confirm the
 * broker-side bookkeeping survives — same `clientSessionId` (some hosts hand
 * back a fresh host session id on reload; `UxpBroker.reloadPlugin` re-binds
 * it transparently, see src/core/broker/UxpBroker.ts) and exactly one
 * session still tracked for the manifest. Skipped unless explicitly opted
 * into — see e2e/README.md.
 */

import * as assert from "assert";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import { activateExtension, describeLive, manifestPath, TIMEOUT_DEFAULT, unloadAllSessions } from "./liveHelpers";

describeLive("Reload plugin (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
        await unloadAllSessions(api, manifestPath);
    });

    it("reloads the fixture plugin and keeps the same client session id", async () => {
        const loadResult = await api.service.loadPlugin(manifestPath);
        assert.ok(loadResult.sessions.length > 0, "expected at least one loaded session");
        const session = loadResult.sessions[0];

        await api.service.reloadPlugin(session);

        const sessionsAfterReload = api.service.sessionsForManifest(manifestPath);
        assert.strictEqual(
            sessionsAfterReload.length,
            loadResult.sessions.length,
            "expected the same number of sessions to remain after reload",
        );
        assert.ok(
            sessionsAfterReload.some((s) => s.clientSessionId === session.clientSessionId),
            "expected the reloaded session to keep its stable client session id",
        );
    });
});
