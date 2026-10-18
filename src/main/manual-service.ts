import { submissionEndpoint } from "../shared/manual-submission";

const SERVICE_URL = "https://raw.githubusercontent.com/snchngny/mudriknow/main/manual/service.json";
let cached: { url: string; until: number } | undefined;

/** Published operator settings let installed applications find the free intake without rebuilding. */
export async function resolveSubmissionEndpoint(configured?: string, transport: typeof fetch = fetch): Promise<string> {
  if (configured) return submissionEndpoint(configured);
  if (cached && cached.until > Date.now()) return cached.url;
  const response = await transport(SERVICE_URL, { redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("匿名受付の設定を取得できませんでした");
  const raw = await response.text();
  if (raw.length > 4096) throw new Error("匿名受付の設定が不正です");
  const service = JSON.parse(raw);
  if (service.schemaVersion !== 1 || typeof service.submissionUrl !== "string" || !service.submissionUrl) throw new Error("匿名受付はまだ公開されていません。共有資料の取得は利用できます");
  const url = submissionEndpoint(service.submissionUrl);
  if (!url.startsWith("https://")) throw new Error("公開受付にはHTTPSが必要です");
  cached = { url, until: Date.now() + 3600000 };
  return url;
}
