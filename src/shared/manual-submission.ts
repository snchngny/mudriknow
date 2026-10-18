export interface ManualSubmission {
  appName: string;
  platform: "windows" | "macos" | "all";
  title: string;
  url: string;
  documentVersion: string;
  language: string;
  license: string;
}
/** Only public manual metadata is accepted; no screen/file contents or identity. */
export function validateSubmission(value: unknown): ManualSubmission {
  if (!value || typeof value !== "object") throw new Error("投稿内容が不正です");
  const input = value as Record<string, unknown>;
  const fields = ["appName", "platform", "title", "url", "documentVersion", "language", "license"];
  if (Object.keys(input).some(k => !fields.includes(k))) throw new Error("投稿できるのは資料情報だけです");
  const text = (key: string, max: number, required = true) => {
    const result = typeof input[key] === "string" ? (input[key] as string).trim() : "";
    if ((required && !result) || result.length > max || /[\u0000-\u001f]/.test(result)) throw new Error(`${key}を確認してください`);
    return result;
  };
  const url = new URL(text("url", 2000));
  if (url.protocol !== "https:" || url.username || url.password || url.port || /^(localhost|.*\.local|.*\.localhost)$/.test(url.hostname) || url.hostname.startsWith("[") || /^[\d.]+$/.test(url.hostname)) throw new Error("公開されているHTTPSの資料URLを指定してください");
  if (!["windows", "macos", "all"].includes(String(input.platform))) throw new Error("対象OSを選んでください");
  url.hash = "";
  return { appName: text("appName", 160), platform: input.platform as ManualSubmission["platform"], title: text("title", 200), url: url.href, documentVersion: text("documentVersion", 100, false), language: text("language", 30), license: text("license", 300, false) };
}
export function submissionEndpoint(value: string): string {
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) throw new Error("受付先はHTTPS、ローカル検証はlocalhostのHTTPを指定してください");
  return url.href.replace(/\/$/, "");
}
