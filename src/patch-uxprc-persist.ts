#!/usr/bin/env node
/*
 * Patch script for Adobe UXP Developer Tools
 * Makes loadPlugin always persist session to .uxprc AND return it at runtime.
 *
 * Usage:  node patch-uxprc-persist.js [path-to-app-dir]
 * Default: C:\Program Files\Adobe\Adobe UXP Developer Tools\resources\app
 *
 * What it does:
 *   1. Patches the webpack bundle (dist/main.*.js) - affects the GUI
 *   2. Patches the source PluginLoadCommand.js - affects any direct require() / CLI
 *
 * Safe to run multiple times (idempotent). Creates .bak backups before first patch.
 * Run as Administrator if patching under Program Files.
 */

import * as fs from "fs";
import * as path from "path";

const PATCH_MARKER = "/* __UXPRC_PERSIST__ */";
const DEFAULT_APP_DIR = String.raw`C:\Program Files\Adobe\Adobe UXP Developer Tools\resources\app`;

// --- Bundle patch ---

function findBundle(distDir: string): string | null {
    if (!fs.existsSync(distDir)) return null;
    const files = fs.readdirSync(distDir);
    return files.find(f => f.startsWith("main.") && f.endsWith(".js")) ?? null;
}

function patchBundle(appDir: string): boolean {
    const distDir = path.join(appDir, "dist");
    const bundleName = findBundle(distDir);
    if (!bundleName) {
        console.error("[bundle] No main.*.js found in", distDir);
        return false;
    }

    const bundlePath = path.join(distDir, bundleName);
    let content = fs.readFileSync(bundlePath, "utf8");

    if (content.includes(PATCH_MARKER)) {
        console.log("[bundle] Already patched:", bundleName);
        return true;
    }

    // Capture the path-module variable from the surrounding executeCommand.
    const ctxRe = /(\w+)\.dirname\(e\.params\.manifest\),e\.params\.breakOnStart[\s\S]{0,600}?_handleLoadCommandResult/;
    const ctxMatch = content.match(ctxRe);
    if (!ctxMatch) {
        console.error("[bundle] Could not locate path-module variable near _handleLoadCommandResult.");
        return false;
    }
    const pathVar = ctxMatch[1];

    // Match _handleLoadCommandResult method body.
    const re = new RegExp(
        '_handleLoadCommandResult",value:function\\((\\w+)\\)\\{' +
        "var (\\w+)=\\{id:this\\.manifest\\.id,name:this\\.manifest\\.name\\};" +
        "return (\\w+)\\.createFromLoadResults\\(\\1,\\2\\)" +
        "\\}"
    );

    const m = content.match(re);
    if (!m) {
        console.error("[bundle] Could not match _handleLoadCommandResult pattern.");
        return false;
    }

    const [fullMatch, argVar, infoVar, sessionMod] = m;

    const replacement =
        `_handleLoadCommandResult",value:function(${argVar}){` +
        `var ${infoVar}={id:this.manifest.id,name:this.manifest.name};` +
        `var _s=${sessionMod}.createFromLoadResults(${argVar},${infoVar});` +
        `try{_s.commitToRc(${pathVar}.dirname(this.params.manifest))}catch(_e){}` +
        `${PATCH_MARKER}return _s}`;

    content = content.replace(fullMatch, replacement);

    // Backup (only first time)
    const bakPath = bundlePath + ".bak";
    if (!fs.existsSync(bakPath)) {
        fs.copyFileSync(bundlePath, bakPath);
        console.log("[bundle] Backup created:", path.basename(bakPath));
    }

    fs.writeFileSync(bundlePath, content, "utf8");
    console.log("[bundle] Patched:", bundleName);
    return true;
}

// --- Source patch ---

function patchSource(appDir: string): boolean {
    const srcPath = path.join(
        appDir, "node_modules", "@adobe", "uxp-devtools-core",
        "src", "core", "client", "plugin", "actions", "PluginLoadCommand.js"
    );

    if (!fs.existsSync(srcPath)) {
        console.log("[source] PluginLoadCommand.js not found (skipping).");
        return true;
    }

    let content = fs.readFileSync(srcPath, "utf8");

    if (content.includes(PATCH_MARKER) || content.includes("session.commitToRc(pluginFolder)")) {
        console.log("[source] Already patched.");
        return true;
    }

    const target = "return PluginSession.createFromLoadResults(loadResults, pluginInfo);";
    if (!content.includes(target)) {
        console.error("[source] Could not find target line in PluginLoadCommand.js");
        return false;
    }

    const replacement =
        `const session = PluginSession.createFromLoadResults(loadResults, pluginInfo);\n` +
        `        const pluginFolder = path.dirname(this.params.manifest);\n` +
        `        session.commitToRc(pluginFolder); ${PATCH_MARKER}\n` +
        `        return session;`;

    content = content.replace(target, replacement);

    const bakPath = srcPath + ".bak";
    if (!fs.existsSync(bakPath)) {
        fs.copyFileSync(srcPath, bakPath);
        console.log("[source] Backup created:", path.basename(bakPath));
    }

    fs.writeFileSync(srcPath, content, "utf8");
    console.log("[source] Patched:", srcPath);
    return true;
}

// --- Main ---

const appDir: string = process.argv[2] ?? DEFAULT_APP_DIR;
console.log("UXP DevTools patch - persist .uxprc on loadPlugin");
console.log("App dir:", appDir);
console.log("");

const bundleOk = patchBundle(appDir);
const sourceOk = patchSource(appDir);

console.log("");
if (bundleOk) {
    console.log("Done. loadPlugin will now write sessions to .uxprc automatically.");
} else {
    console.error("Bundle patch FAILED - the GUI will NOT persist sessions.");
    process.exit(1);
}
