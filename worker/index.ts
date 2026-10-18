import { validateSubmission } from "../src/shared/manual-submission";

interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPOSITORY: string;
  ALLOWED_MANUAL_HOSTS: string;
  SUBMISSION_LIMIT: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const encode = (s: string) => {
  let binary = "";
  for (const byte of new TextEncoder().encode(s)) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const decode = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), c => c.charCodeAt(0)));

/** The only writable path is manual/catalog.json; credentials remain server-side. */
export async function handleRequest(request: Request, env: Env, transport: typeof fetch = fetch): Promise<Response> {
  if (request.method === "GET" && new URL(request.url).pathname === "/health") return response(200, { ok: true });
  if (request.method !== "POST" || new URL(request.url).pathname !== "/submissions") return response(404, { error: "Not found" });
  if (request.headers.has("Origin")) return response(403, { error: "アプリから投稿してください" });
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") || "")) return response(415, { error: "JSON required" });
  if (!env.GITHUB_TOKEN || !/^[a-z\d-]+\/[a-z\d_.-]+$/i.test(env.GITHUB_REPOSITORY) || !env.SUBMISSION_LIMIT) return response(503, { error: "受付は未設定です" });
  // Cloudflare's rate limiter keeps its own short-lived key; no IP or request logs are written by this Worker.
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
    const manual = validateSubmission(JSON.parse(new TextDecoder().decode(bytes)));
    const url = new URL(manual.url);
    const hosts = env.ALLOWED_MANUAL_HOSTS.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!hosts.includes(url.hostname) || url.search || /[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:^|["\s])[a-z]:[\\/]|\/Users\/|\/home\//i.test(JSON.stringify(manual))) return response(400, { error: "許可された公式資料のURLと公開情報だけを指定してください" });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(manual)));
    const id = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
    const endpoint = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/contents/manual/catalog.json`;
    const headers = { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "MudrikNow-manual-intake" };
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await transport(endpoint + "?ref=main", { headers, signal: AbortSignal.timeout(10000) });
      if (!existing.ok) return response(502, { error: "共有台帳を取得できませんでした" });
      const file = await existing.json() as { sha: string; content: string; size: number };
      if (file.size > 512000) return response(503, { error: "台帳の上限です" });
      const catalog = JSON.parse(decode(file.content));
      if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.manuals)) return response(502, { error: "共有台帳の形式が不正です" });
      if (catalog.manuals.some((m: { id: string }) => m.id === id)) return response(202, { id, status: "approved" });
      if (catalog.manuals.length >= 1000) return response(503, { error: "台帳の上限です" });
      catalog.manuals.push({ id, ...manual });
      const updated = await transport(endpoint, {
        method: "PUT", headers, signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ message: "資料案内を匿名投稿から追加", branch: "main", sha: file.sha, content: encode(JSON.stringify(catalog, null, 2) + "\n"),
          author: { name: "Manual intake", email: "manual-intake@users.noreply.github.com" }, committer: { name: "Manual intake", email: "manual-intake@users.noreply.github.com" } }),
      });
      if (updated.ok) return response(202, { id, status: "approved" });
      if (![409, 422].includes(updated.status)) return response(502, { error: "台帳を更新できませんでした" });
    }
    return response(503, { error: "投稿が集中しています。再送してください" });
  } catch { return response(400, { error: "投稿内容または接続を確認してください" }); }
}
export default { fetch: (request: Request, env: Env) => handleRequest(request, env) };
