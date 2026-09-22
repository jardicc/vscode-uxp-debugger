import { describe, expect, it } from "vitest";
import {
    type DebugSessionChainLike,
    findUxpClientSessionId,
    UXP_SESSION_KEY,
} from "../../src/vscode/debug/uxpSessionChain";

function session(configuration: Record<string, unknown>, parentSession?: DebugSessionChainLike): DebugSessionChainLike {
    return { configuration, parentSession };
}

describe("findUxpClientSessionId", () => {
    it("returns the id from a stamped root session", () => {
        const root = session({ [UXP_SESSION_KEY]: "uxp-session-1" });
        expect(findUxpClientSessionId(root)).toBe("uxp-session-1");
    });

    it("walks up to the stamped root from js-debug's unstamped child session", () => {
        const root = session({ [UXP_SESSION_KEY]: "uxp-session-1" });
        const child = session({ type: "pwa-node", __pendingTargetId: "abc" }, root);
        expect(findUxpClientSessionId(child)).toBe("uxp-session-1");
    });

    it("walks multiple levels", () => {
        const root = session({ [UXP_SESSION_KEY]: "uxp-session-2" });
        const mid = session({}, root);
        const leaf = session({}, mid);
        expect(findUxpClientSessionId(leaf)).toBe("uxp-session-2");
    });

    it("prefers the nearest stamp in the chain", () => {
        const root = session({ [UXP_SESSION_KEY]: "outer" });
        const child = session({ [UXP_SESSION_KEY]: "inner" }, root);
        expect(findUxpClientSessionId(child)).toBe("inner");
    });

    it("returns undefined for an unrelated session (no stamp anywhere in the chain)", () => {
        const root = session({ type: "node" });
        const child = session({}, root);
        expect(findUxpClientSessionId(child)).toBeUndefined();
    });

    it("ignores a non-string stamp value", () => {
        const root = session({ [UXP_SESSION_KEY]: 42 });
        expect(findUxpClientSessionId(root)).toBeUndefined();
    });
});
