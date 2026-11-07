import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLog } from "../fixtures/fakeVscode";

// `cdpMessageRewriter.ts` calls `vscode.window.showWarningMessage(...)` for
// real (not just as a type) inside `startContextTimeout()`. Since "vscode"
// is not an installed package (only its type declarations are — it's
// provided by the real extension host at runtime), it must be mocked here
// so the module can even be imported under vitest.
vi.mock("vscode", () => ({
    window: { showWarningMessage: vi.fn() },
}));

import { CdpMessageRewriter } from "../../src/vscode/proxy/cdpMessageRewriter";

/** Builds an inline (data-URL) source map, same shape webpack/UXP emit. */
function buildInlineSourceMap(map: Record<string, unknown> = { version: 3, sources: [], mappings: "" }): string {
    const payload = Buffer.from(JSON.stringify(map), "utf-8").toString("base64");
    return `data:application/json;charset=utf-8;base64,${payload}`;
}

function decodeInlineSourceMap(dataUrl: string): Record<string, unknown> {
    const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
}

/** Test harness bundling a rewriter with spies for all its injected callbacks. */
function makeRewriter(pluginDir = "A:/plugins/my-plugin") {
    const log = fakeLog();
    const sendToClient = vi.fn<(msg: string) => void>();
    const stopProxy = vi.fn<() => void>();
    const sendToTarget = vi.fn<(msg: string) => void>();
    const rewriter = new CdpMessageRewriter(pluginDir, log, sendToClient, stopProxy, sendToTarget);
    return { rewriter, log, sendToClient, stopProxy, sendToTarget };
}

function scriptParsed(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        method: "Debugger.scriptParsed",
        params: { scriptId: "1", url: "./index.js", ...overrides },
    });
}

describe("CdpMessageRewriter — source map / script URL rewriting (rewriteFromTarget)", () => {
    it("resolves a uxp:// script with no source map to its file on disk and adds an identity map", () => {
        const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-rewriter-test-"));
        try {
            fs.writeFileSync(path.join(pluginDir, "index.js"), "// entry");
            const { rewriter } = makeRewriter(pluginDir);

            const result = JSON.parse(rewriter.rewriteFromTarget(scriptParsed({ url: "uxp://com.adobe.plugin/index.js", endLine: 4 }))!);

            const expected = pathToFileURL(path.join(pluginDir, "index.js")).href;
            expect(result.params.url).toBe(expected);
            const map = decodeInlineSourceMap(result.params.sourceMapURL);
            expect(map.sources).toEqual([expected]);
            expect((map.mappings as string).split(";")).toHaveLength(5);
        }
        finally {
            fs.rmSync(pluginDir, { recursive: true, force: true });
        }
    });

    it("rewrites the sources of an inline source map to files on disk", () => {
        const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-rewriter-test-"));
        try {
            const pluginDir = path.join(projectDir, "dist");
            fs.mkdirSync(path.join(pluginDir, "assets"), { recursive: true });
            fs.mkdirSync(path.join(projectDir, "src"));
            fs.writeFileSync(path.join(pluginDir, "assets", "index-abc.js"), "// bundle");
            fs.writeFileSync(path.join(projectDir, "src", "main.tsx"), "// source");
            const { rewriter } = makeRewriter(pluginDir);

            const result = JSON.parse(rewriter.rewriteFromTarget(scriptParsed({
                url: "uxp-script://assets/index-abc.js",
                sourceMapURL: buildInlineSourceMap({ version: 3, sources: ["../../src/main.tsx"], mappings: "" }),
            }))!);

            expect(decodeInlineSourceMap(result.params.sourceMapURL).sources).toEqual([
                pathToFileURL(path.join(projectDir, "src", "main.tsx")).href,
            ]);
        }
        finally {
            fs.rmSync(projectDir, { recursive: true, force: true });
        }
    });

    it("resolves CdpEventBuffer console and exception locations through parsed source maps", () => {
        const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-rewriter-test-"));
        try {
            const pluginDir = path.join(projectDir, "dist");
            fs.mkdirSync(path.join(pluginDir, "assets"), { recursive: true });
            fs.mkdirSync(path.join(projectDir, "src"));
            fs.writeFileSync(path.join(pluginDir, "assets", "index-abc.js"), "// bundle");
            fs.writeFileSync(path.join(projectDir, "src", "main.tsx"), "// source");
            const { rewriter } = makeRewriter(pluginDir);

            // "AAKE" = genCol 0, source 0, origLine 0 + 5 = 5, origCol 0 + 2 = 2
            rewriter.rewriteFromTarget(scriptParsed({
                scriptId: "99",
                url: "uxp-script://assets/index-abc.js",
                sourceMapURL: buildInlineSourceMap({
                    version: 3,
                    sources: ["../../src/main.tsx"],
                    names: [],
                    mappings: "AAKE",
                }),
            }));

            rewriter.rewriteFromTarget(JSON.stringify({
                method: "Runtime.consoleAPICalled",
                params: {
                    type: "warn",
                    timestamp: 1000,
                    args: [{ type: "string", value: "mapped warning" }],
                    stackTrace: {
                        callFrames: [{
                            scriptId: "99",
                            url: "uxp-script://assets/index-abc.js",
                            lineNumber: 0,
                            columnNumber: 0,
                        }],
                    },
                },
            }));

            rewriter.rewriteFromTarget(JSON.stringify({
                method: "Runtime.exceptionThrown",
                params: {
                    timestamp: 2000,
                    exceptionDetails: {
                        text: "Uncaught",
                        scriptId: "99",
                        url: "uxp-script://assets/index-abc.js",
                        lineNumber: 0,
                        columnNumber: 0,
                        exception: { description: "Error: boom" },
                        stackTrace: {
                            callFrames: [{
                                functionName: "render",
                                scriptId: "99",
                                url: "uxp-script://assets/index-abc.js",
                                lineNumber: 0,
                                columnNumber: 0,
                            }],
                        },
                    },
                },
            }));

            const expectedUrl = pathToFileURL(path.join(projectDir, "src", "main.tsx")).href;
            const buffer = rewriter.getEventBuffer();
            expect(buffer.console[0]).toMatchObject({
                sourceUrl: expectedUrl,
                line: 5,
            });
            expect(buffer.exceptions[0]).toMatchObject({
                sourceUrl: expectedUrl,
                line: 5,
                stackTrace: `    at render (${expectedUrl}:6:3)`,
            });
        }
        finally {
            fs.rmSync(projectDir, { recursive: true, force: true });
        }
    });

    it("leaves a script that doesn't exist on disk untouched", () => {
        const { rewriter } = makeRewriter("A:/plugins/my-plugin");
        const raw = scriptParsed({ url: "uxp-script://assets/missing.js", sourceMapURL: "" });

        const result = JSON.parse(rewriter.rewriteFromTarget(raw)!);

        expect(result.params.url).toBe("uxp-script://assets/missing.js");
        expect(result.params.sourceMapURL).toBe("");
    });

    it("caches scriptParsed messages by scriptId for later replay (survives a client-only reattach)", () => {
        const { rewriter, sendToClient } = makeRewriter();
        rewriter.rewriteFromTarget(scriptParsed({ scriptId: "42", url: "/index.js" }));

        // A brand-new client (e.g. after a debug-toolbar Restart) triggers a
        // replay of everything already parsed, once it re-sends Debugger.enable —
        // this is what lets js-debug bind breakpoints without UXP re-parsing.
        rewriter.markNewClient();
        rewriter.rewriteFromClient(JSON.stringify({ id: 1, method: "Debugger.enable" }));

        const replayed = sendToClient.mock.calls.map(([m]) => JSON.parse(m));
        expect(replayed.some((m) => m.method === "Debugger.scriptParsed" && m.params.scriptId === "42")).toBe(true);
    });

    it("swallows internal (proxy-initiated) responses instead of forwarding them to the client", () => {
        const { rewriter } = makeRewriter();
        const id = rewriter.allocateInternalId("Runtime.enable");

        const result = rewriter.rewriteFromTarget(JSON.stringify({ id, result: {} }));

        expect(result).toBeNull();
    });

    it("turns a Runtime.evaluate error reply into a synthetic string result for the debug console", () => {
        const { rewriter } = makeRewriter();
        rewriter.rewriteFromClient(
            JSON.stringify({ id: 7, method: "Runtime.evaluate", params: { expression: "1+1" } }),
        );
        // Need an execution context first, otherwise the request above is deferred, not forwarded.
        rewriter.rewriteFromTarget(
            JSON.stringify({
                method: "Runtime.executionContextCreated",
                params: { context: { uniqueId: "ctx-1" } },
            }),
        );
        rewriter.rewriteFromClient(
            JSON.stringify({ id: 7, method: "Runtime.evaluate", params: { expression: "1+1" } }),
        );

        const result = JSON.parse(
            rewriter.rewriteFromTarget(JSON.stringify({ id: 7, error: { message: "not supported" } }))!,
        );

        expect(result.result.result.value).toBe("[UXP] not supported");
    });
});

describe("CdpMessageRewriter — execution context lifecycle", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("captures the uniqueId from Runtime.executionContextCreated", () => {
        const { rewriter } = makeRewriter();
        rewriter.rewriteFromTarget(
            JSON.stringify({ method: "Runtime.executionContextCreated", params: { context: { uniqueId: "abc" } } }),
        );

        expect(rewriter.executionContextUniqueId).toBe("abc");
    });

    it("defers Runtime.executionContextDestroyed and discards it if a reload creates a new context in time", () => {
        const { rewriter, sendToClient } = makeRewriter();
        rewriter.rewriteFromTarget(
            JSON.stringify({ method: "Runtime.executionContextCreated", params: { context: { uniqueId: "old" } } }),
        );
        const destroyedResult = rewriter.rewriteFromTarget(JSON.stringify({ method: "Runtime.executionContextDestroyed" }));
        expect(destroyedResult).toBeNull(); // held back, not forwarded yet

        // Reload: a new context arrives within the grace period.
        rewriter.rewriteFromTarget(
            JSON.stringify({ method: "Runtime.executionContextCreated", params: { context: { uniqueId: "new" } } }),
        );
        vi.advanceTimersByTime(5_000);

        expect(sendToClient).not.toHaveBeenCalledWith(expect.stringContaining("executionContextDestroyed"));
    });

    it("forwards the deferred destruction event to js-debug once the grace period elapses with no reload", () => {
        const { rewriter, sendToClient } = makeRewriter();
        rewriter.rewriteFromTarget(JSON.stringify({ method: "Runtime.executionContextDestroyed" }));

        vi.advanceTimersByTime(2_000);

        expect(sendToClient).toHaveBeenCalledWith(JSON.stringify({ method: "Runtime.executionContextDestroyed" }));
    });

    it("shows a warning and stops the proxy if no execution context arrives before the timeout", async () => {
        const vscode = await import("vscode");
        const { rewriter, stopProxy } = makeRewriter();

        rewriter.startContextTimeout();
        vi.advanceTimersByTime(8_000);

        expect(stopProxy).toHaveBeenCalled();
        expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    });

    it("does not warn if an execution context arrives before the timeout", async () => {
        const vscode = await import("vscode");
        vi.mocked(vscode.window.showWarningMessage).mockClear();
        const { rewriter, stopProxy } = makeRewriter();

        rewriter.startContextTimeout();
        rewriter.rewriteFromTarget(
            JSON.stringify({ method: "Runtime.executionContextCreated", params: { context: { uniqueId: "abc" } } }),
        );
        vi.advanceTimersByTime(8_000);

        expect(stopProxy).not.toHaveBeenCalled();
        expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it("resetContextState clears the captured context and cached script/breakpoint state", () => {
        const { rewriter } = makeRewriter();
        rewriter.rewriteFromTarget(
            JSON.stringify({ method: "Runtime.executionContextCreated", params: { context: { uniqueId: "abc" } } }),
        );
        rewriter.rewriteFromTarget(scriptParsed());

        rewriter.resetContextState();

        expect(rewriter.executionContextUniqueId).toBeUndefined();
        // A genuine target reconnect has nothing to replay — old context/scripts are stale.
        rewriter.markNewClient();
        rewriter.rewriteFromClient(JSON.stringify({ id: 1, method: "Debugger.enable" }));
    });
});

describe("CdpMessageRewriter — Runtime.evaluate context handling (rewriteFromClient)", () => {
    it("defers Runtime.evaluate until an execution context exists, then flushes it with uniqueContextId attached", () => {
        const { rewriter, sendToTarget } = makeRewriter();

        const deferredResult = rewriter.rewriteFromClient(
            JSON.stringify({ id: 5, method: "Runtime.evaluate", params: { expression: "1+1" } }),
        );
        expect(deferredResult).toBeNull();
        expect(sendToTarget).not.toHaveBeenCalled();

        rewriter.rewriteFromTarget(
            JSON.stringify({ method: "Runtime.executionContextCreated", params: { context: { uniqueId: "ctx-42" } } }),
        );

        expect(sendToTarget).toHaveBeenCalledTimes(1);
        const flushed = JSON.parse(sendToTarget.mock.calls[0][0]);
        expect(flushed.params.uniqueContextId).toBe("ctx-42");
    });

    it("attaches uniqueContextId immediately and strips a stale numeric contextId when a context is already known", () => {
        const { rewriter } = makeRewriter();
        rewriter.rewriteFromTarget(
            JSON.stringify({ method: "Runtime.executionContextCreated", params: { context: { uniqueId: "ctx-1" } } }),
        );

        const result = JSON.parse(
            rewriter.rewriteFromClient(
                JSON.stringify({ id: 9, method: "Runtime.evaluate", params: { expression: "1+1", contextId: 3 } }),
            )!,
        );

        expect(result.params.uniqueContextId).toBe("ctx-1");
        expect(result.params.contextId).toBeUndefined();
    });

    it("clears pendingContextMessages and pendingEvaluateIds when markNewClient is called", () => {
        const { rewriter, sendToTarget } = makeRewriter();

        // First client queues a Runtime.evaluate before an execution context exists.
        expect(
            rewriter.rewriteFromClient(
                JSON.stringify({ id: 5, method: "Runtime.evaluate", params: { expression: "stale()" } }),
            ),
        ).toBeNull();

        // A new client attaches (Restart) before the context arrives.
        rewriter.markNewClient();

        // When the context finally arrives, the stale evaluate from the old client must NOT be flushed.
        rewriter.rewriteFromTarget(
            JSON.stringify({ method: "Runtime.executionContextCreated", params: { context: { uniqueId: "ctx-fresh" } } }),
        );
        expect(sendToTarget).not.toHaveBeenCalled();

        // And an error reply with id=5 for the new client (e.g. a non-evaluate request) must not be
        // rewritten as a synthetic Runtime.evaluate error result.
        const nonEvalError = JSON.stringify({ id: 5, error: { code: -32000, message: "Some other error" } });
        expect(rewriter.rewriteFromTarget(nonEvalError)).toBe(nonEvalError);
    });

    it("rejects in-flight sendRawRequestToTarget waiters when dispose() is called", async () => {
        const { rewriter } = makeRewriter();
        const pending = rewriter.sendRawRequestToTarget("Runtime.evaluate", { expression: "1+1" }, 30_000);

        rewriter.dispose();

        await expect(pending).rejects.toThrow(/stopped before the UXP target replied/);
    });
});

describe("CdpMessageRewriter — breakpoint bookkeeping across client reattaches", () => {
    it("tracks breakpointIds returned for setBreakpointByUrl and clears them for a new client", () => {
        const { rewriter, sendToTarget } = makeRewriter();
        rewriter.rewriteFromClient(
            JSON.stringify({ id: 10, method: "Debugger.setBreakpointByUrl", params: { url: "/index.js", lineNumber: 3 } }),
        );
        rewriter.rewriteFromTarget(JSON.stringify({ id: 10, result: { breakpointId: "bp-1" } }));

        rewriter.markNewClient();

        // The stale breakpoint must be actively removed on the target so the
        // new client's re-request doesn't get "already exists" back.
        expect(sendToTarget).toHaveBeenCalledWith(
            expect.stringContaining("\"method\":\"Debugger.removeBreakpoint\""),
        );
        expect(sendToTarget).toHaveBeenCalledWith(expect.stringContaining("\"breakpointId\":\"bp-1\""));
    });

    it("stops tracking a breakpoint once the client removes it itself", () => {
        const { rewriter, sendToTarget } = makeRewriter();
        rewriter.rewriteFromClient(JSON.stringify({ id: 1, method: "Debugger.setBreakpoint", params: {} }));
        rewriter.rewriteFromTarget(JSON.stringify({ id: 1, result: { breakpointId: "bp-2" } }));
        rewriter.rewriteFromClient(JSON.stringify({ method: "Debugger.removeBreakpoint", params: { breakpointId: "bp-2" } }));

        sendToTarget.mockClear();
        rewriter.markNewClient();

        expect(sendToTarget).not.toHaveBeenCalled();
    });
});

describe("CdpMessageRewriter — misc client-side rewriting", () => {
    it("swallows NodeWorker.enable and replies with a synthetic empty success result", () => {
        const { rewriter, sendToClient } = makeRewriter();

        const result = rewriter.rewriteFromClient(JSON.stringify({ id: 3, method: "NodeWorker.enable" }));

        expect(result).toBeNull();
        expect(sendToClient).toHaveBeenCalledWith(JSON.stringify({ id: 3, result: {} }));
    });

    it("swallows js-debug's builtinModules, process, and WebAssembly .cdp probes with harmless synthetic replies, but forwards non-.cdp evaluations", () => {
        const { rewriter, sendToClient } = makeRewriter();
        rewriter.rewriteFromTarget(
            JSON.stringify({ method: "Runtime.executionContextCreated", params: { context: { uniqueId: "ctx-1" } } }),
        );

        const builtinProbe = rewriter.rewriteFromClient(
            JSON.stringify({
                id: 1005,
                method: "Runtime.evaluate",
                params: {
                    expression: "require('module').builtinModules\n//# sourceURL=eval-6e1cf2c6.cdp\n",
                    returnByValue: true,
                    includeCommandLineAPI: true,
                },
            }),
        );
        expect(builtinProbe).toBeNull();
        expect(sendToClient).toHaveBeenCalledWith(
            JSON.stringify({
                id: 1005,
                result: { result: { type: "object", value: [] } },
            }),
        );

        const processProbe = rewriter.rewriteFromClient(
            JSON.stringify({
                id: 1012,
                method: "Runtime.evaluate",
                params: {
                    returnByValue: true,
                    expression:
                        "typeof process === 'undefined' || process.pid === undefined ? 'process not defined' : ({ processId: process.pid, nodeVersion: process.version, architecture: process.arch })\n//# sourceURL=eval-ff6a948c.cdp\n",
                },
            }),
        );
        expect(processProbe).toBeNull();
        expect(sendToClient).toHaveBeenCalledWith(
            JSON.stringify({
                id: 1012,
                result: { result: { type: "string", value: "process not defined" } },
            }),
        );

        const wasmProbe = rewriter.rewriteFromClient(
            JSON.stringify({
                id: 1014,
                method: "Runtime.evaluate",
                params: {
                    expression:
                        "(()=>{let t=[\"instantiate\",\"instantiateStreaming\",\"compile\",\"compileStreaming\"];for(let e of t){let r=WebAssembly[e];WebAssembly[e]=function(...n){return r.apply(this,n).then(i=>{if(!(n[0]instanceof WebAssembly.Module))debugger;return i})}}})();\n\n//# sourceURL=eval-3dc1fafc.cdp\n",
                    silent: true,
                },
            }),
        );
        expect(wasmProbe).toBeNull();
        expect(sendToClient).toHaveBeenCalledWith(
            JSON.stringify({
                id: 1014,
                result: { result: { type: "undefined" } },
            }),
        );

        // Same expression coming from the user's Debug Console (.repl) or without
        // a .cdp sourceURL must NOT be intercepted.
        const replEval = rewriter.rewriteFromClient(
            JSON.stringify({
                id: 1020,
                method: "Runtime.evaluate",
                params: {
                    expression: "require('module').builtinModules\n//# sourceURL=eval-6e1cf2c6.repl\n",
                },
            }),
        );
        expect(replEval).not.toBeNull();
        expect(JSON.parse(replEval!).params.uniqueContextId).toBe("ctx-1");
    });

    it("passes through unrelated messages unchanged", () => {
        const { rewriter } = makeRewriter();
        const raw = JSON.stringify({ id: 1, method: "Debugger.resume" });

        expect(rewriter.rewriteFromClient(raw)).toBe(raw);
    });

    it("returns the raw string unchanged if it is not valid JSON (defensive parse guard)", () => {
        const { rewriter } = makeRewriter();

        expect(rewriter.rewriteFromTarget("not json")).toBe("not json");
        expect(rewriter.rewriteFromClient("not json")).toBe("not json");
    });
});

describe("CdpMessageRewriter — resuming/stepping out of an instrumentation pause", () => {
    const paused = (reason: string) => JSON.stringify({ method: "Debugger.paused", params: { reason, callFrames: [] } });
    const methods = ["Debugger.resume", "Debugger.stepOver"];

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it.each(methods)("forwards %s unchanged when the target is not paused by instrumentation", (method) => {
        const { rewriter, sendToTarget } = makeRewriter();
        const request = JSON.stringify({ id: 44, method, params: {} });
        rewriter.rewriteFromTarget(paused("other"));

        expect(rewriter.rewriteFromClient(request)).toBe(request);
        expect(sendToTarget).not.toHaveBeenCalled();
    });

    it.each(methods)("resumes first and replays %s from the first real pause", (method) => {
        const { rewriter, sendToTarget } = makeRewriter();
        const request = JSON.stringify({ id: 44, method, params: {} });
        rewriter.rewriteFromTarget(paused("instrumentation"));

        expect(rewriter.rewriteFromClient(request)).toBeNull();
        expect(JSON.parse(sendToTarget.mock.calls[0][0])).toMatchObject({ method: "Debugger.resume" });

        expect(rewriter.rewriteFromTarget(paused("other"))).toBeNull();
        expect(sendToTarget).toHaveBeenLastCalledWith(request);

        const next = paused("step");
        expect(rewriter.rewriteFromTarget(next)).toBe(next);
        expect(rewriter.rewriteFromClient(request)).toBe(request);
    });

    it("answers the held request with an empty result when no pause follows in time", () => {
        const { rewriter, sendToClient } = makeRewriter();
        rewriter.rewriteFromTarget(paused("instrumentation"));
        rewriter.rewriteFromClient(JSON.stringify({ id: 44, method: "Debugger.resume", params: {} }));

        vi.advanceTimersByTime(3_000);

        expect(sendToClient).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ id: 44, result: {} }));
    });

    it("forgets the instrumentation pause for a new client", () => {
        const { rewriter } = makeRewriter();
        const request = JSON.stringify({ id: 44, method: "Debugger.resume", params: {} });
        rewriter.rewriteFromTarget(paused("instrumentation"));

        rewriter.markNewClient();

        expect(rewriter.rewriteFromClient(request)).toBe(request);
    });
});
