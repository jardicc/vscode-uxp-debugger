// ---------------------------------------------------------------------------
// UXP Target descriptor
// ---------------------------------------------------------------------------

export interface UxpTarget {
  /** Human-readable label for the quick-pick list. */
  label: string;
  /** Adobe host application name (e.g. "Photoshop", "InDesign"). */
  hostApp: string;
  /** Plugin ID inside the host app. */
  pluginId: string;
  /** WebSocket URL for the CDP endpoint. */
  webSocketUrl: string;
  /** Optional local root for source-map path mapping. */
  webRoot?: string;
}

// ---------------------------------------------------------------------------
// Persisted target history entry
// ---------------------------------------------------------------------------

export interface TargetHistoryEntry {
  /** Absolute path to the plugin's manifest.json. */
  manifestPath: string;
  /** Label of the target at the time it was used. */
  targetLabel: string;
  /** Host application name (e.g. "Photoshop"). */
  hostApp: string;
  /** Plugin / session ID used for matching on reconnect. */
  pluginId: string;
  /** Unix timestamp (ms) of last successful attach. */
  lastUsed: number;
}