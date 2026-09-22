# Lifecycle notes: abrupt shutdown, Vulcan re-announcement & host-app hangs

> **Status: RESOLVED (2026-07-27).** Root cause: a **reflex Vulcan
> re-announcement** sent while an already-running host app was still
> reacting to the first one. See "Resolution" below. The investigation
> history (including falsified hypotheses) is kept for the record — it is
> a case study in how misleading the initial symptoms were.

Notes for programmers/architects on two related lifecycle bugs observed in
the field. Context: `src/core/vulcan/VulcanAnnouncer.ts`,
`src/core/broker/UxpBroker.ts`, `src/vscode/UxpService.ts`,
`src/vscode/debug/UxpDebugSessionManager.ts`.

## Resolution (confirmed by field testing, 2026-07-27)

**Root cause.** When a plugin command found zero connected apps, the old
`applicableAppsWithRetry()` *immediately* re-announced the service over
Vulcan. An app that was already running when the broker started (the
"PS-first" order) therefore always received `server.info` **twice in
quick succession** — the second one while it was still busy connecting in
reaction to the first. On stable Photoshop 27.8 (UXP 9.3) this leaves the
host's devtools channel half-torn: the WebSocket stays open and `App/info`
is answered, but every subsequent `Plugin/*` request is silently dropped
(no reply, not even late), manual retries fail, and the stuck state also
blocks Photoshop's own shutdown — the lingering `photoshop.exe`. Adobe's
UDT never re-announces (a single `setServerDetails` at server start),
which is why it never triggers the host defect.

**Fix.** `UxpService.waitForHostApps()`: wait **passively** (poll up to
3 s) for apps reacting to the start-up announcement; re-announce once
*only if no app at all* connected, then wait again. Used by both the
plugin fan-out (`applicableAppsWithRetry`) and the script-target picker
(`debugScript`). Re-announcing is a last resort, never a reflex.

**Confirmed by user testing:** with the fix, plugin load works regardless
of startup order, works again after force-killing the VS Code process, and
`photoshop.exe` exits cleanly when Photoshop is closed.

**Defence-in-depth kept** (shipped during the investigation, retained
because they are cheap and strictly reduce risk):

- `UxpBrokerOptions.validateBeforeLoad` — the vscode layer passes `false`;
  no observed host ever answers `Plugin/validate`, so skipping it removes
  a pointless 3 s pause per load. Default `true` preserves Adobe-UDT
  behaviour for any other embedder.
- `UxpBrokerOptions.appSettleMs` (default 5 s) — minimum gap between an
  app's `App/info` handshake and the first `Plugin/*` request sent to it.
  Not the root cause (field-tested alone without effect), but it keeps us
  out of the host's initialisation window, mirroring the human-scale
  timing Adobe's UDT operates under. Candidate for shortening after more
  field experience.

**Takeaway for future work on the Vulcan layer:** treat announcements as
*state transitions with side effects inside host apps*, not as idempotent
beacons. Never announce twice in close succession; never toggle off→on as
a "refresh" (see the reverted fix attempt below — the `false` leg actively
disconnects apps).

## Observed symptoms (chronological)

1. After stopping the Extension Development Host with the parent VS Code's
   **Stop Debugging** button, the next launch never gets a Photoshop
   connection ("PS is not running or not connected" dialog).
2. Initially, closing the window normally seemed to avoid the problem —
   **later falsified**: the same failure occurs after a completely normal
   VS Code window close (the ✕ button).
3. `photoshop.exe` keeps running after the Photoshop UI closes and must be
   killed manually. Initially attributed to an attached debugger —
   **later falsified**: it reproduces with *no* debug session at all, after
   nothing more than plugin load/unload over the broker.

## Falsified hypothesis H1 — missing `withdraw()` leaves the Vulcan bus stale

Theory: "Stop Debugging" kills the extension host without running
`deactivate()` → `broker.stop()` → `VulcanAnnouncer.withdraw()`, so the
Vulcan bus still thinks endpoint `"UTDS"` is registered by the dead process
and dedupes the next process' identical `setServerDetails(true, …)` as a
no-op.

**Falsified because** the failure also occurs after a clean window close,
where `deactivate()` does run. (`UxpService.dispose()` calls
`void broker.stop()`, and the `withdraw()` + `dispose()` native calls are
synchronous and execute immediately at the top of `stop()` — they do not
depend on the async remainder completing before process exit.)

### Fix attempt (REVERTED): off→on toggle in `announce()`

`VulcanAnnouncer.announce()` was changed to send
`setServerDetails(false, …)` immediately before `setServerDetails(true, …)`
to force a visible state transition. **Reverted the same day**:

- It did not fix the symptom (failures continued after normal close).
- Adobe's own UDT service never toggles — it sends a single `true` on start
  and a single `false` on stop (`uxp-cli-v1 … UDTServer.js`).
- It made the retry path actively harmful: `UxpBroker.reannounce()` (called
  by `UxpService.applicableAppsWithRetry()` before every "app not running"
  dialog) reuses `announce()`, so the leading `false` told any
  connected/connecting host app that the service had *stopped* — inviting
  disconnect/reconnect flapping and false→true delivery races over the
  async IPC transport.

## Falsified hypothesis H2 — debugger-paused JS thread keeps photoshop.exe alive

Theory: a paused V8 execution context (breakpoint / UXP's wait-for-debugger
start pause) blocks Photoshop's shutdown, CEF-style.

**Falsified because** the lingering-process hang reproduces with no debug
session ever attached — plain `Plugin/load` / `Plugin/unload` over the
broker's `/socket/app` connection is sufficient.

## Superseded theory — zombie photoshop.exe as the primary cause

> Superseded by the resolution above: the lingering process turned out to
> be a *consequence* of the wedged devtools channel, not the cause of the
> reconnect failures. Kept for the record.

The two symptoms are probably **one bug, causally reversed** from the
original reading:

1. Something about quitting Photoshop *while its developer-mode WebSocket to
   our broker is (or recently was) active* leaves `photoshop.exe` hung
   during shutdown. The trigger condition is unknown — candidates: an open
   `/socket/app` connection at quit time, a dev plugin having been
   loaded/unloaded during the session, or Adobe-side dev-mode teardown.
   Our own teardown code (`UxpBroker` `connection.onClose`,
   `UxpDebugSessionManager.onSessionEnded`) only *reacts* to PS closing its
   socket and cannot cause the hang.
2. The zombie `photoshop.exe` then **explains the failed reconnects**:
   Photoshop is single-instance — "starting Photoshop" while a hung
   instance exists typically just signals the existing (stuck) process, so
   the visible app may never re-initialize its UXP/Vulcan client, and
   Vulcan announcements are delivered to the zombie. Result: "PS is not
   running or not connected", regardless of how the previous VS Code
   session ended.
3. Vulcan IPC is mediated by **`AdobeIPCBroker.exe`**, a separate process
   that outlives both VS Code and Photoshop. Stale endpoint registrations
   (ours *and* the zombie PS's) can persist there across restarts. It is
   safe to kill — it restarts on demand.

## Recovery procedure (historical — no longer needed after the fix)

1. Close VS Code (any way).
2. Kill all leftover Photoshop processes: `taskkill /IM photoshop.exe /F`
   — verify none remain.
3. Optionally also `taskkill /IM AdobeIPCBroker.exe /F` (auto-restarts).
4. Start Photoshop, wait for it to finish loading.
5. Start VS Code and load the plugin; the "UXP Debugger" output channel
   must show `vulcan: announced service on port 14001` followed within
   ~1 s by `Host app connected: Photoshop …`.

## Field observations log

**2026-07-27, PS 27.8.0 / uxp-9.3.0:** After a restart cycle, the connection
path is *healthy* — Vulcan announce → `/socket/app` connect → `ready` →
`initRuntimeClient` → `App/info` all completed (the doubled
`vulcan: announced` line is expected: broker start + the
`reannounceAndWait()` retry that runs while the app hasn't connected yet).
`Plugin/validate` unanswered as usual, then **`Plugin/load` timed out after
5000 ms with no reply ever arriving** (no late-reply log line). The wire
format was re-verified against `uxp-devtools-protocol.types.ts`
(`PluginLoadRequest`) and the UDT 2.x capture (`isPlaygroundPlugin` is
optional, playground-only) — the message is correct; the silence is
host-side. Note this machine ran PS **27.8/UXP 9.3**, not the previously
verified 27.10/UXP 9.4. Consistent with the zombie/wedged-host theory:
the UXP plugin subsystem accepts the socket and answers `App/info` but its
plugin-management queue never services the load. Next checks: single fresh
photoshop.exe (PID/start time), no modal dialog/busy state, no leftover
dev-plugin panel from a previous session, and an A/B test of the same load
via Adobe's official UDT on the same PS instance.

**2026-07-27, follow-up:** User confirmed all processes were killed and the
failing host is **stable** Photoshop 27.8 / UXP 9.3 — the previously
verified-working host was the **beta** (27.10 / UXP 9.4). This shifts
suspicion onto a host-version difference rather than wedged process state.
Pattern: the silence starts at exactly the first unanswered request
(`Plugin/validate`) and everything after it (`Plugin/load`) is also never
answered — consistent with UXP 9.3's request queue being wedged by a
validate it cannot handle, while UXP 9.4 silently discards it.
**Experiment shipped:** `UxpBrokerOptions.validateBeforeLoad` (default
`true` = Adobe UDT behaviour) and the vscode layer now passes `false`, so
no `Plugin/validate` is sent before `Plugin/load` at runtime. Validation
was best-effort anyway — no observed host ever answers it, so nothing of
value is lost. If load succeeds on stable 27.8 with validate skipped, the
wedge theory is confirmed (and the beta-vs-stable difference explains the
original "works / doesn't work" confusion — possibly including the
lingering-process behaviour, which should be retested on stable).

**2026-07-27, breakthrough (stable PS 27.8 / UXP 9.3):** Three decisive
observations from further testing:

1. **Startup order is the discriminator.** If Photoshop is running *before*
   the broker starts (PS connects in reaction to our mid-session Vulcan
   announce), the connection handshake works but `Plugin/load` times out.
   If the broker is running *first* and PS is then launched (PS connects
   during its own startup), **everything works** — load, debug, all of it.
2. Killing Adobe's UDT v2 mid-debug does **not** leave photoshop.exe
   hanging. (Note: in that test PS had been launched after UDT was already
   running — i.e. the "good" startup order.)
3. Skipping `Plugin/validate` (`validateBeforeLoad:false`) did not fix the
   PS-was-first case, so the validate-wedge theory is *not* the (whole)
   story. The skip is kept — validate provides nothing and no host answers
   it — but it is unconfirmed whether it matters at all.

**Unified working theory:** on stable UXP 9.3, a host app that connects to
the devtools service **mid-session** (announcement received while the app
was already running) ends up with a half-initialised devtools channel: the
core runtime answers `App/info`, but the plugin-management layer never
services `Plugin/*` requests (silent drops, no replies, not even late
ones). The same stuck internal state plausibly also blocks Photoshop's
shutdown — explaining the lingering photoshop.exe — whereas an app launched
*after* the service announcement initialises fully. The beta (UXP 9.4)
appears not to have this defect, which retroactively explains the original
confusing "works after normal close / breaks after Stop Debugging" report:
what actually varied was whether PS happened to be (re)started while the
service was up, not how VS Code was closed.

**Mitigations shipped:** `RequestTimeoutError` message now tells the user
to fully restart the host app (checking for a lingering process) when the
app predates the debugger. Startup-order fix on the user side: launch PS
after VS Code's broker is up, or restart PS (with a process check).

**2026-07-27, fix shipped — settle guard.** Requirement: the debugger must
work regardless of startup order. Comparing our flow with Adobe's UDT
(v1 sources + v2 asar — `UDTServer.startServer`, `DevToolsMgr`,
`AppClient`) showed the wire protocol and Vulcan usage are **identical**;
the only real difference is *timing*: in UDT a human clicks "Load" tens of
seconds after the app connects, while we fired `Plugin/load` ~1–2 s after
the handshake (PS connects during our 2 s reannounce wait and load goes
out immediately). Working theory refined: a host that connects
*mid-session* answers `App/info` at once, but its plugin-management layer
is still initialising; a `Plugin/*` request that arrives in that window is
silently dropped and appears to wedge the devtools queue permanently
(manual retries on the same connection also time out; quitting the app
then hangs). Fix: `UxpBrokerOptions.appSettleMs` (default 5000 ms, tests
use 0) — `loadPlugin`/`runScript` wait out the remainder of the settle
window after the app's handshake before sending the first plugin op
(`UxpBroker.waitForAppSettle`). Costs at most ~5 s, and only when the app
connected moments before the command. If field testing shows 5 s is not
enough (or too conservative), tune `DEFAULT_APP_SETTLE_MS`.

**2026-07-27, settle guard did NOT fix it — next suspect: double announce.**
Field test with the 5 s settle guard: PS-first still fails identically
(and killing photoshop.exe produces an immediate, clean
`Host app disconnected` — the WS connection itself is healthy throughout;
only the plugin layer is dead). Time-based theories are therefore out.
Re-reading the failing log surfaced the remaining asymmetry:

```
vulcan: announced service on port 14001   ← broker start
vulcan: announced service on port 14001   ← immediate reflex re-announce
app #1 ← {"command":"ready"}              ← PS connected AFTER both
```

In the PS-first flow the old `applicableAppsWithRetry` found zero apps
(PS needs ~1 s to connect) and *immediately* re-announced — so a stable
UXP 9.3 host always received `server.info` **twice in quick succession**
while it was still reacting to the first one. Hypothesis: the second
announcement makes the host re-initialise its devtools client mid-connect,
orphaning the internal message handlers — socket stays open (App/info was
answered before the damage), every later `Plugin/*` is dropped, and the
half-torn state also hangs app shutdown. The broker-first flow announces
exactly once (a load finds the app already connected → no re-announce),
which is also exactly what Adobe's UDT does (single `setServerDetails` at
server start, never re-announced) — consistent with every observation.

**Fix shipped:** `UxpService.waitForHostApps()` replaces the reflex
re-announce: first wait **passively** (poll up to 3 s) for apps reacting
to the start-up announcement; re-announce once *only if no app at all*
connected, then wait again. Both call sites (plugin fan-out
`applicableAppsWithRetry`, script-target picker in `debugScript`) now go
through it. Combined with the settle guard, the failing sequence
(announce→announce→connect→immediate load) can no longer occur.

**2026-07-27, confirmed fixed.** User verified on stable PS 27.8: load
works in both startup orders, works after force-killing the VS Code
process, and photoshop.exe no longer lingers after quitting Photoshop.
The double-announce hypothesis is thereby confirmed as the root cause.
The experiments listed below were rendered moot and were not run.

**Discriminating experiments (obsolete — kept for the record):**

- With **UDT v2**: start PS *first*, then UDT, then load a plugin. If that
  also fails, the mid-session defect is Adobe's, present with their own
  tool → report upstream; our behaviour is at parity.
- Distinguish *mid-session connect* from *re-connect*: take a completely
  fresh PS that has never connected to any devtools service in its
  lifetime, then start the broker (mid-session announce) and load. Failure
  → mid-session connect is broken per se. Success → only *re*-connects
  break (points back at stale endpoint state, e.g. AdobeIPCBroker).
- In the working flow (broker first, PS second): does PS still hang on
  quit while the broker is running? If not, the wedge theory also fully
  explains the lingering-process symptom.

## Experiments to narrow the hang trigger (obsolete — resolved above)

- Quit PS while the broker is running but **no plugin was ever loaded**
  (connection idle after handshake). Does it hang?
- Quit PS after load **and** unload (clean session end). Does it hang?
- Quit PS after load **without** unload. Does it hang?
- Quit PS after VS Code has already been closed (socket already dropped
  from our side). Does it hang?
- Reproduce the same sequence against **Adobe's official UDT** instead of
  this extension. If PS hangs there too, it is an Adobe dev-mode bug and
  should be reported upstream.
- After a failed reconnect, verify whether the running `photoshop.exe` is a
  fresh process or the old one (PID / start time in Task Manager).
- After killing only `AdobeIPCBroker.exe` (leaving PS and VS Code alive),
  does a `reannounce` reconnect PS?

## Rejected approach: process signal handlers

Considered adding `process.on('SIGTERM'|'SIGINT', …)` in the extension to
force a best-effort `broker.stop()` on abrupt termination. **Rejected**:

- The extension host is a **single shared process for every installed
  extension**. Hooking termination signals without calling `process.exit()`
  ourselves would suppress or delay VS Code's own shutdown for the entire
  process, not just our extension.
- `process.on('exit', …)` only allows synchronous work and does not fire on
  a hard kill (`TerminateProcess` on Windows) at all.
- With H1 falsified, there is no evidence that missing cleanup on abrupt
  kill is even part of the problem.
