import * as fs from "fs";
import type * as vscode from "vscode";
import { ManifestValidationError } from "../../core/errors";
import { parseManifestContent } from "../../core/manifest/manifest";
import { textResult } from "./toolResult";

interface ValidateManifestInput {
    manifestPath: string;
}

/**
 * `uxp_validate_manifest` (LANGUAGE-MODEL-TOOLS.md §3) — lints a `manifest.json`
 * and returns human-readable errors. The host-side `Plugin/validate` remains
 * authoritative; this is for fast, local, actionable feedback.
 */
export class UxpValidateManifestTool implements vscode.LanguageModelTool<ValidateManifestInput> {
    // eslint-disable-next-line @typescript-eslint/require-await
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ValidateManifestInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const { manifestPath } = options.input;

        let content: string;
        try {
            content = fs.readFileSync(manifestPath, "utf-8");
        }
        catch (err) {
            return textResult(`Could not read "${manifestPath}": ${err instanceof Error ? err.message : String(err)}`);
        }

        try {
            const parsed = parseManifestContent(content, manifestPath);
            const hosts = parsed.hosts.map((h) => (h.minVersion ? `${h.app}@${h.minVersion}` : h.app)).join(", ");
            return textResult(
                "Manifest is valid.\n"
                + `id: ${parsed.manifest.id}\n`
                + `name: ${parsed.manifest.name}\n`
                + `version: ${parsed.manifest.version}\n`
                + `host apps: ${hosts}`,
            );
        }
        catch (err) {
            if (err instanceof ManifestValidationError) {
                return textResult(
                    `Manifest at "${manifestPath}" has ${String(err.issues.length)} problem(s):\n`
                    + err.issues.map((issue) => `- ${issue}`).join("\n"),
                );
            }
            throw err;
        }
    }
}
