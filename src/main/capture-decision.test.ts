import { describe, it, expect, vi } from "vitest";
import { decideCapture } from "./capture-decision";

describe("screen capture decision", () => {
  it("skips capture only for a confident screen-independent question", async () => {
    const request = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ answers: { independent: { noul: 0.97 } } })));
    expect((await decideCapture("ZIPとは何？", "7-Zip", "test-key", request as typeof fetch)).capture).toBe(false);
    const body = JSON.parse(request.mock.calls[0]?.[1]?.body as string);
    expect(JSON.parse(body.state)).toEqual({ application: "7-Zip", question: "ZIPとは何？" });
  });
  it.each([0, 0.5, 0.84, -1, 2, "yes", undefined])("captures for low or malformed score %s", async score => {
    const request = async () => new Response(JSON.stringify({ answers: { independent: { noul: score } } }));
    expect((await decideCapture("今何が表示されている？", "7-Zip", "key", request as typeof fetch)).capture).toBe(true);
  });
  it("captures if the classifier is missing, errors, or returns an HTTP error", async () => {
    expect((await decideCapture("質問", "app", "")).reason).toBe("unavailable");
    expect((await decideCapture("質問", "app", "key", (async () => { throw Error("offline"); }) as typeof fetch)).capture).toBe(true);
    expect((await decideCapture("質問", "app", "key", (async () => new Response("", { status: 429 })) as typeof fetch)).capture).toBe(true);
  });
});
