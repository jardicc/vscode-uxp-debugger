/**
 * Single source of truth for standalone UXP script file types.
 *
 * - Universal extensions run in any UXP host (listed here).
 * - Host-specific extensions (`.psjs`, `.idjs`, …) are declared on the host
 *   app itself (`HostAppDescriptor.scriptExtensions` in `vulcan/hostAppCatalog.ts`)
 *   and derived here — adding a host or extension is a one-line catalog change.
 *
 * Pure and vscode-free so every consumer (command, panel, tools) shares
 * one unit-tested implementation. `package.json` contributes (`when` clauses,
 * launch schema) can't import this; `test/core/scriptCatalog.test.ts` keeps
 * them in sync.
 */

import { HOST_APPS, type HostAppDescriptor } from "./vulcan/hostAppCatalog";

/** Extensions runnable in any UXP host app. */
const UNIVERSAL_SCRIPT_EXTENSIONS: readonly string[] = [".js", ".ts", ".ccjs"];

/** Extensions whose sources need type stripping before they can be run (see `stripTypeScript.ts`). */
const TYPESCRIPT_EXTENSIONS: readonly string[] = [".ts"];

/** Extension → host apps it is restricted to, derived from the host catalog. */
function hostsByExtension(apps: readonly HostAppDescriptor[]): Map<string, HostAppDescriptor[]> {
    const map = new Map<string, HostAppDescriptor[]>();
    for (const app of apps) {
        for (const ext of app.scriptExtensions ?? []) {
            map.set(ext, [...(map.get(ext) ?? []), app]);
        }
    }
    return map;
}

const HOST_SCRIPT_HOSTS = hostsByExtension(HOST_APPS);

/** Host-specific extensions (e.g. `.psjs`, `.idjs`). */
const HOST_SCRIPT_EXTENSIONS: readonly string[] = [...HOST_SCRIPT_HOSTS.keys()];

/** Every supported script extension (lowercase, with the dot). */
export const SCRIPT_EXTENSIONS: readonly string[] = [
    ...UNIVERSAL_SCRIPT_EXTENSIONS,
    ...HOST_SCRIPT_EXTENSIONS,
];

/** Lowercase extension of `filePath` including the dot (`""` when none). Browser-safe (no `path`). */
export function scriptExtensionOf(filePath: string): string {
    const name = filePath.slice(Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")) + 1);
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

export function isScriptExtension(extension: string): boolean {
    return SCRIPT_EXTENSIONS.includes(extension.toLowerCase());
}

export function isScriptPath(filePath: string): boolean {
    return isScriptExtension(scriptExtensionOf(filePath));
}

export function isTypeScriptExtension(extension: string): boolean {
    return TYPESCRIPT_EXTENSIONS.includes(extension.toLowerCase());
}

/**
 * Catalog ids of the hosts `extension` is restricted to (for display and
 * running-app lookups), or `undefined` when it runs anywhere.
 */
export function scriptHostAppIds(extension: string): string[] | undefined {
    const hosts = HOST_SCRIPT_HOSTS.get(extension.toLowerCase());
    return hosts?.map((app) => app.value);
}

/** Whether a host reporting `appId` may run a script with `extension`. */
export function isAppAllowedForScript(extension: string, appId: string): boolean {
    const hosts = HOST_SCRIPT_HOSTS.get(extension.toLowerCase());
    if (!hosts) {
        return true;
    }
    const wanted = appId.toLowerCase();
    return hosts.some((app) =>
        [app.value, ...(app.appIdAliases ?? [])].some((id) => id.toLowerCase() === wanted),
    );
}

/** Implied host badge for a script path (`"ANY"` when unrestricted). */
export function scriptHostBadge(filePath: string): string {
    const hosts = HOST_SCRIPT_HOSTS.get(scriptExtensionOf(filePath));
    return hosts?.[0]?.uiCode ?? "ANY";
}

/** `showOpenDialog` filter extensions (no dots). */
export function scriptDialogExtensions(): string[] {
    return SCRIPT_EXTENSIONS.map((ext) => ext.slice(1));
}

/** e.g. `.ccjs / .psjs / .idjs / .js / .ts` — for user-facing messages. */
export function scriptExtensionsLabel(): string {
    return SCRIPT_EXTENSIONS.join(" / ");
}

/** Detailed list for "not a UXP script" errors, e.g. `.psjs (Photoshop)`. */
export function describeSupportedScripts(): string {
    return SCRIPT_EXTENSIONS.map((ext) => {
        const hosts = HOST_SCRIPT_HOSTS.get(ext);
        if (hosts) {
            return `${ext} (${hosts.map((app) => app.name).join(" / ")})`;
        }
        return isTypeScriptExtension(ext) ? `${ext} (stripped on the fly)` : ext;
    }).join(", ");
}
