/**
 * Clipboard and macOS keyboard-shortcut bridge for the embedded DevTools
 * inspector iframe.
 *
 * Kept separate from both `devtools-frontend-dist/` (so upstream DevTools
 * upgrades do not overwrite it) and the generic HTTP static file server in
 * `inspectorStaticServer.ts`.
 *
 * Works around two VS Code webview + nested cross-origin iframe limitations:
 * 1. On macOS, VS Code disables native menu accelerators whenever a webview
 *    has focus (`microsoft/vscode#129178`), so `Cmd+C`, `Cmd+X`, and `Cmd+A`
 *    inside the DevTools iframe never trigger the browser's `copy`, `cut`, or
 *    `selectAll` actions.
 * 2. VS Code's outer webview frame does not delegate `clipboard-write`
 *    Permissions-Policy to cross-origin iframes (`microsoft/vscode#182642`),
 *    so `InspectorFrontendHost.copyText` (and selection copy) is forwarded via
 *    `postMessage` to the outer webview and written with `vscode.env.clipboard`.
 */

export const INSPECTOR_CLIPBOARD_SHIM_FILENAME = "uxp_inspector_shim.js";
export const INSPECTOR_COPY_MESSAGE_TYPE = "uxp-inspector-copy";

const SHIM_SCRIPT_TAG = `<script src="./${INSPECTOR_CLIPBOARD_SHIM_FILENAME}"></script>\n`;

/**
 * Browser script served inside the DevTools iframe as
 * {@link INSPECTOR_CLIPBOARD_SHIM_FILENAME}.
 */
export const INSPECTOR_CLIPBOARD_SHIM_SCRIPT = `// UXP Debugger clipboard & macOS shortcut shim.
(function () {
    function postCopyText(text) {
        if (typeof text !== "string") {
            return;
        }
        try {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: "${INSPECTOR_COPY_MESSAGE_TYPE}", text: text }, "*");
            }
        } catch {}
    }

    function deepActiveElement(root) {
        var active = root.activeElement;
        while (active && active.shadowRoot && active.shadowRoot.activeElement) {
            active = active.shadowRoot.activeElement;
        }
        return active;
    }

    function getSelectedText() {
        var active = deepActiveElement(document);
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
            var start = active.selectionStart;
            var end = active.selectionEnd;
            if (typeof start === "number" && typeof end === "number" && end > start) {
                return active.value.slice(start, end);
            }
        }
        if (active && typeof active.getComponentSelection === "function") {
            var compSel = active.getComponentSelection();
            if (compSel && compSel.type === "Range") {
                var compText = compSel.toString();
                if (compText) {
                    return compText;
                }
            }
        }
        var winSel = window.getSelection();
        return winSel ? winSel.toString() : "";
    }

    var wrappedHosts = new WeakSet();
    function patchHost(host) {
        if (!host || typeof host !== "object" || wrappedHosts.has(host)) {
            return;
        }
        wrappedHosts.add(host);
        var orig = typeof host.copyText === "function" ? host.copyText.bind(host) : null;
        host.copyText = function (text) {
            if (text !== undefined && text !== null) {
                postCopyText(String(text));
            }
            if (orig) {
                return orig(text);
            }
        };
    }

    var currentHost = globalThis.InspectorFrontendHost;
    if (currentHost) {
        patchHost(currentHost);
    }
    try {
        Object.defineProperty(globalThis, "InspectorFrontendHost", {
            configurable: true,
            enumerable: true,
            get: function () {
                return currentHost;
            },
            set: function (val) {
                currentHost = val;
                patchHost(val);
            },
        });
    } catch {}

    var isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
    if (!isMac) {
        return;
    }

    document.addEventListener("keydown", function (event) {
        if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
            return;
        }
        if (event.code === "KeyC") {
            var selected = getSelectedText();
            try {
                document.execCommand("copy");
            } catch {}
            if (!selected) {
                selected = getSelectedText();
            }
            if (selected) {
                postCopyText(selected);
            }
            event.stopPropagation();
            event.preventDefault();
        } else if (event.code === "KeyX") {
            try {
                document.execCommand("cut");
            } catch {}
            event.stopPropagation();
            event.preventDefault();
        } else if (event.code === "KeyA") {
            try {
                document.execCommand("selectAll");
            } catch {}
            event.stopPropagation();
            event.preventDefault();
        }
    }, true);
})();
`;

/** Injects the `<script src="./uxp_inspector_shim.js">` tag into the DevTools entrypoint HTML. */
export function injectInspectorClipboardShim(html: string): string {
    if (html.includes(INSPECTOR_CLIPBOARD_SHIM_FILENAME)) {
        return html;
    }
    const scriptMarker = "<script ";
    const idx = html.indexOf(scriptMarker);
    if (idx !== -1) {
        return html.slice(0, idx) + SHIM_SCRIPT_TAG + html.slice(idx);
    }
    return html + SHIM_SCRIPT_TAG;
}

/**
 * Builds the outer webview inline script that relays copy messages from the
 * DevTools iframe (`inspectorOrigin`) to the VS Code extension host.
 */
export function buildWebviewClipboardRelayScript(inspectorOrigin: string): string {
    return `(function () {
      const vscode = acquireVsCodeApi();
      window.addEventListener("message", (event) => {
        if (event.origin !== ${JSON.stringify(inspectorOrigin)}) {
          return;
        }
        const data = event.data;
        if (
          data
          && typeof data === "object"
          && data.type === "${INSPECTOR_COPY_MESSAGE_TYPE}"
          && typeof data.text === "string"
        ) {
          vscode.postMessage({ type: "${INSPECTOR_COPY_MESSAGE_TYPE}", text: data.text });
        }
      });
    })();`;
}

/** Type guard for copy messages received by `webview.onDidReceiveMessage`. */
export function isInspectorCopyMessage(message: unknown): message is { type: string; text: string } {
    return (
        typeof message === "object"
        && message !== null
        && (message as { type?: unknown }).type === INSPECTOR_COPY_MESSAGE_TYPE
        && typeof (message as { text?: unknown }).text === "string"
    );
}
