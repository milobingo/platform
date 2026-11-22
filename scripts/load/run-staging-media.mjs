import {spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {readFile,lstat,mkdir,writeFile,appendFile} from 'node:fs/promises';
import http from 'node:http';
import {cpus,freemem,networkInterfaces,hostname} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {STAGES,MEDIA_PROFILE,cliDurationSeconds,fullOccupancyHoldSeconds,summarizeTurnBurden,validateLoadConfiguration,validateFixtureManifest,requireDnsPin,viewerToken,pressureReasons,parseCliTrackResults,summarize} from './media-profile.mjs';
import {runHlsViewer} from './hls-client.mjs';

const base=dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
const mode=args[0];
if(!['--preflight','--run','--source','--connectivity'].includes(mode)||!args[1]||!args[2]){
  console.error('Gebruik: node scripts/load/run-staging-media.mjs --preflight|--run|--source|--connectivity /privaat/config.json /privaat/resultaatmap');process.exit(2);
}
const output=resolve(args[2]);
await mkdir(output,{recursive:true,mode:0o700});
const report={format:'milo-media-load-result-v1',startedAt:new Date().toISOString(),executed:false,complete:false,profile:MEDIA_PROFILE,stages:[],hardwareTests:{chromecast:{executed:false},airplay:{executed:false}},limitations:[]};
const file=resolve(output,'report.json');
const sensitive=[];
const safeError=error=>String(error?.message||error).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[token verwijderd]').replace(/https?:\/\/\S+/g,'[URL verwijderd]').replace(/wss?:\/\/\S+/g,'[WSS verwijderd]');
const save=()=>writeFile(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
let server,browser,sourcePage;
let terminate=false;
process.on('SIGINT',()=>{terminate=true;});process.on('SIGTERM',()=>{terminate=true;});

async function privateJson(path){
  const metadata=await lstat(path);
  if(!metadata.isFile()||metadata.isSymbolicLink()||metadata.nlink!==1||metadata.uid!==process.getuid()||metadata.mode&0o077||metadata.size>65536)throw new Error('Configuratie en credentials moeten eigen gewone private bestanden (0600) zijn.');
  return JSON.parse(await readFile(path,'utf8'));
}
async function execute(command,parameters,{input,env,timeout=12000}={}){
  return new Promise((accept,reject)=>{
    const child=spawn(command,parameters,{stdio:['pipe','pipe','pipe'],env:env||process.env});let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Read-only observatie overschrijdt de tijdslimiet.'));},timeout);
    child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>4000000)child.kill('SIGKILL');});
    child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>4000000)child.kill('SIGKILL');});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);code===0?accept({stdout,stderr}):reject(new Error(`Gereedschap stopte met code ${code}: ${safeError(stderr).slice(0,300)}`));});
    child.stdin.end(input);
  });
}
async function observeHost(config){
  const script=await readFile(resolve(base,'host-observe.py'),'utf8');
  const before=Date.now();
  const {stdout}=await execute('ssh',['-F',config.ssh.config,'-o','BatchMode=yes','-o','ConnectTimeout=5',config.ssh.alias,'python3 -'],{input:script});
  const after=Date.now(),value=JSON.parse(stdout);
  if(value.host!==config.inventory.host)throw new Error('De geobserveerde host wijkt af van de bevestigde doel-VPS.');
  return {...value,observerRoundTripMs:after-before,clockOffsetEstimateMs:value.observedAtMs-(before+after)/2};
}
async function health(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'});
  if(!response.ok)throw new Error(`Gezondheidscontrole HTTP ${response.status}`);
  return {origin:new URL(url).origin,status:response.status};
}
async function observeSafety(config,previous,phase='preflight'){
  const [host,...services]=await Promise.all([observeHost(config),...config.criticalHealthUrls.map(health)]);
  const reasons=pressureReasons(host,previous,config.targetNetworkMbps);
  await appendFile(resolve(output,'host-observations.jsonl'),JSON.stringify({phase,host,services,reasons})+'\n',{mode:0o600});
  if(reasons.length)throw new Error(reasons.join(' '));
  return host;
}
async function localServer(config){
  const {build}=await import('esbuild');
  const bundle=await build({entryPoints:[resolve(base,'browser-probe.mjs')],bundle:true,write:false,format:'esm',target:'es2022',logLevel:'silent'});
  const payload=bundle.outputFiles[0].contents;
  const html='<!doctype html><html lang="nl"><meta charset="utf-8"><title>Afgeschermde Milo-mediaproef</title><style>body{margin:0;background:#160e21}video,canvas{width:100%;height:auto}</style><script type="module" src="/probe.js"></script></html>';
  server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.url==='/probe.js'){res.setHeader('Content-Type','text/javascript');res.end(payload);}
    else if(req.url==='/announcements'&&config.announcementsPath){res.setHeader('Content-Type','audio/wav');res.end(await readFile(config.announcementsPath));}
    else if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}
    else{res.writeHead(404);res.end();}
  });
  await new Promise(accept=>server.listen(0,'127.0.0.1',accept));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const {chromium}=await import('@playwright/test');
  browser=await chromium.launch({headless:true,...(config.chromiumPath?{executablePath:config.chromiumPath}:{}),args:['--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
  return origin;
}
function publisherToken(config,credentials){
  const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body=Buffer.from(JSON.stringify({iss:credentials.apiKey,sub:config.publisherIdentity,nbf:now-5,exp:now+7200,video:{room:config.room,roomJoin:true,canPublish:true,canPublishData:false,canSubscribe:false,canPublishSources:['screen_share','screen_share_audio']},metadata:'{"testOnly":true}'})).toString('base64url');
  return `${header}.${body}.${createHmac('sha256',credentials.apiSecret).update(`${header}.${body}`).digest('base64url')}`;
}
async function observeRoom(config,credentials){
  const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body=Buffer.from(JSON.stringify({iss:credentials.apiKey,sub:'milo-load-observer',nbf:now-5,exp:now+30,video:{room:config.room,roomAdmin:true}})).toString('base64url');
  const token=`${header}.${body}.${createHmac('sha256',credentials.apiSecret).update(`${header}.${body}`).digest('base64url')}`;
  const origin=config.livekitUrl.replace(/^wss:/,'https:');
  const response=await fetch(new URL('/twirp/livekit.RoomService/ListParticipants',origin),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({room:config.room}),signal:AbortSignal.timeout(8000),redirect:'error'});
  if(!response.ok)throw new Error(`Read-only testroomcontrole HTTP ${response.status}`);
  const value=await response.json(),participants=value.participants||[];
  const publisher=participants.find(item=>item.identity===config.publisherIdentity);
  const viewers=participants.filter(item=>item.identity?.startsWith('milo-load-')&&item.identity!==config.publisherIdentity);
  const otherPublishers=participants.filter(item=>item.identity!==config.publisherIdentity&&(item.tracks||[]).length);
  if(otherPublishers.length)throw new Error('Een onverwachte publisher heeft toegang tot de test-programmaroom.');
  if(!publisher||(publisher.tracks||[]).length!==2)throw new Error('De technische programmabron moet precies één audio- en één videotrack publiceren.');
  return {observedAtMs:Date.now(),viewerCount:viewers.length,publisherTrackTypes:publisher.tracks.map(track=>track.type),roomParticipants:participants.length};
}
async function startSource(config,credentials,origin){
  sourcePage=await browser.newPage();await sourcePage.goto(origin);await sourcePage.waitForFunction(()=>window.miloMediaProbe);
  return sourcePage.evaluate(params=>window.miloMediaProbe.publish(params),{url:config.livekitUrl,token:publisherToken(config,credentials),announcementsUrl:config.announcementsPath?origin+'/announcements':null,iceTransportPolicy:config.forceRelay===true?'relay':'all',sourceRoute:config.sourceRoute,whipUrl:config.whipUrl,whipIceServers:config.whipIceServers});
}
async function probe(config,credentials,origin,identity,{hls=false}={}){
  const context=await browser.newContext({viewport:{width:1280,height:720}});
  const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>window.miloMediaProbe);
  if(hls)await page.evaluate(params=>window.miloMediaProbe.connectHls(params),{url:config.hlsMediaPlaylistUrl});
  else await page.evaluate(params=>window.miloMediaProbe.connect(params),{url:config.livekitUrl,token:viewerToken({...credentials,room:config.room,identity,publisherIdentity:config.publisherIdentity,fixtureGameId:config.fixtureGameId,testOnly:config.testOnly}),publisherIdentity:config.publisherIdentity,iceTransportPolicy:config.forceRelay===true?'relay':'all'});
  // waitForFunction with a returned Promise is insufficient here: explicitly
  // await every sample and require actual decoded video and non-silent audio.
  let ready=false,lastSample;
  for(let attempt=0;attempt<60;attempt++){
    lastSample=await page.evaluate(()=>window.miloMediaProbe.sample());
    if(lastSample.frames>0&&lastSample.audioRmsMax>.0001){ready=true;break;}
    await delay(500);
  }
  if(!ready){const error=new Error('Browser ontvangt geen gedecodeerd beeld én niet-stille audio binnen 30 seconden.');error.diagnosticSample=lastSample;await context.close();throw error;}
  return {context,page,identity};
}
function spawnCli(config,credentials,stage,subscribers){
  const child=spawn(config.lkPath,['perf','load-test','--room',config.room,'--subscribers',String(subscribers),'--video-publishers','0','--audio-publishers','0','--duration',`${cliDurationSeconds(stage)}s`,'--num-per-second','5','--layout','speaker','--identity-prefix',`milo-load-${stage.name}`],{stdio:['ignore','pipe','pipe'],env:{...process.env,LIVEKIT_URL:config.livekitUrl,LIVEKIT_API_KEY:credentials.apiKey,LIVEKIT_API_SECRET:credentials.apiSecret,NO_COLOR:'1',TERM:'dumb'}});
  let raw='',readyAt=null;
  const add=chunk=>{raw+=chunk.toString();if(raw.length>20000000){raw=raw.slice(0,20000000);child.kill('SIGTERM');}if(raw.includes('Finished connecting to room, waiting')&&readyAt===null)readyAt=Date.now();};
  child.stdout.on('data',add);child.stderr.on('data',add);
  const done=new Promise((accept,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>accept({code,signal,raw,readyAt,finishedAt:Date.now()}));});
  return {child,done,get readyAt(){return readyAt;},stop(){child.kill('SIGINT');const force=setTimeout(()=>child.kill('SIGKILL'),10000);force.unref();}};
}
async function runStage(config,credentials,origin,stage,previous){
  requireDnsPin((await lookup(config.livekitHostname,{all:true})).map(value=>value.address),config.targetPublicIps);
  const result={...stage,status:'running',startedAt:new Date().toISOString(),executed:true,browserViewers:3,cliViewers:stage.webrtc-3,hlsHttpViewers:Math.max(0,stage.hls-1),hlsBrowserViewers:stage.hls?1:0};
  report.stages.push(result);await save();
  const probes=[],samples=[],hlsSamples=[],hlsPlaybackSamples=[],hostSamples=[],roomSamples=[],hlsAbort=new AbortController();let cli,hls=[],hlsProbe,fullOccupancyAtMs=null;
  try{
    for(let index=0;index<3;index++)probes.push(await probe(config,credentials,origin,`milo-load-${stage.name}-browser-${index}`));
    if(stage.hls){
      if(!config.hlsMediaPlaylistUrl)throw new Error('Een actuele beveiligde HLS-livevariant ontbreekt.');
      const playlist=new URL(config.hlsMediaPlaylistUrl);
      if(playlist.protocol!=='https:'||playlist.origin!==config.appOrigin||!config.hlsPathPrefix?.startsWith('/api/broadcast/hls/')||!playlist.pathname.startsWith(config.hlsPathPrefix)||!config.hlsRoomBindingReference)throw new Error('HLS-testdoel mist de gecontroleerde binding aan de eigen stagingtestroom.');
      // Small stagger avoids synchronized segment bursts unrelated to real viewing.
      hlsProbe=await probe(config,credentials,origin,`milo-load-${stage.name}-hls-browser`,{hls:true});
      for(let i=0;i<stage.hls-1;i++){hls.push(runHlsViewer({playlistUrl:playlist.href,signal:hlsAbort.signal,identity:`hls-${i}`,onSample:sample=>hlsSamples.push(sample)}));await delay(20);}
    }
    cli=spawnCli(config,credentials,stage,stage.webrtc-3);
    let finished=null;cli.done.then(value=>{finished=value;},error=>{finished={code:-1,raw:safeError(error),readyAt:null,finishedAt:Date.now()};});
    while(!finished){
      if(terminate)throw new Error('Proef bewust afgebroken.');
      const before=previous;
      previous=await observeSafety(config,previous,stage.name);
      if(finished)break;
      const elapsed=(previous.observedAtMs-before.observedAtMs)/1000,total=previous.cpuTotal-before.cpuTotal;
      hostSamples.push({...previous,cpuPercent:total>0?(1-(previous.cpuIdle-before.cpuIdle)/total)*100:null,egressMbps:elapsed>0?(previous.txBytes-before.txBytes)*8/elapsed/1e6:null});
      const roomSample=await observeRoom(config,credentials);roomSamples.push(roomSample);
      if(finished)break;
      await appendFile(resolve(output,`${stage.name}-room.jsonl`),JSON.stringify(roomSample)+'\n',{mode:0o600});
      if(cli.readyAt&&roomSample.viewerCount<Math.ceil(stage.webrtc*.99))throw new Error('Minder dan 99% van de testkijkers blijft verbonden.');
      if(cli.readyAt&&roomSample.viewerCount===stage.webrtc)fullOccupancyAtMs??=Date.now();
      else fullOccupancyAtMs=null;
      if(previous.cpuCount!==config.inventory.cpuCount)throw new Error('Hostinventaris is gewijzigd.');
      for(const item of probes){
        const sample=await item.page.evaluate(()=>window.miloMediaProbe.sample());
        sample.identity=item.identity;samples.push(sample);
        await appendFile(resolve(output,`${stage.name}-browser.jsonl`),JSON.stringify(sample)+'\n',{mode:0o600});
        if(sample.error||!sample.connected||Date.now()-sample.lastFrameAt>10000)throw new Error('Browserplayer verliest de werkelijke programmaweergave.');
      }
      if(hlsProbe){
        const sample=await hlsProbe.page.evaluate(()=>window.miloMediaProbe.sample());hlsPlaybackSamples.push(sample);
        await appendFile(resolve(output,`${stage.name}-hls-browser.jsonl`),JSON.stringify(sample)+'\n',{mode:0o600});
        if(sample.error||Date.now()-sample.lastFrameAt>15000)throw new Error('De echte HLS-browserweergave valt weg.');
      }
      if(!cli.readyAt&&Date.now()-Date.parse(result.startedAt)>120000)throw new Error('Niet alle testclients verbinden binnen twee minuten.');
      await delay(5000);
    }
    const log=finished.raw.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[token verwijderd]');
    for(const value of sensitive)if(log.includes(value))throw new Error('CLI-output bevat een geheim en is niet opgeslagen.');
    await writeFile(resolve(output,`${stage.name}-cli.log`),log,{mode:0o600});
    const parsed=parseCliTrackResults(log);
    result.cli=parsed;result.cliDurationSeconds=cliDurationSeconds(stage);result.connectedWaitSeconds=finished.readyAt?(finished.finishedAt-finished.readyAt)/1000:0;
    result.fullOccupancyObservedAtMs=fullOccupancyAtMs;
    result.holdSeconds=fullOccupancyHoldSeconds(fullOccupancyAtMs,finished.finishedAt);
    const goodBrowsers=probes.filter(item=>samples.some(sample=>sample.identity===item.identity&&sample.frames>0&&sample.audioRmsMax>.0001&&sample.tracks.some(track=>track.kind==='video'&&track.framesDecoded>0))).length;
    result.successfulWebrtcViewers=parsed.receivingAudioAndVideo+goodBrowsers;
    result.connectionSuccessRate=result.successfulWebrtcViewers/stage.webrtc;
    result.webrtcTimeToFirstFrameMs=summarize(probes.map(item=>samples.find(sample=>sample.identity===item.identity)?.timeToFirstVideoMs));
    result.webrtcLatencyMs=summarize(samples.flatMap(sample=>sample.timecodeSamples.map(value=>value.latencyMs)));
    result.latencyMethod='CRC-gecontroleerde UTC-tijdcode in werkelijk gedecodeerde videoframes, één sample/seconde/browser; geen netwerk-RTT als beeldvertraging.';
    result.browserReconnects=probes.reduce((sum,item)=>sum+Math.max(0,...samples.filter(s=>s.identity===item.identity).map(s=>s.reconnects)),0);
    result.browserFreezeCount=probes.reduce((sum,item)=>sum+Math.max(0,...samples.filter(s=>s.identity===item.identity).flatMap(s=>s.tracks.filter(t=>t.kind==='video').map(t=>t.freezeCount||0))),0);
    result.browserMediaBitrateBps=summarize(probes.map(item=>{
      const series=samples.filter(sample=>sample.identity===item.identity);if(series.length<2)return null;
      const first=series[0],last=series.at(-1),elapsed=(last.observedAtMs-first.observedAtMs)/1000;
      const bytes=sample=>sample.tracks.filter(track=>['audio','video'].includes(track.kind)).reduce((sum,track)=>sum+(track.bytesReceived||0),0);
      return elapsed>0?(bytes(last)-bytes(first))*8/elapsed:null;
    }));
    result.browserDecodedFps=summarize(probes.map(item=>{
      const series=samples.filter(sample=>sample.identity===item.identity);if(series.length<2)return null;
      const first=series[0],last=series.at(-1),elapsed=(last.observedAtMs-first.observedAtMs)/1000;
      const frames=sample=>sample.tracks.filter(track=>track.kind==='video').reduce((sum,track)=>sum+(track.framesDecoded||0),0);
      return elapsed>0?(frames(last)-frames(first))/elapsed:null;
    }));
    result.hostCpuPercent=summarize(hostSamples.map(sample=>sample.cpuPercent));
    result.hostEgressMbps=summarize(hostSamples.map(sample=>sample.egressMbps));
    result.hostAvailableMemoryMinBytes=Math.min(...hostSamples.map(sample=>sample.memAvailableBytes));
    result.roomViewerCount=summarize(roomSamples.map(sample=>sample.viewerCount));
    result.turnBurden=summarizeTurnBurden(hostSamples);
    result.sfuPrometheusSamples=hostSamples.filter(sample=>sample.livekitPrometheus?.measured).length;
    result.hlsLatencyMs=summarize(hlsPlaybackSamples.flatMap(sample=>sample.timecodeSamples.map(value=>value.latencyMs)));
    result.hlsTimeToFirstFrameMs=summarize(hlsPlaybackSamples.slice(0,1).map(sample=>sample.timeToFirstVideoMs));
    result.hlsPlaybackVerified=hlsPlaybackSamples.some(sample=>sample.frames>0&&sample.audioRmsMax>.0001);
    result.successfulHlsHttpViewers=new Set(hlsSamples.filter(sample=>sample.kind==='hls-http'&&sample.segments>0).map(sample=>sample.identity)).size;
    const hlsSuccess=!stage.hls||(result.successfulHlsHttpViewers===stage.hls-1&&result.hlsPlaybackVerified&&result.hlsLatencyMs.samples>=stage.seconds/2&&result.hlsLatencyMs.p95<=8000);
    const profileLoaded=result.browserMediaBitrateBps.p50>=MEDIA_PROFILE.totalBps*.8;
    result.profileBitrateAdequate=profileLoaded;
    result.profileFpsAdequate=result.browserDecodedFps.p50>=27;
    result.success=finished.code===0&&result.holdSeconds>=stage.seconds&&result.connectionSuccessRate>=.99&&result.webrtcLatencyMs.samples>=stage.seconds&&result.webrtcLatencyMs.p95<=1000&&hlsSuccess&&profileLoaded&&result.profileFpsAdequate&&result.turnBurden.measured&&result.sfuPrometheusSamples>=2;
    result.status=result.success?'passed':'target-missed';
    result.endedAt=new Date().toISOString();
    return {previous,success:result.success};
  }catch(error){result.status='stopped';result.reason=safeError(error);result.endedAt=new Date().toISOString();throw error;}
  finally{
    hlsAbort.abort();cli?.stop();
    if(cli)await cli.done.catch(()=>{});
    const settled=await Promise.allSettled(hls);result.hlsHttpResults=settled.map(value=>value.status==='fulfilled'?value.value:{error:safeError(value.reason)});
    if(hlsSamples.length)await writeFile(resolve(output,`${stage.name}-hls.json`),JSON.stringify(hlsSamples,null,2)+'\n',{mode:0o600});
    for(const item of probes)await item.context.close();await hlsProbe?.context.close();await save();
  }
}

try{
  const config=validateLoadConfiguration(await privateJson(resolve(args[1])),{requireCapacity:mode!=='--connectivity'});
  const fixtureBinding=config.room.startsWith('programme-')?validateFixtureManifest(await privateJson(config.fixtureManifestPath),config):null;
  const credentials=await privateJson(config.credentialsPath);sensitive.push(credentials.apiKey,credentials.apiSecret);
  if(!credentials.apiKey||!credentials.apiSecret)throw new Error('Eigen staging-LiveKit-credentials ontbreken.');
  const addresses=(await lookup(config.livekitHostname,{all:true})).map(value=>value.address);requireDnsPin(addresses,config.targetPublicIps);
  const localIps=Object.values(networkInterfaces()).flat().filter(Boolean).map(value=>value.address);
  if(config.targetPublicIps.some(ip=>localIps.includes(ip))||hostname()===config.inventory.host)throw new Error('De belastinggenerator draait op de doel-VPS.');
  if(cpus().length<2||freemem()<2147483648)throw new Error('De externe generator heeft onvoldoende CPU of vrij geheugen.');
  const version=await execute(config.lkPath,['--version']);
  if(!version.stdout.includes('2.20.1'))throw new Error('Gebruik de exact gecontroleerde lk-CLI 2.20.1.');
  let previous=await observeSafety(config,null);await delay(5000);previous=await observeSafety(config,previous);
  report.preflight={passed:true,capacityGateChecked:mode!=='--connectivity',forceRelay:config.forceRelay===true,appOrigin:config.appOrigin,livekitHostname:config.livekitHostname,targetPublicIps:addresses,host:config.inventory.host,room:config.room,fixtureBinding,inventoryReference:config.inventory.reference,generator:{host:hostname(),cpuCount:cpus().length,freeMemoryBytes:freemem(),network:config.generator.networkDescription,publicIp:config.generator.publicIp,availableIngressMbps:config.generator.availableIngressMbps,clockErrorBoundMs:config.generator.clockErrorBoundMs},sourceRoute:config.sourceRoute||'externally-published',cliVersion:version.stdout.trim()};
  await save();
  if(mode==='--preflight'){console.log('Read-only stagingpreflight geslaagd. Er is geen mediabelasting gestart.');}
  else{
    const origin=await localServer(config);
    if(mode==='--connectivity'){
      report.executed=true;report.connectivity={attempted:true,sourceRoute:config.sourceRoute==='browser-whip-test'?'browser-whip-test':'direct-sdk-diagnostic-source',capacityTest:false,receivingAudioAndVideo:false};await save();
      report.source=await startSource(config,credentials,origin);
      await delay(1500);report.connectivity.sourceSample=await sourcePage.evaluate(()=>window.miloMediaProbe.sourceSample());await save();
      const viewer=await probe(config,credentials,origin,'milo-load-connectivity-browser');
      await delay(5000);
      const sample=await viewer.page.evaluate(()=>window.miloMediaProbe.sample());
      report.connectivity.sample=sample;
      report.connectivity.receivingAudioAndVideo=sample.frames>0&&sample.audioRmsMax>.0001;
      await viewer.context.close();await sourcePage.evaluate(()=>window.miloMediaProbe.stopPublishing());
      report.complete=report.connectivity.receivingAudioAndVideo;
      if(!report.complete)throw new Error('Geen werkelijk gedecodeerd beeld en geluid in de externe browser.');
    }else if(mode==='--source'){
      report.source=await startSource(config,credentials,origin);
      report.executed=true;await save();
      console.log(`Technische testbron actief (${report.source.route}); Ctrl+C stopt uitsluitend deze testbron. Geen fysieke OBS-proef.`);
      let earlierSource=null;
      while(!terminate){
        previous=await observeSafety(config,previous,'test-source');
        const sample=await sourcePage.evaluate(()=>window.miloMediaProbe.sourceSample());
        if(earlierSource){
          const elapsed=(sample.observedAtMs-earlierSource.observedAtMs)/1000;
          const bytes=value=>[...value.video,...value.audio].reduce((sum,track)=>sum+(track.bytesSent||0),0);
          sample.mediaBitrateBps=elapsed>0?(bytes(sample)-bytes(earlierSource))*8/elapsed:null;
        }
        await appendFile(resolve(output,'source-observations.jsonl'),JSON.stringify(sample)+'\n',{mode:0o600});earlierSource=sample;
        await delay(5000);
      }
      await sourcePage.evaluate(()=>window.miloMediaProbe.stopPublishing());
    }else{
      report.executed=true;await save();
      for(const stage of STAGES){
        const outcome=await runStage(config,credentials,origin,stage,previous);previous=outcome.previous;
        console.log(`${stage.name}: ${report.stages.at(-1).status}`);
        if(!outcome.success)throw new Error('Opschaling gestopt: het vorige niveau haalt de gemeten doelen niet.');
        await delay(10000);previous=await observeSafety(config,previous);
      }
      report.complete=true;
      report.limitations.push('Fysieke Cast/AirPlay-metingen en echte besloten regie/beller-audio moeten afzonderlijk worden vastgelegd; HLS-HTTP-ontvangst en Chromium-decode bewijzen geen tv-weergave.');
    }
  }
}catch(error){report.error=safeError(error);if(error.diagnosticSample&&report.connectivity)report.connectivity.sample=error.diagnosticSample;report.complete=false;process.exitCode=1;console.error(report.error);}
finally{report.finishedAt=new Date().toISOString();await save();if(sourcePage)await sourcePage.evaluate(()=>window.miloMediaProbe.stopPublishing()).catch(()=>{});await browser?.close();await new Promise(accept=>server?server.close(accept):accept());}
