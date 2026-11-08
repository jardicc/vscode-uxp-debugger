# Changelog

## [2.3.0](https://github.com/jardicc/vscode-uxp-debugger/compare/v2.2.0...v2.3.0) (2026-11-08)


### New Features

* add exclusion rules for packing plugin folders and validate outputPath extension ([30357f5](https://github.com/jardicc/vscode-uxp-debugger/commit/30357f586003dc92e273c9d7cd83cb9712f4c06e))
* enhance Content Security Policy for inspector and add tests for enforcement ([f9d9eec](https://github.com/jardicc/vscode-uxp-debugger/commit/f9d9eece34552a7e514f6969b880bc31bf6cd06c))
* enhance HTTP request handling with security checks and error responses ([656cc72](https://github.com/jardicc/vscode-uxp-debugger/commit/656cc7247e31e4d7e366e891e94c0b088586ac70))
* ignore dotfile changes in file watcher ([f0e53cf](https://github.com/jardicc/vscode-uxp-debugger/commit/f0e53cf426a1c25c8c3db294894e5b43e5198f8a))
* implement security checks for WebSocket upgrades and UUID-based session IDs ([8765a24](https://github.com/jardicc/vscode-uxp-debugger/commit/8765a24acc0952308b61507f933266b9b329493d))
* integrate @jridgewell/trace-mapping for source map resolution in console and exception handling ([d40a5d6](https://github.com/jardicc/vscode-uxp-debugger/commit/d40a5d6bc1052b93daf485b307df374f2bdcd490))


### Bug Fixes

* add compare-versions package and refactor version comparison logic ([4da4a02](https://github.com/jardicc/vscode-uxp-debugger/commit/4da4a026897680b902fe8b234bed68f57bea52aa))
* break on load tracing ([dd3ae40](https://github.com/jardicc/vscode-uxp-debugger/commit/dd3ae40b603d8f34ec1dde0b433342799122cc27))
* clipboard functionality in HTML DOM inspector view on Macos ([3a17907](https://github.com/jardicc/vscode-uxp-debugger/commit/3a179077d41600f9f598b131d48289c02fe5a8a2))
* disables clipboard shim ([eed5a4b](https://github.com/jardicc/vscode-uxp-debugger/commit/eed5a4b51ae2f1ca476ee142753e716253b93ee9))
* enhance app matching and host app catalog functionality with case-insensitive comparisons and canonicalization ([3d8f4ce](https://github.com/jardicc/vscode-uxp-debugger/commit/3d8f4ce9fdccf570de414e389e24d0f6ef670491))
* enhance probePauseSnapshot to handle empty stack frames ([4694fb7](https://github.com/jardicc/vscode-uxp-debugger/commit/4694fb7a573439411f96329ae2cf09194943bda7))
* fix absolute sourcemap paths on macos ([d666765](https://github.com/jardicc/vscode-uxp-debugger/commit/d66676533bda6ad8d7e6f37111f15a46c94d44fb))
* implement path case folding for breakpoint tools ([e303b64](https://github.com/jardicc/vscode-uxp-debugger/commit/e303b642778f9dd2fd07bc12e3f049775e084e24))
* implements escaping of characters in elevation command when dev mode is enabled ([077edc8](https://github.com/jardicc/vscode-uxp-debugger/commit/077edc843fa5e3906b5f79d36ed84779a9051088))
* improve session handling in UxpBroker, cleanup closed sessions ([c5a3454](https://github.com/jardicc/vscode-uxp-debugger/commit/c5a34546d4dc7715fdd3ab3fed9c2225c4d5547b))
* Improves source map detection ([4b24902](https://github.com/jardicc/vscode-uxp-debugger/commit/4b24902a1047b59d4cdc87842b8aad87eb9a262f))
* integrate DebugProtocol types and enhance pause tracking functionality ([cc79430](https://github.com/jardicc/vscode-uxp-debugger/commit/cc79430f6b9604b6ff58c38cb506458dedcb4fa3))
* prevent crash of host app during script debugging, improve logging and tests ([f63453e](https://github.com/jardicc/vscode-uxp-debugger/commit/f63453e4a8f0e67fbffdb70b24454d36fb9f2b19))
* prevent race conditions and duplicated debug connections ([c6f8892](https://github.com/jardicc/vscode-uxp-debugger/commit/c6f8892bbb559a49fab1fd9538a2486bf04b6145))
* specify TypeScript support for UXP scripts in package.json ([657950a](https://github.com/jardicc/vscode-uxp-debugger/commit/657950a666eb66c7033761160982ccbe393d1fd8))
* update PauseTracker to reject pending waiters on session forget ([d0a3f83](https://github.com/jardicc/vscode-uxp-debugger/commit/d0a3f837df07b9bd130ef27c32601116602d153a))
* various fixes and documentation improvements ([521bd5e](https://github.com/jardicc/vscode-uxp-debugger/commit/521bd5e5161cf95459c938e744d13339a98d96c7))


### Changed

* improve comments for debug session termination logic in debugScriptCommand ([83218bf](https://github.com/jardicc/vscode-uxp-debugger/commit/83218bfb142cc00cc26ce7c0fe79a4dde0a4fd51))
* improves logging ([8557140](https://github.com/jardicc/vscode-uxp-debugger/commit/8557140390001cfb63c162c46cb95a86b607c222))
* remove deprecated `uxp.manifests` setting and clean up related code ([43aa1a2](https://github.com/jardicc/vscode-uxp-debugger/commit/43aa1a204d638be3aa0a5e3e781f87153a35a2ef))
* remove unused inspector host and message router files ([978d57d](https://github.com/jardicc/vscode-uxp-debugger/commit/978d57dccfb6114625de78fb4b6e7914e16a38b1))
* simplifies logging ([c0880c8](https://github.com/jardicc/vscode-uxp-debugger/commit/c0880c8d4d58053343ca993ee81fbdce010e76d5))


### Documentation

* add video tutorial section to README ([266348c](https://github.com/jardicc/vscode-uxp-debugger/commit/266348c4860b0c9bdf489c209062df5e1df5bc65))
* clarify comments for Watch toggle and PluginView interface in panelProtocol.ts ([a932dd7](https://github.com/jardicc/vscode-uxp-debugger/commit/a932dd7d5664c010cd7bc760ac28e83f82bd31bb))
* enhance README with debugging visuals and instructions ([c367952](https://github.com/jardicc/vscode-uxp-debugger/commit/c36795270bad156055562096a7e4d1c7cd504b49))
* update readme ([09c9e93](https://github.com/jardicc/vscode-uxp-debugger/commit/09c9e930dfd5f637cbefa6d47455f20717c845e6))
* update README ([7da7301](https://github.com/jardicc/vscode-uxp-debugger/commit/7da73012f38fe07e7cade73ce5c898929bb3cbd4))
* update readme ([#30](https://github.com/jardicc/vscode-uxp-debugger/issues/30)) ([e88b5b8](https://github.com/jardicc/vscode-uxp-debugger/commit/e88b5b80d1a1bc2b60caef0f144c75ac85a21a02))
* update README formatting for debugging visuals ([ce981e2](https://github.com/jardicc/vscode-uxp-debugger/commit/ce981e2dbc6c4eb17740737c5fa61ae5674c70fa))
* Updates info how to solve issues with source maps ([79c3351](https://github.com/jardicc/vscode-uxp-debugger/commit/79c33519483aca459476bf46c4c46f17ecdf6fb8))
* updates readme ([7d206ef](https://github.com/jardicc/vscode-uxp-debugger/commit/7d206ef6d7d9be2b396a6b1d5c698bafd7c66861))

## [2.2.0](https://github.com/jardicc/vscode-uxp-debugger/compare/v2.1.0...v2.2.0) (2026-10-07)


### New Features

* adds warning for possible InDesign crash ([b036c23](https://github.com/jardicc/vscode-uxp-debugger/commit/b036c23c88e4101ad3d2f3fccc9d79d0905faadf))
* improves way how launch.json config is generated ([59b4ca3](https://github.com/jardicc/vscode-uxp-debugger/commit/59b4ca3879718ba08e3b78da2dd122e8129f8912))
* open script file by clicking its row ([ccbf629](https://github.com/jardicc/vscode-uxp-debugger/commit/ccbf629912247502daab5415d14a6813bbc44aaa))
* Small improvements ([a8d97c5](https://github.com/jardicc/vscode-uxp-debugger/commit/a8d97c5c9ff46d28bb2320ffc8ccd0c00d76c2ef))


### Bug Fixes

* add missing newline at end of settings.json ([1ef0060](https://github.com/jardicc/vscode-uxp-debugger/commit/1ef0060c000f4c5d6d64bd5ca37434173b0ecc14))
* improve handling of uninstalled script targets and update ScriptsSection to manage installed apps ([07038af](https://github.com/jardicc/vscode-uxp-debugger/commit/07038af69d079cff98e7a904b539b07e06136639))


### Performance

* improves startup time ([354a7be](https://github.com/jardicc/vscode-uxp-debugger/commit/354a7bed4fa93c74b18d3d99ae58e61524bf801e))


### Changed

* centralize scripts extensions ([e5c60b0](https://github.com/jardicc/vscode-uxp-debugger/commit/e5c60b02a5541629e6480bc09f0d79d56aee8e9e))
* code cleaning ([ca50a9c](https://github.com/jardicc/vscode-uxp-debugger/commit/ca50a9c2f3df3474d5ea66e44285de15eb33ebb6))
* enhance App component structure and introduce BrokerStatus components ([582391c](https://github.com/jardicc/vscode-uxp-debugger/commit/582391c850c7196a601d96da7477dba902fabe90))
* enhance component structure by consolidating props and improving state management across App, AppsSection, PluginsSection, and ScriptsSection ([7e7a1e6](https://github.com/jardicc/vscode-uxp-debugger/commit/7e7a1e649ba68b8e75f3174ce3bca5bfc78ca56c))
* implement script catalog for UXP script file types and host-specific extensions ([a15ff33](https://github.com/jardicc/vscode-uxp-debugger/commit/a15ff333d001771c62f0ae7b9afb6056bab5da7e))
* implement ToggleIconButton component and update plugin/script rows to use it ([c6ab696](https://github.com/jardicc/vscode-uxp-debugger/commit/c6ab69662f9eb1f54ef3d10ac6e49316cc159b2e))
* migrate common components to a dedicated directory and files ([c410f71](https://github.com/jardicc/vscode-uxp-debugger/commit/c410f71a3d3151b2fd2e57fbcd55f021b23b6dcf))
* streamline path handling and improve code readability across components ([75391f3](https://github.com/jardicc/vscode-uxp-debugger/commit/75391f3a79e63ec261cdea767765068c77e2f5d2))


### Documentation

* adds known issue ([6031291](https://github.com/jardicc/vscode-uxp-debugger/commit/60312910c6aaa0b4dddea86aeb76eea5c2c365d0))
* adds known issue ([be0717e](https://github.com/jardicc/vscode-uxp-debugger/commit/be0717e92976cfbc262a4872ed63baa9cd63ca18))
* clarify script targeting and host app compatibility in README and documentation ([6c0fa14](https://github.com/jardicc/vscode-uxp-debugger/commit/6c0fa14ee4205b93ac3df8d49d29bd6343f77e5b))
* update issue tracking description for host app startup hang ([41978b6](https://github.com/jardicc/vscode-uxp-debugger/commit/41978b64326a793170bb8963e9b9520e1f7913bc))

## [2.1.0](https://github.com/jardicc/vscode-uxp-debugger/compare/v2.0.2...v2.1.0) (2026-10-05)


### New Features

* Adds support for Media Encoder. Improves app code in UI. ([288b818](https://github.com/jardicc/vscode-uxp-debugger/commit/288b818eb2e1fd1f893627c7c4f3c964d751b9c1))
* Allows InDesign server ([597c068](https://github.com/jardicc/vscode-uxp-debugger/commit/597c0688c45767e796c77ee8a1b642686782d1c6))
* allows to add multiple script files at once ([f8a4818](https://github.com/jardicc/vscode-uxp-debugger/commit/f8a481845e6cb94104dba20eff83102b5409a457))
* support more apps, improve app detection, UI cleanup ([da5c422](https://github.com/jardicc/vscode-uxp-debugger/commit/da5c42234bb3817600e466bb3d201c65c0662726))


### Bug Fixes

* can recognize UXP supported and non-supported Adobe apps ([b5615d3](https://github.com/jardicc/vscode-uxp-debugger/commit/b5615d39dec0e032ab59a17ad76f67eb5b84df63))
* Cleanup in dropdown menus for adding scripts and plugins ([f4fd1c7](https://github.com/jardicc/vscode-uxp-debugger/commit/f4fd1c7c3e0c238f3582b9297833ccd80a77918b))
* debug button did not work when plugin had "breakOnLoad:true" ([05427e4](https://github.com/jardicc/vscode-uxp-debugger/commit/05427e409ecec772cb3a984c73e0ca95e7dc3509))
* improve appearance of target select in UI where script targets specific host app ([d653b7c](https://github.com/jardicc/vscode-uxp-debugger/commit/d653b7cbd0c8ef0ec39ebcbcf78c3699226ea862))


### Documentation

* Add Media Encoder support to documentation and update host application requirements ([4e02124](https://github.com/jardicc/vscode-uxp-debugger/commit/4e021246816b43060c592e16e53ea627ff6f90f4))
* adds known issue to readme ([e2be188](https://github.com/jardicc/vscode-uxp-debugger/commit/e2be18806a9cfc23fb8f53de46980bd9ef064a83))

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
