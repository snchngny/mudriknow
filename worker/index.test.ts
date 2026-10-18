import { describe, it, expect, vi } from "vitest";
import { handleRequest } from "./index";
import { webcrypto } from "node:crypto";
vi.stubGlobal("crypto", webcrypto);

const manual = { appName: "7-Zip", platform: "windows", title: "Documentation", url: "https://www.7-zip.org/faq.html", documentVersion: "", language: "en", license: "link only" };
const env = () => ({ GITHUB_TOKEN: "test-credential", GITHUB_REPOSITORY: "example/manuals", ALLOWED_MANUAL_HOSTS: "www.7-zip.org", SUBMISSION_LIMIT: { limit: async () => ({ success: true }) } });
const request = (value: unknown) => new Request("https://example.test/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
const catalog = (manuals: unknown[] = []) => new Response(JSON.stringify({ sha: "old-sha", size: 50, content: Buffer.from(JSON.stringify({ schemaVersion: 1, manuals })).toString("base64") }));
describe("anonymous GitHub manual intake", () => {
  it("writes only public metadata to the fixed main catalog with anonymous commit identity", async () => {
    const transport = vi.fn().mockResolvedValueOnce(catalog()).mockResolvedValueOnce(new Response("{}", { status: 201 }));
    const result = await handleRequest(request(manual), env(), transport);
    expect(result.status).toBe(202);
    const [url, options] = transport.mock.calls[1];
    expect(url).toBe("https://api.github.com/repos/example/manuals/contents/manual/catalog.json");
    const body = JSON.parse(options.body);
    expect(body.branch).toBe("main");
    expect(body.author.email).toContain("noreply.github.com");
    const saved = JSON.parse(Buffer.from(body.content, "base64").toString());
    expect(saved.manuals[0]).toMatchObject(manual);
    expect(Object.keys(saved.manuals[0]).sort()).toEqual(["id", ...Object.keys(manual)].sort());
    expect(JSON.stringify(saved)).not.toContain("test-credential");
  });
  it("rejects query credentials, unknown hosts, personal fields and oversized input without contacting GitHub", async () => {
    const transport = vi.fn();
    for (const value of [{ ...manual, url: manual.url + "?token=private" }, { ...manual, url: "https://evil.test/doc" }, { ...manual, email: "user@example.test" }, { ...manual, title: "user@example.test" }]) {
      expect((await handleRequest(request(value), env(), transport)).status).toBe(400);
    }
    expect((await handleRequest(request({ title: "x".repeat(9000) }), env(), transport)).status).toBe(413);
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not overwrite concurrent submissions", async () => {
    const transport = vi.fn().mockResolvedValueOnce(catalog()).mockResolvedValueOnce(new Response("{}", { status: 409 })).mockResolvedValueOnce(catalog([{ id: "another" }])).mockResolvedValueOnce(new Response("{}", { status: 201 }));
    expect((await handleRequest(request(manual), env(), transport)).status).toBe(202);
    const final = JSON.parse(Buffer.from(JSON.parse(transport.mock.calls[3][1].body).content, "base64").toString());
    expect(final.manuals).toHaveLength(2);
  });
  it("limits submissions before fetching the repository", async () => {
    const transport = vi.fn(); const settings = env(); settings.SUBMISSION_LIMIT.limit = async () => ({ success: false });
    expect((await handleRequest(request(manual), settings, transport)).status).toBe(429);
    expect(transport).not.toHaveBeenCalled();
  });
});
