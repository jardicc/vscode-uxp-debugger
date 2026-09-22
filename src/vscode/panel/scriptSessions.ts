/**
 * Shared helper for matching a script file to its live broker session(s) —
 * used by both `PanelController.stopScript` and `PluginWatchManager`.
 */

import * as path from "path";
import type { PluginSession } from "../../core/broker/SessionRegistry";
import type { UxpService } from "../UxpService";
import { pathKey } from "./PluginRegistry";

/** Live broker sessions (usually 0 or 1) for a script file, matched by its source path. */
export function sessionsForScript(service: UxpService, scriptPath: string): PluginSession[] {
    const key = pathKey(path.normalize(scriptPath));
    return service.sessions.filter(
        (s) =>
            s.kind === "script"
            && pathKey(path.normalize(s.scriptSourcePath ?? path.join(s.pluginPath, s.name))) === key,
    );
}
