npm run compile — build
npm run watch — incremental dev build
F5 — launch the Extension Development Host for testing
Adjust DEFAULT_DISCOVERY_PORTS in uxpDiscovery.ts once you know the exact ports your Adobe apps expose
Extend rewriteFromTarget() / rewriteFromClient() in cdpProxy.ts to handle any UXP CDP quirks you encounter