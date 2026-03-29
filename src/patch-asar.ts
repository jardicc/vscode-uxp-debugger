#!/usr/bin/env node
/*
 * Patch script for Adobe UXP Developer Tools — .asar archive edition
 * Makes loadPlugin always persist session to .uxprc AND return it at runtime.
 *
 * Usage:  node patch-asar.js [path-to-app.asar]
 * Default: C:\Program Files\Adobe\Adobe UXP Developer Tools\resources\app
 *
 * If the argument is a directory (not .asar), falls back to direct file patching.
 *
 * Memory-efficient: only the patched files are loaded into memory.
 * All other files are streamed directly from the old archive (64 KB buffer).
 *
 * Safe to run multiple times (idempotent). Creates .bak backup on first run.
 * Run as Administrator if patching under Program Files.
 */

import * as nodeFs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// In an Electron environment (VS Code extension host) the standard `fs` module
// has ASAR shims that treat any path ending in `.asar` as a virtual directory,
// which breaks raw binary reads of .asar files. `original-fs` is Electron's
// unpatched fs — use it when available, fall back to plain `fs` otherwise
// (e.g. when the script is run directly from the CLI via Node).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs: typeof nodeFs = (() => {
    try { return require("original-fs") as typeof nodeFs; } catch { return nodeFs; }
})();

const PATCH_MARKER = "/* __UXPRC_PERSIST__ */";
const DEFAULT_APP =
    String.raw`C:\Program Files\Adobe\Adobe UXP Developer Tools\resources\app`;

// ==================== Public API types ====================

export type BundlePatchStatus = "patched" | "already" | "failed" | "notfound";
export type SourcePatchStatus = "patched" | "already" | "skipped" | "failed";

export interface PatchAsarResult {
    /** Whether the webpack bundle (dist/main.*.js) was patched */
    bundleStatus: BundlePatchStatus;
    /** Whether PluginLoadCommand.js was patched */
    sourceStatus: SourcePatchStatus;
    /** Human-readable summary */
    summary: string;
}

// ==================== Pickle helpers (Chromium format) ====================

function align4(n: number): number {
    return (n + 3) & ~3;
}

function readPickleUint32(buf: Buffer): number {
    // Pickle: [4 LE payload_size][payload…]
    // For a single uint32, payload is 4 bytes starting at offset 4.
    return buf.readUInt32LE(4);
}

function readPickleString(buf: Buffer): string {
    // [4 LE payload_size][4 LE string_length][string_bytes…][padding]
    const len = buf.readUInt32LE(4);
    return buf.toString("utf8", 8, 8 + len);
}

function writePickleUint32(value: number): Buffer {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE(4, 0);       // payload_size = 4
    buf.writeUInt32LE(value, 4);
    return buf;
}

function writePickleString(str: string): Buffer {
    const strBuf = Buffer.from(str, "utf8");
    const payloadSize = 4 + align4(strBuf.length); // int + aligned string data
    const buf = Buffer.alloc(4 + payloadSize);      // header + payload
    buf.writeUInt32LE(payloadSize, 0);
    buf.writeUInt32LE(strBuf.length, 4);
    strBuf.copy(buf, 8);
    return buf;
}

// ==================== ASAR types ====================

interface AsarIntegrity {
    algorithm: "SHA256";
    hash: string;
    blockSize: number;
    blocks: string[];
}

interface AsarFileEntry {
    offset: string;
    size: number;
    executable?: boolean;
    unpacked?: boolean;
    integrity?: AsarIntegrity;
}

interface AsarLinkEntry {
    link: string;
}

interface AsarDirectoryEntry {
    files: Record<string, AsarEntry>;
}

type AsarEntry = AsarFileEntry | AsarDirectoryEntry | AsarLinkEntry;

function isFileEntry(e: AsarEntry): e is AsarFileEntry {
    return "size" in e && !("link" in e) && !("files" in e);
}

function isDirectoryEntry(e: AsarEntry): e is AsarDirectoryEntry {
    return "files" in e;
}

// ==================== ASAR header I/O ====================

interface ParsedAsar {
    header: AsarDirectoryEntry;
    headerPickleSize: number;   // bytes of the header pickle buffer
    dataOffset: number;         // absolute byte offset where data section starts
}

function parseAsarHeader(asarPath: string): ParsedAsar {
    const fd = fs.openSync(asarPath, "r");
    try {
        const sizeBuf = Buffer.alloc(8);
        fs.readSync(fd, sizeBuf, 0, 8, 0);
        const headerPickleSize = readPickleUint32(sizeBuf);

        const headerBuf = Buffer.alloc(headerPickleSize);
        fs.readSync(fd, headerBuf, 0, headerPickleSize, 8);
        const headerJson = readPickleString(headerBuf);

        return {
            header: JSON.parse(headerJson) as AsarDirectoryEntry,
            headerPickleSize,
            dataOffset: 8 + headerPickleSize,
        };
    } finally {
        fs.closeSync(fd);
    }
}

// ==================== File collection ====================

interface CollectedFile {
    /** Path inside the archive, e.g. "dist/main.abc.js" */
    entryPath: string;
    /** Direct reference to the header entry (mutated when recomputing offsets) */
    entry: AsarFileEntry;
    /** Original byte offset inside the OLD data section */
    oldOffset: number;
    /** Original file size */
    oldSize: number;
}

/**
 * Depth-first walk of the header tree.
 * Collects packed file entries in insertion order (= data-section order).
 */
function collectFiles(
    dir: AsarDirectoryEntry,
    prefix: string,
    out: CollectedFile[],
): void {
    for (const [name, entry] of Object.entries(dir.files)) {
        const entryPath = prefix ? `${prefix}/${name}` : name;
        if (isFileEntry(entry) && !entry.unpacked) {
            out.push({
                entryPath,
                entry,
                oldOffset: parseInt(entry.offset, 10),
                oldSize: entry.size,
            });
        } else if (isDirectoryEntry(entry)) {
            collectFiles(entry, entryPath, out);
        }
        // Links and unpacked files have no data-section bytes — skip.
    }
}

// ==================== Read a single file from the archive ====================

function readFileFromAsar(
    asarPath: string,
    dataOffset: number,
    file: CollectedFile,
): Buffer {
    if (file.oldSize === 0) return Buffer.alloc(0);
    const buf = Buffer.alloc(file.oldSize);
    const fd = fs.openSync(asarPath, "r");
    try {
        fs.readSync(fd, buf, 0, file.oldSize, dataOffset + file.oldOffset);
    } finally {
        fs.closeSync(fd);
    }
    return buf;
}

// ==================== Integrity ====================

function computeIntegrity(
    content: Buffer,
    blockSize: number,
): AsarIntegrity {
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    const blocks: string[] = [];
    for (let i = 0; i < content.length; i += blockSize) {
        const end = Math.min(i + blockSize, content.length);
        blocks.push(
            crypto.createHash("sha256").update(content.subarray(i, end)).digest("hex"),
        );
    }
    return { algorithm: "SHA256", hash, blockSize, blocks };
}

// ==================== Stream helpers ====================

function writeBuffer(out: nodeFs.WriteStream, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
        const ok = out.write(data, (err) => {
            if (err) reject(err);
        });
        if (ok) {
            resolve();
        } else {
            out.once("drain", resolve);
        }
    });
}

/**
 * Stream `size` bytes from `srcPath` starting at `start` into `out`.
 * Uses Node's createReadStream — only ~64 KB in memory at a time.
 */
function pipeChunk(
    srcPath: string,
    start: number,
    size: number,
    out: nodeFs.WriteStream,
): Promise<void> {
    if (size === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const src = fs.createReadStream(srcPath, {
            start,
            end: start + size - 1,
        });
        src.pipe(out, { end: false });
        src.on("error", reject);
        src.on("end", resolve);
    });
}

// ==================== Patch content functions ====================

type ContentStatus = "patched" | "already" | "failed";

function patchBundleContent(content: string): { patched: string; status: ContentStatus } {
    if (content.includes(PATCH_MARKER)) {
        return { patched: content, status: "already" };
    }

    const ctxRe =
        /(\w+)\.dirname\(e\.params\.manifest\),e\.params\.breakOnStart[\s\S]{0,600}?_handleLoadCommandResult/;
    const ctxMatch = content.match(ctxRe);
    if (!ctxMatch) {
        console.error(
            "[bundle] Could not locate path-module variable near _handleLoadCommandResult.",
        );
        return { patched: content, status: "failed" };
    }
    const pathVar = ctxMatch[1];

    const re = new RegExp(
        '_handleLoadCommandResult",value:function\\((\\w+)\\)\\{' +
            "var (\\w+)=\\{id:this\\.manifest\\.id,name:this\\.manifest\\.name\\};" +
            "return (\\w+)\\.createFromLoadResults\\(\\1,\\2\\)" +
            "\\}",
    );
    const m = content.match(re);
    if (!m) {
        console.error(
            "[bundle] Could not match _handleLoadCommandResult pattern.",
        );
        return { patched: content, status: "failed" };
    }

    const [fullMatch, argVar, infoVar, sessionMod] = m;
    const replacement =
        `_handleLoadCommandResult",value:function(${argVar}){` +
        `var ${infoVar}={id:this.manifest.id,name:this.manifest.name};` +
        `var _s=${sessionMod}.createFromLoadResults(${argVar},${infoVar});` +
        `try{_s.commitToRc(${pathVar}.dirname(this.params.manifest))}catch(_e){}` +
        `${PATCH_MARKER}return _s}`;

    return { patched: content.replace(fullMatch, replacement), status: "patched" };
}

function patchSourceContent(content: string): { patched: string; status: ContentStatus } {
    if (
        content.includes(PATCH_MARKER) ||
        content.includes("session.commitToRc(pluginFolder)")
    ) {
        return { patched: content, status: "already" };
    }

    const target =
        "return PluginSession.createFromLoadResults(loadResults, pluginInfo);";
    if (!content.includes(target)) {
        console.error(
            "[source] Could not find target line in PluginLoadCommand.js",
        );
        return { patched: content, status: "failed" };
    }

    const replacement =
        `const session = PluginSession.createFromLoadResults(loadResults, pluginInfo);\n` +
        `        const pluginFolder = path.dirname(this.params.manifest);\n` +
        `        session.commitToRc(pluginFolder); ${PATCH_MARKER}\n` +
        `        return session;`;

    return { patched: content.replace(target, replacement), status: "patched" };
}

// ==================== ASAR patch mode ====================

export async function patchAsarFile(asarPath: string): Promise<PatchAsarResult> {
    console.log("Mode: .asar archive (streaming)");
    console.log("ASAR:", asarPath);
    console.log("");

    // 1. Parse header
    const { header, dataOffset } = parseAsarHeader(asarPath);

    // 2. Collect all packed files in data-section order
    const files: CollectedFile[] = [];
    collectFiles(header, "", files);
    files.sort((a, b) => a.oldOffset - b.oldOffset);
    console.log(`Archive contains ${files.length} packed files.`);

    // 3. Find target files, extract & patch just those
    const bundleFile = files.find(
        (f) =>
            f.entryPath.startsWith("dist/main.") &&
            f.entryPath.endsWith(".js"),
    );
    const sourceFile = files.find((f) =>
        f.entryPath.endsWith(
            "node_modules/@adobe/uxp-devtools-core/src/core/client/plugin/actions/PluginLoadCommand.js",
        ),
    );

    const patches = new Map<string, Buffer>();
    let bundleStatus: BundlePatchStatus = "notfound";
    let sourceStatus: SourcePatchStatus = "skipped";

    if (bundleFile) {
        console.log(
            `[bundle] Found: ${bundleFile.entryPath} (${bundleFile.oldSize} bytes)`,
        );
        const raw = readFileFromAsar(asarPath, dataOffset, bundleFile);
        const content = raw.toString("utf8");
        const { patched, status } = patchBundleContent(content);
        bundleStatus = status;
        if (status === "failed") {
            return { bundleStatus: "failed", sourceStatus: "skipped", summary: "Bundle patch failed — pattern not found." };
        }
        if (status === "patched") {
            const buf = Buffer.from(patched, "utf8");
            patches.set(bundleFile.entryPath, buf);
            console.log(
                `[bundle] Patched: ${bundleFile.oldSize} -> ${buf.length} bytes`,
            );
        } else {
            console.log("[bundle] Already patched.");
        }
    } else {
        console.error("[bundle] No dist/main.*.js found in archive.");
        return { bundleStatus: "notfound", sourceStatus: "skipped", summary: "Bundle not found (dist/main.*.js missing from archive)." };
    }

    if (sourceFile) {
        console.log(
            `[source] Found: ${sourceFile.entryPath} (${sourceFile.oldSize} bytes)`,
        );
        const raw = readFileFromAsar(asarPath, dataOffset, sourceFile);
        const content = raw.toString("utf8");
        const { patched, status } = patchSourceContent(content);
        sourceStatus = status;
        if (status === "patched") {
            const buf = Buffer.from(patched, "utf8");
            patches.set(sourceFile.entryPath, buf);
            console.log(
                `[source] Patched: ${sourceFile.oldSize} -> ${buf.length} bytes`,
            );
        } else if (status === "already") {
            console.log("[source] Already patched.");
        }
    } else {
        console.log("[source] PluginLoadCommand.js not found (skipping).");
    }

    if (patches.size === 0) {
        console.log("\nNo changes needed (already patched).");
        return { bundleStatus, sourceStatus, summary: "Already patched — no changes made." };
    }

    // 4. Update header entries — sizes and integrity hashes
    for (const file of files) {
        const patchedBuf = patches.get(file.entryPath);
        if (patchedBuf) {
            file.entry.size = patchedBuf.length;
            if (file.entry.integrity) {
                file.entry.integrity = computeIntegrity(
                    patchedBuf,
                    file.entry.integrity.blockSize,
                );
            }
        }
    }

    // 5. Recompute sequential offsets for new archive
    let newOffset = 0;
    for (const file of files) {
        file.entry.offset = String(newOffset);
        newOffset += file.entry.size;
    }

    // 6. Serialize new header
    const headerPickle = writePickleString(JSON.stringify(header));
    const sizePickle = writePickleUint32(headerPickle.length);

    // 7. Write new .asar (streaming)
    const tmpPath = asarPath + ".tmp";
    const bakPath = asarPath + ".bak";

    const out = fs.createWriteStream(tmpPath);
    try {
        await writeBuffer(out, sizePickle);
        await writeBuffer(out, headerPickle);

        for (const file of files) {
            const patchedBuf = patches.get(file.entryPath);
            if (patchedBuf) {
                await writeBuffer(out, patchedBuf);
            } else {
                // Stream from original archive — only ~64 KB in memory
                const start = dataOffset + file.oldOffset;
                await pipeChunk(asarPath, start, file.oldSize, out);
            }
        }

        await new Promise<void>((resolve, reject) => {
            out.end(() => resolve());
            out.on("error", reject);
        });
    } catch (err) {
        out.destroy();
        // Clean up partial temp file
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        throw err;
    }

    // 8. Swap files: original → .bak, .tmp → original
    if (!fs.existsSync(bakPath)) {
        fs.renameSync(asarPath, bakPath);
        console.log("Backup:", path.basename(bakPath));
    } else {
        fs.unlinkSync(asarPath);
    }
    fs.renameSync(tmpPath, asarPath);

    const parts: string[] = [];
    if (bundleStatus === "patched") { parts.push("bundle patched"); }
    if (sourceStatus === "patched") { parts.push("source patched"); }
    return {
        bundleStatus,
        sourceStatus,
        summary: `Patched successfully (${parts.join(", ")}).`,
    };
}

// ==================== Direct file mode (fallback) ====================

function findBundle(distDir: string): string | null {
    if (!fs.existsSync(distDir)) return null;
    const found = fs.readdirSync(distDir);
    return found.find((f) => f.startsWith("main.") && f.endsWith(".js")) ?? null;
}

function patchDirectBundle(appDir: string): boolean {
    const distDir = path.join(appDir, "dist");
    const bundleName = findBundle(distDir);
    if (!bundleName) {
        console.error("[bundle] No main.*.js found in", distDir);
        return false;
    }

    const bundlePath = path.join(distDir, bundleName);
    const content = fs.readFileSync(bundlePath, "utf8");
    const { patched, status } = patchBundleContent(content);
    if (status === "failed") { return false; }
    if (status === "already") { return true; }

    const bakPath = bundlePath + ".bak";
    if (!fs.existsSync(bakPath)) {
        fs.copyFileSync(bundlePath, bakPath);
        console.log("[bundle] Backup created:", path.basename(bakPath));
    }
    fs.writeFileSync(bundlePath, patched, "utf8");
    console.log("[bundle] Patched:", bundleName);
    return true;
}

function patchDirectSource(appDir: string): boolean {
    const srcPath = path.join(
        appDir, "node_modules", "@adobe", "uxp-devtools-core",
        "src", "core", "client", "plugin", "actions", "PluginLoadCommand.js",
    );
    if (!fs.existsSync(srcPath)) {
        console.log("[source] PluginLoadCommand.js not found (skipping).");
        return true;
    }

    const content = fs.readFileSync(srcPath, "utf8");
    const { patched, status } = patchSourceContent(content);
    if (status === "failed") { return false; }
    if (status === "already") { return true; }

    const bakPath = srcPath + ".bak";
    if (!fs.existsSync(bakPath)) {
        fs.copyFileSync(srcPath, bakPath);
        console.log("[source] Backup created:", path.basename(bakPath));
    }
    fs.writeFileSync(srcPath, patched, "utf8");
    console.log("[source] Patched:", srcPath);
    return true;
}

function patchDirect(appDir: string): boolean {
    console.log("Mode: direct files");
    console.log("App dir:", appDir);
    console.log("");
    const bundleOk = patchDirectBundle(appDir);
    patchDirectSource(appDir);
    return bundleOk;
}

// ==================== Main ====================

async function main(): Promise<void> {
    console.log("UXP DevTools patch — persist .uxprc on loadPlugin");
    console.log("");

    const arg = process.argv[2] ?? DEFAULT_APP;
    let success = false;

    // Auto-detect .asar vs directory
    if (arg.endsWith(".asar")) {
        // Explicit .asar path
        if (!fs.existsSync(arg)) {
            console.error("File not found:", arg);
            process.exit(1);
        }
        const r = await patchAsarFile(arg);
        console.log(r.summary);
        success = r.bundleStatus !== "failed" && r.bundleStatus !== "notfound";
    } else if (fs.existsSync(arg + ".asar")) {
        // Directory path given, but .asar exists alongside it
        const r = await patchAsarFile(arg + ".asar");
        console.log(r.summary);
        success = r.bundleStatus !== "failed" && r.bundleStatus !== "notfound";
    } else if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
        // Unpacked app directory
        success = patchDirect(arg);
    } else {
        console.error("Not found:", arg);
        console.error("Expected an .asar file or an unpacked app directory.");
        process.exit(1);
    }

    console.log("");
    if (success) {
        console.log(
            "Done. loadPlugin will now write sessions to .uxprc automatically.",
        );
    } else {
        console.error("Patch FAILED.");
        process.exit(1);
    }
}

/* Run as CLI script when invoked directly (node dist/patch-asar.js ...) */
if (require.main === module) {
    main().catch((err) => {
        console.error("Fatal:", err);
        process.exit(1);
    });
}
