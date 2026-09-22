/**
 * Wires {@link PauseTracker} to the real DAP `stopped`/`continued` event
 * stream (LANGUAGE-MODEL-TOOLS.md §5.2) — the vscode-dependent half; `pauseTracker.ts`
 * itself stays pure/testable.
 *
 * Only observes debug sessions belonging to a UXP attachment — matched by
 * walking the `parentSession` chain for `UXP_SESSION_KEY`, since js-debug
 * delegates the actual target to an unstamped CHILD session whose DAP stream
 * carries the `stopped`/`continued` events. Pause state is keyed by
 * `clientSessionId`, stable across the whole chain. Every other debug session
 * in the window (e.g. an unrelated Node.js debug session) is left untouched.
 */

import * as vscode from "vscode";
import type { PauseFrame, PauseSnapshot, PauseTracker } from "./pauseTracker";
import { findUxpClientSessionId } from "./uxpSessionChain";

interface StoppedEventBody {
    reason?: string;
    threadId: number;
}

interface DapResponseLike {
    type?: string;
    event?: string;
    body?: unknown;
    command?: string;
    success?: boolean;
}

/**
 * DAP requests that resume execution. Per the DAP spec a `continued` EVENT is
 * only required when resumption *wasn't already implied* by a request's own
 * response — js-debug relies on that carve-out and does not reliably send an
 * explicit `continued` event after a plain `continue`/`next`/`stepIn`/`stepOut`.
 * Without this, a stale `lastSnapshot` from the previous pause would never be
 * cleared, so `uxp_wait_for_pause` kept resolving instantly with old/stale
 * frame data instead of actually waiting for the next real pause — the
 * reported "pause detection doesn't work" bug. Watching the RESPONSE to these
 * requests succeed is a reliable resume signal regardless of whether the
 * adapter also emits `continued`.
 */
const RESUME_COMMANDS = new Set(["continue", "next", "stepIn", "stepOut", "stepBack", "reverseContinue"]);

/**
 * js-debug transiently drops `stackTrace` requests sent right after a
 * `stopped` event ("Unknown request: stackTrace", no reply at all — same race
 * the e2e suite works around with `stackTraceWithRetry`). Retry with a
 * per-attempt timeout so one dropped request doesn't lose the pause: the
 * target stays paused, so no further `stopped` event would ever arrive to
 * recover from a single missed snapshot.
 */
const STACK_TRACE_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 2_000;
const RETRY_DELAY_MS = 250;

type TimedResult<T> = { kind: "ok"; value: T } | { kind: "error"; error: unknown } | { kind: "timeout" };

function withTimeout<T>(thenable: Thenable<T>, ms: number): Promise<TimedResult<T>> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            resolve({ kind: "timeout" });
        }, ms);
        thenable.then(
            (value) => {
                clearTimeout(timer);
                resolve({ kind: "ok", value });
            },
            (error: unknown) => {
                clearTimeout(timer);
                resolve({ kind: "error", error });
            },
        );
    });
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerPauseTracker(tracker: PauseTracker, output: vscode.OutputChannel): vscode.Disposable {
    return vscode.debug.registerDebugAdapterTrackerFactory("*", {
        createDebugAdapterTracker(session: vscode.DebugSession) {
            // Match via the parentSession chain: js-debug delegates the actual
            // target to a CHILD session without the stamp — the DAP `stopped`/
            // `continued` events flow on the child's stream, never the root's.
            // Pause state is keyed by clientSessionId so it's stable regardless
            // of which session in the chain emits the event.
            const clientSessionId = findUxpClientSessionId(session);
            if (clientSessionId === undefined) {
                return undefined;
            }
            output.appendLine(
                `[pauseTracker] tracking session=${session.id}${session.parentSession ? " (js-debug child)" : ""} client=${clientSessionId}`,
            );
            return {
                onDidSendMessage: (msg: DapResponseLike) => {
                    void (async () => {
                        if (msg.type === "event" && msg.event === "stopped") {
                            const reason = (msg.body as StoppedEventBody | undefined)?.reason;
                            if (reason === "instrumentation") {
                                // js-debug's own pauseForSourceMap bookkeeping pause (binds
                                // startup breakpoints/source maps, then resumes on its own) —
                                // not a real pause the agent should react to (see cdpProxy.ts's
                                // handleBreakOnStartMessage doc comment).
                                output.appendLine(`[pauseTracker] client=${clientSessionId} ignored "instrumentation" stopped event`);
                                return;
                            }
                            try {
                                const snapshot = await buildSnapshot(session, (msg.body as StoppedEventBody).threadId);
                                output.appendLine(
                                    `[pauseTracker] client=${clientSessionId} PAUSED reason=${reason} threadId=${String(snapshot.threadId)} frames=${String(snapshot.frames.length)}`,
                                );
                                tracker.recordPause(clientSessionId, snapshot);
                            }
                            catch (err) {
                                // All stackTrace retries failed — the pause itself is NOT lost:
                                // uxp_wait_for_pause/uxp_resume fall back to probePauseSnapshot(),
                                // which re-queries the (still paused) adapter on demand.
                                output.appendLine(
                                    `[pauseTracker] client=${clientSessionId} failed to build a pause snapshot: ${String(err)}`,
                                );
                                console.error("[UXP pauseTracker] Failed to build a pause snapshot:", err);
                            }
                        }
                        else if (msg.type === "event" && msg.event === "continued") {
                            output.appendLine(`[pauseTracker] client=${clientSessionId} RESUMED (continued event)`);
                            tracker.recordContinued(clientSessionId);
                        }
                        else if (
                            msg.type === "response"
                            && msg.success !== false
                            && typeof msg.command === "string"
                            && RESUME_COMMANDS.has(msg.command)
                        ) {
                            output.appendLine(`[pauseTracker] client=${clientSessionId} RESUMED (${msg.command} response)`);
                            tracker.recordContinued(clientSessionId);
                        }
                    })().catch((err: unknown) => {
                        // Bookkeeping must never surface as an unhandled rejection.
                        output.appendLine(
                            `[pauseTracker] client=${clientSessionId} unexpected error: ${String(err)}`,
                        );
                    });
                },
            };
        },
    });
}

async function buildSnapshot(session: vscode.DebugSession, threadId: number): Promise<PauseSnapshot> {
    let lastFailure = "";
    for (let attempt = 1; attempt <= STACK_TRACE_ATTEMPTS; attempt++) {
        const result = await withTimeout(session.customRequest("stackTrace", { threadId }), REQUEST_TIMEOUT_MS);
        if (result.kind === "ok") {
            return toSnapshot(threadId, result.value as Record<string, unknown>);
        }
        lastFailure = result.kind === "timeout" ? `no reply within ${String(REQUEST_TIMEOUT_MS)}ms` : String(result.error);
        if (attempt < STACK_TRACE_ATTEMPTS) {
            await delay(RETRY_DELAY_MS);
        }
    }
    throw new Error(`stackTrace failed after ${String(STACK_TRACE_ATTEMPTS)} attempts (last: ${lastFailure})`);
}

function toSnapshot(threadId: number, stack: Record<string, unknown>): PauseSnapshot {
    // Malformed adapter replies must not throw — treat a missing list as "no frames".
    const rawFrames = Array.isArray(stack.stackFrames)
        ? (stack.stackFrames as Record<string, unknown>[])
        : [];
    const frames: PauseFrame[] = rawFrames.map((f) => ({
        id: f.id as number,
        name: f.name as string,
        sourcePath: (f.source as Record<string, unknown> | undefined)?.path as string | undefined,
        line: f.line as number,
    }));
    return { threadId, frames };
}

/**
 * Actively asks the adapter whether the target is paused RIGHT NOW —
 * recovery path for a pause whose `stopped`-event snapshot build failed
 * (all `buildSnapshot` retries dropped). Without it, that pause was lost
 * forever: the target stays paused, so no further `stopped` event arrives.
 *
 * Returns `undefined` when the target is running (`stackTrace` rejects with
 * "not paused") or the adapter doesn't answer — callers then fall back to
 * waiting for the next `stopped` event as before.
 */
export async function probePauseSnapshot(session: vscode.DebugSession): Promise<PauseSnapshot | undefined> {
    const threadsResult = await withTimeout(session.customRequest("threads"), REQUEST_TIMEOUT_MS);
    if (threadsResult.kind !== "ok") {
        return undefined;
    }
    const threads = (threadsResult.value as { threads?: { id?: unknown }[] } | undefined)?.threads;
    const threadId = threads?.[0]?.id;
    if (typeof threadId !== "number") {
        return undefined;
    }
    const stackResult = await withTimeout(session.customRequest("stackTrace", { threadId }), REQUEST_TIMEOUT_MS);
    if (stackResult.kind !== "ok") {
        return undefined;
    }
    return toSnapshot(threadId, stackResult.value as Record<string, unknown>);
}
