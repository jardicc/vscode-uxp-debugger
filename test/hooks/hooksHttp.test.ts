import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import type * as http from "http";
import {
    HookRequestError,
    optionalBooleanField,
    optionalStringField,
    readJsonBody,
    requireStringField,
    sendJson,
} from "../../src/vscode/hooks/hooksHttp";

/** Minimal fake `http.IncomingMessage` — just an EventEmitter, which is all `readJsonBody` needs. */
function fakeRequest(chunks: string[]): http.IncomingMessage {
    const emitter = new EventEmitter() as EventEmitter & { destroy: () => void };
    emitter.destroy = () => {};
    queueMicrotask(() => {
        for (const chunk of chunks) {
            emitter.emit("data", Buffer.from(chunk, "utf8"));
        }
        emitter.emit("end");
    });
    return emitter as unknown as http.IncomingMessage;
}

describe("readJsonBody", () => {
    it("parses a valid JSON object body", async () => {
        const body = await readJsonBody(fakeRequest(["{\"manifestPath\":\"a.json\"}"]));
        expect(body).toEqual({ manifestPath: "a.json" });
    });

    it("resolves an empty body to {}", async () => {
        expect(await readJsonBody(fakeRequest([]))).toEqual({});
    });

    it("rejects invalid JSON with a 400 HookRequestError", async () => {
        await expect(readJsonBody(fakeRequest(["not json"]))).rejects.toMatchObject({
            status: 400,
            name: "HookRequestError",
        });
    });

    it("rejects a JSON array body (must be an object)", async () => {
        await expect(readJsonBody(fakeRequest(["[1,2,3]"]))).rejects.toMatchObject({ status: 400 });
    });

    it("rejects an oversized body with a 413 HookRequestError", async () => {
        const huge = "x".repeat(2_000_000);
        await expect(readJsonBody(fakeRequest([`{"a":"${huge}"}`]))).rejects.toMatchObject({ status: 413 });
    });
});

describe("requireStringField", () => {
    it("returns the value when present and non-empty", () => {
        expect(requireStringField({ manifestPath: "a.json" }, "manifestPath")).toBe("a.json");
    });

    it("throws a 400 HookRequestError when missing", () => {
        expect(() => requireStringField({}, "manifestPath")).toThrow(HookRequestError);
    });

    it("throws when present but not a string", () => {
        expect(() => requireStringField({ manifestPath: 5 }, "manifestPath")).toThrow(HookRequestError);
    });
});

describe("optionalStringField / optionalBooleanField", () => {
    it("returns undefined when the optional string field is absent", () => {
        expect(optionalStringField({}, "sessionId")).toBeUndefined();
    });

    it("throws when the optional string field is present but wrong type", () => {
        expect(() => optionalStringField({ sessionId: 5 }, "sessionId")).toThrow(HookRequestError);
    });

    it("defaults the optional boolean field to false", () => {
        expect(optionalBooleanField({}, "breakOnLoad")).toBe(false);
    });

    it("returns the boolean when present", () => {
        expect(optionalBooleanField({ breakOnLoad: true }, "breakOnLoad")).toBe(true);
    });

    it("throws when the boolean field is present but wrong type", () => {
        expect(() => optionalBooleanField({ breakOnLoad: "yes" }, "breakOnLoad")).toThrow(HookRequestError);
    });
});

describe("sendJson", () => {
    it("writes the status code and JSON body, closing the connection", () => {
        const res = {
            writeHead: vi.fn(),
            end: vi.fn(),
        } as unknown as http.ServerResponse;

        sendJson(res, { status: 200, body: { ok: true } });

        expect(res.writeHead).toHaveBeenCalledWith(200, {
            "Content-Type": "application/json",
            Connection: "close",
        });
        expect(res.end).toHaveBeenCalledWith(JSON.stringify({ ok: true }));
    });
});
