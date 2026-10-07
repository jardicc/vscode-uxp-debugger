/** Windows and POSIX paths rendered the same way in the UI. */
export function toForwardSlashes(path: string): string {
    return path.replace(/\\/g, "/");
}

/** Everything before the last separator; the whole path when it has none. */
export function parentFolder(path: string): string {
    const normalized = toForwardSlashes(path);
    const idx = normalized.lastIndexOf("/");
    return idx >= 0 ? normalized.slice(0, idx) : normalized;
}
