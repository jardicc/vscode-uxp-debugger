import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadAddon, nativeTargetName, resetAddonCacheForTests } from "../../src/core/vulcan/addonLoader";
import { NativeAddonUnavailableError } from "../../src/core/errors";

describe("nativeTargetName", () => {
    it("joins platform and arch with a dash", () => {
        expect(nativeTargetName("win32", "x64")).toBe("win32-x64");
        expect(nativeTargetName("darwin", "arm64")).toBe("darwin-arm64");
    });
});

describe("loadAddon", () => {
    let tmpRoot: string;

    beforeEach(() => {
        resetAddonCacheForTests();
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "addon-loader-test-"));
    });

    afterEach(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("throws NativeAddonUnavailableError for an unsupported platform/arch", () => {
        expect(() => loadAddon(tmpRoot, "linux", "x64")).toThrow(NativeAddonUnavailableError);
        expect(() => loadAddon(tmpRoot, "linux", "x64")).toThrow(/unsupported platform "linux-x64"/);
    });

    it("throws NativeAddonUnavailableError when the .node file is missing", () => {
        expect(() => loadAddon(tmpRoot, "win32", "x64")).toThrow(NativeAddonUnavailableError);
        expect(() => loadAddon(tmpRoot, "win32", "x64")).toThrow(/native module not found at/);
    });

    it("wraps a require() failure (file exists but isn't a valid addon) with the original message", () => {
        const targetDir = path.join(tmpRoot, "win32-x64");
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, "node-napi.node"), "not a real native module");

        expect(() => loadAddon(tmpRoot, "win32", "x64")).toThrow(NativeAddonUnavailableError);
        expect(() => loadAddon(tmpRoot, "win32", "x64")).toThrow(/failed to load .*node-napi\.node/);
    });

    it("does not cache a failed load — retries fs/require on every call", () => {
        expect(() => loadAddon(tmpRoot, "win32", "x64")).toThrow(NativeAddonUnavailableError);
        const targetDir = path.join(tmpRoot, "win32-x64");
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, "node-napi.node"), "still not real");
        // Second call re-checks the filesystem instead of reusing a cached failure —
        // it now fails at require() instead of the earlier "not found" error.
        expect(() => loadAddon(tmpRoot, "win32", "x64")).toThrow(/failed to load/);
    });
});
