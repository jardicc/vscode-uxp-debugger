/**
 * Shared helpers for the "live Photoshop" e2e tests (files matching
 * `*.photoshop.test.ts`). Keeps each test file focused on one flow while
 * centralizing the bits every live test needs: gating on
 * `UXP_E2E_PHOTOSHOP`, fixture paths, extension activation, session
 * cleanup, and DAP message tracking.
 */

import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import type { PluginSession } from "../../src/core/broker/SessionRegistry";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";

export const RUN_LIVE = process.env.UXP_E2E_PHOTOSHOP === "1";
export const TIMEOUT_DEFAULT = 30_000;
export const TIMEOUT_MULTI_SESSION = 45_000;
export const TIMEOUT_UI = 120_000;
export const TIMEOUT_MULTI_WINDOW = 180_000;
export const POLL_INTERVAL = 250;
// `describe` is a Mocha global — only defined when running under the mocha
// suite (window A). Companion `--extensionTestsPath` entry points spawned as
// their own separate window (e.g. takeoverWindowB.ts) import this module too
// but never run under mocha, so guard against the global being missing
// rather than crashing the whole process at import time.
export const describeLive
    = typeof describe === "undefined" ? (undefined as unknown as Mocha.SuiteFunction) : RUN_LIVE ? describe : describe.skip;

// __dirname is the compiled location (out/e2e/suite) — fixtures live in the
// source tree (e2e/fixtures/**), not copied into out/, so resolve relative
// to the repo root instead of __dirname directly.
export const repoRoot = path.resolve(__dirname, "../../..");
export const fixturePluginDir = path.resolve(repoRoot, "e2e/fixtures/plugin");
export const manifestPath = path.resolve(fixturePluginDir, "manifest.json");
export const scriptUri = vscode.Uri.file(path.resolve(fixturePluginDir, "index.js"));

/** Second, distinct fixture plugin — used by multiAttach.photoshop.test.ts. */
export const fixturePlugin2Dir = path.resolve(repoRoot, "e2e/fixtures/plugin2");
export const manifest2Path = path.resolve(fixturePlugin2Dir, "manifest.json");

/**
 * Fixture whose entry script (`original.js`) carries an *external*
 * `//# sourceMappingURL=original.js.map` reference (as opposed to the
 * other fixtures' inline maps) — used by sourceMapExternal.photoshop.test.ts.
 */
export const fixturePluginSourcemapDir = path.resolve(repoRoot, "e2e/fixtures/plugin-sourcemap");
export const manifestSourcemapPath = path.resolve(fixturePluginSourcemapDir, "manifest.json");
export const originalTsPath = path.resolve(fixturePluginSourcemapDir, "original.ts");

/**
 * Counterpart to `fixturePluginSourcemapDir` with an *inline* (`data:` URL)
 * source map instead of an external `.map` file — used by
 * sourceMapInline.photoshop.test.ts.
 */
export const fixturePluginSourcemapInlineDir = path.resolve(
    repoRoot,
    "e2e/fixtures/plugin-sourcemap-inline",
);
export const manifestSourcemapInlinePath = path.resolve(fixturePluginSourcemapInlineDir, "manifest.json");
export const originalInlineTsPath = path.resolve(fixturePluginSourcemapInlineDir, "original.ts");

/**
 * Same idea as `fixturePluginSourcemapDir`, but for the `Plugin/runScript`
 * ("debug active-editor script") flow instead of `Plugin/load` — used by
 * sourceMapExternalScript.photoshop.test.ts. No manifest.json/index.html
 * needed here: `runScript` takes a script file path directly.
 */
export const fixtureScriptSourcemapDir = path.resolve(repoRoot, "e2e/fixtures/script-sourcemap");
export const scriptOriginalJsPath = path.resolve(fixtureScriptSourcemapDir, "original.js");
export const scriptOriginalTsPath = path.resolve(fixtureScriptSourcemapDir, "original.ts");

/**
 * Counterpart to `fixtureScriptSourcemapDir` with an *inline* (`data:` URL)
 * source map instead of an external `.map` file — used by
 * sourceMapInlineScript.photoshop.test.ts.
 */
export const fixtureScriptSourcemapInlineDir = path.resolve(
    repoRoot,
    "e2e/fixtures/script-sourcemap-inline",
);
export const scriptInlineOriginalJsPath = path.resolve(fixtureScriptSourcemapInlineDir, "original.js");
export const scriptInlineOriginalTsPath = path.resolve(fixtureScriptSourcemapInlineDir, "original.ts");

/**
 * Deliberately NOT pre-compiled — used by scriptTypeScriptStrip.photoshop.
 * test.ts to exercise `stripTypeScriptFile()` (on-the-fly type erasure, no
 * build step) instead of a checked-in `.js`/`.js.map`.
 */
export const fixtureScriptTypeScriptDir = path.resolve(repoRoot, "e2e/fixtures/script-typescript-live");
export const scriptTypeScriptOriginalTsPath = path.resolve(fixtureScriptTypeScriptDir, "original.ts");

/** Finds and activates this extension, returning its test-only API. */
export async function activateExtension(): Promise<UxpDebuggerTestApi> {
    const ext = vscode.extensions.getExtension<UxpDebuggerTestApi>("JaroslavBereza.uxpdebugger");
    if (!ext) {
        throw new Error("extension not found");
    }
    return ext.activate();
}

/**
 * Best-effort cleanup so a failed assertion doesn't leave the plugin loaded
 * (and possibly attached/paused) for the next test or run. Intended for use
 * in `afterEach`.
 */
export async function unloadAllSessions(
    api: UxpDebuggerTestApi,
    forManifestPath: string,
): Promise<void> {
    for (const session of api.service.sessionsForManifest(forManifestPath)) {
        await api.service.unloadPlugin(session).catch(() => undefined);
    }
}

/** Best-effort detach for `afterEach` cleanup after a failed assertion. */
export async function stopActiveDebugSessionIfAny(api: UxpDebuggerTestApi): Promise<void> {
    if (api.debugManager.hasActiveSession && vscode.debug.activeDebugSession) {
        await Promise.resolve(vscode.debug.stopDebugging(vscode.debug.activeDebugSession)).catch(
            () => undefined,
        );
    }
}

/**
 * Resumes and detaches script sessions stranded before their normal attach
 * cycle. A paused script session makes the entire host app appear busy to
 * subsequent broker requests, so cleanup must make a best-effort attach.
 */
export async function detachStrandedScriptSessions(
    api: UxpDebuggerTestApi,
    sourceRootDir: string,
): Promise<void> {
    for (const session of api.service.sessions.filter((candidate) => candidate.kind === "script")) {
        try {
            await api.debugManager.attach(session, sourceRootDir);
            if (vscode.debug.activeDebugSession) {
                await Promise.resolve(vscode.debug.stopDebugging(vscode.debug.activeDebugSession)).catch(
                    () => undefined,
                );
            }
        }
        catch {
            // best-effort only
        }
    }
}

/** Polls `predicate` every 250ms until it returns true, or rejects after `timeoutMs`. */
export function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const interval = setInterval(() => {
            if (predicate()) {
                clearInterval(interval);
                resolve();
            }
            else if (Date.now() - start > timeoutMs) {
                clearInterval(interval);
                reject(new Error("timed out waiting for condition"));
            }
        }, POLL_INTERVAL);
    });
}

/** * Races `promise` against a `ms` timeout, rejecting with `label` if it wins.
 * Note the original `promise` isn't cancelled — it keeps running in the
 * background — this only stops *us* from waiting on it forever.
 */
function withTimeout<T>(promise: Thenable<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out (${ms}ms) waiting for ${label}`)), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err: unknown) => {
                clearTimeout(timer);
                reject(err instanceof Error ? err : new Error(String(err)));
            },
        );
    });
}

/** * Attaches the debugger to `session` (via `UxpDebugSessionManager`) and
 * asserts it actually started. IMPORTANT: UXP always pauses a freshly
 * loaded/run session waiting for a debugger to attach, *regardless* of
 * `breakOnStart` — the proxy's bootstrap handshake
 * (`Runtime.runIfWaitingForDebugger`) is what resumes it. Any session left
 * without an attach+detach cycle (or an explicit unload) stays paused
 * forever and can make the *entire* host app appear busy/modal to every
 * subsequent broker request. Always pair with `detachAndAssertStopped`.
 */
export async function attachAndAssertStarted(
    api: UxpDebuggerTestApi,
    session: PluginSession,
    sourceRootDir: string = fixturePluginDir,
): Promise<vscode.DebugSession> {
    const started = await api.debugManager.attach(session, sourceRootDir);
    assert.strictEqual(started, true, "expected the JS debug session to start");
    assert.strictEqual(api.debugManager.hasActiveSession, true);

    await waitFor(() => vscode.debug.activeDebugSession !== undefined, 5_000);
    const vsSession = vscode.debug.activeDebugSession;
    assert.ok(vsSession, "expected an active vscode debug session");
    return vsSession;
}

/** Stops `vsSession` and asserts the manager's bookkeeping clears. */
export async function detachAndAssertStopped(
    api: UxpDebuggerTestApi,
    vsSession: vscode.DebugSession,
): Promise<void> {
    await vscode.debug.stopDebugging(vsSession);
    await waitFor(() => !api.debugManager.hasActiveSession, 5_000);
    assert.strictEqual(api.debugManager.hasActiveSession, false);
}

/**
 * Proves the debug session can actually reach the UXP runtime end-to-end —
 * VS Code → js-debug (`pwa-node`) → `CdpProxyServer` → UXP's CDP target and
 * back — by evaluating a trivial expression via the DAP `evaluate` request.
 *
 * `hasActiveSession`/`activeDebugSession` only reflect VS Code's/the
 * manager's own bookkeeping — they stay "true" even if the CDP proxy's
 * *target* WebSocket never reconnected after a restart (e.g. it's still
 * mid-reconnect, or gave up silently) and js-debug is really just talking
 * to a stub. `evaluate` round-trips through the proxy for real, so a hang
 * or wrong result here pinpoints "connected but not actually forwarding"
 * bugs that the plain state assertions can't catch. Retries for `timeoutMs`
 * since the proxy may still be (re)connecting to the target right after a
 * restart.
 */
export async function assertCanEvaluate(
    vsSession: vscode.DebugSession,
    expression = "1 + 1",
    expectedResult = "2",
    timeoutMs = 10_000,
): Promise<void> {
    const start = Date.now();
    let lastErr: unknown;
    while (Date.now() - start < timeoutMs) {
        try {
            // js-debug can take a moment after attach to finish its own internal
            // bootstrap (probing `process`, blackbox patterns, etc.) before it
            // registers a handler for ad-hoc "evaluate" DAP requests. If our
            // request arrives too early, js-debug logs "Unknown request: evaluate"
            // and — critically — never sends ANY response (no success, no
            // error), so the `customRequest` promise hangs forever. Race each
            // attempt against a short per-attempt timeout so a single stuck
            // request can't block the remaining retries within `timeoutMs`.
            const response = await withTimeout(
                vsSession.customRequest("evaluate", {
                    expression,
                    context: "repl",
                }),
                2_000,
                `customRequest("evaluate") for "${expression}"`,
            );
            assert.strictEqual(
                response?.result,
                expectedResult,
                `evaluating "${expression}" returned an unexpected result — the CDP proxy is likely not `
                + "forwarding to the real UXP target.",
            );
            return;
        }
        catch (err) {
            lastErr = err;
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
        }
    }
    throw new Error(
        `Timed out (${timeoutMs}ms) evaluating "${expression}" through the debug session — the CDP `
        + `proxy is likely not forwarding to the UXP target. Last error: ${String(lastErr)}`,
    );
}

/**
 * Invokes a `vscode.LanguageModelTool` directly (bypassing the `vscode.lm`
 * registration/chat-participant machinery, which the e2e harness has no way
 * to drive) — the tool classes in `src/vscode/tools/` are plain classes, so
 * constructing one with its real dependencies and calling `invoke()` is
 * enough to exercise the same code a model-driven tool call would run.
 */
export async function invokeTool<T extends object>(
    tool: vscode.LanguageModelTool<T>,
    input: T,
): Promise<vscode.LanguageModelToolResult> {
    const token = new vscode.CancellationTokenSource().token;
    const result = await tool.invoke({ toolInvocationToken: undefined, input }, token);
    if (!result) {
        throw new Error("tool.invoke() resolved with no result");
    }
    return result;
}

/** Extracts the plain-text content of a tool result produced via `textResult()`. */
export function toolResultText(result: vscode.LanguageModelToolResult): string {
    const part = result.content[0] as vscode.LanguageModelTextPart;
    return part.value;
}

/**
 * Registers a debug adapter tracker for every session, logging each DAP
 * message to the console (visible in the e2e test output) and forwarding it
 * to `onMessage`. Dispose the returned `Disposable` in a `finally` block.
 */
export function trackDapMessages(
    onMessage: (message: Record<string, unknown>, direction: "send" | "receive") => void,
): vscode.Disposable {
    return vscode.debug.registerDebugAdapterTrackerFactory("*", {
        createDebugAdapterTracker() {
            return {
                onDidSendMessage(message: Record<string, unknown>) {
                    console.log(`[e2e][dap>] ${JSON.stringify(message)}`);
                    onMessage(message, "send");
                },
                onWillReceiveMessage(message: Record<string, unknown>) {
                    console.log(`[e2e][dap<] ${JSON.stringify(message)}`);
                    onMessage(message, "receive");
                },
            };
        },
    });
}

/** Resolves with the thread id of the first "stopped"/"breakpoint" DAP event, or rejects after `timeoutMs`. */
export function waitForBreakpointHit(timeoutMs = 15_000): Promise<number> & { dispose: () => void } {
    let disposable: vscode.Disposable | undefined;
    const promise = new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => {
            disposable?.dispose();
            reject(new Error(`Timed out (${timeoutMs}ms) waiting for a "stopped" (breakpoint) DAP event`));
        }, timeoutMs);
        disposable = trackDapMessages((message, direction) => {
            // `onDidSendMessage` (adapter → VS Code) is labelled "send" by trackDapMessages.
            if (direction !== "send") {
                return;
            }
            const m = message as { type?: string; event?: string; body?: { reason?: string; threadId?: number } };
            if (m.type === "event" && m.event === "stopped" && m.body?.reason === "breakpoint") {
                clearTimeout(timer);
                disposable?.dispose();
                resolve(m.body.threadId!);
            }
        });
    }) as Promise<number> & { dispose: () => void };
    promise.dispose = () => disposable?.dispose();
    return promise;
}

/**
 * Calls `stackTrace` with retries, same rationale as `assertCanEvaluate`
 * above: right after a `stopped` event, js-debug may not have finished its
 * own internal bootstrap yet — an ad-hoc `customRequest` sent too early
 * logs "Unknown request: stackTrace" and NEVER responds (no success, no
 * error), hanging the request forever if not raced against a per-attempt
 * timeout.
 */
export async function stackTraceWithRetry(
    vsSession: vscode.DebugSession,
    threadId: number,
    timeoutMs = 15_000,
): Promise<{ stackFrames: { line: number; source?: { path?: string } }[] }> {
    const start = Date.now();
    let lastErr: unknown;
    while (Date.now() - start < timeoutMs) {
        try {
            return await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("stackTrace request timed out")), 2_000);
                vsSession.customRequest("stackTrace", { threadId, startFrame: 0, levels: 1 }).then(
                    (value) => {
                        clearTimeout(timer);
                        resolve(value);
                    },
                    (err: unknown) => {
                        clearTimeout(timer);
                        reject(err instanceof Error ? err : new Error(String(err)));
                    },
                );
            });
        }
        catch (err) {
            lastErr = err;
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
        }
    }
    throw new Error(`Timed out (${timeoutMs}ms) calling stackTrace. Last error: ${String(lastErr)}`);
}

export async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
