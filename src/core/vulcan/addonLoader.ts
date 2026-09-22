/**
 * Loads the prebuilt Adobe Vulcan N-API addon by an absolute, self-computed
 * path — never via `node-gyp-build` directory scans (which pick the
 * alphabetically-first `.node` file; see UXP-DEBUGGER-ARCHITECTURE.md §2 packaging
 * pitfall). This module is the only `require()` site for native code.
 *
 * Expected layout (shipped inside the extension, see scripts/prepare-native.mjs):
 *   native/
 *     win32-x64/     node-napi.node  AID.dll     VulcanControl.dll  VulcanMessage5.dll
 *     darwin-x64/    node-napi.node  AID.dylib   VulcanControl.dylib VulcanMessage5.dylib
 *     darwin-arm64/  …
 */

import * as fs from "fs";
import * as path from "path";
import { NativeAddonUnavailableError } from "../errors";

/** Vulcan IPC messaging adapter (server role uses endpoint id "UTDS"). */
export interface VulcanAdapterNative {
    getAppsList(): string[];
    setServerDetails(isStarted: boolean, jsonPayload: string): void;
    disconnect(): void;
}

/**
 * Process/installation control adapter (host-app detection + launch — see
 * ARCHITECTURE-UDT2-DIFF.md §6.2, `VulcanHostAppController`). Instance-level
 * (not module-level) — `_setLibraryPath` points THIS adapter's DLL loader at
 * a folder, matching the diff doc's TS wrapper shape.
 */
export interface VulcanControlAdapterNative {
    getSpecifiers(): string[];
    getInstalledApps(topLevelOnly: boolean): string[];
    isAppInstalled(sapCode: string): boolean;
    isAppRunning(sapCode: string): boolean;
    isAppRunningByName(name: string): boolean;
    getProcessId(sapCode: string): number;
    getAppVersion(sapCode: string): string;
    launchApp(
        sapCode: string,
        setFocus: boolean,
        cmdLineArgs: string,
        cb: (err: unknown, success: boolean | undefined) => void
    ): void;
    _setLibraryPath(dir: string): void;
}

export interface DevtoolsHelperAddon {
    VulcanAdapter: new (selfEndpointId: string, version: string) => VulcanAdapterNative;
    VulcanControlAdapter: new () => VulcanControlAdapterNative;
}

const SUPPORTED_TARGETS = new Set(["win32-x64", "darwin-x64", "darwin-arm64"]);

/** Resolve the platform folder name, e.g. `"win32-x64"`. */
export function nativeTargetName(
    platform: NodeJS.Platform = process.platform,
    arch: string = process.arch,
): string {
    return `${platform}-${arch}`;
}

let cachedAddon: DevtoolsHelperAddon | undefined;

/**
 * Load (and cache) the native addon from `<nativeRoot>/<platform-arch>/node-napi.node`.
 * @throws {NativeAddonUnavailableError} on unsupported platform / missing or broken binary.
 */
export function loadAddon(
    nativeRoot: string,
    platform: NodeJS.Platform = process.platform,
    arch: string = process.arch,
): DevtoolsHelperAddon {
    if (cachedAddon) {
        return cachedAddon;
    }

    const target = nativeTargetName(platform, arch);
    if (!SUPPORTED_TARGETS.has(target)) {
        throw new NativeAddonUnavailableError(
            `unsupported platform "${target}" (Adobe host apps exist on win32-x64, darwin-x64 and darwin-arm64 only)`,
        );
    }

    const addonPath = path.join(nativeRoot, target, "node-napi.node");
    if (!fs.existsSync(addonPath)) {
        throw new NativeAddonUnavailableError(`native module not found at ${addonPath}`);
    }

    try {
        const addon = require(addonPath) as DevtoolsHelperAddon;
        if (typeof addon.VulcanAdapter !== "function") {
            throw new Error("addon loaded but VulcanAdapter export is missing");
        }
        cachedAddon = addon;
        return addon;
    }
    catch (err) {
        throw new NativeAddonUnavailableError(
            `failed to load ${addonPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

/** Test hook: clear the module-level cache. */
export function resetAddonCacheForTests(): void {
    cachedAddon = undefined;
}
