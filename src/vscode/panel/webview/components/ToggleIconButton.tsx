import type { ReactNode } from "react";
import { IconButton, type IconButtonProps } from "./IconButton";

/** Renders one of two buttons depending on `active` — e.g. Load/Unload, Debug/Stop. */
export function ToggleIconButton({
    active,
    whenActive,
    whenInactive,
}: {
    active: boolean;
    whenActive: IconButtonProps;
    whenInactive: IconButtonProps;
}): ReactNode {
    return <IconButton {...(active ? whenActive : whenInactive)} />;
}
