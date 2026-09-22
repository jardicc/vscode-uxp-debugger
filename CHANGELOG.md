# Changelog

## [2.0.0]

### Changed

- **Control panel: flat plugin list** — the "project folder" grouping is gone; the panel
  now shows a single flat list of registered plugins. Add a plugin directly by picking its
  `manifest.json` or from the active editor. The previously-registered project/plugin list
  and script list are reset on upgrade. "Open project" is replaced by a per-plugin
  "Open folder…" action that offers every ancestor folder up to the nearest `.git` root.

### New Features

- **HTML/CSS inspector** — `UXP: Inspect Plugin UI (HTML/CSS)` opens the real
  Chrome DevTools Elements panel from the bundled DevTools frontend in a
  VS Code webview for any live plugin session: DOM tree, Styles/Computed
  panes, live CSS editing. Works standalone or alongside an attached
  debugger — both share one CDP connection to the host app and require no
  external network access.

## [1.0.0] – 2026-07-25

### Breaking: Adobe UXP Developer Tools (UDT) no longer required

The extension now hosts its own UDT-compatible service broker inside the VS Code
extension host and announces it to Adobe applications over Vulcan IPC. Host apps
(Photoshop, InDesign, …) connect directly to VS Code — no UDT app, no `uxp` CLI,
no `app.asar` patch, no `.uxprc` files.

### New Features

- **Built-in broker** on `127.0.0.1:14001` with the full UXP wire protocol
  (handshake, plugin sessions, CDT debug tunnel).
- **Load / Unload / Reload Plugin commands** (`UXP: Load Plugin`, …) — fan out to
  every applicable connected app, with per-app result reporting.
- **Global plugin registry** — the UXP Devtools panel stores registered plugin
  manifest paths across workspaces and windows.
- **Script debugging** — `UXP: Debug Current Script` runs and debugs the
  `.ccjs` / `.psjs` / `.idjs` file open in the editor, including script
  arguments (remembered per file) and a `uxp-script` launch.json type.
- **Load and attach** — attaching to a plugin without a live session offers to
  load it first.
- **Enable Developer Mode command** — detects the machine-global developer flag
  and writes it after an explicit consent dialog (OS elevation prompt).
- **Per-host-app log channels** — `UXP/log` events from each application stream
  into a dedicated output channel.
- **Auto-stop on unload** — when the plugin is unloaded in the host app (or the
  app quits), the debug session stops automatically.

### Removed

- `UXP: Patch app.asar` command and all `.uxprc` / `.debug.json` discovery
  (obsolete — the extension owns the sessions now).
- Target history picker (live sessions replace it).

### Internal

- Clean-room TypeScript broker (`src/core/**`, no `vscode` imports) with a
  58-test vitest suite driven by a scripted fake host app.
- Native Vulcan N-API prebuilds shipped per platform (win32-x64, darwin-x64,
  darwin-arm64) and loaded by absolute path.

## [0.2.0] – 2026-04-02

### New Features

- **Auto-reconnect after plugin reload** – the debugger now automatically reconnects when a plugin is reloaded inside the host application, so you no longer need to manually re-attach after every reload.
- **UDT service liveness check** – before reporting "no targets found", the extension now checks whether UXP Developer Tools is actually running on its service port (`14001`). If UDT is not reachable you get a clear, actionable error message; if it is running but no plugin is loaded you get a more specific warning.
- **Target history with quick-reconnect** – previously used debug targets are stored and shown in a Quick Pick list. Re-connect to a recent target in one click without browsing for `manifest.json` again.
- **Clear history option** – a "Clear history" entry in the target picker lets you wipe all saved targets at any time.
- **Message buffering during WebSocket connection** – CDP messages that arrive while the proxy is (re)connecting to the UXP target are buffered and flushed once the connection is ready, preventing lost messages at session start.
- **Progress reporting during `.asar` patching** – the "Patch app.asar" command now shows a VS Code progress notification with incremental status updates (parsing header, locating files, patching bundle, recomputing hashes, writing archive) so you can see exactly how far along the patch is.

### Improvements

- **Three distinct attach flows** – the attach command is now split into three clearly separated code paths:
  1. `launch.json` path (manifest provided automatically)
  2. History quick-reconnect
  3. File-picker flow (browse for a new `manifest.json`)
- **CDP proxy refactored into `src/proxy/`** – the proxy is split into focused modules:
  - `cdpProxy.ts` – WebSocket transport and reconnect logic
  - `cdpMessageRewriter.ts` – all CDP message translation / rewriting
  - `sourceMapRewriter.ts` – source-map URL normalisation
- **Execution-context reload grace period** – when the UXP runtime destroys and immediately recreates an execution context (e.g. on plugin reload), the proxy defers forwarding the destruction event to js-debug for up to 2 s, avoiding a false "session ended" in VS Code.
- **Internal CDP IDs are now positive integers** – UXP's `jsoncpp` deserialiser rejects negative `id` values; internal proxy messages now use IDs starting at `900 000`.
- **"No execution context" timeout** – if the plugin never signals a ready context within 8 s the proxy disconnects and shows a warning, rather than hanging silently.

### Documentation

- Revised step-by-step patching instructions with a simpler, OS-agnostic workaround (move the file to the desktop, patch it there, move it back).
- Added a **Troubleshooting** section header and collapsed the "Alternative CLI method" and "`.debug.json`" sections inside `<details>` blocks to reduce visual noise.
- Updated the troubleshooting table with UDT-centric guidance.

---

## [0.1.0] – initial release

- Initial support for attaching VS Code's built-in JS debugger to Adobe UXP plugins via a CDP proxy.
- `.uxprc` / `.debug.json` endpoint discovery.
- `app.asar` patcher to enable UDT session-file generation.
- DevTools (browser-based inspector) support.
