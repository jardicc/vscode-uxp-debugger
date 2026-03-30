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