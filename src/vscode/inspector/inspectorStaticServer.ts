/**
 * Serves the self-hosted, trimmed DevTools-frontend build
 * (`devtools-frontend-dist/`, Elements + Network only — see docs/UI-DEBUGGING.md)
 * as static files from `UxpBroker`'s existing HTTP server, via the same
 * `extraRequestHandler` mechanism as the build-tool REST hooks
 * (`UxpService.setHookRequestHandler`) — no separate server/port to run or discover.
 */

import * as fs from "fs";
import type * as http from "http";
import * as path from "path";
import { URL } from "url";

export const INSPECTOR_STATIC_PATH_PREFIX = "/__uxp_debugger__/inspector/";

const CONTENT_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
};

/** Builds the `extraRequestHandler` that serves `rootDir` under {@link INSPECTOR_STATIC_PATH_PREFIX}. */
export function createInspectorStaticHandler(
    rootDir: string,
): (req: http.IncomingMessage, res: http.ServerResponse, url: string) => boolean {
    const normalizedRoot = path.normalize(rootDir);
    return (req, res, url) => {
        if (!url.startsWith(INSPECTOR_STATIC_PATH_PREFIX)) {
            return false;
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
            res.writeHead(405).end();
            return true;
        }
        serveFile(normalizedRoot, url, res);
        return true;
    };
}

function serveFile(rootDir: string, url: string, res: http.ServerResponse): void {
    const parsed = new URL(url, "http://127.0.0.1");
    const relative = decodeURIComponent(parsed.pathname.slice(INSPECTOR_STATIC_PATH_PREFIX.length));
    const filePath = path.normalize(path.join(rootDir, relative));
    // Reject path traversal outside rootDir (OWASP A01 — broken access control).
    if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep)) {
        res.writeHead(403).end();
        return;
    }
    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404).end();
            return;
        }
        const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
        // This build is edited/replaced in place during development (no versioned URLs) —
        // never let the webview's HTTP cache serve a stale copy across panel reopens.
        res.writeHead(200, {
            "Content-Type": contentType,
            "Content-Length": stat.size,
            "Cache-Control": "no-store",
        });
        fs.createReadStream(filePath).pipe(res);
    });
}
