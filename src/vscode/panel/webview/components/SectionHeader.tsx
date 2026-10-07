import clsx from "clsx";
import type { ReactNode } from "react";

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
