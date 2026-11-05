import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    emit: undefined as ((uri: { fsPath: string }) => void) | undefined,
}));

vi.mock("vscode", () => {
    const noopDisposable = { dispose: () => undefined };
    const capture = (fn: (uri: { fsPath: string }) => void) => {
        state.emit = fn;
        return noopDisposable;
    };
    return {
        Uri: { file: (fsPath: string) => ({ fsPath }) },
        RelativePattern: vi.fn(),
        debug: {
            onDidStartDebugSession: () => noopDisposable,
            onDidTerminateDebugSession: () => noopDisposable,
        },
        workspace: {
            createFileSystemWatcher: () => ({
                onDidCreate: capture,
                onDidChange: capture,
                onDidDelete: capture,
                dispose: () => undefined,
            }),
        },
    };
});

import type { UxpDebugSessionManager } from "../../src/vscode/debug/UxpDebugSessionManager";
import type { PanelController } from "../../src/vscode/panel/PanelController";
import type { PluginRegistry } from "../../src/vscode/panel/PluginRegistry";
import { isDotPathInPluginDir, PluginWatchManager } from "../../src/vscode/panel/PluginWatchManager";
import type { UxpService } from "../../src/vscode/UxpService";
import { fakeLog } from "../fixtures/fakeVscode";

describe("isDotPathInPluginDir", () => {
    const pluginDir = path.resolve("/workspace/.parent-dot/my-plugin");

    it("returns false for regular files and subfolders inside pluginDir", () => {
        expect(isDotPathInPluginDir(path.join(pluginDir, "manifest.json"), pluginDir)).toBe(false);
        expect(isDotPathInPluginDir(path.join(pluginDir, "src", "index.js"), pluginDir)).toBe(false);
        expect(isDotPathInPluginDir(path.join(pluginDir, "assets", "icon@2x.png"), pluginDir)).toBe(false);
    });

    it("returns true for dotfiles and files inside dot-subfolders relative to pluginDir", () => {
        expect(isDotPathInPluginDir(path.join(pluginDir, ".DS_Store"), pluginDir)).toBe(true);
        expect(isDotPathInPluginDir(path.join(pluginDir, ".env"), pluginDir)).toBe(true);
        expect(isDotPathInPluginDir(path.join(pluginDir, ".git", "HEAD"), pluginDir)).toBe(true);
        expect(isDotPathInPluginDir(path.join(pluginDir, ".vscode", "settings.json"), pluginDir)).toBe(true);
        expect(isDotPathInPluginDir(path.join(pluginDir, "src", ".hidden", "foo.js"), pluginDir)).toBe(true);
        expect(isDotPathInPluginDir(path.join(pluginDir, "src", ".eslintcache"), pluginDir)).toBe(true);
    });
});

describe("PluginWatchManager dot-path filtering", () => {
    const pluginDir = path.resolve("/workspace/my-plugin");
    const manifestPath = path.join(pluginDir, "manifest.json");
    const noopSub = () => ({ dispose: () => undefined });

    beforeEach(() => {
        state.emit = undefined;
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function createHarness() {
        const dispatchQueued = vi.fn(() => Promise.resolve());
        const output = fakeLog();
        const manager = new PluginWatchManager(
            {
                snapshot: {
                    v: 2,
                    plugins: [{ manifestPath, watch: true }],
                    scripts: [],
                    breakOnLoad: { plugins: false },
                },
                onDidChange: { on: () => () => undefined },
            } as unknown as PluginRegistry,
            {
                onSessionStarted: noopSub,
                onSessionEnded: noopSub,
                sessionsForManifest: () => [{ clientSessionId: "s1" }],
            } as unknown as UxpService,
            { isAttached: () => false } as unknown as UxpDebugSessionManager,
            { dispatchQueued } as unknown as PanelController,
            output,
        );
        const fire = (rel: string) => state.emit?.({ fsPath: path.join(pluginDir, rel) });
        return { manager, dispatchQueued, output, fire };
    }

    it("ignores changes to dotfiles and dot-subfolders without triggering refresh or reload", () => {
        const { manager, dispatchQueued, fire } = createHarness();

        fire(".git/index");
        fire(".vscode/launch.json");
        fire(".DS_Store");
        fire("src/.hidden-file.js");

        vi.advanceTimersByTime(500);
        expect(dispatchQueued).not.toHaveBeenCalled();
        manager.dispose();
    });

    it("still refreshes when a non-dot file changes alongside dot-path events", () => {
        const { manager, dispatchQueued, output, fire } = createHarness();

        fire(".git/index");
        fire("src/main.js");

        vi.advanceTimersByTime(500);
        expect(dispatchQueued).toHaveBeenCalledTimes(1);
        expect(dispatchQueued).toHaveBeenCalledWith({ kind: "refreshPlugin", manifestPath });
        expect(output.lines.some((line) => line.includes("1 file(s) changed"))).toBe(true);
        manager.dispose();
    });
});
