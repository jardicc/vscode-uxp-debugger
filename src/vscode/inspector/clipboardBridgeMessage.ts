// Shared between the extension host, the inspector webview and the DevTools
// iframe bundle (`frame/clipboardBridge.ts`) — must not import "vscode" or any
// Node-only module.

/**
 * Message type the DevTools iframe posts up to the webview (and the webview
 * forwards to the extension host) to write text to the system clipboard.
 */
export const CLIPBOARD_WRITE_MESSAGE = "uxp-clipboard-write";

export interface ClipboardWriteMessage {
    type: typeof CLIPBOARD_WRITE_MESSAGE;
    text: string;
}

export function isClipboardWriteMessage(value: unknown): value is ClipboardWriteMessage {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const message = value as Partial<Record<keyof ClipboardWriteMessage, unknown>>;
    return message.type === CLIPBOARD_WRITE_MESSAGE && typeof message.text === "string";
}
