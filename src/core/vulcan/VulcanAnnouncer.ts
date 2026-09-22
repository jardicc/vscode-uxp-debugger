/**
 * Real Vulcan IPC port announcer (Strategy A — in-host N-API addon).
 *
 * Endpoint id "UTDS" identifies us as the UDT service; host applications with
 * developer mode enabled receive the announcement and dial
 * `ws://127.0.0.1:<port>/socket/app` (verified end-to-end in UXP-DEBUGGER-ARCHITECTURE §2.0).
 *
 * The adapter is constructed lazily on the first `announce()` so that merely
 * importing this module (or activating the extension) never touches native code.
 */

import type { IPortAnnouncer } from "./IPortAnnouncer";
import { loadAddon, type VulcanAdapterNative } from "./addonLoader";

const VULCAN_SERVER_ENDPOINT_ID = "UTDS";
const VULCAN_ENDPOINT_VERSION = "1.0.0";

export class VulcanAnnouncer implements IPortAnnouncer {
    private adapter: VulcanAdapterNative | undefined;
    private disposed = false;

    /**
   * @param nativeRoot Absolute path of the extension's `native/` folder.
   * @param log Diagnostic sink.
   */
    constructor(
        private readonly nativeRoot: string,
        private readonly log: (message: string) => void = () => undefined,
    ) {}

    announce(port: number): void {
    // NOTE: deliberately a plain "true" call, matching Adobe's own UDT
    // service. An off→on toggle was tried here (2026-07-27) to work around
    // reconnect failures after abrupt shutdown and REVERTED: it did not fix
    // the issue, and because reannounce() reuses this method, the leading
    // `setServerDetails(false, …)` actively told connected/connecting host
    // apps to disconnect. See LIFECYCLE-NOTES.md.
        this.getAdapter().setServerDetails(true, JSON.stringify({ port }));
        this.log(`vulcan: announced service on port ${String(port)}`);
    }

    withdraw(port: number): void {
        if (!this.adapter) {
            return; // never announced — nothing to withdraw
        }
        try {
            this.adapter.setServerDetails(false, JSON.stringify({ port }));
            this.log(`vulcan: withdrew announcement for port ${String(port)}`);
        }
        catch (err) {
            this.log(`vulcan: withdraw failed: ${String(err instanceof Error ? err.message : err)}`);
        }
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        try {
            this.adapter?.disconnect();
        }
        catch (err) {
            this.log(`vulcan: disconnect failed: ${String(err instanceof Error ? err.message : err)}`);
        }
        this.adapter = undefined;
    }

    private getAdapter(): VulcanAdapterNative {
        if (this.disposed) {
            throw new Error("VulcanAnnouncer already disposed");
        }
        if (!this.adapter) {
            const addon = loadAddon(this.nativeRoot);
            this.adapter = new addon.VulcanAdapter(
                VULCAN_SERVER_ENDPOINT_ID,
                VULCAN_ENDPOINT_VERSION,
            );
            this.log("vulcan: adapter initialised (endpoint UTDS)");
        }
        return this.adapter;
    }
}
