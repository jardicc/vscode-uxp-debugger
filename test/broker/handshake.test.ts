import { afterEach, describe, expect, it } from "vitest";
import { UxpBroker } from "../../src/core/broker/UxpBroker";
import { PortInUseError } from "../../src/core/errors";
import { NullAnnouncer } from "../../src/core/vulcan/IPortAnnouncer";
import { type BrokerHarness, startBrokerHarness, waitForEvent } from "../fixtures/brokerHarness";

describe("broker lifecycle & app handshake", () => {
    let harness: BrokerHarness | undefined;

    afterEach(async () => {
        await harness?.stop();
        harness = undefined;
    });

    it("announces the port on start and withdraws (but does not dispose) the announcer on stop", async () => {
        harness = await startBrokerHarness();
        expect(harness.announcer.announced).toEqual([harness.port]);

        await harness.stop();
        expect(harness.announcer.withdrawn).toEqual([harness.port]);
        // stop() must NOT dispose the announcer — the broker can restart in the
        // same process (e.g. re-taking ownership after a takeover), and the real
        // VulcanAnnouncer wraps a native adapter that isn't safe to re-create
        // more than once per process. Disposal is the owner's job, done exactly
        // once at real extension deactivation (UxpService.dispose()).
        expect(harness.announcer.disposed).toBe(false);
        harness = undefined;
    });

    it("fails with PortInUseError when the port is occupied", async () => {
        harness = await startBrokerHarness();
        const second = new UxpBroker({ announcer: new NullAnnouncer() });
        await expect(second.start(harness.port)).rejects.toBeInstanceOf(PortInUseError);
    });

    it("performs the ready → initRuntimeClient → App/info handshake", async () => {
        harness = await startBrokerHarness();
        const { app, connected } = await harness.connectApp();

        // The broker greeted us and asked for App/info.
        expect(app.received.some((f) => f.command === "ready")).toBe(true);
        expect(
            app.received.some((f) => f.command === "App" && f.action === "info"),
        ).toBe(true);

        // Registry snapshot matches what the app reported.
        expect(connected.info.appId).toBe("PS");
        expect(connected.info.appName).toBe("Photoshop");
        expect(harness.broker.connectedApps).toHaveLength(1);
        expect(harness.broker.connectedApps[0].info.appVersion).toBe("27.9.0");
    });

    it("does not list apps that never complete the handshake", async () => {
        harness = await startBrokerHarness();
        const { FakeHostApp } = await import("../fixtures/FakeHostApp");
        const silent = new FakeHostApp({ suppressInit: true });
        await silent.connect(harness.port);
        // Give the broker a moment; the app never sent initRuntimeClient.
        await new Promise((r) => setTimeout(r, 100));
        expect(harness.broker.connectedApps).toHaveLength(0);
        silent.close();
    });

    it("emits onAppDisconnected and clears the snapshot when the app closes", async () => {
        harness = await startBrokerHarness();
        const { app } = await harness.connectApp();

        const disconnected = waitForEvent(harness.broker.onAppDisconnected);
        app.close();
        const event = await disconnected;

        expect(event.info.appId).toBe("PS");
        expect(harness.broker.connectedApps).toHaveLength(0);
    });

    it("forwards host app log events", async () => {
        harness = await startBrokerHarness();
        const { app } = await harness.connectApp();

        const logEvent = waitForEvent(harness.broker.onHostLog);
        app.sendLog("warn", "something happened");
        const event = await logEvent;

        expect(event.level).toBe("warn");
        expect(event.message).toBe("something happened");
        expect(event.appInfo.appName).toBe("Photoshop");
    });

    it("serves /json/version over HTTP", async () => {
        harness = await startBrokerHarness();
        const response = await fetch(`http://127.0.0.1:${harness.port}/json/version`);
        const body = (await response.json()) as Record<string, unknown>;
        expect(body.Browser).toContain("Adobe UXP");
    });
});
