import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import type { UxpPluginManifest } from "../../src/core/protocol/types";
import { type BrokerHarness, startBrokerHarness } from "../fixtures/brokerHarness";

const MANIFEST: UxpPluginManifest = {
    id: "com.example.demo",
    name: "Demo Plugin",
    main: "index.html",
    version: "1.0.0",
    host: { app: "PS" },
};

function connectFrontend(port: number, clientSessionId: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/socket/cdt/${clientSessionId}`);
        ws.once("open", () => resolve(ws));
        ws.once("error", reject);
    });
}

function nextMessage(ws: WebSocket, timeoutMs = 2000): Promise<string> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("nextMessage timed out")), timeoutMs);
        ws.once("message", (data) => {
            clearTimeout(timer);
            resolve(String(data));
        });
    });
}

describe("CDT tunnel", () => {
    let harness: BrokerHarness | undefined;

    afterEach(async () => {
        await harness?.stop();
        harness = undefined;
    });

    it("notifies the host and pipes raw CDP frames in both directions", async () => {
        harness = await startBrokerHarness();
        const { app, connected } = await harness.connectApp();
        const session = await harness.broker.loadPlugin(
            connected.connectionId,
            "C:\\plugins\\demo",
            "C:\\plugins\\demo\\manifest.json",
            MANIFEST,
        );

        // Frontend connects → host gets Plugin/cdtConnected with the HOST id.
        const frontend = await connectFrontend(harness.port, session.clientSessionId);
        const cdtConnected = await app.waitForFrame(
            (f) => f.command === "Plugin" && f.action === "cdtConnected",
        );
        expect(cdtConnected.pluginSessionId).toBe(session.hostSessionId);

        // Frontend → app: raw CDP is wrapped into a CDT envelope.
        frontend.send("{\"id\":1,\"method\":\"Runtime.enable\"}");
        const wrapped = await app.waitForFrame((f) => f.command === "CDT");
        expect(wrapped.pluginSessionId).toBe(session.hostSessionId);
        expect(wrapped.cdtMessage).toBe("{\"id\":1,\"method\":\"Runtime.enable\"}");

        // App → frontend: CDT envelope is unwrapped to the raw frame.
        const incoming = nextMessage(frontend);
        app.sendCdtFrame(session.hostSessionId, "{\"id\":1,\"result\":{}}");
        expect(await incoming).toBe("{\"id\":1,\"result\":{}}");

        // Frontend disconnect → host gets Plugin/cdtDisconnected.
        frontend.close();
        const cdtDisconnected = await app.waitForFrame(
            (f) => f.command === "Plugin" && f.action === "cdtDisconnected",
        );
        expect(cdtDisconnected.pluginSessionId).toBe(session.hostSessionId);
    });

    it("rejects frontends for unknown session ids", async () => {
        harness = await startBrokerHarness();
        await expect(connectFrontend(harness.port, "no-such-session")).rejects.toThrow();
    });

    it("replaces an existing frontend instead of duplicating the tunnel", async () => {
        harness = await startBrokerHarness();
        const { app, connected } = await harness.connectApp();
        const session = await harness.broker.loadPlugin(
            connected.connectionId,
            "C:\\plugins\\demo",
            "C:\\plugins\\demo\\manifest.json",
            MANIFEST,
        );

        const first = await connectFrontend(harness.port, session.clientSessionId);
        const firstClosed = new Promise<void>((resolve) => first.once("close", () => resolve()));

        const second = await connectFrontend(harness.port, session.clientSessionId);
        await firstClosed; // the old frontend was kicked

        // The tunnel still works for the new frontend.
        const incoming = nextMessage(second);
        app.sendCdtFrame(session.hostSessionId, "{\"method\":\"Debugger.paused\"}");
        expect(await incoming).toBe("{\"method\":\"Debugger.paused\"}");
        second.close();
    });

    it("closes the frontend when the session is unloaded", async () => {
        harness = await startBrokerHarness();
        const { connected } = await harness.connectApp();
        const session = await harness.broker.loadPlugin(
            connected.connectionId,
            "C:\\plugins\\demo",
            "C:\\plugins\\demo\\manifest.json",
            MANIFEST,
        );

        const frontend = await connectFrontend(harness.port, session.clientSessionId);
        const closed = new Promise<void>((resolve) => frontend.once("close", () => resolve()));
        await harness.broker.unloadPlugin(session.clientSessionId);
        await closed;
    });
});
