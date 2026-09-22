import { describe, expect, it } from "vitest";
import {
    compareVersions,
    matchApps,
    requiredAppIds,
} from "../../src/core/manifest/appMatching";
import type { ConnectedApp } from "../../src/core/broker/UxpBroker";

function app(appId: string, appVersion: string, connectionId = 1): ConnectedApp {
    return {
        connectionId,
        info: { appId, appVersion, appName: appId, uxpVersion: "8.0.0" },
    };
}

describe("compareVersions", () => {
    it("compares segment-wise numerically", () => {
        expect(compareVersions("26.0.0", "23.2.0")).toBeGreaterThan(0);
        expect(compareVersions("22.5.0", "23.2.0")).toBeLessThan(0);
        expect(compareVersions("23.2.0", "23.2.0")).toBe(0);
    });

    it("treats missing segments as zero", () => {
        expect(compareVersions("23", "23.0.0")).toBe(0);
        expect(compareVersions("23.1", "23")).toBeGreaterThan(0);
    });

    it("is numeric, not lexicographic", () => {
        expect(compareVersions("10.0.0", "9.0.0")).toBeGreaterThan(0);
    });
});

describe("matchApps", () => {
    it("matches by app id when no version is specified", () => {
        const apps = [app("PS", "27.9.0"), app("ID", "18.5.0", 2)];
        const matched = matchApps([{ app: "PS" }], apps);
        expect(matched).toHaveLength(1);
        expect(matched[0].info.appId).toBe("PS");
    });

    it("compares the version only when both sides specify one", () => {
        const apps = [app("PS", "22.0.0")];
        // minVersion above the connected app's version → no match
        expect(matchApps([{ app: "PS", minVersion: "23.0.0" }], apps)).toHaveLength(0);
        // minVersion satisfied → match
        expect(matchApps([{ app: "PS", minVersion: "21.0.0" }], apps)).toHaveLength(1);
        // no minVersion → id match suffices
        expect(matchApps([{ app: "PS" }], apps)).toHaveLength(1);
    });

    it("supports multiple host entries (union)", () => {
        const apps = [app("PS", "27.9.0", 1), app("ID", "18.5.0", 2), app("XD", "36.0.0", 3)];
        const matched = matchApps([{ app: "PS" }, { app: "ID" }], apps);
        expect(matched.map((a) => a.info.appId)).toEqual(["PS", "ID"]);
    });

    it("returns an empty list when nothing is connected", () => {
        expect(matchApps([{ app: "PS" }], [])).toHaveLength(0);
    });
});

describe("requiredAppIds", () => {
    it("deduplicates app ids", () => {
        expect(
            requiredAppIds([{ app: "PS" }, { app: "PS", minVersion: "23.0.0" }, { app: "ID" }]),
        ).toEqual(["PS", "ID"]);
    });
});
