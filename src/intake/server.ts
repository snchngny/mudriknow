import { createServer } from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { validateSubmission, ManualSubmission } from "../shared/manual-submission";

interface Entry { id: string; receivedAt: string; status: "pending" | "approved" | "rejected"; manual: ManualSubmission }
export class SubmissionStore {
  constructor(private directory: string) { fs.mkdirSync(directory, { recursive: true }); }
  private file(id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid submission ID"); return path.join(this.directory, id + ".json"); }
  entries(): Entry[] { return fs.readdirSync(this.directory).filter(f => /^[a-f0-9-]{36}\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(this.directory, f), "utf8"))); }
  private write(entry: Entry) { const file = this.file(entry.id); fs.writeFileSync(file + ".tmp", JSON.stringify(entry, null, 2)); fs.renameSync(file + ".tmp", file); }
  submit(value: unknown): Entry {
    const manual = validateSubmission(value);
    const entries = this.entries();
    const hash = (m: ManualSubmission) => createHash("sha256").update(JSON.stringify(m)).digest("hex");
    const previous = entries.find(e => e.status !== "rejected" && hash(e.manual) === hash(manual));
    if (previous) return previous;
    if (entries.filter(e => e.status === "pending").length >= 1000) throw new Error("受付待ちが上限です");
    const entry: Entry = { id: randomUUID(), receivedAt: new Date().toISOString(), status: "pending", manual };
    this.write(entry); return entry;
  }
  review(id: string, status: "approved" | "rejected"): Entry {
    const entry: Entry = JSON.parse(fs.readFileSync(this.file(id), "utf8"));
    entry.status = status; this.write(entry); return entry;
  }
  catalog() { return { schemaVersion: 1, manuals: this.entries().filter(e => e.status === "approved").map(e => ({ id: e.id, ...e.manual })) }; }
}
export function createIntakeServer(directory: string) {
  const store = new SubmissionStore(directory);
  // IPs are kept only in this bounded in-memory rate limiter, not in records/logs.
  const limits = new Map<string, { count: number; until: number }>();
  const server = createServer(async (request, response) => {
    const reply = (code: number, body: unknown) => { response.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); response.end(JSON.stringify(body)); };
    if (request.method === "GET" && request.url === "/health") return reply(200, { ok: true });
    if (request.method === "GET" && ["/catalog", "/catalog.json"].includes(request.url || "")) return reply(200, store.catalog());
    if (request.method !== "POST" || request.url !== "/submissions") return reply(404, { error: "Not found" });
    if (request.headers.origin) return reply(403, { error: "この受付はアプリからの投稿専用です" });
    if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] || "")) return reply(415, { error: "JSON required" });
    const now = Date.now();
    for (const [ip, limit] of limits) if (limit.until < now) limits.delete(ip);
    const ip = request.socket.remoteAddress || "unknown";
    const limit = limits.get(ip) || { count: 0, until: now + 3600000 };
    if (limit.count >= 10 || (!limits.has(ip) && limits.size >= 10000)) return reply(429, { error: "投稿回数の上限です。時間を置いてください" });
    limit.count++; limits.set(ip, limit);
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const bytes of request) { size += bytes.length; if (size > 8192) { reply(413, { error: "投稿内容が大きすぎます" }); request.resume(); return; } chunks.push(Buffer.from(bytes)); }
      const entry = store.submit(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      reply(202, { id: entry.id, status: entry.status });
    } catch { reply(400, { error: "投稿内容を確認してください" }); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  return { server, store };
}
