/**
 * LM tool disambiguation when MULTIPLE sessions are attached at once
 * (`resolveAttachedSessionId` in `toolSessionResolution.ts`) — combines
 * `multiAttach.photoshop.test.ts`'s two-different-plugins setup with the
 * actual Tier 1/2 LM tools, which had no e2e coverage for the "which
 * session?" ambiguity path before this file: every one of
 * `uxp_evaluate_global`/`uxp_get_console_output`/`uxp_wait_for_pause`/
 * `uxp_resume` must refuse to guess and ask for an explicit `sessionId`
 * instead of silently acting on the wrong plugin.
 *
 * Same marker-based independence proof as `multiAttach.photoshop.test.ts`
 * (`globalThis.__uxpFixtureId`), but round-tripped through `uxp_evaluate_global`
 * itself instead of a raw DAP `evaluate` — proves the disambiguated
 * `sessionId` really reaches the right target, not just that the tool
 * accepted the input.
 *
 * Requires Photoshop already running with developer mode enabled.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import type { PluginSession } from "../../src/core/broker/SessionRegistry";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import {
    activateExtension,
    describeLive,
    TIMEOUT_MULTI_SESSION,
    fixturePlugin2Dir,
    fixturePluginDir,
    invokeTool,
    manifest2Path,
    manifestPath,
    toolResultText,
    POLL_INTERVAL,
    unloadAllSessions,
} from "./liveHelpers";

async function loadAndAttach(
    api: UxpDebuggerTestApi,
    forManifestPath: string,
    sourceRootDir: string,
): Promise<PluginSession> {
    const result = await api.service.loadPlugin(forManifestPath, /* breakOnStart */ false);
    assert.ok(result.sessions.length > 0, `expected at least one loaded session for ${forManifestPath}`);
    const session = result.sessions[0];
    const started = await api.debugManager.attach(session, sourceRootDir);
    assert.strictEqual(started, true, `expected the debugger to attach for ${forManifestPath}`);
    return session;
}

/**
 * Extracts the CDP RemoteObject's `.value` from a `uxp_evaluate_global` result.
 * The tool JSON-stringifies the raw CDP `Runtime.evaluate` envelope, not just the RemoteObject.
 */
function evaluatedValue(result: vscode.LanguageModelToolResult): unknown {
    return (JSON.parse(toolResultText(result)) as { result: { value: unknown } }).result.value;
}

/**
 * A just-attached session's CDP target may not have reported
 * `Runtime.executionContextCreated` yet — `uxp_evaluate_global` then
 * replies with "No execution context yet for this session" instead of
 * hanging (see `evaluateInGlobalContext`). Even after the context exists,
 * the plugin entry script may not have set its marker yet, so retry until
 * the expected value is observable.
 */
async function evaluateGlobalWithRetry(
    api: UxpDebuggerTestApi,
    expression: string,
    sessionId: string,
    expectedValue: unknown,
    timeoutMs = 10_000,
): Promise<unknown> {
    const start = Date.now();
    let lastValue: unknown;
    for (;;) {
        const result = await invokeTool(api.tools.evaluateGlobal, { expression, sessionId });
        const text = toolResultText(result);
        if (!text.includes("No execution context yet")) {
            lastValue = evaluatedValue(result);
            if (Object.is(lastValue, expectedValue)) {
                return lastValue;
            }
        }
        if (Date.now() - start > timeoutMs) {
            throw new Error(
                `Timed out (${timeoutMs}ms) waiting for ${JSON.stringify(expectedValue)} on session `
                + `"${sessionId}"; last value: ${JSON.stringify(lastValue)}`,
            );
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
}

describeLive("LM tools: disambiguation with multiple attached sessions (live Photoshop)", function () {
    this.timeout(TIMEOUT_MULTI_SESSION);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
        for (const forManifestPath of [manifestPath, manifest2Path]) {
            for (const session of api.service.sessionsForManifest(forManifestPath)) {
                const vsSession = api.debugManager.getVsSession(session.clientSessionId);
                if (vsSession) {
                    await Promise.resolve(vscode.debug.stopDebugging(vsSession)).catch(() => undefined);
                }
            }
        }
        await unloadAllSessions(api, manifestPath);
        await unloadAllSessions(api, manifest2Path);
        await api.pluginRegistry.removePlugin(manifestPath);
        await api.pluginRegistry.removePlugin(manifest2Path);
    });

    it("refuses to guess and asks for sessionId when 2 sessions are attached, then disambiguates correctly", async () => {
    // uxp_get_debug_state only lists manifests registered in the panel.
        await api.pluginRegistry.addPlugin(manifestPath);
        await api.pluginRegistry.addPlugin(manifest2Path);

        const sessionA = await loadAndAttach(api, manifestPath, fixturePluginDir);
        const sessionB = await loadAndAttach(api, manifest2Path, fixturePlugin2Dir);
        assert.strictEqual(api.debugManager.activeSessionCount, 2);

        // Every Tier 1/2 tool that resolves a single session must refuse to
        // guess instead of silently acting on whichever session happens first.
        for (const [label, invoke] of [
            ["uxp_evaluate_global", () => invokeTool(api.tools.evaluateGlobal, { expression: "1 + 1" })],
            ["uxp_get_console_output", () => invokeTool(api.tools.getConsoleOutput, {})],
            ["uxp_wait_for_pause", () => invokeTool(api.tools.waitForPause, { timeoutMs: 1_000 })],
            ["uxp_resume", () => invokeTool(api.tools.resume, {})],
        ] as const) {
            const result = await invoke();
            const text = toolResultText(result);
            assert.match(text, /Multiple debug sessions are attached/, `${label} did not refuse to guess`);
            assert.match(text, /Specify "sessionId"/, `${label}'s error did not mention "sessionId"`);
            assert.match(text, new RegExp(sessionA.clientSessionId), `${label}'s error did not list session A's id`);
            assert.match(text, new RegExp(sessionB.clientSessionId), `${label}'s error did not list session B's id`);
        }

        // uxp_get_debug_state never disambiguates — it's how the model is
        // expected to learn which sessionId belongs to which plugin.
        const stateText = toolResultText(await invokeTool(api.tools.getDebugState, {}));
        const state = JSON.parse(stateText) as { plugins: { sessions: { clientSessionId: string }[] }[] };
        const allSessionIds = state.plugins.flatMap((p) => p.sessions.map((s) => s.clientSessionId));
        assert.ok(allSessionIds.includes(sessionA.clientSessionId));
        assert.ok(allSessionIds.includes(sessionB.clientSessionId));

        // With an explicit sessionId, each call must reach its OWN target only —
        // not just "some" attached session (would still pass with a stale/shared
        // CDP connection bug, same false-positive concern as multiAttach).
        assert.strictEqual(
            await evaluateGlobalWithRetry(
                api,
                "globalThis.__uxpFixtureId === \"plugin-one\"",
                sessionA.clientSessionId,
                true,
            ),
            true,
        );
        assert.strictEqual(
            await evaluateGlobalWithRetry(
                api,
                "globalThis.__uxpFixtureId === \"plugin-two\"",
                sessionA.clientSessionId,
                false,
            ),
            false,
        );
        assert.strictEqual(
            await evaluateGlobalWithRetry(
                api,
                "globalThis.__uxpFixtureId === \"plugin-two\"",
                sessionB.clientSessionId,
                true,
            ),
            true,
        );
        assert.strictEqual(
            await evaluateGlobalWithRetry(
                api,
                "globalThis.__uxpFixtureId === \"plugin-one\"",
                sessionB.clientSessionId,
                false,
            ),
            false,
        );
    });

    it("rejects an unknown explicit sessionId instead of silently falling back", async () => {
        await loadAndAttach(api, manifestPath, fixturePluginDir);

        const result = await invokeTool(api.tools.evaluateGlobal, {
            expression: "1 + 1",
            sessionId: "not-a-real-session-id",
        });
        assert.match(toolResultText(result), /No attached debug session with id "not-a-real-session-id"/);
    });
});
