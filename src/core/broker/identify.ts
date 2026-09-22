/**
 * Lets a second broker instance (e.g. another VS Code window) tell our own
 * broker apart from an unrelated process squatting on the port — most likely
 * Adobe's own UXP Developer Tools app, which never answers this route.
 * Pure Node; no `vscode` imports (core layer rule).
 */

import * as http from "http";

/** Marks the JSON payload as coming from this extension's broker. */
export const BROKER_SERVICE_MARKER = "uxp-debugger2-broker";

/** HTTP path answered only by our own broker; chosen to never collide with Adobe's UDT routes. */
export const IDENTIFY_PATH = "/__uxp_debugger__/identify";

export interface BrokerIdentity {
    service: typeof BROKER_SERVICE_MARKER;
    extensionVersion: string;
    pid: number;
}

function isBrokerIdentity(value: unknown): value is BrokerIdentity {
    const candidate = value as Partial<BrokerIdentity> | null;
    return (
        typeof candidate === "object"
        && candidate !== null
        && candidate.service === BROKER_SERVICE_MARKER
        && typeof candidate.extensionVersion === "string"
        && typeof candidate.pid === "number"
    );
}

/**
 * Probe `127.0.0.1:<port>` for our own identify route. Never rejects:
 * resolves `undefined` on timeout, connection error, or an unrecognised
 * response — all of those mean "something else owns this port".
 */
export function probeBrokerIdentity(
    port: number,
    timeoutMs = 800,
): Promise<BrokerIdentity | undefined> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (result: BrokerIdentity | undefined) => {
            if (!settled) {
                settled = true;
                resolve(result);
            }
        };

        const req = http.get(
            { host: "127.0.0.1", port, path: IDENTIFY_PATH, timeout: timeoutMs },
            (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (chunk: Buffer) => chunks.push(chunk));
                res.on("end", () => {
                    try {
                        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                        finish(isBrokerIdentity(parsed) ? parsed : undefined);
                    }
                    catch {
                        finish(undefined);
                    }
                });
            },
        );
        req.on("timeout", () => req.destroy());
        req.on("error", () => {
            finish(undefined);
        });
    });
}
