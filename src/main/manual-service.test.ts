import { describe, it, expect, vi } from "vitest";
import { resolveSubmissionEndpoint } from "./manual-service";
describe("published anonymous intake discovery", () => {
  it("uses an explicit operator endpoint without contacting GitHub", async () => {
    const transport = vi.fn();
    expect(await resolveSubmissionEndpoint("https://intake.example.test/", transport)).toBe("https://intake.example.test");
    expect(transport).not.toHaveBeenCalled();
  });
  it("clearly distinguishes an unpublished intake from available shared reading", async () => {
    await expect(resolveSubmissionEndpoint(undefined, vi.fn().mockResolvedValue(new Response(JSON.stringify({ schemaVersion: 1, submissionUrl: "" }))))).rejects.toThrow("共有資料の取得は利用できます");
  });
  it("rejects insecure published settings", async () => {
    await expect(resolveSubmissionEndpoint(undefined, vi.fn().mockResolvedValue(new Response(JSON.stringify({ schemaVersion: 1, submissionUrl: "http://localhost:8080" }))))).rejects.toThrow("HTTPS");
  });
  it("finds and caches the published endpoint without user accounts or local servers", async () => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ schemaVersion: 1, submissionUrl: "https://intake.example.test" })));
    expect(await resolveSubmissionEndpoint(undefined, transport)).toBe("https://intake.example.test");
    expect(await resolveSubmissionEndpoint(undefined, transport)).toBe("https://intake.example.test");
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
