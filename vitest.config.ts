import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Defensive belt-and-braces: e2e/ (Mocha + @vscode/test-electron, real
    // VS Code + real Photoshop) must never be picked up here. Wallaby
    // autoDetects this same config for its always-on TDD loop, and those
    // tests are slow/require external state — they'd break that loop.
    exclude: ["e2e/**", "node_modules/**"],
    environment: "node",
    // Broker tests use real loopback sockets on OS-assigned ports → parallel-safe.
    testTimeout: 10_000,
  },
});
