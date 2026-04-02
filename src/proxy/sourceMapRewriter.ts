import * as path from "path";
import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Source-map & URL rewriting (pure functions)
// ---------------------------------------------------------------------------

/**
 * Normalize a UXP script URL to a form that the built-in JS debugger
 * can map to local files.
 *
 * Common UXP URL schemes:
 *   uxp://com.adobe.plugin/index.js  →  /index.js
 *   file:///path/to/plugin/index.js  →  kept as-is
 *   http(s)://...                    →  kept as-is
 */
export function normalizeScriptUrl(url: string): string {
  if (url.startsWith("uxp://")) {
    // Strip the scheme and plugin-id prefix, keep the relative path
    const withoutScheme = url.replace(/^uxp:\/\/[^/]+/, "");
    return withoutScheme || url;
  }
  return url;
}

// ! This is bad for performance. Find out a way to avoid this if possible.
/**
 * Rewrite the `sourceRoot` inside an inline (data-URL) source map so that
 * relative `sources` entries resolve to the correct local files.
 *
 * Webpack source maps typically contain paths like `../src/shared/store.ts`
 * which are relative to the output directory (one level below the project
 * root).  By setting `sourceRoot` to `<projectDir>/_/` we ensure that
 * `../<path>` resolves back to `<projectDir>/<path>`.
 */
export function rewriteInlineSourceMapRoot(
  dataUrl: string,
  pluginDir: string,
  scriptSubdir: string,
  log: vscode.OutputChannel,
): string {
  try {
    // data:application/json;base64,<payload>
    // data:application/json;charset=utf-8;base64,<payload>
    // Do not change if this is not data URL or does not look like an inline source map.
    const requiredPrefix = "data:application/json";
    if (!dataUrl.slice(0, requiredPrefix.length).toLowerCase().startsWith(requiredPrefix)) {
      log.appendLine(`[CDP] Not an inline source map: ${dataUrl}`);
      return dataUrl;
    }
    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx === -1) { return dataUrl; }
    const header = dataUrl.slice(0, commaIdx);  // everything before the comma
    const payload = dataUrl.slice(commaIdx + 1);

    const json = Buffer.from(payload, "base64").toString("utf-8");
    const map = JSON.parse(json);

    // Use a file:// URL so that js-debug resolves paths as local files.
    // Include the script's subdirectory so relative source entries resolve correctly.
    const baseDir = pluginDir.replace(/\\/g, "/") + (scriptSubdir ? "/" + scriptSubdir : "");
    const root = "file:///" + baseDir + "/";
    const oldRoot = map.sourceRoot;
    map.sourceRoot = root;

    log.appendLine(
      `[CDP] Rewrote sourceRoot: ${JSON.stringify(oldRoot)} → ${JSON.stringify(root)}`
    );

    const newJson = JSON.stringify(map);
    const newPayload = Buffer.from(newJson, "utf-8").toString("base64");
    return header + "," + newPayload;
  } catch (e) {
    log.appendLine(
      `[CDP] Failed to rewrite inline source map: ${e instanceof Error ? e.message : e}`
    );
    return dataUrl;
  }
}
