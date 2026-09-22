// Pre-bundle "original" source for the external-source-map e2e fixture.
// Compiled once to original.js + original.js.map (external, non-inline) via:
//   npx tsc --target es2019 --module none --sourceMap original.ts
// Re-run that command from this directory after editing this file.
console.log("uxp-debugger e2e external-sourcemap fixture loaded");
const pluginSourcemapMarker = "sourcemap-fixture-marker"; // <-- breakpoint line
console.log(pluginSourcemapMarker);
