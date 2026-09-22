import { describe, expect, it } from "vitest";
import {
    asAppMessage,
    buildCdtState,
    buildPluginLoad,
    buildPluginRunScript,
    buildPluginValidate,
    isCdtTunnelMessage,
    isHostAppLogEvent,
    isInitRuntimeClient,
    isPluginUnloadedEvent,
    isReply,
    normalizeUserArgs,
    parseArgsText,
    parseFrame,
} from "../../src/core/protocol/messages";

describe("parseFrame", () => {
    it("parses JSON objects", () => {
        expect(parseFrame("{\"command\":\"ready\"}")).toEqual({ command: "ready" });
    });

    it("returns undefined for non-objects and garbage", () => {
        expect(parseFrame("null")).toBeUndefined();
        expect(parseFrame("[1,2]")).toBeUndefined();
        expect(parseFrame("\"str\"")).toBeUndefined();
        expect(parseFrame("{not json")).toBeUndefined();
    });
});

describe("type guards", () => {
    it("isReply requires a numeric requestId", () => {
        expect(isReply({ command: "reply", requestId: 3 })).toBe(true);
        expect(isReply({ command: "reply" })).toBe(false);
        expect(isReply({ command: "reply", requestId: "3" })).toBe(false);
    });

    it("recognises the app→broker frames", () => {
        expect(isInitRuntimeClient({ command: "initRuntimeClient" })).toBe(true);
        expect(
            isCdtTunnelMessage({ command: "CDT", pluginSessionId: "s", cdtMessage: "{}" }),
        ).toBe(true);
        expect(isCdtTunnelMessage({ command: "CDT", pluginSessionId: "s" })).toBe(false);
        expect(
            isPluginUnloadedEvent({ command: "UXP", action: "unloaded", pluginSessionId: "s" }),
        ).toBe(true);
        expect(
            isHostAppLogEvent({ command: "UXP", action: "log", level: "info", message: "m" }),
        ).toBe(true);
    });

    it("asAppMessage rejects unknown commands", () => {
        expect(asAppMessage({ command: "proxy" })).toBeUndefined();
        expect(asAppMessage({ command: "UXP", action: "nope" })).toBeUndefined();
        expect(asAppMessage({ command: "initRuntimeClient" })).toBeDefined();
    });
});

describe("builders", () => {
    it("buildPluginLoad produces the documented wire shape", () => {
        expect(buildPluginLoad(7, "C:\\plugins\\demo", true)).toEqual({
            command: "Plugin",
            action: "load",
            requestId: 7,
            params: { provider: { type: "disk", path: "C:\\plugins\\demo" } },
            breakOnStart: true,
        });
    });

    it("buildPluginValidate carries the parsed manifest", () => {
        const manifest = {
            id: "a",
            name: "b",
            main: "index.html",
            version: "1.0.0",
            host: { app: "PS" },
        };
        const frame = buildPluginValidate(1, "/p", manifest);
        expect(frame.manifest).toBe(manifest);
        expect(frame.action).toBe("validate");
    });

    it("buildPluginRunScript uses dir + fileName + userArgs", () => {
        expect(buildPluginRunScript(2, "/scripts", "a.psjs", [1, "x"])).toEqual({
            command: "Plugin",
            action: "runScript",
            requestId: 2,
            params: {
                provider: { type: "disk", path: "/scripts" },
                fileName: "a.psjs",
                userArgs: [1, "x"],
            },
        });
    });

    it("buildCdtState toggles between connected and disconnected", () => {
        expect(buildCdtState(1, "h", true).action).toBe("cdtConnected");
        expect(buildCdtState(2, "h", false).action).toBe("cdtDisconnected");
    });
});

describe("normalizeUserArgs", () => {
    it("defaults nullish to []", () => {
        expect(normalizeUserArgs(undefined)).toEqual([]);
        expect(normalizeUserArgs(null)).toEqual([]);
    });

    it("passes arrays through", () => {
        expect(normalizeUserArgs([1, "a", { b: true }])).toEqual([1, "a", { b: true }]);
    });

    it("rejects non-arrays", () => {
        expect(() => normalizeUserArgs("nope")).toThrow(/array/);
        expect(() => normalizeUserArgs({ a: 1 })).toThrow(/array/);
        // A bare number (e.g. a launch.json `"userArgs": 5` typo instead of
        // `"userArgs": [5]`) must fail the same way, not silently coerce.
        expect(() => normalizeUserArgs(5)).toThrow(/array/);
        expect(() => normalizeUserArgs(true)).toThrow(/array/);
    });

    it("fails fast on non-serialisable values", () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(() => normalizeUserArgs([circular])).toThrow();
        expect(() => normalizeUserArgs([1n])).toThrow();
    });

    it("accepts zero arguments", () => {
        expect(normalizeUserArgs([])).toEqual([]);
    });

    it("accepts a single numeric argument (int, float, negative, zero)", () => {
        expect(normalizeUserArgs([42])).toEqual([42]);
        expect(normalizeUserArgs([3.14])).toEqual([3.14]);
        expect(normalizeUserArgs([-7])).toEqual([-7]);
        expect(normalizeUserArgs([0])).toEqual([0]);
    });

    it("accepts a single argument of each JSON type", () => {
        expect(normalizeUserArgs(["text"])).toEqual(["text"]);
        expect(normalizeUserArgs([true])).toEqual([true]);
        expect(normalizeUserArgs([false])).toEqual([false]);
        expect(normalizeUserArgs([null])).toEqual([null]);
        expect(normalizeUserArgs([{ width: 1920 }])).toEqual([{ width: 1920 }]);
        expect(normalizeUserArgs([[1, 2, 3]])).toEqual([[1, 2, 3]]);
    });

    it("accepts many mixed-type arguments in one call", () => {
        const args = [1, "two", true, null, { three: 3 }, [4, 5]];
        expect(normalizeUserArgs(args)).toEqual(args);
    });

    it("accepts a large number of arguments", () => {
        const args = Array.from({ length: 50 }, (_, i) => i);
        expect(normalizeUserArgs(args)).toEqual(args);
    });

    it("does not throw for NaN/Infinity, unlike BigInt", () => {
    // `JSON.stringify` has no representation for NaN/Infinity — it silently
    // emits `null` for them instead of throwing (unlike BigInt, which
    // throws a TypeError) — so normalizeUserArgs lets them through
    // unchanged here; they only turn into `null` later, once the request
    // is actually serialised onto the wire. Documented so a NaN/Infinity
    // arg turning into `null` host-side doesn't look like a mystery
    // "number argument fails" bug.
        expect(normalizeUserArgs([NaN])).toEqual([NaN]);
        expect(normalizeUserArgs([Infinity])).toEqual([Infinity]);
        expect(JSON.stringify(normalizeUserArgs([NaN]))).toBe("[null]");
    });
});

describe("parseArgsText", () => {
    it("parses zero arguments (empty/blank input)", () => {
        expect(parseArgsText("")).toEqual([]);
        expect(parseArgsText("   ")).toEqual([]); // whitespace-only is still an empty array once wrapped
        expect(parseArgsText(" , ")).toBeUndefined(); // an empty element between commas isn't valid JSON
    });

    it("parses a single numeric argument (int, float, negative)", () => {
        expect(parseArgsText("42")).toEqual([42]);
        expect(parseArgsText("3.14")).toEqual([3.14]);
        expect(parseArgsText("-7")).toEqual([-7]);
        expect(parseArgsText("0")).toEqual([0]);
    });

    it("parses a single argument of each JSON type", () => {
        expect(parseArgsText("\"text\"")).toEqual(["text"]);
        expect(parseArgsText("true")).toEqual([true]);
        expect(parseArgsText("false")).toEqual([false]);
        expect(parseArgsText("null")).toEqual([null]);
        expect(parseArgsText("{\"width\":1920}")).toEqual([{ width: 1920 }]);
        expect(parseArgsText("[1,2,3]")).toEqual([[1, 2, 3]]);
    });

    it("parses multiple comma-separated mixed-type arguments", () => {
        expect(parseArgsText("1, \"two\", true, null, {\"three\":3}, [4,5]")).toEqual([
            1,
            "two",
            true,
            null,
            { three: 3 },
            [4, 5],
        ]);
    });

    it("parses many comma-separated arguments", () => {
        const text = Array.from({ length: 20 }, (_, i) => i).join(", ");
        expect(parseArgsText(text)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    });

    it("rejects invalid JSON", () => {
        expect(parseArgsText("not json")).toBeUndefined();
        expect(parseArgsText("1,")).toBeUndefined(); // trailing comma
        expect(parseArgsText("'single quotes'")).toBeUndefined();
        expect(parseArgsText("{")).toBeUndefined();
    });

    it("rejects malformed input that could otherwise smuggle extra tokens past the wrapper", () => {
    // `JSON.parse` requires the whole wrapped string to be one value, so
    // stray brackets in the input can't produce anything but a parse
    // error here — this pins that down as a regression guard.
        expect(parseArgsText("], 1, [")).toBeUndefined();
    });
});
