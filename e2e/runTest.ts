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
import {
    appendLogEntry,
    createChildOutputStream,
    createE2eLogFile,
    E2E_CLI_RUNNER_ENV,
    E2E_LOG_FILE_ENV,
    formatLogBanner,
    installConsoleToFileRedirect,
} from "./e2eLog";

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

    const logFilePath = createE2eLogFile(repoRoot);
    process.env[E2E_LOG_FILE_ENV] = logFilePath;
    process.env[E2E_CLI_RUNNER_ENV] = "1";

    const writeTerminalLine = (line: string): void => {
        process.stdout.write(`${line}\n`);
    };
    const writeTerminalError = (line: string): void => {
        process.stderr.write(`${line}\n`);
    };

    const startBanner = formatLogBanner("start", logFilePath);
    writeTerminalLine(startBanner);
    appendLogEntry(
        logFilePath,
        `[e2e] E2E test run started (live=${process.env.UXP_E2E_PHOTOSHOP === "1"})`,
        "INFO",
    );
    appendLogEntry(logFilePath, startBanner, "INFO");

    let sawMochaOutput = false;
    const stdoutStream = createChildOutputStream({
        logFilePath,
        defaultLevel: "INFO",
        sourceTag: "vscode",
        onTerminalLine: (line) => {
            sawMochaOutput = true;
            writeTerminalLine(line);
        },
    });
    const stderrStream = createChildOutputStream({
        logFilePath,
        defaultLevel: "WARN",
        sourceTag: "vscode:stderr",
        onTerminalLine: (line) => {
            sawMochaOutput = true;
            writeTerminalLine(line);
        },
    });

    const restoreConsole = installConsoleToFileRedirect(logFilePath);
    try {
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [workspacePath, "--disable-extensions", `--remote-debugging-port=${rendererCdpPort}`],
            stdout: stdoutStream,
            stderr: stderrStream,
        });
    }
    catch (err) {
        const errText = err instanceof Error ? err.stack ?? err.message : String(err);
        appendLogEntry(logFilePath, `[e2e] test run failed: ${errText}`, "ERROR");
        if (!sawMochaOutput as boolean) {
            writeTerminalError(`[e2e] test run failed before Mocha output: ${errText}`);
        }
        process.exitCode = 1;
    }
    finally {
        stdoutStream.flush();
        stderrStream.flush();
        restoreConsole();
        const endBanner = formatLogBanner("end", logFilePath);
        appendLogEntry(logFilePath, endBanner, "INFO");
        writeTerminalLine(endBanner);
    }
}

void main();
