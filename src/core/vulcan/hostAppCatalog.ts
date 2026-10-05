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
}

export const HOST_APPS: readonly HostAppDescriptor[] = [
    { name: "Photoshop", value: "PS", uiCode: "PS", sapCodes: ["PHSP", "PHSPBETA"], minVersion: "23.2.0" },
    { name: "InDesign", value: "ID", uiCode: "ID", sapCodes: ["IDSN", "IDSNBETA"], minVersion: "18.5.0" },
    { name: "Premiere Pro", value: "premierepro", uiCode: "PR", sapCodes: ["PPRO", "PPROBETA"], minVersion: "25.6.0" },
    { name: "Media Encoder", value: "ame", uiCode: "ME", sapCodes: ["AME", "AMEBETA"], minVersion: "27.0.0" },

    // { name: "After Effects", value: "aftereffects", uiCode: "AE", sapCodes: ["AEFT", "AEFTBETA"], minVersion: "26.5.0" },
    // { name: "Lightroom Classic", value: "lightroomclassic", uiCode: "LRC", sapCodes: ["LTRM", "LTRMBETA"], minVersion: "15.4.1" },
    // { name: "Lightroom", value: "lightroom", uiCode: "LR", sapCodes: ["LRCC", "LRCCBETA"], minVersion: "9.4.1" },
    // { name: "Bridge", value: "adobebridge", uiCode: "BR", sapCodes: ["KBRG", "KBRGBETA"], minVersion: "7.0.0" },

];

/**
 * Pure version comparison, ported from UDT 2.2.1's `_checkMinHostAppVersion`
 * (ARCHITECTURE-UDT2-DIFF.md §6.4). Returns the first non-zero per-segment
 * difference; missing segments in `minVersion` count as 0. A non-numeric
 * segment at or after the first equal prefix poisons the result to NaN
 * (`NaN >= 0` is `false`) — replicated intentionally, not a bug.
 */
export function satisfiesMinVersion(installed: string, minVersion: string): boolean {
    const min = minVersion.split(".").map(Number);
    return (
        installed
            .split(".")
            .map(Number)
            .reduce<number>((acc, part, i) => acc || part - (min[i] ?? 0), 0) >= 0
    );
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
    const app = HOST_APPS.find((candidate) => candidate.value === appId);
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
    const app = HOST_APPS.find((candidate) => candidate.value === appId);
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
        const app = HOST_APPS.find((candidate) => candidate.value.toLowerCase() === rawId.toLowerCase());
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
 * Reasons for running-but-unsupported instances of `appIds` (catalog ids,
 * case-insensitive; `undefined` = any catalog app). An app that also has a
 * supported version running is skipped — it may simply not be connected yet.
 */
export function runningUnsupportedReasons(running: readonly RunningApp[], appIds?: readonly string[]): string[] {
    const wanted = appIds?.map((id) => id.toLowerCase());
    const relevant = running.filter((a) => !wanted || wanted.includes(a.appId.toLowerCase()));
    return relevant.flatMap((a) =>
        a.unsupportedReason && !relevant.some((other) => other.appId === a.appId && !other.unsupportedReason)
            ? [a.unsupportedReason]
            : [],
    );
}

export const getUICodeByValue = (value: string): string => {
    const app = HOST_APPS.find((app) => app.value.toLocaleLowerCase() === value.toLocaleLowerCase());
    const res = app?.uiCode ?? "";
    return res;
};
