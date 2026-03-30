import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as http from "http";
import {UxpTarget} from "../types";

// ---------------------------------------------------------------------------
// .debug.json discovery
// ---------------------------------------------------------------------------



/**
 * Timeout (ms) per HTTP probe attempt.
 */
const PROBE_TIMEOUT_MS = 2000;

/**
 * Read the debug port from the `.debug.json` file located next to manifest.json.
 * Returns undefined if the file does not exist or has no valid port.
 */
export function readDebugPort(
  manifestDir: string,
  log: vscode.OutputChannel
): number | undefined {
  const debugFilePath = path.join(manifestDir, ".debug.json");
  try {
    if (fs.existsSync(debugFilePath)) {
      const content = fs.readFileSync(debugFilePath, "utf-8");
      const config = JSON.parse(content);
      if (typeof config.port === "number" && config.port > 0) {
        log.appendLine(`Found .debug.json file with port: ${config.port}`);
        return config.port;
      }
    }
  } catch (err) {
    log.appendLine(
      `Failed to read .debug.json: ${err instanceof Error ? err.message : err}`
    );
  }
  return undefined;
}

/**
 * Discover UXP plugin targets via the `.debug.json` file next to manifest.json.
 *
 * Reads the port from `.debug.json` and probes that port's CDP `/json/list`
 * endpoint. If `.debug.json` has no valid port, `fallbackPort` is probed
 * instead (e.g. a port configured in extension settings).
 */
export async function discoverViaDebugJson(
  manifestDir: string,
  log: vscode.OutputChannel,
  fallbackPort?: number
): Promise<UxpTarget[]> {
  const port = readDebugPort(manifestDir, log) ?? fallbackPort;
  if (port === undefined) {
    return [];
  }
  const res = await probePluginPort(port, log);
  return res;
}

/**
 * Probe a single port for a CDP /json/list target array.
 * This works when the plugin has a .debug file that pins the debug port.
 */
export async function probePluginPort(
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