/**
 * Live proof that "debug active-editor script" (`Plugin/runScript`, driven
 * by `service.runScript` — same call `uxp.debugScript` makes) resolves an
 * *external* `//# sourceMappingURL=original.js.map` reference correctly,
 * the same way plugin loads already do (sourceMapExternal.photoshop.test.ts).
 *
 * SUSPECTED RACE this test exists to catch: unlike `Plugin/load
 * {breakOnStart:true}`, `debugScript.ts` never called
 * `markPendingBreakOnStart`, so the CDP proxy never armed the
 * `beforeScriptWithSourceMapExecution` instrumentation breakpoint and
 * js-debug's config never got `pauseForSourceMap:true` for script sessions —
 * even though UXP always pauses `runScript` sessions on start too
 * (unconditionally, same as breakOnStart). Without that pause, js-debug has
 * no guaranteed window to read/process the external `.map` file and bind
 * breakpoints before the (very short) script races through to completion —
 * the source map could "arrive" only after everything already ran. FIXED in
 * `UxpDebugSessionManager.attach()`: `session.kind === "script"` now always
 * triggers the same sourcemap-pause handling as `breakOnStart`.
 *
 * Skipped unless explicitly opted into — see e2e/README.md.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import {
    activateExtension,
    attachAndAssertStarted,
    describeLive,
    TIMEOUT_DEFAULT,
    detachStrandedScriptSessions,
    detachAndAssertStopped,
    fixtureScriptSourcemapDir,
    scriptOriginalJsPath,
    scriptOriginalTsPath,
    stackTraceWithRetry,
    stopActiveDebugSessionIfAny,
    waitForBreakpointHit,
} from "./liveHelpers";

/** `console.log(marker);` in original.ts (1-based line, matches DAP's convention). */
const BREAKPOINT_LINE = 9;

describeLive("External source map — script debugging (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
        await stopActiveDebugSessionIfAny(api);
        await detachStrandedScriptSessions(api, fixtureScriptSourcemapDir);
    });

    it("binds and hits a breakpoint set on the pre-bundle source of an externally-sourcemapped script run via Plugin/runScript", async () => {
        const breakpoint = new vscode.SourceBreakpoint(
            new vscode.Location(vscode.Uri.file(scriptOriginalTsPath), new vscode.Position(BREAKPOINT_LINE - 1, 0)),
        );
        vscode.debug.addBreakpoints([breakpoint]);

        try {
            await api.service.ensureStarted();
            await api.service.waitForHostApps();
            const app = api.service.connectedApps[0];
            assert.ok(app, "expected at least one connected host app");

            const hit = waitForBreakpointHit();
            const session = await api.service.runScript(scriptOriginalJsPath, app, []);
            assert.strictEqual(session.kind, "script");

            const vsSession = await attachAndAssertStarted(api, session, fixtureScriptSourcemapDir);

            let threadId: number;
            try {
                threadId = await hit;
            }
            finally {
                hit.dispose();
            }

            const stackTrace = await stackTraceWithRetry(vsSession, threadId);
            const topFrame = stackTrace.stackFrames[0];

            assert.ok(topFrame.source?.path, "expected the paused frame to carry a resolved source path");
            assert.strictEqual(
                vscode.Uri.file(topFrame.source.path).fsPath,
                vscode.Uri.file(scriptOriginalTsPath).fsPath,
                "expected the paused frame's source to resolve back to original.ts, not the compiled "
                + "original.js — the external source map was not correctly resolved (or wasn't ready in "
                + "time before the script ran past the breakpoint)",
            );
            assert.strictEqual(topFrame.line, BREAKPOINT_LINE);

            await detachAndAssertStopped(api, vsSession);
        }
        finally {
            vscode.debug.removeBreakpoints([breakpoint]);
        }
    });
});
