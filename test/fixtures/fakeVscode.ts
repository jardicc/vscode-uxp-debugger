import type * as vscode from "vscode";
import { vi } from "vitest";

export function fakeLog(): vscode.OutputChannel & { lines: string[] } {
    const lines: string[] = [];
    return {
        lines,
        appendLine: vi.fn((line: string) => lines.push(line)),
    } as unknown as vscode.OutputChannel & { lines: string[] };
}
