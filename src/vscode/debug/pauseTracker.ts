/**
 * Tracks the latest "paused" (DAP `stopped`) snapshot per debug session and
 * lets callers await the next pause (LANGUAGE-MODEL-TOOLS.md §5.2).
 *
 * Pure/vscode-free by design (same convention as `panelState.ts`) — the real
 * DAP event wiring lives in `pauseTrackerRegistration.ts`, which builds a
 * `PauseSnapshot` from `vscode.DebugSession.customRequest` and feeds it in
 * here via `recordPause`.
 */

export interface PauseFrame {
    id: number;
    name: string;
    sourcePath?: string;
    line: number;
}

export interface PauseSnapshot {
    threadId: number;
    frames: PauseFrame[];
}

/** Minimal shape of `vscode.CancellationToken` this module needs — a real token satisfies it structurally. */
export interface CancellationTokenLike {
    isCancellationRequested: boolean;
    onCancellationRequested(listener: () => void): { dispose(): void };
}

export class PauseTracker {
    private readonly waiters = new Map<string, ((snapshot: PauseSnapshot) => void)[]>();
    private readonly lastSnapshot = new Map<string, PauseSnapshot>();

    /** Called once a session's "stopped" event has been resolved into a snapshot. */
    recordPause(sessionKey: string, snapshot: PauseSnapshot): void {
        this.lastSnapshot.set(sessionKey, snapshot);
        const waiting = this.waiters.get(sessionKey);
        if (!waiting) {
            return;
        }
        this.waiters.delete(sessionKey);
        for (const resolve of waiting) {
            resolve(snapshot);
        }
    }

    /** Called on a session's "continued" event — the stale snapshot no longer reflects reality. */
    recordContinued(sessionKey: string): void {
        this.lastSnapshot.delete(sessionKey);
    }

    /** Drops all state for a session (its debug session ended). */
    forgetSession(sessionKey: string): void {
        this.lastSnapshot.delete(sessionKey);
        this.waiters.delete(sessionKey);
    }

    getSnapshot(sessionKey: string): PauseSnapshot | undefined {
        return this.lastSnapshot.get(sessionKey);
    }

    /**
   * Resolves immediately if the session is already paused; otherwise waits
   * for the next pause, up to `timeoutMs`, cancellable via `token`.
   */
    waitForPause(sessionKey: string, timeoutMs: number, token: CancellationTokenLike): Promise<PauseSnapshot> {
        const existing = this.lastSnapshot.get(sessionKey);
        if (existing) {
            return Promise.resolve(existing);
        }
        if (token.isCancellationRequested) {
            return Promise.reject(new Error("Cancelled."));
        }

        return new Promise((resolve, reject) => {
            const list = this.waiters.get(sessionKey) ?? [];
            this.waiters.set(sessionKey, list);

            const removeWaiter = (): void => {
                const current = this.waiters.get(sessionKey);
                if (!current) {
                    return;
                }
                const idx = current.indexOf(onPause);
                if (idx !== -1) {
                    current.splice(idx, 1);
                }
                if (current.length === 0) {
                    this.waiters.delete(sessionKey);
                }
            };

            const timer = setTimeout(() => {
                cancelSub.dispose();
                removeWaiter();
                reject(
                    new Error(
                        "Timed out waiting for the target to pause. Ask the user to trigger the "
                        + "plugin action that reproduces the bug, and make sure a breakpoint is set.",
                    ),
                );
            }, timeoutMs);

            const onPause = (snapshot: PauseSnapshot): void => {
                clearTimeout(timer);
                cancelSub.dispose();
                resolve(snapshot);
            };
            list.push(onPause);

            const cancelSub = token.onCancellationRequested(() => {
                clearTimeout(timer);
                removeWaiter();
                reject(new Error("Cancelled."));
            });
        });
    }
}
