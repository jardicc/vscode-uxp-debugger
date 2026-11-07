/**
 * Mocha entry point executed *inside* the real VS Code Extension Host
 * (loaded via `--extensionTestsPath`, see ../runTest.ts). Runs with plain
 * Node `require`, so this file (and the test files it loads) must be the
 * compiled JS output, not the TS source.
 *
 * Test files are auto-discovered (every `*.test.js` next to this file,
 * i.e. compiled from `smoke.test.ts` / `*.photoshop.test.ts`) — adding a
 * new `*.photoshop.test.ts` file needs no change here, just add the file
 * (it also gets picked up automatically by `../build.mjs`).
 */

import * as fs from "fs";
import * as path from "path";
import * as util from "util";
import Mocha from "mocha";
import {
    appendLogEntry,
    E2E_CLI_RUNNER_ENV,
    E2E_TERMINAL_PREFIX,
    formatLogBanner,
    installConsoleToFileRedirect,
    resolveOrCreateE2eLogFile,
    stripAnsi,
} from "../e2eLog";
import { repoRoot, sleep } from "./liveHelpers";

// ! TODO - Ultimately, we want to get rid of this arbitrary delay.
const PS_RECOVERY_DELAY = 500;

function appendMochaReporterOutputToLog(logFilePath: string, text: string): void {
    const clean = stripAnsi(text);
    const taggedLines = clean
        .split(/\r?\n/)
        .map((line) => {
            const trimmed = line.trim();
            if (trimmed.length === 0) {
                return "";
            }
            if (/^at\s+/.test(trimmed)) {
                return `    ${trimmed}`;
            }
            return `[mocha] ${trimmed}`;
        })
        .filter((line) => line.length > 0);

    if (taggedLines.length > 0) {
        appendLogEntry(logFilePath, taggedLines.join("\n"), "INFO");
    }
}

export function run(): Promise<void> {
    const logFilePath = resolveOrCreateE2eLogFile(repoRoot);
    const isCliRunner = process.env[E2E_CLI_RUNNER_ENV] === "1";
    const rawConsoleLog = console.log.bind(console);
    const originalMochaConsoleLog = Mocha.reporters.Base.consoleLog;

    if (!isCliRunner) {
        const startBanner = formatLogBanner("start", logFilePath);
        rawConsoleLog(startBanner);
        appendLogEntry(
            logFilePath,
            `[e2e] E2E test run started (live=${process.env.UXP_E2E_PHOTOSHOP === "1"})`,
            "INFO",
        );
        appendLogEntry(logFilePath, startBanner, "INFO");
    }

    Mocha.reporters.Base.consoleLog = (...args: unknown[]) => {
        const formatted = args.length === 0 ? "" : util.format(...args);
        if (isCliRunner) {
            for (const line of formatted.split(/\r?\n/)) {
                rawConsoleLog(`${E2E_TERMINAL_PREFIX}${line}`);
            }
        }
        else {
            rawConsoleLog(formatted);
        }
        appendMochaReporterOutputToLog(logFilePath, formatted);
    };

    const restoreConsole = installConsoleToFileRedirect(logFilePath);

    const mocha = new Mocha({
        ui: "bdd",
        timeout: 60_000,
        color: true,
        rootHooks: {
            // Quickly repeated tests can leave PS in a "not responding" state,
            // so give it a moment to recover before the next test starts.
            afterEach: async () => {
                if (process.env.UXP_E2E_PHOTOSHOP === "1") {
                    console.log(`[e2e] waiting ${PS_RECOVERY_DELAY}ms after test to avoid PS 'not responding' state`);
                    // Photoshop has no readiness event after a live test case.
                    await sleep(PS_RECOVERY_DELAY);
                }
            },
        },
    });
    const suiteDir = __dirname;

    // Optional filter so a single suite/test can be iterated on quickly
    // without re-running the entire (slow, live-Photoshop) e2e suite —
    // e.g. `set MOCHA_GREP=Multiple concurrent&&npm run test:e2e:live`.
    if (process.env.MOCHA_GREP) {
        mocha.grep(process.env.MOCHA_GREP);
    }

    const testFiles = fs
        .readdirSync(suiteDir)
        .filter((file) => file.endsWith(".test.js"))
        .sort();
    for (const file of testFiles) {
        mocha.addFile(path.join(suiteDir, file));
    }

    const cleanupLogging = (): void => {
        Mocha.reporters.Base.consoleLog = originalMochaConsoleLog;
        restoreConsole();
        if (!isCliRunner) {
            const endBanner = formatLogBanner("end", logFilePath);
            appendLogEntry(logFilePath, endBanner, "INFO");
            rawConsoleLog(endBanner);
        }
    };

    return new Promise((resolve, reject) => {
        try {
            const runner = mocha.run((failures) => {
                cleanupLogging();
                if (failures > 0) {
                    reject(new Error(`${failures} e2e test(s) failed.`));
                }
                else {
                    resolve();
                }
            });
            runner.on(Mocha.Runner.constants.EVENT_TEST_BEGIN, (test: Mocha.Test) => {
                console.log(`[mocha] Starting test: ${test.fullTitle()}`);
            });
        }
        catch (err) {
            cleanupLogging();
            reject(err instanceof Error ? err : new Error(String(err)));
        }
    });
}
