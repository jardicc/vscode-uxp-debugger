import * as path from "path";
import * as vscode from "vscode";
import {UxpTarget, TargetHistoryEntry} from "./types";

// ---------------------------------------------------------------------------
// Target picker (multiple discovered targets)
// ---------------------------------------------------------------------------

/**
 * Show a QuickPick so the user can choose which UXP target to attach to.
 */
export async function pickTarget(
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
// History / new-target picker
// ---------------------------------------------------------------------------

export type HistoryPickResult =
  | { kind: "history"; entry: TargetHistoryEntry }
  | { kind: "new" }
  | { kind: "clearHistory" }
  | undefined;

/**
 * Show a QuickPick that lets the user either reconnect to a recent target
 * from history or browse for a new manifest.json.
 */
export async function pickHistoryOrNew(
  history: TargetHistoryEntry[]
): Promise<HistoryPickResult> {
  interface HistoryPickItem extends vscode.QuickPickItem {
    entry?: TargetHistoryEntry;
    isClear?: boolean;
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
    ...(history.length > 0
      ? [{ label: "$(trash) Clear history", isClear: true, alwaysShow: true }]
      : []),
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: "UXP Attach",
    placeHolder: history.length > 0
      ? "Pick a recent target or select a new one"
      : "No recent targets \u2013 select a new manifest.json",
  });

  if (!picked) {
    return undefined;
  }

  if (picked.entry) { return { kind: "history", entry: picked.entry }; }
  if (picked.isClear) { return { kind: "clearHistory" }; }
  return { kind: "new" };
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