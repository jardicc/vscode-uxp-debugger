/**
 * Output channels: the main "UXP Debugger" diagnostics channel is created in
 * extension.ts; this module manages the per-host-app log channels fed by
 * `UXP/log` events.
 */

import * as vscode from "vscode";
import type { HostLogEvent } from "../../core/broker/AppConnection";

export class HostLogChannels implements vscode.Disposable {
    private readonly channels = new Map<string, vscode.OutputChannel>();

    append(event: HostLogEvent): void {
        const key = `${event.appInfo.appId}@${event.appInfo.appVersion}`;
        let channel = this.channels.get(key);
        if (!channel) {
            channel = vscode.window.createOutputChannel(
                `UXP – ${event.appInfo.appName} ${event.appInfo.appVersion}`,
            );
            this.channels.set(key, channel);
        }
        channel.appendLine(`[${event.level}] ${event.message}`);
    }

    dispose(): void {
        for (const channel of this.channels.values()) {
            channel.dispose();
        }
        this.channels.clear();
    }
}
