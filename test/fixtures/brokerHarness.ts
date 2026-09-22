/**
 * Shared broker test harness: starts a real broker on an OS-assigned port
 * with a NullAnnouncer and fast timeouts, plus small async helpers.
 */

import { UxpBroker, type ConnectedApp } from "../../src/core/broker/UxpBroker";
import { NullAnnouncer } from "../../src/core/vulcan/IPortAnnouncer";
import { FakeHostApp, type FakeHostAppOptions } from "./FakeHostApp";

export interface BrokerHarness {
    broker: UxpBroker;
    announcer: NullAnnouncer;
    port: number;
    /** Connect a fake host app and wait until its App/info handshake completed. */
    connectApp(options?: FakeHostAppOptions): Promise<{ app: FakeHostApp; connected: ConnectedApp }>;
    stop(): Promise<void>;
}

export const FAST_TIMEOUTS = { pluginOpMs: 300, appInfoMs: 300, validateMs: 150 };

export async function startBrokerHarness(
    overrides: { validateBeforeLoad?: boolean; appSettleMs?: number } = {},
): Promise<BrokerHarness> {
    const announcer = new NullAnnouncer();
    const broker = new UxpBroker({
        announcer,
        timeouts: FAST_TIMEOUTS,
        appSettleMs: 0,
        ...overrides,
    });
    const port = await broker.start(0); // OS-assigned port → parallel-safe tests

    const apps: FakeHostApp[] = [];

    return {
        broker,
        announcer,
        port,
        async connectApp(options?: FakeHostAppOptions) {
            const app = new FakeHostApp(options);
            apps.push(app);
            const ready = waitForEvent(broker.onAppConnected);
            await app.connect(port);
            const connected = await ready;
            return { app, connected };
        },
        async stop() {
            for (const app of apps) {
                app.close();
            }
            await broker.stop();
        },
    };
}

/** Await the next emission of a TypedEvent with a timeout. */
export function waitForEvent<T>(
    event: { on(listener: (e: T) => void): () => void },
    timeoutMs = 2000,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            unsubscribe();
            reject(new Error("waitForEvent timed out"));
        }, timeoutMs);
        const unsubscribe = event.on((value) => {
            clearTimeout(timer);
            unsubscribe();
            resolve(value);
        });
    });
}
