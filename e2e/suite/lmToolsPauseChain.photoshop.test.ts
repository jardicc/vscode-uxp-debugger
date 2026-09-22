/**
 * Full LM tool "pause chain" (LANGUAGE-MODEL-TOOLS.md §5.2/§5.3, §7.4): set a
 * breakpoint via `uxp_set_breakpoint`, load+attach with breakOnStart, then
 * drive `uxp_wait_for_pause` → `uxp_evaluate_in_frame` → `uxp_resume`
 * exactly as a model-driven tool call chain would, asserting on each tool's
 * real text/JSON output. None of these 4 tools had ANY e2e coverage before
 * this file — only manual ("Už to funguje") verification is recorded in
 * repo notes for the underlying pause-detection bugs (child-session
 * delegation, dropped stackTrace after `stopped`).
 *
 * Uses the `plugin-sourcemap` fixture (same one `sourceMapExternal.photoshop.test.ts`
 * already proves binds/hits reliably) rather than the plain `plugin` fixture's
 * very first statement — confirmed live (2026-08-22) that a breakpoint on a
 * breakOnStart entry script's LITERAL FIRST line can lose the race against
 * js-debug's source-map processing and never bind before the script runs to
 * completion (the instrumentation-breakpoint pause gets auto-resumed as
 * "spurious" before js-debug re-issues its predictive `setBreakpointByUrl`
 * for the just-parsed script). A line a couple of statements in gives that
 * processing enough of a window. Not a fix attempt here, just avoiding a
 * known-flaky setup for a test whose actual goal is the 4 LM tools.
 *
 * Requires Photoshop already running with developer mode enabled, same as
 * the rest of the `*.photoshop.test.ts` suite — this one genuinely needs a
 * real pause, unlike `startStopDebugger`/`hostAppNotRunning`.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import type { PluginSession } from "../../src/core/broker/SessionRegistry";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import type { PauseSnapshot } from "../../src/vscode/debug/pauseTracker";
import {
    activateExtension,
    attachAndAssertStarted,
    describeLive,
    TIMEOUT_DEFAULT,
    detachAndAssertStopped,
    fixturePluginSourcemapDir,
    invokeTool,
    manifestSourcemapPath,
    originalTsPath,
    stopActiveDebugSessionIfAny,
    toolResultText,
    unloadAllSessions,
} from "./liveHelpers";

/** `console.log(pluginSourcemapMarker);` in original.ts (1-based line, matches DAP's convention). */
const BREAKPOINT_LINE = 7;

describeLive("LM tools: set breakpoint -> wait_for_pause -> evaluate_in_frame -> resume (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
        await stopActiveDebugSessionIfAny(api);
        await unloadAllSessions(api, manifestSourcemapPath);
        await invokeTool(api.tools.removeBreakpoint, { filePath: originalTsPath, line: BREAKPOINT_LINE });
    });

    it("drives the full chain and hits the breakpoint via the actual LM tools", async () => {
        const setResult = await invokeTool(api.tools.setBreakpoint, {
            filePath: originalTsPath,
            line: BREAKPOINT_LINE,
        });
        assert.match(toolResultText(setResult), /Breakpoint set/);

        const loadResult = await api.service.loadPlugin(manifestSourcemapPath, /* breakOnStart */ true);
        assert.ok(loadResult.sessions.length > 0, "expected at least one loaded session");
        const session: PluginSession = loadResult.sessions[0];
        api.debugManager.markPendingBreakOnStart([session]);

        await attachAndAssertStarted(api, session, fixturePluginSourcemapDir);

        const waitResult = await invokeTool(api.tools.waitForPause, { timeoutMs: 15_000 });
        const snapshot = JSON.parse(toolResultText(waitResult)) as PauseSnapshot & { sessionId: string };
        assert.strictEqual(snapshot.sessionId, session.clientSessionId);
        assert.ok(snapshot.frames.length > 0, "expected at least one paused frame");
        const topFrame = snapshot.frames[0];
        assert.ok(topFrame.sourcePath, "expected the paused frame to carry a resolved source path");
        assert.strictEqual(
            vscode.Uri.file(topFrame.sourcePath).fsPath,
            vscode.Uri.file(originalTsPath).fsPath,
            "expected the pause to resolve back to original.ts, not the compiled original.js",
        );
        assert.strictEqual(topFrame.line, BREAKPOINT_LINE);

        const evalResult = await invokeTool(api.tools.evaluateInFrame, {
            expression: "1 + 1",
            frameId: topFrame.id,
        });
        const evaluated = JSON.parse(toolResultText(evalResult)) as { result?: string };
        assert.strictEqual(evaluated.result, "2", "uxp_evaluate_in_frame did not round-trip through the real CDP target");

        const resumeResult = await invokeTool(api.tools.resume, {});
        assert.match(toolResultText(resumeResult), /Resumed/);

        // A second uxp_resume with nothing paused must fail cleanly, not hang —
        // proves the pause snapshot was really cleared after the first resume.
        const secondResumeResult = await invokeTool(api.tools.resume, {});
        assert.match(toolResultText(secondResumeResult), /not currently paused/);

        const vsSession = vscode.debug.activeDebugSession;
        assert.ok(vsSession, "expected the debug session to still be active after resuming");
        await detachAndAssertStopped(api, vsSession);
    });
});
