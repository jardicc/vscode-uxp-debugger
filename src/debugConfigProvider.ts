import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Debug Configuration Provider for the "uxp" debug type
// ---------------------------------------------------------------------------

/**
 * This provider is registered for the `uxp` debug type declared in
 * package.json.  It participates in two phases:
 *
 *  1. **provideDebugConfigurations** – called when the user opens the
 *     debug configuration dropdown and clicks "Add Configuration…".
 *     We return a sensible default snippet.
 *
 *  2. **resolveDebugConfiguration** – called before a "uxp" debug session
 *     starts.  This is where we intercept the config, perform UXP-specific
 *     setup (discovery, proxy start), and then *replace* the debug type
 *     with `pwa-chrome` so that the built-in JS debugger handles the
 *     actual protocol work.
 *
 * This follows the same pattern used by expo/vscode-expo and
 * mpotthoff/vscode-android-webview-debug.
 */
export class UxpDebugConfigProvider
  implements vscode.DebugConfigurationProvider
{
  private readonly log: vscode.OutputChannel;

  constructor(log: vscode.OutputChannel) {
    this.log = log;
  }

  // -----------------------------------------------------------------------
  // Phase 1 – Provide initial configurations
  // -----------------------------------------------------------------------

  provideDebugConfigurations(
    _folder: vscode.WorkspaceFolder | undefined,
    _token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration[]> {
    return [
      {
        type: "uxp",
        request: "attach",
        name: "Attach to UXP Plugin",
        host: "localhost",
        webRoot: "${workspaceFolder}",
      },
    ];
  }

  // -----------------------------------------------------------------------
  // Phase 2 – Resolve / transform configuration before launch
  // -----------------------------------------------------------------------

  /**
   * If the user triggers the "uxp" debug type via launch.json instead of
   * the uxp.attach command, we handle it here by delegating to the same
   * attach flow.
   *
   * We return `undefined` to cancel the original "uxp" session and instead
   * programmatically start a "pwa-chrome" session via vscode.debug API
   * (which happens inside the uxp.attach command).
   *
   * Alternatively, if you want fully transparent delegation, you can
   * mutate the config here:
   *   config.type = "pwa-chrome";
   *   config.port = <proxy port>;
   *   return config;
   *
   * For now we keep it simple and delegate to the command.
   */
  async resolveDebugConfiguration(
    _folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    _token?: vscode.CancellationToken
  ): Promise<vscode.DebugConfiguration | undefined> {
    // If the configuration is empty (user just pressed F5 with no config),
    // fill in sensible defaults.
    if (!config.type && !config.request && !config.name) {
      config.type = "uxp";
      config.request = "attach";
      config.name = "Attach to UXP Plugin";
    }

    this.log.appendLine(
      `Resolving UXP debug config: ${JSON.stringify(config)}`
    );

    // Trigger the uxp.attach command which handles discovery, proxy, and
    // starting the delegated debug session.
    await vscode.commands.executeCommand("uxp.attach");

    // Return undefined to cancel the original "uxp" session.
    // The real session was already started by the command above.
    return undefined;
  }
}
