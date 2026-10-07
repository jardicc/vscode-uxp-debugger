import type { ReactNode } from "react";

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
