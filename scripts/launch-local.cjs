const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.local/runtime');
const executable = require('electron');
const opencode = path.join(root, '.local/bundled-opencode', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
if (!fs.existsSync(opencode) || !fs.existsSync(path.join(root,'dist/main.js'))) throw new Error('See README.local.md to install and build');
const model = process.argv.find(arg=>/^[a-z0-9-]+\//.test(arg));
const env = {...process.env,
  ...(model ? { MUDRIK_MODEL:model } : {}),MUDRIK_USER_DATA:runtime,OPENCODE_BIN_PATH:opencode,
  XDG_DATA_HOME:path.join(runtime,'opencode-data'), XDG_CACHE_HOME:path.join(runtime,'opencode-cache')};
delete env.ELECTRON_RUN_AS_NODE;
const logFile = path.join(runtime, 'mudriknow.log');
const logOffset = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
const child = spawn(executable, [root,...(process.argv.includes('--hidden')?['--hidden']:[])], {cwd:root,env,stdio:'ignore',windowsHide:true,detached:true});
child.on('error',()=>{console.error('Could not start Electron');process.exitCode=1;});
child.on('spawn',()=>{
  console.log('Starting MudrikNow; waiting for the hotkey listener...');
  const deadline = Date.now() + 45000;
  const timer = setInterval(()=>{
    let bootLog='';
    if(fs.existsSync(logFile)) {const fd=fs.openSync(logFile,'r');try{const size=Math.max(0,fs.fstatSync(fd).size-logOffset);const bytes=Buffer.alloc(Math.min(size,128*1024));fs.readSync(fd,bytes,0,bytes.length,logOffset);bootLog=bytes.toString('utf8');}finally{fs.closeSync(fd);}}
    if(bootLog.includes('Hotkey listener started') || bootLog.includes('Existing MudrikNow panel shown')) {
      clearInterval(timer);child.unref();console.log(bootLog.includes('Existing MudrikNow panel shown') ? 'MudrikNow is already running; the existing chat was opened.' : `MudrikNow ready (PID ${child.pid}). Focus your app and press Alt+X.`);
    } else if(Date.now()>deadline || child.exitCode!==null) {
      clearInterval(timer);child.unref();console.error('MudrikNow did not become ready. It may already be running; check the tray or .local/runtime/mudriknow.log.');process.exitCode=1;
    }
  },250);
});
