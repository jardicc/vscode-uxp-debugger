/**
 * Regression coverage for the "load plugin again after closing UDT gets
 * stuck" bug fixed 2026-07-30: `portInUseDialog` must be *modal* (blocking
 * all other interaction), not a dismissible notification. `ensureStarted()`
 * awaits it from inside its single shared `starting` promise, so a
 * non-modal dialog let a second "Load Plugin" click silently join that same
 * still-pending promise instead of retrying — appearing to hang forever
 * until the original, easy-to-forget notification was finally answered.
 *
 * Can't drive a real Adobe UDT process here, so a plain HTTP server bound
 * to port 14001 plays the "foreign occupant" role instead (same shape as
 * the already-verified `test/broker/identify.test.ts` "unrelated HTTP
 * server" case) — `probeBrokerIdentity` correctly can't identify it as our
 * own broker, so the exact same `portInUseDialog` path fires as it would
 * for real UDT.
 */

import * as assert from "assert";
import * as http from "http";
import * as vscode from "vscode";
import { DEFAULT_BROKER_PORT } from "../../src/core/protocol/types";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import { activateExtension, describeLive, manifestPath, TIMEOUT_DEFAULT, unloadAllSessions } from "./liveHelpers";

/** Binds a plain HTTP server on `port` to simulate something else squatting on it. */
function occupyPort(port: number): Promise<http.Server> {
    return new Promise((resolve, reject) => {
        const server = http.createServer((_req, res) => {
            res.writeHead(404);
            res.end("Cannot GET");
        });
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve(server));
    });
}

function closeServer(server: http.Server): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()));
}

describeLive("Port-in-use recovery (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
        await unloadAllSessions(api, manifestPath);
    });

    it("shows a modal dialog and recovers via Retry once the occupying process (UDT) is closed", async () => {
    // An earlier test in this run may already have our own broker bound to
    // the port — free it first so the decoy server below can take it.
        await api.service.stopBrokerForTest();
        const decoy = await occupyPort(DEFAULT_BROKER_PORT);

        const target = vscode.window as unknown as {
            showErrorMessage: (...args: unknown[]) => unknown;
        };
        const original = target.showErrorMessage;
        let dialogOptions: { modal?: boolean } | undefined;
        target.showErrorMessage = async (...args: unknown[]) => {
            const [, options, ...items] = args as [string, unknown, ...string[]];
            dialogOptions = options as { modal?: boolean };
            // Simulate the user closing Adobe UDT, then clicking "Retry".
            await closeServer(decoy);
            return items[0];
        };

        try {
            const result = await api.service.loadPlugin(manifestPath, /* breakOnStart */ false);
            assert.ok(result.sessions.length > 0, "expected the plugin to load once the port was free");
        }
        finally {
            target.showErrorMessage = original;
        }

        assert.strictEqual(
            dialogOptions?.modal,
            true,
            "expected the port-in-use dialog to be modal (UxpService.ensureStarted awaits it from "
            + "inside its single shared `starting` promise — non-modal let a stale dialog get lost)",
        );
    });
});
