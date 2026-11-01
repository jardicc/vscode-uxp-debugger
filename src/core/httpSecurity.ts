/**
 * Localhost HTTP request guards shared by `UxpBroker` and `CdpProxyServer`
 * against DNS-rebinding (`Host` header validation) and drive-by browser
 * CSRF (`Origin` / `Sec-Fetch-Site` header validation).
 *
 * Pure Node — no `vscode` imports.
 */

import type * as http from "http";
import { DEFAULT_BROKER_PORT } from "./protocol/types";

const LOOPBACK_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/** Expected `Origin` header sent by the bundled DevTools inspector iframe. */
export const ALLOWED_INSPECTOR_ORIGIN = `http://127.0.0.1:${String(DEFAULT_BROKER_PORT)}`;

/**
 * Returns `true` when the `Host` header is present and targets a loopback
 * address (`127.0.0.1`, `localhost`, or `[::1]` with an optional port).
 * Rejects DNS-rebinding requests where an external domain resolves to 127.0.0.1.
 */
export function isLoopbackHost(req: http.IncomingMessage): boolean {
    const host = req.headers.host;
    return typeof host === "string" && LOOPBACK_HOST_RE.test(host);
}

/**
 * Returns `true` when the request carries browser cross-origin indicators:
 * any `Origin` header or `Sec-Fetch-Site: cross-site`. Non-browser clients
 * (`curl`, Node.js `http`, `js-debug`, Adobe host apps) do not send `Origin`.
 */
export function isBrowserOriginRequest(req: http.IncomingMessage): boolean {
    if (req.headers.origin !== undefined) {
        return true;
    }
    const secFetchSite = req.headers["sec-fetch-site"];
    if (typeof secFetchSite === "string" && secFetchSite.toLowerCase() === "cross-site") {
        return true;
    }
    return false;
}

/**
 * Returns `true` when a WebSocket upgrade to `CdpProxyServer`'s `/panel`
 * endpoint comes from either a non-browser client (`Origin` omitted, e.g.
 * Node/E2E tests) or the self-hosted DevTools inspector iframe at
 * `http://127.0.0.1:14001`, with a valid loopback `Host` header.
 */
export function isAllowedPanelUpgrade(req: http.IncomingMessage): boolean {
    if (!isLoopbackHost(req)) {
        return false;
    }
    const secFetchSite = req.headers["sec-fetch-site"];
    if (typeof secFetchSite === "string" && secFetchSite.toLowerCase() === "cross-site") {
        return false;
    }
    const origin = req.headers.origin;
    return origin === undefined || origin === ALLOWED_INSPECTOR_ORIGIN;
}
