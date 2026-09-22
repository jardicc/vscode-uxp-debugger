/**
 * CDT tunnel: bridges one DevTools frontend WebSocket (connected to
 * `/socket/cdt/<clientSessionId>`) with the plugin's CDP stream inside the
 * host app.
 *
 * Semantics (unchanged from Adobe's service, ARCHITECTURE.md §6.3):
 *  - on frontend connect  → `Plugin/cdtConnected` to the app
 *  - frontend → app       → wrap raw CDP as `{"command":"CDT",…}`
 *  - app → frontend       → unwrap (done by the broker routing `onCdtFrame`)
 *  - on frontend close    → `Plugin/cdtDisconnected` to the app
 *
 * One frontend per session; a new connection replaces the previous one
 * (matches the CDP proxy's reconnect behaviour on plugin reload).
 */

import type { AppConnection, SocketLike } from "./AppConnection";
import type { PluginSession } from "./SessionRegistry";

interface ActiveTunnel {
    session: PluginSession;
    app: AppConnection;
    frontend: SocketLike;
    unsubscribeCdt: () => void;
    closedByReplace: boolean;
    /** Guards double teardown — "error" and "close" can both fire. */
    closed: boolean;
}

export class CdtTunnelManager {
    /** clientSessionId → active tunnel. */
    private readonly tunnels = new Map<string, ActiveTunnel>();

    constructor(private readonly log: (message: string) => void = () => undefined) {}

    /** Attach a DevTools frontend socket to a plugin session. */
    attach(frontend: SocketLike, session: PluginSession, app: AppConnection): void {
    // Replace any previous frontend for this session.
        const existing = this.tunnels.get(session.clientSessionId);
        if (existing) {
            existing.closedByReplace = true;
            existing.unsubscribeCdt();
            existing.frontend.close();
            this.tunnels.delete(session.clientSessionId);
            this.log(`cdt: replaced existing frontend for ${session.clientSessionId}`);
        }

        // Flips on "error"/"close" — stops CDP frames being written into a dead socket.
        let frontendAlive = true;
        const unsubscribeCdt = app.onCdtFrame.on((event) => {
            if (frontendAlive && event.hostSessionId === session.hostSessionId) {
                frontend.send(event.cdtMessage);
            }
        });

        const tunnel: ActiveTunnel = {
            session,
            app,
            frontend,
            unsubscribeCdt,
            closedByReplace: false,
            closed: false,
        };
        this.tunnels.set(session.clientSessionId, tunnel);

        frontend.on("message", (data) => {
            app.sendCdtFrame(session.hostSessionId, String(data));
        });
        frontend.on("close", () => {
            frontendAlive = false;
            this.handleFrontendClose(tunnel);
        });
        frontend.on("error", (err) => {
            frontendAlive = false;
            this.log(`cdt: frontend socket error (${session.clientSessionId}): ${err.message}`);
            // "close" usually follows "error", but SocketLike doesn't guarantee
            // it — tear down here too so a zombie tunnel can't leak its
            // onCdtFrame listener or leave the app thinking a CDT is attached.
            this.handleFrontendClose(tunnel);
        });

        app.notifyCdtState(session.hostSessionId, true);
        this.log(`cdt: frontend attached to ${session.clientSessionId}`);
    }

    /** Tear down the tunnel of one session (plugin unloaded / app gone). */
    closeForSession(clientSessionId: string, notifyApp: boolean): void {
        const tunnel = this.tunnels.get(clientSessionId);
        if (!tunnel) {
            return;
        }
        this.tunnels.delete(clientSessionId);
        tunnel.closedByReplace = true; // suppress the frontend-close handler
        tunnel.unsubscribeCdt();
        tunnel.frontend.close();
        if (notifyApp) {
            tunnel.app.notifyCdtState(tunnel.session.hostSessionId, false);
        }
    }

    /** Tear down everything (broker shutdown). */
    closeAll(): void {
        for (const clientSessionId of [...this.tunnels.keys()]) {
            this.closeForSession(clientSessionId, false);
        }
    }

    hasTunnel(clientSessionId: string): boolean {
        return this.tunnels.has(clientSessionId);
    }

    private handleFrontendClose(tunnel: ActiveTunnel): void {
        if (tunnel.closedByReplace || tunnel.closed) {
            return;
        }
        tunnel.closed = true;
        const current = this.tunnels.get(tunnel.session.clientSessionId);
        if (current === tunnel) {
            this.tunnels.delete(tunnel.session.clientSessionId);
        }
        tunnel.unsubscribeCdt();
        tunnel.app.notifyCdtState(tunnel.session.hostSessionId, false);
        this.log(`cdt: frontend detached from ${tunnel.session.clientSessionId}`);
    }
}
