/**
 * Build-time native asset preparation (UXP-DEBUGGER-ARCHITECTURE.md §2.2).
 *
 * Populates `native/` with the Adobe Vulcan prebuilds and the developer-mode
 * elevation scripts, sourced from the reference repo copy in `uxp-cli-v1/`:
 *
 *   native/
 *     win32-x64/        node-napi.node + AID.dll + VulcanControl.dll + VulcanMessage5.dll
 *     darwin-x64/       node-napi.node + *.dylib          (from the darwin tarball)
 *     darwin-arm64/     node-napi.node + *.dylib          (from the darwin-arm64 tarball)
 *     devtools-scripts/ win32.bat + mac.sh
 *
 * Deliberately ships only `node-napi.node` (never `electron-napi.node`) and
 * loads it by absolute path at runtime — see the node-gyp-build pitfall in
 * UXP-DEBUGGER-ARCHITECTURE.md §2. Extraction uses the system `tar` (bundled with
 * Windows 10+ and macOS).
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helperRoot = path.join(repoRoot, "uxp-cli-v1", "packages", "uxp-devtools-helper");
const tarballDir = path.join(helperRoot, "scripts", "native-libs");
const scriptsSrcDir = path.join(helperRoot, "src", "devtools");
const nativeRoot = path.join(repoRoot, "native");
const DEVTOOLS_HELPER_VERSION = "1.1.0";

/** Files to keep per platform folder (everything else from the tarball is dropped). */
const KEEP = {
  win32: ["node-napi.node", "AID.dll", "VulcanControl.dll", "VulcanMessage5.dll"],
  darwin: ["node-napi.node", "AID.dylib", "VulcanControl.dylib", "VulcanMessage5.dylib"],
};

const TARGETS = [
  { dir: "win32-x64", tarball: `DevtoolsHelper-v${DEVTOOLS_HELPER_VERSION}-node-win32.tar.gz`, keep: KEEP.win32 },
  { dir: "darwin-x64", tarball: `DevtoolsHelper-v${DEVTOOLS_HELPER_VERSION}-node-darwin.tar.gz`, keep: KEEP.darwin },
  { dir: "darwin-arm64", tarball: `DevtoolsHelper-v${DEVTOOLS_HELPER_VERSION}-node-darwin-arm64.tar.gz`, keep: KEEP.darwin },
];

function findFile(root, name) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return undefined;
}

function prepareTarget({ dir, tarball, keep }) {
  const tarballPath = path.join(tarballDir, tarball);
  if (!fs.existsSync(tarballPath)) {
    throw new Error(`native tarball not found for ${dir}: ${tarballPath}`);
  }

  const targetDir = path.join(nativeRoot, dir);
  fs.mkdirSync(targetDir, { recursive: true });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "uxp-native-"));
  try {
    execFileSync("tar", ["-xzf", tarballPath, "-C", tempDir]);
    for (const name of keep) {
      const source = findFile(tempDir, name);
      if (!source) {
        throw new Error(`"${name}" not found inside ${tarball}`);
      }
      fs.copyFileSync(source, path.join(targetDir, name));
    }
    console.log(`OK   ${dir}: ${keep.join(", ")}`);
    return true;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function prepareScripts() {
  const targetDir = path.join(nativeRoot, "devtools-scripts");
  fs.mkdirSync(targetDir, { recursive: true });
  for (const name of ["win32.bat", "mac.sh"]) {
    const source = path.join(scriptsSrcDir, name);
    if (!fs.existsSync(source)) {
      throw new Error(`elevation script not found: ${source}`);
    }
    const target = path.join(targetDir, name);
    if (name === "mac.sh") {
      fs.writeFileSync(target, fs.readFileSync(source, "utf8").replace(/\r\n/g, "\n"));
    } else {
      fs.copyFileSync(source, target);
    }
  }
  console.log(`OK   devtools-scripts: win32.bat, mac.sh`);
}

for (const target of TARGETS) {
  prepareTarget(target);
}
prepareScripts();
