import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createIntakeServer, SubmissionStore } from "./server";
import { validateSubmission, submissionEndpoint } from "../shared/manual-submission";
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })));
const manual = { appName: "Notepad", platform: "windows", title: "Official help", url: "https://support.microsoft.com/en-us/windows/apps/help-in-notepad", documentVersion: "Windows 10", language: "en", license: "URLのみ共有" };
describe("anonymous manual intake", () => {
  it("accepts without an account, hides pending entries, and publishes only after local approval", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mudrik-intake-")); directories.push(dir);
    const { server, store } = createIntakeServer(dir);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    try {
      const response = await fetch(base + "/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(manual) });
      expect(response.status).toBe(202);
      const result = await response.json() as any;
      expect((await (await fetch(base + "/catalog")).json() as any).manuals).toEqual([]);
      expect(JSON.stringify(store.entries())).not.toMatch(/127\.0\.0\.1|author|email/);
      store.review(result.id, "approved");
      expect((await (await fetch(base + "/catalog")).json() as any).manuals[0]).toMatchObject({ documentVersion: "Windows 10", url: manual.url });
      expect(new SubmissionStore(dir).catalog().manuals).toHaveLength(1);
      expect(store.submit(manual).id).toBe(result.id);
      store.review(result.id, "rejected");
      expect(store.catalog().manuals).toEqual([]);
      const origin = await fetch(base + "/submissions", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.com" }, body: JSON.stringify(manual) });
      expect(origin.status).toBe(403);
    } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  });
  it("rejects private links, extra payloads and unsafe intake URLs", () => {
    for (const url of ["file:///private.pdf", "https://127.0.0.1/a", "https://localhost/a", "https://user:pass@example.com/a"]) expect(() => validateSubmission({ ...manual, url })).toThrow();
    expect(() => validateSubmission({ ...manual, screenshot: "private content" })).toThrow();
    expect(() => submissionEndpoint("http://remote.example.com")).toThrow();
    expect(submissionEndpoint("http://127.0.0.1:43127/")).toBe("http://127.0.0.1:43127");
    expect(submissionEndpoint("https://manuals.example.com/")).toBe("https://manuals.example.com");
  });
});
