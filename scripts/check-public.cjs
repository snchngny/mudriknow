const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const forbiddenPath = /(^|\/)(\.local|node_modules|dist|release|\.env|auth\.json|config\.json|\.dev\.vars)(\/|$)/;
let errors = 0;
for (const file of new Set(files)) {
  if (forbiddenPath.test(file)) { console.error('Private/generated path:', file); errors++; continue; }
  if (!/\.(?:[cm]?js|tsx?|json|md|ya?ml|ps1|sh|txt|html)$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  // No machine-specific user paths or real credential shapes. Never print matched values.
  if (/(?:[A-Z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s"']+)|(?:gh[pousr]_[A-Za-z0-9]{30,})|(?:github_pat_[A-Za-z0-9_]{40,})|(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i.test(text)) {
    console.error('Possible personal path or credential:', file); errors++;
  }
}
const catalog = JSON.parse(fs.readFileSync('manual/catalog.json', 'utf8'));
if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.manuals)) throw new Error('Invalid manual catalog');
if (errors) process.exit(1);
console.log(`Public source guard OK (${new Set(files).size} files)`);
