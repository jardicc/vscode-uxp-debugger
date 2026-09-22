import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/vulcan/addonLoader", () => ({
    loadAddon: vi.fn(),
}));

import { loadAddon } from "../../src/core/vulcan/addonLoader";
import type { HostAppDescriptor } from "../../src/core/vulcan/hostAppCatalog";
import {
    resetControlAdapterGuardForTests,
    satisfiesMinVersion,
    sortInstalledCandidates,
    VulcanHostAppController,
} from "../../src/core/vulcan/VulcanHostAppController";

const loadAddonMock = loadAddon as unknown as ReturnType<typeof vi.fn>;

const getSpecifiersMock = vi.fn();
const getInstalledAppsMock = vi.fn();
const isAppInstalledMock = vi.fn();
const isAppRunningMock = vi.fn();
const isAppRunningByNameMock = vi.fn();
const getProcessIdMock = vi.fn();
const getAppVersionMock = vi.fn();
const launchAppMock = vi.fn();
const setLibraryPathMock = vi.fn();

const PS: HostAppDescriptor = {
    name: "Photoshop",
    value: "PS",
    sapCodes: ["PHSP", "PHSPBETA"],
    minVersion: "23.2.0",
};
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;

function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, "platform", { value: platform });
}

describe("VulcanHostAppController", () => {
    beforeEach(() => {
        resetControlAdapterGuardForTests();
        loadAddonMock.mockClear();
        getSpecifiersMock.mockReset();
        getInstalledAppsMock.mockReset();
        isAppInstalledMock.mockReset();
        isAppRunningMock.mockReset();
        isAppRunningByNameMock.mockReset();
        getProcessIdMock.mockReset();
        getAppVersionMock.mockReset();
        launchAppMock.mockReset();
        setLibraryPathMock.mockReset();

        getSpecifiersMock.mockReturnValue(["PHSP-26.0.0"]);
        isAppInstalledMock.mockReturnValue(true);
        isAppRunningMock.mockReturnValue(false);
        launchAppMock.mockImplementation((_sap, _focus, _args, cb) => cb(undefined, true));

        loadAddonMock.mockReturnValue({
            VulcanControlAdapter: vi.fn().mockImplementation(() => ({
                getSpecifiers: getSpecifiersMock,
                getInstalledApps: getInstalledAppsMock,
                isAppInstalled: isAppInstalledMock,
                isAppRunning: isAppRunningMock,
                isAppRunningByName: isAppRunningByNameMock,
                getProcessId: getProcessIdMock,
                getAppVersion: getAppVersionMock,
                launchApp: launchAppMock,
                _setLibraryPath: setLibraryPathMock,
            })),
        });

        setPlatform("win32");
    });

    afterEach(() => {
        Object.defineProperty(process, "platform", originalPlatform);
    });

    it("does not load the native addon until the first method call", () => {
        new VulcanHostAppController("/native");
        expect(loadAddonMock).not.toHaveBeenCalled();
    });

    it("passes getSpecifiers/getInstalledApps/isRunning/isRunningByName/getProcessId/getVersion through", () => {
        const ctl = new VulcanHostAppController("/native");
        getInstalledAppsMock.mockReturnValue(["PS"]);
        isAppRunningMock.mockReturnValue(true);
        isAppRunningByNameMock.mockReturnValue(true);
        getProcessIdMock.mockReturnValue(1234);
        getAppVersionMock.mockReturnValue("26.0.0");

        expect(ctl.getSpecifiers()).toEqual(["PHSP-26.0.0"]);
        expect(ctl.getInstalledApps(true)).toEqual(["PS"]);
        expect(getInstalledAppsMock).toHaveBeenCalledWith(true);
        expect(ctl.isRunning("PHSP")).toBe(true);
        expect(ctl.isRunningByName("Adobe Photoshop")).toBe(true);
        expect(ctl.getProcessId("PHSP")).toBe(1234);
        expect(ctl.getVersion("PHSP")).toBe("26.0.0");
        expect(loadAddonMock).toHaveBeenCalledTimes(1);
    });

    it("setLibraryPath() delegates to the native _setLibraryPath", () => {
        const ctl = new VulcanHostAppController("/native");
        ctl.setLibraryPath("/some/dir");
        expect(setLibraryPathMock).toHaveBeenCalledWith("/some/dir");
    });

    it("getInstalledCandidates() combines all of app.sapCodes, newest first", () => {
        getSpecifiersMock.mockReturnValue([
            "PHSP-26.0.0-cs_CZ,en_US",
            "PHSPBETA-27.10.0-en_GB",
            "IDSN-18.5.0-en_US",
        ]);
        const ctl = new VulcanHostAppController("/native");
        expect(ctl.getInstalledCandidates(PS)).toEqual([
            { sapCode: "PHSPBETA", version: "27.10.0", locales: ["en_GB"] },
            { sapCode: "PHSP", version: "26.0.0", locales: ["cs_CZ", "en_US"] },
        ]);
    });

    it("launchSapCode() delegates to the native launchApp with cmdLineArgs always empty", async () => {
        const ctl = new VulcanHostAppController("/native");
        const result = await ctl.launchSapCode("PHSPBETA");
        expect(result).toBe(true);
        expect(launchAppMock).toHaveBeenCalledWith("PHSPBETA", true, "", expect.any(Function));
    });

    it("launchSapCode() logs the callback error instead of swallowing it silently", async () => {
        const logs: string[] = [];
        launchAppMock.mockImplementation((_sap, _focus, _args, cb) =>
            cb(new Error("boom"), false),
        );
        const ctl = new VulcanHostAppController("/native", (m) => logs.push(m));
        const result = await ctl.launchSapCode("PHSP");
        expect(result).toBe(false);
        expect(logs.some((l) => l.includes("callback error") && l.includes("boom"))).toBe(true);
    });

    it("launchSapCode() treats a non-strict-true ok as failure even without an error", async () => {
        launchAppMock.mockImplementation((_sap, _focus, _args, cb) => cb(undefined, undefined));
        const ctl = new VulcanHostAppController("/native");
        const result = await ctl.launchSapCode("PHSP");
        expect(result).toBe(false);
    });

    it("launch() returns notInstalled when none of app.sapCodes is installed", async () => {
        isAppInstalledMock.mockReturnValue(false);
        const ctl = new VulcanHostAppController("/native");
        const result = await ctl.launch(PS);
        expect(result).toEqual({ status: "notInstalled", sapCode: "PHSP" });
        expect(launchAppMock).not.toHaveBeenCalled();
    });

    it("launch() returns versionUnsupported when no installed specifier satisfies minVersion", async () => {
        getSpecifiersMock.mockReturnValue(["PHSP-20.0.0"]);
        const ctl = new VulcanHostAppController("/native");
        const result = await ctl.launch(PS);
        expect(result).toEqual({
            status: "versionUnsupported",
            sapCode: "PHSP",
            installed: ["20.0.0"],
            minVersion: "23.2.0",
        });
        expect(launchAppMock).not.toHaveBeenCalled();
    });

    it("launch() launches the newest candidate across sapCodes, beta included", async () => {
        getSpecifiersMock.mockReturnValue(["PHSP-26.0.0", "PHSPBETA-27.10.0"]);
        const ctl = new VulcanHostAppController("/native");
        const result = await ctl.launch(PS);
        expect(result).toEqual({ status: "launched" });
        expect(launchAppMock).toHaveBeenCalledWith("PHSPBETA", true, "", expect.any(Function));
    });

    it("launch() returns launchFailed when the native callback reports failure", async () => {
        launchAppMock.mockImplementation((_sap, _focus, _args, cb) => cb(undefined, false));
        const ctl = new VulcanHostAppController("/native");
        const result = await ctl.launch(PS);
        expect(result).toEqual({ status: "launchFailed", sapCode: "PHSP" });
    });

    it("dispose() prevents further use", () => {
        const ctl = new VulcanHostAppController("/native");
        ctl.dispose();
        expect(() => ctl.getSpecifiers()).toThrow(/already disposed/);
    });

    it("throws when a second controller tries to instantiate the native adapter in the same process", () => {
        const first = new VulcanHostAppController("/native");
        first.getSpecifiers();
        const second = new VulcanHostAppController("/native");
        expect(() => second.getSpecifiers()).toThrow(/already exists in this process/);
    });

    it("resetControlAdapterGuardForTests() clears the guard between tests", () => {
        const first = new VulcanHostAppController("/native");
        first.getSpecifiers();
        resetControlAdapterGuardForTests();
        const second = new VulcanHostAppController("/native");
        expect(() => second.getSpecifiers()).not.toThrow();
    });
});

afterAll(() => {
    Object.defineProperty(process, "platform", originalPlatform);
});

describe("sortInstalledCandidates", () => {
    it("filters specifiers to the given sapCodes only", () => {
        const result = sortInstalledCandidates(["PHSP-26.0.0", "IDSN-18.5.0"], ["PHSP", "PHSPBETA"]);
        expect(result).toEqual([{ sapCode: "PHSP", version: "26.0.0", locales: [] }]);
    });

    it("sorts newest first across multiple sapCodes, mixing stable and beta", () => {
        const result = sortInstalledCandidates(
            ["PHSP-25.12.3", "PHSPBETA-27.10.0", "PHSP-26.11.6"],
            ["PHSP", "PHSPBETA"],
        );
        expect(result).toEqual([
            { sapCode: "PHSPBETA", version: "27.10.0", locales: [] },
            { sapCode: "PHSP", version: "26.11.6", locales: [] },
            { sapCode: "PHSP", version: "25.12.3", locales: [] },
        ]);
    });

    it("returns an empty array when nothing matches", () => {
        expect(sortInstalledCandidates(["IDSN-18.5.0"], ["PHSP", "PHSPBETA"])).toEqual([]);
    });

    it("parses a single locale, e.g. real dump's \"PHSP-18.1.6-en_GB\"", () => {
        const result = sortInstalledCandidates(["PHSP-18.1.6-en_GB"], ["PHSP"]);
        expect(result).toEqual([{ sapCode: "PHSP", version: "18.1.6", locales: ["en_GB"] }]);
    });

    it("parses multiple comma-separated locales", () => {
        const result = sortInstalledCandidates(
            ["KASU-2.0-cs_CZ,da_DK,de_DE,en_GB,en_US"],
            ["KASU"],
        );
        expect(result).toEqual([
            { sapCode: "KASU", version: "2.0", locales: ["cs_CZ", "da_DK", "de_DE", "en_GB", "en_US"] },
        ]);
    });

    it("treats a specifier with no locale segment as locales: []", () => {
        expect(sortInstalledCandidates(["PHSP-26.0.0"], ["PHSP"])).toEqual([
            { sapCode: "PHSP", version: "26.0.0", locales: [] },
        ]);
    });
});

describe("satisfiesMinVersion", () => {
    it("passes when installed exceeds minVersion", () => {
        expect(satisfiesMinVersion("26.0.0", "23.2.0")).toBe(true);
    });

    it("fails when installed is below minVersion", () => {
        expect(satisfiesMinVersion("22.5.0", "23.2.0")).toBe(false);
    });

    it("passes on exact equality", () => {
        expect(satisfiesMinVersion("23.2.0", "23.2.0")).toBe(true);
    });

    it("treats missing minVersion segments as 0", () => {
        expect(satisfiesMinVersion("1.0", "0")).toBe(true);
    });

    it("returns the first non-zero segment difference (later segments ignored)", () => {
    // major matches (0), minor is lower (-1) -> fails even though patch is huge
        expect(satisfiesMinVersion("23.1.999", "23.2.0")).toBe(false);
    });

    it("a non-numeric segment after an equal prefix poisons the result to false", () => {
        expect(satisfiesMinVersion("26.0.0-beta", "26.0.0")).toBe(false);
    });
});
