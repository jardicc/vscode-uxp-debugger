import { context } from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Devtools bundle is built from a static frontend and is slow, so build it only when missing.
if (!fs.existsSync(path.join(repoRoot, "dist", "devtools", "entrypoints", "devtools_app", "devtools_app.js"))) {
  console.log("[watch] dist/devtools missing, bundling devtools once");
  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "bundle-devtools.mjs")], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

let pending = 0;
let errors = 0;

// Single aggregated start/finish messages for the VS Code background task problem matcher.
const reporter = {
  name: "watch-reporter",
  setup(build) {
    build.onStart(() => {
      if (pending++ === 0) {
        errors = 0;
        console.log("[watch] build started");
      }
    });
    build.onEnd((result) => {
      errors += result.errors.length;
      if (--pending === 0) {
        console.log(`[watch] build finished${errors ? ` with ${errors} error(s)` : ""}`);
      }
    });
  },
};

const common = { absWorkingDir: repoRoot, bundle: true, sourcemap: true, plugins: [reporter] };

const contexts = await Promise.all([
  context({
    ...common,
    entryPoints: ["src/vscode/extension.ts"],
    outfile: "dist/extension.js",
    external: ["vscode"],
    format: "cjs",
    platform: "node",
  }),
  context({
    ...common,
    entryPoints: ["src/vscode/inspector/host/mainHost.ts"],
    outfile: "dist/inspectorHost.js",
    format: "iife",
    platform: "browser",
  }),
  context({
    ...common,
    entryPoints: ["src/vscode/panel/webview/index.tsx"],
    outfile: "dist/panel.js",
    format: "iife",
    platform: "browser",
    loader: { ".ttf": "file" },
    define: { "process.env.NODE_ENV": '"development"' },
  }),
]);

await Promise.all(contexts.map((ctx) => ctx.watch()));
