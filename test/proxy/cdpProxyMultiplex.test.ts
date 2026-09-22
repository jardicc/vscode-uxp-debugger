import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { fakeLog } from "../fixtures/fakeVscode";

// `cdpProxy.ts` (and the rewriter it instantiates) call real vscode APIs
// (`vscode.window.showErrorMessage` etc.) — mock the module so it can be
// imported under vitest (see test/proxy/cdpMessageRewriter.test.ts).
vi.mock("vscode", () => ({
    window: {
        showWarningMessage: vi.fn(),
        showErrorMessage: vi.fn(),
    },
}));

import { CdpProxyServer } from "../../src/vscode/proxy/cdpProxy";

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) {
            throw new Error("waitFor: condition not met in time");
        }
        await new Promise((r) => setTimeout(r, 10));
    }
}

function connect(url: string): Promise<{ ws: WebSocket; received: string[] }> {
    return new Promise((resolve, reject) => {
        const received: string[] = [];
        const ws = new WebSocket(url);
        ws.on("message", (data) => received.push(data.toString()));
        ws.on("open", () => resolve({ ws, received }));
        ws.on("error", reject);
    });
}

describe("CdpProxyServer — multi-client multiplexing (panel + js-debug)", () => {
    let targetServer: WebSocketServer;
    let targetSocket: WebSocket | undefined;
    let targetReceived: string[];
    let targetConnections: number;
    let proxy: CdpProxyServer;
    let proxyPort: number;

    beforeEach(async () => {
        targetReceived = [];
        targetConnections = 0;
        targetSocket = undefined;

        targetServer = new WebSocketServer({ port: 0, host: "127.0.0.1" });
        targetServer.on("connection", (ws) => {
            targetConnections++;
            targetSocket = ws;
            ws.on("message", (data) => targetReceived.push(data.toString()));
        });
        await new Promise<void>((resolve) => targetServer.on("listening", () => resolve()));
        const targetPort = (targetServer.address() as AddressInfo).port;

        proxy = new CdpProxyServer(
            `ws://127.0.0.1:${targetPort}/socket/cdt/test-session`,
            "test target",
            "A:/plugins/my-plugin",
            fakeLog(),
            false,
        );
        proxyPort = await proxy.start();
    });

    afterEach(async () => {
        await proxy.stop();
        await new Promise<void>((resolve) => targetServer.close(() => resolve()));
    });

    const panelUrl = () => `ws://127.0.0.1:${proxyPort}/panel`;
    const jsDebugUrl = () => `ws://127.0.0.1:${proxyPort}/devtools/page/test-session`;

    it("remaps panel request ids into the >=1,000,000 range and routes the reply back", async () => {
        const panel = await connect(panelUrl());
        const jsDebug = await connect(jsDebugUrl());

        panel.ws.send(JSON.stringify({ id: 1, method: "DOM.getDocument", params: { depth: 1 } }));

        await waitFor(() => targetReceived.some((m) => m.includes("DOM.getDocument")));
        const forwarded = JSON.parse(targetReceived.find((m) => m.includes("DOM.getDocument"))!);
        expect(forwarded.id).toBeGreaterThanOrEqual(1_000_000);
        expect(forwarded.params).toEqual({ depth: 1 });

        targetSocket!.send(
            JSON.stringify({ id: forwarded.id, result: { root: { nodeId: 7 } } }),
        );

        await waitFor(() => panel.received.length > 0);
        const reply = JSON.parse(panel.received[0]);
        expect(reply).toEqual({ id: 1, result: { root: { nodeId: 7 } } });

        // The reply belonged to the panel — js-debug must not have seen it.
        await new Promise((r) => setTimeout(r, 50));
        expect(jsDebug.received.some((m) => m.includes("\"nodeId\":7"))).toBe(false);

        panel.ws.close();
        jsDebug.ws.close();
    });

    it("answers denylisted methods locally without forwarding them to the host", async () => {
        const panel = await connect(panelUrl());

        panel.ws.send(JSON.stringify({ id: 2, method: "Target.setDiscoverTargets", params: {} }));

        await waitFor(() => panel.received.length > 0);
        const reply = JSON.parse(panel.received[0]);
        expect(reply.id).toBe(2);
        expect(reply.error?.code).toBe(-32601);

        await new Promise((r) => setTimeout(r, 50));
        expect(targetReceived.some((m) => m.includes("Target.setDiscoverTargets"))).toBe(false);

        panel.ws.close();
    });

    it("broadcasts target events to panel clients while js-debug keeps receiving them too", async () => {
        const panel = await connect(panelUrl());
        const jsDebug = await connect(jsDebugUrl());
        await waitFor(() => targetSocket !== undefined);

        const event = JSON.stringify({ method: "DOM.attributeModified", params: { nodeId: 3 } });
        targetSocket!.send(event);

        await waitFor(() => panel.received.some((m) => m.includes("DOM.attributeModified")));
        await waitFor(() => jsDebug.received.some((m) => m.includes("DOM.attributeModified")));

        panel.ws.close();
        jsDebug.ws.close();
    });

    it("routes js-debug replies only to js-debug, never to panel clients", async () => {
        const panel = await connect(panelUrl());
        const jsDebug = await connect(jsDebugUrl());
        await waitFor(() => targetSocket !== undefined);

        jsDebug.ws.send(JSON.stringify({ id: 5, method: "Debugger.setBreakpointsActive", params: { active: true } }));
        await waitFor(() => targetReceived.some((m) => m.includes("Debugger.setBreakpointsActive")));

        targetSocket!.send(JSON.stringify({ id: 5, result: {} }));
        await waitFor(() => jsDebug.received.some((m) => m === JSON.stringify({ id: 5, result: {} })));

        await new Promise((r) => setTimeout(r, 50));
        expect(panel.received.some((m) => m.includes("\"id\":5"))).toBe(false);

        panel.ws.close();
        jsDebug.ws.close();
    });

    it("keeps one shared target connection and survives a panel disconnect", async () => {
        const panel = await connect(panelUrl());
        const jsDebug = await connect(jsDebugUrl());
        await waitFor(() => targetSocket !== undefined);

        // Both clients share the single target connection.
        expect(targetConnections).toBe(1);

        panel.ws.close();
        await new Promise((r) => setTimeout(r, 100));

        // Target connection is still alive — a js-debug round trip still works.
        jsDebug.ws.send(JSON.stringify({ id: 9, method: "Debugger.setBreakpointsActive", params: { active: false } }));
        await waitFor(() => targetReceived.some((m) => m.includes("\"id\":9")));
        targetSocket!.send(JSON.stringify({ id: 9, result: {} }));
        await waitFor(() => jsDebug.received.some((m) => m.includes("\"id\":9")));

        expect(targetConnections).toBe(1);
        jsDebug.ws.close();
    });

    it("queues panel messages sent before the target connection opens", async () => {
    // Connect ONLY the panel — its very first message races the proxy's own
    // target connect; the proxy must queue and flush it.
        const panel = await connect(panelUrl());
        panel.ws.send(JSON.stringify({ id: 1, method: "CSS.enable", params: {} }));

        await waitFor(() => targetReceived.some((m) => m.includes("CSS.enable")));
        const forwarded = JSON.parse(targetReceived.find((m) => m.includes("CSS.enable"))!);
        expect(forwarded.id).toBeGreaterThanOrEqual(1_000_000);

        panel.ws.close();
    });
});
