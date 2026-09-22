import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(repoRoot, "devtools-frontend-dist");
const outputDir = path.join(repoRoot, "dist", "devtools");

const omittedExtensions = new Set([".d", ".js", ".map", ".md", ".mts"]);

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });
await fs.cp(sourceDir, outputDir, {
  recursive: true,
  filter(source) {
    return !omittedExtensions.has(path.extname(source).toLowerCase());
  },
});

await build({
  absWorkingDir: repoRoot,
  entryPoints: {
    "entrypoints/devtools_app/devtools_app": path.join(
      sourceDir,
      "entrypoints",
      "devtools_app",
      "devtools_app.js",
    ),
  },
  outdir: outputDir,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  treeShaking: true,
  chunkNames: "chunks/[name]-[hash]",
  assetNames: "assets/[name]-[hash]",
  loader: {
    ".png": "file",
    ".svg": "file",
    ".ttf": "file",
    ".wasm": "file",
    ".woff": "file",
    ".woff2": "file",
  },
  plugins: [
    {
      name: "preserve-runtime-asset-paths",
      setup(buildApi) {
        buildApi.onLoad({ filter: /\.js$/ }, async (args) => {
          if (!args.path.startsWith(sourceDir + path.sep)) {
            return undefined;
          }
          const relativePath = path.relative(sourceDir, args.path).replaceAll(path.sep, "/");
          const originalModuleUrl = `new URL(${JSON.stringify(`./${relativePath}`)}, globalThis.location.href).toString()`;
          const contents = (await fs.readFile(args.path, "utf8")).replaceAll("import.meta.url", originalModuleUrl);
          return { contents, loader: "js" };
        });
      },
    },
    {
      name: "browser-worker-threads",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^node:worker_threads$/ }, () => ({
          path: "node:worker_threads",
          namespace: "browser-worker-threads",
        }));
        buildApi.onLoad({ filter: /.*/, namespace: "browser-worker-threads" }, () => ({
          contents: [
            "export const parentPort = undefined;",
            "export class Worker {",
            "  constructor() { throw new Error('Node workers are unavailable in the browser'); }",
            "}",
          ].join("\n"),
          loader: "js",
        }));
      },
    },
  ],
});