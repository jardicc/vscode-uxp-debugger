/**
 * `WebviewViewProvider` for the control panel sidebar view
 * (CONTROL-PANEL.md §3/§4) — HTML shell only; all logic lives in
 * `PanelController`, all rendering in the React bundle (dist/panel.js).
 */

import * as crypto from "crypto";
import * as vscode from "vscode";
import type { PanelController } from "./PanelController";

export const CONTROL_PANEL_VIEW_ID = "uxp.controlPanel";

export class ControlPanelProvider implements vscode.WebviewViewProvider {
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly controller: PanelController,
    ) {}

    resolveWebviewView(view: vscode.WebviewView): void {
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
        };
        view.webview.html = this.renderHtml(view.webview);

        const attachment = this.controller.attachWebview(view.webview);
        view.onDidDispose(() => {
            attachment.dispose();
        });
        view.onDidChangeVisibility(() => {
            if (view.visible) {
                this.controller.postState();
            }
        });
        this.controller.postState();
    }

    private renderHtml(webview: vscode.Webview): string {
        const distUri = (file: string) =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", file));
        const nonce = getNonce();
        const csp = [
            "default-src 'none'",
            `style-src ${webview.cspSource}`,
            `font-src ${webview.cspSource}`,
            `img-src ${webview.cspSource}`,
            `script-src 'nonce-${nonce}'`,
        ].join("; ");

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${distUri("panel.css").toString()}">
  <title>UXP Devtools</title>
</head>
<body>
  <div id="root"></div>
    <script nonce="${nonce}" src="${distUri("panel.js").toString()}"></script>
</body>
</html>`;
    }
}

function getNonce(): string {
    return crypto.randomBytes(16).toString("base64");
}
