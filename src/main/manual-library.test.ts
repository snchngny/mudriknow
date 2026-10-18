import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ManualLibrary, publicAddress } from "./manual-library";
import type { AppResearchState } from "../shared/types";

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function setup() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mudrik-manual-test-")); directories.push(dir); return { dir, library: new ManualLibrary(dir) }; }
const state: AppResearchState = { key: "7zip-v1", appName: "7-Zip", version: "1", status: "ready", summary: "help", sources: [{ title: "manual", url: "https://7-zip.org/manual" }], checkedAt: new Date().toISOString() };

function samplePdf(): Buffer {
  const stream = "BT /F1 12 Tf 72 720 Td (ZIP compression manual example) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}

describe("manual library", () => {
  it("retrieves neighboring procedure steps even when they lack the search term", async () => {
    const { library } = setup();
    await library.add(state, "steps.md", Buffer.from("# Logging\n\nType .LOG on the first line.\n\nSelect Save As and name the file.\n\nClose and reopen the file."), "md", "Manual");
    const result = library.search(state.key, ".LOG");
    expect(result).toContain("Select Save As");
    expect(result).toContain("Close and reopen");
  });
  it("keeps the manual edition separate from the executable version, including old cached documents", async () => {
    const { library } = setup();
    await library.add(state, "old.md", Buffer.from("ZIP compression for edition 0.5"), "md", "old", "0.5");
    const hit = library.search(state.key, "ZIP");
    expect(hit).toContain('"documentVersion":"0.5"');
    expect(hit).toContain('"executableVersion":"1"');
    await library.add(state, "unknown.md", Buffer.from("ZIP compression general"), "md", "general");
    expect(library.search(state.key, "ZIP")).toContain("不明（現在の版への適合は未確認）");
  });
  it("extracts a PDF and retains page references", async () => {
    const { library } = setup();
    const doc = await library.add(state, "manual.pdf", samplePdf(), "pdf", "PDF manual");
    expect(doc.sections[0].heading).toBe("1ページ");
    expect(library.search(state.key, "ZIP compression")).toContain("manual example");
  }, 20000);
  it("preserves original bytes and searches Japanese after restarting the store", async () => {
    const { dir, library } = setup();
    const raw = Buffer.from("# ZIPの作成\n\n圧縮形式をZIPにして追加ボタンを押します\n\n# 展開\n\nファイルを展開する");
    await library.add(state, "manual.md", raw, "md", "取扱説明書");
    const restarted = new ManualLibrary(dir);
    expect(restarted.list(state.key)).toHaveLength(1);
    const doc = restarted.list(state.key)[0];
    expect(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0], doc.original))).toEqual(raw);
    expect(restarted.search(state.key, "ZIPの圧縮形式")).toContain("追加ボタン");
    expect(restarted.search("different-version", "ZIP")).toBe("");
  });
  it("retains changed manuals as separate versions and deduplicates identical imports", async () => {
    const { library } = setup();
    await library.add(state, "m.md", Buffer.from("old manual"), "md", "manual");
    await library.add(state, "m.md", Buffer.from("old manual"), "md", "manual");
    expect(library.list(state.key)).toHaveLength(1);
    await library.add(state, "m.md", Buffer.from("new manual"), "md", "manual");
    expect(library.list(state.key)).toHaveLength(2);
  });
  it("extracts HTML content without script and menu noise", async () => {
    const { library } = setup();
    const doc = await library.add(state, "https://example.com/help", Buffer.from("<html><body><nav>noise</nav><main><h1>Zip</h1><p>archive settings</p><script>secret script</script></main></body></html>"), "html", "help");
    expect(JSON.stringify(doc.sections)).toContain("archive settings");
    expect(JSON.stringify(doc.sections)).not.toMatch(/noise|secret script/);
  });
  it("persists research separately and isolates application versions", () => {
    const { dir, library } = setup();
    library.writeResearch(state);
    expect(new ManualLibrary(dir).readResearch(state.key)).toEqual(state);
    expect(library.readResearch("v2")).toBeUndefined();
  });
  it("does not fetch sources that are already archived", async () => {
    const { library } = setup();
    await library.add(state, state.sources![0].url, Buffer.from("cached body"), "txt", "manual");
    await library.archiveSources(state);
    expect(library.list(state.key)).toHaveLength(1);
  });
  it.each(["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fd00::1"])("rejects nonpublic document destinations %s", address => {
    expect(publicAddress(address)).toBe(false);
  });
});
