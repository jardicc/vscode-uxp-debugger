/**
 * Live proof of the on-the-fly TypeScript stripping feature
 * (src/core/stripTypeScript.ts, wired into debugScript.ts's "Debug Script"
 * flow): a `.ts` script with NO checked-in compiled `.js` gets its types
 * erased in memory (Node/Deno/Bun-style `ts-blank-space` blank-space
 * erasure) and written to a throwaway temp `.js` with an inline identity
 * source map, then run via the normal `Plugin/runScript` flow. A breakpoint
 * set on the original `.ts` line must bind and actually get hit, with the
 * paused frame resolved back to `original.ts` — not the generated temp
 * `.js`.
 *
 * This test calls `stripTypeScriptFile()` directly (same as every other
 * live test bypasses the interactive QuickPick command layer) rather than
 * going through `uxp.debugScript` itself.
 *
 * Skipped unless explicitly opted into — see e2e/README.md.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { stripTypeScriptFile } from "../../src/core/stripTypeScript";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import {
    activateExtension,
    attachAndAssertStarted,
    describeLive,
    TIMEOUT_DEFAULT,
    detachStrandedScriptSessions,
    detachAndAssertStopped,
    fixtureScriptTypeScriptDir,
    scriptTypeScriptOriginalTsPath,
    stackTraceWithRetry,
    stopActiveDebugSessionIfAny,
    waitForBreakpointHit,
} from "./liveHelpers";

/** `console.log(liveStripMarker);` in original.ts (1-based line, matches DAP's convention). */
const BREAKPOINT_LINE = 7;

describeLive("On-the-fly TypeScript strip — script debugging (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
        await stopActiveDebugSessionIfAny(api);
        await detachStrandedScriptSessions(api, fixtureScriptTypeScriptDir);
    });

    it("strips a .ts script on the fly and hits a breakpoint set on its original source", async () => {
        const breakpoint = new vscode.SourceBreakpoint(
            new vscode.Location(
                vscode.Uri.file(scriptTypeScriptOriginalTsPath),
                new vscode.Position(BREAKPOINT_LINE - 1, 0),
            ),
        );
        vscode.debug.addBreakpoints([breakpoint]);

        const stripped = stripTypeScriptFile(scriptTypeScriptOriginalTsPath);

        try {
            await api.service.ensureStarted();
            await api.service.waitForHostApps();
            const app = api.service.connectedApps[0];
            assert.ok(app, "expected at least one connected host app");

            const hit = waitForBreakpointHit();
            const session = await api.service.runScript(stripped.jsPath, app, []);
            assert.strictEqual(session.kind, "script");

            const vsSession = await attachAndAssertStarted(api, session, fixtureScriptTypeScriptDir);

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
                vscode.Uri.file(scriptTypeScriptOriginalTsPath).fsPath,
                "expected the paused frame's source to resolve back to original.ts, not the generated "
                + "temp .js — the on-the-fly stripped identity source map was not correctly resolved",
            );
            assert.strictEqual(topFrame.line, BREAKPOINT_LINE);

            await detachAndAssertStopped(api, vsSession);
        }
        finally {
            vscode.debug.removeBreakpoints([breakpoint]);
            stripped.cleanup();
        }
    });
});
