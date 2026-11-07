---
name: photoshop-crash-analysis
description: "Diagnose and analyze Adobe Photoshop and UXP crashes on Windows during debugging or live e2e tests. Use when: Photoshop crashes or disappears silently without a crash dialog, a live Photoshop e2e test fails with 'Host app disconnected' or 'app connection closed', DAP messages appear to continue after connection close, or you need to inspect UXPLogs, ROT47 LogTransport2CC AppCrash logs, RTTransfer SQLite databases, or libdynamic-napi.dll V8 crashes."
---

# Photoshop & UXP Crash Analysis on Windows

Use this skill to quickly determine **whether**, **when**, and **why** Adobe Photoshop crashed during a UXP debugging session or live e2e test run on Windows, and to distinguish genuine host crashes from post-disconnect DAP teardown noise.

---

## 1. Quick Start: Run the Bundled Diagnostic Script

Run [inspect-crash.py](./scripts/inspect-crash.py) first to collect all recent UXP logs, decoded ROT47 `LogTransport2CC` crash reports, `RTTransfer` SQLite records, and crash dumps in a single pass:

```powershell
python .github\skills\photoshop-crash-analysis\scripts\inspect-crash.py --hours 6 --tail 35
```

---

## 2. Where Crash & Log Artifacts Live on Windows

Photoshop (especially Photoshop Beta / embedded UXP) often vanishes **without** generating a Windows Event Log `Application Error` (Event ID 1000) or displaying the Adobe Crash Reporter dialog. Always check these locations in order:

| Artifact | Windows Path | Format & What to Look For |
| --- | --- | --- |
| **UXP Runtime Logs** | `%APPDATA%\Adobe\Adobe Photoshop*\Logs\UXPLogs_<YYYY-MM-DD_HH-MM-SS>_*.log` | Plain text. One file per Photoshop launch. If the file ends abruptly (e.g., right after `Waiting for the debugger to attach. Please open chrome://inspect...` with no `1st Party WebView is destroyed` shutdown lines), Photoshop died in-process at that timestamp. |
| **Adobe AppCrash Telemetry** | `%APPDATA%\Adobe\LogTransport2CC\Logs\**\ulog_HeadlightsCC_AppCrash_*.rdy` | **ROT47-encoded XML** (starts with `P-A$as...` / `k&D286s@4`). Created ~5–10 seconds after a silent crash. Decodes to `<UsageDoc>` containing `<DataRec name="ExitType" data="Crash" />` and `<DataRec name="CrashProductName" data="PHOTOSHOP BETA" />`. The filename embeds the crashed session UUID (matching the companion `ulog_CC_PHOTOSHOP*_<sessionId>_0.tmp` file). |
| **RTTransfer Crash DBs** | `%APPDATA%\Adobe\RTTransfer\Logs\CC_PHOTOSHOP*.db` and `RTCommon.db` | **SQLite** (`DataTable`). Stores the session UUID, product version, binary payload ending in `Crash`, and millisecond epoch timestamp (`1793...`). |
| **Launch Sentinel** | `%APPDATA%\Adobe\Adobe Photoshop*\Adobe Photoshop* Settings\LaunchEndFlag.psp` | Sentinel file updated by Photoshop on launch/shutdown; used by Adobe's background services to detect abnormal termination. |
| **NGL Client Logs** | `%TEMP%\NGL\NGLClient_Photoshop*.log` | Plain text. Useful for correlating exact `SessionID=<uuid>` and thread timestamps across launches. |
| **Adobe Crash Reporter XMLs** | `%APPDATA%\Adobe\CRLogs\`, `%LOCALAPPDATA%\CrashDumps\`, and repo [photoshop-e2e.xml](../../../docs/crashes/photoshop/photoshop-e2e.xml) | `<crashreport>` XML with `<backtrace>` and `<binaryImageSet>` when `CRClient.dll` manages to capture a stack trace before exit. |

### Decoding `LogTransport2CC` ROT47 Files Manually

Each printable ASCII character `c` (`33 <= ord(c) <= 126`) is shifted by `+14 (mod 94)` from `33`:

```python
def rot47(s: str) -> str:
    return "".join(chr(33 + ((ord(c) + 14) % 94)) if 33 <= ord(c) <= 126 else c for c in s)
```

---

## 3. Why Photoshop Disappears Silently (No Crash Dialog, No WER Event 1000)

1. **In-process V8 / N-API fatal check (`0x80000003` `EXCEPTION_BREAKPOINT`):**
   - Photoshop embeds V8 and Node N-API inside `adobe\libdynamic-napi.dll` and `adobe\dynamic-torqnative.dll` (see [photoshop-e2e.xml](../../../docs/crashes/photoshop/photoshop-e2e.xml)).
   - When an invalid state or race occurs in V8/N-API (typically a stack of `napi_unwrap` frames in `libdynamic-napi.dll`), V8 triggers a fatal check (`0x80000003`) or fast-fail abort.
2. **Intercepted exit & dialog suppression:**
   - Adobe's in-process handler (`CRClient.dll` / `LogSession.dll`) intercepts the termination or terminates the process immediately, so Windows Error Reporting does not record a standard `Application Error` (Event ID 1000).
   - If the process terminates before `CRClient.dll` can spawn the UI dialog—or when Adobe Crash Reporter suppresses modal dialogs after repeated crashes of the same Beta build—Photoshop simply disappears from the desktop.
   - About 5–10 seconds later, `LogTransport2CC` / `RTTransfer` records `ExitType="Crash"` for that session UUID.

---

## 4. Known CDP / Debugger Crash Triggers in UXP

When correlating the last lines of `[UXP Debugger] [CDP]` output before `Host app disconnected`:

1. **Startup / `breakOnStart` concurrency race in `libdynamic-napi.dll`:**
   - When a plugin is loaded with `breakOnStart: true` (or `Plugin/runScript`), UXP arms its internal "pause on first statement executed" flag.
   - After `CdpProxyServer` sends `Runtime.runIfWaitingForDebugger` and UXP emits `Runtime.executionContextCreated`, `js-debug` (root + child session) sends a burst of commands: duplicate `Debugger.enable`, `Profiler.enable`, `Debugger.setPauseOnExceptions`, and multiple `Runtime.evaluate` probes (`require('module').builtinModules` as `eval-*.cdp`, `typeof process === 'undefined' ...` as `eval-*.cdp`).
   - If UXP begins parsing/pausing on the first `eval-*.cdp` probe while concurrent `Debugger.enable` / `Profiler.enable` / second `Runtime.evaluate` messages hit `libdynamic-napi.dll`, V8/N-API can fatally assert in `napi_unwrap`.
2. **`autoAttachChildProcesses` probe (must always be `false`):**
   - `js-debug`'s default `autoAttachChildProcesses: true` evaluates a script that mutates `process.env` (`NODE_OPTIONS` / `VSCODE_INSPECTOR_OPTIONS`). Sending that eval to UXP crashes Photoshop immediately (see [UxpDebugSessionManager.ts](../../../src/vscode/debug/UxpDebugSessionManager.ts)).
3. **Unsupported DevTools frontend CDP domains:**
   - Forwarding `Page.startScreencast`, `Target.*`, `Emulation.*`, `ServiceWorker.*`, `Storage.*`, or `Tracing.*` from an inspector panel to UXP can destabilize or crash the host; these are blocked by `PANEL_METHOD_DENYLIST` in [cdpProxy.ts](../../../src/vscode/proxy/cdpProxy.ts).
4. **Negative CDP request IDs:**
   - UXP parses CDP JSON with `jsoncpp` (`UInt` for `id`) and rejects negative IDs. Proxy-internal IDs must stay positive (`>= 900_000` in [cdpMessageRewriter.ts](../../../src/vscode/proxy/cdpMessageRewriter.ts)).

---

## 5. Interpreting Post-Crash DAP Traffic ("Messages After Connection Closed")

When a live e2e test fails due to a Photoshop crash, the tail of the test log often shows a flurry of `[e2e][dap<]` and `[e2e][dap>]` messages **after** `Host app disconnected` and `js-debug WebSocket closed`. **This is normal local DAP teardown, not traffic to Photoshop:**

1. **Two interleaved DAP sessions:**
   - `trackDapMessages` in [liveHelpers.ts](../../../e2e/suite/liveHelpers.ts) subscribes to `"*"` (all debug sessions) without printing session IDs.
   - Every `pwa-node` attach creates **two** DAP sessions:
     1. The stamped **root session** (`UXP – ...`)
     2. `js-debug`'s delegated **child session** (`Remote Process [0]`), which owns the actual CDP target thread.
2. **Why the child session flushes handshake messages after CDP close:**
   - If Photoshop crashes while the child session is mid-bootstrap (having received `attach` `seq:2`, `setBreakpoints` `seq:3`, `setExceptionBreakpoints` `seq:4` from VS Code), `UxpDebugSessionManager.onSessionEnded` closes the CDP proxy WebSocket and calls `vscode.debug.stopDebugging(vsSession)` on the root session.
   - `js-debug` runs locally in the VS Code extension host (not inside Photoshop). When its CDP WebSocket closes, `js-debug` drains the child session's queued DAP requests (`setExceptionBreakpoints`, `setBreakpoints` returning `Unbound breakpoint`).
   - Seeing those replies, VS Code's DAP state machine automatically sends `configurationDone` to the child session; `js-debug` replies to `configurationDone` and `attach`, and **immediately** emits `thread exited` and `terminated`.
   - Finally, both the root session and the child session answer their respective `disconnect` requests—which is why two `{"command":"disconnect","success":true}` responses appear at the end of the log.

---

## 6. Process Termination & Session Cleanup Rules

1. **PowerShell process termination:**
   - When terminating any stuck or orphaned process in PowerShell, **always use `Stop-Process -Id <PID>`** with a specific process ID.
   - **Never** use `Stop-Process -Name`, `taskkill /IM`, or any name-based process killing command.
2. **E2E session cleanup:**
   - UXP pauses every freshly loaded/run session waiting for a debugger (`Runtime.runIfWaitingForDebugger`). A session left paused without an attach+detach cycle or explicit unload makes the **entire Photoshop host app appear busy/modal** to subsequent broker requests.
   - Between live tests, ensure `stopActiveDebugSessionIfAny`, `unloadAllSessions`, and `detachStrandedScriptSessions` (in [liveHelpers.ts](../../../e2e/suite/liveHelpers.ts)) run, and keep the post-test `500ms` cooldown so Photoshop does not enter a Windows "Not Responding" state.
