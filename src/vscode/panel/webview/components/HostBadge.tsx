import clsx from "clsx";
import type { ReactNode } from "react";

/** Static, non-interactive host-app label. */
export function HostBadge({
    uiCode,
    connected,
}: {
    uiCode: string;
    connected: boolean;
}): ReactNode {
    return (
        <span
            className={clsx("host-badge", { connected })}
            title={connected ? `${uiCode} is connected` : uiCode}
        >
            {uiCode}
        </span>
    );
}
