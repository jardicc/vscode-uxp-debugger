/**
 * Live "multiple concurrent debug attaches" flow: load two DIFFERENT
 * plugins (distinct manifests/pluginIds, `e2e/fixtures/plugin` +
 * `e2e/fixtures/plugin2`) into the same host app and attach the JS debugger
 * to both at once. Regression/feature coverage for `UxpDebugSessionManager`
 * tracking attachments per `clientSessionId` (a `Map`) instead of a single
 * global slot — previously a second `attach()` call always showed "A UXP
 * debug session is already active" and replaced the first one.
 *
 * False-positive guard: each fixture's `index.js` stamps a distinct
 * `globalThis.__uxpFixtureId` marker. Merely asserting `hasActiveSession` /
 * `activeSessionCount` would still pass if both proxies were secretly wired
 * to the same underlying CDP connection (e.g. a stale map key bug) — so
 * every test here also round-trips a real `evaluate` through each session
 * and cross-checks it against the OTHER fixture's marker, which would fail
 * if the two sessions were not truly independent.
 *
 * Skipped unless explicitly opted into — see e2e/README.md.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import type { PluginSession } from "../../src/core/broker/SessionRegistry";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import {
    activateExtension,
    assertCanEvaluate,
    describeLive,
    TIMEOUT_MULTI_SESSION,
    fixturePlugin2Dir,
    manifest2Path,
    manifestPath,
    unloadAllSessions,
    waitFor,
} from "./liveHelpers";

async function loadSession(api: UxpDebuggerTestApi, forManifestPath: string): Promise<PluginSession> {
    const result = await api.service.loadPlugin(forManifestPath, /* breakOnStart */ false);
    assert.ok(result.sessions.length > 0, `expected at least one loaded session for ${forManifestPath}`);
    return result.sessions[0];
}

/**
 * Attaches through the real "uxp" launch.json delegation path (same as
 * `attachViaLaunchConfig.photoshop.test.ts`) rather than calling
 * `debugManager.attach()` directly. Each manifest here has exactly one
 * live session, so `pickSession` auto-selects without a prompt.
 *
 * Returns the js-debug CHILD session for the attached target, not the
 * parent `pwa-node` session that `debugManager.getVsSession()` tracks:
 * js-debug only registers DAP request handlers (evaluate etc.) on the
 * per-target child session — sending `evaluate` to the parent makes
 * js-debug log "Unknown request: evaluate" and never reply at all, which
 * is exactly why this suite previously timed out even with a single
 * session attached. (`attachViaLaunchConfig` never hit this because
 * `vscode.debug.activeDebugSession` already points at the child; with two
 * concurrent attaches "active" is ambiguous, so we resolve each child via
 * its `parentSession` link instead.)
 */
async function attachAndGetOwnSession(
    api: UxpDebuggerTestApi,
    session: PluginSession,
    forManifestPath: string,
): Promise<vscode.DebugSession> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, "expected the fixture plugin folder to be open as a workspace");

    const startedSessions: vscode.DebugSession[] = [];
    const tracker = vscode.debug.onDidStartDebugSession((s) => startedSessions.push(s));
    try {
        const startResult = await vscode.debug.startDebugging(workspaceFolder, {
            type: "uxp",
            request: "attach",
            name: `Attach to UXP Plugin (e2e ${session.name})`,
            manifestPath: forManifestPath,
        });
        // Expected: `UxpDebugConfigProvider` cancels this outer "uxp" session
        // after delegating to the real `pwa-node` one — see attachViaLaunchConfig.
        assert.strictEqual(startResult, false);

        await waitFor(
            () => api.debugManager.getVsSession(session.clientSessionId) !== undefined,
            10_000,
        );
        const tracked = api.debugManager.getVsSession(session.clientSessionId);
        assert.ok(tracked, `expected a vscode debug session for "${session.name}"`);

        // Walk up to the root in case the manager tracked a nested session, then
        // wait for a descendant (js-debug's per-target child) to appear.
        let root = tracked;
        while (root.parentSession) {
            root = root.parentSession;
        }
        const isDescendantOfRoot = (s: vscode.DebugSession): boolean => {
            for (let p = s.parentSession; p; p = p.parentSession) {
                if (p.id === root.id) {
                    return true;
                }
            }
            return false;
        };
        const findChild = () => startedSessions.find(isDescendantOfRoot);
        await waitFor(() => findChild() !== undefined, 10_000);
        return findChild()!;
    }
    finally {
        tracker.dispose();
    }
}

/** Best-effort stop of every debug session tracked for `session`. */
async function stopIfAttached(api: UxpDebuggerTestApi, session: PluginSession): Promise<void> {
    const vsSession = api.debugManager.getVsSession(session.clientSessionId);
    if (vsSession) {
        await Promise.resolve(vscode.debug.stopDebugging(vsSession)).catch(() => undefined);
    }
}

describeLive("Multiple concurrent debug attaches (live Photoshop)", function () {
    this.timeout(TIMEOUT_MULTI_SESSION);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
    // Best-effort: stop any debug sessions still tracked for either fixture
    // before unloading, so a failed assertion never leaves something paused.
        for (const forManifestPath of [manifestPath, manifest2Path]) {
            for (const session of api.service.sessionsForManifest(forManifestPath)) {
                await stopIfAttached(api, session);
            }
        }
        await unloadAllSessions(api, manifestPath);
        await unloadAllSessions(api, manifest2Path);
    });

    it("attaches to two different plugins at once and both stay independently live", async () => {
        const sessionA = await loadSession(api, manifestPath);
        const vsA = await attachAndGetOwnSession(api, sessionA, manifestPath);
        await assertCanEvaluate(vsA, "globalThis.__uxpFixtureId === \"plugin-one\"", "true");

        const sessionB = await loadSession(api, manifest2Path);
        const vsB = await attachAndGetOwnSession(api, sessionB, manifest2Path);

        assert.notStrictEqual(vsA.id, vsB.id, "expected two distinct vscode debug sessions");
        assert.strictEqual(api.debugManager.activeSessionCount, 2);
        assert.ok(api.debugManager.isAttached(sessionA.clientSessionId));
        assert.ok(api.debugManager.isAttached(sessionB.clientSessionId));

        // Prove these are two independent CDP targets, not the same one twice:
        // each session must see its OWN marker and NOT the other fixture's.
        await assertCanEvaluate(vsA, "globalThis.__uxpFixtureId === \"plugin-one\"", "true");
        await assertCanEvaluate(vsA, "globalThis.__uxpFixtureId === \"plugin-two\"", "false");
        await assertCanEvaluate(vsB, "globalThis.__uxpFixtureId === \"plugin-two\"", "true");
        await assertCanEvaluate(vsB, "globalThis.__uxpFixtureId === \"plugin-one\"", "false");
    });

    it("does not prompt to replace when attaching a second, different session", async () => {
        const sessionA = await loadSession(api, manifestPath);
        const sessionB = await loadSession(api, manifest2Path);

        await attachAndGetOwnSession(api, sessionA, manifestPath);

        const target = vscode.window as unknown as { showWarningMessage: unknown };
        const original = target.showWarningMessage;
        let warningShown = false;
        // eslint-disable-next-line @typescript-eslint/require-await
        target.showWarningMessage = async () => {
            warningShown = true;
            return undefined;
        };
        let started: boolean;
        try {
            started = await api.debugManager.attach(sessionB, fixturePlugin2Dir);
        }
        finally {
            target.showWarningMessage = original;
        }

        assert.strictEqual(
            warningShown,
            false,
            "did not expect the 'replace active session' confirmation dialog for a different session",
        );
        assert.strictEqual(started, true, "expected attaching a different session to succeed directly");
        assert.strictEqual(api.debugManager.activeSessionCount, 2);
    });

    it("detaching one session leaves the other attached and working", async () => {
        const sessionA = await loadSession(api, manifestPath);
        const sessionB = await loadSession(api, manifest2Path);

        const vsA = await attachAndGetOwnSession(api, sessionA, manifestPath);
        const vsB = await attachAndGetOwnSession(api, sessionB, manifest2Path);

        await vscode.debug.stopDebugging(vsA);
        await waitFor(() => !api.debugManager.isAttached(sessionA.clientSessionId), 5_000);

        assert.strictEqual(api.debugManager.activeSessionCount, 1);
        assert.ok(
            api.debugManager.isAttached(sessionB.clientSessionId),
            "expected session B to remain attached after detaching session A",
        );
        // Confirm session B's proxy is still genuinely forwarding, not just
        // that VS Code's bookkeeping happens to say so.
        await assertCanEvaluate(vsB, "globalThis.__uxpFixtureId === \"plugin-two\"", "true");
    });

    it("unloading one plugin host-side stops only that session's debugger", async () => {
        const sessionA = await loadSession(api, manifestPath);
        const sessionB = await loadSession(api, manifest2Path);

        await attachAndGetOwnSession(api, sessionA, manifestPath);
        const vsB = await attachAndGetOwnSession(api, sessionB, manifest2Path);

        await api.service.unloadPlugin(sessionA);

        await waitFor(() => !api.debugManager.isAttached(sessionA.clientSessionId), 5_000);
        assert.strictEqual(api.debugManager.activeSessionCount, 1);
        assert.ok(
            api.debugManager.isAttached(sessionB.clientSessionId),
            "expected session B to remain attached after session A was unloaded host-side",
        );
        await assertCanEvaluate(vsB, "globalThis.__uxpFixtureId === \"plugin-two\"", "true");
    });
});
