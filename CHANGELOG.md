# Changelog

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
