import { compare, validate } from "compare-versions";

/* eslint-disable @stylistic/max-len */
/**
 * Host applications launchable via `VulcanControlAdapter.launchApp`
 * (ARCHITECTURE-UDT2-DIFF.md §5/§6.6) — same catalog UDT 2.2.1 ships.
 */
export interface HostAppDescriptor {
    /** Display name shown in UI, e.g. "Photoshop". */
    readonly name: string;
    /** `manifest.json` `host[].app` id, e.g. "PS". */
    readonly value: string;
    /** UI code shown in the host application's UI, e.g. "PS". */
    readonly uiCode: string;
    /**
   * Adobe SAP product codes for every install channel of this app (stable
   * first, then beta/other channels) — each channel is a distinct entry in
   * `getSpecifiers()`, so all of them must be probed to find every
   * installed version. Confirmed live (2026-07-31, `getInstalledAppsExample.xml`)
   * for Photoshop only: `PHSP` (stable) + `PHSPBETA` (beta). The other apps'
   * beta codes are UNVERIFIED guesses (`<code>BETA>`) — confirm with a real
   * `getSpecifiers()` dump before relying on them.
   */
    readonly sapCodes: readonly string[];
    /** Minimum UXP-capable installed version (dotted numeric string). */
    readonly minVersion: string;
    /**
     * Host-specific standalone script extensions (lowercase, with dot) that may
     * only run in this app, e.g. `.psjs`. Beta channels report the same `value`,
     * so they are covered automatically. Consumed via `src/core/scriptCatalog.ts`.
     */
    readonly scriptExtensions?: readonly string[];
    /** Extra (case-insensitive) app ids a host may report besides `value`. */
    readonly appIdAliases?: readonly string[];
}

export const HOST_APPS: readonly HostAppDescriptor[] = [
    { name: "Photoshop", value: "PS", uiCode: "PS", sapCodes: ["PHSP", "PHSPBETA"], minVersion: "23.2.0", scriptExtensions: [".psjs"] },
    // For InDesign - scripts are supported from 18.0 and plugins from 18.5 but old matrix support pages shows support back to 17.0 but that could be behind experimental flag
    { name: "InDesign", value: "ID", uiCode: "ID", sapCodes: ["IDSN", "IDSNBETA"], minVersion: "18.5.0", scriptExtensions: [".idjs"], appIdAliases: ["indesign"] },
    // TODO: verify — `AIS` confirmed from the SAPCode (issue #5), `AISBETA` is an unverified guess; minVersion and uiCode are assumed (live broker reported appId "IDS", version 21.3.0).
    { name: "InDesign Server", value: "IDS", uiCode: "IDS", sapCodes: ["AIS", "AISBETA"], minVersion: "18.5.0", scriptExtensions: [".idjs"], appIdAliases: ["indesignserver"] },
    { name: "Premiere Pro", value: "premierepro", uiCode: "PR", sapCodes: ["PPRO", "PPROBETA"], minVersion: "25.6.0" },
    { name: "Media Encoder", value: "ame", uiCode: "ME", sapCodes: ["AME", "AMEBETA"], minVersion: "27.0.0" },

    // { name: "After Effects", value: "aftereffects", uiCode: "AE", sapCodes: ["AEFT", "AEFTBETA"], minVersion: "26.5.0" },
    // { name: "Lightroom Classic", value: "lightroomclassic", uiCode: "LRC", sapCodes: ["LTRM", "LTRMBETA"], minVersion: "15.4.1" },
    // { name: "Lightroom", value: "lightroom", uiCode: "LR", sapCodes: ["LRCC", "LRCCBETA"], minVersion: "9.4.1" },
    // { name: "Bridge", value: "adobebridge", uiCode: "BR", sapCodes: ["KBRG", "KBRGBETA"], minVersion: "7.0.0" },

];

/**
 * Look up a catalog entry by `value` or any of its `appIdAliases`
 * (case-insensitive).
 */
export function findCatalogHostApp(appId: string): HostAppDescriptor | undefined {
    const normalizedAppId = appId.toLowerCase();
    const matchesAppId = (candidateId: string) => candidateId.toLowerCase() === normalizedAppId;

    return HOST_APPS.find(({ value, appIdAliases }) =>
        matchesAppId(value) || appIdAliases?.some(matchesAppId) === true,
    );
}

/**
 * Canonicalize `appId` to its catalog `value` when recognized (e.g.
 * `"indesign"` → `"ID"`, `"ps"` → `"PS"`), or return `appId` as-is for
 * uncataloged hosts.
 */
export function canonicalAppId(appId: string): string {
    return findCatalogHostApp(appId)?.value ?? appId;
}

/**
 * Case-insensitive host-app id comparison that also equates catalog `value`
 * and `appIdAliases` (e.g. `"ID"` matches `"indesign"` and `"id"`).
 */
export function isSameHostApp(a: string, b: string): boolean {
    const canonicalA = canonicalAppId(a).toLowerCase();
    const canonicalB = canonicalAppId(b).toLowerCase();

    return canonicalA === canonicalB;
}

/**
 * Pure version comparison backed by `compare-versions`. Compares arbitrary segment lengths
 * (e.g., `"15.4"` vs `"15.4.1"`) and treats pre-release suffixes (e.g., `"26.0.0-beta"`)
 * as lower than the corresponding release (`"26.0.0"`). Invalid version strings return `false`.
 */
export function satisfiesMinVersion(installed: string, minVersion: string): boolean {
    if (!validate(installed) || !validate(minVersion)) {
        return false;
    }
    return compare(installed, minVersion, ">=");
}

/** Catalog `minVersion` is binding: older versions are launchable but never debuggable. */
export function isDebuggableVersion(app: HostAppDescriptor, version: string): boolean {
    return satisfiesMinVersion(version, app.minVersion);
}

/**
 * Debuggability of a connected app. Apps outside the catalog or reporting no
 * version can't be judged and are allowed through.
 */
export function isDebuggableApp(appId: string, version: string | undefined): boolean {
    const app = findCatalogHostApp(appId);
    if (!app || !version) {
        return true;
    }
    return isDebuggableVersion(app, version);
}

/**
 * Human-readable reason why `version` of `app` can't be debugged — the one
 * message shared by every surface (script/plugin debugging, panel tooltip,
 * LM tools, hooks). Closing/starting apps is left to the user on purpose.
 */
export function unsupportedVersionReason(app: Pick<HostAppDescriptor, "name" | "minVersion">, version: string): string {
    return `${app.name} ${version} is not supported for UXP debugging — ${app.name} ${app.minVersion} or newer is required. `
        + `Close ${app.name} ${version} and start a supported version.`;
}

/** Why a connected app can't be debugged, or `undefined` when it can. */
export function connectedAppUnsupportedReason(appId: string, version: string | undefined): string | undefined {
    const app = findCatalogHostApp(appId);
    if (!app || !version || isDebuggableVersion(app, version)) {
        return undefined;
    }
    return unsupportedVersionReason(app, version);
}

/** A running catalog app instance, as reported by Vulcan. */
export interface RunningApp {
    /** Catalog `value`, e.g. "PS". */
    appId: string;
    version: string;
    /** Set when `version` is below the catalog `minVersion`. */
    unsupportedReason?: string;
}

/**
 * Running catalog apps from Vulcan's `getAppsList()` entries
 * (`"<appId>,<version>,<name>"`, e.g. `"PS,17.0.2,Adobe Photoshop"`).
 * Vulcan lists running apps whether or not they've connected to the broker —
 * incl. pre-UXP versions, which never connect, so this is the only way to
 * notice them.
 */
export function parseRunningApps(entries: readonly string[]): RunningApp[] {
    const result: RunningApp[] = [];
    for (const entry of entries) {
        const [rawId = "", version = ""] = entry.split(",").map((part) => part.trim());
        const app = findCatalogHostApp(rawId);
        if (!app || !version) {
            continue;
        }
        result.push(
            isDebuggableVersion(app, version)
                ? { appId: app.value, version }
                : { appId: app.value, version, unsupportedReason: unsupportedVersionReason(app, version) },
        );
    }
    return result;
}

/**
 * Reasons for running-but-unsupported instances of `appIds` (catalog ids or
 * aliases, case-insensitive; `undefined` = any catalog app). An app that also
 * has a supported version running is skipped — it may simply not be connected yet.
 */
export function runningUnsupportedReasons(running: readonly RunningApp[], appIds?: readonly string[]): string[] {
    const relevantApps = running.filter(
        ({ appId }) => !appIds || appIds.some((wanted) => isSameHostApp(appId, wanted)),
    );

    return relevantApps.flatMap((app) => {
        if (!app.unsupportedReason) {
            return [];
        }

        const hasSupportedVersion = relevantApps.some((other) =>
            isSameHostApp(other.appId, app.appId) && !other.unsupportedReason,
        );
        return hasSupportedVersion ? [] : [app.unsupportedReason];
    });
}

export const getUICodeByValue = (value: string): string => {
    const app = findCatalogHostApp(value);
    const res = app?.uiCode ?? "";
    return res;
};
