/**
 * Client-side helper for requesting an in-place ownership handoff from
 * whichever VS Code window currently owns the broker on a given port — see
 * MULTI-WINDOW-TAKEOVER.md. Pure Node; no `vscode` imports (core layer
 * rule). Mirrors the request-shape of `probeBrokerIdentity` in identify.ts.
 */

import * as http from "http";

/** HTTP path handled by `UxpBroker` to hand over ownership of the port. */
export const TAKEOVER_PATH = "/__uxp_debugger__/takeover";

/**
 * POST a takeover request to the broker listening on `port` and wait for its
 * response. The owning broker only replies once its own cleanup (stopping
 * debug sessions, withdrawing the Vulcan announcement, closing all sockets)
 * has completed — so on success the caller can call `broker.start()` again
 * immediately, with no need to poll for the port to free up.
 *
 * Never throws: resolves `false` on timeout, connection error, or a
 * non-2xx response, so the caller can fall back to the ordinary
 * "port in use" dialog.
 */
export function requestTakeover(port: number, timeoutMs = 8000): Promise<boolean> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (result: boolean) => {
            if (!settled) {
                settled = true;
                resolve(result);
            }
        };

        const req = http.request(
            { host: "127.0.0.1", port, path: TAKEOVER_PATH, method: "POST", timeout: timeoutMs },
            (res) => {
                res.resume(); // drain the body; we only care about the status code
                res.on("end", () => {
                    finish((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300);
                });
            },
        );
        req.on("timeout", () => req.destroy());
        req.on("error", () => {
            finish(false);
        });
        req.end();
    });
}
