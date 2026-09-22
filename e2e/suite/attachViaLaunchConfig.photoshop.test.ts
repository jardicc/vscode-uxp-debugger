/**
 * Live "F5 / launch.json" attach flow: unlike `attachDebugger.photoshop.
 * test.ts` (which calls `UxpDebugSessionManager.attach()` directly), this
 * test drives the attach the way a real user does — pressing F5 with a
 * `"uxp"` launch.json configuration — via `vscode.debug.startDebugging()`.
 * That routes through the full config-provider wiring:
 * `UxpDebugConfigProvider.resolveDebugConfigurationWithSubstitutedVariables`
 * (src/vscode/debug/debugConfigProvider.ts) executes the `uxp.attachDebugger`
 * command and then cancels the original "uxp" session (returns `undefined`),
 * since the real session is the delegated `pwa-node` one the command starts
 * via `UxpDebugSessionManager.attach`. Regression coverage for that
 * delegation path itself (config → command → manager), which the other
 * attach tests never exercise since they call the manager directly.
 *
 * Also confirms the resulting session can actually evaluate an expression
 * end-to-end (VS Code → js-debug → CdpProxyServer → the real UXP target) via
 * `assertCanEvaluate` — proves the F5 path isn't just "connected" but
 * genuinely forwarding CDP traffic. Skipped unless explicitly opted into —
 * see e2e/README.md.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import {
    activateExtension,
    assertCanEvaluate,
    describeLive,
    TIMEOUT_DEFAULT,
    manifestPath,
    stopActiveDebugSessionIfAny,
    unloadAllSessions,
    waitFor,
} from "./liveHelpers";

describeLive("Attach via F5 / launch.json config (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
        await stopActiveDebugSessionIfAny(api);
        await unloadAllSessions(api, manifestPath);
    });

    it("attaches through a \"uxp\" launch.json configuration and can evaluate expressions", async () => {
    // Pre-load the plugin so `attachDebuggerCommand` finds a live session
    // and skips its "no live session yet — Load and attach?" dialog: that
    // dialog flow is a separate concern, not what this test targets.
        const loadResult = await api.service.loadPlugin(manifestPath, /* breakOnStart */ false);
        assert.ok(loadResult.sessions.length > 0, "expected at least one loaded session");

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, "expected the fixture plugin folder to be open as a workspace");

        // Same shape as a hand-written launch.json entry (see the
        // "UXP: Attach to Plugin" configurationSnippet in package.json) — this
        // is exactly what F5 resolves and hands to VS Code.
        const startResult = await vscode.debug.startDebugging(workspaceFolder, {
            type: "uxp",
            request: "attach",
            name: "Attach to UXP Plugin (e2e)",
            manifestPath,
        });
        // `startDebugging`'s own return value reflects the *original* "uxp"
        // session, which `UxpDebugConfigProvider` deliberately cancels (returns
        // `undefined` from `resolveDebugConfigurationWithSubstitutedVariables`)
        // after delegating to `uxp.attachDebugger` — so `false` here is the
        // expected outcome even when the delegated attach succeeds. Wait for the
        // real (delegated) session instead of trusting this return value.
        assert.strictEqual(startResult, false);

        await waitFor(() => api.debugManager.hasActiveSession, 10_000);
        await waitFor(() => vscode.debug.activeDebugSession !== undefined, 5_000);
        const vsSession = vscode.debug.activeDebugSession;
        assert.ok(vsSession, "expected an active vscode debug session");
        assert.strictEqual(vsSession.type, "pwa-node");

        await assertCanEvaluate(vsSession);

        await vscode.debug.stopDebugging(vsSession);
        await waitFor(() => !api.debugManager.hasActiveSession, 5_000);
    });
});
