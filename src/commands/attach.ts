import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import * as vscode from "vscode";
import { TARGET_HISTORY_KEY, UDT_SERVICE_PORT } from "../constants";
import { UxpTarget, TargetHistoryEntry } from "../types";
import { discoverViaDebugJson } from "../endpointDetection/discoverViaDebugJson";
import { discoverViaUxpRc } from "../endpointDetection/discoverViaUxpRc";
import { CdpProxyServer } from "../proxy/cdpProxy";
import { pickTarget, pickHistoryOrNew } from "../uiHelpers";

/** Active CDP proxy instance (one per debug session). */
let activeCdpProxy: CdpProxyServer | undefined;

export function getActiveCdpProxy(): CdpProxyServer | undefined {
  return activeCdpProxy;
}

export function clearActiveCdpProxy(): void {
  activeCdpProxy = undefined;
}

// ---------------------------------------------------------------------------
// Target history helpers
// ---------------------------------------------------------------------------

const MAX_HISTORY = 20;

/** Load history, drop entries whose manifest.json no longer exists. */
function loadHistory(context: vscode.ExtensionContext): TargetHistoryEntry[] {
  const raw = context.globalState.get<TargetHistoryEntry[]>(TARGET_HISTORY_KEY, []);
  return raw.filter((e) => fs.existsSync(e.manifestPath));
}

/** Save / update a history entry (most-recently-used first). */
async function saveHistoryEntry(
  context: vscode.ExtensionContext,
  manifestPath: string,
  target: UxpTarget
): Promise<void> {
  let history = loadHistory(context);
  // Remove previous entry for the same manifest+pluginId combo
  history = history.filter((e) => e.manifestPath !== manifestPath);
  history.unshift({
    manifestPath,
    targetLabel: target.label,
    hostApp: target.hostApp,
    pluginId: target.pluginId,
    lastUsed: Date.now(),
  });
  if (history.length > MAX_HISTORY) {
    history = history.slice(0, MAX_HISTORY);
  }
  await context.globalState.update(TARGET_HISTORY_KEY, history);
}

// ---------------------------------------------------------------------------
// UDT Service liveness check
// ---------------------------------------------------------------------------

/**
 * Check whether UDT is listening on its well-known port.
 * Resolves `true` if UDT is reachable, `false` otherwise.
 */
function isUdtRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
    socket.connect(UDT_SERVICE_PORT, "127.0.0.1");
  });
}

/**
 * Show an appropriate "no targets" message, checking whether UDT is running
 * to give the user more actionable guidance.
 */
async function showNoTargetsMessage(outputChannel: vscode.OutputChannel): Promise<void> {
  const udtAlive = await isUdtRunning();
  if (!udtAlive) {
    outputChannel.appendLine("UDT Service is not reachable on port " + UDT_SERVICE_PORT);
    vscode.window.showErrorMessage(
      "UXP Developer Tools (UDT) does not appear to be running. " +
      "Please launch UDT before attempting to attach and check its settings that port is set to " + UDT_SERVICE_PORT + "."
    );
  } else {
    vscode.window.showWarningMessage(
      "No running UXP targets found. Make sure an Adobe host application is running with a loaded UXP plugin. " +
      "Otherwise click 'Load Button' in UXP Developer Tools to load plugin, then try attaching again."
    );
  }
}

// ---------------------------------------------------------------------------
// Discover targets for a given manifest directory
// ---------------------------------------------------------------------------

async function discoverTargets(
  pluginDir: string,
  outputChannel: vscode.OutputChannel
): Promise<UxpTarget[]> {
  const targets: UxpTarget[] = [];

  const debugJsonTargets = await discoverViaDebugJson(pluginDir, outputChannel);
  targets.push(...debugJsonTargets);

  const uxpRcTargets = discoverViaUxpRc(pluginDir, outputChannel);
  const seen = new Set(targets.map((t) => t.webSocketUrl));
  for (const t of uxpRcTargets) {
    if (!seen.has(t.webSocketUrl)) {
      targets.push(t);
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Attach to a resolved target
// ---------------------------------------------------------------------------

async function doAttach(
  manifestPath: string,
  target: UxpTarget,
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const pluginDir = path.dirname(manifestPath);
  const projectDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

  outputChannel.appendLine(
    `Selected target: ${target.label} (ws: ${target.webSocketUrl})`
  );
  outputChannel.appendLine(`Using plugin directory: ${pluginDir}`);

  activeCdpProxy = new CdpProxyServer(
    target.webSocketUrl, target.label, pluginDir, outputChannel
  );
  const proxyPort = await activeCdpProxy.start();
  outputChannel.appendLine(`CDP proxy listening on port ${proxyPort}`);

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
    return;
  }

  // Persist on successful attach
  await saveHistoryEntry(context, manifestPath, target);
}

// ---------------------------------------------------------------------------
// Attach flows – one function per entry point
// ---------------------------------------------------------------------------

/**
 * Flow 1: Attach via launch.json – manifest path is provided as an argument.
 * Discovers targets from that manifest directory and lets the user pick one.
 */
async function attachViaLaunchJson(
  manifestPath: string,
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  manifestPath = path.normalize(manifestPath);
  if (!fs.existsSync(manifestPath)) {
    vscode.window.showErrorMessage(
      `UXP: manifest.json not found at: ${manifestPath}`
    );
    return;
  }
  const pluginDir = path.dirname(manifestPath);
  outputChannel.appendLine(`Plugin directory (from launch.json): ${pluginDir}`);

  const targets = await discoverTargets(pluginDir, outputChannel);
  if (targets.length === 0) {
    await showNoTargetsMessage(outputChannel);
    return;
  }

  const target = await pickTarget(targets);
  if (!target) {
    return;
  }

  await doAttach(manifestPath, target, context, outputChannel);
}

/**
 * Flow 2: Reconnect to a previously used target from history.
 * Tries to match the saved pluginId / label, falls back to user pick.
 */
async function attachViaHistory(
  entry: TargetHistoryEntry,
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const pluginDir = path.dirname(entry.manifestPath);
  outputChannel.appendLine(`Plugin directory (from history): ${pluginDir}`);

  const targets = await discoverTargets(pluginDir, outputChannel);

  // Try to find the same target by pluginId first, then by label
  let target = targets.find((t) => t.pluginId === entry.pluginId)
            ?? targets.find((t) => t.label === entry.targetLabel);

  if (!target && targets.length === 1) {
    target = targets[0];
  } else if (!target && targets.length > 1) {
    target = await pickTarget(targets);
  }

  if (!target) {
    await showNoTargetsMessage(outputChannel);
    return;
  }

  await doAttach(entry.manifestPath, target, context, outputChannel);
}

/**
 * Flow 3: Browse for a new manifest.json via file picker, then discover
 * targets and let the user pick one.
 */
async function attachViaFilePicker(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const manifestUri = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { JSON: ["json"] },
    title: "Select manifest.json",
  });
  if (!manifestUri || manifestUri.length === 0) {
    return;
  }

  const manifestPath = path.normalize(manifestUri[0].fsPath);
  const pluginDir = path.dirname(manifestPath);
  outputChannel.appendLine(`Plugin directory (from file picker): ${pluginDir}`);

  const targets = await discoverTargets(pluginDir, outputChannel);
  if (targets.length === 0) {
    await showNoTargetsMessage(outputChannel);
    return;
  }

  const target = await pickTarget(targets);
  if (!target) {
    return;
  }

  await doAttach(manifestPath, target, context, outputChannel);
}

// ---------------------------------------------------------------------------
// Main attach command – dispatches to the appropriate flow
// ---------------------------------------------------------------------------

export async function attachCommand(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  manifestPathArg?: string
): Promise<void> {
  try {
    // Guard: if a debug session is already active, ask the user
    if (activeCdpProxy) {
      const choice = await vscode.window.showWarningMessage(
        "A UXP debug session is already active.",
        { modal: true },
        "Detach and reconnect",
      );
      if (choice !== "Detach and reconnect") {
        return;
      }
      await activeCdpProxy.stop();
      activeCdpProxy = undefined;
    }

    // Flow 1: manifest path from launch.json
    if (manifestPathArg) {
      await attachViaLaunchJson(manifestPathArg, context, outputChannel);
      return;
    }

    if (!await isUdtRunning()) {
      await showNoTargetsMessage(outputChannel);
      return;
    }

    // Flow 2 / 3: interactive – show history QuickPick
    const history = loadHistory(context);
    await context.globalState.update(TARGET_HISTORY_KEY, history);

    const picked = await pickHistoryOrNew(history);
    if (!picked) {
      return;
    }

    if (picked.kind === "history") {
      await attachViaHistory(picked.entry, context, outputChannel);
    } else if (picked.kind === "new") {
      await attachViaFilePicker(context, outputChannel);
    } else if (picked.kind === "clearHistory") {
      const confirm = await vscode.window.showWarningMessage(
        "Clear all UXP attach history?",
        { modal: true },
        "Clear"
      );
      if (confirm === "Clear") {
        await context.globalState.update(TARGET_HISTORY_KEY, []);
        vscode.window.showInformationMessage("UXP attach history cleared.");
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`UXP Attach failed: ${message}`);
    outputChannel.appendLine(`Error: ${message}`);
  }
}
