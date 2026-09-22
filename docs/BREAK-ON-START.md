# Break-on-start notes: pausing a UXP plugin on its first statement

> **Status: RESOLVED (2026-07-28).** Final mechanism: proxy arms V8's
> `Debugger.setInstrumentationBreakpoint({instrumentation:
> "beforeScriptWithSourceMapExecution"})` before resuming the frozen
> runtime, js-debug runs with `pauseForSourceMap: true`, and the proxy
> hands its armed breakpoint id over to js-debug when js-debug tries to
> arm the same breakpoint itself. The investigation history (including
> four falsified approaches) is kept for the record — each failure
> exposed one non-obvious fact about UXP or js-debug that future work
> must respect.

Context: `src/vscode/proxy/cdpProxy.ts` (all break-on-start logic),
`src/vscode/debug/UxpDebugSessionManager.ts` (`pauseForSourceMap`),
`src/vscode/commands/loadPlugin.ts` (`uxp.loadPluginBreakOnStart`),
`src/core/protocol/messages.ts` (`Plugin/load` with `breakOnStart:true`).

## The problem

`Plugin/load {breakOnStart:true}` freezes the plugin before any of its
code runs ("Waiting for the debugger to attach. Please open
chrome://inspect…"). The goal: attach the VS Code JS debugger (js-debug,
`pwa-node` attach through our CDP proxy) so that breakpoints placed in
the plugin's **top-level startup code** are hit. Naive approaches all
resulted in the plugin blowing straight through the breakpoints.

## Why this is hard — the three UXP deviations from Node

`node --inspect-brk` makes this scenario trivial for js-debug. UXP
violates every assumption that flow relies on:

1. **UXP freezes *before* creating an execution context.** Node pauses
   *after* the main script is compiled and the context exists. js-debug
   refuses to configure anything (no `Debugger.enable`, no breakpoints,
   no resume) until it sees `Runtime.executionContextCreated`. Simply
   withholding the resume therefore **deadlocks**: js-debug waits for a
   context, the context waits for the resume. The proxy must send
   `Runtime.runIfWaitingForDebugger` itself, immediately on connect.

2. **Runtime script URLs have no relation to disk paths.** Plugin
   scripts report root-relative URLs (`/assets/index-Df9iAZpL.js`);
   host-internal scripts use `uxp://uxp-internal/…`; js-debug eval
   probes appear as `eval-*.cdp`. js-debug's breakpoint *prediction*
   (case-insensitive `urlRegex` built from local `file:///a:/…` paths)
   can never match, so breakpoints only bind **after**
   `Debugger.scriptParsed` delivers the script's **inline source map**
   (whose `sourceRoot` the proxy rewrites — see `sourceMapRewriter.ts`).
   Consequence: *no amount of delaying the resume can ever work* — the
   race is not "configuration vs. resume", it is "script execution vs.
   source-map processing", and the map does not exist until the script
   is parsed, which happens after the resume.

3. **UXP's own break-on-start is "pause on next statement", not "pause
   on entry script".** Once the Debugger domain is enabled and the
   runtime resumed, UXP stops at the *first statement executed* — which
   in practice is one of js-debug's own `Runtime.evaluate` environment
   probes (`eval-*.cdp`), not plugin code. This spurious pause must be
   swallowed and auto-resumed by the proxy or it derails everything
   (js-debug either shows a bogus pause or auto-resumes past it).

## How other debuggers solve it (for reference)

- **Node/js-debug:** script URLs are file paths, so breakpoints bind by
  URL prediction before launch; source maps are read **from disk**
  (`outFiles`) ahead of time. The initial pause arrives after the entry
  script is parsed. None of this applies to UXP.
- **Chrome DevTools / Adobe UDT:** UDT's service layer is a pure pass-
  through (`CDTClient.js` in `uxp-devtools-core` just forwards raw CDT
  messages). The stock DevTools frontend persists breakpoints per
  **runtime URL** (the user clicked them in the Sources panel), so they
  re-bind right after `Debugger.enable`, before the frontend sends
  `Runtime.runIfWaitingForDebugger`. The "predict from disk" problem
  does not exist there. UDT has **no** break-on-start machinery at all.
- **The purpose-built CDP API** for our exact problem is
  `Debugger.setInstrumentationBreakpoint({instrumentation:
  "beforeScriptWithSourceMapExecution"})`: V8 pauses before executing
  each script that carries a `sourceMapURL`, giving the debugger time to
  process the map and bind breakpoints; the pause is then resumed
  silently. **UXP supports it** (verified on Photoshop 27.10 /
  uxp-9.4.0): the arm reply returns
  `breakpointId: "8:beforeScriptWithSourceMapExecution"`, and duplicate
  arming fails with `"Instrumentation breakpoint is already enabled."`.

## Falsified approaches (do not retry these)

| # | Approach | Why it failed |
| --- | --- | --- |
| 1 | Delay the proxy's resume nudge (grace timer), later: hold js-debug's own `Runtime.runIfWaitingForDebugger` until breakpoint traffic quiets | Breakpoints physically cannot bind pre-resume (deviation 2). Holding the resume changes nothing. |
| 2 | Inject `Debugger.pause` before the resume + rewrite the pause to Node's `"Break on start"` + `continueOnAttach: true` | The "next statement" was js-debug's own `eval-*.cdp` probe, not plugin code (deviation 3). The pause was consumed before the bundle ever parsed. |
| 3 | Internal entry breakpoint `setBreakpointByUrl {lineNumber:0, urlRegex:"^(\/\|uxp:\/\/(?!uxp-internal\/))"}`, classify pauses by script URL, remove after first hit; still rewrite reason + `continueOnAttach` | Reached the right pause (bundle line 0, source map available), **but** js-debug with `continueOnAttach` sends `Debugger.resume` immediately after a "Break on start" pause and binds breakpoints asynchronously afterwards — too late again. First regex attempt also failed because plugin URLs are `/assets/…`, not `uxp://<plugin-id>/…`. |
| 4 | Approach 3 + hold js-debug's `Debugger.resume` until its `Runtime.runIfWaitingForDebugger` (sent after binding) | Worked, but ~150 lines of timing machinery. Replaced wholesale by the instrumentation-breakpoint mechanism below. |

## Final mechanism (three cooperating pieces)

On a break-on-start attach (`CdpProxyServer` constructed with
`breakOnStartPending = true`):

1. **Arm early, then resume** (`connectToTarget` open handler): internal
   `Runtime.enable` → `Debugger.enable` → `Debugger.
   setInstrumentationBreakpoint({instrumentation:
   "beforeScriptWithSourceMapExecution"})` → `Runtime.
   runIfWaitingForDebugger`. Arming must happen proxy-side and *before*
   the nudge — js-debug cannot do it itself yet (deadlock, deviation 1),
   and after the nudge the bundle may already be executing. The armed
   `breakpointId` is captured from the reply
   (`instrumentationBreakpointId`).

2. **Swallow the spurious native pause**
  (`handleBreakOnStartMessage`, active while
  `awaitingBreakOnStartPause`): a `Debugger.paused` event that is
  neither `reason:"instrumentation"`, a user-breakpoint hit, nor a
  pause in a known real plugin/script `scriptId` is UXP's own
  break-on-start firing on a js-debug eval probe — swallow it, send an
  internal `Debugger.resume`, and also swallow the matching
  `Debugger.resumed` (js-debug never saw the pause). The real-script
  exception preserves an early `debugger;` statement when UXP does not
  emit an instrumentation pause before the entry script. The first
  forwarded startup pause clears the flag.

3. **Hand the breakpoint over to js-debug** (client message handler +
   `pauseForSourceMap: true` in the delegated `pwa-node` config, see
   `UxpDebugSessionManager`): `pauseForSourceMap` makes js-debug arm the
   same instrumentation breakpoint itself — UXP rejects the duplicate,
   and js-debug would then *not* recognise the startup pause as its own
   sourcemap pause and would resume it instantly (observed). The proxy
   therefore swallows js-debug's `setInstrumentationBreakpoint` request
   and replies with the already-armed `instrumentationBreakpointId`.
   js-debug now owns the breakpoint: on each instrumentation pause it
   waits for the script's source map, binds the pending breakpoints
   (`Debugger.setBreakpoint` on the parsed script succeeds with
   `actualLocation`), and silently resumes. Startup breakpoints hit.

Normal (non-break-on-start) attaches are untouched: the nudge is sent
immediately and no instrumentation breakpoint is armed.

The delegated configuration also sets `autoAttachChildProcesses: false`.
UXP exposes enough Node-like globals for js-debug's child-process probe to
mutate `process.env` (`NODE_OPTIONS` and `VSCODE_INSPECTOR_OPTIONS`), and
forwarding that probe was observed to crash Photoshop. UXP cannot spawn a
relevant Node child process, so disabling the probe loses no supported
behavior.

## Command-level flow (context)

- `UXP: Load Plugin (Break on Start)` (`uxp.loadPluginBreakOnStart`)
  loads with `breakOnStart:true` and registers the sessions as pending
  in `UxpDebugSessionManager`; the UXP Devtools panel marks the session
  as waiting and emphasizes its Debug action.
- Attaching to a pending session passes `wasPendingBreakOnStart` into
  `CdpProxyServer` and adds `pauseForSourceMap: true` to the debug
  config. The `"uxp"` launch type no longer has a `breakOnStart`
  attribute — load and attach are deliberately separate steps.
- UXP's host-side wait has its own timeout; if the user waits too long
  between load and attach, the plugin resumes by itself and startup
  breakpoints are missed. The 8 s no-context teardown in
  `CdpMessageRewriter.startContextTimeout()` is the proxy-side safety
  net for a session that never produces a context.
- `Plugin/runScript` has no `breakOnStart` parameter, but UXP starts each
  standalone script in a debugger-waiting state. Script sessions therefore
  use the same instrumentation-breakpoint and `pauseForSourceMap` path,
  including type-stripped `.ts` files.
- The host starts a script before VS Code's debug chain is fully attached.
  A very short synchronous script can finish before its authored breakpoint
  is installed. During debugging, an initial asynchronous yield such as
  `await new Promise(resolve => setTimeout(resolve, 1500));` gives the attach
  and source-map handshake time to complete; it need not remain in production
  code.
- UXP has no protocol-level script unload. If a restart races the previous
  run's teardown and Photoshop reports that it "is modal", the command retries
  up to ten times at 500 ms intervals. Other errors are returned immediately.

## Diagnostics cheat-sheet (Output → "UXP Debugger")

Expected break-on-start sequence:

```text
[CDP] breakOnStart session — arming an instrumentation breakpoint before resuming the runtime.
[CDP] Instrumentation breakpoint reply: {"id":…,"result":{"breakpointId":"8:beforeScriptWithSourceMapExecution"}}
[CDP] Swallowed spurious break-on-start pause — auto-resuming.
[CDP] Adopting js-debug's setInstrumentationBreakpoint — replying with the armed id.
[CDP] Startup instrumentation pause — handing over to js-debug.
… js-debug: Debugger.setBreakpoint on the parsed script (actualLocation) BEFORE Debugger.resume …
```

Failure signatures:

- `Instrumentation breakpoint reply: {"error":…}` → the host does not
  support `setInstrumentationBreakpoint`; fall back to approach 3+4
  (entry URL breakpoint + held resume) from git history.
- `Debugger.resume` forwarded immediately after the instrumentation
  pause, bindings afterwards → js-debug did not adopt the breakpoint
  (check the "Adopting…" line and `pauseForSourceMap` in the config).
- Pause at `eval-*.cdp` reaching js-debug → spurious-pause swallow
  regressed.

## Other facts learned (useful beyond break-on-start)

- UXP replies to internal requests **out of order** (the
  `runIfWaitingForDebugger` ack can arrive before the `Debugger.enable`
  ack). Never rely on reply ordering.
- `Runtime.evaluate` while paused works in UXP (js-debug's probes get
  answered mid-pause).
- Supported domains per `Schema.getDomains`: Runtime, Debugger,
  Profiler, HeapProfiler, Schema (all "1.3"). `Network.enable` returns
  `true` but is a stub; `NodeWorker.enable` is unsupported (the
  rewriter fakes a success reply).
- js-debug's Node child-process probe is disabled with
  `autoAttachChildProcesses: false`; forwarding its `process.env` mutation
  was observed to crash Photoshop.
- The instrumentation breakpoint stays armed for the whole session —
  this is what also makes startup breakpoints work across **reloads**
  and in **multi-chunk** builds (every sourcemapped script pauses,
  js-debug handles each pause silently).
