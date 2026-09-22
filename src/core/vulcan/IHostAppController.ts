/**
 * Host-app installation/process control seam
 * (ARCHITECTURE-UDT2-DIFF.md §6 — `VulcanControlAdapter`). Mirrors the
 * {@link "./IPortAnnouncer"} pattern: core depends on this interface only,
 * so command/service code is testable without touching the native addon.
 */
import type { HostAppDescriptor } from "./hostAppCatalog";

export type LaunchResult
    = | { status: "launched" }
        | { status: "notInstalled"; sapCode: string }
        | { status: "versionUnsupported"; sapCode: string; installed: string[]; minVersion: string }
        | { status: "launchFailed"; sapCode: string };

export interface IHostAppController {
    /** Raw installed-product specifiers, e.g. `["PHSP-26.0.0", ...]`. */
    getSpecifiers(): string[];
    getInstalledApps(topLevelOnly: boolean): string[];
    isInstalled(sapCode: string): boolean;
    isRunning(sapCode: string): boolean;
    isRunningByName(processName: string): boolean;
    getProcessId(sapCode: string): number;
    getVersion(sapCode: string): string;
    /** Every installed version across `app.sapCodes`, newest first (mixed stable/beta). */
    getInstalledCandidates(
        app: HostAppDescriptor
    ): { sapCode: string; version: string; locales: string[] }[];
    /** Checks installed + min-version first, then launches the newest candidate (or requests a URL open). */
    launch(app: HostAppDescriptor): Promise<LaunchResult>;
    /** Raw launch by a specific SAP code — no installed/version checks (caller already knows). */
    launchSapCode(sapCode: string): Promise<boolean>;
    /** Points the native adapter's DLL loader at `dir`. Not needed unless the DLLs are relocated. */
    setLibraryPath(dir: string): void;
    /** Release native resources. Safe to call multiple times. */
    dispose(): void;
}

/** No-op controller for tests. Records calls and returns canned results. */
export class NullHostAppController implements IHostAppController {
    readonly launched: HostAppDescriptor[] = [];
    disposed = false;
    nextLaunchResult: LaunchResult = { status: "launched" };

    getSpecifiers(): string[] {
        return [];
    }

    getInstalledApps(): string[] {
        return [];
    }

    isInstalled(): boolean {
        return true;
    }

    isRunning(): boolean {
        return false;
    }

    isRunningByName(): boolean {
        return false;
    }

    getProcessId(): number {
        return 0;
    }

    getVersion(): string {
        return "";
    }

    getInstalledCandidates(): { sapCode: string; version: string; locales: string[] }[] {
        return [];
    }

    // Disabled for swap-ability
    // eslint-disable-next-line @typescript-eslint/require-await
    async launch(app: HostAppDescriptor): Promise<LaunchResult> {
        this.launched.push(app);
        return this.nextLaunchResult;
    }

    // Disabled for swap-ability
    // eslint-disable-next-line @typescript-eslint/require-await
    async launchSapCode(): Promise<boolean> {
        return true;
    }

    setLibraryPath(): void {
    // no-op
    }

    dispose(): void {
        this.disposed = true;
    }
}
