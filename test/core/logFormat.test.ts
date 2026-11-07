import { describe, expect, it, vi } from "vitest";
import { isLogLevelEnabled, parseConfiguredLogLevel, parseHostLogLevel, prefixLogger } from "../../src/core/logFormat";

describe("parseHostLogLevel", () => {
    it("maps host level names and defaults unknown ones to info", () => {
        expect(parseHostLogLevel("error")).toBe("error");
        expect(parseHostLogLevel(" Warning ")).toBe("warn");
        expect(parseHostLogLevel("trace")).toBe("debug");
        expect(parseHostLogLevel("log")).toBe("info");
        expect(parseHostLogLevel("constructor")).toBe("info");
    });
});

describe("prefixLogger", () => {
    it("prefixes messages and keeps the level", () => {
        const warn = vi.fn();
        const logger = prefixLogger({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }, "[broker] ");
        logger.warn("x");
        expect(warn).toHaveBeenCalledWith("[broker] x");
    });
});

describe("configured log level", () => {
    it("falls back to the default for invalid values", () => {
        expect(parseConfiguredLogLevel("debug")).toBe("debug");
        expect(parseConfiguredLogLevel("nope")).toBe("info");
        expect(parseConfiguredLogLevel(undefined)).toBe("info");
        expect(parseConfiguredLogLevel("toString")).toBe("info");
    });

    it("filters by minimum severity", () => {
        expect(isLogLevelEnabled("debug", "info")).toBe(false);
        expect(isLogLevelEnabled("info", "info")).toBe(true);
        expect(isLogLevelEnabled("warn", "error")).toBe(false);
        expect(isLogLevelEnabled("error", "error")).toBe(true);
        expect(isLogLevelEnabled("debug", "debug")).toBe(true);
        expect(isLogLevelEnabled("error", "off")).toBe(false);
    });
});
