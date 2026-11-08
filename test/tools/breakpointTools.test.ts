import { beforeEach, describe, expect, it, vi } from "vitest";

const debugState = vi.hoisted(() => ({
    breakpoints: [] as unknown[],
    addBreakpoints: vi.fn((bps: unknown[]) => {
        debugState.breakpoints.push(...bps);
    }),
    removeBreakpoints: vi.fn((bps: unknown[]) => {
        debugState.breakpoints = debugState.breakpoints.filter((bp) => !bps.includes(bp));
    }),
}));

vi.mock("vscode", () => {
    class Position {
        constructor(
            readonly line: number,
            readonly character: number,
        ) {}
    }
    class Range {
        readonly start: Position;
        readonly end: Position;
        constructor(start: Position, end = start) {
            this.start = start;
            this.end = end;
        }
    }
    class Location {
        readonly range: Range;
        constructor(
            readonly uri: { fsPath: string },
            positionOrRange: Position | Range,
        ) {
            this.range = positionOrRange instanceof Range ? positionOrRange : new Range(positionOrRange);
        }
    }
    class SourceBreakpoint {
        readonly condition?: string;
        readonly hitCondition?: string;
        readonly logMessage?: string;
        constructor(
            readonly location: Location,
            readonly enabled = true,
        ) {}
    }
    return {
        Uri: {
            file: (filePath: string) => ({ fsPath: filePath }),
        },
        Position,
        Range,
        Location,
        SourceBreakpoint,
        LanguageModelTextPart: class LanguageModelTextPart {
            constructor(readonly value: string) {}
        },
        LanguageModelToolResult: class LanguageModelToolResult {
            constructor(readonly content: unknown[]) {}
        },
        debug: debugState,
    };
});

import type * as vscode from "vscode";
import { UxpListBreakpointsTool } from "../../src/vscode/tools/uxpListBreakpointsTool";
import { UxpRemoveBreakpointTool } from "../../src/vscode/tools/uxpRemoveBreakpointTool";
import { UxpSetBreakpointTool } from "../../src/vscode/tools/uxpSetBreakpointTool";

interface ToolResultBody {
    content: { value: string }[];
}

function resultText(result: vscode.LanguageModelToolResult): string {
    return (result as unknown as ToolResultBody).content[0].value;
}

describe("Breakpoint LM tools", () => {
    const setTool = new UxpSetBreakpointTool();
    const listTool = new UxpListBreakpointsTool();
    const removeTool = new UxpRemoveBreakpointTool();

    beforeEach(() => {
        debugState.breakpoints = [];
        debugState.addBreakpoints.mockClear();
        debugState.removeBreakpoints.mockClear();
    });

    it.skipIf(process.platform === "linux")(
        "matches, deduplicates, and removes breakpoints case-insensitively on win32/darwin",
        async () => {
            await setTool.invoke({
                input: { filePath: "C:\\Plugins\\Sample\\main.js", line: 12 },
            } as Parameters<typeof setTool.invoke>[0]);
            expect(debugState.breakpoints).toHaveLength(1);

            // Setting again with different casing does not create a duplicate
            await setTool.invoke({
                input: { filePath: "c:\\plugins\\sample\\MAIN.JS", line: 12 },
            } as Parameters<typeof setTool.invoke>[0]);
            expect(debugState.breakpoints).toHaveLength(1);
            expect(debugState.addBreakpoints).toHaveBeenCalledTimes(1);

            // Listing with different casing finds the breakpoint
            const listed = await listTool.invoke({
                input: { filePath: "c:\\plugins\\sample\\main.js" },
            } as Parameters<typeof listTool.invoke>[0]);
            expect(JSON.parse(resultText(listed))).toEqual([
                {
                    filePath: "C:\\Plugins\\Sample\\main.js",
                    line: 12,
                    enabled: true,
                },
            ]);

            // Removing with different casing removes the breakpoint
            const removed = await removeTool.invoke({
                input: { filePath: "c:\\plugins\\sample\\main.js", line: 12 },
            } as Parameters<typeof removeTool.invoke>[0]);
            expect(resultText(removed)).toContain("Removed 1 breakpoint(s)");
            expect(debugState.breakpoints).toHaveLength(0);
        },
    );

    it("rejects non-positive or non-integer line numbers", async () => {
        const res = await setTool.invoke({
            input: { filePath: "C:\\Plugins\\Sample\\main.js", line: 0 },
        } as Parameters<typeof setTool.invoke>[0]);
        expect(resultText(res)).toContain("positive integer");
        expect(debugState.breakpoints).toHaveLength(0);
    });
});
