const {spawn} = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, '.local/runtime');
const fs=require('node:fs');
const ts=require('typescript');
const Module=require('node:module');
function loadTs(file){const m=new Module(file,module);m.filename=file;m.paths=module.paths;m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);return m.exports;}
const providers=loadTs(path.join(root,'src/shared/providers.ts'));
const env = providers.buildCleanOpenCodeEnv({...process.env,GOOGLE_API_KEY:process.env.GEMINI_API_KEY,GOOGLE_GENERATIVE_AI_API_KEY:process.env.GEMINI_API_KEY},{});
env.XDG_CONFIG_HOME=path.join(runtime,'workspace/opencode-config');env.XDG_DATA_HOME=path.join(runtime,'opencode-data');env.XDG_CACHE_HOME=path.join(runtime,'opencode-cache');
const prompt=process.argv.includes('--research')?loadTs(path.join(root,'src/main/app-research.ts')).buildResearchPrompt({processName:'7zFM',processPath:'',title:'',productName:'7-Zip',productVersion:'26.03',fileVersion:'26.03',publisher:'Igor Pavlov',versionSource:'product-version'}):'Reply only OK without using tools';
const model=process.argv.find(v=>v.startsWith('--model='))?.slice(8)||'google/gemini-3.5-flash-lite';
const child = spawn(path.join(root,'.local/opencode/node_modules/opencode-ai/bin/opencode.exe'), ['run','--format','json','--model',model,'--agent','app-research'], {cwd:path.join(runtime,'workspace'),env,stdio:['pipe','pipe','pipe']});
child.stdin.end(prompt);
let raw='';
child.stdout.on('data', b=>{raw+=b;});
child.stderr.resume();
child.on('close',code=>{
 console.log('exit',code);
 for(const line of raw.split('\n')){try{const e=JSON.parse(line);let toolError=e.part?.state?.error;if(typeof toolError==='string'){for(const [k,v]of Object.entries(process.env))if(/KEY|TOKEN|SECRET/i.test(k)&&v)toolError=toolError.split(v).join('[redacted]');toolError=toolError.slice(0,800);} console.log(JSON.stringify({type:e.type,errorName:e.error?.name,errorType:e.error?.type,provider:e.error?.data?.providerID,model:e.error?.data?.modelID,text:e.type==='text'?e.part?.text:undefined,tool:e.part?.tool,status:e.part?.state?.status,toolError,errorKeys:e.error?Object.keys(e.error):undefined,dataKeys:e.error?.data?Object.keys(e.error.data):undefined}));}catch{}}
});
setTimeout(()=>child.kill(),80000).unref();
