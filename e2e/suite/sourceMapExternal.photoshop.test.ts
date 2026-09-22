/**
 * Live proof that an *external* `//# sourceMappingURL=original.js.map`
 * reference (as opposed to the other fixtures' inline `data:` maps) gets
 * resolved correctly: a breakpoint set on the pre-bundle `original.ts` line
 * must actually bind and get hit, with the paused stack frame pointing back
 * at `original.ts` — not the compiled `original.js`. Exercises
 * `resolveExternalSourceMap` (src/vscode/proxy/sourceMapRewriter.ts).
 *
 * Relies on the same breakOnStart + `pauseForSourceMap` mechanism documented
 * in BREAK-ON-START.md: it's the only currently-working way to get a
 * breakpoint bound against a UXP script at all — js-debug's *predictive*
 * (pre-`scriptParsed`) breakpoint binding doesn't work yet against UXP's
 * relative script URLs (see attachDebugger.photoshop.test.ts). Skipped
 * unless explicitly opted into — see e2e/README.md.
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
    fixturePluginSourcemapDir,
    manifestSourcemapPath,
    originalTsPath,
    stackTraceWithRetry,
    stopActiveDebugSessionIfAny,
    unloadAllSessions,
    waitForBreakpointHit,
} from "./liveHelpers";

/** `console.log(marker);` in original.ts (1-based line, matches DAP's convention). */
const BREAKPOINT_LINE = 7;

describeLive("External source map (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
        await stopActiveDebugSessionIfAny(api);
        await unloadAllSessions(api, manifestSourcemapPath);
    });

    it("binds and hits a breakpoint set on the pre-bundle source of an externally-sourcemapped script", async () => {
        const breakpoint = new vscode.SourceBreakpoint(
            new vscode.Location(vscode.Uri.file(originalTsPath), new vscode.Position(BREAKPOINT_LINE - 1, 0)),
        );
        vscode.debug.addBreakpoints([breakpoint]);

        try {
            const loadResult = await api.service.loadPlugin(manifestSourcemapPath, /* breakOnStart */ true);
            assert.ok(loadResult.sessions.length > 0, "expected at least one loaded session");
            const session: PluginSession = loadResult.sessions[0];
            api.debugManager.markPendingBreakOnStart([session]);

            const hit = waitForBreakpointHit();
            const vsSession = await attachAndAssertStarted(api, session, fixturePluginSourcemapDir);

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
                vscode.Uri.file(originalTsPath).fsPath,
                "expected the paused frame's source to resolve back to original.ts, not the compiled "
                + "original.js — the external source map was not correctly resolved",
            );
            assert.strictEqual(topFrame.line, BREAKPOINT_LINE);

            await detachAndAssertStopped(api, vsSession);
        }
        finally {
            vscode.debug.removeBreakpoints([breakpoint]);
        }
    });
});
