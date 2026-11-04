// Runs INSIDE the DevTools iframe (loaded by `devtools-frontend-dist/uxp_inspector_app.html`,
// bundled to `dist/devtools/uxp_clipboard_bridge.js` by `scripts/bundle-devtools.mjs`).
//
// DevTools is hosted in a cross-origin iframe inside the VS Code webview. There:
// - `navigator.clipboard.writeText()` (used by DevTools' hosted-mode
//   `InspectorFrontendHost.copyText()`) is rejected, so the "Copy …" context
//   menu items do nothing;
// - on macOS, VS Code implements Cmd+C/Cmd+X for webviews by listening for key
//   presses in the webview's own document, which never sees key presses from
//   this nested iframe.
// The bridge posts the text to the parent webview, which forwards it to the
// extension host to be written with `vscode.env.clipboard.writeText()`.

import { CLIPBOARD_WRITE_MESSAGE, type ClipboardWriteMessage } from "../clipboardBridgeMessage";

function postToExtension(text: string): void {
    if (!text || window.parent === window) {
        return;
    }
    const message: ClipboardWriteMessage = { type: CLIPBOARD_WRITE_MESSAGE, text };
    // The parent's vscode-webview:// origin isn't known here; the parent checks
    // this frame's origin before forwarding the text.
    window.parent.postMessage(message, "*");
}

function deepActiveElement(): Element | null {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
    }
    return active;
}

function selectedText(): string {
    const active = deepActiveElement();
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        const start = active.selectionStart;
        const end = active.selectionEnd;
        // Some input types (e.g. number) don't expose a selection range.
        if (start === null || end === null) {
            return "";
        }
        return active.value.slice(start, end);
    }
    return window.getSelection()?.toString() ?? "";
}

function patchClipboardWriteText(): void {
    // `navigator.clipboard` is undefined in insecure contexts despite its DOM typing.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard) {
        return;
    }
    const original = clipboard.writeText.bind(clipboard);
    Object.defineProperty(clipboard, "writeText", {
        configurable: true,
        writable: true,
        value: async (text: string): Promise<void> => {
            try {
                await original(text);
            }
            catch {
                postToExtension(text);
            }
        },
    });
}

function onCopyOrCut(event: ClipboardEvent): void {
    // DevTools' own handlers (registered earlier / deeper) may have replaced the
    // copied data, e.g. when copying a selected DOM node.
    if (event.defaultPrevented) {
        postToExtension(event.clipboardData?.getData("text/plain") ?? "");
    }
    else {
        postToExtension(selectedText());
    }
}

const isMac = navigator.platform.toUpperCase().includes("MAC");

function onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
    }
    const key = event.key.toLowerCase();
    if (key !== "c" && key !== "x") {
        return;
    }
    const command = key === "c" ? "copy" : "cut";

    // An object, so the flag mutated inside the listener isn't narrowed to `false`.
    const state = { fired: false };
    window.addEventListener(command, () => {
        state.fired = true;
    }, { capture: true, once: true });

    // execCommand is deprecated, but it is the only way to dispatch a trusted
    // copy/cut event, so DevTools' own copy handlers run as with a native Cmd+C.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand(command);

    if (!state.fired) {
        postToExtension(selectedText());
        if (command === "cut") {
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            document.execCommand("delete");
        }
    }
    event.preventDefault();
}

patchClipboardWriteText();
window.addEventListener("copy", onCopyOrCut);
window.addEventListener("cut", onCopyOrCut);
if (isMac) {
    window.addEventListener("keydown", onKeyDown);
}
