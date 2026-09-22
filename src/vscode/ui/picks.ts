/**
 * QuickPicks shared by the plugin/script commands.
 */

import * as fs from "fs";
import * as vscode from "vscode";
import { parseManifestContent } from "../../core/manifest/manifest";
import type { ConnectedApp } from "../../core/broker/UxpBroker";
import type { PluginSession } from "../../core/broker/SessionRegistry";
import type { PluginRegistry, StoredPlugin } from "../panel/PluginRegistry";

/**
 * Pick a manifest from the global plugin list (the same list the panel's
 * "Plugins" section shows) — every plugin the user has ever registered,
 * regardless of which workspace/window added it.
 */
export async function pickManifest(pluginRegistry: PluginRegistry): Promise<string | undefined> {
    const plugins = pluginRegistry.snapshot.plugins;

    if (plugins.length === 0) {
        const add = "Add Manifest…";
        const choice = await vscode.window.showInformationMessage(
            "No UXP plugins are registered yet. Open your plugin's manifest.json and add it.",
            add,
        );
        if (choice !== add) {
            return undefined;
        }
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { "UXP manifest": ["json"] },
            openLabel: "Add Manifest",
            title: "Select the plugin's manifest.json",
        });
        const uri = picked?.[0];
        if (!uri) {
            return undefined;
        }
        const error = await pluginRegistry.addPlugin(uri.fsPath);
        if (error) {
            void vscode.window.showErrorMessage(`UXP: ${error}`);
            return undefined;
        }
        return pluginRegistry.snapshot.plugins.length > 0 ? pickManifest(pluginRegistry) : undefined;
    }

    const existing = plugins.filter((p) => fs.existsSync(p.manifestPath));
    const missing = plugins.filter((p) => !fs.existsSync(p.manifestPath));
    for (const plugin of missing) {
        void warnMissingPlugin(pluginRegistry, plugin);
    }
    if (existing.length === 0) {
        return undefined;
    }
    if (existing.length === 1) {
        return existing[0].manifestPath;
    }

    interface Item extends vscode.QuickPickItem {
        plugin: StoredPlugin;
    }
    const items: Item[] = existing.map((plugin) => {
        let label = plugin.manifestPath;
        let description = "";
        try {
            const parsed = parseManifestContent(
                fs.readFileSync(plugin.manifestPath, "utf-8"),
                plugin.manifestPath,
            );
            label = `${parsed.manifest.name} (${parsed.manifest.id})`;
            description = plugin.manifestPath;
        }
        catch {
            // Fall back to the raw path when the manifest is currently broken.
        }
        return { label, description, plugin };
    });

    const picked = await vscode.window.showQuickPick(items, {
        title: "Select UXP Plugin Manifest",
        placeHolder: "Which plugin do you want to work with?",
    });
    return picked?.plugin.manifestPath;
}

async function warnMissingPlugin(
    pluginRegistry: PluginRegistry,
    plugin: StoredPlugin,
): Promise<void> {
    const remove = "Remove from list";
    const choice = await vscode.window.showWarningMessage(
        `Registered UXP plugin manifest not found: ${plugin.manifestPath}`,
        remove,
    );
    if (choice === remove) {
        await pluginRegistry.removePlugin(plugin.manifestPath);
    }
}

/** Pick one live session (auto-selects when there is exactly one). */
export async function pickSession(
    sessions: PluginSession[],
    title: string,
): Promise<PluginSession | undefined> {
    if (sessions.length === 0) {
        return undefined;
    }
    if (sessions.length === 1) {
        return sessions[0];
    }

    interface Item extends vscode.QuickPickItem {
        session: PluginSession;
    }
    const items: Item[] = sessions.map((session) => ({
        label: session.name,
        description: `${session.app.appName} ${session.app.appVersion}`,
        detail: session.pluginPath,
        session,
    }));
    const picked = await vscode.window.showQuickPick(items, {
        title,
        placeHolder: "Select a plugin session",
    });
    return picked?.session;
}

/** Pick one connected host app (auto-selects when there is exactly one). */
export async function pickApp(
    apps: ConnectedApp[],
    title: string,
): Promise<ConnectedApp | undefined> {
    if (apps.length === 0) {
        return undefined;
    }
    if (apps.length === 1) {
        return apps[0];
    }

    interface Item extends vscode.QuickPickItem {
        app: ConnectedApp;
    }
    const items: Item[] = apps.map((app) => ({
        label: `${app.info.appName} ${app.info.appVersion}`,
        description: `UXP ${app.info.uxpVersion}`,
        app,
    }));
    const picked = await vscode.window.showQuickPick(items, {
        title,
        placeHolder: "Select a host application",
    });
    return picked?.app;
}
