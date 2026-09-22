/**
 * Typed error hierarchy for the core layer. The VS Code layer maps these
 * onto user-facing dialogs (see the error-handling matrix in
 * UXP-DEBUGGER-ARCHITECTURE.md §8.8) — core code never touches UI.
 */

import type { ConnectedApp } from "./broker/UxpBroker";

/** Base class so callers can `instanceof UxpError` for any core failure. */
export class UxpError extends Error {
    constructor(message: string) {
        super(message);
        this.name = new.target.name;
    }
}

/** The broker port is already occupied (most likely by Adobe's UDT app). */
export class PortInUseError extends UxpError {
    constructor(public readonly port: number) {
        super(`Port ${String(port)} is already in use. If Adobe UXP Developer Tools is running, try closing it first.`);
    }
}

/** A request to the host app did not receive a reply within its timeout. */
export class RequestTimeoutError extends UxpError {
    constructor(
        public readonly operation: string,
        public readonly timeoutMs: number,
    ) {
        super(
            `${operation} timed out after ${String(timeoutMs)} ms. `
            + "Check whether the host application is busy or showing a modal dialog.",
        );
    }
}

/** The host app answered a request with an `error` field. */
export class HostReplyError extends UxpError {
    constructor(
        public readonly operation: string,
        public readonly hostError: string,
    ) {
        super(`${operation} failed: ${hostError}`);
    }
}

/** Host-side `Plugin/validate` returned `success: false`. */
export class ValidationRejectedError extends UxpError {
    constructor(public readonly hostErrorMessage: string) {
        super(`The host application rejected the plugin manifest: ${hostErrorMessage}`);
    }
}

/** No connected host app matches the plugin's `manifest.host` entries. */
export class HostAppNotRunningError extends UxpError {
    constructor(public readonly requiredApps: string[]) {
        super(
            `No connected host application matches this plugin. Required: ${requiredApps.join(", ")}. `
            + "Start the application and retry.",
        );
    }
}

/**
 * More than one connected app matches the plugin's `manifest.host` entries
 * and the caller did not pin a target app — load into exactly one at a time
 * instead of silently fanning out to all of them; the caller must ask the
 * user which one.
 */
export class MultipleAppsMatchError extends UxpError {
    constructor(public readonly candidates: ConnectedApp[]) {
        super(
            `Multiple connected apps match this plugin: `
            + `${candidates.map((a) => a.info.appName).join(", ")}. Pick one to load into.`,
        );
    }
}

/** Local `manifest.json` parsing / pre-validation failed. */
export class ManifestValidationError extends UxpError {
    constructor(
        public readonly manifestPath: string,
        public readonly issues: string[],
    ) {
        super(`Invalid manifest at ${manifestPath}: ${issues.join("; ")}`);
    }
}

/** The referenced app connection / session no longer exists. */
export class SessionNotFoundError extends UxpError {
    constructor(public readonly sessionId: string) {
        super(`Plugin session "${sessionId}" no longer exists (was it unloaded?).`);
    }
}

/** Plugin commands were attempted against a sandboxed (UWP) host — unsupported in v1. */
export class SandboxedHostError extends UxpError {
    constructor(public readonly appName: string) {
        super(`${appName} is a sandboxed host application, which is not supported yet.`);
    }
}

/** The native Vulcan addon could not be loaded on this platform. */
export class NativeAddonUnavailableError extends UxpError {
    constructor(public readonly reason: string) {
        super(`The Adobe Vulcan native library is unavailable: ${reason}`);
    }
}

/** A `.ts` script uses syntax that can't be stripped to `.js` without a real TypeScript build. */
export class NonErasableTypeScriptError extends UxpError {
    constructor(
        public readonly tsPath: string,
        public readonly issues: string[],
    ) {
        super(
            `Cannot debug "${tsPath}" by stripping types alone — it uses TypeScript syntax that has `
            + `runtime semantics (enum with values, parameter properties, namespace with code, legacy `
            + `decorators, ...) and can't be safely erased:\n${issues.join("\n")}\n`
            + "Compile it with a real TypeScript build (tsc/esbuild) and debug the resulting .js instead.",
        );
    }
}
