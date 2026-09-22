import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CancellationTokenLike, type PauseSnapshot, PauseTracker } from "../../src/vscode/debug/pauseTracker";

/** A fake `vscode.CancellationToken` — never cancelled unless `.cancel()` is called. */
function fakeToken(): CancellationTokenLike & { cancel(): void } {
    let isCancellationRequested = false;
    const listeners: (() => void)[] = [];
    return {
        get isCancellationRequested() {
            return isCancellationRequested;
        },
        onCancellationRequested(listener: () => void) {
            listeners.push(listener);
            return { dispose: () => undefined };
        },
        cancel() {
            isCancellationRequested = true;
            for (const listener of listeners) {
                listener();
            }
        },
    };
}

const snapshot: PauseSnapshot = { threadId: 1, frames: [{ id: 1, name: "main", line: 5 }] };

describe("PauseTracker", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("resolves immediately when the session is already paused", async () => {
        const tracker = new PauseTracker();
        tracker.recordPause("s1", snapshot);

        const result = await tracker.waitForPause("s1", 1000, fakeToken());
        expect(result).toEqual(snapshot);
    });

    it("resolves once a matching recordPause arrives", async () => {
        const tracker = new PauseTracker();
        const promise = tracker.waitForPause("s1", 1000, fakeToken());

        tracker.recordPause("s1", snapshot);

        await expect(promise).resolves.toEqual(snapshot);
    });

    it("does not resolve a waiter for a different session", async () => {
        const tracker = new PauseTracker();
        const promise = tracker.waitForPause("s1", 1000, fakeToken());
        let settled = false;
        void promise.then(() => (settled = true));

        tracker.recordPause("s2", snapshot);
        await vi.advanceTimersByTimeAsync(0);

        expect(settled).toBe(false);
    });

    it("rejects with an actionable message after the timeout elapses", async () => {
        const tracker = new PauseTracker();
        const promise = tracker.waitForPause("s1", 1000, fakeToken());
        const assertion = expect(promise).rejects.toThrow(/Timed out waiting for the target to pause/);

        await vi.advanceTimersByTimeAsync(1000);
        await assertion;
    });

    it("rejects immediately when the token is already cancelled", async () => {
        const token = fakeToken();
        token.cancel();
        const tracker = new PauseTracker();

        await expect(tracker.waitForPause("s1", 1000, token)).rejects.toThrow("Cancelled.");
    });

    it("rejects when cancelled while waiting, and a later pause no longer resolves it", async () => {
        const tracker = new PauseTracker();
        const token = fakeToken();
        const promise = tracker.waitForPause("s1", 1000, token);

        token.cancel();
        await expect(promise).rejects.toThrow("Cancelled.");

        // A pause arriving after cancellation must not throw/affect anything.
        expect(() => tracker.recordPause("s1", snapshot)).not.toThrow();
    });

    it("clears the snapshot on recordContinued", () => {
        const tracker = new PauseTracker();
        tracker.recordPause("s1", snapshot);
        tracker.recordContinued("s1");

        expect(tracker.getSnapshot("s1")).toBeUndefined();
    });

    it("forgetSession drops both the snapshot and any pending waiters", async () => {
        const tracker = new PauseTracker();
        const promise = tracker.waitForPause("s1", 5000, fakeToken());
        tracker.forgetSession("s1");

        tracker.recordPause("s1", snapshot);
        let settled = false;
        void promise.then(() => (settled = true));
        await vi.advanceTimersByTimeAsync(0);

        expect(settled).toBe(false);
    });
});
