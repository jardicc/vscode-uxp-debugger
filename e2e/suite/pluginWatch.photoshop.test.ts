/**
 * Watch mode (`PluginWatchManager`, CONTROL-PANEL.md §8) — no e2e coverage
 * existed for either watch path before this file: a non-special file change
 * (fast in-place `Plugin/reload`, same session) vs. a `manifest.json`
 * change (full Unload+Load). Uses a throwaway plugin folder under the OS
 * temp dir (never the checked-in fixtures) so a real `vscode.FileSystemWatcher`
 * can be exercised without ever risking a dirty git working tree.
 *
 * Requires Photoshop already running with developer mode enabled.
 */

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { HostLogEvent } from "../../src/core/broker/AppConnection";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import { activateExtension, describeLive, TIMEOUT_MULTI_SESSION, waitFor } from "./liveHelpers";

const RELOAD_MARKER = "uxp-e2e-watch fixture loaded";

function writeTempPlugin(dir: string): { manifestPath: string; scriptPath: string } {
    fs.mkdirSync(dir, { recursive: true });
    const manifestPath = path.join(dir, "manifest.json");
    const scriptPath = path.join(dir, "index.js");
    fs.writeFileSync(
        manifestPath,
        JSON.stringify(
            {
                id: "com.uxpdebugger.e2e.watch",
                name: "UXP Debugger E2E Watch Fixture",
                version: "1.0.0",
                main: "index.html",
                host: { app: "PS", minVersion: "24.0" },
                manifestVersion: 5,
                entrypoints: [{ type: "command", id: "showAlert", label: "Show alert" }],
            },
            null,
            2,
        ),
    );
    fs.writeFileSync(
        path.join(dir, "index.html"),
        "<!DOCTYPE html><html><head><script src=\"./index.js\"></script></head><body></body></html>",
    );
    fs.writeFileSync(scriptPath, `console.log(${JSON.stringify(RELOAD_MARKER)});\n`);
    return { manifestPath, scriptPath };
}

describeLive("Watch mode: file changes trigger refresh/reload (live Photoshop)", function () {
    this.timeout(TIMEOUT_MULTI_SESSION);

    let api: UxpDebuggerTestApi;
    let tempDir: string;
    let manifestPath: string;
    let scriptPath: string;

    before(async () => {
        api = await activateExtension();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-e2e-watch-"));
        ({ manifestPath, scriptPath } = writeTempPlugin(tempDir));
        await api.pluginRegistry.addPlugin(manifestPath);
        await api.pluginRegistry.setWatch({ manifestPath }, true);
    });

    after(async () => {
        for (const session of api.service.sessionsForManifest(manifestPath)) {
            await api.service.unloadPlugin(session).catch(() => undefined);
        }
        await api.pluginRegistry.removePlugin(manifestPath);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("refreshes in place on a non-special file change, and fully reloads on a manifest.json change", async () => {
        const logs: HostLogEvent[] = [];
        const sub = api.service.onHostLog((event) => logs.push(event));
        const markerCount = () => logs.filter((l) => l.message.includes(RELOAD_MARKER)).length;

        try {
            const loadResult = await api.service.loadPlugin(manifestPath);
            assert.strictEqual(loadResult.sessions.length, 1);
            const originalSessionId = loadResult.sessions[0].clientSessionId;

            await waitFor(() => api.watchManager.isWatching(manifestPath), 5_000);
            await waitFor(() => markerCount() > 0, 10_000);
            const countAfterLoad = markerCount();

            // Non-special file change (index.js) — expect a fast in-place refresh:
            // the script re-runs (log line reappears) but the session id is unchanged.
            fs.appendFileSync(scriptPath, "// touched by e2e watch test (refresh)\n");
            await waitFor(() => markerCount() > countAfterLoad, 15_000);
            assert.deepStrictEqual(
                api.service.sessionsForManifest(manifestPath).map((s) => s.clientSessionId),
                [originalSessionId],
                "expected the same session after an in-place refresh, not a new one",
            );
            const countAfterRefresh = markerCount();

            // manifest.json change — expect a full Unload+Load (still exactly one
            // live session afterward; the script's log line prints again).
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
            manifest.version = "1.0.1";
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
            await waitFor(() => markerCount() > countAfterRefresh, 15_000);
            assert.strictEqual(
                api.service.sessionsForManifest(manifestPath).length,
                1,
                "expected exactly one live session after the full reload",
            );
        }
        finally {
            sub.dispose();
        }
    });
});
