# Remaining Code Review & Simplification Work

This file contains only work that remains after the August 2026 code review cleanup.
Implemented items were removed; current architecture is documented in
[`README.md`](../../README.md), [`CONTROL-PANEL.md`](../CONTROL-PANEL.md),
[`UI-DEBUGGING.md`](../UI-DEBUGGING.md), and the feature-specific documents in this
directory.

Do not modify vendored or reference folders (`devtools-frontend-dist/`, `uxp-cli-v1/`,
`uxp-UDT-v2/`, `vscode-edge-devtools/`, `native/`) as part of these cleanups.

## Decision required

### Script-argument live E2E coverage

`e2e/suite/debugScriptArgs.photoshop.test.ts` contains 11 parametrized `it.skip` cases.
The historical reason for skipping them is unknown and is now stated at the call site.
The repository owner should choose one of these outcomes:

1. Re-enable the cases and run them against Photoshop.
2. Replace the temporary explanation with the actual reason they must remain skipped.

Do not delete the cases: they describe currently missing end-to-end coverage for
`userArgs` passed through `Plugin/runScript`.

The two skipped cases in `hostAppNotRunning.photoshop.test.ts` are intentional. They
require Photoshop to be stopped and therefore cannot run with the normal live suite;
their call-site comments document the isolated execution requirement.

## Optional backlog

These changes are not required for the cleanup and should be taken independently only
when their benefit justifies the additional churn.

### Low-risk readability

- In `src/vscode/UxpService.ts`, optionally extract the identical successful-start tail
  of `startBroker()` and `startBrokerSilently()` into `adoptStartedBroker()`. Keep the
  interactive and silent start flows separate because their error and takeover behavior
  differs.
- In the panel webview, extract the plugin/script Debug/Stop button pair only if the
  shared component is smaller and clearer than the two call sites. Their icons, labels,
  disabled reasons, and dispatched actions are not currently identical.
- Replace the remaining hand-written `POLL_INTERVAL` loops in live E2E tests with
  `waitFor()` only where timeout and error semantics remain equivalent.
- Optionally add contextual error handling around `scripts/bundle-devtools.mjs` if it
  improves diagnostics without obscuring the original build error.

### Behavior-adjacent hardening

- Replace the presence-only JSON casts in `src/core/broker/AppConnection.ts` and
  `src/core/manifest/manifest.ts` with field-type validation. This creates new rejection
  paths and therefore requires dedicated tests as a separate change.
- Consider grouping the mutable context state in
  `src/vscode/proxy/cdpMessageRewriter.ts` to reduce reset drift. This is a high-risk
  protocol path; keep the proxy test suite green before and after every step.

## Architectural guardrails

- `src/core` remains independent of `vscode`; shared Node-only helpers belong there.
- Keep source-map rewriting split into named helpers. The names document a complex
  algorithm even when a helper has only one caller.
- Keep language-model tool registrations explicit and greppable. When adding or removing
  a tool, update both `package.json` and `src/vscode/tools/registerTools.ts`.
- Keep hook handlers separate when their validation, lifecycle, or response semantics
  differ; in particular, do not merge load with reload or refresh with unload merely to
  reduce line count.
- Keep intentional test-only exports such as `NullAnnouncer`, `NullHostAppController`,
  and `resetControlAdapterGuardForTests()`.
- Keep `wallaby.js`; the repository uses Wallaby for the vitest suite.

## Validation

For every implemented backlog item, run the narrowest relevant test first, followed by:

```powershell
npm run typecheck
npm test
npm run lint
npm run compile
```

For E2E infrastructure changes also run `npm run build:e2e`. Live Photoshop behavior
requires the opt-in workflow documented in [`e2e/README.md`](../../e2e/README.md).
