/**
 * `uxp.debugScript` (F5) — run + debug the Adobe UXP script open in the
 * active editor via `Plugin/runScript` (UXP-DEBUGGER-ARCHITECTURE.md §§4.4, 8.4).
 *
 * `runScript` has no `breakOnStart` request parameter, but the host itself
 * always pauses execution on start and waits for a debugger to attach
 * (logged as "Waiting for the debugger to attach..."). `CdpProxyServer`
 * sends `Runtime.runIfWaitingForDebugger` on connect to resume it once
 * js-debug has had a chance to enable the Debugger domain, so breakpoints
 * (including `debugger;` statements) in the script are still hit.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { ConnectedApp } from "../../core/broker/UxpBroker";
import type { PluginSession } from "../../core/broker/SessionRegistry";
import { HostReplyError, NonErasableTypeScriptError } from "../../core/errors";
import { normalizeUserArgs, parseArgsText } from "../../core/protocol/messages";
import { stripTypeScriptFile } from "../../core/stripTypeScript";
import type { UxpService } from "../UxpService";
import {
    getStampedUxpClientSessionId,
    type UxpDebugSessionManager,
} from "../debug/UxpDebugSessionManager";
import { hostAppNotRunningDialog, showHostAppNotRunningError } from "../ui/dialogs";
import { pickApp } from "../ui/picks";

/** Extension → allowed host app ids (UDT 2.2.1 renderer table). `undefined` = any app. */
const SCRIPT_EXTENSION_APPS: Record<string, string[] | undefined> = {
    ".js": undefined,
    ".ts": undefined,
    ".ccjs": undefined,
    ".psjs": ["PS"],
    ".idjs": ["ID", "IDS", "indesign", "indesignserver"],
};

const ARGS_STATE_KEY_PREFIX = "uxp.scriptArgs:";

/**
 * `Plugin/runScript` has no "unload" counterpart, so a just-stopped previous
 * run may still be tearing down inside the host when we re-run — it then
 * replies with a transient "... is modal" `HostReplyError`. Retry a few
 * times instead of guessing a fixed delay upfront.
 */
const MODAL_RETRY_ATTEMPTS = 10;
const MODAL_RETRY_DELAY_MS = 500;

function isHostModalError(err: unknown): boolean {
    return err instanceof HostReplyError && /\bis modal\b/i.test(err.hostError);
}

export interface DebugScriptArgs {
    /** Absolute script path (from the `"uxp-script"` launch type). */
    script?: string;
    /** Restrict to one host app id, e.g. `"PS"`. */
    app?: string;
    /** JSON values passed to the script. */
    userArgs?: unknown;
    /** Whether a missing host notification should keep the command pending for Retry. */
    promptToRetry?: boolean;
}

export async function debugScriptCommand(
    service: UxpService,
    debugManager: UxpDebugSessionManager,
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    args?: DebugScriptArgs,
): Promise<PluginSession | undefined> {
    // 1. Resolve the script file.
    const scriptPath = await resolveScriptPath(args);
    if (!scriptPath) {
        return;
    }
    const extension = path.extname(scriptPath).toLowerCase();
    if (!(extension in SCRIPT_EXTENSION_APPS)) {
        void vscode.window.showErrorMessage(
            `UXP: "${path.basename(scriptPath)}" is not a UXP script. `
            + "Supported extensions: .ccjs (any app), .psjs (Photoshop), .idjs (InDesign), .ts (stripped on the fly).",
        );
        return;
    }

    // 2. Broker + target app.
    await service.ensureStarted();
    const app = await pickScriptTargetApp(service, extension, args?.app, args?.promptToRetry ?? true);
    if (!app) {
        return;
    }

    // 3. Script arguments.
    const userArgs = await resolveUserArgs(context, scriptPath, args);
    if (userArgs === undefined) {
        return; // cancelled
    }

    // 4. TypeScript sources have no build step: strip types on the fly
    // (Node/Deno/Bun-style erasure — see src/core/stripTypeScript.ts) into a
    // throwaway .js, and debug that instead. Single-file only — a real
    // multi-module TS plugin still needs a real bundler.
    let runPath = scriptPath;
    let cleanupStripped: (() => void) | undefined;
    if (extension === ".ts") {
        try {
            const stripped = stripTypeScriptFile(scriptPath);
            runPath = stripped.jsPath;
            cleanupStripped = stripped.cleanup;
        }
        catch (err) {
            const message = err instanceof NonErasableTypeScriptError ? err.message : String(err);
            void vscode.window.showErrorMessage(`UXP: ${message}`);
            return;
        }
    }

    // 5. Run + attach.
    output.appendLine(
        `Running script ${scriptPath} in ${app.info.appName} ${app.info.appVersion} `
        + `with userArgs ${JSON.stringify(userArgs)}`,
    );
    let session: PluginSession;
    try {
        session = await runScriptWithModalRetry(service, runPath, app, userArgs, scriptPath, output);
    }
    catch (err) {
        cleanupStripped?.();
        throw err;
    }
    let terminateListener: vscode.Disposable | undefined;
    if (cleanupStripped) {
        const cleanup = cleanupStripped;
        // Registered before attach so a script that finishes instantly can't
        // terminate before the listener exists; also tracked in `subscriptions`
        // so a window close can't leak it (dispose is idempotent).
        terminateListener = vscode.debug.onDidTerminateDebugSession((vsSession) => {
            if (getStampedUxpClientSessionId(vsSession.configuration) === session.clientSessionId) {
                cleanup();
                terminateListener?.dispose();
            }
        });
        context.subscriptions.push(terminateListener);
    }
    let attached = false;
    try {
        attached = await debugManager.attach(session, path.dirname(scriptPath));
    }
    finally {
        if (!attached) {
            // No debug session → no terminate event → clean up here instead.
            terminateListener?.dispose();
            cleanupStripped?.();
        }
    }
    return attached ? session : undefined;
}

/**
 * Wraps `service.runScript` with retries on Photoshop's transient "is modal"
 * reply (previous script instance still tearing down). Rethrows any other
 * error, or the last modal error once `MODAL_RETRY_ATTEMPTS` is exhausted.
 */
async function runScriptWithModalRetry(
    service: UxpService,
    runPath: string,
    app: ConnectedApp,
    userArgs: unknown[],
    scriptPath: string,
    output: vscode.OutputChannel,
): Promise<PluginSession> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await service.runScript(runPath, app, userArgs, scriptPath);
        }
        catch (err) {
            if (!isHostModalError(err) || attempt >= MODAL_RETRY_ATTEMPTS) {
                throw err;
            }
            output.appendLine(
                `[script] Photoshop is still modal (previous run tearing down) — retrying `
                + `(${String(attempt)}/${String(MODAL_RETRY_ATTEMPTS)})…`,
            );
            await new Promise((resolve) => setTimeout(resolve, MODAL_RETRY_DELAY_MS));
        }
    }
}

async function resolveScriptPath(args?: DebugScriptArgs): Promise<string | undefined> {
    if (args?.script) {
        const scriptPath = path.normalize(args.script);
        if (!fs.existsSync(scriptPath)) {
            void vscode.window.showErrorMessage(`UXP: Script not found: ${scriptPath}`);
            return undefined;
        }
        return scriptPath;
    }

    const editor = vscode.window.activeTextEditor;
    if (editor?.document.uri.scheme !== "file") {
        void vscode.window.showErrorMessage(
            "UXP: Open a UXP script file (.ccjs / .psjs / .idjs / .ts) in the editor first.",
        );
        return undefined;
    }
    if (editor.document.isDirty) {
        await editor.document.save();
    }
    return editor.document.uri.fsPath;
}

async function pickScriptTargetApp(
    service: UxpService,
    extension: string,
    appIdFilter?: string,
    promptToRetry = true,
): Promise<ConnectedApp | undefined> {
    const allowedIds = SCRIPT_EXTENSION_APPS[extension];

    const filterApps = (): ConnectedApp[] => {
        let apps = service.connectedApps.filter(
            (app) => !allowedIds || allowedIds.includes(app.info.appId),
        );
        if (appIdFilter) {
            apps = apps.filter((app) => app.info.appId === appIdFilter);
        }
        return apps;
    };

    for (;;) {
        let apps = filterApps();
        if (apps.length === 0) {
            // The host app may already be running but not yet connected (e.g. it
            // was launched before the broker started) — give it a chance without
            // requiring the user to run "Load Plugin" first.
            await service.waitForHostApps(() => filterApps().length > 0);
            apps = filterApps();
        }

        if (apps.length === 0) {
            const required = appIdFilter ? [appIdFilter] : allowedIds ?? ["any UXP host app"];
            if (!promptToRetry) {
                showHostAppNotRunningError(required);
                return undefined;
            }
            if (await hostAppNotRunningDialog(required)) {
                continue;
            }
            return undefined;
        }

        // Capability gate (App/info supportedFeatures) with an escape hatch for
        // hosts that support runScript without reporting it.
        const supporting = apps.filter(
            (app) => app.info.supportedFeatures?.debugScripts === true,
        );
        let candidates = supporting;
        if (supporting.length === 0) {
            const tryAnyway = "Try anyway";
            const choice = await vscode.window.showWarningMessage(
                "UXP: None of the connected applications report script-debugging support "
                + "(requires a recent UXP runtime).",
                tryAnyway,
            );
            if (choice !== tryAnyway) {
                return undefined;
            }
            candidates = apps;
        }

        return pickApp(candidates, "Debug UXP Script");
    }
}

/**
 * Resolve `userArgs`: from the launch config when given, otherwise via an
 * InputBox using UDT's contents-of-array syntax (`2, "text", true`), with the
 * last value remembered per script file. Returns `undefined` on cancel.
 */
async function resolveUserArgs(
    context: vscode.ExtensionContext,
    scriptPath: string,
    args?: DebugScriptArgs,
): Promise<unknown[] | undefined> {
    if (args && "userArgs" in args && args.userArgs !== undefined) {
        return normalizeUserArgs(args.userArgs);
    }

    const stateKey = `${ARGS_STATE_KEY_PREFIX}${scriptPath}`;
    const remembered = context.workspaceState.get<string>(stateKey, "");

    const text = await vscode.window.showInputBox({
        title: "Script arguments (optional)",
        prompt: "JSON values, comma separated — e.g. 2, \"text\", true. Leave empty for none.",
        value: remembered,
        validateInput: (value) => (parseArgsText(value) === undefined ? "Not valid JSON values." : undefined),
    });
    if (text === undefined) {
        return undefined; // Esc
    }

    const parsed = parseArgsText(text);
    if (parsed === undefined) {
        return undefined;
    }
    await context.workspaceState.update(stateKey, text);
    return parsed;
}

// Re-exported so existing importers keep working — the implementation now
// lives in src/core/protocol/messages.ts (vscode-free, unit-tested there).
export { parseArgsText };
