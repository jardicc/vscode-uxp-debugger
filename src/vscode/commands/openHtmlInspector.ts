/**
 * "UXP: Inspect Plugin UI (HTML/CSS)" — opens the HTML inspector webview
 * (embedded DevTools Elements/Styles frontend) for a live plugin session.
 * Works standalone or alongside an attached debugger; both share the same
 * `CdpProxyServer` via the `CdpProxyRegistry` (docs/UI-DEBUGGING.md).
 */

import * as vscode from "vscode";
import type { PluginSession } from "../../core/broker/SessionRegistry";
import type { UxpDebugSessionManager } from "../debug/UxpDebugSessionManager";
import { UxpInspectorPanel } from "../inspector/UxpInspectorPanel";
import type { CdpProxyRegistry } from "../proxy/CdpProxyRegistry";
import { pickSession } from "../ui/picks";
import type { UxpService } from "../UxpService";

/**
 * Parameterized entry point shared by the command and the control panel
 * (CONTROL-PANEL.md §6.2): open (or reveal) the inspector for one session.
 */
export async function openInspectorForSession(
    session: PluginSession,
    service: UxpService,
    proxyRegistry: CdpProxyRegistry,
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
): Promise<void> {
    output.appendLine(`[inspector] Opening HTML inspector for "${session.name}".`);
    await UxpInspectorPanel.createOrShow(
        context,
        session,
        proxyRegistry,
        service.cdtUrlFor(session),
        output,
    );
}

export async function openHtmlInspectorCommand(
    service: UxpService,
    debugManager: UxpDebugSessionManager,
    proxyRegistry: CdpProxyRegistry,
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
): Promise<void> {
    // Scripts have no DOM; sessions still paused waiting for their first
    // debugger attach have no execution context to inspect yet (and the
    // panel's target connect would resume them without the breakOnStart
    // instrumentation dance — attach the debugger first).
    const inspectable = service.sessions.filter(
        (s) => s.kind === "plugin" && !debugManager.isPendingBreakOnStart(s.clientSessionId),
    );

    if (inspectable.length === 0) {
        const pendingCount = service.sessions.filter(
            (s) => s.kind === "plugin",
        ).length;
        void vscode.window.showInformationMessage(
            pendingCount > 0
                ? "UXP: The loaded plugin is waiting for a debugger (break on start) — attach the debugger before opening the inspector."
                : "UXP: No live plugin session. Load a plugin first (UXP: Load Plugin).",
        );
        return;
    }

    const session = await pickSession(inspectable, "Inspect Plugin UI (HTML/CSS)");
    if (!session) {
        return;
    }

    await openInspectorForSession(session, service, proxyRegistry, context, output);
}
