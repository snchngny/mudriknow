import React, { useEffect, useState } from "react";
import { AppResearchState } from "@shared/types";

export function AppResearch({ busy }: { busy: boolean }) {
  const [state, setState] = useState<AppResearchState | null>(null);
  const [manuals, setManuals] = useState({ count: 0, titles: [] as string[] });
  const [manualError, setManualError] = useState("");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submission, setSubmission] = useState({ title: "", url: "", documentVersion: "", language: "ja", platform: "all", license: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState("");
  useEffect(() => {
    let live = true;
    setManualError("");
    const refresh = () => { void window.hoverbuddy.listManuals().then(value => { if (live) setManuals(value); }); };
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => { live = false; clearInterval(timer); };
  }, [state?.key]);
  useEffect(() => {
    let updated = false;
    const unsubscribe = window.hoverbuddy.onAppResearch((next) => { updated = true; setState(next); });
    void window.hoverbuddy.getAppResearch().then((next) => { if (!updated) setState(next); });
    return unsubscribe;
  }, []);
  if (!state) return <section className="app-research">相談したいソフトを前面にして Alt+X で選択してください</section>;
  return <section className="app-research" aria-label="アプリの参照情報" aria-live="polite">
    <strong>{state.appName} · 版 {state.version}</strong>
    <div title={manuals.titles.join("\n")}>保存資料: {manuals.count}件 <button disabled={busy} onClick={async () => {
      const result = await window.hoverbuddy.importManual();
      setManualError(result.error || "");
      setManuals(await window.hoverbuddy.listManuals());
    }}>マニュアルを追加</button></div>
    {manualError && <div role="alert">{manualError}</div>}
    <button disabled={busy || submitting} onClick={async () => {
      setSubmitting(true);
      try { const result = await window.hoverbuddy.syncSharedManuals(); setManualError(result.ok ? `共有台帳: ${result.matched}件一致、${result.added}件を新たに保存` : result.error); setManuals(await window.hoverbuddy.listManuals()); }
      catch { setManualError("共有台帳を取得できませんでした"); }
      finally { setSubmitting(false); }
    }}>共有台帳から資料を取得</button>
    <button disabled={busy} onClick={() => setSubmitOpen(v => !v)}>マニュアルのURLを匿名投稿</button>
    {submitOpen && <form onSubmit={async e => {
      e.preventDefault(); setSubmitting(true); setSubmitted("");
      try { const result = await window.hoverbuddy.submitManual({ ...submission, appName: state.appName }); setSubmitted(result.ok ? `受付番号: ${result.id}（確認後に共有資料へ反映）` : result.error); }
      catch { setSubmitted("投稿できませんでした"); } finally { setSubmitting(false); }
    }}>
      <p>名前・メール・GitHubアカウントは不要。送信するのは下記の資料情報とソフト名「{state.appName}」だけ。画面・会話・ローカルファイルは送信しません</p>
      <label>資料名 <input required maxLength={200} value={submission.title} onChange={e => setSubmission({ ...submission, title: e.target.value })} /></label>
      <label>公式資料のURL <input required type="url" value={submission.url} onChange={e => setSubmission({ ...submission, url: e.target.value })} /></label>
      <label>資料の対象版（不明なら空欄）<input maxLength={100} value={submission.documentVersion} onChange={e => setSubmission({ ...submission, documentVersion: e.target.value })} /></label>
      <label>言語 <input required maxLength={30} value={submission.language} onChange={e => setSubmission({ ...submission, language: e.target.value })} /></label>
      <label>対象OS <select value={submission.platform} onChange={e => setSubmission({ ...submission, platform: e.target.value })}><option value="all">共通</option><option value="windows">Windows</option><option value="macos">macOS</option></select></label>
      <label>利用条件・ライセンス（任意）<input maxLength={300} value={submission.license} onChange={e => setSubmission({ ...submission, license: e.target.value })} /></label>
      <p>本文の転載はせず、URLを共有します</p>
      <button disabled={busy || submitting} type="submit">この資料情報を匿名で送信</button>
      <div role="status">{submitted}</div>
    </form>}
    <div>{state.status === "loading" ? "このアプリの資料を調べています…" : state.status === "ready" ? "参照資料を取得済み" : state.error || "調査を停止しました"}</div>
    {state.status === "loading" && <button onClick={() => window.hoverbuddy.stopResponse()}>調査を停止</button>}
    {state.status !== "loading" && <button disabled={busy} onClick={() => window.hoverbuddy.retryAppResearch()}>{state.status === "ready" ? "資料を再調査" : "調査を再試行"}</button>}
    {state.status === "ready" && <details><summary>調査内容・出典</summary>
      <p>{state.summary}</p>
      <p>アプリの版と資料の対象版は別。資料の適合は未確認</p>
      <ul>{state.sources?.map((source) => <li key={source.url}><button className="app-research-link" onClick={() => window.hoverbuddy.openExternal(source.url)}>{source.title}</button> · 資料の対象版: {source.documentVersion || "不明"}</li>)}</ul>
      <small>確認時刻: {state.checkedAt ? new Date(state.checkedAt).toLocaleString("ja-JP") : "不明"} · 実行ファイルの版。Webサービスの版は別途確認</small>
    </details>}
  </section>;
}
