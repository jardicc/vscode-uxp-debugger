// Adapted from microsoft/vscode-edge-devtools (src/devtoolsPanel.ts).
// Copyright (c) Microsoft Corporation. Licensed under the MIT License.

import * as path from "path";
import * as vscode from "vscode";
import type { PluginSession } from "../../core/broker/SessionRegistry";
import { TypedEvent } from "../../core/events";
import { DEFAULT_BROKER_PORT } from "../../core/protocol/types";
import type { CdpProxyRegistry } from "../proxy/CdpProxyRegistry";
import { CdpProxyServer } from "../proxy/cdpProxy";
import { INSPECTOR_STATIC_PATH_PREFIX } from "./inspectorStaticServer";

/**
 * Self-hosted, trimmed DevTools-frontend build (Elements + Network only — see
 * docs/UI-DEBUGGING.md), served statically off the broker's own HTTP
 * server (`src/vscode/inspector/inspectorStaticServer.ts`). Replaces the
 * earlier Microsoft-CDN-hosted `vscode_app.html` fork. This stock OSS build
 * has no "embedder API", so it connects to the CDP proxy directly via its own
 * native `?ws=` query param.
 */
const INSPECTOR_ORIGIN = `http://127.0.0.1:${String(DEFAULT_BROKER_PORT)}`;
const INSPECTOR_ENTRYPOINT = `${INSPECTOR_ORIGIN}${INSPECTOR_STATIC_PATH_PREFIX}uxp_inspector_app.html`;

/**
 * The HTML/CSS inspector: a webview embedding the bundled DevTools
 * frontend (Elements/Styles), wired to a broker session's shared
 * `CdpProxyServer` via the `/panel` endpoint. One panel per plugin session.
 */
export class UxpInspectorPanel {
    private static readonly instances = new Map<string, UxpInspectorPanel>();

    /** In-flight `createOrShow()`s — a concurrent call must not double-acquire the proxy. */
    private static readonly creationsInFlight = new Map<string, Promise<void>>();

    /** Fired whenever a panel opens or closes (control-panel introspection). */
    static readonly onDidChangeInstances = new TypedEvent<void>();

    /** Whether an inspector panel is currently open for the session. */
    static isOpen(clientSessionId: string): boolean {
        return UxpInspectorPanel.instances.has(clientSessionId);
    }

    /** `clientSessionId`s of every currently open inspector panel. */
    static openSessionIds(): string[] {
        return [...UxpInspectorPanel.instances.keys()];
    }

    private readonly disposables: vscode.Disposable[] = [];
    private disposed = false;

    /** Open (or reveal) the inspector panel for a broker session. */
    static async createOrShow(
        context: vscode.ExtensionContext,
        session: PluginSession,
        proxyRegistry: CdpProxyRegistry,
        targetWsUrl: string,
        output: vscode.OutputChannel,
    ): Promise<void> {
        const existing = UxpInspectorPanel.instances.get(session.clientSessionId);
        if (existing) {
            existing.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        // A concurrent createOrShow (panel button + LM tool) would pass the
        // `instances` check too and open a second, dead panel — wait for the
        // first creation and reveal its panel instead.
        const inFlight = UxpInspectorPanel.creationsInFlight.get(session.clientSessionId);
        if (inFlight) {
            await inFlight;
            UxpInspectorPanel.instances.get(session.clientSessionId)?.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }
        const creation = UxpInspectorPanel.create(context, session, proxyRegistry, targetWsUrl, output);
        UxpInspectorPanel.creationsInFlight.set(session.clientSessionId, creation);
        try {
            await creation;
        }
        finally {
            UxpInspectorPanel.creationsInFlight.delete(session.clientSessionId);
        }
    }

    private static async create(
        context: vscode.ExtensionContext,
        session: PluginSession,
        proxyRegistry: CdpProxyRegistry,
        targetWsUrl: string,
        output: vscode.OutputChannel,
    ): Promise<void> {
        const sourceRootDir = session.manifestPath
            ? path.dirname(session.manifestPath)
            : session.pluginPath;
        const label = `${session.name} (${session.app.appName} ${session.app.appVersion})`;
        const { port } = await proxyRegistry.acquire(
            session.clientSessionId,
            targetWsUrl,
            label,
            sourceRootDir,
            false,
        );

        const panel = vscode.window.createWebviewPanel(
            "uxpInspector",
            `UXP UI – ${session.name}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, "dist"))],
            },
        );

        UxpInspectorPanel.instances.set(
            session.clientSessionId,
            new UxpInspectorPanel(panel, session, proxyRegistry, port, output),
        );
        UxpInspectorPanel.onDidChangeInstances.emit();
    }

    /** Close the panel of one session (plugin unloaded / app gone). */
    static disposeForSession(clientSessionId: string): void {
        UxpInspectorPanel.instances.get(clientSessionId)?.panel.dispose();
    }

    /** Close every open inspector panel (takeover / deactivate). */
    static disposeAll(): void {
        for (const instance of [...UxpInspectorPanel.instances.values()]) {
            instance.panel.dispose();
        }
    }

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly session: PluginSession,
        private readonly proxyRegistry: CdpProxyRegistry,
        private readonly proxyPort: number,
        private readonly output: vscode.OutputChannel,
    ) {
        this.panel.onDidDispose(() => {
            this.dispose();
        }, this, this.disposables);

        // Re-render (new theme param) when the user switches color themes.
        vscode.workspace.onDidChangeConfiguration(
            (e) => {
                if (e.affectsConfiguration("workbench.colorTheme") && this.panel.visible) {
                    this.update();
                }
            },
            this,
            this.disposables,
        );

        this.update();
    }

    private dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        UxpInspectorPanel.instances.delete(this.session.clientSessionId);
        UxpInspectorPanel.onDidChangeInstances.emit();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.proxyRegistry.release(this.session.clientSessionId).catch((err: unknown) => {
            this.output.appendLine(
                `[inspector] Failed to release the CDP proxy: ${err instanceof Error ? err.message : String(err)}`,
            );
        });
        this.output.appendLine(`[inspector] Panel for "${this.session.name}" closed.`);
    }

    // ---------------------------------------------------------------------
    // Webview HTML
    // ---------------------------------------------------------------------

    private update(): void {
        this.panel.webview.html = this.getHtmlForWebview();
    }

    private getHtmlForWebview(): string {
        const webview = this.panel.webview;
        // Native ws:// connection straight to the CDP proxy's `/panel` endpoint.
        const wsTarget = `127.0.0.1:${String(this.proxyPort)}${CdpProxyServer.PANEL_PATH}`;
        const frontendUrl = `${INSPECTOR_ENTRYPOINT}?ws=${encodeURIComponent(wsTarget)}&panel=elements`;

        return `<!doctype html>
<html>
<head>
  <meta http-equiv="content-type" content="text/html; charset=utf-8">
  <meta name="referrer" content="no-referrer">
  <style>
    html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
    #devtools-frame { width: 100%; height: 100%; border: 0; }
  </style>
  <meta http-equiv="Content-Security-Policy"
    content="default-src;
    img-src 'self' data: ${webview.cspSource};
    style-src 'self' 'unsafe-inline' ${webview.cspSource};
    script-src 'self' 'unsafe-eval' ${webview.cspSource};
    frame-src 'self' ${webview.cspSource} ${INSPECTOR_ORIGIN};
    connect-src 'self' data: ${webview.cspSource};
  ">
</head>
<body>
  <iframe id="devtools-frame" allow="clipboard-read; clipboard-write *"
    frameborder="0" src="${frontendUrl}"></iframe>
</body>
</html>`;
    }
}
