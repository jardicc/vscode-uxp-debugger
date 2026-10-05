import { describe, expect, it } from "vitest";
import {
    connectedAppUnsupportedReason,
    HOST_APPS,
    isDebuggableApp,
    isDebuggableVersion,
    parseRunningApps,
    runningUnsupportedReasons,
} from "../../src/core/vulcan/hostAppCatalog";

const ps = HOST_APPS.find((app) => app.value === "PS")!;

describe("isDebuggableVersion", () => {
    it("accepts versions at or above the catalog minVersion", () => {
        expect(isDebuggableVersion(ps, ps.minVersion)).toBe(true);
        expect(isDebuggableVersion(ps, "99.0.0")).toBe(true);
    });

    it("rejects versions below the catalog minVersion", () => {
        expect(isDebuggableVersion(ps, "22.5.0")).toBe(false);
    });
});

describe("isDebuggableApp", () => {
    it("rejects an old catalog app", () => {
        expect(isDebuggableApp("PS", "22.5.0")).toBe(false);
    });

    it("accepts a new catalog app", () => {
        expect(isDebuggableApp("PS", "26.0.0")).toBe(true);
    });

    it("lets through apps outside the catalog or without a version", () => {
        expect(isDebuggableApp("XD", "1.0.0")).toBe(true);
        expect(isDebuggableApp("PS", undefined)).toBe(true);
    });
});

describe("connectedAppUnsupportedReason", () => {
    it("explains why an old app is refused", () => {
        expect(connectedAppUnsupportedReason("PS", "22.5.0")).toContain(ps.minVersion);
    });

    it("is undefined for debuggable apps", () => {
        expect(connectedAppUnsupportedReason("PS", "26.0.0")).toBeUndefined();
    });
});

describe("parseRunningApps", () => {
    it("flags old running catalog apps from Vulcan's app list", () => {
        expect(parseRunningApps(["PS,17.0.2,Adobe Photoshop"])).toEqual([
            { appId: "PS", version: "17.0.2", unsupportedReason: expect.stringContaining(ps.minVersion) as string },
        ]);
    });

    it("lists debuggable versions without a reason", () => {
        expect(parseRunningApps(["PS,27.9.0,Adobe Photoshop"])).toEqual([{ appId: "PS", version: "27.9.0" }]);
    });

    it("matches catalog ids case-insensitively", () => {
        expect(parseRunningApps(["ps,17.0.2,Adobe Photoshop"])[0]?.appId).toBe("PS");
    });

    it("ignores unknown apps and malformed entries", () => {
        expect(parseRunningApps([
            "XD,1.0.0,Adobe XD",
            "PS",
            "",
        ])).toEqual([]);
    });
});

describe("runningUnsupportedReasons", () => {
    const old = parseRunningApps(["PS,17.0.2,Adobe Photoshop"]);

    it("returns the shared reason, recommending a manual switch", () => {
        const [reason] = runningUnsupportedReasons(old, ["PS"]);
        expect(reason).toBe(connectedAppUnsupportedReason("PS", "17.0.2"));
        expect(reason).toContain(`${ps.minVersion} or newer is required`);
        expect(reason).toContain("Close Photoshop 17.0.2 and start a supported version.");
    });

    it("filters by app id case-insensitively, undefined meaning any", () => {
        expect(runningUnsupportedReasons(old, ["ps"])).toHaveLength(1);
        expect(runningUnsupportedReasons(old, undefined)).toHaveLength(1);
        expect(runningUnsupportedReasons(old, ["ID"])).toEqual([]);
    });

    it("stays silent when a supported version of the app is also running", () => {
        const mixed = parseRunningApps(["PS,17.0.2,Adobe Photoshop", "PS,27.10.0,Adobe Photoshop"]);
        expect(runningUnsupportedReasons(mixed, ["PS"])).toEqual([]);
    });
});
