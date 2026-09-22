/**
 * Real `VulcanControlAdapter` wrapper (ARCHITECTURE-UDT2-DIFF.md §6 —
 * installed-app detection + process launch). Distinct native object from
 * `VulcanAdapter` (messaging, see `VulcanAnnouncer`), but the same crash
 * risk applies: Adobe's native library must never be instantiated more than
 * once per process (see the 2026-07-30 Vulcan-crash lesson — a second
 * teardown+recreate of the *messaging* adapter crashed the extension host
 * with a native C++ fault). This class enforces a hard, process-wide,
 * one-shot guard for the *control* adapter as a defensive precaution, even
 * though it has not been observed to be re-instantiated anywhere yet.
 *
 * The adapter is constructed lazily on first use so importing this module
 * never touches native code.
 */

import type { HostAppDescriptor } from "./hostAppCatalog";
import type { IHostAppController, LaunchResult } from "./IHostAppController";
import { loadAddon, type VulcanControlAdapterNative } from "./addonLoader";
import { compareVersions } from "../manifest/appMatching";

let controlAdapterInstantiated = false;

export class VulcanHostAppController implements IHostAppController {
    private adapter: VulcanControlAdapterNative | undefined;
    private disposed = false;

    /**
   * @param nativeRoot Absolute path of the extension's `native/` folder.
   * @param log Diagnostic sink.
   */
    constructor(
        private readonly nativeRoot: string,
        private readonly log: (message: string) => void = () => undefined,
    ) {}

    getSpecifiers(): string[] {
        return this.getAdapter().getSpecifiers();
    }

    getInstalledApps(topLevelOnly: boolean): string[] {
        return this.getAdapter().getInstalledApps(topLevelOnly);
    }

    isInstalled(sapCode: string): boolean {
        return this.getAdapter().isAppInstalled(sapCode);
    }

    isRunning(sapCode: string): boolean {
        return this.getAdapter().isAppRunning(sapCode);
    }

    isRunningByName(processName: string): boolean {
        return this.getAdapter().isAppRunningByName(processName);
    }

    getProcessId(sapCode: string): number {
        return this.getAdapter().getProcessId(sapCode);
    }

    getVersion(sapCode: string): string {
        return this.getAdapter().getAppVersion(sapCode);
    }

    setLibraryPath(dir: string): void {
        this.getAdapter()._setLibraryPath(dir);
    }

    getInstalledCandidates(
        app: HostAppDescriptor,
    ): { sapCode: string; version: string; locales: string[] }[] {
        return sortInstalledCandidates(this.getAdapter().getSpecifiers(), app.sapCodes);
    }

    async launch(app: HostAppDescriptor): Promise<LaunchResult> {
        const adapter = this.getAdapter();

        if (!app.sapCodes.some((sapCode) => adapter.isAppInstalled(sapCode))) {
            this.log(`vulcan: none of [${app.sapCodes.join(", ")}] is installed`);
            return { status: "notInstalled", sapCode: app.sapCodes[0] };
        }

        const candidates = this.getInstalledCandidates(app);
        if (!candidates.some((c) => satisfiesMinVersion(c.version, app.minVersion))) {
            const installed = candidates.map((c) => c.version);
            this.log(
                `vulcan: [${app.sapCodes.join(", ")}] installed (${installed.join(", ") || "?"}) `
                + `does not satisfy minVersion ${app.minVersion}`,
            );
            return {
                status: "versionUnsupported",
                sapCode: app.sapCodes[0],
                installed,
                minVersion: app.minVersion,
            };
        }

        // Newest installed candidate wins, regardless of stable vs. beta channel.
        const newest = candidates[0];
        const success = await this.launchSapCode(newest.sapCode);
        if (!success) {
            return { status: "launchFailed", sapCode: newest.sapCode };
        }
        return { status: "launched" };
    }

    async launchSapCode(sapCode: string): Promise<boolean> {
        const adapter = this.getAdapter();
        // cmdLineArgs is always "" — never build it from untrusted input
        // (workspace settings, manifests, ...); Adobe's own UDT does the same.
        const success = await new Promise<boolean>((resolve) => {
            adapter.launchApp(sapCode, true, "", (err, ok) => {
                if (err) {
                    this.log(
                        // The native callback error is untyped and may intentionally use its own string conversion.
                        `vulcan: launchApp(${sapCode}) callback error: ${
                            // eslint-disable-next-line @typescript-eslint/no-base-to-string
                            err instanceof Error ? err.message : String(err)
                        }`,
                    );
                }
                // Coerce strictly — the native binding's `ok` is undocumented when
                // `err` is set, don't let a truthy-but-not-`true` value slip through.
                resolve(ok === true);
            });
        });
        this.log(`vulcan: launchApp(${sapCode}) => ${success}`);
        return success;
    }

    dispose(): void {
    // No native disconnect/teardown exists for VulcanControlAdapter (unlike
    // VulcanAdapter's disconnect()) — just drop the JS reference so a stray
    // call after dispose() fails fast via getAdapter()'s guard below.
        this.disposed = true;
        this.adapter = undefined;
    }

    private getAdapter(): VulcanControlAdapterNative {
        if (this.disposed) {
            throw new Error("VulcanHostAppController already disposed");
        }
        if (!this.adapter) {
            if (controlAdapterInstantiated) {
                throw new Error(
                    "A VulcanControlAdapter already exists in this process. Adobe's native "
                    + "library is not safe to instantiate more than once per process — reuse a "
                    + "single VulcanHostAppController instance for this window's whole lifetime.",
                );
            }
            const addon = loadAddon(this.nativeRoot);
            this.adapter = new addon.VulcanControlAdapter();
            controlAdapterInstantiated = true;
            this.log("vulcan: control adapter initialized");
        }
        return this.adapter;
    }
}

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

/** Test hook: clear the process-wide double-instantiation guard. */
export function resetControlAdapterGuardForTests(): void {
    controlAdapterInstantiated = false;
}

/**
 * Pure parse+sort of raw `getSpecifiers()` output for the given SAP codes,
 * newest version first (mixed channels — a beta can outrank a stable).
 * Real format is `<sapCode>-<version>-<locale1,locale2,...>` (locales
 * comma-separated, e.g. `"PHSP-18.1.6-cs_CZ,en_US"`) — the locales segment
 * is optional (treated as `[]` if absent). Assumes SAP codes and versions
 * never contain "-" themselves (true for every code/version seen so far).
 */
export function sortInstalledCandidates(
    specifiers: string[],
    sapCodes: readonly string[],
): { sapCode: string; version: string; locales: string[] }[] {
    const candidates: { sapCode: string; version: string; locales: string[] }[] = [];
    for (const specifier of specifiers) {
        const sapCode = sapCodes.find((code) => specifier.startsWith(`${code}-`));
        if (!sapCode) {
            continue;
        }
        const rest = specifier.slice(sapCode.length + 1);
        const dash = rest.indexOf("-");
        const version = dash === -1 ? rest : rest.slice(0, dash);
        const locales = dash === -1 ? [] : rest.slice(dash + 1).split(",").filter(Boolean);
        candidates.push({ sapCode, version, locales });
    }
    return candidates.sort((a, b) => compareVersions(b.version, a.version));
}
