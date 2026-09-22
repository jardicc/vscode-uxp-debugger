/**
 * Live proof that an *inline* (`data:` URL) source map — the other fixture's
 * external `//# sourceMappingURL=original.js.map` file, embedded instead —
 * resolves correctly for the `Plugin/load` flow: a breakpoint set on the
 * pre-bundle `original.ts` line must actually bind and get hit, with the
 * paused stack frame pointing back at `original.ts` — not the compiled
 * `original.js`. Exercises `rewriteInlineSourceMapRoot`
 * (src/vscode/proxy/sourceMapRewriter.ts).
 *
 * Counterpart to sourceMapExternal.photoshop.test.ts — see that file's doc
 * comment for the breakOnStart + `pauseForSourceMap` mechanism this relies
 * on. Skipped unless explicitly opted into — see e2e/README.md.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import type { PluginSession } from "../../src/core/broker/SessionRegistry";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import {
    activateExtension,
    attachAndAssertStarted,
    describeLive,
    TIMEOUT_DEFAULT,
    detachAndAssertStopped,
    fixturePluginSourcemapInlineDir,
    manifestSourcemapInlinePath,
    originalInlineTsPath,
    stackTraceWithRetry,
    stopActiveDebugSessionIfAny,
    unloadAllSessions,
    waitForBreakpointHit,
} from "./liveHelpers";

/** `console.log(pluginInlineSourcemapMarker);` in original.ts (1-based line, matches DAP's convention). */
const BREAKPOINT_LINE = 9;

describeLive("Inline source map (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
        await stopActiveDebugSessionIfAny(api);
        await unloadAllSessions(api, manifestSourcemapInlinePath);
    });

    it("binds and hits a breakpoint set on the pre-bundle source of an inline-sourcemapped script", async () => {
        const breakpoint = new vscode.SourceBreakpoint(
            new vscode.Location(vscode.Uri.file(originalInlineTsPath), new vscode.Position(BREAKPOINT_LINE - 1, 0)),
        );
        vscode.debug.addBreakpoints([breakpoint]);

        try {
            const loadResult = await api.service.loadPlugin(manifestSourcemapInlinePath, /* breakOnStart */ true);
            assert.ok(loadResult.sessions.length > 0, "expected at least one loaded session");
            const session: PluginSession = loadResult.sessions[0];
            api.debugManager.markPendingBreakOnStart([session]);

            const hit = waitForBreakpointHit();
            const vsSession = await attachAndAssertStarted(api, session, fixturePluginSourcemapInlineDir);

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
                vscode.Uri.file(originalInlineTsPath).fsPath,
                "expected the paused frame's source to resolve back to original.ts, not the compiled "
                + "original.js — the inline source map was not correctly resolved",
            );
            assert.strictEqual(topFrame.line, BREAKPOINT_LINE);

            await detachAndAssertStopped(api, vsSession);
        }
        finally {
            vscode.debug.removeBreakpoints([breakpoint]);
        }
    });
});
