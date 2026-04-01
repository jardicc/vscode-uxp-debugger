import * as path from "path";
import {MANIFEST_HISTORY_KEY, MAX_HISTORY_ENTRIES} from "../constants";
import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Manifest path selection & .debug port reader
// ---------------------------------------------------------------------------

/**
 * Show a QuickPick with the last 10 manifest.json paths plus a "Browse…"
 * option.  Returns the selected absolute path, or undefined if cancelled.
 */
export async function selectManifestPath(
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
  if (newHistory.length > MAX_HISTORY_ENTRIES) {
	newHistory = newHistory.slice(0, MAX_HISTORY_ENTRIES);
  }
  await context.globalState.update(MANIFEST_HISTORY_KEY, newHistory);

  const pluginDir = path.dirname(selectedPath);
  log.appendLine(`Manifest path set: ${selectedPath} (plugin dir: ${pluginDir})`);

  return selectedPath;
}

