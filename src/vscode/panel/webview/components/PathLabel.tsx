import type { ReactNode } from "react";

/** Folder path split into dimmed parent + bold last segment (wireframe style). */
export function PathLabel({
    fullPath,
    matchLength,
}: {
    fullPath: string;
    /**
     * Highlight this many leading characters (of the forward-slash-normalized
     * path) in the success color — e.g. the part matching an open workspace
     * folder, or `Infinity` to highlight the whole path (active script file).
     */
    matchLength?: number;
}): ReactNode {
    const normalized = fullPath.replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    const nameStart = idx >= 0 ? idx + 1 : 0;
    const matched = matchLength ? Math.min(Math.max(matchLength, 0), normalized.length) : 0;

    const segments: ReactNode[] = [];
    if (matched > 0) {
        segments.push(
            <span key="match" className="path-match">
                {normalized.slice(0, matched)}
            </span>,
        );
    }
    if (matched < nameStart) {
        segments.push(
            <span key="parent" className="path-parent">
                {normalized.slice(matched, nameStart)}
            </span>,
        );
    }
    const nameSliceStart = Math.max(matched, nameStart);
    if (nameSliceStart < normalized.length) {
        segments.push(
            <span key="name" className="path-name">
                {normalized.slice(nameSliceStart)}
            </span>,
        );
    }

    return (
        <span className="path-label" title={normalized}>
            {segments}
        </span>
    );
}
