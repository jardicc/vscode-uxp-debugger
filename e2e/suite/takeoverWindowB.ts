/**
 * Runs as the "requester" side of a multi-window broker takeover, inside a
 * SECOND, real, separate VS Code Extension Development Host process —
 * spawned and awaited by `takeover.photoshop.test.ts` (window A). This file
 * deliberately does NOT match `*.test.ts`, so it's never picked up by
 * `suite/index.ts`'s auto-discovery (which would try to run it as a mocha
 * test inside window A) — instead it's compiled as its own explicit esbuild
 * entry point (see `../build.mjs`) and passed as window B's own
 * `--extensionTestsPath`. Its only contract is the plain
 * `run(): Promise<void>` signature `@vscode/test-electron` expects: resolve
 * on success, reject (throw) on failure — the exit code of this whole VS
 * Code process reflects that back to window A's `runTests()` call.
 */

import * as assert from "assert";
import * as fs from "fs";
import * as vscode from "vscode";
import { activateExtension, manifest2Path, TIMEOUT_DEFAULT, waitFor } from "./liveHelpers";

const TAKEN_OVER_MESSAGE = "UXP Debugger was taken over by another VS Code window.";

function withTimeout(promise: Promise<void>, ms: number, label: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out (${ms}ms) waiting for ${label}`)), ms);
        promise.then(
            () => {
                clearTimeout(timer);
                resolve();
            },
            (err: unknown) => {
                clearTimeout(timer);
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                reject(err);
            },
        );
    });
}

export async function run(): Promise<void> {
    console.log("[windowB] activating extension...");
    const api = await activateExtension();
    console.log("[windowB] extension activated");

    const warningTarget = vscode.window as unknown as { showWarningMessage: unknown };
    const infoTarget = vscode.window as unknown as { showInformationMessage: unknown };
    const originalWarning = warningTarget.showWarningMessage;
    const originalInfo = infoTarget.showInformationMessage;

    // Auto-confirm our own "Take Over" modal (dialogs.ts `takeoverConfirmDialog`)
    // — this window is REQUESTING ownership away from window A, every round.
    // eslint-disable-next-line @typescript-eslint/require-await
    warningTarget.showWarningMessage = async (message: string) => {
        console.log(`[windowB] showWarningMessage: ${message}`);
        return "Take Over";
    };

    // Number of full "B takes over, then A takes back" round-trips to do in
    // THIS SAME process — >1 is the regression scenario for the native
    // Vulcan-adapter crash fixed 2026-07-30 (MULTI-WINDOW-TAKEOVER.md
    // §5), which specifically only reproduced on the SECOND (or later)
    // broker restart within one window's process.
    const rounds = Number(process.env.UXP_E2E_TAKEOVER_ROUNDS ?? "1");
    const readyMarkerBase = process.env.UXP_E2E_WINDOWB_READY_MARKER;
    const windowAReadyMarkerBase = process.env.UXP_E2E_WINDOWA_READY_MARKER;

    try {
        for (let round = 1; round <= rounds; round++) {
            // Before re-acquiring, wait for window A to signal that ITS retake
            // from the previous round has actually settled (session established)
            // — otherwise this round's takeover request can yank the connection
            // out from under window A's still-in-flight loadPlugin, the same
            // class of race fixed for the opposite direction below.
            if (round > 1 && windowAReadyMarkerBase) {
                const previousMarker = `${windowAReadyMarkerBase}.${round - 1}`;
                await waitFor(() => fs.existsSync(previousMarker), TIMEOUT_DEFAULT);
                fs.rmSync(previousMarker, { force: true });
                console.log(`[windowB] round ${round}/${rounds}: window A signaled its round ${round - 1} retake settled`);
            }

            // Watch for the "taken over by another window" notice (re-armed each
            // round — window A takes ownership back at the end of every round).
            let resolveTakenOver!: () => void;
            const takenOverByA = new Promise<void>((resolve) => {
                resolveTakenOver = resolve;
            });
            // eslint-disable-next-line @typescript-eslint/require-await
            infoTarget.showInformationMessage = async (message: string) => {
                console.log(`[windowB] round ${round}/${rounds}: showInformationMessage: ${message}`);
                if (message === TAKEN_OVER_MESSAGE) {
                    resolveTakenOver();
                }
                return undefined;
            };

            console.log(`[windowB] round ${round}/${rounds}: calling loadPlugin(manifest2Path)...`);
            const result = await api.service.loadPlugin(manifest2Path, false);
            console.log(`[windowB] round ${round}/${rounds}: loadPlugin resolved with ${result.sessions.length} session(s)`);
            assert.ok(
                result.sessions.length > 0,
                "expected plugin2 to load in this window after taking over broker ownership from window A",
            );
            assert.strictEqual(api.service.sessionsForManifest(manifest2Path).length, 1);

            // Signal window A that our loadPlugin call for THIS round has
            // actually finished and asserted successfully — window A must not
            // race to take ownership back before this, or it yanks the host-app
            // connection out from under us mid-load (see
            // takeover.photoshop.test.ts's `waitForOwnTakeover` helper).
            if (readyMarkerBase) {
                const markerPath = `${readyMarkerBase}.${round}`;
                fs.writeFileSync(markerPath, "ready");
                console.log(`[windowB] round ${round}/${rounds}: wrote ready marker: ${markerPath}`);
            }

            // Stay alive until window A takes ownership back for this round.
            console.log(`[windowB] round ${round}/${rounds}: waiting for window A to take broker ownership back...`);
            await withTimeout(takenOverByA, 60_000, `round ${round}/${rounds}: window A to take broker ownership back`);
            console.log(`[windowB] round ${round}/${rounds}: taken over by window A`);
        }
        console.log(`[windowB] all ${rounds} round(s) complete — exiting cleanly`);
    }
    catch (err) {
        console.error("[windowB] FAILED:", err);
        throw err;
    }
    finally {
        warningTarget.showWarningMessage = originalWarning;
        infoTarget.showInformationMessage = originalInfo;
    }
}
