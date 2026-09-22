/**
 * App matching (port of Adobe's `AppsHelper` semantics, ARCHITECTURE.md §7):
 * `applicable = manifest.host ∩ connected apps`; the version is compared only
 * when **both** sides specify one — otherwise the app-id match suffices.
 */

import type { ConnectedApp } from "../broker/UxpBroker";
import type { NormalizedHost } from "./manifest";

/**
 * Segment-wise numeric version comparison ("26.0.0" vs "23.2.0").
 * Missing segments count as 0. Returns <0, 0, >0.
 */
export function compareVersions(a: string, b: string): number {
    const pa = a.split(".").map((s) => Number.parseInt(s, 10));
    const pb = b.split(".").map((s) => Number.parseInt(s, 10));
    const length = Math.max(pa.length, pb.length);
    for (let i = 0; i < length; i++) {
        const va = Number.isFinite(pa[i]) ? pa[i] : 0;
        const vb = Number.isFinite(pb[i]) ? pb[i] : 0;
        if (va !== vb) {
            return va - vb;
        }
    }
    return 0;
}

/** Connected apps applicable to the given manifest host entries. */
export function matchApps(
    hosts: NormalizedHost[],
    connected: ConnectedApp[],
): ConnectedApp[] {
    return connected.filter((app) =>
        hosts.some((host) => {
            if (host.app !== app.info.appId) {
                return false;
            }
            if (host.minVersion && app.info.appVersion) {
                return compareVersions(app.info.appVersion, host.minVersion) >= 0;
            }
            return true;
        }),
    );
}

/** The app ids a manifest requires (for the "start <app> and retry" dialog). */
export function requiredAppIds(hosts: NormalizedHost[]): string[] {
    return [...new Set(hosts.map((h) => h.app))];
}
