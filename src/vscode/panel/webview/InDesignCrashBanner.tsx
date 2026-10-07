/**
 * Warning about a known InDesign crash, shown only when InDesign is installed
 * and until the user closes it (dismissal lives in the extension host, so it
 * returns after a VS Code restart).
 */

import type { ReactNode } from "react";
import type { PanelState } from "../panelProtocol";
import { IconButton } from "./components";
import { dispatch } from "./vscodeApi";

const FORUM_THREAD_URL = "https://forums.creativeclouddeveloper.com/t/crash-indesign-crashes-in-very-basic-scenario/12264";

export function InDesignCrashBanner({
    installedApps,
    dismissed,
}: {
    installedApps: PanelState["installedApps"];
    dismissed: boolean;
}): ReactNode {
    if (dismissed || !installedApps?.includes("ID")) {
        return null;
    }
    return (
        <div className="banner" role="status">
            <span className="codicon codicon-warning" />
            <span>
                InDesign has a known bug that can crash it (and break debugging). See the
                {" "}
                <a href={FORUM_THREAD_URL}>Adobe forum thread</a>
                .
            </span>
            <IconButton
                icon="close"
                label="Dismiss"
                onClick={() => { dispatch({ kind: "dismissInDesignBanner" }); }}
            />
        </div>
    );
}
