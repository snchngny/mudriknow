import { spawn, ChildProcess } from "child_process";
import { randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { findOpenCodeBin } from "./opencode-client";
import { buildCleanOpenCodeEnv } from "../shared/providers";

/** OpenCode owns OAuth, token storage and renewal. Tokens never enter IPC. */
export class OpenCodeLogin {
  private child?: ChildProcess;
  private ready?: Promise<void>;
  private base = "";
  private password = "";
  private pending = false;
  private error = "";
  private attempt = 0;
  private modelCache?: { at: number; models: { id: string; name: string }[] };
  constructor(private directory: string, private configHome: string) {}
  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const bin = findOpenCodeBin();
      if (!bin) { reject(new Error("同梱OpenCodeが見つかりません")); return; }
      this.password = randomBytes(32).toString("hex");
      const env = buildCleanOpenCodeEnv(process.env, {});
      env.XDG_CONFIG_HOME = this.configHome;
      env.OPENCODE_SERVER_PASSWORD = this.password;
      env.OPENCODE_SERVER_USERNAME = "opencode";
      const child = this.child = spawn(bin, ["serve", "--pure", "--hostname", "127.0.0.1", "--port", "0"], { cwd: this.directory, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error("OpenCodeの起動がタイムアウトしました")); }, 20000);
      child.stdout?.on("data", b => {
        output = (output + b).slice(-4000);
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { this.base = match[0]; clearTimeout(timer); resolve(); }
      });
      child.stderr?.resume(); // Never forward OAuth/server output into app logs.
      child.on("error", () => { clearTimeout(timer); reject(new Error("OpenCodeを起動できません")); });
      child.on("exit", () => { clearTimeout(timer); if (this.child === child) { this.ready = undefined; this.base = ""; } reject(new Error("OpenCodeが終了しました")); });
    });
    return this.ready;
  }
  private async request(route: string, body?: unknown, timeout = 15000): Promise<any> {
    await this.start();
    const response = await fetch(this.base + route, { method: body === undefined ? "GET" : "POST", headers: { Authorization: "Basic " + Buffer.from("opencode:" + this.password).toString("base64"), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error("OpenCodeの認証処理に失敗しました。もう一度接続してください");
    return response.json();
  }
  async status() {
    const providers = await this.request("/provider");
    const provider = providers.all?.find((p: any) => p.id === "openai");
    let models = Object.values(provider?.models || {}).filter((m: any) => m.capabilities?.input?.image && !/image|realtime|audio|transcribe|tts|embedding/i.test(m.id)).map((m: any) => ({ id: `openai/${m.id}`, name: m.name || m.id }));
    const authPath = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "opencode", "auth.json");
    let auth: any;
    try { auth = JSON.parse(fs.readFileSync(authPath, "utf8")).openai; } catch { /* Not yet connected. */ }
    if (auth?.type === "oauth") {
      // models.dev is a catalog, not this account's entitlement. Use the same
      // authenticated Codex service as OpenCode; never return tokens over IPC.
      if (this.modelCache && Date.now() - this.modelCache.at < 60000) models = this.modelCache.models;
      else try {
        const response = await fetch("https://chatgpt.com/backend-api/codex/models?client_version=1.19.3", { headers: { Authorization: `Bearer ${auth.access}`, ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}), originator: "opencode", "User-Agent": "opencode/1.19.3" }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("Model list unavailable");
        const available = await response.json() as { models?: { slug: string; visibility: string; supported_in_api: boolean }[] };
        models = entitledImageModels(models, available.models || []);
        this.modelCache = { at: Date.now(), models };
      } catch { models = []; this.error = "ChatGPTの利用可能モデルを取得できません。接続を確認するか再ログインしてください"; }
    }
    return { connected: providers.connected?.includes("openai") || false, pending: this.pending, error: this.error, models };
  }
  async begin(): Promise<{ url: string; instructions: string }> {
    if (this.pending) throw new Error("ログインを処理中です。ブラウザで完了するか中止してください");
    const methods = await this.request("/provider/auth");
    const method = methods.openai?.findIndex((m: any) => m.type === "oauth" && /browser/i.test(m.label));
    if (method == null || method < 0) throw new Error("このOpenCodeにはChatGPTブラウザ認証がありません");
    const result = await this.request("/provider/openai/oauth/authorize", { method });
    const url = new URL(result.url);
    if (url.protocol !== "https:" || !["auth.openai.com", "auth0.openai.com", "chatgpt.com"].includes(url.hostname) || result.method !== "auto") throw new Error("対応していない認証方式です");
    this.pending = true; this.error = ""; this.modelCache = undefined;
    const attempt = ++this.attempt;
    void this.request("/provider/openai/oauth/callback", { method }, 180000).then(result => { if (result !== true) throw new Error("Login failed"); }).catch(() => { if (this.attempt === attempt) this.error = "ログインが完了しませんでした。再接続してください"; }).finally(() => { if (this.attempt === attempt) this.pending = false; });
    return { url: url.href, instructions: "ブラウザでChatGPTにログインしてください。完了すると接続済みに変わります" };
  }
  stop(): void { this.attempt++; this.child?.kill(); this.child = undefined; this.ready = undefined; this.base = ""; this.pending = false; this.error = ""; }
}

export function entitledImageModels(catalog: { id: string; name: string }[], available: { slug: string; visibility: string; supported_in_api: boolean }[]) {
  const supported = new Set(available.filter(m => m.supported_in_api && m.visibility === "list").map(m => `openai/${m.slug}`));
  return catalog.filter(m => supported.has(m.id));
}
