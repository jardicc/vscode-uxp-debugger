/**
 * Live e2e: rendered HTML-inspector UI.
 *
 * Opens the real VS Code webview against a live Photoshop plugin, then uses
 * Electron's test-only CDP port to inspect the rendered DevTools shadow DOM.
 */

import * as assert from "assert";
import * as http from "http";
import * as vscode from "vscode";
import WebSocket from "ws";
import {
    activateExtension,
    attachAndAssertStarted,
    describeLive,
    POLL_INTERVAL,
    TIMEOUT_UI,
    detachAndAssertStopped,
    fixturePluginDir,
    manifestPath,
    unloadAllSessions,
} from "./liveHelpers";

interface RendererTarget {
    url: string;
    webSocketDebuggerUrl?: string;
}

interface CdpReply {
    id?: number;
    result?: {
        result?: {
            value?: unknown;
        };
    };
    error?: {
        message?: string;
    };
}

const rendererCdpPort = Number(process.env.UXP_E2E_RENDERER_CDP_PORT ?? "9333");

describeLive("HTML inspector rendered UI (live Photoshop)", function () {
    this.timeout(TIMEOUT_UI);

    it("renders exactly the Elements and Network main tabs", async () => {
        const api = await activateExtension();
        let inspectorOpened = false;
        let vsSession: vscode.DebugSession | undefined;
        try {
            const loadResult = await api.service.loadPlugin(manifestPath);
            assert.ok(loadResult.sessions.length > 0, "expected at least one loaded session");
            const session = loadResult.sessions[0];

            vsSession = await attachAndAssertStarted(api, session, fixturePluginDir);
            await vscode.commands.executeCommand("uxp.openHtmlInspector");
            inspectorOpened = true;

            const target = await waitForInspectorTarget(15_000);
            const renderedState = await waitForRenderedInspector(target, 15_000);

            assert.deepStrictEqual(renderedState.mainTabs, ["Elements", "Network"]);
            assert.strictEqual(renderedState.elementsPanelVisible, true, "expected the Elements panel to be visible");
        }
        finally {
            if (inspectorOpened) {
                await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            }
            if (vsSession) {
                await detachAndAssertStopped(api, vsSession);
            }
            await unloadAllSessions(api, manifestPath);
        }
    });
});

async function waitForRenderedInspector(
    target: RendererTarget,
    timeoutMs: number,
): Promise<{ mainTabs: string[]; elementsPanelVisible: boolean }> {
    const expression = `(() => {
                const tabLists = [];
                const visit = root => {
                    for (const element of root.querySelectorAll('[role="tablist"]')) {
                        if (element.getAttribute('aria-label') === 'Panels') {
                            tabLists.push(element);
                        }
                    }
                    for (const element of root.querySelectorAll('*')) {
                        if (element.shadowRoot) visit(element.shadowRoot);
                    }
                };
                visit(document);
                const mainTabs = tabLists.flatMap(tabList =>
                    [...tabList.querySelectorAll('[role="tab"]')]
                        .filter(tab => tab.getClientRects().length > 0)
                        .map(tab => (tab.getAttribute('aria-label') || tab.textContent || '').trim()),
                );
                const elementsPanelVisible = (() => {
                    const panels = [];
                    const collect = root => {
                        panels.push(...root.querySelectorAll('[role="tabpanel"][aria-label="Elements panel"]'));
                        for (const element of root.querySelectorAll('*')) {
                            if (element.shadowRoot) collect(element.shadowRoot);
                        }
                    };
                    collect(document);
                    return panels.some(panel => panel.getClientRects().length > 0);
                })();
                return { mainTabs, elementsPanelVisible };
            })()`;
    const startedAt = Date.now();
    let lastState = { mainTabs: [] as string[], elementsPanelVisible: false };
    while (Date.now() - startedAt < timeoutMs) {
        lastState = await evaluateInTarget<typeof lastState>(target, expression);
        if (lastState.mainTabs.length > 0 && lastState.elementsPanelVisible) {
            return lastState;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
    throw new Error(`timed out waiting for rendered inspector UI; last state: ${JSON.stringify(lastState)}`);
}

async function waitForInspectorTarget(timeoutMs: number): Promise<RendererTarget> {
    const startedAt = Date.now();
    let lastError: unknown;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const targets = await getJson<RendererTarget[]>(`http://127.0.0.1:${String(rendererCdpPort)}/json/list`);
            const target = targets.find((candidate) => candidate.url.includes("uxp_inspector_app.html"));
            if (target?.webSocketDebuggerUrl) {
                return target;
            }
        }
        catch (err) {
            lastError = err;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
    throw new Error(`timed out waiting for the inspector renderer target: ${String(lastError ?? "not found")}`);
}

function getJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const request = http.get(url, (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
                }
                catch (err) {
                    reject(err instanceof Error ? err : new Error(String(err)));
                }
            });
        });
        request.on("error", reject);
        request.setTimeout(2_000, () => request.destroy(new Error("renderer CDP request timed out")));
    });
}

function evaluateInTarget<T>(target: RendererTarget, expression: string): Promise<T> {
    const debuggerUrl = target.webSocketDebuggerUrl;
    assert.ok(debuggerUrl, "expected the renderer target to expose a debugger URL");
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(debuggerUrl);
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error("timed out evaluating the inspector renderer"));
        }, 10_000);
        socket.on("open", () => {
            socket.send(JSON.stringify({
                id: 1,
                method: "Runtime.evaluate",
                params: { expression, returnByValue: true },
            }));
        });
        socket.on("message", (data) => {
            const reply = JSON.parse(data.toString()) as CdpReply;
            if (reply.id !== 1) {
                return;
            }
            clearTimeout(timer);
            socket.close();
            if (reply.error) {
                reject(new Error(reply.error.message ?? "renderer evaluation failed"));
                return;
            }
            resolve(reply.result?.result?.value as T);
        });
        socket.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
