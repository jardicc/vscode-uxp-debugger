# UXP Debugger – VS Code Extension

Attach the VS Code debugger to Adobe UXP plugins (Photoshop, InDesign, XD, …) with full source-map support.

---

## Requirements

- **VS Code** 1.85 or newer
- **Adobe UXP Developer Tools (UDT)** installed
- Some Adobe application to load UXP plugin into
- The UXP plugin loaded in the host application (via UDT)

---

## Setup

### 1. Install the extension

Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=JaroslavBereza.uxpdebugger), or search for **UXP Debugger** in the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`).

### 2. Patch the UXP Developer Tools (one-time)

The extension discovers running plugin sessions via a `.uxprc` file that UDT writes next to your `manifest.json`. By default UDT does **not** write this file — a one-time patch to `app.asar` enables it. This file is in protected folder so we will use little trick to go around that.

1. Make sure to quit UDT if it is running.
2. On both Windows & MacOS you need to patch file `app.asar`. So go to the UDT location
   - **Windows:** `C:\Program Files\Adobe\Adobe UXP Developer Tools\resources`
   - **macOS:** `/Applications/Adobe UXP Developer Tools/Contents/Resources`
3. Move `app.asar` file to your desktop using Explorer/Finder
4. Most likely OS will ask you elevate permissions to do that so confirm the dialog
5. Open the Command Palette in VSCode (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:
   **`UXP: Patch app.asar (Persist .uxprc)`**
7. Select `app.asar` in your desktop directory and wait for patcher to finish
8. Now you should see `app.asar` (patched) and `app.asar.bak` (original file for backup reasons) on your desktop
9. Move both files back into original location (OS will ask again for permission)
   - **Windows:** `C:\Program Files\Adobe\Adobe UXP Developer Tools\resources`
   - **macOS:** `/Applications/Adobe UXP Developer Tools/Contents/Resources`

The patch is **idempotent** — safe to run multiple times. A `.bak` backup is created on the first run.

After patching, restart the UXP Developer Tools application.

#### Troubleshooting

If something goes wrong with UDT delete `app.asar` and rename `app.asar.bak` to `app.asar` so original file will be restored. If there are still issues 
please uninstall with Creative Cloud Desktop app. Check the UDT directory for remaining files and remove them if any. Then install UDT again.

#### Alternative Method. Load the plugin via UDT CLI (for experts)
<details>
<summary>Show details</summary>

Use the `uxp` CLI (not included with UDT) to load your plugin into the host app. This generates the `.uxprc` session file that the debugger reads.

Run in first terminal
```bash
uxp service start
```

And in second terminal
```bash
uxp plugin load
```

Run this from your plugin directory (where `manifest.json` is). The `.uxprc` file will appear next to `manifest.json` after the plugin is loaded.

This option is not very ergonomic. Has several disadvantages and I recommend it only for experts if there are special requirements.
</details>

---

## Attaching the Debugger

### Option A — Command Palette

1. Make sure the host application (e.g. Photoshop) is running with your plugin loaded.
2. Open the Command Palette and run **`UXP: Attach to Adobe UXP Plugin`**.
3. **First time:** choose **"Select new target…"** and pick your `manifest.json`.
4. **Subsequent runs:** your recent targets appear in the list — just pick one.
5. If multiple debug targets are found, a second pick list lets you select the right one.
6. The debug session starts automatically.

The extension remembers up to **20** recently used targets, sorted by last use. Entries whose `manifest.json` has been deleted are removed automatically.

### Option B — `launch.json`

Add a configuration to `.vscode/launch.json`:

```json
{
  "configurations": [
    {
      "type": "uxp",
      "request": "attach",
      "name": "Attach to UXP Plugin",
      "manifestPath": "${workspaceFolder}/manifest.json"
    }
  ]
}
```

Press **F5** (or choose the configuration from the Run & Debug panel). VS Code substitutes `${workspaceFolder}` and other variables before passing the path to the extension.

### Option C — `.debug.json` (fixed port) - not recommended
<details>
<summary>Show details</summary>
If you prefer not to use the UDT relay, you can pin a fixed CDP debug port by placing manually a `.debug.json` file next to `manifest.json`:

```json
{ "port": 9917 }
```

The extension will probe that port directly via `/json/list` instead of using the UDT relay. Both methods can coexist.

This will work only in older versions of host apps.
</details>

---

## Source Maps & Breakpoints

The extension has built-in support for source maps, so breakpoints set in your original TypeScript (or other) source files work out of the box — no extra configuration needed in most cases.

### How it works

UXP plugins typically serve bundled JavaScript files with **inline source maps** (embedded as a `data:application/json;base64,…` URL at the end of the file). The extension's CDP proxy intercepts these maps and rewrites their `sourceRoot` to point at your local plugin directory before passing them to VS Code's JS debugger. This lets the debugger resolve relative `sources` entries (e.g. `../src/index.ts`) back to real files on disk.

### Requirements for breakpoints to work

- Your bundler must **emit source maps**. For webpack, set `devtool: "inline-source-map"` (or any other inline variant). External `.map` files are **not** supported — the map must be embedded in the JS file itself.
- The `sources` paths inside the map must be relative and resolve correctly from your output directory. Standard webpack/esbuild defaults work without changes.

### Breakpoints in practice

1. Set a breakpoint in any source file (TypeScript, JavaScript, etc.) in VS Code.
2. Attach the debugger as usual.
3. Trigger the code path in the host application — VS Code will pause at the correct source line.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| _"No running UXP targets found"_ | Plugin not loaded, or wrong `manifest.json` | Start UDT, load plugin and make sure the host app is open |
| _"Connected to the relay but no response from the plugin"_ — session disconnects after 8 s | Plugin load succeeded but the UXP runtime never sent a ready signal | Unload the plugin and load again via "Load button" in UDT and try again |
| _"manifest.json not found"_ | Path in `launch.json` is wrong | Check the `manifestPath` value; make sure `${workspaceFolder}` resolves to the right folder |
| _"A UXP debug session is already active"_ | Tried to attach while already debugging | Click **Detach and reconnect** to replace the existing session, or cancel |
| _"Failed to start the JS debug session"_ | Internal `pwa-node` attach error | Check the **UXP Debugger** output channel for details |
| _"Permission denied"_ during patch | `app.asar` owned by another user | Follow patching instructions above |
| `.uxprc` not created after plugin load | `app.asar` not yet patched | Follow patching instructions above |

---

## How It Works

The extension does **not** implement a custom debug adapter. Instead it:

1. **Discovers** running targets via two methods:
   - **`.uxprc`** — reads the UDT session file and connects via `ws://127.0.0.1:14001/socket/cdt/<sessionId>`
   - **`.debug.json`** — reads a pinned port and probes `http://127.0.0.1:<port>/json/list`
2. **Starts a lightweight CDP proxy** between VS Code and the UXP endpoint, translating protocol quirks (source-map root rewriting, `Runtime.evaluate` context patching, `NodeWorker.enable` suppression).
3. **Delegates** to the built-in VS Code JS debugger (`pwa-node` attach mode) which handles all actual protocol work.

---

## Project Structure

```
src/
  extension.ts                      Entry point; registers commands and debug provider
  debugConfigProvider.ts            Handles launch.json "uxp" type; substitutes variables
  cdpProxy.ts                       CDP proxy (WebSocket + HTTP); message rewriting
  uiHelpers.ts                      pickTarget() QuickPick
  constants.ts / types.d.ts         Shared constants and types
  patch-asar.ts                     ASAR patch logic (idempotent, streaming)
  commands/
    attach.ts                       Main attach flow + target history
    patchAsar.ts                    Patch command UI
    setManifestPath.ts              Manifest path picker
  endpointDetection/
    discoverViaDebugJson.ts         .debug.json → /json/list probe
    discoverViaUxpRc.ts             .uxprc → UDT relay WebSocket
```

---

## License

[MIT](LICENSE.md)
