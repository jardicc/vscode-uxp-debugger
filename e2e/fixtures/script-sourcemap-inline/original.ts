// Pre-bundle "original" source for the script-debugging inline-sourcemap
// e2e fixture (Plugin/runScript flow) — counterpart to script-sourcemap/,
// which uses an external .map file. Compiled once to original.js (map
// embedded as a data: URL, no separate .map file) via:
//   npx tsc --target es2019 --module none --inlineSourceMap original.ts
// Re-run that command from this directory after editing this file.
console.log("uxp-debugger e2e script inline-sourcemap fixture loaded");
const scriptInlineSourcemapMarker = "script-inline-sourcemap-fixture-marker"; // <-- breakpoint line
console.log(scriptInlineSourcemapMarker);
