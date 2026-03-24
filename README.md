# UXP Debugger – VS Code Extension

Attach the VS Code debugger to Adobe UXP plugins (Photoshop, InDesign, XD, …) without writing a full custom debug adapter.

## Architecture

This extension does **not** implement its own debug adapter. Instead it:

1. **Discovers** running UXP plugin targets by probing well-known CDP ports.
2. **Starts a lightweight CDP proxy** that translates UXP-specific quirks so that the standard Chrome DevTools Protocol flow works correctly.
3. **Delegates** to the built-in VS Code JS debugger (`pwa-chrome` attach mode) via `vscode.debug.startDebugging(…)`.

This approach is inspired by [expo/vscode-expo](https://github.com/expo/vscode-expo), [microsoft/vscode-cdp-proxy](https://github.com/nicolo-ribaudo/vscode-cdp-proxy), and [vscode-android-webview-debug](https://github.com/nicolo-ribaudo/nicolo-ribaudo.github.io).

## Quick Start

```bash
npm install
npm run compile
```

Then press **F5** to launch the Extension Development Host.

### Usage

1. Start an Adobe application (e.g. Photoshop) with a UXP plugin loaded.
2. Open the Command Palette and run **UXP: Attach to Adobe UXP Plugin**.
3. Select the target from the quick-pick list.
4. The built-in JS debugger session starts automatically.

Alternatively, add a `launch.json` entry:

```json
{
  "type": "uxp",
  "request": "attach",
  "name": "Attach to UXP Plugin",
  "webRoot": "${workspaceFolder}"
}
```

## Project Structure

```
src/
  extension.ts          – entry point, registers commands and providers
  uxpDiscovery.ts       – probes localhost ports for CDP target listings
  cdpProxy.ts           – WebSocket MITM proxy between js-debug and UXP
  debugConfigProvider.ts – DebugConfigurationProvider for "uxp" type
```

## Key Design Decisions

| Decision | Rationale |
|---|---|
| No custom debug adapter | The built-in JS debugger (`js-debug`) already speaks CDP. Reusing it avoids duplicating thousands of lines of protocol handling. |
| CDP proxy layer | UXP may not be 100 % Chrome-compatible. The proxy lets us patch messages without forking js-debug. |
| Public VS Code API only | We never import `ms-vscode.js-debug` internals — only call `vscode.debug.startDebugging()`. |

## License

MIT
