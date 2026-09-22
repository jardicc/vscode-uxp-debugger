import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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
    it("resolves a uxp:// scriptParsed url with no source map to a real file:// path on disk", () => {
        const { rewriter, log } = makeRewriter("A:/plugins/my-plugin");
        const raw = scriptParsed({ url: "uxp://com.adobe.plugin/index.js" });

        const result = JSON.parse(rewriter.rewriteFromTarget(raw)!);

        expect(result.params.url).toBe("file:///A:/plugins/my-plugin/index.js");
        expect(log.lines).toContain(
            "[CDP] Final source file: \"/index.js\" → \"file:///A:/plugins/my-plugin/index.js\"",
        );
    });

    it("resolves a nested uxp:// scriptParsed url with no source map to a real file:// path on disk", () => {
        const { rewriter } = makeRewriter("A:/plugins/my-plugin");
        const raw = scriptParsed({ url: "uxp://com.adobe.plugin/assets/sub/index-abc123.js" });

        const result = JSON.parse(rewriter.rewriteFromTarget(raw)!);

        expect(result.params.url).toBe("file:///A:/plugins/my-plugin/assets/sub/index-abc123.js");
    });

    it("resolves the main script's raw Windows-path scriptParsed url (real Plugin/runScript shape, no uxp:// scheme) with no source map", () => {
    // Real Photoshop log (2026-08-10): the main script's own Debugger.scriptParsed
    // arrives with a raw OS path, not a uxp:// url — a "a:" drive letter regex
    // false-positive left this completely unresolved (bug fixed alongside this test).
        const pluginDir = "a:\\VS-projects\\uxp-debugger2\\e2e\\fixtures\\plugin";
        const { rewriter } = makeRewriter(pluginDir);
        const raw = scriptParsed({
            url: "a:\\VS-projects\\uxp-debugger2\\e2e\\fixtures\\plugin\\index.js",
            sourceMapURL: "",
            endLine: 24,
        });

        const result = JSON.parse(rewriter.rewriteFromTarget(raw)!);

        expect(result.params.url).toBe("file:///a:/VS-projects/uxp-debugger2/e2e/fixtures/plugin/index.js");
        const map = decodeInlineSourceMap(result.params.sourceMapURL);
        expect(map.sources).toEqual(["file:///a:/VS-projects/uxp-debugger2/e2e/fixtures/plugin/index.js"]);
    });

    it("rewrites the inline sourceMapURL's sourceRoot using the script's own subdirectory", () => {
        const { rewriter } = makeRewriter("A:/plugins/my-plugin");
        const raw = scriptParsed({
            url: "./bundle/index.js",
            sourceMapURL: buildInlineSourceMap({ version: 3, sources: ["../src/index.ts"], mappings: "" }),
        });

        const result = JSON.parse(rewriter.rewriteFromTarget(raw)!);
        const map = decodeInlineSourceMap(result.params.sourceMapURL);

        expect(map.sourceRoot).toBe("file:///A:/plugins/my-plugin/bundle/");
    });

    it("computes an empty subdirectory for a script at the plugin root", () => {
        const { rewriter } = makeRewriter("A:/plugins/my-plugin");
        const raw = scriptParsed({ url: "/index.js", sourceMapURL: buildInlineSourceMap() });

        const result = JSON.parse(rewriter.rewriteFromTarget(raw)!);
        const map = decodeInlineSourceMap(result.params.sourceMapURL);

        expect(map.sourceRoot).toBe("file:///A:/plugins/my-plugin/");
    });

    it("derives the subdirectory from a uxp:// url AFTER normalization (real plugin shape: /assets/…)", () => {
        const { rewriter } = makeRewriter("A:/plugins/my-plugin");
        const raw = scriptParsed({
            url: "uxp://com.adobe.plugin/assets/sub/index-abc123.js",
            sourceMapURL: buildInlineSourceMap(),
        });

        const result = JSON.parse(rewriter.rewriteFromTarget(raw)!);

        expect(result.params.url).toBe("/assets/sub/index-abc123.js");
        expect(decodeInlineSourceMap(result.params.sourceMapURL).sourceRoot).toBe(
            "file:///A:/plugins/my-plugin/assets/sub/",
        );
    });

    it("resolves an external (non data:) sourceMapURL by reading the .map file off disk", () => {
        const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-rewriter-test-"));
        try {
            fs.writeFileSync(
                path.join(pluginDir, "index.js.map"),
                JSON.stringify({ version: 3, sources: ["index.ts"], mappings: "" }),
            );
            const { rewriter } = makeRewriter(pluginDir);
            const raw = scriptParsed({ url: "/index.js", sourceMapURL: "index.js.map" });

            const result = JSON.parse(rewriter.rewriteFromTarget(raw)!);

            expect(result.params.sourceMapURL.startsWith("data:application/json;")).toBe(true);
            expect(decodeInlineSourceMap(result.params.sourceMapURL).sourceRoot).toBe(
                `file:///${pluginDir.replace(/\\/g, "/")}/`,
            );
        }
        finally {
            fs.rmSync(pluginDir, { recursive: true, force: true });
        }
    });

    it("leaves sourceMapURL unchanged when the external .map file does not exist on disk", () => {
        const { rewriter } = makeRewriter();
        const raw = scriptParsed({ sourceMapURL: "index.js.map" });

        const result = JSON.parse(rewriter.rewriteFromTarget(raw)!);

        expect(result.params.sourceMapURL).toBe("index.js.map");
    });

    it("synthesizes an identity source map pointing back at the same file when the script has none", () => {
        const { rewriter } = makeRewriter("A:/plugins/my-plugin");
        const raw = scriptParsed({ url: "/index.js", endLine: 4 });

        const result = JSON.parse(rewriter.rewriteFromTarget(raw)!);

        expect(result.params.url).toBe("file:///A:/plugins/my-plugin/index.js");
        const map = decodeInlineSourceMap(result.params.sourceMapURL);
        expect(map.sources).toEqual(["file:///A:/plugins/my-plugin/index.js"]);
        expect((map.mappings as string).split(";")).toHaveLength(5); // endLine 4 → 5 lines
    });

    it("fixes the real vite-uxp-plugin uxp-script:// bug end-to-end: sourceRoot resolves to the real src file, not dist/src", () => {
    // Reproduces the exact reported bug (2026-08-10): vite-uxp-plugin's
    // `debugger: "udt"` build mode reports the panel bundle's url as
    // `uxp-script://assets/index-abc123.js` — naively dirname-ing that
    // produces a garbage subdir, making `sources: ["../../src/main.tsx"]`
    // (relative to "dist/assets/") resolve one level too high, to
    // "dist/src/main.tsx" (a read-only CDP-fetched preview) instead of the
    // real, editable "src/main.tsx" two levels up from "dist/assets/".
        const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-e2e-sourcemap-test-"));
        try {
            const pluginDir = path.join(projectDir, "dist");
            fs.mkdirSync(path.join(pluginDir, "assets"), { recursive: true });
            fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
            fs.writeFileSync(path.join(projectDir, "src", "main.tsx"), "// real source");

            const { rewriter } = makeRewriter(pluginDir);
            const raw = scriptParsed({
                url: "uxp-script://assets/index-abc123.js",
                sourceMapURL: buildInlineSourceMap({ version: 3, sources: ["../../src/main.tsx"], mappings: "" }),
            });

            const result = JSON.parse(rewriter.rewriteFromTarget(raw)!);
            const map = decodeInlineSourceMap(result.params.sourceMapURL);

            expect(map.sourceRoot).toBe(`file:///${pluginDir.replace(/\\/g, "/")}/assets/`);
            expect(path.resolve(pluginDir, "assets", (map.sources as string[])[0])).toBe(
                path.join(projectDir, "src", "main.tsx"),
            );
        }
        finally {
            fs.rmSync(projectDir, { recursive: true, force: true });
        }
    });

    it("resolves an opaque custom-scheme url with no source map by verifying the file exists on disk", () => {
        const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-e2e-scripturl-test-"));
        try {
            fs.mkdirSync(path.join(pluginDir, "assets"));
            fs.writeFileSync(path.join(pluginDir, "assets", "index-abc123.js"), "// bundle");

            const { rewriter } = makeRewriter(pluginDir);
            const raw = scriptParsed({ url: "uxp-script://assets/index-abc123.js", sourceMapURL: "", endLine: 2 });

            const result = JSON.parse(rewriter.rewriteFromTarget(raw)!);

            expect(result.params.url).toBe(`file:///${pluginDir.replace(/\\/g, "/")}/assets/index-abc123.js`);
            const map = decodeInlineSourceMap(result.params.sourceMapURL);
            expect(map.sources).toEqual([`file:///${pluginDir.replace(/\\/g, "/")}/assets/index-abc123.js`]);
        }
        finally {
            fs.rmSync(pluginDir, { recursive: true, force: true });
        }
    });

    it("leaves an opaque custom-scheme url with no source map unchanged when the file doesn't exist on disk", () => {
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
