#!/usr/bin/env node
/**
 * Bundles the e2e harness with esbuild. Auto-discovers every
 * `e2e/suite/*.test.ts` file as its own entry point (bundled separately so
 * Mocha can `require` each one individually — see suite/index.ts), alongside
 * the fixed `runTest.ts` and `suite/index.ts` entries.
 *
 * Adding a new `*.photoshop.test.ts` file needs NO changes here or in
 * package.json — just add the file next to the others in `e2e/suite/`
 * (it's also auto-loaded at runtime by `suite/index.ts`).
 *
 * Invoked by `npm run build:e2e` / `npm run test:e2e`.
 */

import { build } from "esbuild";
import { readdirSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const suiteDir = path.join(e2eDir, "suite");
const repoRoot = path.resolve(e2eDir, "..");

const testEntries = readdirSync(suiteDir)
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => path.join(suiteDir, file));

const entryPoints = [
  path.join(e2eDir, "runTest.ts"),
  path.join(suiteDir, "index.ts"),
  // Window B's own `--extensionTestsPath` entry for takeover.photoshop.test.ts
  // (deliberately not named `*.test.ts` so it's never auto-discovered as a
  // mocha test file by suite/index.ts).
  path.join(suiteDir, "takeoverWindowB.ts"),
  ...testEntries,
];

await build({
  entryPoints,
  outbase: e2eDir,
  outdir: path.join(repoRoot, "out", "e2e"),
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode", "mocha", "@vscode/test-electron"],
  sourcemap: true,
}).catch((err) => {
  console.error("e2e build failed:", err);
  process.exitCode = 1;
});
