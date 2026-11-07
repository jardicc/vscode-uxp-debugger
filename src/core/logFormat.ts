/**
 * Shared log formatting and level-inference utilities used by both the VS Code
 * extension (`src/vscode/ui/output.ts`) and the E2E test harness (`e2e/e2eLog.ts`).
 */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

// Matches ANSI CSI escape sequences (colors, cursor movement, etc.).
const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

function pad3(n: number): string {
    return String(n).padStart(3, "0");
}

/** Formats a Date as `DD-MM-YYYY_HH-mm` (local time) for the E2E log filename. */
export function formatRunFileTimestamp(date = new Date()): string {
    const day = pad2(date.getDate());
    const month = pad2(date.getMonth() + 1);
    const year = date.getFullYear();
    const hours = pad2(date.getHours());
    const minutes = pad2(date.getMinutes());
    return `${day}-${month}-${year}_${hours}-${minutes}`;
}

/**
 * Formats a Date as `YYYY-MM-DD HH:mm:ss.SSS` (local time), matching VS Code's
 * built-in `.log` syntax highlighter (`extensions/log/syntaxes/log.tmLanguage.json`).
 */
export function formatLogTimestamp(date = new Date()): string {
    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    const hours = pad2(date.getHours());
    const minutes = pad2(date.getMinutes());
    const seconds = pad2(date.getSeconds());
    const millis = pad3(date.getMilliseconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${millis}`;
}

/** Removes ANSI escape codes so `.log` files contain clean text for syntax highlighting. */
export function stripAnsi(text: string): string {
    return text.replace(ANSI_ESCAPE_REGEX, "");
}

/** Infers the appropriate `LogLevel` for a single message or line of text. */
export function inferLogLevel(line: string, defaultLevel: LogLevel = "INFO"): LogLevel {
    if (
        line.includes("[e2e][dap>]")
        || line.includes("[e2e][dap<]")
        || /\bignored "instrumentation" stopped event\b/i.test(line)
    ) {
        return "DEBUG";
    }
    if (
        /\b(ERROR|FAIL|FAILED|Uncaught|AssertionError)\b/.test(line)
        || /\b(failed|threw unexpectedly|did not connect within|Error:)\b/i.test(line)
        || /(^|\n)\s*at\s+\S/.test(line)
        || /^\s*\d+\)\s/.test(line)
        || /\b\d+\s+failing\b/.test(line)
    ) {
        return "ERROR";
    }
    if (/\b(WARN|WARNING|showWarningMessage|declined by the user|Ignored unknown)\b/i.test(line)) {
        return "WARN";
    }
    return defaultLevel;
}

/**
 * Normalizes a `UXP/log` host event level string (`"error"`, `"warn"`,
 * `"debug"`, `"info"`, `"log"`, etc.) to a standard `LogLevel`.
 */
export function parseHostLogLevel(level: string, message = ""): LogLevel {
    const normalized = level.trim().toLowerCase();
    if (normalized === "error" || normalized === "err" || normalized === "fatal") {
        return "ERROR";
    }
    if (normalized === "warn" || normalized === "warning") {
        return "WARN";
    }
    if (normalized === "debug" || normalized === "trace" || normalized === "verbose") {
        return "DEBUG";
    }
    if (normalized === "info" || normalized === "information") {
        return "INFO";
    }
    return inferLogLevel(message, "INFO");
}

/**
 * Formats a (potentially multi-line) message into standard `.log` lines.
 * Stack trace frames (`at ...`) are kept indented as `    at ...` without a
 * timestamp prefix so VS Code's `log.tmLanguage.json` (`^[\t ]*at[\t ]`)
 * highlights them as `log.exception`.
 */
export function formatLogLines(
    message: string,
    defaultLevel: LogLevel = "INFO",
    date = new Date(),
): string[] {
    const clean = stripAnsi(message);
    const rawLines = clean.split(/\r?\n/);
    const timestamp = formatLogTimestamp(date);
    const out: string[] = [];

    for (const rawLine of rawLines) {
        const trimmed = rawLine.trim();
        if (trimmed.length === 0) {
            continue;
        }
        if (/^at\s+/.test(trimmed)) {
            out.push(`    ${trimmed}`);
            continue;
        }
        const level = inferLogLevel(trimmed, defaultLevel);
        out.push(`${timestamp} [${level}] ${trimmed}`);
    }

    return out;
}
