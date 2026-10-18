const fs = require('node:fs');
const { createHash } = require('node:crypto');

function mergeCatalog(existing, incoming, validate, blocked = []) {
  if (existing.schemaVersion !== 1 || incoming.schemaVersion !== 1 || !Array.isArray(existing.manuals) || !Array.isArray(incoming.manuals) || incoming.manuals.length > 1000) throw new Error('Invalid catalog');
  const result = new Map(existing.manuals.map(m => [m.id, m]));
  for (const value of incoming.manuals) {
    const { id, ...input } = value;
    let manual;
    try { manual = validate(input); } catch { continue; }
    const expected = createHash('sha256').update(JSON.stringify(manual)).digest('hex');
    if (id !== expected || blocked.includes(id)) continue;
    if (!result.has(id) && result.size < 1000) result.set(id, { id, ...manual });
  }
  return { schemaVersion: 1, manuals: [...result.values()].filter(m => !blocked.includes(m.id)).sort((a, b) => a.id.localeCompare(b.id)) };
}
module.exports = { mergeCatalog };
if (require.main === module) (async () => {
  const service = JSON.parse(fs.readFileSync('manual/service.json', 'utf8'));
  if (!service.submissionUrl) { console.log('Anonymous intake not published; shared reading remains available'); return; }
  const { submissionEndpoint } = require('../.local/manual-sync/src/shared/manual-submission.js');
  const { publicManual } = require('../.local/manual-sync/worker/index.js');
  const endpoint = submissionEndpoint(service.submissionUrl);
  if (!endpoint.startsWith('https://')) throw new Error('HTTPS required');
  const response = await fetch(endpoint + '/pending.json', { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Intake unavailable');
  const text = await response.text();
  if (text.length > 2 * 1024 * 1024) throw new Error('Intake too large');
  const settings = JSON.parse(fs.readFileSync('worker/wrangler.jsonc', 'utf8'));
  const previous = JSON.parse(fs.readFileSync('manual/catalog.json', 'utf8'));
  const blocked = JSON.parse(fs.readFileSync('manual/blocked.json', 'utf8'));
  const next = mergeCatalog(previous, JSON.parse(text), value => publicManual(value, settings.vars.ALLOWED_MANUAL_HOSTS), blocked);
  fs.writeFileSync('manual/catalog.json', JSON.stringify(next, null, 2) + '\n');
  console.log(`Shared catalog: ${next.manuals.length} entries`);
})().catch(() => { console.error('Manual sync failed; catalog not published'); process.exitCode = 1; });
