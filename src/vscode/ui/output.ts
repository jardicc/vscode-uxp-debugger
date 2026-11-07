/**
 * Output channels: creates VS Code `LogOutputChannel` instances
 * (`vscode.window.createOutputChannel(name, { log: true })`) for both the main
 * "UXP Debugger" diagnostics channel and the per-host-app `UXP/log` channels,
 * routing messages through the shared `src/core/logFormat.ts` level inference
 * so timestamps, levels, colors, and level filtering work uniformly.
 */

import * as vscode from "vscode";
import type { HostLogEvent } from "../../core/broker/AppConnection";
import { inferLogLevel, type LogLevel, parseHostLogLevel } from "../../core/logFormat";

export interface UxpOutputChannelOptions {
    /**
     * When set (e.g. `"[UXP Debugger]"` during E2E runs), every logged line is
     * also tee'd to `console` with this prefix so the E2E harness records it in
     * `logs/e2e/test-run_*.log`.
     */
    teeToConsolePrefix?: string;
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
        case "INFO":
        default:
            // eslint-disable-next-line no-console -- E2E diagnostics are recorded by the test runner.
            console.log(text);
            break;
    }
}

/**
 * Creates a `vscode.LogOutputChannel` (`{ log: true }`) whose `appendLine`
 * automatically infers the log level (`DEBUG` / `INFO` / `WARN` / `ERROR`)
 * using the shared `inferLogLevel()` rules and delegates to the corresponding
 * `LogOutputChannel` level method.
 */
export function createUxpOutputChannel(
    name: string,
    options?: UxpOutputChannelOptions,
): vscode.LogOutputChannel {
    const channel = vscode.window.createOutputChannel(name, { log: true });
    const nativeMethods = {
        debug: channel.debug.bind(channel),
        info: channel.info.bind(channel),
        warn: channel.warn.bind(channel),
        error: channel.error.bind(channel),
    };
    const prefix = options?.teeToConsolePrefix;

    channel.appendLine = (value: string): void => {
        const level = inferLogLevel(value);
        logToChannel(nativeMethods, level, value);
        if (prefix) {
            teeToConsole(level, prefix, value);
        }
    };

    return channel;
}

export class HostLogChannels implements vscode.Disposable {
    private readonly channels = new Map<string, vscode.LogOutputChannel>();

    constructor(private readonly teeInE2e = false) {}

    append(event: HostLogEvent): void {
        const key = `${event.appInfo.appId}@${event.appInfo.appVersion}`;
        const label = `UXP – ${event.appInfo.appName} ${event.appInfo.appVersion}`;
        let channel = this.channels.get(key);
        if (!channel) {
            channel = createUxpOutputChannel(label);
            this.channels.set(key, channel);
        }
        const level = parseHostLogLevel(event.level, event.message);
        logToChannel(channel, level, event.message);
        if (this.teeInE2e) {
            teeToConsole(level, `[${label}]`, event.message);
        }
    }

    dispose(): void {
        for (const channel of this.channels.values()) {
            channel.dispose();
        }
        this.channels.clear();
    }
}
