import { describe, it, expect, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { handleRequest, ManualQueue } from "./index";
vi.stubGlobal("crypto", webcrypto);
const manual = { appName: "7-Zip", platform: "windows", title: "Documentation", url: "https://www.7-zip.org/faq.html", documentVersion: "", language: "en", license: "link only" };
const request = (value: unknown) => new Request("https://example.test/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
function setup() {
  const data = new Map();
  const storage = { list: async () => new Map(data), put: async (key: string, value: unknown) => { data.set(key, value); } };
  const queue = new ManualQueue({ storage });
  const env = { ALLOWED_MANUAL_HOSTS: "www.7-zip.org", SUBMISSION_LIMIT: { limit: async () => ({ success: true }) }, MANUAL_QUEUE: { idFromName: (s: string) => s, get: () => queue } };
  return { env, data };
}
describe("anonymous intake without GitHub credentials", () => {
  it("queues public metadata and reuses the same ID when submitted again", async () => {
    const { env, data } = setup();
    const first = await handleRequest(request(manual), env);
    const second = await handleRequest(request(manual), env);
    expect(first.status).toBe(202);
    expect(await second.json()).toEqual(await first.json());
    expect(data.size).toBe(1);
    const catalog = await (await handleRequest(new Request("https://example.test/pending.json"), env)).json() as any;
    expect(catalog.manuals[0]).toMatchObject(manual);
    expect(Object.keys(catalog.manuals[0]).sort()).toEqual(["id", ...Object.keys(manual)].sort());
  });
  it("rejects credential URLs, unknown hosts and personal fields before persisting", async () => {
    const { env, data } = setup();
    for (const value of [{ ...manual, url: manual.url + "?token=private" }, { ...manual, url: "https://evil.test/doc" }, { ...manual, email: "user@example.test" }, { ...manual, title: "user@example.test" }]) expect((await handleRequest(request(value), env)).status).toBe(400);
    expect((await handleRequest(request({ title: "x".repeat(9000) }), env)).status).toBe(413);
    expect(data.size).toBe(0);
  });
  it("preserves different simultaneous submissions", async () => {
    const { env, data } = setup();
    await Promise.all([handleRequest(request(manual), env), handleRequest(request({ ...manual, title: "Other reference" }), env)]);
    expect(data.size).toBe(2);
  });
  it("rate limits before writing", async () => {
    const { env, data } = setup(); env.SUBMISSION_LIMIT.limit = async () => ({ success: false });
    expect((await handleRequest(request(manual), env)).status).toBe(429);
    expect(data.size).toBe(0);
  });
});
