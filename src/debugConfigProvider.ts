import * as vscode from "vscode";

export class UxpDebugConfigProvider implements vscode.DebugConfigurationProvider {
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

    // Return config so VS Code performs variable substitution before
    // calling resolveDebugConfigurationWithSubstitutedVariables.
    return config;
  }

  async resolveDebugConfigurationWithSubstitutedVariables(
    _folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    _token?: vscode.CancellationToken
  ): Promise<vscode.DebugConfiguration | undefined> {
    // manifestPath is now fully resolved by VS Code (e.g. ${workspaceFolder} → absolute path).
    const manifestPath: string | undefined = config.manifestPath;
    await vscode.commands.executeCommand("uxp.attach", manifestPath);

    // Return undefined to cancel the original "uxp" session.
    // The real session was already started by the command above.
    return undefined;
  }
}
