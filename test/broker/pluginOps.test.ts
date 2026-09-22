import { afterEach, describe, expect, it } from "vitest";
import {
    RequestTimeoutError,
    SandboxedHostError,
    SessionNotFoundError,
    ValidationRejectedError,
} from "../../src/core/errors";
import type { UxpPluginManifest } from "../../src/core/protocol/types";
import { type BrokerHarness, startBrokerHarness, waitForEvent } from "../fixtures/brokerHarness";

const MANIFEST: UxpPluginManifest = {
    id: "com.example.demo",
    name: "Demo Plugin",
    main: "index.html",
    version: "1.0.0",
    host: { app: "PS", minVersion: "23.0.0" },
};

const MANIFEST_PATH = "C:\\plugins\\demo\\manifest.json";
const PLUGIN_DIR = "C:\\plugins\\demo";

describe("plugin operations", () => {
    let harness: BrokerHarness | undefined;

    afterEach(async () => {
        await harness?.stop();
        harness = undefined;
    });

    it("validates before loading and registers a session", async () => {
        harness = await startBrokerHarness();
        const { app, connected } = await harness.connectApp();

        const session = await harness.broker.loadPlugin(
            connected.connectionId,
            PLUGIN_DIR,
            MANIFEST_PATH,
            MANIFEST,
        );

        // Wire order: validate (with manifest) came before load.
        const validateIndex = app.received.findIndex(
            (f) => f.command === "Plugin" && f.action === "validate",
        );
        const loadIndex = app.received.findIndex(
            (f) => f.command === "Plugin" && f.action === "load",
        );
        expect(validateIndex).toBeGreaterThanOrEqual(0);
        expect(loadIndex).toBeGreaterThan(validateIndex);
        expect(
            (app.received[validateIndex].manifest as UxpPluginManifest).id,
        ).toBe(MANIFEST.id);

        // Session registered under a broker-generated client id.
        expect(session.kind).toBe("plugin");
        expect(session.pluginId).toBe(MANIFEST.id);
        expect(session.hostSessionId).toMatch(/^host-session-/);
        expect(session.clientSessionId).not.toBe(session.hostSessionId);
        expect(harness.broker.sessionsForManifest(MANIFEST_PATH)).toHaveLength(1);
    });

    it.skipIf(process.platform === "linux")(
        "finds a loaded session's manifest path case-insensitively (win32/darwin)",
        async () => {
            // Regression: `${workspaceFolder}` substitution in a launch.json "uxp"
            // config can preserve a different drive-letter case than
            // the normalized path stored by the plugin registration flow — a
            // real user hit "This plugin has no live session yet" on F5 right
            // after loading the same plugin, because the exact-string lookup
            // missed a same-file-different-case manifest path.
            harness = await startBrokerHarness();
            const { connected } = await harness.connectApp();
            await harness.broker.loadPlugin(connected.connectionId, PLUGIN_DIR, MANIFEST_PATH, MANIFEST);

            const differentCasePath = MANIFEST_PATH.toLowerCase();
            expect(differentCasePath).not.toBe(MANIFEST_PATH);
            expect(harness.broker.sessionsForManifest(differentCasePath)).toHaveLength(1);
        },
    );

    it("throws ValidationRejectedError when the host rejects the manifest", async () => {
        harness = await startBrokerHarness();
        const { connected } = await harness.connectApp({
            behaviors: { validate: () => ({ success: false, errorMessage: "bad manifest" }) },
        });

        await expect(
            harness.broker.loadPlugin(connected.connectionId, PLUGIN_DIR, MANIFEST_PATH, MANIFEST),
        ).rejects.toBeInstanceOf(ValidationRejectedError);
        expect(harness.broker.liveSessions).toHaveLength(0);
    });

    it("proceeds with load when the host ignores Plugin/validate (PS 27+ behaviour)", async () => {
        harness = await startBrokerHarness();
        const { connected } = await harness.connectApp({
            behaviors: { validate: () => null }, // never reply to validate
        });

        const session = await harness.broker.loadPlugin(
            connected.connectionId,
            PLUGIN_DIR,
            MANIFEST_PATH,
            MANIFEST,
        );
        expect(session.kind).toBe("plugin");
        expect(harness.broker.liveSessions).toHaveLength(1);
    });

    it("skips Plugin/validate entirely with validateBeforeLoad:false", async () => {
        harness = await startBrokerHarness({ validateBeforeLoad: false });
        const { app, connected } = await harness.connectApp();

        const session = await harness.broker.loadPlugin(
            connected.connectionId,
            PLUGIN_DIR,
            MANIFEST_PATH,
            MANIFEST,
        );

        expect(session.kind).toBe("plugin");
        expect(
            app.received.some((f) => f.command === "Plugin" && f.action === "validate"),
        ).toBe(false);
    });

    it("holds the first plugin op until a freshly-connected app has settled", async () => {
        harness = await startBrokerHarness({ appSettleMs: 200 });
        const { connected } = await harness.connectApp();

        const startedAt = Date.now();
        const session = await harness.broker.loadPlugin(
            connected.connectionId,
            PLUGIN_DIR,
            MANIFEST_PATH,
            MANIFEST,
        );

        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(180);
        expect(session.kind).toBe("plugin");
    });

    it("proceeds with load when the host answers validate with an error reply", async () => {
        harness = await startBrokerHarness();
        const { connected } = await harness.connectApp({
            behaviors: { validate: () => ({ error: "validate not supported" }) },
        });

        const session = await harness.broker.loadPlugin(
            connected.connectionId,
            PLUGIN_DIR,
            MANIFEST_PATH,
            MANIFEST,
        );
        expect(session.kind).toBe("plugin");
    });

    it("throws RequestTimeoutError when the host stays silent", async () => {
        harness = await startBrokerHarness();
        const { connected } = await harness.connectApp({
            behaviors: { load: () => null }, // never reply to Plugin/load
        });

        await expect(
            harness.broker.loadPlugin(connected.connectionId, PLUGIN_DIR, MANIFEST_PATH, MANIFEST),
        ).rejects.toBeInstanceOf(RequestTimeoutError);
    });

    it("surfaces host error replies verbatim", async () => {
        harness = await startBrokerHarness();
        const { connected } = await harness.connectApp({
            behaviors: { load: () => ({ error: "host exploded" }) },
        });

        await expect(
            harness.broker.loadPlugin(connected.connectionId, PLUGIN_DIR, MANIFEST_PATH, MANIFEST),
        ).rejects.toThrow(/host exploded/);
    });

    it("refuses plugin commands on sandboxed hosts", async () => {
        harness = await startBrokerHarness();
        const { connected } = await harness.connectApp({
            appInfo: { sandbox: true, appName: "Photoshop Elements" },
        });

        await expect(
            harness.broker.loadPlugin(connected.connectionId, PLUGIN_DIR, MANIFEST_PATH, MANIFEST),
        ).rejects.toBeInstanceOf(SandboxedHostError);
    });

    it("unloads a session and emits onSessionEnded", async () => {
        harness = await startBrokerHarness();
        const { app, connected } = await harness.connectApp();
        const session = await harness.broker.loadPlugin(
            connected.connectionId,
            PLUGIN_DIR,
            MANIFEST_PATH,
            MANIFEST,
        );

        const ended = waitForEvent(harness.broker.onSessionEnded);
        await harness.broker.unloadPlugin(session.clientSessionId);

        const endedSession = await ended;
        expect(endedSession.clientSessionId).toBe(session.clientSessionId);
        expect(harness.broker.liveSessions).toHaveLength(0);

        const unloadFrame = app.received.find(
            (f) => f.command === "Plugin" && f.action === "unload",
        );
        expect(unloadFrame?.pluginSessionId).toBe(session.hostSessionId);
    });

    it("keeps the client session id stable across reloads (host id re-bind)", async () => {
        harness = await startBrokerHarness();
        const { connected } = await harness.connectApp({
            behaviors: { reload: () => ({ pluginSessionId: "fresh-host-id" }) },
        });
        const session = await harness.broker.loadPlugin(
            connected.connectionId,
            PLUGIN_DIR,
            MANIFEST_PATH,
            MANIFEST,
        );
        const clientId = session.clientSessionId;

        await harness.broker.reloadPlugin(clientId);

        const after = harness.broker.liveSessions[0];
        expect(after.clientSessionId).toBe(clientId);
        expect(after.hostSessionId).toBe("fresh-host-id");
    });

    it("ends the session when the host reports UXP/unloaded", async () => {
        harness = await startBrokerHarness();
        const { app, connected } = await harness.connectApp();
        const session = await harness.broker.loadPlugin(
            connected.connectionId,
            PLUGIN_DIR,
            MANIFEST_PATH,
            MANIFEST,
        );

        const ended = waitForEvent(harness.broker.onSessionEnded);
        app.sendUnloaded(session.hostSessionId);
        await ended;

        expect(harness.broker.liveSessions).toHaveLength(0);
        await expect(
            harness.broker.reloadPlugin(session.clientSessionId),
        ).rejects.toBeInstanceOf(SessionNotFoundError);
    });

    it("ends all sessions when the app disconnects", async () => {
        harness = await startBrokerHarness();
        const { app, connected } = await harness.connectApp();
        await harness.broker.loadPlugin(
            connected.connectionId,
            PLUGIN_DIR,
            MANIFEST_PATH,
            MANIFEST,
        );

        const ended = waitForEvent(harness.broker.onSessionEnded);
        app.close();
        await ended;
        expect(harness.broker.liveSessions).toHaveLength(0);
    });

    it("registers script pseudo-sessions via Plugin/runScript", async () => {
        harness = await startBrokerHarness();
        const { app, connected } = await harness.connectApp();

        const session = await harness.broker.runScript(
            connected.connectionId,
            "C:\\scripts",
            "resize.psjs",
            [1920, { keepRatio: true }],
        );

        expect(session.kind).toBe("script");
        expect(session.pluginId).toBe("__uxpScript:resize.psjs");
        expect(session.name).toBe("resize.psjs");

        const frame = app.received.find(
            (f) => f.command === "Plugin" && f.action === "runScript",
        );
        const params = frame?.params as {
            provider: { path: string };
            fileName: string;
            userArgs: unknown[];
        };
        expect(params.provider.path).toBe("C:\\scripts");
        expect(params.fileName).toBe("resize.psjs");
        expect(params.userArgs).toEqual([1920, { keepRatio: true }]);
    });
});
