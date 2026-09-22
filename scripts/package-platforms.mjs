import { createVSIX } from "@vscode/vsce";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installersDir = path.join(repoRoot, "installers");
const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
// Build one VSIX per supported native runtime so each package contains only compatible binaries.
const targets = ["win32-x64", "darwin-x64", "darwin-arm64"];
const baseIgnore = await fs.readFile(path.join(repoRoot, ".vscodeignore"), "utf8");

// Remove stale packages first to keep installers/ representative of this build, including after version changes.
await fs.mkdir(installersDir, { recursive: true });
for (const entry of await fs.readdir(installersDir, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".vsix")) {
    await fs.rm(path.join(installersDir, entry.name), { force: true });
  }
}

// Created last so every failure path after this point is covered by the finally-cleanup.
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "uxp-vsix-"));
try {
  for (const target of targets) {
    // Keep only the elevation script that can run on the packaged target.
    const unusedScript = target.startsWith("win32-") ? "mac.sh" : "win32.bat";
    const nativePatterns = [
      ...targets.filter((candidate) => candidate !== target).map((candidate) => `native/${candidate}/**`),
      `native/devtools-scripts/${unusedScript}`,
    ].join("\n");
    const ignoreFile = path.join(tempDir, `${target}.vscodeignore`);
    // Replace the broad native-code inclusion rule with exclusions for every incompatible artifact.
    await fs.writeFile(ignoreFile, baseIgnore.replace("!native/**", nativePatterns));

    const fileName = `${manifest.name}-${manifest.version}-${target}.vsix`;
    await createVSIX({
      cwd: repoRoot,
      packagePath: path.join(installersDir, fileName),
      target,
      ignoreFile,
      ignoreOtherTargetFolders: true,
    });
  }
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}