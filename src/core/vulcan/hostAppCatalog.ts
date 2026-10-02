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

export const getUICodeByValue = (value: string): string => {
    const app = HOST_APPS.find((app) => app.value.toLocaleLowerCase() === value.toLocaleLowerCase());
    const res = app?.uiCode ?? "";
    return res;
};
