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
import Mocha from "mocha";
import { sleep } from "./liveHelpers";

export function run(): Promise<void> {
    const mocha = new Mocha({
        ui: "bdd",
        timeout: 60_000,
        color: true,
        rootHooks: {
            // Quickly repeated tests can leave PS in a "not responding" state,
            // so give it a moment to recover before the next test starts.
            afterEach: async () => {
                if (process.env.UXP_E2E_PHOTOSHOP === "1") {
                    console.log("[e2e] waiting 2000ms after test to avoid PS 'not responding' state");
                    // Photoshop has no readiness event after a live test case.
                    await sleep(500);
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

    return new Promise((resolve, reject) => {
        try {
            mocha.run((failures) => {
                if (failures > 0) {
                    reject(new Error(`${failures} e2e test(s) failed.`));
                }
                else {
                    resolve();
                }
            });
        }
        catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
        }
    });
}
