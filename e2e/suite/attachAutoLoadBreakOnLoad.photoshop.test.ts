/**
 * Live proof that the plugin's Debug action (`uxp.attachDebugger`) respects
 * the "Break on load" checkbox when it has to load the plugin first.
 *
 * With the plugin NOT loaded yet:
 * - checkbox on  → the plugin is loaded paused (`breakOnStart`), so a
 *   breakpoint on its startup code binds and gets hit once the debugger attaches.
 * - checkbox off → the plugin is loaded normally and runs past its startup
 *   code before the debugger attaches, so that breakpoint is never hit.
 *
 * Uses `e2e/fixtures/plugin-sourcemap` (breakpoint on `original.ts`, same
 * mechanism as sourceMapExternal.photoshop.test.ts). Skipped unless
 * explicitly opted into — see e2e/README.md.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import {
    activateExtension,
    assertCanEvaluate,
    describeLive,
    TIMEOUT_DEFAULT,
    detachAndAssertStopped,
    manifestSourcemapPath,
    originalTsPath,
    stackTraceWithRetry,
    stopActiveDebugSessionIfAny,
    trackDapMessages,
    unloadAllSessions,
    waitFor,
    waitForBreakpointHit,
} from "./liveHelpers";

/** `console.log(marker);` in original.ts (1-based line, matches DAP's convention). */
const BREAKPOINT_LINE = 7;

/**
 * How long the attached debugger is given to (wrongly) stop at the startup
 * breakpoint in the "off" case. Counted from when the debugger is attached
 * and verifiably talking to the target, not from the command start, so a
 * slow plugin load can't use the window up.
 */
const NO_HIT_WINDOW_MS = 3_000;

/**
 * The session thread-scoped DAP requests (`stackTrace`, `evaluate`) must go
 * to: js-debug's adopted child session. The root session (what
 * `vscode.debug.activeDebugSession` returns early on) answers them with
 * "Unknown request" and never replies.
 */
async function dapSessionFor(api: UxpDebuggerTestApi, clientSessionId: string): Promise<vscode.DebugSession> {
    await waitFor(() => {
        const dap = api.debugManager.getDapSession(clientSessionId);
        return dap !== undefined && dap !== api.debugManager.getVsSession(clientSessionId);
    }, 10_000);
    const dap = api.debugManager.getDapSession(clientSessionId);
    assert.ok(dap, "expected js-debug's child debug session");
    return dap;
}

describeLive("Debug auto-load respects Break on load (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;
    let breakpoint: vscode.SourceBreakpoint;
    let originalBreakOnLoad: boolean;
    let originalLoadPlugin: UxpDebuggerTestApi["service"]["loadPlugin"];
    /** `breakOnStart` argument of every `UxpService.loadPlugin` call made during the test. */
    let loadPluginBreakOnStartArgs: boolean[];

    before(async () => {
        api = await activateExtension();
        originalBreakOnLoad = api.pluginRegistry.snapshot.breakOnLoad.plugins;
    });

    after(async () => {
        await api.pluginRegistry.setBreakOnLoad("plugins", originalBreakOnLoad);
    });

    beforeEach(async () => {
        await unloadAllSessions(api, manifestSourcemapPath);
        breakpoint = new vscode.SourceBreakpoint(
            new vscode.Location(vscode.Uri.file(originalTsPath), new vscode.Position(BREAKPOINT_LINE - 1, 0)),
        );
        vscode.debug.addBreakpoints([breakpoint]);

        loadPluginBreakOnStartArgs = [];
        originalLoadPlugin = api.service.loadPlugin;
        const service = api.service;
        service.loadPlugin = (manifestPath, breakOnStart, targetAppId) => {
            loadPluginBreakOnStartArgs.push(breakOnStart === true);
            return originalLoadPlugin.call(service, manifestPath, breakOnStart, targetAppId);
        };
    });

    afterEach(async () => {
        // Drop the instance-level spy so the prototype method is used again.
        delete (api.service as Partial<Pick<typeof api.service, "loadPlugin">>).loadPlugin;
        vscode.debug.removeBreakpoints([breakpoint]);
        await stopActiveDebugSessionIfAny(api);
        await unloadAllSessions(api, manifestSourcemapPath);
    });

    it("loads paused and hits the startup breakpoint when Break on load is on", async () => {
        await api.pluginRegistry.setBreakOnLoad("plugins", true);
        assert.strictEqual(api.service.sessionsForManifest(manifestSourcemapPath).length, 0);

        const hit = waitForBreakpointHit();
        let threadId: number;
        try {
            await vscode.commands.executeCommand("uxp.attachDebugger", manifestSourcemapPath);
            threadId = await hit;
        }
        finally {
            hit.dispose();
        }

        assert.deepStrictEqual(
            loadPluginBreakOnStartArgs,
            [true],
            "expected exactly one automatic load, requested with breakOnStart",
        );
        const sessions = api.service.sessionsForManifest(manifestSourcemapPath);
        assert.ok(sessions.length > 0, "expected the plugin to be loaded automatically");
        assert.ok(api.debugManager.hasActiveSession, "expected an active debug session");
        const vsSession = api.debugManager.getVsSession(sessions[0].clientSessionId);
        assert.ok(vsSession, "expected an active vscode debug session");

        // Still paused at the breakpoint (not just briefly stopped there).
        const stackTrace = await stackTraceWithRetry(
            await dapSessionFor(api, sessions[0].clientSessionId),
            threadId,
        );
        const topFrame = stackTrace.stackFrames[0];
        assert.ok(topFrame.source?.path, "expected the paused frame to carry a resolved source path");
        assert.strictEqual(
            vscode.Uri.file(topFrame.source.path).fsPath,
            vscode.Uri.file(originalTsPath).fsPath,
            "expected to be paused in original.ts",
        );
        assert.strictEqual(topFrame.line, BREAKPOINT_LINE, "expected to be paused at the startup breakpoint");

        await detachAndAssertStopped(api, vsSession);
    });

    it("loads normally and does not stop at the startup breakpoint when Break on load is off", async () => {
        await api.pluginRegistry.setBreakOnLoad("plugins", false);
        assert.strictEqual(api.service.sessionsForManifest(manifestSourcemapPath).length, 0);

        // Counts every breakpoint stop from before the command starts until the
        // end of the observation window, so no stop can slip through a gap.
        let breakpointStops = 0;
        const tracker = trackDapMessages((message, direction) => {
            const m = message as { type?: string; event?: string; body?: { reason?: string } };
            if (direction === "send" && m.type === "event" && m.event === "stopped" && m.body?.reason === "breakpoint") {
                breakpointStops++;
            }
        });
        let vsSession: vscode.DebugSession | undefined;
        try {
            await vscode.commands.executeCommand("uxp.attachDebugger", manifestSourcemapPath);
            const sessions = api.service.sessionsForManifest(manifestSourcemapPath);
            assert.ok(sessions.length > 0, "expected the plugin to be loaded automatically");
            vsSession = api.debugManager.getVsSession(sessions[0].clientSessionId);
            assert.ok(vsSession, "expected an active vscode debug session");

            // The debugger really reaches the target, and the startup code has
            // already run (`pluginSourcemapMarker` is declared on original.ts:6).
            await assertCanEvaluate(
                await dapSessionFor(api, sessions[0].clientSessionId),
                "typeof pluginSourcemapMarker === \"string\"",
                "true",
            );

            await new Promise((resolve) => setTimeout(resolve, NO_HIT_WINDOW_MS));
            assert.strictEqual(breakpointStops, 0, "startup breakpoint must not be hit without Break on load");
        }
        finally {
            tracker.dispose();
        }

        assert.deepStrictEqual(
            loadPluginBreakOnStartArgs,
            [false],
            "expected exactly one automatic load, requested without breakOnStart",
        );
        assert.ok(api.debugManager.hasActiveSession, "expected an active debug session");
        await detachAndAssertStopped(api, vsSession);
    });
});
