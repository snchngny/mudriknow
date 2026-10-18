import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { publicManual } from "./index";
const { mergeCatalog } = require("../scripts/sync-manuals.cjs");
const manual = { appName: "7-Zip", platform: "windows", title: "FAQ", url: "https://www.7-zip.org/faq.html", documentVersion: "", language: "en", license: "URL only" };
const id = createHash("sha256").update(JSON.stringify(manual)).digest("hex");
const empty = { schemaVersion: 1, manuals: [] };
const validate = (value: unknown) => publicManual(value, "www.7-zip.org");
describe("GitHub Actions manual import", () => {
  it("deduplicates and keeps existing entries without trusting submitted IDs", () => {
    const result = mergeCatalog(empty, { schemaVersion: 1, manuals: [{ id, ...manual }, { id, ...manual }, { id: "fake", ...manual }] }, validate);
    expect(result.manuals).toHaveLength(1);
    expect(mergeCatalog(result, result, validate)).toEqual(result);
  });
  it("rejects personal/unknown fields and keeps removed entries blocked", () => {
    expect(mergeCatalog(empty, { schemaVersion: 1, manuals: [{ id, ...manual, email: "private@example.test" }] }, validate).manuals).toHaveLength(0);
    expect(mergeCatalog(empty, { schemaVersion: 1, manuals: [{ id, ...manual }] }, validate, [id]).manuals).toHaveLength(0);
  });
});
