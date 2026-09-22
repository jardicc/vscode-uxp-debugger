// Fixture for scriptTypeScriptStrip.photoshop.test.ts — deliberately NOT
// pre-compiled: stripTypeScriptFile() (src/core/stripTypeScript.ts) strips
// this file's types on the fly at debug time, mirroring what debugScript.ts
// does for a real "Debug Script" (F5) session started directly on a .ts file.
console.log("uxp-debugger e2e on-the-fly TypeScript strip fixture loaded 9");
const liveStripMarker = "live-strip-fixture-marker"; // <-- breakpoint line
console.log(liveStripMarker);
