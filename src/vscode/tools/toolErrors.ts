import { HostAppNotRunningError, MultipleAppsMatchError, RequestTimeoutError } from "../../core/errors";

/**
 * Turns the known `UxpService.loadPlugin` error types into an actionable
 * message for an LM tool caller — no retry loops or interactive dialogs
 * (LANGUAGE-MODEL-TOOLS.md §7.4), just a single attempt plus enough detail for the
 * model to retry with the right input.
 */
export function describeLoadError(err: unknown): string {
    if (err instanceof MultipleAppsMatchError) {
        const options = err.candidates
            .map((c) => `${c.info.appId} (${c.info.appName} ${c.info.appVersion})`)
            .join(", ");
        return `Multiple connected apps match this plugin: ${options}. Specify "appId" and retry.`;
    }
    if (err instanceof HostAppNotRunningError) {
        return `No connected app matches this plugin. Required: ${err.requiredApps.join(", ")}. Start the app and retry.`;
    }
    if (err instanceof RequestTimeoutError) {
        return `${err.message} You can retry the tool call once the host app is responsive again.`;
    }
    return err instanceof Error ? err.message : String(err);
}
