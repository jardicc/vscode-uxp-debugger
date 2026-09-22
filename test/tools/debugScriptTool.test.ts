import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
    LanguageModelTextPart: class LanguageModelTextPart {
        constructor(readonly value: string) {}
    },
    LanguageModelToolResult: class LanguageModelToolResult {
        constructor(readonly content: unknown[]) {}
    },
}));

const { debugScriptCommand } = vi.hoisted(() => ({ debugScriptCommand: vi.fn() }));
vi.mock("../../src/vscode/commands/debugScript", () => ({ debugScriptCommand }));

import type * as vscode from "vscode";
import { UxpDebugScriptTool } from "../../src/vscode/tools/uxpDebugScriptTool";

interface ToolResultBody {
    content: { value: string }[];
}

function resultText(result: vscode.LanguageModelToolResult): string {
    return (result as unknown as ToolResultBody).content[0].value;
}

describe("UxpDebugScriptTool", () => {
    const service = {};
    const debugManager = {};
    const context = {};
    const output = {};
    const tool = new UxpDebugScriptTool(
        service as never,
        debugManager as never,
        context as never,
        output as never,
    );

    beforeEach(() => {
        debugScriptCommand.mockReset();
    });

    it("runs and attaches a standalone script without prompting for arguments", async () => {
        debugScriptCommand.mockResolvedValue({
            clientSessionId: "uxp-session-7",
            app: { appName: "Photoshop", appVersion: "27.0" },
        });

        const result = await tool.invoke({
            input: { scriptPath: "C:\\scripts\\inspect.psjs", appId: "PS" },
        } as Parameters<typeof tool.invoke>[0]);

        expect(debugScriptCommand).toHaveBeenCalledWith(
            service,
            debugManager,
            context,
            output,
            {
                script: "C:\\scripts\\inspect.psjs",
                app: "PS",
                userArgs: [],
            },
        );
        expect(resultText(result)).toContain("uxp-session-7");
        expect(resultText(result)).toContain("uxp_wait_for_pause");
    });

    it("returns command failures as tool output", async () => {
        debugScriptCommand.mockRejectedValue(new Error("host rejected script"));

        const result = await tool.invoke({
            input: { scriptPath: "C:\\scripts\\inspect.psjs" },
        } as Parameters<typeof tool.invoke>[0]);

        expect(resultText(result)).toBe("host rejected script");
    });
});
