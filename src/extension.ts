import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { UxpDebugConfigProvider } from "./debugConfigProvider";
import { discoverUxpTargets, UxpTarget } from "./uxpDiscovery";
import { CdpProxyServer } from "./cdpProxy";

/** Active CDP proxy instance (one per debug session). */
let activeCdpProxy: CdpProxyServer | undefined;

const MANIFEST_HISTORY_KEY = "uxp.manifestPathHistory";

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("UXP Debugger");
  outputChannel.appendLine("UXP Debugger extension activated.");

  // Register the debug configuration provider for type "uxp"
  const configProvider = new UxpDebugConfigProvider(outputChannel);
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider("uxp", configProvider)
  );

  // ---- Command: uxp.setManifestPath ----------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand("uxp.setManifestPath", () =>
      selectManifestPath(context, outputChannel)
    )
  );

  // ---- Command: uxp.attach ------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand("uxp.attach", async () => {
      try {
        // 1. Get or prompt for manifest.json path
        const history = context.globalState.get<string[]>(MANIFEST_HISTORY_KEY, []);
        let manifestPath: string | undefined = history[0];
        if (!manifestPath) {
          manifestPath = await selectManifestPath(context, outputChannel);
        }
        if (!manifestPath) {
          vscode.window.showWarningMessage(
            "No manifest.json path selected. Use 'UXP: Set Manifest Path' to configure."
          );
          return;
        }

        const pluginDir = path.dirname(manifestPath);
        outputChannel.appendLine(`Plugin directory (from manifest.json): ${pluginDir}`);

        const projectDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
        outputChannel.appendLine(`Project directory (workspace): ${projectDir}`);

        // 2. Read .debug.json next to manifest.json to get port automatically
        const debugPort = readDebugPort(pluginDir, outputChannel);
        const extraPorts: number[] = [];
        if (debugPort !== undefined) {
          extraPorts.push(debugPort);
        } else {
          const configuredPort = vscode.workspace
            .getConfiguration("uxp-debugger")
            .get<number>("port");
          if (configuredPort) {
            extraPorts.push(configuredPort);
          }
        }

        // 3. Discover available UXP targets
        const targets = await discoverUxpTargets(outputChannel, extraPorts);

        if (targets.length === 0) {
          vscode.window.showWarningMessage(
            "No running UXP targets found. Make sure an Adobe host application is running with a loaded UXP plugin."
          );
          return;
        }

        // 4. Let the user pick a target
        const target = await pickTarget(targets);
        if (!target) {
          return;
        }

        outputChannel.appendLine(
          `Selected target: ${target.label} (ws: ${target.webSocketUrl})`
        );

        // 5. Start the CDP proxy
        const webRoot = projectDir;
        outputChannel.appendLine(`Using webRoot: ${webRoot}`);

        activeCdpProxy = new CdpProxyServer(target.webSocketUrl, target.label, webRoot, projectDir, pluginDir, outputChannel);
        const proxyPort = await activeCdpProxy.start();
        outputChannel.appendLine(`CDP proxy listening on port ${proxyPort}`);

        // 6. Build a debug configuration for the built-in JS debugger
        const debugConfig: vscode.DebugConfiguration = {
          type: "pwa-node",
          request: "attach",
          name: `UXP – ${target.label}`,
          port: proxyPort,
          webRoot: webRoot,
          sourceMaps: true,
          trace: true,
          resolveSourceMapLocations: null,
          sourceMapPathOverrides: {
            "webpack-internal:///./src/*": `${webRoot}/src/*`,
            "webpack-internal:///./*": `${webRoot}/*`,
            "webpack-internal:///*": "*",
            "webpack:///./~/*": `${webRoot}/node_modules/*`,
            "webpack:///./*": `${webRoot}/*`,
            "webpack:///*": "*",
            "webpack:///src/*": `${webRoot}/*`,
          },
        };

        // 7. Delegate to the built-in JS debugger
        const started = await vscode.debug.startDebugging(
          vscode.workspace.workspaceFolders?.[0],
          debugConfig
        );

        if (!started) {
          vscode.window.showErrorMessage(
            "Failed to start the JS debug session. Check the output panel for details."
          );
          await activeCdpProxy.stop();
          activeCdpProxy = undefined;
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`UXP Attach failed: ${message}`);
        outputChannel.appendLine(`Error: ${message}`);
      }
    })
  );

  // ---- Command: uxp.discover ----------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand("uxp.discover", async () => {
      const targets = await discoverUxpTargets(outputChannel);
      if (targets.length === 0) {
        vscode.window.showInformationMessage("No UXP targets found.");
        return;
      }
      const items = targets.map((t) => `${t.label}  (${t.webSocketUrl})`);
      vscode.window.showQuickPick(items, {
        title: "Discovered UXP Targets",
        placeHolder: "Available targets (read-only list)",
      });
    })
  );

  // Clean up the proxy when a debug session ends
  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession(async (session) => {
      if (session.configuration?.type === "pwa-node" && activeCdpProxy) {
        outputChannel.appendLine("Debug session ended – stopping CDP proxy.");
        await activeCdpProxy.stop();
        activeCdpProxy = undefined;
      }
    })
  );
}

export function deactivate(): void {
  activeCdpProxy?.stop();
  activeCdpProxy = undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Show a QuickPick so the user can choose which UXP target to attach to.
 */
async function pickTarget(
  targets: UxpTarget[]
): Promise<UxpTarget | undefined> {
  if (targets.length === 1) {
    return targets[0];
  }

  const items: vscode.QuickPickItem[] = targets.map((t) => ({
    label: t.label,
    description: t.hostApp,
    detail: t.webSocketUrl,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: "Select UXP Target",
    placeHolder: "Choose a UXP plugin to attach the debugger to",
  });

  if (!picked) {
    return undefined;
  }

  return targets.find((t) => t.webSocketUrl === picked.detail);
}

// ---------------------------------------------------------------------------
// Manifest path selection & .debug port reader
// ---------------------------------------------------------------------------

/**
 * Show a QuickPick with the last 10 manifest.json paths plus a "Browse…"
 * option.  Returns the selected absolute path, or undefined if cancelled.
 */
async function selectManifestPath(
  context: vscode.ExtensionContext,
  log: vscode.OutputChannel
): Promise<string | undefined> {
  const history = context.globalState.get<string[]>(MANIFEST_HISTORY_KEY, []);

  interface ManifestPickItem extends vscode.QuickPickItem {
    manifestPath?: string;
  }

  const items: ManifestPickItem[] = [
    {
      label: "$(folder-opened) Browse\u2026",
      description: "Select manifest.json file",
      alwaysShow: true,
    },
    ...history.map((p, i) => ({
      label: p,
      description: i === 0 ? "(current)" : undefined,
      manifestPath: p,
    })),
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: "Select manifest.json",
    placeHolder: "Choose from recent paths or browse for a new one",
  });

  if (!picked) {
    return undefined;
  }

  let selectedPath: string;

  if (!picked.manifestPath) {
    // User chose "Browse…"
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { JSON: ["json"] },
      title: "Select manifest.json",
    });
    if (!uris || uris.length === 0) {
      return undefined;
    }
    selectedPath = uris[0].fsPath;
  } else {
    selectedPath = picked.manifestPath;
  }

  // Update history: move selected path to front, keep max 10 unique entries
  let newHistory = history.filter((p) => p !== selectedPath);
  newHistory.unshift(selectedPath);
  if (newHistory.length > 10) {
    newHistory = newHistory.slice(0, 10);
  }
  await context.globalState.update(MANIFEST_HISTORY_KEY, newHistory);

  const pluginDir = path.dirname(selectedPath);
  log.appendLine(`Manifest path set: ${selectedPath} (plugin dir: ${pluginDir})`);

  const debugPort = readDebugPort(pluginDir, log);
  if (debugPort !== undefined) {
    vscode.window.showInformationMessage(`UXP: Found port ${debugPort} in .debug.json`);
  }

  return selectedPath;
}

/**
 * Read the debug port from the `.debug` file located next to manifest.json.
 * Returns undefined if the file does not exist or has no valid port.
 */
function readDebugPort(
  projectDir: string,
  log: vscode.OutputChannel
): number | undefined {
  const debugFilePath = path.join(projectDir, ".debug.json");
  try {
    if (fs.existsSync(debugFilePath)) {
      const content = fs.readFileSync(debugFilePath, "utf-8");
      const config = JSON.parse(content);
      if (typeof config.port === "number" && config.port > 0) {
        log.appendLine(`Found .debug.json file with port: ${config.port}`);
        return config.port;
      }
    }
  } catch (err) {
    log.appendLine(
      `Failed to read .debug.json: ${err instanceof Error ? err.message : err}`
    );
  }
  return undefined;
}
