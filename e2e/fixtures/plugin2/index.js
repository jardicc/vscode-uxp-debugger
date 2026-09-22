// Second minimal fixture plugin, used only by multiAttach.photoshop.test.ts
// to prove two DIFFERENT plugins can be loaded and debugged at the same
// time. Distinct id/name from e2e/fixtures/plugin so both can be dev-loaded
// into the same host app simultaneously.
console.log("uxp-debugger e2e fixture plugin 2 loaded");
// Distinct marker (see e2e/fixtures/plugin/index.js) — used to prove this
// session's CDP target is independent from the first fixture's.
globalThis.__uxpFixtureId = "plugin-two";
