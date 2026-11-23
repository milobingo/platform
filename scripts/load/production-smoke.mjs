// One explicitly authorised, hidden production technical fixture; never a load test.
// Root prepares/removes the fixture and provider resources independently. This
// external client has only WHIP publishing access and short-lived viewer tokens.
// Usage: node scripts/load/production-smoke.mjs --config /private/smoke.json --output /private/result.json
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {lookup} from 'node:dns/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {HARNESS_BROWSER_SIGNAL_OPTIONS} from './browser-runtime.mjs';
import {runHlsViewer} from './hls-client.mjs';
import {summarize} from './media-profile.mjs';

export const PRODUCTION_SMOKE_ORIGIN='https://milo.dgwebservices.nl';
const TAG='milo-production-media-smoke-v1';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const fail=code=>{throw Object.assign(Error(code),{code});};
const jsonPart=value=>{try{return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{fail('smoke_token_invalid');}};
function viewer(token,room,now){
 if(typeof token!=='string'||token.length>6000||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))fail('smoke_token_invalid');
 const claims=jsonPart(token.split('.')[1]),v=claims.video;
 const keys=['room','roomJoin','canSubscribe','canPublish','canPublishData','canPublishSources','canUpdateOwnMetadata'];
 if(!claims.sub?.startsWith('viewer-')||!v||Object.keys(v).some(key=>!keys.includes(key))||v.room!==room||v.roomJoin!==true||v.canSubscribe!==true||v.canPublish!==false||v.canPublishData!==false||v.canUpdateOwnMetadata!==false||!Array.isArray(v.canPublishSources)||v.canPublishSources.length||!Number.isSafeInteger(claims.exp)||claims.exp*1000<=now+20000||claims.exp*1000>now+300000||!Number.isSafeInteger(claims.nbf)||claims.nbf*1000>now+5000)fail('smoke_viewer_grants');
 return claims;
}
export function validateProductionSmokeHlsReady(value,config,{now=Date.now()}={}){
 if(!value||Object.keys(value).some(key=>!['gameId','generation','hlsUrl'].includes(key))||value.gameId!==config.fixture.gameId||!/^[a-f0-9]{32}$/.test(value.generation||''))fail('smoke_hls_ready_binding');
 let url;try{url=new URL(value.hlsUrl);}catch{fail('smoke_hls_ready_binding');}
 if(url.origin!==PRODUCTION_SMOKE_ORIGIN||url.username||url.password||url.search||url.hash)fail('smoke_hls_ready_binding');
 const match=url.pathname.match(/^\/api\/broadcast\/hls\/([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})\/live\.m3u8$/);
 if(!match)fail('smoke_hls_ready_binding');
 const claims=jsonPart(match[1]);if(claims.v!==1||claims.g!==value.gameId||claims.n!==value.generation||!Number.isSafeInteger(claims.e)||claims.e<=now+180000||claims.e>now+14400000)fail('smoke_hls_ready_binding');
 return {...value,hlsPrefix:url.pathname.slice(0,url.pathname.lastIndexOf('/')+1)};
}
export function validateProductionSmokeConfiguration(value,{now=Date.now()}={}){
 const fields=['format','origin','livekitUrl','testOnly','fixture','whipUrl','viewerToken','relayViewerToken','hlsUrl','seconds','chromiumPath','sourceReadyFile','hlsReadyFile'];
 if(!value||Object.keys(value).some(key=>!fields.includes(key))||value.format!==TAG||value.origin!==PRODUCTION_SMOKE_ORIGIN||value.livekitUrl!=='wss://milo.dgwebservices.nl'||value.testOnly!==true)fail('smoke_production_target');
 const f=value.fixture;
 if(!f||f.tag!==TAG||f.hidden!==true||!uuid(f.gameId)||!uuid(f.ownerId)||!uuid(f.marker)||new Set([f.gameId,f.ownerId,f.marker]).size!==3||!/^[a-f0-9]{32}$/.test(f.generation||'')||!Number.isSafeInteger(f.createdAt)||now-f.createdAt<0||now-f.createdAt>3600000||f.orderingEnabled!==false||f.realAccounts!==0||f.realOrders!==0)fail('smoke_fixture_guard');
 const room='programme-'+f.gameId,publisherIdentity=room;
 let whip,hls;try{whip=new URL(value.whipUrl);hls=new URL(value.hlsUrl);}catch{fail('smoke_media_url');}
 if(whip.origin!==PRODUCTION_SMOKE_ORIGIN||whip.username||whip.password||whip.search||whip.hash||!/^\/whip\/[A-Za-z0-9_-]{8,200}$/.test(whip.pathname)||hls.origin!==PRODUCTION_SMOKE_ORIGIN||hls.username||hls.password||hls.search||hls.hash)fail('smoke_media_url');
 const match=hls.pathname.match(/^\/api\/broadcast\/hls\/([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})\/live\.m3u8$/);
 if(!match)fail('smoke_hls_binding');
 const cap=jsonPart(match[1]);if(cap.v!==1||cap.g!==f.gameId||cap.n!==f.generation||!Number.isSafeInteger(cap.e)||cap.e<=now+180000||cap.e>now+14400000)fail('smoke_hls_binding');
 const primary=viewer(value.viewerToken,room,now);
 if(value.relayViewerToken&&viewer(value.relayViewerToken,room,now).sub===primary.sub)fail('smoke_distinct_viewers');
 if(!Number.isInteger(value.seconds)||value.seconds<60||value.seconds>90)fail('smoke_bounded_duration');
 for(const field of ['chromiumPath','sourceReadyFile','hlsReadyFile'])if(value[field]!==undefined&&(typeof value[field]!=='string'||!value[field].startsWith('/')||value[field].includes('\0')))fail('smoke_local_path');
 if(value.sourceReadyFile&&value.hlsReadyFile===value.sourceReadyFile)fail('smoke_local_path');
 return {...value,room,publisherIdentity,hlsPrefix:hls.pathname.slice(0,hls.pathname.lastIndexOf('/')+1)};
}
async function privateConfiguration(path){
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid()||(info.mode&0o777)!==0o600||info.nlink!==1||info.size>32768)fail('smoke_private_configuration');
 return validateProductionSmokeConfiguration(JSON.parse(await readFile(path,'utf8')));
}
export function sanitizeProductionSmokeReport(value,config){
 const secrets=[config.viewerToken,config.relayViewerToken,config.whipUrl,config.hlsUrl,config.whipUrl?.split('/').at(-1),config.hlsUrl?.split('/').at(-2)].filter(Boolean);
 let raw=JSON.stringify(value);
 for(const secret of secrets)raw=raw.replaceAll(secret,'[credential-removed]');
 raw=raw.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[token-removed]');
 return JSON.parse(raw);
}
function readiness(sample,now){return !sample.error&&sample.connected&&sample.frames>0&&sample.audioRmsMax>.0001&&now-sample.lastFrameAt<5000&&now-sample.lastAudioAt<10000;}
export function summarizeSmokeSamples(samples,{hls=false,relay=false}={}){
 const first=samples[0],last=samples.at(-1),seconds=first&&last?(last.observedAtMs-first.observedAtMs)/1000:0;
 const video=last?.tracks?.filter(track=>track.kind==='video')||[];
 const dimensions=hls?last?.videoDimensions:video.length?{width:video[0].frameWidth,height:video[0].frameHeight}:null;
 const transports=last?.tracks?.filter(track=>track.kind==='transport')||[];
 const latencyMs=summarize(samples.flatMap(sample=>sample.timecodeSamples||[]).map(sample=>sample.latencyMs));
 const decodedFps=seconds>0?(last.frames-first.frames)/seconds:0;
 const fullResolution=samples.length>0&&samples.every(sample=>hls?sample.videoDimensions?.width===1280&&sample.videoDimensions?.height===720:sample.tracks?.some(track=>track.kind==='video'&&track.frameWidth===1280&&track.frameHeight===720));
 return {samples:samples.length,holdSeconds:seconds,decodedFps,dimensions,fullResolution,audioRmsMax:last?.audioRmsMax??null,audioSamples:(last?.audioSamples??0)-(first?.audioSamples??0),audioFresh:last?last.observedAtMs-last.lastAudioAt<10000:false,frames:last?.frames??0,reconnects:last?.reconnects??0,disconnects:last?.disconnects??0,timeToFirstVideoMs:first?.timeToFirstVideoMs??null,timeToFirstAudioMs:first?.timeToFirstAudioMs??null,latencyMs,relayVerified:relay?transports.some(track=>track.localCandidateType==='relay'):null,transports,hlsPlaybackQuality:last?.hlsPlaybackQuality??null,hlsEvents:last?.hlsEvents??null,passed:samples.length>=2&&seconds>=60&&decodedFps>=20&&fullResolution&&latencyMs.samples>=10&&last.audioRmsMax>.0001&&last.observedAtMs-last.lastAudioAt<10000&&(!relay||transports.some(track=>track.localCandidateType==='relay'))};
}
export async function runProductionSmoke(config,{output}){
 const report={format:TAG,startedAt:new Date().toISOString(),origin:PRODUCTION_SMOKE_ORIGIN,gameId:config.fixture.gameId,marker:config.fixture.marker,generation:config.fixture.generation,executed:false,passed:false,capacityTest:false,realFamilies:false,physicalObsOrTv:false,requestedHoldSeconds:config.seconds,scope:'One synthetic WHIP programme source, one WebRTC decoder, optional second TURN decoder, one HLS decoder and one paced HTTP HLS receiver. No real account, order or game operation.',network:{hlsPlaylists:0,hlsSegments:0,httpErrors:[],blockedRequests:0},samples:{webrtc:[],relay:[],hls:[]}};
 let browser,server,sourcePage,closing=false,deadline,context,httpTask;const pages=[],controller=new AbortController();
 const stop=()=>{closing=true;controller.abort();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 const assertOpen=()=>{if(closing)fail('smoke_interrupted');};
 const safeError=error=>({code:/^[a-z_]{1,80}$/.test(error?.code||'')?error.code:'smoke_step_failed',message:String(error?.message||error).replace(/(?:https?|wss?):\/\/\S+/g,'[URL-removed]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[token-removed]').slice(0,600)});
 try{
  const addresses=await lookup('milo.dgwebservices.nl',{all:true});
  if(!addresses.length||!addresses.some(address=>address.address==='128.140.93.95')||addresses.some(address=>!['128.140.93.95','2a01:4f8:c015:60a6::1'].includes(address.address)))fail('smoke_dns_pin');
  report.dns={verified:true,addresses:addresses.map(address=>address.address)};
  const [{build},{chromium}]=await Promise.all([import('esbuild'),import('@playwright/test')]);
  const sourcePath=resolve(dirname(fileURLToPath(import.meta.url)),'browser-probe.mjs');
  report.browserSourceSha256=createHash('sha256').update(await readFile(sourcePath)).digest('hex');
  const bundled=await build({entryPoints:[sourcePath],bundle:true,write:false,format:'esm',target:'es2022',logLevel:'silent'}),payload=Buffer.from(bundled.outputFiles[0].contents);
  const html=script=>`<!doctype html><meta charset="utf-8"><title>Milo afgeschermde productie-mediaproef</title><script type="module" src="${script}"></script>`;
  server=createServer((request,response)=>{response.setHeader('Cache-Control','no-store');if(request.url==='/probe.js'){response.setHeader('Content-Type','text/javascript');response.end(payload);}else if(request.url==='/'){response.setHeader('Content-Type','text/html');response.end(html('/probe.js'));}else{response.writeHead(404);response.end();}});
  await new Promise(yes=>server.listen(0,'127.0.0.1',yes));const localOrigin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...HARNESS_BROWSER_SIGNAL_OPTIONS,...(config.chromiumPath?{executablePath:config.chromiumPath}:{}),args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
  context=await browser.newContext({viewport:{width:1280,height:720},serviceWorkers:'block'});
  const documentUrl=PRODUCTION_SMOKE_ORIGIN+'/_milo_technical_probe/'+randomUUID(),scriptUrl=documentUrl+'.js';
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.href===documentUrl)return route.fulfill({status:200,contentType:'text/html',body:html(scriptUrl)});
   if(url.href===scriptUrl)return route.fulfill({status:200,contentType:'text/javascript',body:payload});
   if(url.origin===localOrigin||url.origin===PRODUCTION_SMOKE_ORIGIN&&(url.pathname===new URL(config.whipUrl).pathname||url.pathname.startsWith('/whip/')||url.pathname.startsWith(config.hlsPrefix)||url.pathname==='/rtc'||url.pathname.startsWith('/rtc/')))return route.continue();
   report.network.blockedRequests++;return route.abort();
  });
  context.on('response',response=>{const url=new URL(response.url());if(url.origin!==PRODUCTION_SMOKE_ORIGIN||!url.pathname.startsWith(config.hlsPrefix))return;if(response.status()>=400)report.network.httpErrors.push({status:response.status(),kind:url.pathname.endsWith('.m3u8')?'playlist':'segment'});else if(url.pathname.endsWith('.m3u8'))report.network.hlsPlaylists++;else report.network.hlsSegments++;});
  deadline=setTimeout(stop,config.seconds*1000+180000);
  const newPage=async({hls=false}={})=>{assertOpen();const page=await context.newPage();pages.push(page);await page.goto(hls?documentUrl:localOrigin);await page.waitForFunction(()=>window.miloMediaProbe);return page;};
  sourcePage=await newPage();report.executed=true;
  report.source=await sourcePage.evaluate(params=>window.miloMediaProbe.publish(params),{sourceRoute:'browser-whip-test',whipUrl:config.whipUrl,url:config.livekitUrl});
  report.sourceReadyAt=new Date().toISOString();
  const ready={format:TAG,sourceReady:true,gameId:config.fixture.gameId,marker:config.fixture.marker,at:report.sourceReadyAt};
  if(config.sourceReadyFile)await writeFile(config.sourceReadyFile,JSON.stringify(ready)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify(ready));
  const primary=await newPage();await primary.evaluate(params=>window.miloMediaProbe.connect(params),{url:config.livekitUrl,token:config.viewerToken,publisherIdentity:config.publisherIdentity});
  let relay;if(config.relayViewerToken){relay=await newPage();await relay.evaluate(params=>window.miloMediaProbe.connect(params),{url:config.livekitUrl,token:config.relayViewerToken,publisherIdentity:config.publisherIdentity,iceTransportPolicy:'relay'});}
  if(config.hlsReadyFile){
   let ready;const until=Date.now()+90000;
   while(Date.now()<until){
    assertOpen();
    try{
     const info=await lstat(config.hlsReadyFile);
     if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid()||(info.mode&0o777)!==0o600||info.nlink!==1||info.size>4096)fail('smoke_private_hls_ready');
     ready=validateProductionSmokeHlsReady(JSON.parse(await readFile(config.hlsReadyFile,'utf8')),config);break;
    }catch(error){if(error.code!=='ENOENT')throw error;}
    await delay(500,undefined,{signal:controller.signal});
   }
   if(!ready)fail('smoke_hls_ready_timeout');
   report.initialGeneration=report.generation;report.generation=ready.generation;report.hlsReadyHandshake=true;
   config={...config,hlsUrl:ready.hlsUrl,hlsPrefix:ready.hlsPrefix,fixture:{...config.fixture,generation:ready.generation}};
  }
  report.hlsStartup=[];
  let hlsReady=false;
  for(let index=0;index<90;index++){
   assertOpen();const response=await fetch(config.hlsUrl,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(6000)]),redirect:'error',cache:'no-store'});
   report.hlsStartup.push({atMs:Date.now(),status:response.status});
   if(response.ok){await response.body?.cancel();hlsReady=true;break;}await response.body?.cancel();
   if([401,403,410].includes(response.status))fail('smoke_hls_access');await delay(1000,undefined,{signal:controller.signal});
  }
  if(!hlsReady)fail('smoke_hls_not_ready');
  const hls=await newPage({hls:true});await hls.evaluate(url=>window.miloMediaProbe.connectHls({url}),config.hlsUrl);
  const receivers=[{name:'webrtc',page:primary},{name:'hls',page:hls},...(relay?[{name:'relay',page:relay}]:[])];
  const sample=page=>page.evaluate(async()=>{const value=await window.miloMediaProbe.sample(),video=document.querySelector('video');return {...value,videoDimensions:{width:video.videoWidth,height:video.videoHeight}};});
  let readyAll=false;
  for(let index=0;index<60;index++){
   assertOpen();const samples=await Promise.all(receivers.map(async receiver=>({name:receiver.name,...await sample(receiver.page)})));
   report.readiness=samples;
   if(samples.every(value=>readiness(value,Date.now()))){readyAll=true;break;}
   if(samples.some(value=>value.error))fail('smoke_decoder_failed');await delay(500,undefined,{signal:controller.signal});
  }
  if(!readyAll)fail('smoke_decoder_not_ready');
  const httpSamples=[];
  httpTask=runHlsViewer({playlistUrl:config.hlsUrl,signal:controller.signal,identity:'production-smoke-http',onSample:value=>{httpSamples.push(value);}});
  const started=Date.now();report.holdStartedAt=new Date(started).toISOString();
  do{
   assertOpen();for(const receiver of receivers){const value=await sample(receiver.page);report.samples[receiver.name].push(value);if(!readiness(value,Date.now()))fail('smoke_playback_lost');}
   // Each decoder starts sampling at a slightly different instant. Complete
   // the requested hold independently, rather than rounding a global timer.
   if(receivers.every(receiver=>{const values=report.samples[receiver.name];return values.at(-1).observedAtMs-values[0].observedAtMs>=config.seconds*1000;}))break;
   await delay(1000,undefined,{signal:controller.signal});
  }while(true);
  controller.abort();report.hlsHttp=await httpTask;report.hlsHttpSamples=httpSamples;
  report.webrtc=summarizeSmokeSamples(report.samples.webrtc);report.hls=summarizeSmokeSamples(report.samples.hls,{hls:true});if(relay)report.relay=summarizeSmokeSamples(report.samples.relay,{relay:true});
  report.sourceFinal=await sourcePage.evaluate(()=>window.miloMediaProbe.sourceSample());
  report.passed=report.webrtc.passed&&report.hls.passed&&(!relay||report.relay.passed)&&report.hlsHttp.segments>=20&&report.hlsHttp.errors===0&&report.network.httpErrors.length===0&&report.network.blockedRequests===0;
 }catch(error){report.error=safeError(error);report.passed=false;}
 finally{
  closing=true;clearTimeout(deadline);controller.abort();if(httpTask)await httpTask.catch(()=>{});
  report.cleanup={receiverDisconnects:[],whipClosed:false,browserClosed:false,providerResourcesRemovedByThisClient:false};
  for(const page of pages.filter(page=>page!==sourcePage)){try{await Promise.race([page.evaluate(()=>window.miloMediaProbe.disconnect()),delay(4000).then(()=>{throw Error('cleanup_timeout');})]);report.cleanup.receiverDisconnects.push(true);}catch{report.cleanup.receiverDisconnects.push(false);report.passed=false;}}
  if(sourcePage){try{await Promise.race([sourcePage.evaluate(()=>window.miloMediaProbe.stopPublishing()),delay(7000).then(()=>{throw Error('cleanup_timeout');})]);report.cleanup.whipClosed=true;}catch{report.passed=false;}}
  await context?.close().catch(()=>{});await browser?.close().catch(()=>{});report.cleanup.browserClosed=!!browser;if(server)await new Promise(yes=>server.close(yes));
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);report.finishedAt=new Date().toISOString();
  const sanitized=sanitizeProductionSmokeReport(report,config);await writeFile(output,JSON.stringify(sanitized,null,2)+'\n',{mode:0o600,flag:'wx'});
 }
 return sanitizeProductionSmokeReport(report,config);
}
async function main(){
 const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--config'||args[2]!=='--output')fail('smoke_usage');
 const config=await privateConfiguration(resolve(args[1])),output=resolve(args[3]);
 try{await lstat(output);fail('smoke_output_exists');}catch(error){if(error.code!=='ENOENT')throw error;}
 const report=await runProductionSmoke(config,{output});
 console.log(JSON.stringify({format:TAG,passed:report.passed,executed:report.executed,capacityTest:false,webrtc:report.webrtc,hls:report.hls,relay:report.relay,error:report.error}));if(!report.passed)process.exitCode=1;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(JSON.stringify({passed:false,code:/^[a-z_]{1,80}$/.test(error?.code||'')?error.code:'smoke_configuration_failed',credentialsPrinted:false}));process.exitCode=1;});
