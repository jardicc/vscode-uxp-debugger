import * as vscode from "vscode";

/** Wraps a plain-text result — the shape almost every UXP LM tool returns. */
export function textResult(text: string): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

/**
 * Rejects with `timeoutMessage` if `promise` hasn't settled within `timeoutMs` —
 * turns a silently-hung DAP request (e.g. js-debug never replying) into an
 * actionable error instead of the tool call just never returning. Accepts a
 * `Thenable` since `vscode.DebugSession.customRequest` returns one, not a
 * native `Promise`.
 */
export function raceWithTimeout<T>(promise: Thenable<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(timeoutMessage));
        }, timeoutMs);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err: unknown) => {
                clearTimeout(timer);
                reject(err instanceof Error ? err : new Error(String(err)));
            },
        );
    });
}
