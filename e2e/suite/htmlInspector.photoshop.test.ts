/**
 * Live e2e: HTML-inspector transport (docs/UI-DEBUGGING.md).
 *
 * The visual webview panel isn't covered by this transport-level test,
 * so this covers the layer below it: a `/panel` WebSocket client on the
 * session's shared `CdpProxyServer` — the exact transport
 * `UxpInspectorPanel` uses — probing `DOM.getDocument` against a real
 * Photoshop **while a js-debug session is attached**, asserting both
 * consumers keep working side by side.
 *
 * Requires a running Photoshop with developer mode; gated behind
 * UXP_E2E_PHOTOSHOP=1 like every other *.photoshop.test.ts.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import WebSocket from "ws";
import {
    activateExtension,
    assertCanEvaluate,
    attachAndAssertStarted,
    describeLive,
    TIMEOUT_UI,
    detachAndAssertStopped,
    fixturePluginDir,
    manifestPath,
    unloadAllSessions,
    waitFor,
} from "./liveHelpers";

describeLive("HTML inspector panel transport (live Photoshop)", function () {
    this.timeout(TIMEOUT_UI);

    it("serves DOM.getDocument to a panel client while js-debug stays attached", async () => {
        const api = await activateExtension();
        let panelWs: WebSocket | undefined;
        let vsSession: vscode.DebugSession | undefined;
        try {
            const loadResult = await api.service.loadPlugin(manifestPath);
            assert.ok(loadResult.sessions.length > 0, "expected at least one loaded session");
            const session = loadResult.sessions[0];

            // Attach the debugger first — the panel client must coexist with it.
            vsSession = await attachAndAssertStarted(api, session, fixturePluginDir);

            const proxyEntry = api.proxyRegistry.peek(session.clientSessionId);
            assert.ok(proxyEntry, "expected the debug attach to have registered a proxy");

            const received: string[] = [];
            panelWs = new WebSocket(`ws://127.0.0.1:${String(proxyEntry.port)}/panel`);
            panelWs.on("message", (data) => received.push(data.toString()));
            await new Promise<void>((resolve, reject) => {
                panelWs!.on("open", () => resolve());
                panelWs!.on("error", reject);
            });

            panelWs.send(JSON.stringify({ id: 1, method: "DOM.enable", params: {} }));
            panelWs.send(JSON.stringify({ id: 2, method: "DOM.getDocument", params: { depth: 1 } }));

            await waitFor(() => received.some((m) => m.includes("\"id\":2")), 10_000);
            const reply = JSON.parse(received.find((m) => m.includes("\"id\":2"))!);
            console.log(`[e2e] DOM.getDocument reply: ${JSON.stringify(reply).slice(0, 400)}`);
            assert.ok(
                reply.result?.root,
                `expected a DOM root node, got: ${JSON.stringify(reply).slice(0, 400)}`,
            );

            // The panel connects well after js-debug (and the execution context
            // already exists) — the proxy must replay the cached
            // `Runtime.executionContextCreated` event to it (like the real
            // DevTools frontend, only once its own `Runtime.enable` is
            // acknowledged — see `routeToPanelClients` in cdpProxy.ts), otherwise
            // the Console never learns of a context to evaluate against.
            panelWs.send(JSON.stringify({ id: 3, method: "Runtime.enable", params: {} }));
            await waitFor(() => received.some((m) => m.includes("\"id\":3")), 10_000);
            assert.ok(
                received.some((m) => m.includes("Runtime.executionContextCreated")),
                "expected the panel to receive a replayed Runtime.executionContextCreated event",
            );

            // Console evaluate via the panel transport — needs the numeric
            // `contextId` (as the DevTools frontend sends it) translated to
            // UXP's `uniqueContextId`.
            panelWs.send(
                JSON.stringify({
                    id: 4,
                    method: "Runtime.evaluate",
                    params: { expression: "1+1", contextId: 1, replMode: true, includeCommandLineAPI: true },
                }),
            );
            await waitFor(() => received.some((m) => m.includes("\"id\":4")), 10_000);
            const evalReply = JSON.parse(received.find((m) => m.includes("\"id\":4"))!);
            assert.strictEqual(
                evalReply.result?.result?.value,
                2,
                `expected Console evaluate to return 2, got: ${JSON.stringify(evalReply)}`,
            );

            // The js-debug session must be unaffected by the panel traffic.
            await assertCanEvaluate(vsSession);

            panelWs.close();
            panelWs = undefined;
            await detachAndAssertStopped(api, vsSession);
            vsSession = undefined;
        }
        finally {
            panelWs?.close();
            if (vsSession) {
                await Promise.resolve(vscode.debug.stopDebugging(vsSession)).catch(() => undefined);
            }
            await unloadAllSessions(api, manifestPath);
        }
    });
});
