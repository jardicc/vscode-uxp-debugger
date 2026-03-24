import * as http from "http";
import * as vscode from "vscode";

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
// Discovery
// ---------------------------------------------------------------------------

/**
 * Default ports used by the UXP Developer Tool service.
 * Adobe's UXP Developer Tool typically exposes a JSON endpoint on these ports
 * that lists debuggable plugin targets (similar to Chrome's /json/list).
 *
 * These are the well-known ports for common host applications.
 * You can extend this list as needed.
 */
const DEFAULT_DISCOVERY_PORTS = [14001, 14002, 14003];

/**
 * Timeout (ms) for each HTTP probe of a discovery port.
 */
const PROBE_TIMEOUT_MS = 3000;

/**
 * Discover all running UXP targets by probing known ports for the
 * CDP-compatible JSON listing.
 *
 * The UXP Developer Tool / host apps expose an HTTP endpoint at
 * `http://localhost:<port>/json` (or `/json/list`) which returns an array
 * of debuggable targets, each with a `webSocketDebuggerUrl`.
 */
export async function discoverUxpTargets(
  log: vscode.OutputChannel
): Promise<UxpTarget[]> {
  log.appendLine("Starting UXP target discovery…");

  const allTargets: UxpTarget[] = [];

  // Probe all known ports in parallel
  const results = await Promise.allSettled(
    DEFAULT_DISCOVERY_PORTS.map((port) => probePort(port, log))
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      allTargets.push(...result.value);
    }
  }

  log.appendLine(`Discovery complete – found ${allTargets.length} target(s).`);
  return allTargets;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Probe a single port for CDP target information.
 * Tries both `/json/list` and `/json` paths, which are common conventions.
 */
async function probePort(
  port: number,
  log: vscode.OutputChannel
): Promise<UxpTarget[]> {
  for (const path of ["/json/list", "/json"]) {
    try {
      const raw = await httpGet(`http://localhost:${port}${path}`, PROBE_TIMEOUT_MS);
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        return parseTargets(data, port);
      }
    } catch {
      // Non-responsive or non-JSON – skip silently
    }
  }
  log.appendLine(`  Port ${port}: no UXP targets.`);
  return [];
}

/**
 * Parse the raw CDP target list into our UxpTarget format.
 */
function parseTargets(entries: unknown[], port: number): UxpTarget[] {
  const targets: UxpTarget[] = [];

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const obj = entry as Record<string, unknown>;

    const wsUrl =
      typeof obj.webSocketDebuggerUrl === "string"
        ? obj.webSocketDebuggerUrl
        : "";
    if (!wsUrl) {
      continue;
    }

    const title = typeof obj.title === "string" ? obj.title : "UXP Plugin";
    const id = typeof obj.id === "string" ? obj.id : `port-${port}`;

    targets.push({
      label: title,
      hostApp: inferHostApp(port),
      pluginId: id,
      webSocketUrl: wsUrl,
    });
  }

  return targets;
}

/**
 * Very simple heuristic to guess the host application from the port.
 * In production this should be replaced by information from the
 * target metadata or UXP Developer Tool APIs.
 */
function inferHostApp(port: number): string {
  switch (port) {
    case 14001:
      return "Photoshop";
    case 14002:
      return "XD";
    case 14003:
      return "InDesign";
    default:
      return "Unknown";
  }
}

// ---------------------------------------------------------------------------
// Minimal HTTP GET helper (no external dependencies)
// ---------------------------------------------------------------------------

function httpGet(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume(); // drain
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
  });
}
