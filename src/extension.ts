import * as vscode from "vscode";
import { UxpDebugConfigProvider } from "./debugConfigProvider";
import { attachCommand, getActiveCdpProxy, clearActiveCdpProxy } from "./commands/attach";
import { patchAsarCommand } from "./commands/patchAsar";
import { selectManifestPath } from "./commands/setManifestPath";



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
    vscode.commands.registerCommand("uxp.attach", () =>
      attachCommand(context, outputChannel)
    )
  );

  // ---- Command: uxp.patchAsar -------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand("uxp.patchAsar", () =>
      patchAsarCommand(outputChannel)
    )
  );

  // Clean up the proxy when a debug session ends
  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession(async (session) => {
      if (session.configuration?.type === "pwa-node" && getActiveCdpProxy()) {
        outputChannel.appendLine("Debug session ended – stopping CDP proxy.");
        await getActiveCdpProxy()!.stop();
        clearActiveCdpProxy();
      }
    })
  );
}

export function deactivate(): void {
  getActiveCdpProxy()?.stop();
  clearActiveCdpProxy();
}