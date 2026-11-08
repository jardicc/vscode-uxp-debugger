import * as http from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { UxpBroker } from "../../src/core/broker/UxpBroker";
import { requestTakeover } from "../../src/core/broker/takeover";
import { NullAnnouncer } from "../../src/core/vulcan/IPortAnnouncer";
import { waitForEvent } from "../fixtures/brokerHarness";

describe("broker takeover route", () => {
    let brokers: UxpBroker[] = [];

    afterEach(async () => {
        await Promise.all(brokers.map((broker) => broker.stop()));
        brokers = [];
    });

    it("runs onBeforeTakeoverStop and stops the broker before replying, freeing the port", async () => {
        const order: string[] = [];
        const broker = new UxpBroker({
            announcer: new NullAnnouncer(),
            // eslint-disable-next-line @typescript-eslint/require-await
            onBeforeTakeoverStop: async () => {
                order.push("hook");
            },
        });
        brokers.push(broker);
        const port = await broker.start(0);

        const ok = await requestTakeover(port);

        expect(ok).toBe(true);
        expect(order).toEqual(["hook"]);
        expect(broker.isRunning).toBe(false);

        // The port must be free immediately — the requester can bind it without polling.
        const second = new UxpBroker({ announcer: new NullAnnouncer() });
        brokers.push(second);
        await expect(second.start(port)).resolves.toBe(port);
    });

    it("emits onTakenOver after stopping", async () => {
        const broker = new UxpBroker({ announcer: new NullAnnouncer() });
        brokers.push(broker);
        const port = await broker.start(0);
        const takenOver = waitForEvent(broker.onTakenOver);

        await requestTakeover(port);

        await expect(takenOver).resolves.toBeUndefined();
    });

    it("works with no onBeforeTakeoverStop hook configured", async () => {
        const broker = new UxpBroker({ announcer: new NullAnnouncer() });
        brokers.push(broker);
        const port = await broker.start(0);

        await expect(requestTakeover(port)).resolves.toBe(true);
        expect(broker.isRunning).toBe(false);
    });

    it("resolves false when nothing is listening on the port", async () => {
    // Grab a free port and release it immediately — nothing listens there.
        const probe = http.createServer();
        const port = await new Promise<number>((resolve) => {
            probe.listen(0, "127.0.0.1", () => resolve((probe.address() as AddressInfo).port));
        });
        await new Promise((resolve) => probe.close(() => resolve(undefined)));

        await expect(requestTakeover(port, 300)).resolves.toBe(false);
    });

    it("rejects cross-origin browser POST with 403 and leaves the broker running", async () => {
        const broker = new UxpBroker({ announcer: new NullAnnouncer() });
        brokers.push(broker);
        const port = await broker.start(0);

        const status = await new Promise<number>((resolve, reject) => {
            const req = http.request(
                {
                    host: "127.0.0.1",
                    port,
                    path: "/__uxp_debugger__/takeover",
                    method: "POST",
                    headers: { Origin: "https://evil.example" },
                },
                (res) => {
                    res.resume();
                    res.on("end", () => resolve(res.statusCode ?? 0));
                },
            );
            req.on("error", reject);
            req.end();
        });

        expect(status).toBe(403);
        expect(broker.isRunning).toBe(true);
    });

    it("rejects DNS-rebinding Host headers with 403 and leaves the broker running", async () => {
        const broker = new UxpBroker({ announcer: new NullAnnouncer() });
        brokers.push(broker);
        const port = await broker.start(0);

        const status = await new Promise<number>((resolve, reject) => {
            const req = http.request(
                {
                    host: "127.0.0.1",
                    port,
                    path: "/__uxp_debugger__/takeover",
                    method: "POST",
                    headers: { Host: "attacker.example:14001" },
                },
                (res) => {
                    res.resume();
                    res.on("end", () => resolve(res.statusCode ?? 0));
                },
            );
            req.on("error", reject);
            req.end();
        });

        expect(status).toBe(403);
        expect(broker.isRunning).toBe(true);
    });
});
