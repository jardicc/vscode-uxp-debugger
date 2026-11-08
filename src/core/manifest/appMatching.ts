/**
 * App matching (port of Adobe's `AppsHelper` semantics, ARCHITECTURE.md §7):
 * `applicable = manifest.host ∩ connected apps`; the version is compared only
 * when **both** sides specify one — otherwise the app-id match suffices.
 */

import { compare } from "compare-versions";
import type { ConnectedApp } from "../broker/UxpBroker";
import { canonicalAppId, isSameHostApp } from "../vulcan/hostAppCatalog";
import type { NormalizedHost } from "./manifest";

/** Connected apps applicable to the given manifest host entries. */
export function matchApps(
    hosts: NormalizedHost[],
    connected: ConnectedApp[],
): ConnectedApp[] {
    return connected.filter((app) =>
        hosts.some((host) => {
            if (!isSameHostApp(host.app, app.info.appId)) {
                return false;
            }
            if (host.minVersion && app.info.appVersion) {
                return compare(app.info.appVersion, host.minVersion, ">=");
            }
            return true;
        }),
    );
}

/** The app ids a manifest requires (for the "start <app> and retry" dialog). */
export function requiredAppIds(hosts: NormalizedHost[]): string[] {
    return [...new Set(hosts.map((h) => canonicalAppId(h.app)))];
}
