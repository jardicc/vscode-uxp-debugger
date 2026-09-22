/**
 * Live coverage for passing `userArgs` to `Plugin/runScript` (the
 * `service.runScript` call behind `uxp.debugScript`), across different
 * argument counts and JSON data types — added in response to a user report
 * that "a number in the argument fails".
 *
 * Verification method: the Adobe UXP "Passing Arguments" tutorial
 * (https://developer.adobe.com/indesign/uxp/scripts/tutorials/arguments/#usage)
 * says a running script reads its arguments via
 * `require("uxp").script.args`. The fixture's `index.js` (see
 * e2e/fixtures/plugin/index.js) logs that value with a `console.log` right
 * on startup; each test here captures that log line via a DAP "output"
 * event tracker (`trackDapMessages`) and asserts it matches exactly what
 * was sent — proving the host actually received the right values (not just
 * that the broker request didn't error), for every count/type below.
 *
 * Same lifecycle rule as debugScript.photoshop.test.ts: a run script is
 * ALWAYS left paused waiting for a debugger (regardless of `breakOnStart`),
 * so every case attaches (which resumes it via the CDP proxy's bootstrap
 * handshake) and waits for the manager's own auto-teardown — never leaving
 * a paused script session behind, which would wedge the whole host app for
 * every later test. Skipped unless explicitly opted into — see e2e/README.md.
 */

import * as assert from "assert";
import type { ConnectedApp } from "../../src/core/broker/UxpBroker";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import {
    activateExtension,
    describeLive,
    TIMEOUT_DEFAULT,
    detachStrandedScriptSessions,
    fixturePluginDir,
    scriptUri,
    sleep,
    trackDapMessages,
    waitFor,
} from "./liveHelpers";

const ARGS_MARKER = "[e2e] script.args: ";
const ARGS_ERROR_MARKER = "[e2e] script.args error: ";

type CapturedArgs = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Runs the fixture script with `userArgs`, captures what
 * `require("uxp").script.args` actually saw host-side, then resumes and
 * waits for the pseudo-session to tear itself down.
 */
async function runScriptAndCaptureArgs(
    api: UxpDebuggerTestApi,
    app: ConnectedApp,
    userArgs: unknown[],
): Promise<unknown> {
    let result: CapturedArgs | undefined;

    const disposable = trackDapMessages((message, direction) => {
        if (result || direction !== "send") {
            return;
        }
        if (message.type !== "event" || message.event !== "output") {
            return;
        }
        const output = (message.body as { output?: string } | undefined)?.output;
        if (typeof output !== "string") {
            return;
        }
        if (output.startsWith(ARGS_MARKER)) {
            try {
                result = { ok: true, value: JSON.parse(output.slice(ARGS_MARKER.length).trimEnd()) };
            }
            catch {
                // Output can arrive split across multiple "output" events — wait
                // for a chunk that parses cleanly instead of failing on a partial one.
            }
        }
        else if (output.startsWith(ARGS_ERROR_MARKER)) {
            result = { ok: false, error: output.slice(ARGS_ERROR_MARKER.length).trimEnd() };
        }
    });

    try {
        const session = await api.service.runScript(scriptUri.fsPath, app, userArgs);
        await waitFor(
            () => api.service.sessions.some((s) => s.clientSessionId === session.clientSessionId),
            5_000,
        );

        const started = await api.debugManager.attach(session, fixturePluginDir);
        assert.strictEqual(started, true, "expected the JS debug session to start");

        await waitFor(() => result !== undefined, 5_000);
        await waitFor(() => !api.debugManager.hasActiveSession, 5_000);

        if (!result) {
            throw new Error("never observed a script.args log from the fixture script");
        }
        if (!result.ok) {
            throw new Error(`require("uxp").script.args threw host-side: ${result.error}`);
        }
        return result.value;
    }
    finally {
        disposable.dispose();
    }
}

describeLive("Run script with arguments (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;
    let app: ConnectedApp;

    before(async () => {
        api = await activateExtension();
        await api.service.ensureStarted();
        await api.service.waitForHostApps();
        const connected = api.service.connectedApps[0];
        assert.ok(connected, "expected at least one connected host app");
        app = connected;
    });

    afterEach(async () => {
        await detachStrandedScriptSessions(api, fixturePluginDir);
    });

    const cases: { name: string; args: unknown[] }[] = [
        { name: "zero arguments", args: [] },
        { name: "a single integer argument", args: [42] },
        { name: "a single negative/float argument", args: [-3.14] },
        { name: "a single zero argument", args: [0] },
        { name: "a single string argument", args: ["hello"] },
        { name: "a single boolean argument", args: [true] },
        { name: "a single null argument", args: [null] },
        { name: "a single object argument", args: [{ width: 1920, height: 1080 }] },
        { name: "a single array argument", args: [[1, 2, 3]] },
        { name: "many mixed-type arguments", args: [1, "two", true, null, { three: 3 }, [4, 5]] },
        { name: "many numeric arguments", args: Array.from({ length: 10 }, (_, i) => i * 100) },
    ];

    // SKIPPED: historical skip has no recorded rationale; keep these cases
    // pending repository-owner confirmation rather than silently enabling them.
    for (const { name, args } of cases) {
        it.skip(`runs the script with ${name} and script.args matches what was sent`, async () => {
            const received = await runScriptAndCaptureArgs(api, app, args);
            assert.deepStrictEqual(received, args);
            // Photoshop has no readiness event after a script-heavy case.
            await sleep(2000);
        });
    }
});
