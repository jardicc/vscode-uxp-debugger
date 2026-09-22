import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
    LanguageModelTextPart: class LanguageModelTextPart {
        constructor(readonly value: string) {}
    },
    LanguageModelToolResult: class LanguageModelToolResult {
        constructor(readonly content: unknown[]) {}
    },
}));

import type * as vscode from "vscode";
import { PauseTracker } from "../../src/vscode/debug/pauseTracker";
import type { UxpDebugSessionManager } from "../../src/vscode/debug/UxpDebugSessionManager";
import { UxpGetFrameVariablesTool } from "../../src/vscode/tools/uxpGetFrameVariablesTool";
import { UxpGetVariableChildrenTool } from "../../src/vscode/tools/uxpGetVariableChildrenTool";

interface ToolResultBody {
    content: { value: string }[];
}

function resultText(result: vscode.LanguageModelToolResult): string {
    return (result as unknown as ToolResultBody).content[0].value;
}

function fakeOutput(): vscode.OutputChannel {
    return { appendLine: vi.fn() } as unknown as vscode.OutputChannel;
}

function fakeManager(customRequest: ReturnType<typeof vi.fn>): UxpDebugSessionManager {
    return {
        activeSessionIds: ["session-1"],
        isAttached: (sessionId: string) => sessionId === "session-1",
        getDapSession: () => ({ customRequest }),
    } as unknown as UxpDebugSessionManager;
}

describe("variable inspection LM tools", () => {
    let pauseTracker: PauseTracker;

    beforeEach(() => {
        pauseTracker = new PauseTracker();
        pauseTracker.recordPause("session-1", {
            threadId: 1,
            frames: [{ id: 17, name: "handler", line: 10 }],
        });
    });

    it("discovers scopes, omits expensive ones, and preserves expandable variable metadata", async () => {
        const customRequest = vi.fn((command: string) => {
            if (command === "scopes") {
                return Promise.resolve({
                    scopes: [
                        { name: "Global", variablesReference: 90, expensive: true },
                        { name: "Local", presentationHint: "locals", variablesReference: 40, expensive: false },
                    ],
                });
            }
            return Promise.resolve({
                variables: [{
                    name: "options",
                    value: "Object",
                    type: "Object",
                    evaluateName: "options",
                    variablesReference: 41,
                    namedVariables: 2,
                }],
            });
        });
        const tool = new UxpGetFrameVariablesTool(fakeManager(customRequest), pauseTracker, fakeOutput());

        const result = await tool.invoke({
            input: { frameId: 17 },
        } as Parameters<typeof tool.invoke>[0]);
        const body = JSON.parse(resultText(result)) as {
            scopes: { name: string; variables: { evaluateName?: string; variablesReference: number }[] }[];
        };

        expect(body.scopes).toHaveLength(1);
        expect(body.scopes[0].name).toBe("Local");
        expect(body.scopes[0].variables[0]).toMatchObject({
            evaluateName: "options",
            variablesReference: 41,
        });
        expect(customRequest).toHaveBeenNthCalledWith(1, "scopes", { frameId: 17 });
        expect(customRequest).toHaveBeenNthCalledWith(2, "variables", {
            variablesReference: 40,
            start: 0,
            count: 200,
        });
    });

    it("forwards child filtering and paging to DAP", async () => {
        const customRequest = vi.fn().mockResolvedValue({
            variables: [{ name: "[25]", value: "42", variablesReference: 0 }],
        });
        const tool = new UxpGetVariableChildrenTool(fakeManager(customRequest), pauseTracker, fakeOutput());

        const result = await tool.invoke({
            input: { variablesReference: 41, filter: "indexed", start: 25, count: 25 },
        } as Parameters<typeof tool.invoke>[0]);

        expect(resultText(result)).toContain("\"name\": \"[25]\"");
        expect(customRequest).toHaveBeenCalledWith("variables", {
            variablesReference: 41,
            filter: "indexed",
            start: 25,
            count: 25,
        });
    });

    it("does not send a stale variable handle after execution resumes", async () => {
        const customRequest = vi.fn();
        const tool = new UxpGetVariableChildrenTool(fakeManager(customRequest), pauseTracker, fakeOutput());
        pauseTracker.recordContinued("session-1");

        const result = await tool.invoke({
            input: { variablesReference: 41 },
        } as Parameters<typeof tool.invoke>[0]);

        expect(resultText(result)).toContain("not currently paused");
        expect(customRequest).not.toHaveBeenCalled();
    });

    it("rejects a frame id that is not in the current pause snapshot", async () => {
        const customRequest = vi.fn();
        const tool = new UxpGetFrameVariablesTool(fakeManager(customRequest), pauseTracker, fakeOutput());

        const result = await tool.invoke({
            input: { frameId: 999 },
        } as Parameters<typeof tool.invoke>[0]);

        expect(resultText(result)).toContain("not in the current pause snapshot");
        expect(customRequest).not.toHaveBeenCalled();
    });
});
