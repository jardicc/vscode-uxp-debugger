/**
 * Routes `/__uxp_debugger__/hooks/*` requests to the individual handlers in
 * this folder — plugged into `UxpBroker`'s existing HTTP server via
 * `UxpService.setHookRequestHandler` (see `UxpBroker.extraRequestHandler`),
 * so build tools hit the SAME port the broker already listens on
 * (127.0.0.1 only, no separate server/port to discover).
 *
 * No authentication (matches the broker's own documented stance — see
 * MULTI-WINDOW-TAKEOVER.md — "no auth anywhere", localhost-only bind
 * is the trust boundary).
 */

import type * as http from "http";
import { URL } from "url";
import { HookRequestError, type HookResult, readJsonBody, requireStringField, sendJson } from "./hooksHttp";
import { handleLoad } from "./loadHook";
import { handleReload } from "./reloadHook";
import { handlePack } from "./packHook";
import { handleRefresh } from "./refreshHook";
import { handleUnload } from "./unloadHook";
import { handleSetWatch, handleWatchState } from "./watchHook";
import type { HookDependencies } from "./hooksTypes";

export const HOOKS_PATH_PREFIX = "/__uxp_debugger__/hooks/";

/** Builds the `extraRequestHandler` wired into every `UxpBroker` instance (see `UxpService.setHookRequestHandler`). */
export function createHooksRequestHandler(
    deps: HookDependencies,
): (req: http.IncomingMessage, res: http.ServerResponse, url: string) => boolean {
    return (req, res, url) => {
        if (!url.startsWith(HOOKS_PATH_PREFIX)) {
            return false;
        }
        void routeHooksRequest(req, res, url, deps);
        return true;
    };
}

async function routeHooksRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: string,
    deps: HookDependencies,
): Promise<void> {
    const parsed = new URL(url, "http://127.0.0.1");
    const route = parsed.pathname.slice(HOOKS_PATH_PREFIX.length);
    const method = req.method ?? "GET";

    try {
        let result: HookResult;
        if (method === "GET" && route === "watch") {
            const manifestPath = requireStringField(
                Object.fromEntries(parsed.searchParams),
                "manifestPath",
            );
            result = handleWatchState(manifestPath, deps);
        }
        else if (method === "POST" && route === "refresh") {
            result = await handleRefresh(await readJsonBody(req), deps);
        }
        else if (method === "POST" && route === "unload") {
            result = await handleUnload(await readJsonBody(req), deps);
        }
        else if (method === "POST" && route === "load") {
            result = await handleLoad(await readJsonBody(req), deps);
        }
        else if (method === "POST" && route === "reload") {
            result = await handleReload(await readJsonBody(req), deps);
        }
        else if (method === "POST" && route === "pack") {
            result = handlePack(await readJsonBody(req), deps);
        }
        else if (method === "POST" && (route === "watch/enable" || route === "watch/disable")) {
            const body = await readJsonBody(req);
            const manifestPath = requireStringField(body, "manifestPath");
            result = await handleSetWatch(manifestPath, route === "watch/enable", deps);
        }
        else {
            result = { status: 404, body: { ok: false, error: `Unknown hook route "${method} ${parsed.pathname}".` } };
        }
        sendJson(res, result);
    }
    catch (err) {
        if (err instanceof HookRequestError) {
            sendJson(res, { status: err.status, body: { ok: false, error: err.message } });
            return;
        }
        deps.output.appendLine(
            `[hooks] ${method} ${parsed.pathname} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        sendJson(res, { status: 500, body: { ok: false, error: "Internal error handling the hook request." } });
    }
}
