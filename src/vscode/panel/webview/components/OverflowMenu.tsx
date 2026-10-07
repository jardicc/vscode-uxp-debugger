import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";

export interface MenuItem {
    icon?: string;
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
                            {item.icon && <span className={`codicon codicon-${item.icon}`} />}
                            <span>{item.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
