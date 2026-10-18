import { validateSubmission, ManualSubmission } from "../src/shared/manual-submission";

interface Storage {
  list(options: { prefix: string; limit: number }): Promise<Map<string, ManualSubmission>>;
  put(key: string, value: ManualSubmission): Promise<void>;
}
interface Env {
  ALLOWED_MANUAL_HOSTS: string;
  SUBMISSION_LIMIT: { limit(options: { key: string }): Promise<{ success: boolean }> };
  MANUAL_QUEUE: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
}
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
export function publicManual(value: unknown, allowedHosts: string): ManualSubmission {
  const manual = validateSubmission(value);
  const url = new URL(manual.url);
  const hosts = allowedHosts.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!hosts.includes(url.hostname) || url.search || /[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:^|["\s])[a-z]:[\\/]|\/Users\/|\/home\//i.test(JSON.stringify(manual))) throw new Error("公開資料のURLと資料情報だけを指定してください");
  return manual;
}

/** SQLite-backed Durable Object: public metadata only, no operator GitHub credentials. */
export class ManualQueue {
  constructor(private state: { storage: Storage }) {}
  async fetch(request: Request): Promise<Response> {
    const entries = await this.state.storage.list({ prefix: "manual:", limit: 1000 });
    if (request.method === "GET") return response(200, { schemaVersion: 1, manuals: [...entries].map(([key, manual]) => ({ id: key.slice(7), ...manual })) });
    if (request.method !== "POST") return response(405, { error: "Method not allowed" });
    const manual = validateSubmission(await request.json());
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(manual)));
    const id = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
    if (!entries.has("manual:" + id)) {
      if (entries.size >= 1000) return response(503, { error: "受付上限です" });
      await this.state.storage.put("manual:" + id, manual);
    }
    return response(202, { id, status: "queued" });
  }
}
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (request.method === "GET" && pathname === "/health") return response(200, { ok: true });
  if (!env.MANUAL_QUEUE || !env.SUBMISSION_LIMIT) return response(503, { error: "受付は未設定です" });
  const queue = () => env.MANUAL_QUEUE.get(env.MANUAL_QUEUE.idFromName("public-manuals"));
  if (request.method === "GET" && pathname === "/pending.json") return queue().fetch(new Request("https://queue.internal/manuals"));
  if (request.method !== "POST" || pathname !== "/submissions") return response(404, { error: "Not found" });
  if (request.headers.has("Origin")) return response(403, { error: "アプリから投稿してください" });
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") || "")) return response(415, { error: "JSON required" });
  const limited = await env.SUBMISSION_LIMIT.limit({ key: request.headers.get("CF-Connecting-IP") || "unknown" });
  if (!limited.success) return response(429, { error: "投稿回数の上限です" });
  try {
    const reader = request.body?.getReader();
    if (!reader) return response(400, { error: "投稿内容がありません" });
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const item = await reader.read(); if (item.done) break;
      length += item.value.length;
      if (length > 8192) { await reader.cancel(); return response(413, { error: "投稿内容が大きすぎます" }); }
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(length); let position = 0;
    for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
    const manual = publicManual(JSON.parse(new TextDecoder().decode(bytes)), env.ALLOWED_MANUAL_HOSTS);
    return await queue().fetch(new Request("https://queue.internal/manuals", { method: "POST", body: JSON.stringify(manual) }));
  } catch { return response(400, { error: "許可された公式資料のURLと公開情報だけを指定してください" }); }
}
export default { fetch: (request: Request, env: Env) => handleRequest(request, env) };
