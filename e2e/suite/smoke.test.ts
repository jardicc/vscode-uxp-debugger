/**
 * Always-run smoke test: does the extension activate and register its
 * commands inside a *real* VS Code instance? No Photoshop required — safe
 * to run in CI (though currently only wired to run locally via
 * `npm run test:e2e`; see e2e/README.md).
 */

import * as assert from "assert";
import * as vscode from "vscode";

describe("UXP Debugger extension (smoke)", () => {
    it("activates and registers its commands", async () => {
        const ext = vscode.extensions.getExtension("JaroslavBereza.uxpdebugger");
        assert.ok(ext, "extension not found — is it installed in the test profile?");

        await ext.activate();
        assert.strictEqual(ext.isActive, true);

        const commands = await vscode.commands.getCommands(true);
        for (const id of [
            "uxp.loadPlugin",
            "uxp.loadPluginBreakOnStart",
            "uxp.unloadPlugin",
            "uxp.reloadPlugin",
            "uxp.attachDebugger",
            "uxp.debugScript",
            "uxp.enableDevMode",
        ]) {
            assert.ok(commands.includes(id), `command "${id}" not registered`);
        }
    });
});
