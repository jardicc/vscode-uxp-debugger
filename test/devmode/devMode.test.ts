import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildElevationCommand, getDevSettingsPath, isDevModeEnabled } from "../../src/core/devmode/devMode";

describe("getDevSettingsPath", () => {
    it("uses %CommonProgramFiles% on Windows", () => {
        const p = getDevSettingsPath("win32", { CommonProgramFiles: "C:\\Common" });
        expect(p).toBe(path.join("C:\\Common", "Adobe", "UXP", "Developer", "settings.json"));
    });

    it("falls back to the default Common Files folder on Windows", () => {
        const p = getDevSettingsPath("win32", {});
        expect(p).toContain("Common Files");
    });

    it("uses the fixed Library path on macOS", () => {
        expect(getDevSettingsPath("darwin", {})).toBe(
            "/Library/Application Support/Adobe/UXP/Developer/settings.json",
        );
    });

    it("throws on unsupported platforms", () => {
        expect(() => getDevSettingsPath("linux", {})).toThrow(/not supported/);
    });
});

describe("isDevModeEnabled", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-devmode-"));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function write(content: string): string {
        const file = path.join(dir, "settings.json");
        fs.writeFileSync(file, content, "utf-8");
        return file;
    }

    it("returns true for {developer: true}", () => {
        expect(isDevModeEnabled(write("{\"developer\": true}"))).toBe(true);
    });

    it("accepts the file the elevation .bat writes (trailing whitespace)", () => {
    // win32.bat writes: echo %config% > settings.json  → trailing space + CRLF
        expect(isDevModeEnabled(write("{\"developer\": true} \r\n"))).toBe(true);
    });

    it("returns false for disabled / broken / missing files", () => {
        expect(isDevModeEnabled(write("{\"developer\": false}"))).toBe(false);
        expect(isDevModeEnabled(write("not json"))).toBe(false);
        expect(isDevModeEnabled(path.join(dir, "missing.json"))).toBe(false);
    });
});

describe("buildElevationCommand", () => {
    it("escapes single quotes in Windows extensionPath for PowerShell", () => {
        const cmd = buildElevationCommand("C:\\Users\\O'Connor\\ext'dir", "win32");
        expect(cmd).toEqual({
            command: "powershell.exe",
            args: [
                "-NoProfile",
                "-Command",
                "Start-Process -FilePath 'C:\\Users\\O''Connor\\ext''dir\\native\\devtools-scripts\\win32.bat' -ArgumentList 'true' -Verb runas -Wait",
            ],
        });
    });

    it("POSIX-single-quotes and AppleScript-escapes macOS extensionPath", () => {
        const cmd = buildElevationCommand("/Users/O'Connor/$(id)/\"quoted\"\\dir/`uname`", "darwin");
        expect(cmd).toEqual({
            command: "osascript",
            args: [
                "-e",
                "do shell script \"sh '/Users/O'\\\\''Connor/$(id)/\\\"quoted\\\"\\\\dir/`uname`/native/devtools-scripts/mac.sh' true\" with administrator privileges",
            ],
        });
    });

    it("throws on unsupported platforms", () => {
        expect(() => buildElevationCommand("/opt/ext", "linux")).toThrow(/not supported/);
    });
});
