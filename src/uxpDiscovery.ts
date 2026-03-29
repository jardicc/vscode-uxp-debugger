import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import * as vscode from "vscode";
import WebSocket from "ws";

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
// Port constants
// ---------------------------------------------------------------------------

/**
 * UDT (UXP Developer Tools) default service port.
 * Exposes /json/version and a browser-level CDP WebSocket at
 *   ws://127.0.0.1:14001/socket/browser_cdt/
 * but does NOT expose /json/list.
 */
const UDT_PORT = 14001;


/**
 * Ports to probe directly for /json/list (plugin CDP endpoints).
 *
 * The plugin debug port is DYNAMIC unless fixed via a .debug file placed
 * next to the plugin's manifest.json:
 *   { "port": 4243, "breakOnStart": false }
 *
 * 4243 is the conventional default used in Adobe documentation.
 * Additional well-known ports can be added here.
 */
const PLUGIN_PROBE_PORTS = [9222];

/**
 * Timeout (ms) per HTTP probe attempt.
 */
const PROBE_TIMEOUT_MS = 2000;

/**
 * Timeout (ms) for the browser-level CDP WebSocket call.
 */
const WS_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover all running UXP plugin targets.
 *
 * Two-phase strategy:
 *  Phase 1 – Browser CDP via UDT (port 14001):
 *    Connect to ws://127.0.0.1:14001/socket/browser_cdt/ and call
 *    Target.getTargets(). If UXP surfaces plugin targets here we use them.
 *
 *  Phase 2 – Direct /json/list HTTP probe:
 *    Probe PLUGIN_PROBE_PORTS for a standard CDP /json/list response.
 *    This works when the developer has placed a .debug file next to
 *    their plugin's manifest.json to pin the debug port.
 *
 * @param log          Extension output channel for diagnostic messages.
 * @param extraPorts   Additional ports to probe (e.g. from launch.json config).
 */
export async function discoverUxpTargets(
  log: vscode.OutputChannel,
  extraPorts: number[] = []
): Promise<UxpTarget[]> {
  log.appendLine("Starting UXP target discovery…");

  const seen = new Set<string>();
  const allTargets: UxpTarget[] = [];

  const addTarget = (t: UxpTarget) => {
    if (!seen.has(t.webSocketUrl)) {
      seen.add(t.webSocketUrl);
      allTargets.push(t);
    }
  };

  // Phase 1: browser-level CDP via UDT WebSocket
  //try {
  //  const browserTargets = await discoverViaBrowserCdp(log);
  //  browserTargets.forEach(addTarget);
  //} catch (err) {
  //  log.appendLine(`  Phase 1 (browser CDP) skipped: ${(err as Error).message}`);
  //}

  // Phase 2: direct /json/list on plugin debug ports
  const portsToProbe = Array.from(new Set([...PLUGIN_PROBE_PORTS, ...extraPorts]));
  const results = await Promise.allSettled(
    portsToProbe.map((port) => probePluginPort(port, log))
  );
  for (const result of results) {
    if (result.status === "fulfilled") {
      result.value.forEach(addTarget);
    }
  }

  log.appendLine(`Discovery complete – found ${allTargets.length} target(s).`);

  if (allTargets.length === 0) {
    log.appendLine(
      "Tip: Pin the plugin debug port by placing a .debug file next to manifest.json:\n" +
      '  { "port": 4243, "breakOnStart": false }'
    );
  }

  return allTargets;
}

// ---------------------------------------------------------------------------
// Phase 1 – Browser CDP via UDT WebSocket
// ---------------------------------------------------------------------------

// ! This does not seem to be supported by UXP at all. But needs to verify from Adobe
/**
 * Connect to the UDT browser-level CDP WebSocket on port 14001 and call
 * Target.getTargets(). This may surface plugin targets without needing to
 * know their dynamic port.
 */
async function discoverViaBrowserCdp(
  log: vscode.OutputChannel
): Promise<UxpTarget[]> {
  // First check that UDT is running by probing /json/version
  const version = await httpGetJson<{ webSocketDebuggerUrl?: string }>(
    `http://127.0.0.1:${UDT_PORT}/json/version`,
    PROBE_TIMEOUT_MS
  );

  const browserWsUrl = version.webSocketDebuggerUrl;
  if (!browserWsUrl) {
    throw new Error("UDT /json/version did not return a webSocketDebuggerUrl");
  }

  log.appendLine(`  Phase 1: connecting to UDT browser CDP at ${browserWsUrl}`);

  const targetsResponse = await cdpCall<{
    result: { targetInfos: CdpTargetInfo[] };
  }>(browserWsUrl, { id: 1, method: "Target.getTargets" }, WS_TIMEOUT_MS);

  const targetInfos = targetsResponse?.result?.targetInfos ?? [];
  log.appendLine(`  Phase 1: Target.getTargets returned ${targetInfos.length} target(s)`);

  return targetInfos
    .filter((t) => t.type === "page" && t.webSocketDebuggerUrl)
    .map((t) => ({
      label: t.title || t.targetId,
      hostApp: "Photoshop", // UDT currently connects to PS only
      pluginId: t.targetId,
      webSocketUrl: t.webSocketDebuggerUrl!,
    }));
}

interface CdpTargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

// ---------------------------------------------------------------------------
// Phase 2 – Direct /json/list probe
// ---------------------------------------------------------------------------

/**
 * Probe a single port for a CDP /json/list target array.
 * This works when the plugin has a .debug file that pins the debug port.
 */
async function probePluginPort(
  port: number,
  log: vscode.OutputChannel
): Promise<UxpTarget[]> {
  for (const path of ["/json/list", "/json"]) {
    try {
      const data = await httpGetJson<unknown[]>(
        `http://127.0.0.1:${port}${path}`,
        PROBE_TIMEOUT_MS
      );
      if (Array.isArray(data) && data.length > 0) {
        log.appendLine(`  Phase 2: found ${data.length} target(s) on port ${port}`);
        return parseTargets(data, port);
      }
    } catch {
      // port not open or not a CDP endpoint – ignore
    }
  }
  log.appendLine(`  Phase 2: no targets on port ${port}`);
  return [];
}

/**
 * Parse a raw /json/list array into UxpTarget descriptors.
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
      hostApp: "Photoshop", // plugin ports are PS-only for now
      pluginId: id,
      webSocketUrl: wsUrl,
    });
  }

  return targets;
}

// ---------------------------------------------------------------------------
// CDP WebSocket helper — send one command and return the response
// ---------------------------------------------------------------------------

function cdpCall<T>(
  wsUrl: string,
  message: object,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`CDP call timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.on("open", () => ws.send(JSON.stringify(message)));
    ws.on("message", (data) => {
      clearTimeout(timer);
      ws.close();
      try {
        resolve(JSON.parse(data.toString()) as T);
      } catch (e) {
        reject(e);
      }
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Minimal HTTP GET helper
// ---------------------------------------------------------------------------

function httpGetJson<T>(url: string, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T);
        } catch (e) {
          reject(e);
        }
      });
      res.on("error", reject);
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Phase 3 – .uxprc file discovery (UDT Service relay)
// ---------------------------------------------------------------------------

/**
 * Read the `.uxprc` file from the plugin directory (next to manifest.json)
 * and construct UDT Service relay targets from the stored session data.
 *
 * The `.uxprc` file is generated by `uxp plugin load` (devtools-cli) and
 * stores the plugin session ID assigned by Photoshop through the UDT Service.
 * The resulting WebSocket URL points to the UDT relay endpoint:
 *   ws://127.0.0.1:14001/socket/cdt/<pluginSessionId>
 */
export function readUxpRc(
  manifestDir: string,
  log: vscode.OutputChannel
): UxpTarget[] {
  const rcPath = path.join(manifestDir, ".uxprc");
  try {
    if (!fs.existsSync(rcPath)) {
      log.appendLine(`  .uxprc: not found at ${rcPath}`);
      return [];
    }

    const content = fs.readFileSync(rcPath, "utf-8");
    const rc = JSON.parse(content);
    const plugin = rc?.plugin;

    if (!plugin || !Array.isArray(plugin.sessions) || plugin.sessions.length === 0) {
      log.appendLine("  .uxprc: no plugin sessions found");
      return [];
    }

    const pluginName = plugin.info?.name || plugin.info?.id || "UXP Plugin";
    const targets: UxpTarget[] = [];

    for (const session of plugin.sessions) {
      const sessionId = session?.pluginSessionId;
      const app = session?.app;
      if (typeof sessionId !== "string" || !app) {
        continue;
      }

      const appId: string = app.id ?? "unknown";
      const appVersion: string = app.version ?? "";
      const hostApp = appId === "PS" ? "Photoshop" : appId;
      const wsUrl = `ws://127.0.0.1:${UDT_PORT}/socket/cdt/${sessionId}`;

      targets.push({
        label: `${pluginName} (${appId} ${appVersion}) [via UDT Service]`,
        hostApp,
        pluginId: sessionId,
        webSocketUrl: wsUrl,
      });

      log.appendLine(
        `  .uxprc: session "${sessionId}" for ${appId} ${appVersion} → ${wsUrl}`
      );
    }

    log.appendLine(`  .uxprc: found ${targets.length} session target(s)`);
    return targets;
  } catch (err) {
    log.appendLine(
      `  .uxprc: failed to read – ${err instanceof Error ? err.message : err}`
    );
    return [];
  }
}
