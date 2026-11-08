import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createWebviewPanelMock, clipboardWriteTextMock } = vi.hoisted(() => ({
    createWebviewPanelMock: vi.fn(),
    clipboardWriteTextMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("vscode", () => ({
    ViewColumn: { Beside: 2 },
    Uri: { file: (p: string) => ({ fsPath: p }) },
    env: {
        clipboard: {
            writeText: clipboardWriteTextMock,
        },
    },
    window: {
        createWebviewPanel: createWebviewPanelMock,
    },
    workspace: {
        onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    },
}));

import type * as vscode from "vscode";
import type { PluginSession } from "../../src/core/broker/SessionRegistry";
import {
    createInspectorStaticHandler,
    INSPECTOR_CSP,
    INSPECTOR_STATIC_PATH_PREFIX,
} from "../../src/vscode/inspector/inspectorStaticServer";
import { UxpInspectorPanel } from "../../src/vscode/inspector/UxpInspectorPanel";
import type { CdpProxyRegistry } from "../../src/vscode/proxy/CdpProxyRegistry";
import { fakeLog } from "../fixtures/fakeVscode";

describe("inspectorStaticServer & bundled DevTools CSP (S5)", () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        clipboardWriteTextMock.mockClear();
        UxpInspectorPanel.disposeAll();
    });

    it("enforces a strict Content-Security-Policy without external Google origins or wildcard frame-src", () => {
        expect(INSPECTOR_CSP).not.toContain("appspot.com");
        expect(INSPECTOR_CSP).not.toContain("googleapis.com");
        expect(INSPECTOR_CSP).not.toContain("frame-src *");
        expect(INSPECTOR_CSP).toContain("script-src 'self'");
        expect(INSPECTOR_CSP).toContain("frame-src 'self' data:");
        expect(INSPECTOR_CSP).toContain("connect-src 'self' data: devtools: ws://127.0.0.1:*;");
    });

    it("keeps the bundled uxp_inspector_app.html meta CSP aligned with INSPECTOR_CSP", () => {
        const htmlPath = path.resolve(__dirname, "..", "..", "devtools-frontend-dist", "uxp_inspector_app.html");
        const html = fs.readFileSync(htmlPath, "utf8");
        expect(html).not.toContain("appspot.com");
        expect(html).not.toContain("googleapis.com");
        expect(html).not.toContain("frame-src *");
        expect(html).toContain(`content="${INSPECTOR_CSP}"`);
    });

    it("serves static files with the Content-Security-Policy and Cache-Control headers", async () => {
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-inspector-csp-"));
        tempDirs.push(rootDir);
        fs.writeFileSync(path.join(rootDir, "uxp_inspector_app.html"), "<!doctype html><title>DevTools</title>");

        const handler = createInspectorStaticHandler(rootDir);
        const server = http.createServer((req, res) => {
            if (!handler(req, res, req.url ?? "/")) {
                res.writeHead(404).end();
            }
        });

        await new Promise<void>((resolve) => {
            server.listen(0, "127.0.0.1", resolve);
        });

        try {
            const addr = server.address();
            const port = typeof addr === "object" && addr ? addr.port : 0;

            const response = await fetch(
                `http://127.0.0.1:${String(port)}${INSPECTOR_STATIC_PATH_PREFIX}uxp_inspector_app.html`,
            );
            expect(response.status).toBe(200);
            expect(response.headers.get("content-security-policy")).toBe(INSPECTOR_CSP);
            expect(response.headers.get("cache-control")).toBe("no-store");
            expect(await response.text()).toBe(
                // "<!doctype html><title>DevTools</title><script src=\"./uxp_inspector_shim.js\"></script>\n",
                "<!doctype html><title>DevTools</title>",
            );

            // const shimResponse = await fetch(
            //     `http://127.0.0.1:${String(port)}${INSPECTOR_STATIC_PATH_PREFIX}uxp_inspector_shim.js`,
            // );
            // expect(shimResponse.status).toBe(200);
            // expect(shimResponse.headers.get("content-security-policy")).toBe(INSPECTOR_CSP);
            // expect(shimResponse.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
            // const shimSource = await shimResponse.text();
            // expect(shimSource).toContain("uxp-inspector-copy");
            // expect(shimSource).toContain("execCommand(\"copy\")");

            const postResponse = await fetch(
                `http://127.0.0.1:${String(port)}${INSPECTOR_STATIC_PATH_PREFIX}uxp_inspector_app.html`,
                { method: "POST" },
            );
            expect(postResponse.status).toBe(405);
        }
        finally {
            await new Promise<void>((resolve) => {
                server.close(() => {
                    resolve();
                });
            });
        }
    });

    it("renders the outer webview HTML with default-src 'none', nonce script-src, no unsafe-eval, and origin-scoped clipboard allow", async () => {
        let disposeListener: (() => void) | undefined;
        let messageListener: ((msg: unknown) => void) | undefined;
        const fakePanel = {
            visible: true,
            webview: {
                html: "",
                cspSource: "vscode-webview://test",
                onDidReceiveMessage: vi.fn((cb: (msg: unknown) => void) => {
                    messageListener = cb;
                    return { dispose: vi.fn() };
                }),
            },
            reveal: vi.fn(),
            onDidDispose: vi.fn((cb: () => void) => {
                disposeListener = cb;
                return { dispose: vi.fn() };
            }),
            dispose: vi.fn(() => {
                disposeListener?.();
            }),
        };
        createWebviewPanelMock.mockReturnValue(fakePanel);

        const proxyRegistry = {
            acquire: vi.fn(() => Promise.resolve({ port: 54321 })),
            release: vi.fn(() => Promise.resolve()),
        } as unknown as CdpProxyRegistry;

        const session: PluginSession = {
            clientSessionId: "session-csp-1",
            hostSessionId: "host-1",
            kind: "plugin",
            pluginId: "com.example.plugin",
            name: "Example",
            pluginPath: "/tmp/plugin",
            manifestPath: "/tmp/plugin/manifest.json",
            app: {
                appId: "PS",
                appName: "Photoshop",
                appVersion: "25.0",
                uxpVersion: "7.4.0",
                platform: "win32",
            },
            appConnectionId: 1,
        };

        await UxpInspectorPanel.createOrShow(
            { extensionPath: "/tmp/ext" } as unknown as vscode.ExtensionContext,
            session,
            proxyRegistry,
            "ws://127.0.0.1:14001/socket/cdt/session-csp-1",
            fakeLog(),
        );

        const html = fakePanel.webview.html;
        expect(html).toMatch(
            /default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-[A-Za-z0-9+/=]+';/,
        );
        expect(html).toContain("frame-src http://127.0.0.1:14001;");
        expect(html).not.toContain("unsafe-eval");
        expect(html).not.toContain("clipboard-write *");
        expect(html).toContain(
            "allow=\"clipboard-read http://127.0.0.1:14001; clipboard-write http://127.0.0.1:14001\"",
        );

        messageListener?.({ type: "uxp-inspector-copy", text: "copied text" });
        expect(clipboardWriteTextMock).toHaveBeenCalledWith("copied text");
    });
});
