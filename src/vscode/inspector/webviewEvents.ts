// Ported from microsoft/vscode-edge-devtools (src/common/webviewEvents.ts).
// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
//
// Shared between the extension host and the webview host bundle — must not
// import "vscode" or any Node-only module.

/** Messages the extension host sends into the webview (and vice versa). */
export type WebviewEvent
    = | "openInEditor"
        | "cssMirrorContent"
        | "ready"
        | "websocket"
        | "openUrl"
        | "toggleScreencast"
        | "replayConsoleMessages"
        | "toggleCSSMirrorContent";

export const webviewEventNames: WebviewEvent[] = [
    "openInEditor",
    "cssMirrorContent",
    "ready",
    "websocket",
    "openUrl",
    "toggleScreencast",
    "replayConsoleMessages",
    "toggleCSSMirrorContent",
];

/** Messages the DevTools iframe posts to the webview main frame. */
export type FrameToolsEvent
    = | "sendMessageToBackend"
        | "openInNewTab"
        | "recordEnumeratedHistogram"
        | "recordPerformanceHistogram"
        | "reportError"
        | "openInEditor"
        | "cssMirrorContent"
        | "toggleScreencast"
        | "replayConsoleMessages"
        | "toggleCSSMirrorContent";

export type WebSocketEvent = "open" | "close" | "error" | "message";

export interface IOpenEditorData {
    url: string;
    line: number;
    column: number;
    ignoreTabChanges: boolean;
}

/**
 * Parse a channel message (`"<event>:<json>"`) and dispatch it via `emit`.
 */
export function parseMessageFromChannel(
    message: string,
    emit: (eventName: WebviewEvent, args: string) => boolean,
): boolean {
    for (const e of webviewEventNames) {
        if (message.startsWith(e) && message[e.length] === ":") {
            emit(e, message.substring(e.length + 1));
            return true;
        }
    }
    return false;
}

/**
 * Encode an event + args into a channel message and post it. The receiver
 * decodes it with {@link parseMessageFromChannel}.
 */
export function encodeMessageForChannel(
    postMessageCallback: (message: string) => void,
    eventType: WebviewEvent,
    args?: unknown,
): void {
    postMessageCallback(`${eventType}:${JSON.stringify(args)}`);
}
