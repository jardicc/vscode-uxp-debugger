/**
 * Driver for the real-VS-Code E2E suite. NOT run by `npm test` / Wallaby —
 * see e2e/README.md. Downloads (once, cached) and launches a real VS Code
 * instance with this extension loaded via `--extensionDevelopmentPath`, then
 * runs the Mocha suite in `./suite` inside the Extension Host process.
 *
 * Invoked by `npm run test:e2e` (after bundling this folder with esbuild).
 */

import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
    // Cross-platform replacement for `set UXP_E2E_PHOTOSHOP=1` (see `test:e2e:live`);
    // the launched Extension Host inherits this process's env.
    if (process.argv.includes("--live")) {
        process.env.UXP_E2E_PHOTOSHOP = "1";
    }
    // Compiled to <repoRoot>/out/e2e/runTest.js — two levels up is repo root.
    const repoRoot = path.resolve(__dirname, "../..");
    const extensionDevelopmentPath = repoRoot;
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");
    const workspacePath = path.resolve(repoRoot, "e2e/fixtures/plugin");
    // Test-only Electron CDP endpoint for inspecting rendered webview DOM; unrelated to the UXP broker on port 14001.
    // Allows the test suite to inspect the real VS Code webview DOM in a live Photoshop plugin session.
    const rendererCdpPort = process.env.UXP_E2E_RENDERER_CDP_PORT ?? "9333";

    try {
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [workspacePath, "--disable-extensions", `--remote-debugging-port=${rendererCdpPort}`],
        });
    }
    catch (err) {
        console.error("[e2e] test run failed:", err);
        process.exitCode = 1;
    }
}

void main();
