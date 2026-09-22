/**
 * Owns the lifecycle of every active UXP debug attachment: for each
 * attached session, the CDP proxy in front of our broker's CDT endpoint
 * plus the delegated `pwa-node` session. Multiple different sessions
 * (plugins/scripts) can be attached concurrently in the same VS Code
 * window — each gets its own `CdpProxyServer` instance and its own
 * `pwa-node` debug session, keyed by `clientSessionId`.
 *
 * Both teardown directions are wired (UXP-DEBUGGER-ARCHITECTURE.md §5.1), scoped
 * per session:
 *  - VS Code debug session ends → stop that session's proxy
 *  - broker session ends (plugin unloaded / app quit) → stop that session's debug session
 */

import * as vscode from "vscode";
import type { PluginSession } from "../../core/broker/SessionRegistry";
import type { CdpProxyRegistry } from "../proxy/CdpProxyRegistry";
import type { UxpService } from "../UxpService";
import {
    findUxpClientSessionId,
    getStampedUxpClientSessionId,
    UXP_SESSION_KEY,
    type UxpStampedDebugConfiguration,
} from "./uxpSessionChain";

export {
    findUxpClientSessionId,
    getStampedUxpClientSessionId,
    UXP_SESSION_KEY,
    type UxpStampedDebugConfiguration,
} from "./uxpSessionChain";

interface ActiveAttachment {
    clientSessionId: string;
    vsSession?: vscode.DebugSession;
    /** js-debug's delegated child session — the one that owns the target's thread. */
    delegateSession?: vscode.DebugSession;
}

export class UxpDebugSessionManager implements vscode.Disposable {
    /**
   * All currently attached sessions, keyed by `clientSessionId`. Each entry
   * owns its own `CdpProxyServer` (listening on its own OS-assigned port)
   * and delegated `pwa-node` debug session, so multiple plugins/scripts can
   * be debugged concurrently in the same VS Code window.
   */
    private readonly active = new Map<string, ActiveAttachment>();
    private readonly disposables: vscode.Disposable[] = [];

    /** Sessions loaded with `breakOnStart:true` that haven't been attached to yet. */
    private readonly pendingBreakSessions = new Map<string, PluginSession>();

    constructor(
        private readonly service: UxpService,
        private readonly proxyRegistry: CdpProxyRegistry,
        private readonly output: vscode.OutputChannel,
    ) {
        this.disposables.push(
            vscode.debug.onDidStartDebugSession((session) => {
                const clientSessionId = getStampedUxpClientSessionId(session.configuration);
                if (clientSessionId !== undefined) {
                    const attachment = this.active.get(clientSessionId);
                    if (attachment) {
                        attachment.vsSession = session;
                    }
                    return;
                }
                // Unstamped session inside a UXP chain = js-debug's delegated child —
                // the session thread-scoped DAP requests must be sent to.
                const inheritedId = findUxpClientSessionId(session);
                const attachment = inheritedId !== undefined ? this.active.get(inheritedId) : undefined;
                if (attachment) {
                    attachment.delegateSession = session;
                    this.output.appendLine(`Adopted js-debug child session for ${String(inheritedId)}.`);
                }
            }),
            vscode.debug.onDidTerminateDebugSession((session) => {
                const clientSessionId = getStampedUxpClientSessionId(session.configuration);
                if (clientSessionId === undefined) {
                    const inheritedId = findUxpClientSessionId(session);
                    const attachment = inheritedId !== undefined ? this.active.get(inheritedId) : undefined;
                    if (attachment?.delegateSession?.id === session.id) {
                        attachment.delegateSession = undefined;
                    }
                    return;
                }
                if (!this.active.has(clientSessionId)) {
                    return;
                }
                this.output.appendLine(`Debug session ended — stopping CDP proxy (${clientSessionId}).`);
                this.stopSessionInBackground(clientSessionId);
            }),
            // Plugin unloaded host-side / app disconnected → close the debugger.
            service.onSessionEnded((session) => {
                this.removePendingBreakSession(session.clientSessionId);
                const attachment = this.active.get(session.clientSessionId);
                if (attachment) {
                    this.output.appendLine(
                        `Session "${session.name}" ended in the host app — stopping the debugger.`,
                    );
                    const vsSession = attachment.vsSession;
                    this.stopSessionInBackground(session.clientSessionId);
                    if (vsSession) {
                        vscode.debug.stopDebugging(vsSession).then(undefined, (err: unknown) => {
                            this.output.appendLine(
                                `Failed to stop the VS Code debug session: ${err instanceof Error ? err.message : String(err)}`,
                            );
                        });
                    }
                    void vscode.window.showInformationMessage(
                        `UXP: "${session.name}" was unloaded — the debug session has been stopped.`,
                    );
                }
            }),
        );
    }

    /** `true` when at least one session is currently attached. */
    get hasActiveSession(): boolean {
        return this.active.size > 0;
    }

    /** Number of currently attached sessions. */
    get activeSessionCount(): number {
        return this.active.size;
    }

    /** `clientSessionId`s of every currently attached session. */
    get activeSessionIds(): string[] {
        return [...this.active.keys()];
    }

    /** Whether the given broker session currently has an attached debugger. */
    isAttached(clientSessionId: string): boolean {
        return this.active.has(clientSessionId);
    }

    /** Whether the session was loaded with breakOnStart and awaits its first attach. */
    isPendingBreakOnStart(clientSessionId: string): boolean {
        return this.pendingBreakSessions.has(clientSessionId);
    }

    /**
   * The `vscode.DebugSession` delegated for `clientSessionId`, once js-debug
   * has actually started it (may briefly be `undefined` right after
   * `attach()` resolves, until `onDidStartDebugSession` fires).
   */
    getVsSession(clientSessionId: string): vscode.DebugSession | undefined {
        return this.active.get(clientSessionId)?.vsSession;
    }

    /**
   * The session thread-scoped DAP requests (`threads`, `stackTrace`,
   * `continue`, `evaluate`) must be sent to: js-debug's delegated child
   * session when one exists, else the stamped root. The root does NOT own
   * the target's thread — requests sent there are dropped without a reply.
   */
    getDapSession(clientSessionId: string): vscode.DebugSession | undefined {
        const attachment = this.active.get(clientSessionId);
        return attachment?.delegateSession ?? attachment?.vsSession;
    }

    /** Register sessions that were loaded with `breakOnStart:true` and await their first attach. */
    markPendingBreakOnStart(sessions: PluginSession[]): void {
        for (const session of sessions) {
            this.pendingBreakSessions.set(session.clientSessionId, session);
        }
    }

    private removePendingBreakSession(clientSessionId: string): void {
        this.pendingBreakSessions.delete(clientSessionId);
    }

    /**
   * Attach the VS Code JS debugger to a broker session. Multiple DIFFERENT
   * sessions can be attached concurrently (each gets its own CDP proxy +
   * `pwa-node` session) — the confirmation prompt only fires when
   * re-attaching to the SAME `clientSessionId` that already has a live
   * debugger (only one frontend is allowed per broker CDT tunnel, see
   * `CdtTunnelManager`). Returns `true` when debugging started.
   */
    async attach(session: PluginSession, sourceRootDir: string): Promise<boolean> {
        const existing = this.active.get(session.clientSessionId);
        if (existing) {
            const replace = "Detach and reconnect";
            const choice = await vscode.window.showWarningMessage(
                "A UXP debug session is already active for this plugin/script.",
                { modal: true },
                replace,
            );
            if (choice !== replace) {
                return false;
            }
            const previous = existing.vsSession;
            await this.stopSession(session.clientSessionId);
            if (previous) {
                await vscode.debug.stopDebugging(previous);
            }
        }

        const wasPendingBreakOnStart = this.pendingBreakSessions.has(session.clientSessionId);
        this.removePendingBreakSession(session.clientSessionId);
        // `Plugin/runScript` sessions always pause on start too (unconditionally,
        // unlike plugin loads, which only pause when breakOnStart was requested)
        // — so they need the same sourcemap-pause handling to bind breakpoints
        // before the script races through to completion.
        const shouldPauseForSourceMap = wasPendingBreakOnStart || session.kind === "script";

        const targetWsUrl = this.service.cdtUrlFor(session);
        const label = `${session.name} (${session.app.appName} ${session.app.appVersion})`;
        this.output.appendLine(`Attaching debugger to ${label} via ${targetWsUrl}`);

        const { port: proxyPort } = await this.proxyRegistry.acquire(
            session.clientSessionId,
            targetWsUrl,
            label,
            sourceRootDir,
            shouldPauseForSourceMap,
        );
        this.output.appendLine(`CDP proxy listening on port ${String(proxyPort)}`);
        this.active.set(session.clientSessionId, { clientSessionId: session.clientSessionId });

        const workspaceFolder
            = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(sourceRootDir))
                ?? vscode.workspace.workspaceFolders?.[0];
        const projectDir = workspaceFolder?.uri.fsPath ?? sourceRootDir;

        const debugConfig: vscode.DebugConfiguration & UxpStampedDebugConfiguration = {
            type: "pwa-node",
            request: "attach",
            name: `UXP – ${label}`,
            port: proxyPort,
            webRoot: projectDir,
            sourceMaps: true,
            resolveSourceMapLocations: null,
            // UXP is NOT a real Node.js process — it only fakes a couple of
            // Node-like globals (e.g. `process.pid`). js-debug's default
            // `autoAttachChildProcesses:true` probes that by evaluating an
            // expression which mutates `process.env` (NODE_OPTIONS /
            // VSCODE_INSPECTOR_OPTIONS) to inject its child-process bootloader.
            // CONFIRMED LIVE (2026-07-28): sending that eval to Photoshop's
            // embedded UXP engine crashes the host app outright (connection
            // dropped right after). UXP never spawns real child Node processes,
            // so this feature is meaningless here — keep it hard off.
            autoAttachChildProcesses: false,
            // breakOnStart / runScript: the proxy arms an instrumentation breakpoint
            // (see CdpProxyServer) that pauses each sourcemapped script before it
            // runs. pauseForSourceMap makes js-debug hold that pause until the
            // script's source map is processed and startup breakpoints are bound —
            // without it, js-debug resumes the instrumentation pause immediately.
            ...(shouldPauseForSourceMap ? { pauseForSourceMap: true } : {}),
            sourceMapPathOverrides: {
                "webpack-internal:///./src/*": `${projectDir}/src/*`,
                "webpack-internal:///./*": `${projectDir}/*`,
                "webpack-internal:///*": "*",
                "webpack:///./~/*": `${projectDir}/node_modules/*`,
                "webpack:///./*": `${projectDir}/*`,
                "webpack:///*": "*",
                "webpack:///src/*": `${projectDir}/*`,
            },
            [UXP_SESSION_KEY]: session.clientSessionId,
        };

        const started = await vscode.debug.startDebugging(workspaceFolder, debugConfig);
        if (!started) {
            await this.stopSession(session.clientSessionId);
            void vscode.window.showErrorMessage(
                "Failed to start the JS debug session. Check the UXP Debugger output for details.",
            );
        }
        return started;
    }

    /** Stop this manager's proxy reference for one attached session (does not touch others). */
    async stopSession(clientSessionId: string): Promise<void> {
        const attachment = this.active.get(clientSessionId);
        this.active.delete(clientSessionId);
        if (attachment) {
            await this.proxyRegistry.release(clientSessionId);
        }
    }

    /** Fire-and-forget {@link stopSession} — failures go to the output channel instead of an unhandled rejection. */
    private stopSessionInBackground(clientSessionId: string): void {
        this.stopSession(clientSessionId).catch((err: unknown) => {
            this.output.appendLine(
                `Failed to stop the CDP proxy for ${clientSessionId}: ${err instanceof Error ? err.message : String(err)}`,
            );
        });
    }

    /** Stop every currently attached session's CDP proxy. */
    async stopAll(): Promise<void> {
        await Promise.all([...this.active.keys()].map((id) => this.stopSession(id)));
    }

    dispose(): void {
        this.stopAll().catch((err: unknown) => {
            this.output.appendLine(
                `Failed to stop CDP proxies on dispose: ${err instanceof Error ? err.message : String(err)}`,
            );
        });
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}
