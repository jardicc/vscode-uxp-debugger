import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { registerDebugAdapterTrackerFactory } = vi.hoisted(() => ({
    registerDebugAdapterTrackerFactory: vi.fn(),
}));
vi.mock("vscode", () => ({
    debug: {
        registerDebugAdapterTrackerFactory,
    },
}));

import type * as vscode from "vscode";
import { fakeLog } from "../fixtures/fakeVscode";
import { type CancellationTokenLike, type PauseSnapshot, PauseTracker } from "../../src/vscode/debug/pauseTracker";
import { probePauseSnapshot, registerPauseTracker } from "../../src/vscode/debug/pauseTrackerRegistration";
import { UXP_SESSION_KEY } from "../../src/vscode/debug/uxpSessionChain";

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

    it("forgetSession drops the snapshot and immediately rejects any pending waiters", async () => {
        const tracker = new PauseTracker();
        tracker.recordPause("s1", snapshot);
        tracker.recordContinued("s1");

        const token1 = fakeToken();
        const token2 = fakeToken();
        const promise1 = tracker.waitForPause("s1", 5000, token1);
        const promise2 = tracker.waitForPause("s1", 5000, token2);
        const otherSessionPromise = tracker.waitForPause("s2", 5000, fakeToken());

        tracker.recordPause("s0", snapshot);
        tracker.forgetSession("s0");
        expect(tracker.getSnapshot("s0")).toBeUndefined();

        tracker.forgetSession("s1");

        await expect(promise1).rejects.toThrow("The debug session ended before the target paused.");
        await expect(promise2).rejects.toThrow("The debug session ended before the target paused.");

        // Cancelling or advancing timers after forgetSession must be a no-op.
        token1.cancel();
        const otherSessionTimeoutAssertion = expect(otherSessionPromise).rejects.toThrow(
            /Timed out waiting for the target to pause/,
        );
        await vi.advanceTimersByTimeAsync(5000);

        // Waiters on other sessions remain active until resolved or timed out.
        await otherSessionTimeoutAssertion;
    });
});

describe("probePauseSnapshot", () => {
    it("returns a snapshot when the target has non-empty stack frames", async () => {
        const customRequest = vi.fn((command: string) => {
            if (command === "threads") {
                return Promise.resolve({ threads: [{ id: 7 }] });
            }
            if (command === "stackTrace") {
                return Promise.resolve({
                    stackFrames: [{ id: 10, name: "onClick", source: { path: "/plugin/index.js" }, line: 42 }],
                });
            }
            return Promise.reject(new Error(`Unexpected command: ${command}`));
        });
        const session = { customRequest } as unknown as vscode.DebugSession;

        const result = await probePauseSnapshot(session);
        expect(result).toEqual({
            threadId: 7,
            frames: [{ id: 10, name: "onClick", sourcePath: "/plugin/index.js", line: 42 }],
        });
    });

    it("returns undefined when stackTrace resolves with empty stackFrames", async () => {
        const customRequest = vi.fn((command: string) => {
            if (command === "threads") {
                return Promise.resolve({ threads: [{ id: 7 }] });
            }
            if (command === "stackTrace") {
                return Promise.resolve({ stackFrames: [] });
            }
            return Promise.reject(new Error(`Unexpected command: ${command}`));
        });
        const session = { customRequest } as unknown as vscode.DebugSession;

        const result = await probePauseSnapshot(session);
        expect(result).toBeUndefined();
    });
});

describe("registerPauseTracker", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        registerDebugAdapterTrackerFactory.mockReset();
        registerDebugAdapterTrackerFactory.mockReturnValue({ dispose: () => undefined });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("aborts in-flight stackTrace retries without logging an error when the session stops", async () => {
        const tracker = new PauseTracker();
        const output = fakeLog();
        const lines = output.lines;

        registerPauseTracker(tracker, output);
        const factory = registerDebugAdapterTrackerFactory.mock.calls[0][1] as vscode.DebugAdapterTrackerFactory;

        // First stackTrace never replies; if not aborted on session stop,
        // subsequent retries would fire after the 2000ms timeout and fail.
        const customRequest = vi.fn(() => new Promise<never>(() => undefined));
        const session = {
            id: "dap-child-1",
            configuration: { [UXP_SESSION_KEY]: "uxp-session-1" },
            customRequest,
        } as unknown as vscode.DebugSession;

        const adapterTracker = factory.createDebugAdapterTracker(session) as vscode.DebugAdapterTracker;
        adapterTracker.onDidSendMessage?.({
            type: "event",
            event: "stopped",
            body: { reason: "breakpoint", threadId: 1 },
        });

        expect(customRequest).toHaveBeenCalledTimes(1);

        // Session ends while the first stackTrace request is still pending.
        adapterTracker.onWillStopSession?.();

        await vi.advanceTimersByTimeAsync(10_000);

        expect(customRequest).toHaveBeenCalledTimes(1);
        expect(lines.some((line) => line.includes("failed to build a pause snapshot"))).toBe(false);
        expect(tracker.getSnapshot("uxp-session-1")).toBeUndefined();
    });
});
