import { describe, it, expect, vi } from "vitest";
import { AppResearchService, applicationKey, buildResearchPrompt, formatAppResearch, parseResearchResult, ResearchClient } from "./app-research";
import { WindowInfo } from "../shared/types";
import type { OpenCodeEvent } from "./opencode-client";

const info: WindowInfo = { title: "customer-private-document.xlsx", processName: "EXCEL", processPath: "C:\\Private\\EXCEL.EXE", productName: "Microsoft Excel", productVersion: "16.0.100", fileVersion: "16.0.100.1", publisher: "Microsoft Corporation", versionSource: "product-version", hwnd: 42 };
const url = "https://support.microsoft.com/excel";
const result = { summary: "一般向け公式ヘルプ。版16.0.100との一致は未確認", sources: [{ title: "Excel help", url }] };
function success(emit: (event: OpenCodeEvent) => void) {
  emit({ type: "tool_use", part: { tool: "websearch", state: { status: "completed", output: "search results" } } });
  emit({ type: "tool_use", part: { tool: "webfetch", state: { status: "completed", input: { url }, output: "Excel official documentation" } } });
  emit({ type: "text", part: { text: JSON.stringify(result) } });
}
function setup(run: ResearchClient["sendMessage"] = async (_prompt, emit) => success(emit), timeoutMs = 1000) {
  const clients: ResearchClient[] = [];
  const create = vi.fn(() => { const client = { sendMessage: vi.fn(run), kill: vi.fn() }; clients.push(client); return client; });
  const changed = vi.fn();
  const service = new AppResearchService(create, changed, timeoutMs);
  return { service, create, clients, changed };
}

describe("application research", () => {
  it("retains source-declared versions without assigning the executable version", () => {
    const parsed = parseResearchResult(JSON.stringify({ ...result, sources: [{ title: "help", url, documentVersion: "Windows 10" }] }), new Set([url]));
    expect(parsed.sources![0].documentVersion).toBe("Windows 10");
    expect(parseResearchResult(JSON.stringify(result), new Set([url])).sources![0].documentVersion).toBeUndefined();
    expect(formatAppResearch({ key: "x", appName: "Excel", version: "16", status: "ready", ...parsed })).toContain("資料の対象版は不明");
  });
  it("reuses persisted research after creating a new service", async () => {
    const create = vi.fn(() => ({ sendMessage: async (_p: string, emit: (event: OpenCodeEvent) => void) => success(emit), kill: vi.fn() }));
    let saved: import("../shared/types").AppResearchState | undefined;
    const storage = { readResearch: (key: string) => saved?.key === key ? saved : undefined, writeResearch: (value: import("../shared/types").AppResearchState) => { saved = value; } };
    await new AppResearchService(create, () => {}, 1000, Date.now, storage).prepare(info);
    const restarted = new AppResearchService(create, () => {}, 1000, Date.now, storage);
    expect((await restarted.prepare(info)).status).toBe("ready");
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("does not put titles, file paths, HWNDs or screen data in research queries", () => {
    const prompt = buildResearchPrompt(info);
    expect(prompt).toContain("Microsoft Excel");
    expect(prompt).toContain("16.0.100");
    expect(prompt).not.toContain(info.title);
    expect(prompt).not.toContain(info.processPath);
    expect(prompt).not.toContain('"hwnd"');
  });
  it("keys by executable and versions, not by document/window title", () => {
    expect(applicationKey({ ...info, title: "another.xlsx" })).toBe(applicationKey(info));
    expect(applicationKey({ ...info, productVersion: "17" })).not.toBe(applicationKey(info));
    expect(applicationKey({ ...info, processPath: "C:\\Other\\EXCEL.EXE" })).not.toBe(applicationKey(info));
  });
  it("waits for search and fetch completion, then reuses known-version research", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { service, create } = setup(async (_prompt, emit) => { await gate; success(emit); });
    const pending = service.prepare(info);
    expect(service.getState()?.status).toBe("loading");
    const duplicate = service.prepare(info);
    expect(create).toHaveBeenCalledTimes(1);
    release();
    expect((await pending).status).toBe("ready");
    expect((await duplicate).status).toBe("ready");
    await service.prepare({ ...info, title: "other.xlsx" });
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("researches again after a version change", async () => {
    const { service, create } = setup();
    await service.prepare(info);
    await service.prepare({ ...info, productVersion: "17" });
    expect(create).toHaveBeenCalledTimes(2);
  });
  it("never caches unsupported guesses without a successful search/fetch", async () => {
    const { service, create } = setup(async (_prompt, emit) => emit({ type: "text", part: { text: JSON.stringify(result) } }));
    expect((await service.prepare(info)).status).toBe("failed");
    await service.prepare(info);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it("rejects invented source URLs and non-HTTPS URLs", () => {
    expect(() => parseResearchResult(JSON.stringify(result), new Set())).toThrow();
    expect(() => parseResearchResult(JSON.stringify({ ...result, sources: [{ title: "x", url: "http://bad.example" }] }), new Set(["http://bad.example"]))).toThrow();
  });
  it("retries after failed research rather than poisoning the cache", async () => {
    let calls = 0;
    const { service } = setup(async (_prompt, emit) => { if (++calls === 1) throw new Error("offline"); success(emit); });
    expect((await service.prepare(info)).status).toBe("failed");
    expect((await service.prepare(info)).status).toBe("ready");
  });
  it("does not reuse an unknown version across captures", async () => {
    const { service, create } = setup();
    const unknown = { ...info, productVersion: "", fileVersion: "", versionSource: "unknown" as const };
    expect((await service.prepare(unknown)).version).toBe("不明");
    await service.prepare(unknown);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it("cancels on app switch and discards late results from the old app", async () => {
    let oldEmit!: (event: OpenCodeEvent) => void;
    let finishOld!: () => void;
    const oldDone = new Promise<void>((resolve) => { finishOld = resolve; });
    let calls = 0;
    const { service, clients } = setup(async (_prompt, emit) => {
      if (++calls === 1) { oldEmit = emit; await oldDone; } else success(emit);
    });
    const old = service.prepare(info);
    const next = await service.prepare({ ...info, productName: "Other App", processPath: "other.exe" });
    success(oldEmit); finishOld();
    expect((await old).status).toBe("cancelled");
    expect(clients[0].kill).toHaveBeenCalled();
    expect(service.getState()).toEqual(next);
  });
  it("stops promptly even if the transport never finishes", async () => {
    const { service, clients } = setup(() => new Promise(() => {}));
    const pending = service.prepare(info);
    service.cancel();
    expect((await pending).status).toBe("cancelled");
    expect(clients[0].kill).toHaveBeenCalled();
  });
  it("times out without saving a false success", async () => {
    const { service, clients } = setup(() => new Promise(() => {}), 5);
    expect((await service.prepare(info)).status).toBe("failed");
    expect(clients[0].kill).toHaveBeenCalled();
  });
  it("forces refresh and expires a cache after a day", async () => {
    let now = Date.now();
    const create = vi.fn(() => ({ sendMessage: async (_p: string, emit: (event: OpenCodeEvent) => void) => success(emit), kill: vi.fn() }));
    const service = new AppResearchService(create, () => {}, 1000, () => now);
    await service.prepare(info);
    await service.prepare(info, true);
    expect(create).toHaveBeenCalledTimes(2);
    now += 86400001;
    await service.prepare(info);
    expect(create).toHaveBeenCalledTimes(3);
  });
  it("makes failure, version uncertainty and browser/service distinction visible to the answer model", async () => {
    const { service } = setup();
    const state = await service.prepare(info);
    expect(formatAppResearch(state)).toContain(url);
    expect(formatAppResearch(state)).toContain("not references from an earlier application");
    expect(formatAppResearch(state)).toContain("browser version does not identify");
    expect(formatAppResearch({ ...state, status: "failed" })).toContain("unverified");
  });
});
