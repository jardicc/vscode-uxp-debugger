// Pre-bundle "original" source for the script-debugging external-sourcemap
// e2e fixture (Plugin/runScript flow, as opposed to plugin-sourcemap/'s
// Plugin/load flow). Compiled once to original.js + original.js.map
// (external, non-inline) via:
//   npx tsc --target es2019 --module none --sourceMap original.ts
// Re-run that command from this directory after editing this file.
console.log("uxp-debugger e2e script external-sourcemap fixture loaded");
const scriptSourcemapMarker = "script-sourcemap-fixture-marker"; // <-- breakpoint line
console.log(scriptSourcemapMarker);
