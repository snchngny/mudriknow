import React, { useEffect, useState } from "react";

export function ConnectionSetup({ busy, onModel }: { busy: boolean; onModel: (model: string) => void }) {
  const [state, setState] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [model, setModel] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [catalogUrl, setCatalogUrl] = useState("");
  const refresh = async () => {
    const next = await window.hoverbuddy.connectionStatus(); setState(next);
    setModel(previous => next.models.some((m: any) => m.id === previous) ? previous : next.models.some((m: any) => m.id === next.model) ? next.model : next.models[0]?.id || "");
  };
  useEffect(() => { void refresh(); void window.hoverbuddy.getConfig().then(c => { setEndpoint(c.manualSubmissionUrl || ""); setCatalogUrl(c.manualCatalogUrl || ""); }); }, []);
  useEffect(() => {
    if (!state?.pending) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [state?.pending]);
  return <details id="ai-connection" className="app-research" open={!state?.connected && state?.model?.startsWith("openai/")}>
    <summary>AI接続・資料共有の設定 {state?.connected ? "· OpenAI接続済み" : ""}</summary>
    <p>ChatGPTのプランの利用枠を使います。画像対応モデルを選んでください</p>
    <button disabled={busy || waiting || state?.pending} onClick={async () => {
      setWaiting(true); setMessage("");
      try { const result = await window.hoverbuddy.chatgptLogin(); setMessage(result.error || result.instructions || "ブラウザでログインしてください"); await refresh(); }
      catch { setMessage("接続できませんでした"); } finally { setWaiting(false); }
    }}>ChatGPTにログイン</button>
    {state?.pending && <button onClick={async () => { await window.hoverbuddy.cancelChatgptLogin(); await refresh(); }}>ログインを中止</button>}
    <button disabled={waiting} onClick={() => void refresh()}>接続を確認</button>
    <div role="status">{message || state?.error || (state?.pending ? "ログインを待っています" : "")}</div>
    {state?.connected && <div><select aria-label="ChatGPTの画像対応モデル" value={model} onChange={e => setModel(e.target.value)}>{state.models.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      <button disabled={busy || !model} onClick={async () => { try { await window.hoverbuddy.useChatgptModel(model); onModel(model); setMessage("このモデルで回答します"); await refresh(); } catch { setMessage("モデルを設定できませんでした"); } }}>このモデルを使う</button></div>}
    <p><label><input type="checkbox" checked={!!state?.jevEnabled} disabled={busy} onChange={async e => { await window.hoverbuddy.setConfig({ jevEnabled: e.target.checked }); await refresh(); }} />Jevで画面の再取得を省く（任意）</label></p>
    <small>無効時や接続失敗時は画面を再取得。Jevを使う場合はOpenCodeのAPIキーが必要</small>
    <p><label>資料投稿の受付先 <input aria-label="資料投稿の受付先" value={endpoint} placeholder="https://受付先 または http://127.0.0.1:43127" onChange={e => setEndpoint(e.target.value)} /></label>
      <button onClick={async () => { try { await window.hoverbuddy.setConfig({ manualSubmissionUrl: endpoint.trim(), manualCatalogUrl: catalogUrl.trim() }); setMessage("受付先を保存しました"); } catch { setMessage("受付先のURLを確認してください"); } }}>受付先を保存</button></p>
    <label>共有台帳URL（任意）<input aria-label="共有台帳URL" value={catalogUrl} onChange={e => setCatalogUrl(e.target.value)} placeholder="https://共有先/catalog.json" /></label>
    <small>空欄なら受付先の台帳を使用。GitHub Pagesなどの台帳も指定可能</small>
  </details>;
}
