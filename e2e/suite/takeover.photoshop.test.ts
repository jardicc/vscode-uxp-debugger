/**
 * Live "multi-window broker takeover" flow (MULTI-WINDOW-TAKEOVER.md):
 * two REAL, separate VS Code windows contend for the single broker on port
 * 14001, each holding its own live session in the same host app. Similar in
 * spirit to `multiAttach.photoshop.test.ts`, but instead of two concurrent
 * sessions in ONE window, each session lives in a DIFFERENT window — this
 * window (A, the mocha test runner itself) and a second, real Extension
 * Development Host process (B) spawned here, mirroring the "Run Extension
 * (Plugin 2)" compound in `.vscode/launch.json`.
 *
 * Window B's side of the flow lives in `takeoverWindowB.ts` (its
 * `--extensionTestsPath`), which loads `e2e/fixtures/plugin2`, auto-confirms
 * its own "Take Over" dialog, then stays alive until window A takes
 * ownership back.
 *
 * Regression coverage for the native Vulcan-adapter crash fixed 2026-07-30
 * (§5 of the plan doc): a SECOND takeover restart within the SAME window's
 * process (A owns → B takes over → A takes back) used to crash the whole
 * extension host natively. Two tests exercise this: a single A→B→A cycle,
 * and a multi-round-trip version (A→B→A repeated several times in the same
 * two processes) for stronger regression coverage against a reintroduction.
 *
 * Skipped unless explicitly opted into — see e2e/README.md.
 */

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { runTests } from "@vscode/test-electron";
import type { PluginSession } from "../../src/core/broker/SessionRegistry";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import {
    activateExtension,
    describeLive,
    TIMEOUT_DEFAULT,
    TIMEOUT_MULTI_WINDOW,
    fixturePlugin2Dir,
    manifest2Path,
    manifestPath,
    repoRoot,
    sleep,
    unloadAllSessions,
    waitFor,
} from "./liveHelpers";

async function loadSession(api: UxpDebuggerTestApi, forManifestPath: string): Promise<PluginSession> {
    const result = await api.service.loadPlugin(forManifestPath, /* breakOnStart */ false);
    assert.ok(result.sessions.length > 0, `expected at least one loaded session for ${forManifestPath}`);
    return result.sessions[0];
}

/**
 * Launches window B: a second, real Extension Development Host process
 * running this same extension, opened on `e2e/fixtures/plugin2` and driven
 * by `takeoverWindowB.js` instead of the normal mocha suite. Resolves with
 * its exit code once the window closes (0 = window B's `run()` succeeded).
 *
 * Two things are required to get a genuinely SEPARATE process/window rather
 * than VS Code silently forwarding to the already-running window A (which
 * looks like success — exit code 0 almost instantly — but never actually
 * runs `takeoverWindowB.ts` at all):
 *
 * 1. A UNIQUE `--user-data-dir`/`--extensions-dir` for window B. Plain
 *    `code <folder>` (which is all `runTests()` does under the hood) uses
 *    VS Code's normal single-instance IPC: a second invocation sharing the
 *    SAME user-data-dir just asks the ALREADY-RUNNING instance (window A,
 *    itself started the same way by `../runTest.ts`) to open the folder and
 *    exits immediately — it does NOT start a new process, so
 *    `--extensionTestsPath`/`--extensionDevelopmentPath` are silently
 *    ignored. `@vscode/test-electron` only sets these to a shared default
 *    (`.vscode-test/user-data`) when not already present in `launchArgs`.
 * 2. An explicit `cachePath` anchored at `repoRoot`. `downloadAndUnzipVSCode`
 *    resolves its default cache dir relative to `process.cwd()` — but a
 *    real VS Code process's cwd is ITS OWN install directory, not the repo
 *    root (this code runs *inside* window A's Extension Host). Without this,
 *    every nested `runTests()` call resolves to an ever-deeper bogus nested
 *    path under `.vscode-test/vscode-win32-x64-archive-<ver>/.vscode-test/...`.
 *
 * The trailing "." on `extensionDevelopmentPath` mirrors the same trick used
 * for "Run Extension (Plugin 2)" in `.vscode/launch.json` (VS Code refuses a
 * second Extension Development Host window whose `extensionDevelopmentPath`
 * string-matches an already-open one) — kept for parity even though the
 * unique profile dirs above are what actually forces a separate process here.
 *
 * 3. `ELECTRON_RUN_AS_NODE` must NOT be inherited by window B. This test
 *    runs *inside* window A's own Extension Host, which VS Code itself
 *    launched with `ELECTRON_RUN_AS_NODE=1` (so its Electron binary behaves
 *    as a plain Node host). `runTests()` blindly merges the CALLER's
 *    `process.env` into the spawned child's env, so window B's `Code.exe`
 *    would inherit that flag too — turning it into a bare Node process
 *    instead of a real VS Code GUI. That plain-Node process then just
 *    treats the first CLI arg (`fixturePlugin2Dir`) as a script/module path
 *    and runs `e2e/fixtures/plugin2/index.js` directly (explaining the
 *    stray "uxp-debugger e2e fixture plugin 2 loaded" line and the
 *    near-instant, misleadingly-clean exit code 0) — `extensionTestsPath`
 *    is never touched at all.
 *
 * `rounds` tells window B how many full "take over, then wait to be taken
 * back" cycles to run in its OWN process before exiting (see
 * `takeoverWindowB.ts`) — `readyMarkerPath` becomes `${readyMarkerPath}.<n>`
 * per round, and `windowAReadyMarkerPath` (same convention) is how window A
 * signals back that ITS retake for round `n` has actually settled, before
 * window B starts round `n+1`'s acquire — without this, window B could race
 * ahead and yank the connection out from under window A's in-flight retake.
 */
function spawnTakeoverWindowB(
    readyMarkerPath: string,
    windowAReadyMarkerPath: string,
    rounds: number,
): Promise<number> {
    const profileDir = path.join(os.tmpdir(), `uxp-e2e-windowB-${Date.now()}`);
    const savedElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
    delete process.env.ELECTRON_RUN_AS_NODE;
    const restoreEnv = () => {
        if (savedElectronRunAsNode !== undefined) {
            process.env.ELECTRON_RUN_AS_NODE = savedElectronRunAsNode;
        }
    };
    const promise = runTests({
        cachePath: path.join(repoRoot, ".vscode-test"),
        extensionDevelopmentPath: repoRoot + path.sep + ".",
        extensionTestsPath: path.resolve(__dirname, "./takeoverWindowB"),
        extensionTestsEnv: {
            UXP_E2E_PHOTOSHOP: "1",
            UXP_E2E_WINDOWB_READY_MARKER: readyMarkerPath,
            UXP_E2E_WINDOWA_READY_MARKER: windowAReadyMarkerPath,
            UXP_E2E_TAKEOVER_ROUNDS: String(rounds),
        },
        launchArgs: [
            fixturePlugin2Dir,
            "--disable-extensions",
            `--user-data-dir=${path.join(profileDir, "user-data")}`,
            `--extensions-dir=${path.join(profileDir, "extensions")}`,
        ],
    });
    promise.then(restoreEnv, restoreEnv);
    return promise;
}

describeLive("Multi-window broker takeover (live Photoshop)", function () {
    this.timeout(TIMEOUT_MULTI_WINDOW);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
        await unloadAllSessions(api, manifestPath);
        await unloadAllSessions(api, manifest2Path);
    });

    // Auto-confirms this window's own "Take Over" dialog (the live UI would
    // show `takeoverConfirmDialog` here) for the duration of `fn`, then
    // restores the original `showWarningMessage`.
    async function withAutoConfirmedTakeover<T>(fn: () => Promise<T>): Promise<T> {
        const target = vscode.window as unknown as { showWarningMessage: unknown };
        const originalWarning = target.showWarningMessage;
        // eslint-disable-next-line @typescript-eslint/require-await
        target.showWarningMessage = async (message: string) => {
            console.log(`[windowA] showWarningMessage: ${message}`);
            return "Take Over";
        };
        try {
            return await fn();
        }
        finally {
            target.showWarningMessage = originalWarning;
        }
    }

    // Waits for window B to take broker ownership away from us (our own
    // plugin1 session torn down), then for window B's per-round ready marker —
    // proving its `loadPlugin(manifest2Path)` call actually resolved and
    // asserted successfully, not just that its takeover *request* succeeded.
    // Racing ahead to retake ownership before this yanks the host-app
    // connection out from under window B's in-flight loadPlugin, failing it
    // with HostAppNotRunningError.
    async function waitForWindowBTakeover(roundLabel: string, markerPath: string): Promise<void> {
        let pollCount = 0;
        await waitFor(() => {
            const count = api.service.sessionsForManifest(manifestPath).length;
            if (pollCount++ % 8 === 0) {
                console.log(`[windowA] ${roundLabel}: waiting for takeover... sessionsForManifest(plugin1)=${count}`);
            }
            return count === 0;
        }, 60_000);
        console.log(`[windowA] ${roundLabel}: our session was torn down — taken over by window B`);
        try {
            await waitFor(() => fs.existsSync(markerPath), TIMEOUT_DEFAULT);
            console.log(`[windowA] ${roundLabel}: window B signaled it finished loading plugin2`);
        }
        finally {
            fs.rmSync(markerPath, { force: true });
        }
    }

    // Drives `rounds` full "A owns → B takes over → A takes back" cycles, all
    // within this SAME window A process and the SAME spawned window B process
    // — the more rounds, the more broker restarts (and native Vulcan-adapter
    // singleton reuse) each process has survived by the end.
    async function runTakeoverCycle(rounds: number): Promise<void> {
        // No readiness event exists after the prior Photoshop-heavy test.
        await sleep(1000);
        await loadSession(api, manifestPath);
        assert.strictEqual(api.service.sessionsForManifest(manifestPath).length, 1);
        console.log("[windowA] plugin1 loaded, broker owned by this window");

        const readyMarkerPath = path.join(os.tmpdir(), `uxp-e2e-windowB-ready-${Date.now()}.marker`);
        const windowAReadyMarkerPath = path.join(os.tmpdir(), `uxp-e2e-windowA-ready-${Date.now()}.marker`);
        console.log(`[windowA] spawning window B for ${rounds} round(s)...`);
        const windowB = spawnTakeoverWindowB(readyMarkerPath, windowAReadyMarkerPath, rounds);
        windowB.then(
            (code) => console.log(`[windowA] window B process exited with code ${code}`),
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            (err: unknown) => console.log(`[windowA] window B process failed: ${err}`),
        );

        for (let round = 1; round <= rounds; round++) {
            const roundLabel = `round ${round}/${rounds}`;
            await waitForWindowBTakeover(roundLabel, `${readyMarkerPath}.${round}`);
            await withAutoConfirmedTakeover(async () => {
                console.log(`[windowA] ${roundLabel}: taking broker ownership back from window B...`);
                await loadSession(api, manifestPath);
            });
            console.log(`[windowA] ${roundLabel}: took ownership back, plugin1 reloaded`);
            assert.strictEqual(api.service.sessionsForManifest(manifestPath).length, 1);

            // Signal window B that THIS round's retake has settled — window B
            // must not start round `round + 1`'s acquire before this, or it can
            // yank the connection out from under our still-in-flight loadPlugin.
            fs.writeFileSync(`${windowAReadyMarkerPath}.${round}`, "ready");
        }

        // Window B should have released the broker cleanly every round and
        // exited with a successful (0) exit code once all rounds completed.
        await windowB;
    }

    it("a second window takes over broker ownership, then the first window takes it back", async () => {
        await runTakeoverCycle(1);
    });

    // Regression coverage for the native Vulcan-adapter crash fixed 2026-07-30
    // (MULTI-WINDOW-TAKEOVER.md §5): it specifically only reproduced on
    // the SECOND (or later) broker restart within one window's process, so a
    // single A→B→A cycle isn't enough to guard against a reintroduction —
    // this repeats the cycle several times in both processes.
    it("survives multiple takeover round-trips without crashing", async () => {
        await runTakeoverCycle(3);
    });
});
