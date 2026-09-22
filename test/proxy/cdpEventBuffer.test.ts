import { describe, expect, it } from "vitest";
import { CdpEventBuffer } from "../../src/vscode/proxy/cdpEventBuffer";

function consoleApiCalled(overrides: Record<string, unknown> = {}) {
    return {
        method: "Runtime.consoleAPICalled",
        params: {
            type: "log",
            timestamp: 1000,
            args: [{ type: "string", value: "hello" }],
            stackTrace: { callFrames: [{ url: "file:///plugin/index.js", lineNumber: 4 }] },
            ...overrides,
        },
    };
}

function exceptionThrown(overrides: Record<string, unknown> = {}) {
    return {
        method: "Runtime.exceptionThrown",
        params: {
            timestamp: 2000,
            exceptionDetails: {
                text: "Uncaught",
                url: "file:///plugin/index.js",
                lineNumber: 9,
                exception: { description: "TypeError: boom" },
                stackTrace: {
                    callFrames: [{ functionName: "doThing", url: "file:///plugin/index.js", lineNumber: 9, columnNumber: 2 }],
                },
            },
            ...overrides,
        },
    };
}

describe("CdpEventBuffer", () => {
    it("captures a console.log call with its formatted args and source location", () => {
        const buffer = new CdpEventBuffer();
        buffer.captureFromTarget(consoleApiCalled());

        expect(buffer.console).toHaveLength(1);
        expect(buffer.console[0]).toEqual({
            timestamp: 1000,
            level: "log",
            args: ["hello"],
            sourceUrl: "file:///plugin/index.js",
            line: 4,
        });
    });

    it("formats multiple/object args", () => {
        const buffer = new CdpEventBuffer();
        buffer.captureFromTarget(
            consoleApiCalled({
                args: [
                    { type: "string", value: "count:" },
                    { type: "number", value: 3 },
                    { type: "object", description: "Object" },
                    { type: "undefined" },
                ],
            }),
        );

        expect(buffer.console[0].args).toEqual(["count:", "3", "Object", "undefined"]);
    });

    it("captures an uncaught exception with its stack trace and source location", () => {
        const buffer = new CdpEventBuffer();
        buffer.captureFromTarget(exceptionThrown());

        expect(buffer.exceptions).toHaveLength(1);
        expect(buffer.exceptions[0].text).toBe("TypeError: boom");
        expect(buffer.exceptions[0].sourceUrl).toBe("file:///plugin/index.js");
        expect(buffer.exceptions[0].line).toBe(9);
        expect(buffer.exceptions[0].stackTrace).toContain("doThing");
        expect(buffer.exceptions[0].stackTrace).toContain("file:///plugin/index.js:10:3");
    });

    it("ignores unrelated CDP messages", () => {
        const buffer = new CdpEventBuffer();
        buffer.captureFromTarget({ method: "Debugger.scriptParsed", params: {} });
        buffer.captureFromTarget({});

        expect(buffer.console).toHaveLength(0);
        expect(buffer.exceptions).toHaveLength(0);
    });

    it("evicts the oldest entry once the ring buffer exceeds its max size", () => {
        const buffer = new CdpEventBuffer();
        for (let i = 0; i < 205; i++) {
            buffer.captureFromTarget(consoleApiCalled({ timestamp: i, args: [{ type: "number", value: i }] }));
        }

        expect(buffer.console).toHaveLength(200);
        expect(buffer.console[0].timestamp).toBe(5);
        expect(buffer.console[buffer.console.length - 1].timestamp).toBe(204);
    });
});
