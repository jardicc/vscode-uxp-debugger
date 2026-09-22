import * as http from "http";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { UxpBroker } from "../../src/core/broker/UxpBroker";
import { BROKER_SERVICE_MARKER, probeBrokerIdentity } from "../../src/core/broker/identify";
import { NullAnnouncer } from "../../src/core/vulcan/IPortAnnouncer";

describe("broker identify route", () => {
    let broker: UxpBroker | undefined;
    let plainServer: http.Server | undefined;

    afterEach(async () => {
        await broker?.stop();
        broker = undefined;
        if (plainServer) {
            await new Promise((resolve) => plainServer!.close(() => resolve(undefined)));
            plainServer = undefined;
        }
    });

    it("reports our own marker, extension version and pid", async () => {
        broker = new UxpBroker({ announcer: new NullAnnouncer(), extensionVersion: "9.9.9" });
        const port = await broker.start(0);

        const identity = await probeBrokerIdentity(port);
        expect(identity).toEqual({
            service: BROKER_SERVICE_MARKER,
            extensionVersion: "9.9.9",
            pid: process.pid,
        });
    });

    it("resolves undefined when nothing is listening on the port", async () => {
    // Grab a free port and release it immediately — nothing listens there.
        const probe = http.createServer();
        const port = await new Promise<number>((resolve) => {
            probe.listen(0, "127.0.0.1", () => resolve((probe.address() as AddressInfo).port));
        });
        await new Promise((resolve) => probe.close(() => resolve(undefined)));

        await expect(probeBrokerIdentity(port, 300)).resolves.toBeUndefined();
    });

    it("resolves undefined for an unrelated HTTP server on the port", async () => {
        plainServer = http.createServer((_req, res) => {
            res.writeHead(404);
            res.end("Cannot GET");
        });
        const port = await new Promise<number>((resolve) => {
            plainServer!.listen(0, "127.0.0.1", () => resolve((plainServer!.address() as AddressInfo).port));
        });

        await expect(probeBrokerIdentity(port, 300)).resolves.toBeUndefined();
    });
});
