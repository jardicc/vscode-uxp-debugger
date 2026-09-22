/**
 * Build-tool REST hooks (`src/vscode/hooks/*.ts`, ridden on the broker's own
 * HTTP port — see `hooksRouter.ts`). No e2e coverage existed for any of the
 * 6 routes before this file: `refresh`/`unload`/`load`/`reload`/`pack`/
 * `watch` (+ `watch/enable`/`watch/disable`).
 *
 * Sends real HTTP requests to `http://127.0.0.1:<DEFAULT_BROKER_PORT>` —
 * the same thing a build tool (webpack/vite plugin, npm script, etc.) would
 * do. Requires Photoshop already running with developer mode enabled.
 */

import * as assert from "assert";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import type { UxpDebuggerTestApi } from "../../src/vscode/extension";
import { DEFAULT_BROKER_PORT } from "../../src/core/protocol/types";
import { HOOKS_PATH_PREFIX } from "../../src/vscode/hooks/hooksRouter";
import { activateExtension, describeLive, manifestPath, TIMEOUT_DEFAULT, unloadAllSessions } from "./liveHelpers";

interface HookResponse {
    status: number;
    body: Record<string, unknown>;
}

function hookRequest(method: string, route: string, body?: unknown): Promise<HookResponse> {
    return new Promise((resolve, reject) => {
        const payload = body !== undefined ? JSON.stringify(body) : undefined;
        const req = http.request(
            {
                host: "127.0.0.1",
                port: DEFAULT_BROKER_PORT,
                path: HOOKS_PATH_PREFIX + route,
                method,
                headers: payload
                    ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
                    : undefined,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (chunk: Buffer) => chunks.push(chunk));
                res.on("end", () => {
                    const raw = Buffer.concat(chunks).toString("utf-8");
                    resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} });
                });
            },
        );
        req.on("error", reject);
        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

const postHook = (route: string, body: unknown = {}) => hookRequest("POST", route, body);
const getHook = (route: string, query: Record<string, string>) =>
    hookRequest("GET", `${route}?${new URLSearchParams(query).toString()}`);

describeLive("Build-tool REST hooks (live Photoshop)", function () {
    this.timeout(TIMEOUT_DEFAULT);

    let api: UxpDebuggerTestApi;

    before(async () => {
        api = await activateExtension();
        await api.service.ensureStarted();
    });

    afterEach(async () => {
        await unloadAllSessions(api, manifestPath);
        await api.pluginRegistry.removePlugin(manifestPath);
    });

    it("refresh/unload are idempotent no-ops when nothing is loaded", async () => {
        const refresh = await postHook("refresh", { manifestPath });
        assert.strictEqual(refresh.status, 200);
        assert.deepStrictEqual(refresh.body.sessions, []);

        const unload = await postHook("unload", { manifestPath });
        assert.strictEqual(unload.status, 200);
        assert.deepStrictEqual(unload.body.sessions, []);
    });

    it("load -> refresh -> unload drives the fixture plugin through a full lifecycle", async () => {
        const load = await postHook("load", { manifestPath });
        assert.strictEqual(load.status, 200, JSON.stringify(load.body));
        assert.strictEqual(load.body.ok, true);
        const sessions = load.body.sessions as string[];
        assert.strictEqual(sessions.length, 1);
        assert.strictEqual(api.service.sessionsForManifest(manifestPath).length, 1);

        const refresh = await postHook("refresh", { manifestPath });
        assert.strictEqual(refresh.status, 200);
        assert.deepStrictEqual(refresh.body.sessions, sessions, "expected the same clientSessionId after an in-place refresh");

        const unload = await postHook("unload", { manifestPath });
        assert.strictEqual(unload.status, 200);
        assert.deepStrictEqual(unload.body.sessions, sessions);
        assert.strictEqual(api.service.sessionsForManifest(manifestPath).length, 0);
    });

    it("reload does a full unload+load and restores an attached debugger", async () => {
        const load = await postHook("load", { manifestPath });
        assert.strictEqual(load.status, 200, JSON.stringify(load.body));
        const session = api.service.sessionsForManifest(manifestPath)[0];
        assert.ok(session, "expected a live session after load");

        const started = await api.debugManager.attach(session, path.dirname(manifestPath));
        assert.strictEqual(started, true, "expected the JS debug session to start");

        const reload = await postHook("reload", { manifestPath });
        assert.strictEqual(reload.status, 200, JSON.stringify(reload.body));
        assert.strictEqual(reload.body.ok, true);
        assert.strictEqual(reload.body.restoredDebugging, true, "expected the debugger to be restored after reload");
        assert.strictEqual(api.service.sessionsForManifest(manifestPath).length, 1);
        assert.strictEqual(api.debugManager.hasActiveSession, true);
    });

    it("load reports an actionable 503 when it fails (bogus appId)", async () => {
        const load = await postHook("load", { manifestPath, appId: "NOT_A_REAL_APP_ID" });
        assert.strictEqual(load.status, 503, JSON.stringify(load.body));
        assert.strictEqual(load.body.ok, false);
        assert.match(load.body.error as string, /No connected app matches this plugin/);
    });

    it("watch: 404s for a manifest not registered in the panel, then reads/toggles it once registered", async () => {
        const unregisteredPath = path.join(os.tmpdir(), "uxp-e2e-not-registered", "manifest.json");
        const notRegistered = await getHook("watch", { manifestPath: unregisteredPath });
        assert.strictEqual(notRegistered.status, 404);

        await api.pluginRegistry.addPlugin(manifestPath);

        const initial = await getHook("watch", { manifestPath });
        assert.strictEqual(initial.status, 200);
        assert.strictEqual(initial.body.watch, false);
        assert.strictEqual(initial.body.watcherActive, false);

        const enable = await postHook("watch/enable", { manifestPath });
        assert.strictEqual(enable.status, 200);
        assert.strictEqual(enable.body.watch, true);

        const activeWithNoSession = await getHook("watch", { manifestPath });
        assert.strictEqual(activeWithNoSession.body.watch, true);
        assert.strictEqual(activeWithNoSession.body.watcherActive, false, "no live session yet — watcher shouldn't be active");

        const load = await postHook("load", { manifestPath });
        assert.strictEqual(load.status, 200, JSON.stringify(load.body));

        const activeWithSession = await getHook("watch", { manifestPath });
        assert.strictEqual(activeWithSession.body.watcherActive, true);

        const disable = await postHook("watch/disable", { manifestPath });
        assert.strictEqual(disable.status, 200);
        assert.strictEqual(disable.body.watch, false);
    });

    it("pack builds a real .ccx archive on disk (no Photoshop needed for this route)", async () => {
        const outputPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "uxp-e2e-pack-")), "fixture.ccx");
        try {
            await api.pluginRegistry.addPlugin(manifestPath);
            const pack = await postHook("pack", { manifestPath, outputPath });
            assert.strictEqual(pack.status, 200, JSON.stringify(pack.body));
            assert.strictEqual(pack.body.ok, true);
            assert.strictEqual(pack.body.outputPath, outputPath);
            assert.ok(fs.existsSync(outputPath), "expected the .ccx archive to actually be written to disk");
            assert.ok(fs.statSync(outputPath).size > 0, "expected a non-empty archive");
        }
        finally {
            fs.rmSync(path.dirname(outputPath), { recursive: true, force: true });
        }
    });
});
