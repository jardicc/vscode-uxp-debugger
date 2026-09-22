/**
 * Shared presentational building blocks: icon buttons, overflow menu,
 * host-app badges, section headers. Pure rendering — every mutation goes
 * through `dispatch()` in the parent components.
 */

import clsx from "clsx";
import {
    type KeyboardEvent,
    type MouseEvent,
    type ReactNode,
    useEffect,
    useRef,
    useState,
} from "react";

// ---------------------------------------------------------------------------
// IconButton
// ---------------------------------------------------------------------------

export interface IconButtonProps {
    icon: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    disabledReason?: string;
    /** Visually emphasized (e.g. "attach debugger" while paused). */
    emphasized?: boolean;
}

export function IconButton(props: IconButtonProps): ReactNode {
    const title = props.disabled && props.disabledReason ? props.disabledReason : props.label;
    return (
        <button
            className={clsx("icon-button", { emphasized: props.emphasized })}
            title={title}
            aria-label={props.label}
            disabled={props.disabled}
            onClick={(e: MouseEvent) => {
                e.stopPropagation();
                props.onClick();
            }}
        >
            <span className={`codicon codicon-${props.icon}`} />
        </button>
    );
}

// ---------------------------------------------------------------------------
// OverflowMenu
// ---------------------------------------------------------------------------

export interface MenuItem {
    icon: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
}

export function OverflowMenu({
    items,
    disabled,
    disabledReason,
    icon = "ellipsis",
    label = "More actions",
}: {
    items: MenuItem[];
    disabled?: boolean;
    disabledReason?: string;
    icon?: string;
    label?: string;
}): ReactNode {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onDocClick = (event: Event) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onDocClick);
        return () => {
            document.removeEventListener("mousedown", onDocClick);
        };
    }, [open]);

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
            setOpen(false);
        }
    };

    return (
        <div className="overflow-menu" ref={rootRef} onKeyDown={onKeyDown}>
            <button
                className="icon-button"
                title={disabled && disabledReason ? disabledReason : label}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
                disabled={disabled}
                onClick={(e: MouseEvent) => {
                    e.stopPropagation();
                    setOpen(!open);
                }}
            >
                <span className={`codicon codicon-${icon}`} />
            </button>
            {open && (
                <div className="menu-popup" role="menu">
                    {items.map((item) => (
                        <button
                            key={item.label}
                            className="menu-item"
                            role="menuitem"
                            disabled={item.disabled}
                            onClick={(e: MouseEvent) => {
                                e.stopPropagation();
                                setOpen(false);
                                item.onClick();
                            }}
                        >
                            <span className={`codicon codicon-${item.icon}`} />
                            <span>{item.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// SplitButton — icon button with a default action plus a caret that opens a
// dropdown with alternate actions (e.g. the "+" add-project control).
// ---------------------------------------------------------------------------

export function SplitButton({
    icon,
    label,
    onClick,
    items,
    disabled,
    disabledReason,
}: {
    icon: string;
    label: string;
    onClick: () => void;
    items: MenuItem[];
    disabled?: boolean;
    disabledReason?: string;
}): ReactNode {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onDocClick = (event: Event) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onDocClick);
        return () => {
            document.removeEventListener("mousedown", onDocClick);
        };
    }, [open]);

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
            setOpen(false);
        }
    };

    return (
        <div className="split-button" ref={rootRef} onKeyDown={onKeyDown}>
            <button
                className="icon-button"
                title={disabled && disabledReason ? disabledReason : label}
                aria-label={label}
                disabled={disabled}
                onClick={(e: MouseEvent) => {
                    e.stopPropagation();
                    onClick();
                }}
            >
                <span className={`codicon codicon-${icon}`} />
            </button>
            <button
                className="icon-button split-button-caret"
                title={disabled && disabledReason ? disabledReason : "More options..."}
                aria-label="More options"
                aria-haspopup="menu"
                aria-expanded={open}
                disabled={disabled}
                onClick={(e: MouseEvent) => {
                    e.stopPropagation();
                    setOpen(!open);
                }}
            >
                <span className="codicon codicon-chevron-down" />
            </button>
            {open && (
                <div className="menu-popup split-button-popup" role="menu">
                    {items.map((item) => (
                        <button
                            key={item.label}
                            className="menu-item"
                            role="menuitem"
                            disabled={item.disabled}
                            onClick={(e: MouseEvent) => {
                                e.stopPropagation();
                                setOpen(false);
                                item.onClick();
                            }}
                        >
                            <span className={`codicon codicon-${item.icon}`} />
                            <span>{item.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// HostBadge — click launches the host app (CONTROL-PANEL.md §2.3 #5)
// ---------------------------------------------------------------------------

export function HostBadge({
    appId,
    connected,
    onLaunch,
}: {
    appId: string;
    connected: boolean;
    onLaunch: (appId: string) => void;
}): ReactNode {
    return (
        <button
            className={clsx("host-badge", { connected })}
            title={
                connected
                    ? `${appId} is connected — click to launch another version`
                    : `${appId} — click to launch`
            }
            onClick={(e: MouseEvent) => {
                e.stopPropagation();
                onLaunch(appId);
            }}
        >
            {appId}
        </button>
    );
}

// ---------------------------------------------------------------------------
// SectionHeader
// ---------------------------------------------------------------------------

export function SectionHeader({
    title,
    collapsed,
    onToggle,
    children,
}: {
    title: string;
    collapsed: boolean;
    onToggle: () => void;
    children?: ReactNode;
}): ReactNode {
    return (
        <div className="section-header">
            <button
                className="section-toggle"
                aria-expanded={!collapsed}
                onClick={onToggle}
                title={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            >
                <span
                    className={clsx("codicon", collapsed ? "codicon-chevron-right" : "codicon-chevron-down")}
                />
                <span className="section-title">{title}</span>
            </button>
            {!collapsed && <div className="section-controls">{children}</div>}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Small bits
// ---------------------------------------------------------------------------

export function Spinner(): ReactNode {
    return <span className="codicon codicon-loading codicon-modifier-spin status-icon" />;
}

export function LinkButton({
    label,
    onClick,
    disabled,
    title,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    title?: string;
}): ReactNode {
    return (
        <button className="link-button" onClick={onClick} disabled={disabled} title={title ?? label}>
            {label}
        </button>
    );
}

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
