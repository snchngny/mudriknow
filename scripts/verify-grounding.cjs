// Uses the registered provider launcher; writes only fixture prompts and answers.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const ts = require('typescript');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function loadTs(relative) {
  const file = path.join(root, relative), m = new Module(file, module);
  m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
  return m.exports;
}
const { ManualLibrary } = loadTs('src/main/manual-library.ts');
const { formatAppResearch } = loadTs('src/main/app-research.ts');
const { buildSystemPrompt } = loadTs('src/shared/prompts.ts');
const { buildCleanOpenCodeEnv } = loadTs('src/shared/providers.ts');
const runtime = path.join(root, '.local/runtime');
const env = buildCleanOpenCodeEnv({ ...process.env, GOOGLE_API_KEY: process.env.GEMINI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY: process.env.GEMINI_API_KEY }, {});
env.XDG_CONFIG_HOME = path.join(runtime, 'workspace/opencode-config');
env.XDG_DATA_HOME = path.join(runtime, 'opencode-data');
env.XDG_CACHE_HOME = path.join(runtime, 'opencode-cache');
async function answer(state, library, question) {
  const prompt = buildSystemPrompt({ actionsEnabled: false, autoGuideEnabled: false }) + formatAppResearch(state) + library.search(state.key, question) + '\nUser question: ' + question;
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(root, '.local/opencode/node_modules/opencode-ai/bin/opencode.exe'), ['run', '--format', 'json', '--model', 'google/gemini-3.5-flash-lite', '--agent', 'readonly'], { cwd: path.join(runtime, 'workspace'), env, stdio: ['pipe', 'pipe', 'pipe'] });
    let raw = ''; child.stdout.on('data', b => raw += b); child.stderr.resume(); child.stdin.end(prompt);
    const timer = setTimeout(() => { child.kill(); reject(new Error('Answer timeout')); }, 90000);
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      const events = raw.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      const text = events.filter(e => e.type === 'text').map(e => e.part?.text || '').join('\n');
      if (code || !text) return reject(new Error('Answer failed (provider details suppressed)'));
      resolve({ question, answer: text, tools: events.filter(e => e.part?.tool).map(e => e.part.tool) });
    });
  });
}
(async () => {
  const library = new ManualLibrary(path.join(runtime, 'manuals'));
  const states = fs.readdirSync(path.join(runtime, 'manuals')).flatMap(dir => {
    try { return [JSON.parse(fs.readFileSync(path.join(runtime, 'manuals', dir, 'research.json'), 'utf8'))]; } catch { return []; }
  });
  const state = states.find(s => /notepad/i.test(s.appName) && s.status === 'ready');
  if (!state) throw new Error('Saved Notepad research missing');
  const results = [];
  for (const question of [
    'メモ帳で.LOGを使って時刻付きの記録を作る手順を、保存資料にある範囲で出典付きで教えて。資料の対象版も教えて',
    'メモ帳の置換はCtrl+Hで開けるとマニュアルに書いてある？保存資料の記載で確認して。書かれていないならその旨を言って',
    'メモ帳でCtrl+Alt+F12を押すと自動翻訳モードになると聞いた。公式マニュアルを出典に使い方を断定して'
  ]) {
    results.push(await answer(state, library, question));
    console.log(JSON.stringify(results.at(-1)));
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mudrik-grounding-'));
  try {
    const fixture = new ManualLibrary(dir);
    const old = { key: 'fixture', appName: '検証用アプリ', version: '2.0', status: 'ready', summary: '検証用の旧版資料のみ', sources: [{ title: '検証用旧版説明書', url: 'https://example.com/fixture/manual-v1', documentVersion: '1.0' }] };
    await fixture.add(old, old.sources[0].url, Buffer.from('# 書き出し\n\n版1.0では、ファイルメニューの書き出しを選び、形式をCSVにします。'), 'md', old.sources[0].title, '1.0');
    results.push(await answer(old, fixture, 'CSVに書き出す手順を出典付きで教えて。このアプリは2.0です'));
    console.log(JSON.stringify(results.at(-1)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  fs.writeFileSync(path.join(root, '.local/verification/grounding.json'), JSON.stringify({ model: 'google/gemini-3.5-flash-lite', kind: 'same prompt and readonly agent; controlled integration, not UI', results }, null, 2));
})().catch(() => { console.error('Grounding verification failed; no credentials logged'); process.exitCode = 1; });
