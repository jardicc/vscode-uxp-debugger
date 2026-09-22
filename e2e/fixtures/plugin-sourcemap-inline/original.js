// Pre-bundle "original" source for the plugin-load inline-sourcemap e2e
// fixture (Plugin/load flow) — counterpart to plugin-sourcemap/, which uses
// an external .map file. Compiled once to original.js (map embedded as a
// data: URL, no separate .map file) via:
//   npx tsc --target es2019 --module none --inlineSourceMap original.ts
// Re-run that command from this directory after editing this file.
console.log("uxp-debugger e2e plugin inline-sourcemap fixture loaded");
const pluginInlineSourcemapMarker = "plugin-inline-sourcemap-fixture-marker"; // <-- breakpoint line
console.log(pluginInlineSourcemapMarker);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JpZ2luYWwuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJvcmlnaW5hbC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSx3RUFBd0U7QUFDeEUsNEVBQTRFO0FBQzVFLHlFQUF5RTtBQUN6RSx5Q0FBeUM7QUFDekMsd0VBQXdFO0FBQ3hFLG1FQUFtRTtBQUNuRSxPQUFPLENBQUMsR0FBRyxDQUFDLHlEQUF5RCxDQUFDLENBQUM7QUFDdkUsTUFBTSwyQkFBMkIsR0FBVyx3Q0FBd0MsQ0FBQyxDQUFDLHNCQUFzQjtBQUM1RyxPQUFPLENBQUMsR0FBRyxDQUFDLDJCQUEyQixDQUFDLENBQUMifQ==