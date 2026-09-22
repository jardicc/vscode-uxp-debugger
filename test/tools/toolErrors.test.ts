import { describe, expect, it } from "vitest";
import type { ConnectedApp } from "../../src/core/broker/UxpBroker";
import { HostAppNotRunningError, MultipleAppsMatchError, RequestTimeoutError } from "../../src/core/errors";
import { describeLoadError } from "../../src/vscode/tools/toolErrors";

function connectedApp(appId: string, appName: string, appVersion: string): ConnectedApp {
    return {
        connectionId: 1,
        info: { appId, appName, appVersion, uxpVersion: "8.0.0" },
    };
}

describe("describeLoadError", () => {
    it("lists candidate appIds/names for MultipleAppsMatchError and asks to specify appId", () => {
        const err = new MultipleAppsMatchError([
            connectedApp("PS", "Photoshop", "26.0.0"),
            connectedApp("ID", "InDesign", "19.0.0"),
        ]);
        const message = describeLoadError(err);
        expect(message).toContain("PS (Photoshop 26.0.0)");
        expect(message).toContain("ID (InDesign 19.0.0)");
        expect(message).toContain("\"appId\"");
    });

    it("tells which apps are required for HostAppNotRunningError", () => {
        const err = new HostAppNotRunningError(["PS"]);
        expect(describeLoadError(err)).toContain("Required: PS");
    });

    it("appends a retry hint to RequestTimeoutError's own message", () => {
        const err = new RequestTimeoutError("Plugin/load", 5000);
        const message = describeLoadError(err);
        expect(message).toContain(err.message);
        expect(message).toContain("retry the tool call");
    });

    it("falls back to the plain message for any other Error", () => {
        expect(describeLoadError(new Error("boom"))).toBe("boom");
    });

    it("falls back to String() for a non-Error value", () => {
        expect(describeLoadError("boom")).toBe("boom");
    });
});
