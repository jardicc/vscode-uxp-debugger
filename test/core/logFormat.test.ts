import { describe, expect, it, vi } from "vitest";
import { isLogLevelEnabled, parseConfiguredLogLevel, parseHostLogLevel, prefixLogger } from "../../src/core/logFormat";

describe("parseHostLogLevel", () => {
    it("maps host level names and defaults unknown ones to INFO", () => {
        expect(parseHostLogLevel("error")).toBe("ERROR");
        expect(parseHostLogLevel(" Warning ")).toBe("WARN");
        expect(parseHostLogLevel("trace")).toBe("DEBUG");
        expect(parseHostLogLevel("log")).toBe("INFO");
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
        expect(isLogLevelEnabled("DEBUG", "info")).toBe(false);
        expect(isLogLevelEnabled("INFO", "info")).toBe(true);
        expect(isLogLevelEnabled("WARN", "error")).toBe(false);
        expect(isLogLevelEnabled("ERROR", "error")).toBe(true);
        expect(isLogLevelEnabled("DEBUG", "debug")).toBe(true);
        expect(isLogLevelEnabled("ERROR", "off")).toBe(false);
    });
});
