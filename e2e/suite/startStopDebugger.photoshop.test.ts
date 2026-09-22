/**
 * "Start/Stop UXP Debugger" command pair (`uxp.startDebugger`/
 * `uxp.stopDebugger`, see `UxpService.stopDiscovery`/`ensureStarted` and the
 * `stoppedByUser` `brokerState`).
 *
 * Does NOT require Photoshop to be running — the broker is a plain
 * HTTP/WS server; these tests only prove its own start/stop lifecycle and
 * `brokerState` bookkeeping. Still gated behind `UXP_E2E_PHOTOSHOP` like the
 * rest of the live suite, since it needs dev mode enabled and a real,
 * unshared broker port (same assumption `portInUse.photoshop.test.ts`
 * relies on for its decoy-server trick).
 */

import * as assert from "assert";
import * as http from "http";
import * as vscode from "vscode";
import { DEFAULT_BROKER_PORT } from "../../src/core/protocol/types";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import { activateExtension, describeLive, TIMEOUT_DEFAULT } from "./liveHelpers";

/** Resolves "bound" if `port` was free (and immediately releases it again), "in-use" otherwise. */
function probePort(port: number): Promise<"bound" | "in-use"> {
    return new Promise((resolve) => {
        const server = http.createServer();
        server.once("error", () => resolve("in-use"));
        server.listen(port, "127.0.0.1", () => server.close(() => resolve("bound")));
    });
}

describeLive("Start/Stop UXP Debugger (no Photoshop needed)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    beforeEach(async () => {
    // Each test starts from a known "running" baseline regardless of what
    // the previous test (or extension activation) left behind.
        await api.service.ensureStarted();
        assert.strictEqual(api.service.brokerState, "running", "expected the broker to be running before the test");
    });

    after(async () => {
    // Don't leave the suite in a stopped state for whatever runs next.
        await api.service.ensureStarted();
    });

    it("uxp.stopDebugger stops the broker, releases the port, and reports stoppedByUser", async () => {
        await vscode.commands.executeCommand("uxp.stopDebugger");

        assert.strictEqual(api.service.brokerState, "stoppedByUser");
        assert.strictEqual(
            await probePort(DEFAULT_BROKER_PORT),
            "bound",
            "expected the real broker to have released the port, not just flipped a flag",
        );
    });

    it("uxp.startDebugger restarts the broker after an explicit stop", async () => {
        await vscode.commands.executeCommand("uxp.stopDebugger");
        assert.strictEqual(api.service.brokerState, "stoppedByUser");

        await vscode.commands.executeCommand("uxp.startDebugger");

        assert.strictEqual(api.service.brokerState, "running");
        assert.strictEqual(
            await probePort(DEFAULT_BROKER_PORT),
            "in-use",
            "expected the broker to be bound to the port again",
        );
    });

    it("uxp.stopDebugger is idempotent once already stopped", async () => {
        await vscode.commands.executeCommand("uxp.stopDebugger");
        assert.strictEqual(api.service.brokerState, "stoppedByUser");

        await vscode.commands.executeCommand("uxp.stopDebugger");
        assert.strictEqual(api.service.brokerState, "stoppedByUser");
    });
});
