/**
 * Shared log formatting and level utilities used by both the VS Code
 * extension (`src/vscode/ui/output.ts`) and the E2E test harness (`e2e/e2eLog.ts`).
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = typeof LOG_LEVELS[number];

/**
 * Leveled logger used across the core and the extension. `vscode.LogOutputChannel`
 * satisfies it structurally, so the extension passes its output channel directly.
 */
export type Logger = Record<LogLevel, (message: string) => void>;

export const NOOP_LOGGER: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

/** Wraps `logger` so every message is prefixed (e.g. `"[broker] "`). */
export function prefixLogger(logger: Logger, prefix: string): Logger {
    const prefixed = {} as Logger;
    for (const level of LOG_LEVELS) {
        prefixed[level] = (message) => {
            logger[level](`${prefix}${message}`);
        };
    }
    return prefixed;
}

/** Values of the `uxp.logLevel` setting. */
export type ConfiguredLogLevel = LogLevel | "off";

export const DEFAULT_CONFIGURED_LOG_LEVEL: ConfiguredLogLevel = "info";

const SEVERITY: Record<ConfiguredLogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    off: Number.POSITIVE_INFINITY,
};

/** Validates an untrusted `uxp.logLevel` value, falling back to the default. */
export function parseConfiguredLogLevel(value: unknown): ConfiguredLogLevel {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(SEVERITY, value)
        ? (value as ConfiguredLogLevel)
        : DEFAULT_CONFIGURED_LOG_LEVEL;
}

/** Whether a message of `level` passes the configured minimum level. */
export function isLogLevelEnabled(level: LogLevel, configured: ConfiguredLogLevel): boolean {
    return SEVERITY[level] >= SEVERITY[configured];
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

const HOST_LEVELS = new Map<string, LogLevel>([
    ["error", "error"],
    ["err", "error"],
    ["fatal", "error"],
    ["warn", "warn"],
    ["warning", "warn"],
    ["debug", "debug"],
    ["trace", "debug"],
    ["verbose", "debug"],
]);

/**
 * Normalizes a `UXP/log` host event level string (`"error"`, `"warn"`,
 * `"debug"`, `"info"`, `"log"`, etc.) to a standard `LogLevel`; unknown names are `info`.
 */
export function parseHostLogLevel(level: string): LogLevel {
    return HOST_LEVELS.get(level.trim().toLowerCase()) ?? "info";
}

/**
 * Formats a (potentially multi-line) message into standard `.log` lines.
 * Stack trace frames (`at ...`) are kept indented as `    at ...` without a
 * timestamp prefix so VS Code's `log.tmLanguage.json` (`^[\t ]*at[\t ]`)
 * highlights them as `log.exception`.
 */
export function formatLogLines(
    message: string,
    level: LogLevel = "info",
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
        out.push(`${timestamp} [${level.toUpperCase()}] ${trimmed}`);
    }

    return out;
}
