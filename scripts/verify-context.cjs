const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
function loadTs(relative){const file=path.join(root,relative);const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);return m.exports;}
(async()=>{
 const {decideCapture}=loadTs('src/main/capture-decision.ts');
 const {ManualLibrary}=loadTs('src/main/manual-library.ts');
 const {applicationKey}=loadTs('src/main/app-research.ts');
 const general=await decideCapture('7-ZipでZIP形式の書庫を作成する一般的な手順を教えて','7-Zip 26.03');
 const screen=await decideCapture('今の画面で選択されているファイル名は何？','7-Zip 26.03');
 const library=new ManualLibrary(path.join(root,'.local/runtime/manuals'));
 const identity={processPath:'C:\\Program Files\\7-Zip\\7zFM.exe',processName:'7zFM',productName:'7-Zip',productVersion:'26.03',fileVersion:'26.03',title:''};
 const state={key:applicationKey(identity),appName:'7-Zip',version:'26.03',status:'ready',summary:'公式の7z形式資料。特定版の操作マニュアルではない',sources:[{title:'7z Format',url:'https://www.7-zip.org/7z.html'}],checkedAt:new Date().toISOString()};
 await library.archiveSources(state);
 const restarted=new ManualLibrary(path.join(root,'.local/runtime/manuals'));
 const documents=restarted.list(state.key);
 const excerpts=restarted.search(state.key,'LZMA compression encryption');
 const result={general,screen,manuals:documents.length,retainedAfterRestart:documents.length>0,searchHasSource:excerpts.includes('https://www.7-zip.org/7z.html'),searchHasContent:/LZMA|compression/i.test(excerpts)};
 const pdfFile=path.join(root,'.local/verification/manual-fixture.pdf');
 if(fs.existsSync(pdfFile)){
   const pdfState={...state,key:'verification-pdf-only',appName:'Verification fixture'};
   const pdf=await library.importFile(pdfState,pdfFile);
   result.pdfPageExtracted=pdf.sections.some(s=>s.heading==='1ページ'&&s.text.includes('ZIP compression'));
   if(!result.pdfPageExtracted)process.exitCode=1;
 }
 fs.mkdirSync(path.join(root,'.local/verification'),{recursive:true});
 fs.writeFileSync(path.join(root,'.local/verification/context-services.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
 if(general.reason!=='jev'||general.capture||!screen.capture||!result.retainedAfterRestart||!result.searchHasSource||!result.searchHasContent)process.exitCode=1;
})().catch(()=>{console.error('Context service verification failed; inspect service availability (credentials are not logged).');process.exitCode=1;});
