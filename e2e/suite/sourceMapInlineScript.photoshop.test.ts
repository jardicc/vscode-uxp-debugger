/**
 * Live proof that an *inline* (`data:` URL) source map — the other fixtures'
 * external `.map` file, embedded instead — resolves correctly for the
 * `Plugin/runScript` ("debug active-editor script") flow too, exercising
 * `rewriteInlineSourceMapRoot` (src/vscode/proxy/sourceMapRewriter.ts) via
 * the same `pauseForSourceMap` mechanism verified for external maps in
 * sourceMapExternalScript.photoshop.test.ts (see that file's doc comment
 * for the background bug/fix this all depends on).
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
    fixtureScriptSourcemapInlineDir,
    scriptInlineOriginalJsPath,
    scriptInlineOriginalTsPath,
    stackTraceWithRetry,
    stopActiveDebugSessionIfAny,
    waitForBreakpointHit,
} from "./liveHelpers";

/** `console.log(scriptInlineSourcemapMarker);` in original.ts (1-based line, matches DAP's convention). */
const BREAKPOINT_LINE = 9;

describeLive("Inline source map — script debugging (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
        await stopActiveDebugSessionIfAny(api);
        await detachStrandedScriptSessions(api, fixtureScriptSourcemapInlineDir);
    });

    it("binds and hits a breakpoint set on the pre-bundle source of an inline-sourcemapped script run via Plugin/runScript", async () => {
        const breakpoint = new vscode.SourceBreakpoint(
            new vscode.Location(
                vscode.Uri.file(scriptInlineOriginalTsPath),
                new vscode.Position(BREAKPOINT_LINE - 1, 0),
            ),
        );
        vscode.debug.addBreakpoints([breakpoint]);

        try {
            await api.service.ensureStarted();
            await api.service.waitForHostApps();
            const app = api.service.connectedApps[0];
            assert.ok(app, "expected at least one connected host app");

            const hit = waitForBreakpointHit();
            const session = await api.service.runScript(scriptInlineOriginalJsPath, app, []);
            assert.strictEqual(session.kind, "script");

            const vsSession = await attachAndAssertStarted(api, session, fixtureScriptSourcemapInlineDir);

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
                vscode.Uri.file(scriptInlineOriginalTsPath).fsPath,
                "expected the paused frame's source to resolve back to original.ts, not the compiled "
                + "original.js — the inline source map was not correctly resolved (or wasn't ready in "
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
