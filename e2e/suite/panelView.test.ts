/**
 * Always-run (no Photoshop needed) smoke test for the control-panel sidebar
 * view: the view container/view are contributed, the view resolves without
 * throwing, and the global PluginRegistry API round-trips.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { activateExtension } from "./liveHelpers";

describe("UXP control panel (smoke)", () => {
    it("contributes the view and exposes the plugin registry", async () => {
        const api = await activateExtension();
        assert.ok(api.pluginRegistry, "pluginRegistry missing from the test API");

        // Resolving the webview view must not throw — the auto-generated
        // `<viewId>.focus` command reveals (and thereby resolves) it.
        await vscode.commands.executeCommand("uxp.controlPanel.focus");

        // Registry round-trip through the real globalState memento.
        const manifestPath = "C:\\__uxp_e2e__\\panel-smoke\\manifest.json";
        try {
            await api.pluginRegistry.addPlugin(manifestPath);
            assert.ok(api.pluginRegistry.pluginByManifest(manifestPath), "plugin not stored");
            await api.pluginRegistry.setBreakOnLoad("plugins", true);
            assert.strictEqual(api.pluginRegistry.snapshot.breakOnLoad.plugins, true);
        }
        finally {
            await api.pluginRegistry.setBreakOnLoad("plugins", false);
            await api.pluginRegistry.removePlugin(manifestPath);
        }
        assert.strictEqual(
            api.pluginRegistry.pluginByManifest(manifestPath),
            undefined,
            "plugin not removed",
        );
    });
});
