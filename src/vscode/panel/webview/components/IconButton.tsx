import clsx from "clsx";
import type { MouseEvent, ReactNode } from "react";

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
