/**
 * Small, pure (no `vscode` import) HTTP helpers shared by every hook route
 * handler in this folder — kept separate so they're unit-testable without
 * mocking `vscode` (same convention as `core/` "*Like" pure modules).
 */

import type * as http from "http";

/** Every hook handler resolves to this — the router just writes it out. */
export interface HookResult {
    status: number;
    body: Record<string, unknown>;
}

/** Defence against a misbehaving/huge request body (OWASP: unbounded resource consumption). */
const MAX_BODY_BYTES = 1_000_000;

/** Thrown by {@link readJsonBody} for a request the caller should answer 400/413 to. */
export class HookRequestError extends Error {
    constructor(
        message: string,
        public readonly status: number,
    ) {
        super(message);
        this.name = "HookRequestError";
    }
}

/**
 * Reads and JSON-parses a request body (POST hooks only). An empty body
 * parses to `{}` so hooks with no required fields don't need a body at all.
 * @throws {HookRequestError} (413) when the body exceeds {@link MAX_BODY_BYTES},
 * or (400) when it isn't valid JSON.
 */
export function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        req.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                reject(new HookRequestError("Request body too large.", 413));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8").trim();
            if (raw === "") {
                resolve({});
                return;
            }
            try {
                const parsed: unknown = JSON.parse(raw);
                if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                    throw new Error("not an object");
                }
                resolve(parsed as Record<string, unknown>);
            }
            catch {
                reject(new HookRequestError("Request body must be valid JSON (an object).", 400));
            }
        });
        req.on("error", (err) => {
            reject(err);
        });
    });
}

/** Pulls a required, non-empty string field out of a parsed body/query, or throws a 400 `HookRequestError`. */
export function requireStringField(source: Record<string, unknown>, field: string): string {
    const value = source[field];
    if (typeof value !== "string" || value.length === 0) {
        throw new HookRequestError(`Missing or invalid required field "${field}".`, 400);
    }
    return value;
}

/** Pulls an optional non-empty string field, or `undefined` when absent. */
export function optionalStringField(source: Record<string, unknown>, field: string): string | undefined {
    const value = source[field];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "string" || value.length === 0) {
        throw new HookRequestError(`Field "${field}" must be a non-empty string when present.`, 400);
    }
    return value;
}

/** Pulls an optional boolean field (default `false`), or throws a 400 when present but not a boolean. */
export function optionalBooleanField(
    source: Record<string, unknown>,
    field: string,
    defaultValue = false,
): boolean {
    const value = source[field];
    if (value === undefined) {
        return defaultValue;
    }
    if (typeof value !== "boolean") {
        throw new HookRequestError(`Field "${field}" must be a boolean when present.`, 400);
    }
    return value;
}

export function sendJson(res: http.ServerResponse, result: HookResult): void {
    const payload = JSON.stringify(result.body);
    res.writeHead(result.status, { "Content-Type": "application/json", Connection: "close" });
    res.end(payload);
}
