// Prints public model IDs and availability only; never logs credentials/body.
(async () => {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing');
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {headers:{'x-goog-api-key':process.env.GEMINI_API_KEY},signal:AbortSignal.timeout(20000)});
  console.log('HTTP',response.status);
  if (!response.ok) return;
  const data = await response.json();
  console.log(JSON.stringify(data.models?.filter(m=>/gemini.*flash/.test(m.name)).map(m=>m.name)));
})().catch(()=>{console.error('Model availability check failed');process.exitCode=1;});
