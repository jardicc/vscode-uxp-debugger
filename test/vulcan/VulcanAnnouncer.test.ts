import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/vulcan/addonLoader", () => ({
    loadAddon: vi.fn(),
}));

import { loadAddon } from "../../src/core/vulcan/addonLoader";
import { VulcanAnnouncer } from "../../src/core/vulcan/VulcanAnnouncer";

const loadAddonMock = loadAddon as unknown as ReturnType<typeof vi.fn>;
const setServerDetailsMock = vi.fn();
const disconnectMock = vi.fn();

describe("VulcanAnnouncer", () => {
    beforeEach(() => {
        loadAddonMock.mockClear();
        setServerDetailsMock.mockClear();
        disconnectMock.mockClear();
        loadAddonMock.mockReturnValue({
            VulcanAdapter: vi.fn().mockImplementation(() => ({
                setServerDetails: setServerDetailsMock,
                disconnect: disconnectMock,
            })),
        });
    });

    it("does not load the native addon until the first announce()", () => {
        new VulcanAnnouncer("/native");
        expect(loadAddonMock).not.toHaveBeenCalled();
    });

    it("announce() loads the addon and calls setServerDetails(true, {port})", () => {
        const announcer = new VulcanAnnouncer("/native");
        announcer.announce(14001);
        expect(loadAddonMock).toHaveBeenCalledTimes(1);
        expect(loadAddonMock).toHaveBeenCalledWith("/native");
        expect(setServerDetailsMock).toHaveBeenCalledWith(true, JSON.stringify({ port: 14001 }));
    });

    it("reuses the same adapter across repeated announce()/withdraw() calls", () => {
        const announcer = new VulcanAnnouncer("/native");
        announcer.announce(14001);
        announcer.announce(14001);
        announcer.withdraw(14001);
        expect(loadAddonMock).toHaveBeenCalledTimes(1);
    });

    it("withdraw() is a no-op when never announced (adapter never created)", () => {
        const announcer = new VulcanAnnouncer("/native");
        expect(() => announcer.withdraw(14001)).not.toThrow();
        expect(loadAddonMock).not.toHaveBeenCalled();
        expect(setServerDetailsMock).not.toHaveBeenCalled();
    });

    it("withdraw() calls setServerDetails(false, {port}) after announce()", () => {
        const announcer = new VulcanAnnouncer("/native");
        announcer.announce(14001);
        announcer.withdraw(14001);
        expect(setServerDetailsMock).toHaveBeenLastCalledWith(false, JSON.stringify({ port: 14001 }));
    });

    it("withdraw() swallows adapter errors and logs them instead of throwing", () => {
        const logs: string[] = [];
        const announcer = new VulcanAnnouncer("/native", (m) => logs.push(m));
        announcer.announce(14001);
        setServerDetailsMock.mockImplementationOnce(() => {
            throw new Error("boom");
        });
        expect(() => announcer.withdraw(14001)).not.toThrow();
        expect(logs.some((l) => l.includes("withdraw failed") && l.includes("boom"))).toBe(true);
    });

    it("dispose() calls adapter.disconnect() when an adapter was created", () => {
        const announcer = new VulcanAnnouncer("/native");
        announcer.announce(14001);
        announcer.dispose();
        expect(disconnectMock).toHaveBeenCalledTimes(1);
    });

    it("dispose() does not throw and skips disconnect() when never announced", () => {
        const announcer = new VulcanAnnouncer("/native");
        expect(() => announcer.dispose()).not.toThrow();
        expect(disconnectMock).not.toHaveBeenCalled();
    });

    it("dispose() is idempotent", () => {
        const announcer = new VulcanAnnouncer("/native");
        announcer.announce(14001);
        announcer.dispose();
        announcer.dispose();
        expect(disconnectMock).toHaveBeenCalledTimes(1);
    });

    it("dispose() swallows adapter.disconnect() errors and logs them", () => {
        const logs: string[] = [];
        const announcer = new VulcanAnnouncer("/native", (m) => logs.push(m));
        announcer.announce(14001);
        disconnectMock.mockImplementationOnce(() => {
            throw new Error("disconnect boom");
        });
        expect(() => announcer.dispose()).not.toThrow();
        expect(logs.some((l) => l.includes("disconnect failed") && l.includes("disconnect boom"))).toBe(
            true,
        );
    });

    it("throws when announce() is called after dispose()", () => {
        const announcer = new VulcanAnnouncer("/native");
        announcer.dispose();
        expect(() => announcer.announce(14001)).toThrow(/already disposed/);
    });

    it("withdraw() after dispose() (never announced) is still a safe no-op", () => {
        const announcer = new VulcanAnnouncer("/native");
        announcer.dispose();
        expect(() => announcer.withdraw(14001)).not.toThrow();
    });
});
