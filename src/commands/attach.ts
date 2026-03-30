import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { TARGET_HISTORY_KEY } from "../constants";
import { UxpTarget, TargetHistoryEntry } from "../types";
import { discoverViaDebugJson } from "../endpointDetection/discoverViaDebugJson";
import { discoverViaUxpRc } from "../endpointDetection/discoverViaUxpRc";
import { CdpProxyServer } from "../cdpProxy";
import { pickTarget } from "../uiHelpers";

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
// Main attach command
// ---------------------------------------------------------------------------

export async function attachCommand(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel
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

    const history = loadHistory(context);
    // Also persist the pruned list (stale entries removed)
    await context.globalState.update(TARGET_HISTORY_KEY, history);

    interface HistoryPickItem extends vscode.QuickPickItem {
      entry?: TargetHistoryEntry;
    }

    const items: HistoryPickItem[] = [
      {
        label: "$(add) Select new target\u2026",
        description: "Browse for manifest.json and discover targets",
        alwaysShow: true,
      },
      ...history.map((e) => {
        const dir = path.basename(path.dirname(e.manifestPath));
        const ago = formatTimeAgo(e.lastUsed);
        return {
          label: e.targetLabel,
          description: `${e.hostApp} \u2013 ${dir}`,
          detail: `${e.manifestPath}  \u00b7  ${ago}`,
          entry: e,
        };
      }),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: "UXP Attach",
      placeHolder: history.length > 0
        ? "Pick a recent target or select a new one"
        : "No recent targets \u2013 select a new manifest.json",
    });

    if (!picked) {
      return;
    }

    if (picked.entry) {
      // ---- Reconnect to a previously used target ----
      const entry = picked.entry;
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
        vscode.window.showWarningMessage(
          "No running UXP targets found for this plugin. " +
          "Make sure the Adobe host application is running with the plugin loaded."
        );
        return;
      }

      await doAttach(entry.manifestPath, target, context, outputChannel);
    } else {
      // ---- New target flow ----
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
      const manifestPath = manifestUri[0].fsPath;
      const pluginDir = path.dirname(manifestPath);
      outputChannel.appendLine(`Plugin directory (from manifest.json): ${pluginDir}`);

      const targets = await discoverTargets(pluginDir, outputChannel);

      if (targets.length === 0) {
        vscode.window.showWarningMessage(
          "No running UXP targets found. Make sure an Adobe host application is running with a loaded UXP plugin, " +
          "or use 'uxp plugin load' from devtools-cli to generate a .uxprc session file."
        );
        return;
      }

      const target = await pickTarget(targets);
      if (!target) {
        return;
      }

      await doAttach(manifestPath, target, context, outputChannel);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`UXP Attach failed: ${message}`);
    outputChannel.appendLine(`Error: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) { return "just now"; }
  if (minutes < 60) { return `${minutes}m ago`; }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) { return `${hours}h ago`; }
  const days = Math.floor(hours / 24);
  if (days < 30) { return `${days}d ago`; }
  return new Date(timestamp).toLocaleDateString();
}
