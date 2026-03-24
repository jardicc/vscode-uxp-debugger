import * as vscode from "vscode";
import { UxpDebugConfigProvider } from "./debugConfigProvider";
import { discoverUxpTargets, UxpTarget } from "./uxpDiscovery";
import { CdpProxyServer } from "./cdpProxy";

/** Active CDP proxy instance (one per debug session). */
let activeCdpProxy: CdpProxyServer | undefined;

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

  // ---- Command: uxp.attach ------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand("uxp.attach", async () => {
      try {
        // 1. Discover available UXP targets
        const targets = await discoverUxpTargets(outputChannel);

        if (targets.length === 0) {
          vscode.window.showWarningMessage(
            "No running UXP targets found. Make sure an Adobe host application is running with a loaded UXP plugin."
          );
          return;
        }

        // 2. Let the user pick a target if multiple are available
        const target = await pickTarget(targets);
        if (!target) {
          return; // user cancelled
        }

        outputChannel.appendLine(
          `Selected target: ${target.label} (ws: ${target.webSocketUrl})`
        );

        // 3. Start the CDP proxy that sits between js-debug and the UXP host
        activeCdpProxy = new CdpProxyServer(target.webSocketUrl, outputChannel);
        const proxyPort = await activeCdpProxy.start();
        outputChannel.appendLine(`CDP proxy listening on port ${proxyPort}`);

        // 4. Build a debug configuration that the built-in JS debugger understands
        const debugConfig: vscode.DebugConfiguration = {
          type: "pwa-chrome",
          request: "attach",
          name: `UXP – ${target.label}`,
          port: proxyPort,
          webRoot: target.webRoot ?? "${workspaceFolder}",
          // Path-mapping can be extended here as needed
          sourceMaps: true,
          trace: true,
        };

        // 5. Delegate to the built-in JS debugger
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
      if (session.configuration?.type === "pwa-chrome" && activeCdpProxy) {
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
