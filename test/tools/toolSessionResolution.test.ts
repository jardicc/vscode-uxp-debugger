import { describe, expect, it } from "vitest";
import type { PluginSession } from "../../src/core/broker/SessionRegistry";
import { resolveSessionsForManifest, type SessionSourceLike } from "../../src/vscode/tools/toolSessionResolution";

function session(clientSessionId: string): PluginSession {
    return {
        clientSessionId,
        hostSessionId: "host-1",
        kind: "plugin",
        pluginId: "com.example.demo",
        name: "Demo",
        pluginPath: "A:/plugin",
        manifestPath: "A:/plugin/manifest.json",
        app: { appId: "PS", appName: "Photoshop", appVersion: "26.0.0", uxpVersion: "8.0.0" },
        appConnectionId: 1,
    };
}

function serviceWith(sessions: PluginSession[]): SessionSourceLike {
    return { sessionsForManifest: () => sessions };
}

describe("resolveSessionsForManifest", () => {
    it("returns every live session when no sessionId is given", () => {
        const sessions = [session("s1"), session("s2")];
        expect(resolveSessionsForManifest(serviceWith(sessions), "A:/plugin/manifest.json")).toEqual(sessions);
    });

    it("returns an empty array when nothing is live and no sessionId is given", () => {
        expect(resolveSessionsForManifest(serviceWith([]), "A:/plugin/manifest.json")).toEqual([]);
    });

    it("narrows to just the matching session when sessionId is given", () => {
        const sessions = [session("s1"), session("s2")];
        expect(resolveSessionsForManifest(serviceWith(sessions), "A:/plugin/manifest.json", "s2")).toEqual([
            session("s2"),
        ]);
    });

    it("throws an actionable error when sessionId doesn't match any live session", () => {
        const sessions = [session("s1")];
        expect(() => resolveSessionsForManifest(serviceWith(sessions), "A:/plugin/manifest.json", "s9")).toThrow(
            /No live session "s9"/,
        );
    });
});
