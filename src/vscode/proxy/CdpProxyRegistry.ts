import type * as vscode from "vscode";
import { CdpProxyServer } from "./cdpProxy";

/**
 * Shared ownership of `CdpProxyServer` instances, one per broker session
 * (`clientSessionId`), ref-counted across consumers.
 *
 * Why this exists (docs/UI-DEBUGGING.md): the broker's CDT tunnel
 * allows exactly ONE frontend connection per session — a second connection
 * *replaces* the first. Both the JS debugger (js-debug via
 * `UxpDebugSessionManager`) and the HTML inspector panel must therefore
 * share a single proxy (and its single target connection) instead of each
 * creating their own.
 */
export class CdpProxyRegistry {
    private readonly entries = new Map<
        string,
        { proxy: CdpProxyServer; port: number; refs: number }
    >();

    /** In-flight `proxy.stop()`s, so `acquire` can wait them out (re-attach race). */
    private readonly stopsInFlight = new Map<string, Promise<void>>();

    /** In-flight `acquire()`s, so concurrent acquires can't create two proxies for one session. */
    private readonly acquiresInFlight = new Map<string, Promise<{ proxy: CdpProxyServer; port: number }>>();

    constructor(private readonly log: vscode.OutputChannel) {}

    /** The running proxy for a session, if any (does not create one). */
    peek(clientSessionId: string): { proxy: CdpProxyServer; port: number } | undefined {
        const entry = this.entries.get(clientSessionId);
        return entry ? { proxy: entry.proxy, port: entry.port } : undefined;
    }

    /** The rolling console/exception buffer for a session, if its proxy is running (LANGUAGE-MODEL-TOOLS.md §4). */
    getEventBuffer(clientSessionId: string): ReturnType<CdpProxyServer["getEventBuffer"]> | undefined {
        return this.peek(clientSessionId)?.proxy.getEventBuffer();
    }

    /** Evaluates an expression in a session's global CDP context — see `CdpProxyServer.evaluateInGlobalContext`. */
    evaluateGlobal(
        clientSessionId: string,
        expression: string,
    ): ReturnType<CdpProxyServer["evaluateInGlobalContext"]> {
        const entry = this.peek(clientSessionId);
        if (!entry) {
            return Promise.reject(new Error(`No CDP connection found for session "${clientSessionId}".`));
        }
        return entry.proxy.evaluateInGlobalContext(expression);
    }

    /**
   * Get or create the proxy for a session and take a reference on it.
   * Every successful `acquire()` must be paired with one `release()`.
   */
    async acquire(
        clientSessionId: string,
        targetWsUrl: string,
        targetLabel: string,
        sourceRootDir: string,
        breakOnStartPending: boolean,
    ): Promise<{ proxy: CdpProxyServer; port: number }> {
        // Serialize per session: while one acquire is still awaiting
        // `proxy.start()`, a concurrent one (e.g. inspector open + debugger
        // attach) would pass the `entries` check too and create a second
        // proxy — the leaked one then fights the live one over the single
        // allowed CDT tunnel connection.
        let inFlight = this.acquiresInFlight.get(clientSessionId);
        while (inFlight) {
            await inFlight.catch(() => undefined);
            inFlight = this.acquiresInFlight.get(clientSessionId);
        }
        const attempt = this.acquireNow(
            clientSessionId,
            targetWsUrl,
            targetLabel,
            sourceRootDir,
            breakOnStartPending,
        );
        this.acquiresInFlight.set(clientSessionId, attempt);
        try {
            return await attempt;
        }
        finally {
            this.acquiresInFlight.delete(clientSessionId);
        }
    }

    private async acquireNow(
        clientSessionId: string,
        targetWsUrl: string,
        targetLabel: string,
        sourceRootDir: string,
        breakOnStartPending: boolean,
    ): Promise<{ proxy: CdpProxyServer; port: number }> {
        // Wait out an in-flight stop for this session — otherwise a re-attach
        // would spin up a second proxy while the old one still holds the
        // single allowed target connection.
        const stopInFlight = this.stopsInFlight.get(clientSessionId);
        if (stopInFlight) {
            await stopInFlight.catch(() => undefined);
        }
        const existing = this.entries.get(clientSessionId);
        if (existing) {
            existing.refs++;
            if (breakOnStartPending) {
                // Only effective while the target connection hasn't opened yet;
                // the proxy logs and ignores it otherwise.
                existing.proxy.setBreakOnStartPending(true);
            }
            this.log.appendLine(
                `[CDP] Reusing proxy for session ${clientSessionId} (refs: ${String(existing.refs)}).`,
            );
            return { proxy: existing.proxy, port: existing.port };
        }

        const proxy = new CdpProxyServer(
            targetWsUrl,
            targetLabel,
            sourceRootDir,
            this.log,
            breakOnStartPending,
        );
        const port = await proxy.start();
        this.entries.set(clientSessionId, { proxy, port, refs: 1 });
        this.log.appendLine(
            `[CDP] Proxy for session ${clientSessionId} listening on port ${String(port)}.`,
        );
        return { proxy, port };
    }

    /** Drop one reference; the proxy stops when the last reference is gone. */
    async release(clientSessionId: string): Promise<void> {
        const entry = this.entries.get(clientSessionId);
        if (!entry) {
            return;
        }
        entry.refs--;
        if (entry.refs > 0) {
            this.log.appendLine(
                `[CDP] Released proxy ref for session ${clientSessionId} (refs left: ${String(entry.refs)}).`,
            );
            return;
        }
        this.entries.delete(clientSessionId);
        this.log.appendLine(`[CDP] Stopping proxy for session ${clientSessionId}.`);
        await this.stopTracked(clientSessionId, entry.proxy);
    }

    /** Stop every proxy regardless of ref-counts (takeover / deactivate). */
    async stopAll(): Promise<void> {
        const all = [...this.entries.entries()];
        this.entries.clear();
        await Promise.all(all.map(([id, entry]) => this.stopTracked(id, entry.proxy)));
    }

    /** Run `proxy.stop()` registered in {@link stopsInFlight} until it settles. */
    private stopTracked(clientSessionId: string, proxy: CdpProxyServer): Promise<void> {
        const stop: Promise<void> = proxy.stop().finally(() => {
            if (this.stopsInFlight.get(clientSessionId) === stop) {
                this.stopsInFlight.delete(clientSessionId);
            }
        });
        this.stopsInFlight.set(clientSessionId, stop);
        return stop;
    }
}
