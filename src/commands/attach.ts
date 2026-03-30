import * as path from "path";
import * as vscode from "vscode";
import { MANIFEST_HISTORY_KEY } from "../constants";
import { UxpTarget } from "../types";
import { discoverViaDebugJson } from "../endpointDetection/discoverViaDebugJson";
import { discoverViaUxpRc } from "../endpointDetection/discoverViaUxpRc";
import { CdpProxyServer } from "../cdpProxy";
import { pickTarget } from "../uiHelpers";
import { selectManifestPath } from "./setManifestPath";

/** Active CDP proxy instance (one per debug session). */
let activeCdpProxy: CdpProxyServer | undefined;

export function getActiveCdpProxy(): CdpProxyServer | undefined {
  return activeCdpProxy;
}

export function clearActiveCdpProxy(): void {
  activeCdpProxy = undefined;
}

export async function attachCommand(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel
): Promise<void> {
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

    const targets: UxpTarget[] = [];

    // 2. Discover via .debug.json (reads port and probes /json/list)
    const configuredPort = vscode.workspace.getConfiguration("uxp-debugger").get<number>("port");
    const debugJsonTargets = await discoverViaDebugJson(pluginDir, outputChannel, configuredPort);
    targets.push(...debugJsonTargets);

    // 3. Discover via .uxprc (UDT Service relay sessions)
    const uxpRcTargets = discoverViaUxpRc(pluginDir, outputChannel);
    const seen = new Set(targets.map((t) => t.webSocketUrl));
    for (const t of uxpRcTargets) {
      if (!seen.has(t.webSocketUrl)) {
        targets.push(t);
      }
    }

    if (targets.length === 0) {
      vscode.window.showWarningMessage(
        "No running UXP targets found. Make sure an Adobe host application is running with a loaded UXP plugin, " +
        "or use 'uxp plugin load' from devtools-cli to generate a .uxprc session file."
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
    outputChannel.appendLine(`Using plugin directory: ${pluginDir}`);

    activeCdpProxy = new CdpProxyServer(target.webSocketUrl, target.label, pluginDir, outputChannel);
    const proxyPort = await activeCdpProxy.start();
    outputChannel.appendLine(`CDP proxy listening on port ${proxyPort}`);

    // 6. Build a debug configuration for the built-in JS debugger
    const debugConfig: vscode.DebugConfiguration = {
      type: "pwa-node",
      request: "attach",
      name: `UXP \u2013 ${target.label}`,
      port: proxyPort,
      webRoot: projectDir,
      sourceMaps: true,
      trace: true,
      resolveSourceMapLocations: null,
      sourceMapPathOverrides: {
        "webpack-internal:///./src/*": `${projectDir}/src/*`,
        "webpack-internal:///./*": `${projectDir}/*`,
        "webpack-internal:///*": "*",
        "webpack:///./~/*": `${projectDir}/node_modules/*`,
        "webpack:///./*": `${projectDir}/*`,
        "webpack:///*": "*",
        "webpack:///src/*": `${projectDir}/*`,
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
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`UXP Attach failed: ${message}`);
    outputChannel.appendLine(`Error: ${message}`);
  }
}
