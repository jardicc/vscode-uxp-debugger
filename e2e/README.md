# E2E harness (real VS Code + optionally real Photoshop)

This folder is **not** part of the vitest/Wallaby suite (`test/**/*.test.ts`).
It uses `@vscode/test-electron` + Mocha to launch a real VS Code instance
with this extension loaded, because that's the only way to exercise the
actual debug-adapter wiring (`vscode.debug.*`, DAP tracker, real
`activate()`/command registration).

**Why kept separate from `test/`:** Wallaby runs the vitest suite
continuously on every save (TDD loop). These tests are slow (spin up a real
VS Code process), can require a real, already-running Photoshop with
developer mode on, and use Mocha (`describe`/`it` globals) instead of
vitest's imported ones. `vitest.config.ts` also explicitly excludes `e2e/**`
as a second line of defence.

## Running

```powershell
npm run test:e2e
```

This bundles `e2e/runTest.ts` + `e2e/suite/*.ts` with esbuild into `out/e2e/`
and runs `node out/e2e/runTest.js`, which downloads (once, cached under
`.vscode-test/`) and launches VS Code with `--extensionDevelopmentPath` set
to the repo root and the workspace opened at `e2e/fixtures/plugin`.

### Tests included

- **`smoke.test.ts`** — always runs. No Photoshop required. Verifies the
  extension activates and all `uxp.*` commands register in a real VS Code
  instance.
- **`loadAndUnload.photoshop.test.ts`** — skipped unless
  `UXP_E2E_PHOTOSHOP=1` is set. Requires Photoshop already running with
  developer mode enabled (dev-mode consent dialog would otherwise block the
  automated run). Loads the fixture plugin, then unloads it, asserting
  `sessionsForManifest` reflects both. Intentionally the simplest live flow —
  more `*.photoshop.test.ts` files (attach/breakpoints/etc.) can be added
  alongside it, built on the shared helpers below.
- **`reloadPlugin.photoshop.test.ts`** — same gate. Loads the fixture
  plugin, reloads it, and asserts the same `clientSessionId` still shows up
  in `sessionsForManifest` (host-assigned session ids may change under the
  hood; the broker re-binds them transparently).
- **`attachDebugger.photoshop.test.ts`** — same gate. Loads the fixture
  plugin, attaches via `UxpDebugSessionManager.attach` (the same path the
  UXP Devtools panel uses), asserts a real `pwa-node`
  debug session starts, then detaches and asserts teardown. Covers four
  variations: `breakOnStart:true`, plain (`breakOnStart:false`) attach, a
  detach→re-attach→detach cycle on the same session, and the debug session
  stopping itself automatically when the plugin is unloaded host-side while
  still attached. Regression coverage for the
  `autoAttachChildProcesses: false` fix — an earlier version of this flow
  crashed a real, already-running Photoshop. Does not assert on
  breakpoints/`stopped` events (see BREAK-ON-START.md for the open
  breakpoint-binding gap).
- **`attachReplaceSession.photoshop.test.ts`** — same gate. Exercises
  `attach()`'s "a debug session is already active" modal confirmation flow
  (decline keeps the old session; confirm detaches it and attaches the new
  one). Since an automated test can't click a real native modal, it
  temporarily stubs `vscode.window.showWarningMessage` to auto-answer,
  restoring the original implementation afterwards.
- **`debugScript.photoshop.test.ts`** — same gate. Runs the fixture's
  `index.js` as a standalone script via `UxpService.runScript` (the
  `Plugin/runScript` flow behind `uxp.debugScript`), asserting a script
  pseudo-session gets registered.
- **`restartDebugger.photoshop.test.ts`** — same gate. Exercises VS Code's
  built-in debug-toolbar "Restart" (`workbench.action.debug.restart`) on an
  attached session, asserting the CDP proxy reconnects/keeps forwarding.
- **`sourceMapExternal.photoshop.test.ts`** — same gate. Loads
  `e2e/fixtures/plugin-sourcemap`, whose entry script (`original.js`,
  compiled from `original.ts` via `tsc`) carries an *external*
  `//# sourceMappingURL=original.js.map` reference instead of an inline
  `data:` map. Sets a breakpoint on the pre-bundle `original.ts` line,
  attaches with `breakOnStart`, and asserts the debugger actually stops
  there with the paused frame's source resolved back to `original.ts` —
  proving `resolveExternalSourceMap` (`sourceMapRewriter.ts`) correctly
  reads and rewrites the external `.map` file.
- **`sourceMapInline.photoshop.test.ts`** — same gate. Counterpart to
  `sourceMapExternal.photoshop.test.ts` using an *inline* (`data:` URL)
  source map instead of an external `.map` file
  (`e2e/fixtures/plugin-sourcemap-inline`, compiled via
  `tsc --inlineSourceMap`) — proves `rewriteInlineSourceMapRoot` for the
  `Plugin/load` flow.
- **`sourceMapExternalScript.photoshop.test.ts`** — same gate. Same idea as
  above but for the `Plugin/runScript` ("debug active-editor script") flow
  (`e2e/fixtures/script-sourcemap`) instead of `Plugin/load`. Regression
  coverage for a real timing bug: unlike breakOnStart plugin loads,
  `debugScript.ts` never marked script sessions as pending-break-on-start,
  so the CDP proxy never armed the sourcemap-pause instrumentation
  breakpoint for them — even though UXP always pauses `runScript` sessions
  on start too. Without that pause, js-debug had no guaranteed window to
  process the external `.map` and bind breakpoints before the (very short)
  script ran to completion. Fixed in `UxpDebugSessionManager.attach()`:
  `session.kind === "script"` now always triggers the same
  `pauseForSourceMap` handling as `breakOnStart`.
- **`sourceMapInlineScript.photoshop.test.ts`** — same gate. Counterpart to
  `sourceMapExternalScript.photoshop.test.ts` using an *inline* (`data:` URL)
  source map instead of an external `.map` file
  (`e2e/fixtures/script-sourcemap-inline`, compiled via
  `tsc --inlineSourceMap`) — proves `rewriteInlineSourceMapRoot` works for
  the `Plugin/runScript` flow too, not just `Plugin/load`.
- **`scriptTypeScriptStrip.photoshop.test.ts`** — same gate. Proves the
  on-the-fly TypeScript stripping feature (`src/core/stripTypeScript.ts`,
  wired into `debugScript.ts`'s "Debug Script" flow): a `.ts` fixture with
  NO checked-in compiled `.js` (`e2e/fixtures/script-typescript-live`) gets
  its types erased in memory (`ts-blank-space`, Node/Deno/Bun-style) and
  written to a throwaway temp `.js` with an inline identity source map, then
  run through the normal `Plugin/runScript` flow — asserts a breakpoint set
  on the original `.ts` binds and hits, resolved back to `.ts` not the temp
  file.
- **`multiAttach.photoshop.test.ts`** — same gate. Loads TWO different
  plugins (`e2e/fixtures/plugin` + `e2e/fixtures/plugin2`, distinct
  `pluginId`s) and attaches the JS debugger to both at once, proving
  `UxpDebugSessionManager` tracks attachments per `clientSessionId` (a
  `Map`) instead of a single global slot. Covers: both sessions staying
  independently live (cross-checked via each fixture's distinct
  `globalThis.__uxpFixtureId` marker, to rule out a false positive where
  both proxies would secretly share one CDP connection), attaching a second
  *different* session never showing the "replace active session" prompt,
  detaching one session leaving the other attached and working, and
  unloading one plugin host-side stopping only that session's debugger.
- **`takeover.photoshop.test.ts`** — same gate. Multi-window broker
  **takeover** flow (`MULTI-WINDOW-TAKEOVER.md`): this window (A, the
  mocha test runner) loads the fixture plugin first, then spawns a SECOND,
  real Extension Development Host window (B) — mirroring "Run Extension
  (Plugin 2)" in `.vscode/launch.json` — via `@vscode/test-electron`'s
  `runTests()` called from inside window A itself. Window B loads
  `fixtures/plugin2`, which triggers a takeover away from window A (auto-
  confirmed); the test asserts window A's session is torn down, then window
  A takes ownership back while window B is still alive — regression
  coverage for the native Vulcan-adapter crash on a second same-process
  takeover (see the plan doc §5). Window B's side of the flow lives in
  `takeoverWindowB.ts` — not a `*.test.ts` file (so it's never
  auto-discovered as a mocha test), compiled as its own explicit
  `--extensionTestsPath` entry point (see `build.mjs`).
- **`startStopDebugger.photoshop.test.ts`** — same gate, but does NOT
  require Photoshop to actually be running: exercises the "Start/Stop UXP
  Debugger" command pair (`uxp.startDebugger`/`uxp.stopDebugger`), asserting
  `brokerState` becomes `stoppedByUser`/`running` and that the broker port
  is really released/rebound (not just a flag flip) — same decoy-port-probe
  technique as `portInUse.photoshop.test.ts`.
- **`hostAppNotRunning.photoshop.test.ts`** — same gate, and specifically
  requires Photoshop to be OFF (a guard assertion fails fast with a clear
  message otherwise). Exercises `HostAppNotRunningError` handling for the
  `uxp_load_plugin`/`uxp_attach_debugger` LM tools (no connected app matches
  the fixture manifest) via `api.tools.*` (see `UxpDebuggerTestApi` below),
  plus `uxp_launch_host_app`'s unrecognized-`appId` rejection (safe to run
  regardless of Photoshop state — it never reaches `service.launchHostApp`).
  Run standalone with Photoshop closed:
  `$env:MOCHA_GREP = "host app not running"; npm run test:e2e:live`.
- **`lmToolsPauseChain.photoshop.test.ts`** — same gate, requires
  Photoshop running. Drives the full `uxp_set_breakpoint` →
  `uxp_wait_for_pause` → `uxp_evaluate_in_frame` → `uxp_resume` chain via
  `api.tools.*`, asserting on each tool's real text/JSON output against a
  real pause. Uses the `plugin-sourcemap` fixture/line (same one
  `sourceMapExternal.photoshop.test.ts` proves binds/hits reliably) rather
  than the plain `plugin` fixture's very first statement — confirmed live
  that a breakpoint on a breakOnStart entry script's literal first line can
  lose the race against js-debug's source-map processing and never bind.
- **`hooksHttp.photoshop.test.ts`** — same gate, requires Photoshop
  running (except the `pack` route, which doesn't need a connected app).
  Sends real HTTP requests to the broker's `/__uxp_debugger__/hooks/*`
  routes (`refresh`/`unload`/`load`/`reload`/`pack`/`watch`+
  `watch/enable`/`disable`) — no e2e coverage existed for any build-tool
  hook route before this file.
- **`pluginWatch.photoshop.test.ts`** — same gate, requires Photoshop
  running. Registers a throwaway plugin (a temp-dir copy, never the
  checked-in fixtures) with `watch: true`, loads it, then edits its files on
  disk and asserts `PluginWatchManager` reacts correctly: a non-special file
  change triggers a fast in-place refresh (same session id, script re-runs),
  while a `manifest.json` change triggers a full Unload+Load. Occasionally
  flaky when run back-to-back with several other live suites in the same
  VS Code instance (passed standalone every time it was tried) — same
  category of flakiness as `sourceMapExternalScript.photoshop.test.ts`.
- **`lmToolsMultiSession.photoshop.test.ts`** — same gate, requires
  Photoshop running. Combines `multiAttach.photoshop.test.ts`'s
  two-different-plugins setup with the Tier 1/2 LM tools that resolve a
  single attached session (`resolveAttachedSessionId`): asserts
  `uxp_evaluate_global`/`uxp_get_console_output`/`uxp_wait_for_pause`/
  `uxp_resume` all refuse to guess and ask for `sessionId` when 2 sessions
  are attached, that an unknown explicit `sessionId` is rejected too, and
  that a correctly-disambiguated `uxp_evaluate_global` call really reaches
  its OWN target (cross-checked via each fixture's distinct
  `globalThis.__uxpFixtureId` marker, same false-positive guard as
  `multiAttach`). Retries past a freshly-attached session's transient "No
  execution context yet" reply (`evaluateGlobalWithRetry`) rather than
  treating it as a failure.


```powershell
$env:UXP_E2E_PHOTOSHOP = "1"
npm run test:e2e
```

### Running a single suite

The Mocha entry point (`suite/index.ts`) honours a `MOCHA_GREP` environment
variable, so one suite (or test) can be iterated on quickly without
re-running the whole slow live run:

```powershell
$env:MOCHA_GREP = "Multiple concurrent"   # matches the describe(...) title
npm run test:e2e:live
Remove-Item Env:\MOCHA_GREP
```

### `liveHelpers.ts`

Shared helpers for `*.photoshop.test.ts` files, so each test file only
contains the flow it's testing:

- `RUN_LIVE` / `describeLive` — the `UXP_E2E_PHOTOSHOP=1` gate.
- `repoRoot`, `fixturePluginDir`, `manifestPath`, `scriptUri` — fixture paths.
- `activateExtension()` — resolves and activates this extension, returning
  its `UxpDebuggerTestApi`.
- `unloadAllSessions(api, manifestPath)` — best-effort cleanup for `afterEach`.
- `waitFor(predicate, timeoutMs)` — polls until a condition is true or rejects
  on timeout.
- `trackDapMessages(onMessage)` — registers a debug adapter tracker that logs
  every DAP message (`[e2e][dap>]`/`[e2e][dap<]`) and forwards it to
  `onMessage`; useful for future tests asserting on `stopped`/`output`/etc.
  events. Dispose the returned `Disposable` in a `finally` block.
- `invokeTool(tool, input)` / `toolResultText(result)` — calls an LM tool's
  `invoke()` directly (bypassing `vscode.lm`/chat, which the harness can't
  drive) and extracts its plain-text result. Always pass a tool instance
  from `api.tools.*`, never construct a new `Uxp*Tool` from source in a test
  file — a separately-bundled copy carries its own module graph (its own
  `HostAppNotRunningError` class, etc.), silently breaking `instanceof`
  checks against errors thrown by the real running extension.

## Gotcha: send DAP requests to js-debug's CHILD session, not the parent

js-debug creates a per-target **child** debug session under the `pwa-node`
parent session that `UxpDebugSessionManager` starts, and only the child
registers DAP request handlers (`evaluate`, etc.). Sending
`session.customRequest("evaluate", ...)` to the **parent** makes js-debug
log `Unknown request: evaluate` and **never reply at all** — no success, no
error — so the `customRequest` promise hangs until an external timeout.

This burned a full debugging day on `multiAttach.photoshop.test.ts`
(2026-07-29): the test looked like a product bug ("evaluate doesn't reach
the UXP target"), but manual F5 usage worked fine. The product was never at
fault — the test was evaluating through the wrong session:

- `api.debugManager.getVsSession(clientSessionId)` matches sessions by the
  `__uxpClientSessionId` config key and can hand back the **parent** — never
  `evaluate` through it directly.
- `vscode.debug.activeDebugSession` happens to point at the child (which is
  why `attachViaLaunchConfig.photoshop.test.ts` always passed), but it's
  ambiguous once two sessions are attached concurrently.

**Correct pattern** (see `attachAndGetOwnSession` in
`multiAttach.photoshop.test.ts`): record newly started sessions with
`vscode.debug.onDidStartDebugSession` around the `startDebugging` call, walk
the tracked session up its `parentSession` chain to the root, then wait for
a **descendant** of that root to appear and send DAP requests to it.

Since 2026-08-19 the product handles this itself: `UxpDebugSessionManager`
adopts the delegated child session (matched via `findUxpClientSessionId()` in
`src/vscode/debug/uxpSessionChain.ts`) and exposes it as
`api.debugManager.getDapSession(clientSessionId)` — new tests can use that
instead of the manual tracking above. The LM tools' pause tracking keys its
state by `clientSessionId` for the same reason (see LANGUAGE-MODEL-TOOLS.md §5.2
implementation notes).

## `UxpDebuggerTestApi`

`activate()` in `src/vscode/extension.ts` returns
`{ service, debugManager, proxyRegistry, pluginRegistry, tools }` — direct
access to the `UxpService` broker facade, the `UxpDebugSessionManager`, and
(`tools`) every registered LM tool instance (`UxpLanguageModelTools` in
`src/vscode/tools/registerTools.ts`). The E2E tests use it
(`api.service.loadPlugin(...)` / `.unloadPlugin(...)`, `api.tools.loadPlugin`
/ `.attachDebugger` / etc. with `invokeTool()`) to bypass the interactive
quick-pick UI and `vscode.lm` registration, since there's no way to drive
VS Code's native QuickPick or a model-driven tool call from an automated
test. This is **not** a supported public API for other extensions — it may
change or disappear without notice.

## Fixture plugin

`fixtures/plugin/` is a minimal UXP plugin (manifest + `index.html` +
`index.js`) used only to exercise the load/attach flow. It doesn't need to
do anything meaningful — `breakOnStart` pauses the host before the script's
execution context is even created (see `../docs/BREAK-ON-START.md`).

`fixtures/plugin2/` is a second, minimal fixture plugin with a distinct
`pluginId`/name, used only by `multiAttach.photoshop.test.ts` to load two
different plugins into the host app at once. Both fixtures stamp a distinct
`globalThis.__uxpFixtureId` marker (`"plugin-one"` / `"plugin-two"`) so that
test can prove two concurrently-attached debug sessions are really talking
to two independent CDP targets.
