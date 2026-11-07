/**
 * Shared log formatting and level utilities used by both the VS Code
 * extension (`src/vscode/ui/output.ts`) and the E2E test harness (`e2e/e2eLog.ts`).
 */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/**
 * Leveled logger used across the core and the extension. `vscode.LogOutputChannel`
 * satisfies it structurally, so the extension passes its output channel directly.
 */
export interface Logger {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export const NOOP_LOGGER: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

/** Wraps `logger` so every message is prefixed (e.g. `"[broker] "`). */
export function prefixLogger(logger: Logger, prefix: string): Logger {
    return {
        debug: (message) => { logger.debug(`${prefix}${message}`); },
        info: (message) => { logger.info(`${prefix}${message}`); },
        warn: (message) => { logger.warn(`${prefix}${message}`); },
        error: (message) => { logger.error(`${prefix}${message}`); },
    };
}

/** Values of the `uxp.logLevel` setting. */
export type ConfiguredLogLevel = "off" | "error" | "warn" | "info" | "debug";

export const DEFAULT_CONFIGURED_LOG_LEVEL: ConfiguredLogLevel = "info";

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

const CONFIGURED_LEVEL_MIN_SEVERITY: Record<ConfiguredLogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    off: Number.POSITIVE_INFINITY,
};

/** Validates an untrusted `uxp.logLevel` value, falling back to the default. */
export function parseConfiguredLogLevel(value: unknown): ConfiguredLogLevel {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(CONFIGURED_LEVEL_MIN_SEVERITY, value)
        ? (value as ConfiguredLogLevel)
        : DEFAULT_CONFIGURED_LOG_LEVEL;
}

/** Whether a message of `level` passes the configured minimum level. */
export function isLogLevelEnabled(level: LogLevel, configured: ConfiguredLogLevel): boolean {
    return LOG_LEVEL_SEVERITY[level] >= CONFIGURED_LEVEL_MIN_SEVERITY[configured];
}

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

/**
 * Normalizes a `UXP/log` host event level string (`"error"`, `"warn"`,
 * `"debug"`, `"info"`, `"log"`, etc.) to a standard `LogLevel`.
 */
export function parseHostLogLevel(level: string): LogLevel {
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
    return "INFO";
}

/**
 * Formats a (potentially multi-line) message into standard `.log` lines.
 * Stack trace frames (`at ...`) are kept indented as `    at ...` without a
 * timestamp prefix so VS Code's `log.tmLanguage.json` (`^[\t ]*at[\t ]`)
 * highlights them as `log.exception`.
 */
export function formatLogLines(
    message: string,
    level: LogLevel = "INFO",
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
        out.push(`${timestamp} [${level}] ${trimmed}`);
    }

    return out;
}
