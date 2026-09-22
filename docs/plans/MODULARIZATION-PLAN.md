# Modularization & Cross-IDE Reuse Plan

> **Audience:** developers and AI coding agents implementing this refactor.
> **Goal:** extract the reusable parts of this VS Code extension into standalone,
> publishable npm packages, and make the code usable from IDEs other than VS Code.
>
> **Status:** proposal / not started. Nothing in this document has been implemented yet.
>
> Related docs: [UXP-DEBUGGER-ARCHITECTURE.md](../UXP-DEBUGGER-ARCHITECTURE.md) (§1.2 decision record),
> [CONTROL-PANEL.md](../CONTROL-PANEL.md), [UI-DEBUGGING.md](../UI-DEBUGGING.md),
> [MULTI-WINDOW-TAKEOVER.md](../MULTI-WINDOW-TAKEOVER.md).

---

## 1. Current-state analysis

### 1.1 Verified facts

These were verified by static inspection of the tree (not assumptions):

| Fact | Evidence |
| --- | --- |
| `src/core/**` contains **zero** `vscode` imports | grep `from "vscode"` → 28 hits, all under `src/vscode/**` |
| Core's only non-Node deps are `ws`, `adm-zip`, `ts-blank-space`, `typescript` (type-only) | import scan of `src/core/**` |
| Core already has a host-agnostic event primitive | [src/core/events.ts](src/core/events.ts) — `TypedEvent<T>` |
| Core already accepts an injected logger | `UxpBrokerOptions.log?: (message: string) => void` in [src/core/broker/UxpBroker.ts](src/core/broker/UxpBroker.ts) |
| Core already abstracts the native layer behind interfaces | [src/core/vulcan/IPortAnnouncer.ts](src/core/vulcan/IPortAnnouncer.ts), [src/core/vulcan/IHostAppController.ts](src/core/vulcan/IHostAppController.ts) |
| The CDP proxy has only **8** `vscode.*` references across **4** files | see §1.3 |
| The build is a single monolithic esbuild bundle with no `.d.ts` emit | `package.json` → `scripts.compile`, `tsconfig.json` → `"noEmit": true` |

### 1.2 Layer map

```
src/core/            ← already portable, pure Node
  broker/            AppConnection, CdtTunnel, SessionRegistry, UxpBroker, identify, takeover
  protocol/          messages.ts, types.ts   (types only)
  manifest/          manifest.ts, appMatching.ts
  pack/              packPlugin.ts           (adm-zip)
  devmode/           devMode.ts              (fs, path)
  vulcan/            addonLoader, VulcanAnnouncer, VulcanHostAppController, hostAppCatalog
  stripTypeScript.ts                         (fs, os, path, ts-blank-space)
  errors.ts, events.ts

src/vscode/          ← host layer, but NOT all of it is host-specific
  proxy/             ⚠ portable (only logger + 2 notifications)
  panel/panelProtocol.ts   ⚠ portable (types only, documented as such)
  panel/PluginRegistry.ts  ⚠ portable (already uses a Memento subset interface)
  panel/webview/     ⚠ portable behind a message-transport abstraction
  inspector/host/    ⚠ portable (browser bundle, no extension-host API)
  UxpService.ts            host-specific
  panel/PanelController.ts host-specific (~50 vscode.* calls)
  panel/PluginWatchManager.ts host-specific (FileSystemWatcher)
  debug/**                 host-specific (vscode.debug)
  ui/**                    host-specific (dialogs, quick picks, output channels)
  commands/**              host-specific (command registration)
  extension.ts             host-specific (activate/deactivate wiring)
```

### 1.3 Exact `vscode` coupling in the proxy layer

This is the whole surface that must be removed to make the proxy standalone:

| File | Line | Usage |
| --- | --- | --- |
| [src/vscode/proxy/cdpProxy.ts](src/vscode/proxy/cdpProxy.ts) | 54 | `private readonly log: vscode.OutputChannel` |
| | 149 | `log: vscode.OutputChannel` (ctor param) |
| | 792 | `vscode.window.showErrorMessage(...)` |
| [src/vscode/proxy/cdpMessageRewriter.ts](src/vscode/proxy/cdpMessageRewriter.ts) | 92 | `private readonly log: vscode.OutputChannel` |
| | 131 | `vscode.window.showWarningMessage(...)` |
| [src/vscode/proxy/CdpProxyRegistry.ts](src/vscode/proxy/CdpProxyRegistry.ts) | 21 | `constructor(private readonly log: vscode.OutputChannel)` |
| [src/vscode/proxy/sourceMapRewriter.ts](src/vscode/proxy/sourceMapRewriter.ts) | 283, 338 | `log: vscode.OutputChannel` (fn params) |

Six of the eight are just the **type** `OutputChannel` used as a logger.

### 1.4 Blockers for reuse

1. **Native Vulcan addon.** [src/core/vulcan/addonLoader.ts](src/core/vulcan/addonLoader.ts)
   loads prebuilt `.node` N-API binaries for `win32-x64`, `darwin-x64`,
   `darwin-arm64` only. Packaged by [scripts/prepare-native.mjs](scripts/prepare-native.mjs).
   This requires a Node/Electron process and blocks Linux + non-Node IDEs.
2. **Monolithic build.** `esbuild src/vscode/extension.ts --bundle` produces one
   `dist/extension.js`. No package boundaries, no declaration files, no `exports` map.
3. **js-debug delegation.** [src/vscode/debug/UxpDebugSessionManager.ts](src/vscode/debug/UxpDebugSessionManager.ts)
   calls `vscode.debug.startDebugging` with a `pwa-chrome` config. Other IDEs
   have their own CDP/DAP clients and cannot reuse this.
4. **Panel UI transport.** [src/vscode/panel/webview/vscodeApi.ts](src/vscode/panel/webview/vscodeApi.ts)
   hard-codes `acquireVsCodeApi()`.

---

## 2. Target architecture

```
uxp-debugger2/                       (npm workspaces root)
├── packages/
│   ├── core/            @uxp-tools/core          ← src/core, verbatim + host ports
│   ├── cdp-proxy/       @uxp-tools/cdp-proxy     ← src/vscode/proxy
│   ├── ui-protocol/     @uxp-tools/ui-protocol   ← panelProtocol.ts + PluginRegistry
│   ├── panel-ui/        @uxp-tools/panel-ui      ← React panel (webview/)
│   ├── server/          @uxp-tools/server        ← NEW: headless JSON-RPC daemon
│   └── dap/             @uxp-tools/dap           ← NEW: Debug Adapter Protocol server
└── extensions/
    └── vscode/          uxpdebugger               ← src/vscode minus the above
```

Dependency direction (never inverted):

```
      ui-protocol ──────────────┐
           ▲                    │
           │                    ▼
core ──► cdp-proxy ──► server ──► dap
  ▲          ▲            ▲
  └──────────┴────────────┴──── extensions/vscode
                               panel-ui ──► ui-protocol
```

**Rule:** no package under `packages/` may import `vscode` or declare it as a
dependency (dev or otherwise). Enforced by lint rule in §8.

---

## 3. Phase 2 — Decouple the CDP proxy (do this first)

Highest value / lowest risk. Do it **before** the monorepo split so it can land
as an isolated, reviewable change.

### 3.1 Add host ports to core

Create `src/core/host/ports.ts`:

```ts
/**
 * Host-agnostic capability ports. Every IDE integration implements these;
 * core and cdp-proxy depend on the interfaces only.
 */

export interface Logger {
  log(message: string): void;
}

export interface UserNotifier {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Discards everything. Default for headless/embedded use. */
export const NOOP_LOGGER: Logger = { log: () => {} };
export const NOOP_NOTIFIER: UserNotifier = {
  info: () => {}, warn: () => {}, error: () => {},
};
```

### 3.2 Rewrite the proxy files

For each of the four files in [src/vscode/proxy](src/vscode/proxy):

1. Delete `import * as vscode from "vscode";`.
2. Replace `vscode.OutputChannel` → `Logger`.
3. Replace `this.log.appendLine(x)` → `this.log.log(x)`.
   (Consider naming the field `logger` to avoid `log.log`; a rename is optional
   but keeps call sites readable.)
4. Replace `vscode.window.showErrorMessage(m)` → `this.notifier.error(m)`.
5. Replace `vscode.window.showWarningMessage(m)` → `this.notifier.warn(m)`.
6. Add a `notifier: UserNotifier = NOOP_NOTIFIER` constructor parameter to
   `CdpProxyServer` and `CdpMessageRewriter`; thread it from `CdpProxyRegistry`.

`sourceMapRewriter.ts` only needs the type swap on lines 283 and 338 — it has no
notification calls.

### 3.3 Add the VS Code adapter

Create `src/vscode/ui/hostPorts.ts`:

```ts
import * as vscode from "vscode";
import type { Logger, UserNotifier } from "../../core/host/ports";

export class VsCodeLogger implements Logger {
  constructor(private readonly channel: vscode.OutputChannel) {}
  log(message: string): void { this.channel.appendLine(message); }
}

export const vsCodeNotifier: UserNotifier = {
  info: (m) => void vscode.window.showInformationMessage(m),
  warn: (m) => void vscode.window.showWarningMessage(m),
  error: (m) => void vscode.window.showErrorMessage(m),
};
```

Wire it in [src/vscode/extension.ts](src/vscode/extension.ts) where
`CdpProxyRegistry` is constructed.

### 3.4 Acceptance criteria

- `grep -r "vscode" src/vscode/proxy/` returns nothing.
- `npm run typecheck` clean.
- `npm run test` (vitest, `test/proxy/**`) passes unchanged.
- `npm run test:e2e:live` (Photoshop) passes — the proxy is on the critical path
  for every debug session, so a live run is mandatory before merge.

---

## 4. Phase 1 — Monorepo split

### 4.1 Root `package.json`

```jsonc
{
  "name": "uxp-tools-monorepo",
  "private": true,
  "workspaces": ["packages/*", "extensions/*"],
  "scripts": {
    "build": "tsc --build",
    "typecheck": "tsc --build --dry",
    "test": "vitest run",
    "lint": "eslint packages extensions --ext ts,tsx"
  }
}
```

### 4.2 Per-package `tsconfig.json`

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": false
  },
  "include": ["src/**/*.ts"]
}
```

Root `tsconfig.json` becomes a solution file with `references` to every package.
Keep the existing strictness flags (`strict`, `noUnusedLocals`,
`noUnusedParameters`) in `tsconfig.base.json`.

### 4.3 Per-package `exports` map

```jsonc
{
  "name": "@uxp-tools/core",
  "version": "0.1.0",
  "license": "MIT",
  "type": "commonjs",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["dist"],
  "engines": { "node": ">=18" }
}
```

Each package gets an explicit `src/index.ts` barrel. **Only what is listed in
the barrel is public API.** Do not add deep-path exports to the `exports` map.

### 4.4 File moves (mechanical)

| From | To |
| --- | --- |
| `src/core/**` | `packages/core/src/**` |
| `src/vscode/proxy/**` | `packages/cdp-proxy/src/**` |
| `src/vscode/panel/panelProtocol.ts` | `packages/ui-protocol/src/panelProtocol.ts` |
| `src/vscode/panel/PluginRegistry.ts` | `packages/ui-protocol/src/PluginRegistry.ts` |
| `src/vscode/panel/webview/**` | `packages/panel-ui/src/**` |
| `src/vscode/**` (rest) | `extensions/vscode/src/**` |
| `test/core/**`, `test/broker/**`, … | co-located `packages/*/test/**` |
| `e2e/**` | `extensions/vscode/e2e/**` |

Rewrite relative imports to package specifiers (`../core/broker/UxpBroker` →
`@uxp-tools/core`). A codemod with `ts-morph` is recommended over hand-editing.

### 4.5 Extension build

`extensions/vscode/package.json` keeps the current esbuild pipeline; workspace
packages resolve via `node_modules` symlinks and get bundled into
`dist/extension.js` as before. No change to the `.vsix` shape.

### 4.6 Acceptance criteria

- `npm run build` at root produces `dist/` with `.d.ts` in every package.
- `npm run test` passes with the same test count as before the split.
- `npx vsce package` in `extensions/vscode` produces a working `.vsix`.
- `npx publint` and `npx @arethetypeswrong/cli` clean for every package.

---

## 5. Phase 3 — Full host-port abstraction

Extract the remaining reusable logic out of the VS Code layer, one port at a time.
Each port is an independent, shippable change.

### 5.1 Port catalogue

| Port | Replaces | Current implementation |
| --- | --- | --- |
| `Logger` | `OutputChannel` | done in Phase 2 |
| `UserNotifier` | `show{Information,Warning,Error}Message` | [src/vscode/ui/dialogs.ts](src/vscode/ui/dialogs.ts) |
| `Prompter` | `showQuickPick`, `showInputBox`, `showOpenDialog` | [src/vscode/ui/picks.ts](src/vscode/ui/picks.ts) |
| `KeyValueStore` | `Memento` | already a subset interface in `PluginRegistry` |
| `WorkspaceProvider` | `workspaceFolders`, `activeTextEditor` | [src/vscode/panel/PanelController.ts](src/vscode/panel/PanelController.ts) |
| `FileWatcher` | `createFileSystemWatcher`, `RelativePattern` | [src/vscode/panel/PluginWatchManager.ts](src/vscode/panel/PluginWatchManager.ts) |
| `EditorNavigator` | `openTextDocument` + `showTextDocument` | `PanelController` |
| `DebugLauncher` | `vscode.debug.startDebugging` / `stopDebugging` | [src/vscode/debug/UxpDebugSessionManager.ts](src/vscode/debug/UxpDebugSessionManager.ts) |
| `Disposable` / `Event<T>` | `vscode.Disposable`, `vscode.EventEmitter` | `TypedEvent` already exists |

### 5.2 Suggested signatures

```ts
export interface Prompter {
  pick<T>(items: readonly PickItem<T>[], options?: PickOptions): Promise<T | undefined>;
  input(options: InputOptions): Promise<string | undefined>;
  pickFile(options: FilePickOptions): Promise<string | undefined>;
  pickSaveLocation(options: SavePickOptions): Promise<string | undefined>;
  confirm(message: string, confirmLabel: string): Promise<boolean>;
}

export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Promise<void>;
}

export interface WorkspaceProvider {
  readonly folders: readonly string[];
  readonly activeFilePath: string | undefined;
  readonly onDidChangeFolders: Event<void>;
  readonly onDidChangeActiveFile: Event<void>;
  getSetting<T>(section: string, key: string): T | undefined;
  updateSetting(section: string, key: string, value: unknown): Promise<void>;
}

export interface FileWatcher {
  watch(rootDir: string, glob: string, onChange: (path: string) => void): Disposable;
}

export interface DebugLauncher {
  /** Start a CDP-attach debug session against `wsUrl`. Resolves to a handle. */
  attachCdp(config: CdpAttachConfig): Promise<DebugHandle | undefined>;
  readonly onDidTerminate: Event<DebugHandle>;
}
```

### 5.3 Migration of `UxpService` and `PanelController`

Once the ports exist, move the orchestration logic:

- `src/vscode/UxpService.ts` → `packages/core/src/UxpSessionOrchestrator.ts`
  - swap the five `vscode.EventEmitter` fields for `TypedEvent`
  - replace `context.extensionPath` with an injected `nativeRoot: string`
  - replace `portInUseDialog` / `takeoverConfirmDialog` calls with `Prompter.confirm`
  - the VS Code `UxpService` becomes a thin `TypedEvent → vscode.EventEmitter` adapter
- `src/vscode/panel/PanelController.ts` → split
  - `packages/ui-protocol/src/PanelStateBuilder.ts` — pure snapshot assembly
  - `packages/server/src/PanelActionHandler.ts` — `PanelAction` dispatch using ports
  - the VS Code `PanelController` keeps only webview plumbing and port construction

> **Note:** `PanelController` has ~50 `vscode.*` call sites. Do **not** attempt
> this in one commit. Migrate one `PanelAction` kind at a time, keeping the
> existing tests in `test/panel/**` green after each step.

---

## 6. Phase 4 — Native addon as an optional dependency

### 6.1 Split into platform packages

```
@uxp-tools/vulcan-win32-x64
@uxp-tools/vulcan-darwin-x64
@uxp-tools/vulcan-darwin-arm64
```

Each ships `node-napi.node` plus its sidecar DLLs/dylibs (`AID`, `VulcanControl`,
`VulcanMessage5`) and declares `os` / `cpu` fields so npm skips irrelevant ones.

In `@uxp-tools/core`:

```jsonc
"optionalDependencies": {
  "@uxp-tools/vulcan-win32-x64": "0.1.0",
  "@uxp-tools/vulcan-darwin-x64": "0.1.0",
  "@uxp-tools/vulcan-darwin-arm64": "0.1.0"
}
```

`addonLoader.ts` gains a resolution order:
1. explicit `nativeRoot` argument (current behaviour — the VS Code extension
   keeps using its bundled `native/` folder)
2. `require.resolve("@uxp-tools/vulcan-<platform>-<arch>")`
3. throw `NativeAddonUnavailableError` (already exists)

### 6.2 Add a no-Vulcan fallback mode

Required for Linux, CI, and any non-Adobe-supported platform. Implement
`StaticPortAnnouncer implements IPortAnnouncer` that performs no IPC — the
broker binds a fixed port and the host app is told about it out of band
(env var, or the user configures it manually in the host).

This unblocks:
- unit + integration tests on Linux CI runners
- headless server deployments
- contributors without Photoshop installed

### 6.3 Acceptance criteria

- `npm install @uxp-tools/core` on Linux succeeds (optional deps skipped).
- `new UxpBroker({ announcer: new StaticPortAnnouncer(14001) })` starts and
  accepts a WebSocket connection on Linux.
- The `.vsix` still contains the `native/` folder and behaves identically.

---

## 7. Cross-IDE reuse

### 7.1 Tier A — Node-hosted, VS Code API compatible

**Cursor, Windsurf, VSCodium, Eclipse Theia, code-server.**

Work required: **none beyond Phases 1–4.** These hosts implement the `vscode`
API. Repackage `extensions/vscode` and publish to Open VSX in addition to the
VS Marketplace.

Add to `extensions/vscode/package.json`:
```jsonc
"scripts": { "publish:ovsx": "ovsx publish" }
```

### 7.2 Tier B — Node available, different extension API

**Sublime Text (via a Node sidecar), Zed (via its extension host), Emacs, Neovim.**

Requires `@uxp-tools/server`: a headless daemon.

- Transport: JSON-RPC 2.0 over stdio (default) or a loopback WebSocket.
- **The RPC surface is already designed.** [src/vscode/panel/panelProtocol.ts](src/vscode/panel/panelProtocol.ts)
  defines `PanelAction` (client → host) and the state snapshot (host → client).
  Reuse it verbatim as the wire protocol; `PanelAction.kind` maps 1:1 to RPC
  method names.
- The daemon constructs `UxpSessionOrchestrator` with:
  - `Logger` → stderr
  - `UserNotifier` → `notification` JSON-RPC notifications back to the client
  - `Prompter` → **request/response** JSON-RPC calls back to the client
    (the client renders native UI and answers)
  - `KeyValueStore` → a JSON file under the OS config dir
  - `WorkspaceProvider`, `FileWatcher` → `chokidar` + explicit root config
  - `DebugLauncher` → returns the CDP proxy URL instead of starting a session

Distribution: publish as an npm package **and** as a single-file executable via
`node --experimental-sea-config` so clients don't need a Node toolchain.

### 7.3 Tier C — No Node runtime

**JetBrains (WebStorm, IntelliJ), Xcode, Visual Studio.**

Same `@uxp-tools/server` daemon, spawned as a child process by a native plugin
(Kotlin/Java for JetBrains). The IDE plugin is a thin RPC client + native UI.

For JetBrains specifically:
- ship the SEA binary inside the plugin `.zip`
- UI: the React panel can run in JCEF (see §7.5)
- debugging: point the built-in JavaScript debugger at the CDP proxy URL (§7.4)

### 7.4 Debugging across IDEs — two integration points

**Option 1 (cheap, recommended first): expose the CDP endpoint.**

`CdpProxyRegistry.acquire()` already returns `{ proxy, port }`. The daemon
surfaces `ws://127.0.0.1:<port>` over RPC. Any IDE with a Chrome debugger
(JetBrains "Attach to Node.js/Chrome", `nvim-dap` + `vscode-js-debug`,
Chrome DevTools standalone) can attach to it directly.

**Option 2 (universal, more work): `@uxp-tools/dap`.**

A standalone Debug Adapter Protocol server. Consumed by any DAP client without
custom per-IDE debug code. Build it on top of `vscode-js-debug` **as a library**
(it publishes a standalone DAP binary) rather than reimplementing CDP↔DAP
translation. This replaces the `vscode.debug.startDebugging` delegation in
`UxpDebugSessionManager` with a spawn + stdio pipe.

> **Decision point:** implement Option 1 first and only build Option 2 if
> real-world Tier B/C users report that manual CDP attach is too awkward.

### 7.5 Panel UI portability

[src/vscode/panel/webview/vscodeApi.ts](src/vscode/panel/webview/vscodeApi.ts)
is the only VS Code coupling in the React app. Replace it with:

```ts
export interface MessageTransport {
  post(message: PanelAction): void;
  onMessage(handler: (message: PanelStateMessage) => void): () => void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}
```

Implementations:
- `VsCodeTransport` — wraps `acquireVsCodeApi()` (current behaviour)
- `WebSocketTransport` — for JCEF / browser / Electron shells
- `PostMessageTransport` — for plain iframes

Styling already uses VS Code CSS custom properties; add a fallback theme
stylesheet for non-VS Code hosts.

---

## 8. Guardrails

Add to the ESLint config, scoped to `packages/**`:

```jsonc
{
  "rules": {
    "no-restricted-imports": ["error", {
      "paths": [{ "name": "vscode", "message": "packages/** must stay host-agnostic. Use a host port from @uxp-tools/core." }]
    }]
  }
}
```

CI must run, per package: `tsc --build`, `eslint`, `vitest run`, `publint`,
`attw --pack`.

---

## 9. Recommended order

| # | Phase | Rationale |
| --- | --- | --- |
| 1 | **Phase 2** — decouple `cdp-proxy` | Best value/cost ratio, 8 call sites, no structural change, independently reviewable |
| 2 | **Phase 1** — monorepo split | Prerequisite for publishing anything |
| 3 | **Phase 4** — optional native addon | Unblocks Linux CI and contributors without Adobe apps |
| 4 | **Phase 3** — host ports | Largest refactor; do it port by port, never in one commit |
| 5 | **Phase 5** — publish `@uxp-tools/core` + `@uxp-tools/cdp-proxy` | Only once the API has stabilised |
| 6 | `@uxp-tools/server` | Gated on demand from a real Tier B/C integrator |
| 7 | `@uxp-tools/dap` | Gated on §7.4 decision point |

---

## 10. Open questions

- **npm scope.** `@uxp-tools/*` is a placeholder. Confirm availability, or pick
  a scope tied to the existing publisher identity.
- **License.** The repo is MIT ([LICENSE.md](LICENSE.md)), but the native Vulcan
  binaries and anything derived from `uxp-cli-v1/` or `uxp-UDT-v2/` may carry
  Adobe terms. **Legal review is required before publishing the native
  packages to a public registry.** Until that clears, ship `@uxp-tools/core`
  with the native layer as an optional dependency that users install separately.
- **Module format.** CJS-only is simplest (matches the extension host). Dual
  ESM/CJS adds build complexity; defer until a consumer actually needs ESM.
- **`vscode-edge-devtools/` and `legacy/`.** Out of scope for this plan —
  confirm whether they are vendored references or live code before the monorepo
  move touches them.
