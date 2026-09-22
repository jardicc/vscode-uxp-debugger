# Build-Tool REST Hooks

> Reference for developers wiring their own build pipeline (webpack/gulp/npm
> scripts/etc.) into `uxp-debugger2`'s live dev loop. Source:
> [src/vscode/hooks/](../src/vscode/hooks/).

## Overview

The extension already runs a local HTTP server for the UXP broker (the thing
Photoshop/UXP host apps connect to). This server also answers a small set of
plain REST endpoints that let an external build tool trigger the same
actions the control panel offers: refresh, full reload, load, unload, read/
toggle watch mode, and pack (`.ccx`).

This document owns the external build-pipeline contract. For the corresponding
sidebar workflows, see [`CONTROL-PANEL.md`](CONTROL-PANEL.md); for in-process
agent tools, see [`LANGUAGE-MODEL-TOOLS.md`](LANGUAGE-MODEL-TOOLS.md).

There is **no separate server or port** for this — hooks are served on the
same port as the broker.

| | |
| --- | --- |
| Host | `127.0.0.1` only (not reachable from other machines) |
| Port | `14001` (fixed, `DEFAULT_BROKER_PORT`) |
| Path prefix | `/__uxp_debugger__/hooks/` |
| Auth | **None.** Binding to localhost is the trust boundary — same stance as the rest of the broker protocol. Don't expose this port beyond your own machine. |
| Availability | Only while the extension's broker is running (i.e. after "Start UXP Debugger" / on extension activation). If it isn't running, the request fails to connect — that's expected, not a bug. |

Base URL used in the examples below: `http://127.0.0.1:14001`

## Request / response conventions

- All mutating endpoints are `POST` with a JSON body (`Content-Type` is not
  checked, but the body must parse as a JSON object). An endpoint with no
  required fields also accepts an empty body.
- Every response is JSON with an HTTP status code:
  - `200` — success (see each endpoint for the exact shape; always includes `"ok": true`).
  - `400` — bad request (missing/invalid field).
  - `404` — unknown route, or (for `/watch*` and `/pack`) the plugin isn't registered in the panel.
  - `409` — ambiguous: more than one connected app matches the manifest, pass `appId`.
  - `413` — request body too large (>1 MB).
  - `502` — the host app rejected the operation (e.g. refresh/unload failed on a live session).
  - `503` — no connected app matches the manifest's required host app(s).
  - `504` — the request to the host app timed out.
  - `500` — unexpected internal error (also logged to the "UXP Debugger" output channel).
- Every error response has the shape `{ "ok": false, "error": "<message>" }`.
- `manifestPath` is always the **absolute path** to the plugin's
  `manifest.json` on disk — the same value shown in the panel / used by the
  `uxp.*` Language Model Tools.

## Endpoints

### `POST /refresh` — fast in-place reload

Fires `Plugin/reload` for every live session of a manifest. The debugger and
HTML inspector (if attached/open) are left untouched. This is the
lightweight action to call after every incremental build.

#### Refresh request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `manifestPath` | string | yes | Plugin to refresh |
| `sessionId` | string | no | Narrow to one session (only matters if the plugin is loaded into several apps at once) |

#### Refresh success response

```json
{ "ok": true, "sessions": ["<clientSessionId>", "..."] }
```

If the plugin has no live session at all, this is **not an error** — it
resolves `200` with an empty `sessions` array and a `message`, so a
build-watcher can call it unconditionally after every build without
tracking load state itself:

```json
{ "ok": true, "sessions": [], "message": "No live session — nothing to refresh." }
```

---

### `POST /reload` — full reload (unload + load)

Unloads every live session for the manifest and loads it again. If a
debugger was attached, or the HTML inspector was open, on the old session,
both are automatically re-attached/re-opened on the new one. Use this when
a refresh isn't enough (e.g. `manifest.json`, an icon, or a native
`.uxpaddon` changed).

#### Reload request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `manifestPath` | string | yes | Plugin to reload |
| `breakOnLoad` | boolean | no (default `false`) | Load with `breakOnStart` so the host pauses waiting for a debugger |
| `appId` | string | no | Which connected app to load into. Defaults to whichever app the plugin was already loaded into; required if it wasn't loaded anywhere and more than one app matches |

#### Reload success response

```json
{
  "ok": true,
  "sessions": ["<clientSessionId>", "..."],
  "failures": [{ "appId": "PS", "error": "..." }],
  "restoredDebugging": true,
  "restoredInspector": false
}
```

`failures` lists apps the load fanned out to but failed for (only relevant
when the manifest matches more than one connected app and `appId` wasn't
given to pin one).

---

### `POST /load` — load into a connected app

Same underlying call as the "Load Plugin" command / `uxp_load_plugin` LM
tool, without any interactive prompts.

#### Load request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `manifestPath` | string | yes | Plugin to load |
| `breakOnLoad` | boolean | no (default `false`) | Load with `breakOnStart` |
| `appId` | string | no | Required only when more than one connected app matches the manifest's `host` entries |

**200 response** — same shape as `/reload`'s (minus `restoredDebugging`/`restoredInspector`):

```json
{ "ok": true, "sessions": ["<clientSessionId>"], "failures": [] }
```

**Common errors**: `503` (no matching app running/connected — start it and
retry), `409` (ambiguous — pass `appId`, the error message lists the
candidates), `504` (host app didn't answer in time — safe to retry).

---

### `POST /unload` — unload live session(s)

#### Unload request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `manifestPath` | string | yes | Plugin to unload |
| `sessionId` | string | no | Narrow to one session |

#### Unload success response

```json
{ "ok": true, "sessions": ["<clientSessionId>"] }
```

Same idempotency as `/refresh`: no live session → `200` with `sessions: []`,
not an error.

---

### `POST /pack` — build the distributable `.ccx`

Validates `manifest.json`, then zips the plugin folder (no exclusion rules
— the whole folder is packed as-is, same as the panel's "Pack…" action).

Only plugins **already registered in the panel's list** can be packed, and
`outputPath` **must end with `.ccx`** — this endpoint is unauthenticated
(localhost-only), so it refuses to write arbitrary files for arbitrary
manifests.

#### Pack request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `manifestPath` | string | yes | Plugin to pack (must be registered in the panel) |
| `outputPath` | string | yes | Absolute destination path ending with `.ccx` (overwritten if it already exists) |
| `host` | string | no | Which `host` app to target in the packed manifest, only needed when `manifest.json`'s `host` field is a multi-entry array (dev-only) |

#### Pack success response

```json
{ "ok": true, "name": "My Plugin", "outputPath": "C:\\out\\my-plugin-1.0.0.ccx" }
```

**400** if `outputPath` doesn't end with `.ccx`, the manifest fails
validation, or the host is ambiguous and `host` wasn't given (the error
lists the available host names).

**404** if `manifestPath` isn't registered in the panel — same rule as the
`/watch*` endpoints: add it there first, then retry.

---

### `GET /watch?manifestPath=...` — read watch-mode state

Reads the persisted watch flag for a plugin **already added to the panel's
plugin list** (`PluginRegistry`) — this endpoint does not add it for you.

#### Watch-state success response

```json
{ "ok": true, "watch": true, "watcherActive": true }
```

- `watch` — the persisted on/off flag (survives restarts, same as the
  panel's eye icon).
- `watcherActive` — `watch` is `true` **and** the plugin currently has a
  live session (a file watcher is only actually created while it does —
  see `PluginWatchManager`).

**404** if `manifestPath` isn't registered in the panel yet — add it there
(or via `uxp.loadPlugin`) first.

---

### `POST /watch/enable` / `POST /watch/disable`

Toggles the same persisted flag as `GET /watch`.

#### Watch-toggle request body

| Field | Type | Required |
| --- | --- | --- |
| `manifestPath` | string | yes |

#### Watch-toggle success response

```json
{ "ok": true, "watch": true }
```

**404** — same "not registered in the panel" rule as `GET /watch`.

## Examples

```bash
# Fast refresh after an incremental build
curl -X POST http://127.0.0.1:14001/__uxp_debugger__/hooks/refresh \
  -H "Content-Type: application/json" \
  -d '{"manifestPath":"C:\\plugins\\my-plugin\\manifest.json"}'

# Full reload, pin a specific host app
curl -X POST http://127.0.0.1:14001/__uxp_debugger__/hooks/reload \
  -H "Content-Type: application/json" \
  -d '{"manifestPath":"C:\\plugins\\my-plugin\\manifest.json","appId":"PS"}'

# Read watch state
curl "http://127.0.0.1:14001/__uxp_debugger__/hooks/watch?manifestPath=C:\\plugins\\my-plugin\\manifest.json"

# Pack a .ccx as part of a release script (plugin must be registered in the panel)
curl -X POST http://127.0.0.1:14001/__uxp_debugger__/hooks/pack \
  -H "Content-Type: application/json" \
  -d '{"manifestPath":"C:\\plugins\\my-plugin\\manifest.json","outputPath":"C:\\out\\my-plugin.ccx"}'
```

A typical `package.json` watch/build script would call `/refresh` after
every successful incremental build and ignore connection errors (broker not
running yet is a normal state, not a build failure).

## Extending this API

New routes are added by creating a handler module in
[src/vscode/hooks/](../src/vscode/hooks/) and wiring it into the `if/else`
chain in [hooksRouter.ts](../src/vscode/hooks/hooksRouter.ts) — reuse the
existing `HookDependencies` bundle and the `hooksHttp.ts` request/response
helpers (`requireStringField`, `optionalStringField`, `optionalBooleanField`,
`HookRequestError`, `sendJson`) rather than parsing the request by hand.
