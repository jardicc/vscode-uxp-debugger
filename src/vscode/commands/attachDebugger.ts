/**
 * `uxp.attachDebugger` — attach the VS Code JS debugger to a live plugin
 * session via the broker's CDT endpoint (UXP-DEBUGGER-ARCHITECTURE.md §5.1).
 *
 * Entry points: the `"uxp"` launch.json type and the panel's Attach action —
 * both always pass an explicit manifest path (not exposed in the Command
 * Palette).
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { UxpService } from "../UxpService";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import { pickSession } from "../ui/picks";
import { loadWithDialogs, reportLoadResult } from "./loadPlugin";

export async function attachDebuggerCommand(
    service: UxpService,
    debugManager: UxpDebugSessionManager,
    output: vscode.OutputChannel,
    manifestPathArg: string,
): Promise<void> {
    // 1. Resolve the manifest.
    const manifestPath = path.normalize(manifestPathArg);
    if (!fs.existsSync(manifestPath)) {
        void vscode.window.showErrorMessage(
            `UXP: manifest.json not found at: ${manifestPath}`,
        );
        return;
    }

    // 2. Broker + live sessions.
    await service.ensureStarted();
    let sessions = service.sessionsForManifest(manifestPath);

    if (sessions.length === 0) {
    // No confirmation dialog — loadWithDialogs' own retry loop already
    // requires explicit user interaction (Retry / launch-app dialogs) to
    // continue, so this can't turn into an unattended infinite loop.
        output.appendLine(`[attach] no live session for "${manifestPath}" — loading it automatically`);
        const result = await loadWithDialogs(service, manifestPath, output);
        if (!result) {
            return;
        }
        reportLoadResult(result, output);
        sessions = result.sessions;

        // Defensive: loadWithDialogs reported success but this manifest still
        // has no session for us — surface it instead of silently retrying.
        if (sessions.length === 0) {
            void vscode.window.showErrorMessage(
                "UXP: The plugin was loaded but no matching session was found afterwards.",
            );
            return;
        }
    }

    // 3. Pick the session and attach.
    const session = await pickSession(sessions, "Attach UXP Debugger");
    if (!session) {
        return;
    }
    await debugManager.attach(session, path.dirname(manifestPath));
}
