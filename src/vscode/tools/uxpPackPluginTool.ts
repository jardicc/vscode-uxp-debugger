import * as path from "path";
import type * as vscode from "vscode";
import { packPluginFolder, resolveHostOverride, validateManifestForPack } from "../../core/pack/packPlugin";
import { textResult } from "./toolResult";

interface PackPluginInput {
    manifestPath: string;
    outputPath: string;
    /** Which `manifest.json` host app to target, only needed when it lists more than one (dev-only array). */
    host?: string;
}

/**
 * `uxp_pack_plugin` (LANGUAGE-MODEL-TOOLS.md §3) — zips the plugin folder into a
 * `.ccx` archive after validating `manifest.json`. Writes a file, so it
 * always requires confirmation (see `prepareInvocation`).
 */
export class UxpPackPluginTool implements vscode.LanguageModelTool<PackPluginInput> {
    prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<PackPluginInput>,
    ): vscode.PreparedToolInvocation {
        const { outputPath } = options.input;
        return {
            invocationMessage: `Packing the plugin to ${outputPath}…`,
            confirmationMessages: {
                title: "Pack UXP Plugin",
                message: `This writes a new \`.ccx\` archive to \`${outputPath}\`, overwriting it if it already exists.`,
            },
        };
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<PackPluginInput>,
    ): Promise<vscode.LanguageModelToolResult> {
        const { manifestPath, outputPath, host } = options.input;

        let parsed;
        try {
            parsed = validateManifestForPack(manifestPath);
        }
        catch (err) {
            return textResult(err instanceof Error ? err.message : String(err));
        }

        let manifestOverride: string | undefined;
        try {
            manifestOverride = resolveHostOverride(parsed, host);
        }
        catch (err) {
            return textResult(err instanceof Error ? err.message : String(err));
        }

        try {
            packPluginFolder(path.dirname(manifestPath), outputPath, manifestOverride);
        }
        catch (err) {
            return textResult(`Failed to write the archive: ${err instanceof Error ? err.message : String(err)}`);
        }

        return textResult(`Packed "${parsed.manifest.name}" to ${outputPath}.`);
    }
}
