// Ported from microsoft/vscode-edge-devtools (src/host/messageRouter.ts).
// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
//
// Runs INSIDE the webview main frame (browser context, bundled to
// dist/inspectorHost.js). Routes messages between the DevTools iframe and
// the extension host based on postMessage origin, and implements the
// embedder-API callbacks the Microsoft-hosted DevTools frontend expects.

import {
    encodeMessageForChannel,
    type FrameToolsEvent,
    type IOpenEditorData,
    parseMessageFromChannel,
    type WebSocketEvent,
    type WebviewEvent,
} from "../webviewEvents";

declare const acquireVsCodeApi: () => { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();

const postToExtension = (msg: string) => {
    vscode.postMessage(msg);
};

export class MessageRouter {
    private toolsFrameWindow: Window | null | undefined;
    private errorMessageDiv: HTMLElement | null | undefined;
    private devtoolsActionReceived = false;

    constructor(webviewWindow: Window) {
        webviewWindow.addEventListener("DOMContentLoaded", () => {
            const frame = document.getElementById("devtools-frame") as HTMLIFrameElement | null;
            this.toolsFrameWindow = frame?.contentWindow;
            this.toolsFrameWindow?.addEventListener("load", () => {
                this.devtoolsActionReceived = true;
            });
            this.errorMessageDiv = document.getElementById("error-message");
        });

        // Both the DevTools iframe and the extension post messages to this
        // window — route by origin.
        webviewWindow.addEventListener(
            "message",
            (messageEvent) => {
                const fromExtension = messageEvent.origin.startsWith("vscode-webview://");
                if (!fromExtension) {
                    this.devtoolsActionReceived = true;
                    if (typeof messageEvent.data === "string") {
                        // Channel-encoded string from the frontend's embedder glue
                        // (getState/setState/getVscodeSettings/…) — relay verbatim.
                        postToExtension(messageEvent.data);
                    }
                    else {
                        const data = messageEvent.data as { method: FrameToolsEvent; args: unknown[] };
                        this.onMessageFromFrame(data.method, data.args);
                    }
                }
                else if (this.toolsFrameWindow) {
                    const raw = messageEvent.data as string;
                    parseMessageFromChannel(raw, (e, args) => this.onMessageFromChannel(raw, e, args));
                    messageEvent.preventDefault();
                    messageEvent.stopImmediatePropagation();
                }
            },
            true,
        );

        // Inform the extension we are ready to receive messages.
        encodeMessageForChannel(postToExtension, "ready");

        // Show an error message if the DevTools frontend never loads (CDN
        // unreachable / bad revision).
        setTimeout(() => {
            this.showLoadingError();
        }, 10_000);
    }

    private onMessageFromFrame(e: FrameToolsEvent, args: unknown[]): void {
        switch (e) {
            case "sendMessageToBackend": {
                const [cdpMessage] = args as [string];
                encodeMessageForChannel(postToExtension, "websocket", { message: cdpMessage });
                return;
            }
            case "openInEditor": {
                const [url, line, column, ignoreTabChanges] = args as [string, number, number, boolean];
                const request: IOpenEditorData = { url, line, column, ignoreTabChanges };
                encodeMessageForChannel(postToExtension, "openInEditor", request);
                return;
            }
            case "openInNewTab": {
                const [url] = args as [string];
                encodeMessageForChannel(postToExtension, "openUrl", { url });
                return;
            }
            case "cssMirrorContent": {
                const [url, newContent] = args as [string, string];
                encodeMessageForChannel(postToExtension, "cssMirrorContent", { url, newContent });
                return;
            }
            case "toggleCSSMirrorContent": {
                const [isEnabled] = args as [boolean];
                encodeMessageForChannel(postToExtension, "toggleCSSMirrorContent", { isEnabled });
                return;
            }
            case "replayConsoleMessages": {
                encodeMessageForChannel(postToExtension, "replayConsoleMessages");
                return;
            }
            case "toggleScreencast": {
                encodeMessageForChannel(postToExtension, "toggleScreencast");
                return;
            }
            case "recordEnumeratedHistogram":
            case "recordPerformanceHistogram":
            case "reportError":
                // Telemetry — deliberately dropped (this extension collects none).
                return;
            default:
                return;
        }
    }

    private onMessageFromChannel(raw: string, e: WebviewEvent, args: string): boolean {
        if (e === "websocket") {
            const { event, message } = JSON.parse(args) as { event: WebSocketEvent; message: string };
            this.fireWebSocketCallback(event, message);
        }
        else {
            // Reply to a frontend request (getState/getVscodeSettings/getUrl/…):
            // relay the channel-encoded string verbatim into the iframe, where the
            // frontend's embedder glue decodes it.
            this.toolsFrameWindow?.postMessage(raw, "*");
        }
        return true;
    }

    private fireWebSocketCallback(e: WebSocketEvent, message: string): void {
        if (this.toolsFrameWindow && e === "message") {
            this.toolsFrameWindow.postMessage({ method: "dispatchMessage", args: [message] }, "*");
        }
    }

    private showLoadingError(): void {
        if (this.devtoolsActionReceived || !this.errorMessageDiv) {
            return;
        }
        this.errorMessageDiv.classList.remove("hidden");
    }
}
