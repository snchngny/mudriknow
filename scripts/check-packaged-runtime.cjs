const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = process.platform === 'win32' ? path.resolve('release/win-unpacked/resources') : path.resolve(`release/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/MudrikNow.app/Contents/Resources`);
const directory = path.join(root, 'opencode');
const bin = path.join(directory, process.platform === 'win32' ? 'opencode.exe' : 'opencode');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
const hash = crypto.createHash('sha256').update(fs.readFileSync(bin)).digest('hex');
// macOS ad-hoc signing modifies the executable, so verify its version instead of the pre-signing hash there.
if (process.platform === 'win32' && hash !== manifest.sha256) throw new Error('Bundled executable hash mismatch');
const cleanEnv = { ...process.env };
for (const key of Object.keys(cleanEnv)) if (/API_KEY|TOKEN|SECRET|OPENCODE_BIN_PATH/.test(key)) delete cleanEnv[key];
cleanEnv.PATH = process.platform === 'win32' ? `${process.env.SystemRoot}\\System32` : '/usr/bin:/bin';
const version = execFileSync(bin, ['--version'], { env: cleanEnv, encoding: 'utf8', timeout: 30000 }).trim();
if (version !== manifest.version) throw new Error('Bundled runtime version mismatch');
if (process.platform === 'darwin') fs.accessSync(path.join(root, 'app.asar.unpacked/node_modules/get-windows/main'), fs.constants.X_OK);
const asar = require('@electron/asar');
if (asar.listPackage(path.join(root, 'app.asar')).some(file => /(?:^|[\\/])(?:auth\.json|config\.json|\.local|\.env)(?:$|[\\/])/.test(file))) throw new Error('Private data found in package');
console.log(`Packaged OpenCode ${version}: runs with system-only PATH; private data paths absent`);
