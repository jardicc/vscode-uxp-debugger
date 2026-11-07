/**
 * Output channels: creates VS Code `LogOutputChannel` instances
 * (`vscode.window.createOutputChannel(name, { log: true })`) for both the main
 * "UXP Debugger" diagnostics channel and the per-host-app `UXP/log` channels,
 * applying the shared `src/core/logFormat.ts` level filter so timestamps,
 * levels, colors, and level filtering work uniformly.
 */

import * as vscode from "vscode";
import type { HostLogEvent } from "../../core/broker/AppConnection";
import {
    type ConfiguredLogLevel,
    isLogLevelEnabled,
    type LogLevel,
    parseConfiguredLogLevel,
    parseHostLogLevel,
} from "../../core/logFormat";

/**
 * Returns the configured minimum level, or `undefined` when filtering must be
 * skipped (development, tests and E2E always log everything).
 */
export type LogLevelProvider = () => ConfiguredLogLevel | undefined;

export interface UxpOutputChannelOptions {
    /**
     * When set (e.g. `"[UXP Debugger]"` during E2E runs), every logged line is
     * also tee'd to `console` with this prefix so the E2E harness records it in
     * `logs/e2e/test-run_*.log`.
     */
    teeToConsolePrefix?: string;
    /** Filters the VS Code output channel (not the console tee) by level. */
    getMinLevel?: LogLevelProvider;
}

function isEnabled(level: LogLevel, getMinLevel: LogLevelProvider | undefined): boolean {
    const configured = getMinLevel?.();
    return configured === undefined || isLogLevelEnabled(level, configured);
}

/**
 * Dispatches a message to the appropriate `vscode.LogOutputChannel` method
 * (`debug` / `info` / `warn` / `error`) for native timestamp, level, and syntax
 * highlighting in VS Code's Output panel.
 */
export function logToChannel(
    channel: Pick<vscode.LogOutputChannel, "debug" | "info" | "warn" | "error">,
    level: LogLevel,
    message: string,
): void {
    switch (level) {
        case "DEBUG":
            channel.debug(message);
            break;
        case "WARN":
            channel.warn(message);
            break;
        case "ERROR":
            channel.error(message);
            break;
        case "INFO":
        default:
            channel.info(message);
            break;
    }
}

function teeToConsole(level: LogLevel, prefix: string, message: string): void {
    const text = `${prefix} ${message}`;
    switch (level) {
        case "WARN":
            console.warn(text);
            break;
        case "ERROR":
            console.error(text);
            break;
        case "DEBUG":
            // eslint-disable-next-line no-console -- E2E diagnostics are recorded by the test runner.
            console.debug(text);
            break;
        case "INFO":
        default:
            // eslint-disable-next-line no-console -- E2E diagnostics are recorded by the test runner.
            console.log(text);
            break;
    }
}

/**
 * Creates a `vscode.LogOutputChannel` (`{ log: true }`) whose `debug` / `info` /
 * `warn` / `error` methods apply the `uxp.logLevel` filter and, during E2E runs,
 * tee each line to `console` at the matching level.
 */
export function createUxpOutputChannel(
    name: string,
    options?: UxpOutputChannelOptions,
): vscode.LogOutputChannel {
    const channel = vscode.window.createOutputChannel(name, { log: true });
    const prefix = options?.teeToConsolePrefix;

    const wrap = (level: LogLevel, native: (message: string, ...args: unknown[]) => void) =>
        (message: string, ...args: unknown[]): void => {
            if (isEnabled(level, options?.getMinLevel)) {
                native(message, ...args);
            }
            if (prefix) {
                teeToConsole(level, prefix, message);
            }
        };

    channel.debug = wrap("DEBUG", channel.debug.bind(channel));
    channel.info = wrap("INFO", channel.info.bind(channel));
    channel.warn = wrap("WARN", channel.warn.bind(channel));
    channel.error = wrap("ERROR", channel.error.bind(channel));

    return channel;
}

/**
 * Reads `uxp.logLevel` (cached, refreshed on change). Only a production
 * extension honors the setting; development/test hosts get `undefined`, i.e. log everything.
 */
export function createLogLevelProvider(
    context: vscode.ExtensionContext,
    forceAll: boolean,
): LogLevelProvider {
    if (forceAll || context.extensionMode !== vscode.ExtensionMode.Production) {
        return () => undefined;
    }
    const read = (): ConfiguredLogLevel =>
        parseConfiguredLogLevel(vscode.workspace.getConfiguration("uxp").get("logLevel"));
    let current = read();
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("uxp.logLevel")) {
                current = read();
            }
        }),
    );
    return () => current;
}

export class HostLogChannels implements vscode.Disposable {
    private readonly channels = new Map<string, vscode.LogOutputChannel>();

    constructor(
        private readonly teeInE2e = false,
        private readonly getMinLevel?: LogLevelProvider,
    ) {}

    append(event: HostLogEvent): void {
        const key = `${event.appInfo.appId}@${event.appInfo.appVersion}`;
        const label = `UXP – ${event.appInfo.appName} ${event.appInfo.appVersion}`;
        const level = parseHostLogLevel(event.level);
        if (this.teeInE2e) {
            teeToConsole(level, `[${label}]`, event.message);
        }
        if (!isEnabled(level, this.getMinLevel)) {
            return;
        }
        let channel = this.channels.get(key);
        if (!channel) {
            channel = createUxpOutputChannel(label);
            this.channels.set(key, channel);
        }
        logToChannel(channel, level, event.message);
    }

    dispose(): void {
        for (const channel of this.channels.values()) {
            channel.dispose();
        }
        this.channels.clear();
    }
}
