// Windows (NTFS) and macOS (default APFS) resolve file paths
// case-insensitively, but the exact same file can reach us spelled two
// different ways: `${workspaceFolder}` substitution in a launch.json config
// preserves whatever case the folder was opened with, while
// `vscode.Uri.fsPath` tends to normalize drive letters to lowercase.
// Comparing paths verbatim can then make a freshly-loaded session invisible
// to an immediate "uxp" attach (F5) even though it is the same file on disk.
// Linux (ext4 etc.) is case-sensitive, so leave paths exact there.
const CASE_INSENSITIVE_PATHS
    = process.platform === "win32" || process.platform === "darwin";

export function foldPathCase(filePath: string): string {
    return CASE_INSENSITIVE_PATHS ? filePath.toLowerCase() : filePath;
}
