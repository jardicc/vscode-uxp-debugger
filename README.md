# UXP Debugger – VS Code Extension

Load, reload and debug **Adobe UXP plugins and scripts** (Photoshop, InDesign, Premiere Pro) directly from VS Code — with full source-map support and **no Adobe UXP Developer Tools (UDT) required**.

The extension hosts its own UDT-compatible service broker inside VS Code and announces it to Adobe applications over Vulcan IPC. Host applications connect straight to VS Code, which then loads your plugin and tunnels the Chrome DevTools Protocol to the built-in JS debugger.

---

## Requirements

- **VS Code** 1.99 or newer (desktop; Windows x64, macOS x64, or macOS Apple silicon)
- An Adobe host application with UXP support: **Photoshop 23.2+**, **InDesign 18.5+**, or **Premiere Pro 25.6+**
- **Adobe UXP Developer Tools app is NOT needed** — close it if it is running (it occupies port 14001)
- Administrator rights once, to enable Adobe's machine-global developer mode (see below)

---

## Getting started

1. **Install the extension** from the VS Code Marketplace (search for **UXP Debugger**).
2. **Open your plugin project** and open its `manifest.json` in the editor.
3. Open the **UXP Devtools** panel (Activity Bar) and use **Add Plugin**
   (or **Add active manifest**, using the file open in the editor).
4. **Start your Adobe application** (e.g. Photoshop).
5. Run **`UXP: Load Plugin`**.
   - On first use the extension checks the machine-global **developer mode** flag. If it is missing you get a consent dialog followed by an OS elevation prompt (it writes `{"developer": true}` to Adobe's `settings.json` — same as UDT does).
   - The broker starts on port `14001`, announces itself, the host app connects and your plugin loads.
6. Click **Debug** for the plugin in the UXP Devtools panel and set breakpoints.

> Tip: clicking **Debug** for an unloaded plugin offers **"Load and attach"** — steps 5 and 6 in one go.

---

## Control panel (sidebar)

The **UXP Devtools** icon in the Activity Bar opens a sidebar panel — the UDT-style
home for day-to-day app launch, plugin and script registration, lifecycle actions,
debugging, inspection, Watch, and packaging. Its global registry is independent of the
current workspace, and every Command Palette entry below remains available. See
[Control Panel](docs/CONTROL-PANEL.md) for the complete behavior and
[App Discovery and Launch](docs/APP-DISCOVERY.md) for host status and startup.

## GitHub Copilot and agent tools

The extension contributes VS Code language-model tools so compatible agents can discover,
operate, and inspect UXP development sessions. Start with `uxp_get_debug_state`; see
[Language Model Tools](docs/LANGUAGE-MODEL-TOOLS.md) for the complete tool reference,
confirmation policy, and workflows.

## Build-tool hooks

Build pipelines can trigger load, unload, refresh, full reload, watch, and pack operations
through localhost HTTP hooks on the broker's existing port. See
[Build-Tool REST Hooks](docs/BUILD-TOOL-HOOKS.md) for endpoints and examples.

## Documentation

- [Architecture and implementation record](docs/UXP-DEBUGGER-ARCHITECTURE.md) — system
  boundaries, protocol, decisions, measured evidence, constraints, and error model.
- [App discovery and launch](docs/APP-DISCOVERY.md) — startup, Developer Mode, broker
  states, installation detection, and manual host launch.
- [Control panel](docs/CONTROL-PANEL.md) — sidebar UI, registry, actions, Watch, persistence,
  webview protocol, and tests.
- [Break on start](docs/BREAK-ON-START.md) — debugger handshake, script timing limits,
  diagnostics, and rejected approaches.
- [HTML/CSS inspector](docs/UI-DEBUGGING.md) — DevTools frontend, CDP multiplexing, safety,
  and lifecycle.
- [Multi-window takeover](docs/MULTI-WINDOW-TAKEOVER.md) — exclusive broker ownership and
  handoff protocol.
- [Build-tool REST hooks](docs/BUILD-TOOL-HOOKS.md) and
  [Language Model Tools](docs/LANGUAGE-MODEL-TOOLS.md) — external build and agent entry points.

---

## Commands

| Command | What it does |
| --- | --- |
| `UXP: Load Plugin` | Validates and loads a registered plugin into one selected compatible app |
| `UXP: Load Plugin (Break on Start)` | Loads a plugin and pauses it until the debugger attaches |
| `UXP: Unload Plugin` | Unloads a live plugin session |
| `UXP: Reload Plugin` | Reloads a live session (an attached debugger survives the reload) |
| `UXP: Inspect Plugin UI (HTML/CSS)` | Opens the DevTools Elements panel (DOM + CSS) for a live plugin session |
| `UXP: Debug Current Script` | Runs + debugs the `.ccjs` / `.psjs` / `.idjs` / `.js` / `.ts` file in the active editor |
| `UXP: Pack Plugin…` | Packages a registered plugin as a `.ccx` archive |
| `UXP: Enable Developer Mode` | Writes Adobe's developer-mode flag (consent + elevation) |
| `UXP: Configure launch.json` | Creates or updates UXP debug configurations |
| `UXP: Start UXP Devtools` | Starts the built-in broker |
| `UXP: Stop UXP Devtools` | Stops the built-in broker |
| `UXP: Enable Compact View` | Switches the panel to its compact layout |
| `UXP: Disable Compact View` | Restores the full panel layout |

---

## launch.json (optional)

Attach to a plugin with **F5**:

```json
{
  "type": "uxp",
  "request": "attach",
  "name": "Attach to UXP Plugin",
  "manifestPath": "${workspaceFolder}/manifest.json"
}
```

Run + debug a script:

```json
{
  "type": "uxp-script",
  "request": "launch",
  "name": "Debug UXP Script",
  "script": "${file}",
  "app": "PS",
  "userArgs": [1920, 1080, { "keepRatio": true }]
}
```

`app` is optional and restricts execution to one host app id (`PS`, `ID`, `premierepro`);
without it you are asked to pick when several compatible apps are connected.
Use `UXP: Configure launch.json` to generate these entries.

## Settings

| Setting | Description |
| --- | --- |
| `uxp.manifests` | Workspace-relative paths to plugin `manifest.json` files. Kept in sync with the plugin list in the UXP Devtools panel, so a project can ship its plugin registration in `.vscode/settings.json`. |

---

## Script debugging notes

Supported extensions are `.ccjs`, `.psjs`, `.idjs`, `.js`, and `.ts`. Script arguments are
comma-separated JSON values or `userArgs` in `launch.json`. The panel workflow and `.ts`
type-erasure limits are documented in [Control Panel](docs/CONTROL-PANEL.md#4-scripts-section);
the short-script attach race and workaround are documented in
[Break on start](docs/BREAK-ON-START.md#command-level-flow-context).

## Source maps & breakpoints

Breakpoints in your original TypeScript/JavaScript sources work out of the box:

- Your bundler must emit source maps — either **inline** (webpack: `devtool: "inline-source-map"`) or as an **external `.map` file** referenced via `//# sourceMappingURL=`.
- The extension's CDP proxy rewrites the map's `sourceRoot` to your local plugin directory so relative `sources` entries resolve to real files; for external `.map` files, it reads them straight off disk (next to the script) and inlines the result.

## HTML/CSS inspector

`UXP: Inspect Plugin UI (HTML/CSS)` opens the bundled Chrome DevTools **Elements** panel
for a live plugin session. See [HTML/CSS Inspector](docs/UI-DEBUGGING.md) for capabilities,
limitations, CDP routing, lifecycle, and maintenance.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| _"Port 14001 is already in use"_ | Adobe UXP Developer Tools (or an old `uxp service`) is running | Close it and hit **Retry** |
| `"<App> is not running or not connected"` | Host app not started, or connected before the broker existed | Start (or restart) the app, wait a few seconds, **Retry** |
| _"Developer mode could not be enabled"_ | Elevation prompt declined | Run `UXP: Enable Developer Mode` again and accept the prompt |
| _"Plugin load timed out"_ | Host app busy or showing a modal dialog | Dismiss dialogs in the app and **Retry** |
| _"…is a sandboxed host application"_ | UWP-style host (not supported yet) | Use a non-sandboxed host app |
| Breakpoints not binding | No source maps, or the external `.map` file isn't next to its script on disk | Enable source maps in your bundler (`devtool: "inline-source-map"` or equivalent) |
| _"None of the connected applications report script-debugging support"_ | Older UXP runtime | Update the host app, or use **Try anyway** |

The **UXP Debugger** output channel contains detailed diagnostics; each host app also gets its own `UXP – <App> <version>` log channel.

## Feedback & issues

Source code, bug reports and feature requests:
[github.com/jardicc/vscode-uxp-debugger](https://github.com/jardicc/vscode-uxp-debugger)
([issues](https://github.com/jardicc/vscode-uxp-debugger/issues)). When reporting a problem,
please attach the relevant part of the **UXP Debugger** output channel.

---

## How it works

1. **Developer mode** — host apps only join dev workflows when Adobe's machine-global `settings.json` contains `{"developer": true}` (one-time elevated write, with your consent).
2. **Broker** — the extension runs a WebSocket server on `127.0.0.1:14001` speaking the UXP DevTools wire protocol and announces it via the **Adobe Vulcan IPC** native library (shipped per platform). Running Adobe apps connect within about a second.
3. **Plugin sessions** — local manifest validation followed by `Plugin/load` creates a session; reload/unload operate on it. Scripts use `Plugin/runScript` and behave like short-lived plugin sessions.
4. **Debugging** — a lightweight CDP proxy bridges VS Code's built-in JS debugger (`pwa-node` attach) to the broker's `/socket/cdt/<session>` endpoint, translating UXP protocol quirks (source-map roots, `Runtime.evaluate` contexts, `NodeWorker.enable`, reload grace periods).

## Project structure

```text
src/
  core/                    Pure Node (no vscode imports) — unit-tested
    protocol/              Wire-protocol types, frame builders, type guards
    broker/                WS broker, app connections, sessions, CDT tunnel
    vulcan/                Native Vulcan addon loading, port announcer, host-app catalog
    devmode/               Developer-mode flag detection
    manifest/              Manifest parsing + app matching
    pack/                  .ccx packaging
    stripTypeScript.ts     Type erasure for .ts scripts (ts-blank-space)
  vscode/                  VS Code layer
    UxpService.ts          Facade: broker lifecycle + fan-out operations
    commands/              One module per command
    debug/                 Debug config providers + session manager
    hooks/                 Local HTTP hooks for build-tool integration
    inspector/             Bundled Chrome DevTools Elements panel
    panel/                 Control-panel sidebar (React webview + controller)
    proxy/                 CDP proxy (transport, message rewriting, source maps)
    tools/                 Language-model tools for agent-driven workflows
    ui/                    Dialogs, pickers, output channels
native/                    Vulcan prebuilds per platform (generated: npm run prepare-native)
devtools-frontend-dist/    Bundled Chrome DevTools frontend for the HTML/CSS inspector
scripts/                   Build helpers (native prebuilds, DevTools bundle, per-platform VSIX)
test/                      vitest suite incl. a scripted fake host app
e2e/                       Real-VS Code harness (@vscode/test-electron), optional live Photoshop
docs/                      Architecture and feature documentation
```

## Development

```bash
npm install
npm run prepare-native   # extract Vulcan prebuilds into native/
npm test                 # vitest unit/integration suite (no Adobe app needed)
npm run typecheck        # TypeScript checks without emitting
npm run lint             # ESLint for src/, test/, and e2e/
npm run compile          # esbuild bundle (extension, panel, inspector, DevTools frontend)
npm run test:e2e         # real VS Code instance; set UXP_E2E_PHOTOSHOP=1 for live Photoshop tests
npm run build            # per-platform VSIX packages (win32-x64, darwin-x64, darwin-arm64)
```

## License

[MIT](LICENSE.md). Third-party components and their licenses are listed in
[ThirdPartyNotices.txt](ThirdPartyNotices.txt).
