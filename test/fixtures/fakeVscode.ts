import type * as vscode from "vscode";
import { vi } from "vitest";
import type { Logger } from "../../src/core/logFormat";

export type FakeLog = vscode.LogOutputChannel & Logger & {
    /** Messages of every level, in call order. */
    lines: string[];
    /** Messages grouped by level. */
    byLevel: Record<"debug" | "info" | "warn" | "error", string[]>;
};

export function fakeLog(): FakeLog {
    const lines: string[] = [];
    const byLevel: FakeLog["byLevel"] = { debug: [], info: [], warn: [], error: [] };
    const record = (level: keyof FakeLog["byLevel"]) =>
        vi.fn((message: string) => {
            lines.push(message);
            byLevel[level].push(message);
        });
    return {
        lines,
        byLevel,
        debug: record("debug"),
        info: record("info"),
        warn: record("warn"),
        error: record("error"),
    } as unknown as FakeLog;
}
