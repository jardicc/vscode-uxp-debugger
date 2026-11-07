/**
 * Shared E2E logging utilities used by `e2e/runTest.ts` (outer CLI process),
 * `e2e/suite/index.ts` (Mocha runner inside the Extension Host), and
 * `e2e/suite/takeoverWindowB.ts` (second Extension Host window).
 *
 * Routes all diagnostic/progress logs (extension OutputChannel, DAP traffic,
 * Electron/VS Code stdout & stderr, multi-window takeover traces) into
 * `logs/e2e/test-run_DD-MM-YYYY_HH-mm.log` using standard `.log` syntax
 * (`YYYY-MM-DD HH:mm:ss.SSS [LEVEL] ...` + indented `    at ...` stack frames)
 * while keeping the terminal clean with only Mocha's test list, results,
 * failure stack traces, and the start/end log file path notice.
 */

import * as fs from "fs";
import * as path from "path";
import { Writable } from "stream";
import * as util from "util";
import {
    formatLogLines,
    formatLogTimestamp,
    formatRunFileTimestamp,
    inferLogLevel,
    type LogLevel,
    parseHostLogLevel,
    stripAnsi,
} from "../src/core/logFormat";

export {
    formatLogLines,
    formatLogTimestamp,
    formatRunFileTimestamp,
    inferLogLevel,
    type LogLevel,
    parseHostLogLevel,
    stripAnsi,
};

/**
 * Line marker used by `e2e/suite/index.ts` when forwarding Mocha reporter
 * output over stdout to `e2e/runTest.ts`, so the outer runner writes only
 * Mocha's test list/results/errors to the terminal and redirects everything
 * else from the VS Code / Electron child process to the `.log` file.
 */
export const E2E_TERMINAL_PREFIX = "__UXP_E2E_TERM__";

/** Environment variable holding the absolute path to the active E2E `.log` file. */
export const E2E_LOG_FILE_ENV = "UXP_E2E_LOG_FILE";

/** Environment variable set to `"1"` when `e2e/runTest.ts` is the outer process. */
export const E2E_CLI_RUNNER_ENV = "UXP_E2E_CLI_RUNNER";

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

/**
 * Creates a new `logs/e2e/test-run_DD-MM-YYYY_HH-mm.log` file under `repoRoot`
 * (or appends seconds / a counter if a file for the same minute already exists)
 * and returns its absolute path.
 */
export function createE2eLogFile(repoRoot: string, date = new Date()): string {
    const logDir = path.join(repoRoot, "logs", "e2e");
    fs.mkdirSync(logDir, { recursive: true });

    const baseStamp = formatRunFileTimestamp(date);
    let candidate = path.join(logDir, `test-run_${baseStamp}.log`);
    if (fs.existsSync(candidate)) {
        const withSeconds = `${baseStamp}-${pad2(date.getSeconds())}`;
        candidate = path.join(logDir, `test-run_${withSeconds}.log`);
        let suffix = 1;
        while (fs.existsSync(candidate)) {
            candidate = path.join(logDir, `test-run_${withSeconds}_${suffix}.log`);
            suffix++;
        }
    }

    fs.writeFileSync(candidate, "", "utf8");
    return candidate;
}

/**
 * Returns the log file path from `UXP_E2E_LOG_FILE` if already initialized by
 * `e2e/runTest.ts`, or creates one on demand (e.g. when the suite is launched
 * directly from `.vscode/launch.json`).
 */
export function resolveOrCreateE2eLogFile(repoRoot: string): string {
    const existing = process.env[E2E_LOG_FILE_ENV];
    if (existing) {
        fs.mkdirSync(path.dirname(existing), { recursive: true });
        return existing;
    }
    const created = createE2eLogFile(repoRoot);
    process.env[E2E_LOG_FILE_ENV] = created;
    return created;
}

/** Appends a formatted diagnostic entry to `logFilePath`. */
export function appendLogEntry(
    logFilePath: string,
    message: string,
    defaultLevel: LogLevel = "INFO",
    date = new Date(),
): void {
    const lines = formatLogLines(message, defaultLevel, date);
    if (lines.length === 0) {
        return;
    }
    fs.appendFileSync(logFilePath, `${lines.join("\n")}\n`, "utf8");
}

/** Formats the terminal notice printed at the beginning and end of an E2E test run. */
export function formatLogBanner(phase: "start" | "end", logFilePath: string): string {
    if (phase === "start") {
        return `[e2e] Diagnostic log for this E2E test run is being recorded to: ${logFilePath}`;
    }
    return `[e2e] Diagnostic log for this E2E test run was saved to: ${logFilePath}`;
}

export interface ChildOutputStreamOptions {
    logFilePath: string;
    defaultLevel?: LogLevel;
    sourceTag?: string;
    onTerminalLine?: (line: string) => void;
}

/**
 * Creates a line-buffered `Writable` stream for `@vscode/test-electron`'s
 * `stdout` / `stderr` options. Lines prefixed with `E2E_TERMINAL_PREFIX` are
 * routed to `onTerminalLine`; all other lines are written to `logFilePath`.
 */
export function createChildOutputStream(
    options: ChildOutputStreamOptions,
): Writable & { flush: () => void } {
    const defaultLevel = options.defaultLevel ?? "INFO";
    let remainder = "";

    const handleLine = (rawLine: string): void => {
        const line = rawLine.replace(/\r$/, "");
        const markerIndex = line.indexOf(E2E_TERMINAL_PREFIX);
        if (markerIndex !== -1) {
            const before = line.slice(0, markerIndex);
            if (before.trim().length > 0) {
                const taggedBefore = options.sourceTag && !before.trimStart().startsWith("[")
                    ? `[${options.sourceTag}] ${before.trimStart()}`
                    : before;
                appendLogEntry(options.logFilePath, taggedBefore, defaultLevel);
            }
            const terminalLine = line.slice(markerIndex + E2E_TERMINAL_PREFIX.length);
            options.onTerminalLine?.(terminalLine);
            return;
        }

        if (line.trim().length === 0) {
            return;
        }
        const tagged = options.sourceTag && !line.trimStart().startsWith("[")
            ? `[${options.sourceTag}] ${line.trimStart()}`
            : line;
        appendLogEntry(options.logFilePath, tagged, defaultLevel);
    };

    const stream = new Writable({
        write(chunk: Buffer | string, _encoding, callback) {
            const text = remainder + (typeof chunk === "string" ? chunk : chunk.toString("utf8"));
            const parts = text.split("\n");
            remainder = parts.pop() ?? "";
            for (const part of parts) {
                handleLine(part);
            }
            callback();
        },
        final(callback) {
            if (remainder.length > 0) {
                handleLine(remainder);
                remainder = "";
            }
            callback();
        },
    }) as Writable & { flush: () => void };

    stream.flush = () => {
        if (remainder.length > 0) {
            handleLine(remainder);
            remainder = "";
        }
    };

    return stream;
}

/**
 * Redirects `console.log`, `console.info`, `console.debug`, `console.warn`,
 * and `console.error` in the current process to `logFilePath` so diagnostic
 * output is recorded with timestamps and levels instead of going to the
 * terminal. Returns a function that restores the original `console` methods.
 */
export function installConsoleToFileRedirect(logFilePath: string): () => void {
    const origLog = console.log;
    const origInfo = console.info;
    const origDebug = console.debug;
    const origWarn = console.warn;
    const origError = console.error;

    const write = (level: LogLevel, args: unknown[]): void => {
        if (args.length === 0) {
            return;
        }
        appendLogEntry(logFilePath, util.format(...args), level);
    };

    console.log = (...args: unknown[]) => write("INFO", args);
    console.info = (...args: unknown[]) => write("INFO", args);
    console.debug = (...args: unknown[]) => write("DEBUG", args);
    console.warn = (...args: unknown[]) => write("WARN", args);
    console.error = (...args: unknown[]) => write("ERROR", args);

    return () => {
        console.log = origLog;
        console.info = origInfo;
        console.debug = origDebug;
        console.warn = origWarn;
        console.error = origError;
    };
}
