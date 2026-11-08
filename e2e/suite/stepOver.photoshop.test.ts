/**
 * Live regression test for stepping after a break-on-load stop: with a
 * breakpoint on the entry script's FIRST statement and "break on load", the
 * debugger must stop there and then actually step (`next`) to the following
 * line — not leave js-debug with disabled step buttons.
 *
 * Skipped unless explicitly opted into — see e2e/README.md.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import type { PluginSession } from "../../src/core/broker/SessionRegistry";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import {
    activateExtension,
    attachAndAssertStarted,
    describeLive,
    detachAndAssertStopped,
    fixturePluginSourcemapDir,
    manifestSourcemapPath,
    originalTsPath,
    sleep,
    stackTraceWithRetry,
    stopActiveDebugSessionIfAny,
    TIMEOUT_DEFAULT,
    trackDapMessages,
    unloadAllSessions,
    waitFor,
} from "./liveHelpers";

/** First executable statement of original.ts (1-based). */
const FIRST_STATEMENT_LINE = 5;

interface StopEvent {
    reason: string;
    threadId: number;
}

describeLive("Step over after break on load (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
    });

    afterEach(async () => {
        await stopActiveDebugSessionIfAny(api);
        await unloadAllSessions(api, manifestSourcemapPath);
    });

    it("steps to the next line from a breakpoint on the first statement", async () => {
        const breakpoint = new vscode.SourceBreakpoint(
            new vscode.Location(
                vscode.Uri.file(originalTsPath),
                new vscode.Position(FIRST_STATEMENT_LINE - 1, 0),
            ),
        );
        vscode.debug.addBreakpoints([breakpoint]);

        const stops: StopEvent[] = [];
        let continuedCount = 0;
        const tracker = trackDapMessages((message, direction) => {
            if (direction !== "send" || message.type !== "event") {
                return;
            }
            if (message.event === "stopped") {
                const body = message.body as { reason: string; threadId: number };
                stops.push({ reason: body.reason, threadId: body.threadId });
            }
            else if (message.event === "continued") {
                continuedCount++;
            }
        });

        try {
            const loadResult = await api.service.loadPlugin(manifestSourcemapPath, /* breakOnStart */ true);
            const session: PluginSession = loadResult.sessions[0];
            api.debugManager.markPendingBreakOnStart([session]);
            await attachAndAssertStarted(api, session, fixturePluginSourcemapDir);

            await waitFor(() => stops.length > 0, 15_000);
            // Let any follow-up pause (e.g. startup pause + breakpoint) settle.
            await sleep(2_000);
            console.log(`[e2e] stops before stepping: ${JSON.stringify(stops)} continued=${String(continuedCount)}`);

            await waitFor(() => {
                const dap = api.debugManager.getDapSession(session.clientSessionId);
                return dap !== undefined && dap !== api.debugManager.getVsSession(session.clientSessionId);
            }, 10_000);
            const dap = api.debugManager.getDapSession(session.clientSessionId)!;

            const last = stops[stops.length - 1];
            const before = await stackTraceWithRetry(dap, last.threadId);
            console.log(`[e2e] paused at line ${String(before.stackFrames[0]?.line)}`);

            const stopsBeforeStep = stops.length;
            await dap.customRequest("next", { threadId: last.threadId });
            await waitFor(() => stops.length > stopsBeforeStep, 5_000);

            const stepStop = stops[stops.length - 1];
            console.log(`[e2e] stop after next: ${JSON.stringify(stepStop)}`);
            const after = await stackTraceWithRetry(dap, stepStop.threadId);
            assert.ok(
                (after.stackFrames[0]?.line ?? 0) > FIRST_STATEMENT_LINE,
                `expected to step past line ${String(FIRST_STATEMENT_LINE)}, `
                + `got line ${String(after.stackFrames[0]?.line)}`,
            );

            const vsSession = api.debugManager.getVsSession(session.clientSessionId);
            assert.ok(vsSession);
            await detachAndAssertStopped(api, vsSession);
        }
        finally {
            tracker.dispose();
            vscode.debug.removeBreakpoints([breakpoint]);
        }
    });
});
