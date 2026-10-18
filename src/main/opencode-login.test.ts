import { describe, it, expect } from "vitest";
import { entitledImageModels } from "./opencode-login";
describe("ChatGPT model entitlement", () => {
  it("does not advertise catalog-only, hidden or unsupported account models", () => {
    const catalog = ["catalog-only", "available", "hidden", "unsupported"].map(id => ({ id: "openai/" + id, name: id }));
    const available = [{ slug: "available", visibility: "list", supported_in_api: true }, { slug: "hidden", visibility: "hide", supported_in_api: true }, { slug: "unsupported", visibility: "list", supported_in_api: false }, { slug: "unknown", visibility: "list", supported_in_api: true }];
    expect(entitledImageModels(catalog, available)).toEqual([{ id: "openai/available", name: "available" }]);
    expect(entitledImageModels(catalog, [])).toEqual([]);
  });
});
