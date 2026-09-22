// Minimal startup script for the E2E fixture plugin. `breakOnStart` pauses
// the host here (before the execution context is even created — see
// BREAK-ON-START.md), so the debugger attaches and resumes past this
// line once the e2e test issues "uxp.attachDebugger".
console.log("uxp-debugger e2e fixture plugin loaded");
// Distinct marker used by multiAttach.photoshop.test.ts to prove two
// concurrently-attached sessions are really talking to two independent
// UXP/CDP targets, not the same one twice.
globalThis.__uxpFixtureId = "plugin-one";

// Exposes any `Plugin/runScript` userArgs via console output, so
// debugScriptArgs.photoshop.test.ts can verify what the host actually
// received (Adobe UXP `script.args` API — see
// https://developer.adobe.com/indesign/uxp/scripts/tutorials/arguments/#usage).
// Guarded: `require("uxp").script` is only populated when this file runs as
// a script (Plugin/runScript), not when loaded as the plugin's main via
// index.html — must not throw/break the plugin-load flow either way.
try {
  const scriptArgs = require("uxp").script.args;
  console.log("[e2e] script.args: " + JSON.stringify(scriptArgs));
} catch (err) {
  console.log("[e2e] script.args error: " + (err && err.message));
}
