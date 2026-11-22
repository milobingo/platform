import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {STAGES,MEDIA_PROFILE,cliDurationSeconds,fullOccupancyHoldSeconds,hasRecentDecodedAudio,videoResolutionEvidence,summarizeTurnBurden,validateLoadConfiguration,validateFixtureManifest,validateMixedRetryReport,requireDnsPin,viewerToken,encodeFrameTime,decodeFrameTime,percentile,parseLivePlaylist,pressureReasons,parseCliTrackResults} from '../scripts/load/media-profile.mjs';
import {runHlsViewer,createHlsContinuityTracker,hlsBrowserIsFresh} from '../scripts/load/hls-client.mjs';
import {sourceCueNumber} from '../scripts/load/source-cue.mjs';
import {waveByteRange} from '../scripts/load/source-wave.mjs';
import {sameOriginProbeDocument} from '../scripts/load/probe-origin.mjs';
import {createHlsEventLog,hlsPlaybackSnapshot} from '../scripts/load/hls-diagnostics.mjs';

let checks=0;
function check(name,fn){fn();checks++;console.log(`✓ ${name}`);}
const config={format:'milo-media-load-v1',environment:'staging',appOrigin:'https://milo-staging.dgwebservices.nl',livekitUrl:'wss://livekit-milo-staging.dgwebservices.nl',livekitHostname:'livekit-milo-staging.dgwebservices.nl',targetPublicIps:['128.140.93.95'],targetNetworkMbps:1000,room:'milo-staging-load-test-20261122',publisherIdentity:'milo-load-program',generator:{publicIp:'65.108.158.112',externalNetwork:true,networkDescription:'Gecontroleerde afzonderlijke test-VPS',availableIngressMbps:500,clockErrorBoundMs:10},inventory:{host:'dg-nxttrack-01',checkedAt:new Date().toISOString(),reference:'verified-host.json',activeRealShow:false},ssh:{config:'/private/ssh.conf',alias:'staging-admin'},criticalHealthUrls:['https://milo.dgwebservices.nl/api/health']};
check('Vaste gebruikersaantallen en minimale werkelijke meetduur',()=>{
  assert.deepEqual(STAGES.map(s=>[s.webrtc,s.hls,s.seconds]),[[25,0,300],[50,0,300],[100,0,300],[150,0,300],[200,0,1200],[150,50,600]]);
  assert.equal(MEDIA_PROFILE.videoBps+MEDIA_PROFILE.audioBps,1250000);assert.equal(MEDIA_PROFILE.simulcast,false);
});
check('Meetduur telt uitsluitend vanaf onafhankelijk vastgestelde volledige bezetting',()=>{
  assert.equal(cliDurationSeconds({seconds:300}),315);
  assert.equal(fullOccupancyHoldSeconds(null,400000),0);
  assert.equal(fullOccupancyHoldSeconds(105000,400000),295);
  assert.equal(fullOccupancyHoldSeconds(105000,420000),315);
  assert.ok(fullOccupancyHoldSeconds(105000,400000)<300);
  assert.ok(fullOccupancyHoldSeconds(105000,420000)>=300);
});
check('Een gemengde herhaling vereist alle zes beëindigde fasen,200PASS en dezelfde besloten fixture; duur en profiel blijven gelijk',()=>{
  const id='8f78e14c-b9f2-4fd5-a7f0-b2d55f3d8411',marker='7c69e206-ae30-49d8-899f-83562fa11708',c={...config,fixtureGameId:id,room:'programme-'+id,testOnly:true,fixturePrivacy:'no-real-families'};
  const prior={format:'milo-media-load-result-v1',executed:true,complete:false,finishedAt:new Date().toISOString(),profile:MEDIA_PROFILE,preflight:{passed:true,appOrigin:c.appOrigin,livekitHostname:c.livekitHostname,host:c.inventory.host,room:c.room,targetPublicIps:c.targetPublicIps,fixtureBinding:{gameId:id,room:c.room,marker}},stages:STAGES.map((stage,index)=>({...stage,executed:true,endedAt:new Date().toISOString(),holdSeconds:stage.seconds+5,status:index===5?'target-missed':'passed',success:index<5,hlsLatencyMs:index===5?{p95:8250}:null}))};
  const result=validateMixedRetryReport(prior,c);assert.deepEqual([result.stage.webrtc,result.stage.hls,result.stage.seconds],[150,50,600]);assert.equal(result.previousComplete,false);assert.equal(result.previousMixedStatus,'target-missed');assert.equal(result.fixtureMarker,marker);
  const change=fn=>{const copy=structuredClone(prior);fn(copy);assert.throws(()=>validateMixedRetryReport(copy,c));};
  change(value=>value.stages.pop());change(value=>delete value.finishedAt);change(value=>value.stages[4].status='target-missed');change(value=>value.stages[4].holdSeconds=1199);change(value=>value.stages[5].status='running');change(value=>value.stages[5].holdSeconds=599);change(value=>value.stages[5].seconds=30);change(value=>value.preflight.fixtureBinding.gameId='other');change(value=>value.preflight.room='programme-other');change(value=>value.preflight.appOrigin='https://milo.dgwebservices.nl');change(value=>value.preflight.targetPublicIps=['167.235.202.206']);change(value=>value.profile.width=480);
  assert.throws(()=>validateMixedRetryReport(prior,{...c,testOnly:false}));assert.throws(()=>validateMixedRetryReport(prior,{...c,fixturePrivacy:'real-families'}));
});
check('De echte retry-opdracht weigert een bestaande resultaatmap vóór configuratie of netwerk en laat eerder bewijs intact',()=>{
  const root=mkdtempSync(join(tmpdir(),'milo-retry-guard-'));
  try{
    const before=join(root,'before'),occupied=join(root,'occupied');mkdirSync(before);mkdirSync(occupied);const report=join(before,'report.json'),sentinel=join(occupied,'sentinel');writeFileSync(report,'original failed measurement\n');writeFileSync(sentinel,'preserve\n');
    for(const output of [before,occupied]){
      const result=spawnSync(process.execPath,['scripts/load/run-staging-media.mjs','--retry-mixed',join(root,'configuration-must-not-be-read.json'),output,report],{encoding:'utf8',timeout:5000});
      assert.notEqual(result.status,0);assert.match(result.stderr,/nieuwe resultaatmap|mag nog niet bestaan/);assert.equal(readFileSync(report,'utf8'),'original failed measurement\n');assert.equal(readFileSync(sentinel,'utf8'),'preserve\n');
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});
check('HLS-diagnostiek bewaart begrensde niet-fatale gebeurtenissen zonder stream-URLs of credentials',()=>{
  const log=createHlsEventLog(2);
  log.record({type:'mediaError',details:'bufferStalledError',fatal:false,response:{url:'https://private/token'}},1000);
  log.record({type:'networkError',details:'fragLoadError',fatal:false,url:'https://private/token',message:'secret'},2000);
  log.record({type:'mediaError',details:'bufferNudgeOnStall',fatal:false},3000);
  const result=log.snapshot();assert.equal(result.total,3);assert.equal(result.retained,2);assert.deepEqual(result.events[0],{observedAtMs:2000,type:'networkError',details:'fragLoadError',fatal:false});assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!JSON.stringify(result).includes('secret'));
  result.events[0].fatal=true;assert.equal(log.snapshot().events[0].fatal,false);assert.throws(()=>createHlsEventLog(1000));
});
check('HLS-playheaddiagnostiek toont echte bufferafstand en targetlatency zonder het afspeelbeleid te wijzigen',()=>{
  const ranges=values=>({length:values.length,start:index=>values[index][0],end:index=>values[index][1]});
  const video={currentTime:12,paused:false,readyState:4,networkState:2,playbackRate:1,videoWidth:1280,videoHeight:720,buffered:ranges([[5,10],[11,20]]),seekable:ranges([[5,25]])};
  const hls={latency:4,targetLatency:2,maxLatency:8,liveSyncPosition:23,config:{lowLatencyMode:false,maxLiveSyncPlaybackRate:1,liveSyncOnStallIncrease:1}};
  const result=hlsPlaybackSnapshot(video,hls);assert.equal(result.currentTime,12);assert.equal(result.forwardBufferSeconds,8);assert.equal(result.latencySeconds,4);assert.equal(result.targetLatencySeconds,2);assert.equal(result.playbackRate,1);assert.equal(result.lowLatencyMode,false);assert.equal(hls.config.maxLiveSyncPlaybackRate,1);assert.deepEqual(result.seekable,[{start:5,end:25}]);
  assert.equal(hlsPlaybackSnapshot({...video,currentTime:21},hls).forwardBufferSeconds,0);assert.equal(hlsPlaybackSnapshot(video,null).latencySeconds,null);
});
check('Alle drie echte browserdecoders moeten gedurende de meetfase720p houden; mediane bitrate/fps maskeert geen480p-kijker',()=>{
  const identities=['a','b','c'],sample=(identity,at,width=1280,height=720)=>({identity,observedAtMs:at,tracks:[{kind:'video',frameWidth:width,frameHeight:height,framesDecoded:100}]});
  const samples=identities.flatMap(identity=>[sample(identity,1000),sample(identity,2000)]);
  assert.equal(videoResolutionEvidence(samples,identities,1000,2000).adequate,true);
  for(const dimensions of [[480,270],[undefined,undefined],[1280,undefined]]){
    const changed=samples.map((item,index)=>index===3?{...item,tracks:[{...item.tracks[0],frameWidth:dimensions[0],frameHeight:dimensions[1]}]}:item);
    assert.equal(videoResolutionEvidence(changed,identities,1000,2000).adequate,false);
  }
  assert.equal(videoResolutionEvidence(samples.filter(item=>item.identity!=='c'),identities,1000,2000).adequate,false);
  assert.equal(videoResolutionEvidence(samples,identities,null,2000).adequate,false);
  assert.equal(videoResolutionEvidence([...samples,sample('a',0,480,270)],identities,1000,2000).adequate,true);
});
check('WebRTC-audio moet recent werkelijk hoorbaar zijn; oudePCMenergie of stilleOpuspakketten volstaan niet',()=>{
  assert.equal(hasRecentDecodedAudio({lastAudioAt:1000},21000),true);
  assert.equal(hasRecentDecodedAudio({lastAudioAt:1000,audioRmsMax:.2},21001),false);
  for(const lastAudioAt of [null,undefined,NaN,22000])assert.equal(hasRecentDecodedAudio({lastAudioAt},21000),false);
});
check('De lokale HLS-bundel krijgt de echte stagingorigin voor ongewijzigde capability/CORS-requests',()=>{
  const document=sameOriginProbeDocument('https://milo-staging.dgwebservices.nl','12345678-1234-4567-8912-123456789abc');
  assert.equal(new URL(document.documentUrl).origin,'https://milo-staging.dgwebservices.nl');
  assert.equal(new URL(document.scriptUrl).origin,new URL(document.documentUrl).origin);assert.ok(document.html.includes(document.scriptUrl));
  for(const origin of ['http://127.0.0.1:1234','https://milo.dgwebservices.nl','https://foreign.example'])assert.throws(()=>sameOriginProbeDocument(origin,'12345678-1234-4567-8912-123456789abc'));
  assert.throws(()=>sameOriginProbeDocument('https://milo-staging.dgwebservices.nl','unsafe\"html'));
});
check('TURN-belasting komt uit echte tellerdelta’s; ontbrekende of geresette tellers zijn geen nulmeting',()=>{
  const observation=(at,bytes)=>({observedAtMs:at,turnNetwork:{measured:true,counters:Object.fromEntries(['udp_in','udp_out','tls_in','tls_out'].map(name=>[name,{packets:bytes/100,bytes}]))}});
  assert.equal(summarizeTurnBurden([]).measured,false);
  assert.equal(summarizeTurnBurden([observation(1000,1000)]).measured,false);
  const result=summarizeTurnBurden([observation(1000,1000),observation(2000,2000)]);
  assert.equal(result.measured,true);assert.equal(result.counters.udp_in.bytes,1000);assert.equal(result.combinedIngressAndEgressMbps.p50,.032);
  const reset=summarizeTurnBurden([observation(1000,1000),observation(2000,0)]);
  assert.equal(reset.measured,false);assert.equal(reset.counterResetDetected,true);assert.equal(reset.counters,null);
  const earlier=observation(1000,1000),later=observation(2000,2000);earlier.turnNetwork.counters.udp_in.handle=1;later.turnNetwork.counters.udp_in.handle=2;
  assert.equal(summarizeTurnBurden([earlier,later]).counterResetDetected,true);
});
check('Testconfiguratie weigert productie, cloud, een echte show en dezelfde generator',()=>{
  assert.equal(validateLoadConfiguration(config),config);
  for(const patch of [{environment:'production'},{appOrigin:'https://milo.dgwebservices.nl'},{livekitUrl:'wss://foreign.livekit.cloud',livekitHostname:'foreign.livekit.cloud'},{room:'production-show'},{generator:{...config.generator,publicIp:'128.140.93.95'}},{inventory:{...config.inventory,activeRealShow:true}},{inventory:{...config.inventory,checkedAt:'2020-01-01T00:00:00Z'}},{generator:{...config.generator,availableIngressMbps:200}},{generator:{...config.generator,clockErrorBoundMs:100}}])assert.throws(()=>validateLoadConfiguration({...config,...patch}));
});
check('Een programme-room is uitsluitend met de exacte nieuwe besloten fixture toegestaan',()=>{
  const fixtureGameId='8f78e14c-b9f2-4fd5-a7f0-b2d55f3d8411';
  const fixture={...config,room:`programme-${fixtureGameId}`,fixtureGameId,testOnly:true,fixturePrivacy:'no-real-families',fixtureAttestationReference:'verified-private-fixture.json'};
  assert.equal(validateLoadConfiguration(fixture),fixture);
  for(const patch of [{testOnly:false},{fixtureGameId:'8f78e14c-b9f2-4fd5-a7f0-b2d55f3d8412'},{fixtureAttestationReference:null},{fixturePrivacy:'real-show'}])assert.throws(()=>validateLoadConfiguration({...fixture,...patch}));
  const token=viewerToken({apiKey:'testkey',apiSecret:'fixture-secret-only',room:fixture.room,identity:'milo-load-viewer',fixtureGameId,testOnly:true});
  assert.equal(JSON.parse(Buffer.from(token.split('.')[1],'base64url')).video.room,fixture.room);
  assert.throws(()=>viewerToken({apiKey:'testkey',apiSecret:'fixture-secret-only',room:fixture.room,identity:'milo-load-viewer',fixtureGameId,testOnly:false}));
});
check('Private fixturemanifest bindt actieve technische show, room en huidige generatie',()=>{
  const id='8f78e14c-b9f2-4fd5-a7f0-b2d55f3d8411',generation='0123456789abcdef0123456789abcdef';
  const c={...config,fixtureGameId:id,fixtureGeneration:generation,room:`programme-${id}`};
  const manifest={format:1,tag:'milo-staging-media-v1',origin:c.appOrigin,gameId:id,ownerId:'3b5860ca-4128-4e39-a55f-e4233aff2110',marker:'7c69e206-ae30-49d8-899f-83562fa11708',createdAt:Date.now(),room:c.room,generation,status:'active'};
  assert.equal(validateFixtureManifest(manifest,c).gameId,id);
  for(const patch of [{tag:'other-project'},{status:'pending'},{status:'removed'},{generation:'f'.repeat(32)},{origin:'https://milo.dgwebservices.nl'},{createdAt:Date.now()-90000000},{removedAt:Date.now()}])assert.throws(()=>validateFixtureManifest({...manifest,...patch},c));
});
check('DNS moet exact op de gecontroleerde eigen IP-adressen uitkomen',()=>{
  assert.equal(requireDnsPin(['128.140.93.95'],config.targetPublicIps),true);
  assert.throws(()=>requireDnsPin(['167.235.202.206'],config.targetPublicIps));assert.throws(()=>requireDnsPin([],config.targetPublicIps));
});
check('Browser-WHIP accepteert alleen de volledige private endpoint van de eigen stagingdienst',()=>{
  const valid={...config,sourceRoute:'browser-whip-test',whipUrl:config.appOrigin+'/whip/private-fixture-key'};
  assert.equal(validateLoadConfiguration(valid),valid);
  for(const whipUrl of [config.appOrigin+'/whip','https://foreign.example/whip/private-key',config.appOrigin+'/whip/private-key?token=unsafe'])assert.throws(()=>validateLoadConfiguration({...valid,whipUrl}));
});
check('Kijkertoken is roomgebonden en weigert media- en datapublicatie',()=>{
  const token=viewerToken({apiKey:'testkey',apiSecret:'fixture-secret-only',room:config.room,identity:'milo-load-viewer',now:1800000000000,ttl:120});
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
  assert.equal(claims.video.room,config.room);assert.equal(claims.video.canPublish,false);assert.equal(claims.video.canPublishData,false);assert.equal(claims.video.canUpdateOwnMetadata,false);assert.equal(claims.exp,1800000120);
  assert.throws(()=>viewerToken({apiKey:'x',apiSecret:'x',room:'actual-show',identity:'milo-load-viewer'}));
});
check('Frame-tijdcode bewaart milliseconden en verwerpt corruptie met CRC',()=>{
  for(const ms of [Date.UTC(2020,0,1),Date.UTC(2026,10,22,12,34,56,789),Date.now()]){
    const bits=encodeFrameTime(ms);assert.equal(bits.length,64);assert.equal(decodeFrameTime(bits),ms);
    for(let index=0;index<64;index++){const broken=bits.slice();broken[index]^=1;assert.equal(decodeFrameTime(broken),null);}
  }
  assert.equal(decodeFrameTime([1]),null);
});
check('Het uitgelichte bronnummer volgt uitsluitend dezelfde 15-seconden WAV-cue als de Nederlandse spraak',()=>{
  for(let number=1;number<=75;number++){
    assert.equal(sourceCueNumber((number-1)*15),number);
    assert.equal(sourceCueNumber(number*15-.001),number);
  }
  assert.equal(sourceCueNumber(1125),1);assert.equal(sourceCueNumber(1140),2);
  for(const value of [null,undefined,NaN,Infinity,-.001])assert.throws(()=>sourceCueNumber(value));
});
check('De lokale WAV ondersteunt echte bytebereiken voor herhalen en zoeken naar een latere cijfercue',()=>{
  const size=49612544;
  assert.deepEqual(waveByteRange(undefined,size),{status:200,start:0,end:size-1});
  assert.deepEqual(waveByteRange('bytes=0-',size),{status:206,start:0,end:size-1});
  assert.deepEqual(waveByteRange('bytes=44-999',size),{status:206,start:44,end:999});
  assert.deepEqual(waveByteRange('bytes=-100',size),{status:206,start:size-100,end:size-1});
  assert.deepEqual(waveByteRange('bytes=48688544-',size),{status:206,start:48688544,end:size-1});
  for(const header of ['bytes=49612544-','bytes=500-100','bytes=-0','bytes=-','bytes=0-1,4-5'])assert.equal(waveByteRange(header,size).status,416);
});
check('Percentielen worden uitsluitend uit daadwerkelijk aanwezige metingen afgeleid',()=>{
  assert.equal(percentile([], .95),null);assert.equal(percentile([10,20,30,40,50],.5),30);assert.equal(percentile([10,20,30,40,50],.95),50);
});
check('HLS-parser volgt relatieve eigen segmenten met echte duur en weigert vreemde routes',()=>{
  const prefix='#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:42\n#EXT-X-PROGRAM-DATE-TIME:2026-11-22T12:00:00.000Z\n';
  const parsed=parseLivePlaylist(prefix+'#EXTINF:2,\n42.ts\n#EXTINF:2,\n43.ts\n','https://milo-staging.dgwebservices.nl/hls/live.m3u8');
  assert.equal(parsed.segments[0].sequence,42);assert.equal(parsed.segments[1].programTime,Date.UTC(2026,10,22,12,0,2));assert.equal(parsed.segments[0].url,'https://milo-staging.dgwebservices.nl/hls/42.ts');
  assert.throws(()=>parseLivePlaylist(prefix+'#EXTINF:2,\nhttps://foreign.example/42.ts\n',config.appOrigin));
  assert.throws(()=>parseLivePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nvariant.m3u8',config.appOrigin));
});
check('Hostbeveiliging stopt bij CPU, geheugen, schijf, netwerk en kernel-OOM',()=>{
  const before={format:'milo-media-host-observation-v1',observedAtMs:10000,cpuTotal:100,cpuIdle:50,memAvailableBytes:4e9,memTotalBytes:8e9,diskAvailableBytes:20e9,txBytes:0,oomKills:0,pressureMemoryFullAvg10:0};
  const after={...before,observedAtMs:20000,cpuTotal:200,cpuIdle:100,txBytes:1000000};
  assert.deepEqual(pressureReasons(after,before,1000),[]);
  for(const patch of [{cpuIdle:51},{memAvailableBytes:100},{diskAvailableBytes:100},{txBytes:2e9},{oomKills:1},{pressureMemoryFullAvg10:2}])assert.ok(pressureReasons({...after,...patch},before,1000).length);
});
check('CLI-bewijs vereist audio én video met echte RTP-pakketten, ook met externe publisher',()=>{
  const raw='Track loading:\n┌─────────┬───────────┬───────┬───────┬──────────┬───────────┐\n│ Sub 0   │ TR_audio1 │ audio │ 12345 │ 64.0kbps │ 0 (0%)    │\n│         │ TR_video1 │ video │ 54321 │ 1.2mbps  │ 2 (0.01%) │\n│ Sub 1   │ TR_audio2 │ audio │ 23456 │ 63.9kbps │ 0 (0%)    │\nSubscriber summaries:\n│ Sub 0 │ 2/0 │ 1.3mbps │ 0 (0%) │ - │';
  const parsed=parseCliTrackResults(raw);assert.equal(parsed.receivingAudioAndVideo,1);assert.equal(parsed.subscribers.length,2);assert.equal(parsed.subscribers[0].tracks[1].bitrateBps,1200000);
  assert.equal(parseCliTrackResults('connected successfully').receivingAudioAndVideo,0);
});
check('49 éénmalige HLS-downloads gevolgd door uitval bewijzen geen gemengde meetduur',()=>{
  const ids=Array.from({length:49},(_,index)=>`hls-${index}`),tracker=createHlsContinuityTracker(ids);
  for(const identity of ids)tracker.record({kind:'hls-http',identity,observedAtMs:1000,sequence:0,segmentSeconds:2,segments:1,errors:0,stalls:0});
  assert.equal(tracker.snapshot(1000).ready,true);
  for(const identity of ids)tracker.record({kind:'hls-http-error',identity,observedAtMs:3000,errors:1});
  const final=tracker.snapshot(601000);
  assert.equal(final.ready,false);assert.equal(final.freshViewers,0);assert.ok(final.viewers.every(viewer=>viewer.continuousHoldSeconds===0&&viewer.errors===1));
  const silentLoss=createHlsContinuityTracker(ids);
  for(const identity of ids)silentLoss.record({kind:'hls-http',identity,observedAtMs:1000,sequence:0,segmentSeconds:2,segments:1,errors:0,stalls:0});
  assert.equal(silentLoss.snapshot(601000).ready,false);
});
check('Alle 49 HLS-kijkers moeten op kijktempo verse segmenten blijven halen en elk 600 seconden volhouden',()=>{
  const ids=Array.from({length:49},(_,index)=>`hls-${index}`),tracker=createHlsContinuityTracker(ids);
  for(let sequence=0;sequence<=300;sequence++)for(const identity of ids)tracker.record({kind:'hls-http',identity,observedAtMs:1000+sequence*2000,sequence,segmentSeconds:2,segments:sequence+1,errors:0,stalls:0});
  const final=tracker.snapshot(601000);
  assert.equal(final.ready,true);assert.equal(final.freshViewers,49);assert.ok(final.viewers.every(viewer=>viewer.continuousHoldSeconds===600&&viewer.continuousMediaSeconds===602&&viewer.errors===0&&viewer.stalls===0));
  const change=tracker.record({kind:'hls-http-error',identity:'hls-7',observedAtMs:601001,errors:1});
  assert.equal(change.discontinuity,true);assert.equal(tracker.snapshot(601001).ready,false);
  tracker.record({kind:'hls-http',identity:'hls-7',observedAtMs:603000,sequence:302,segmentSeconds:2,segments:302,errors:1,stalls:1});
  const recovered=tracker.snapshot(603000).viewers.find(viewer=>viewer.identity==='hls-7');
  assert.equal(recovered.continuousHoldSeconds,0);assert.equal(recovered.continuousMediaSeconds,2);assert.equal(recovered.errors,1);assert.equal(recovered.stalls,1);
});
check('Een HLS-browser moet recent beeld én recent geluid houden; historische audioactivatie volstaat niet',()=>{
  const sample={connected:true,error:null,frames:300,lastFrameAt:600000,lastAudioAt:590000};
  assert.equal(hlsBrowserIsFresh(sample,601000),true);
  assert.equal(hlsBrowserIsFresh({...sample,lastFrameAt:580000},601000),false);
  assert.equal(hlsBrowserIsFresh({...sample,lastAudioAt:500000,audioRmsMax:.06},601000),false);
  assert.equal(hlsBrowserIsFresh({...sample,lastAudioAt:null},601000),false);
});

const requests=[];let sequence=0;
const server=createServer((req,res)=>{
  requests.push({path:req.url,at:Date.now()});
  if(req.url==='/live.m3u8'){res.setHeader('Content-Type','application/vnd.apple.mpegurl');res.end(`#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:${sequence}\n#EXTINF:0.25,\n${sequence++}.ts\n`);}
  else{res.setHeader('Content-Type','video/mp2t');res.end(Buffer.alloc(188*3,0x47));}
});
await new Promise(accept=>server.listen(0,'127.0.0.1',accept));
const abort=new AbortController();
const result=await runHlsViewer({playlistUrl:`http://127.0.0.1:${server.address().port}/live.m3u8`,signal:abort.signal,identity:'fictional-hls-only',onSample:sample=>{if(sample.segments>=3)abort.abort();}});
await delay(10);await new Promise(accept=>server.close(accept));
check('Echte HTTP-HLS-test haalt segmenten op kijktempo op en beweert geen decode',()=>{
  const segments=requests.filter(request=>request.path.endsWith('.ts'));assert.equal(result.segments,3);assert.ok(segments[1].at-segments[0].at>=200);assert.ok(segments[2].at-segments[1].at>=200);assert.equal(result.decoded,false);assert.equal(result.errors,0);
});
const errorServer=createServer((request,response)=>{
  const phase=request.url.split('/')[1],playlist=request.url.includes('live.m3u8');
  if((phase==='playlist'||phase==='oversized')&&playlist||phase==='init'&&request.url.includes('init.mp4')||phase==='segment'&&request.url.includes('.ts')){
    response.writeHead(503,{'Content-Type':'application/json'});
    response.end(JSON.stringify({error:{code:phase==='playlist'?'hls_playlist':phase==='segment'?'https://SECRET.invalid/code':'hls_storage',message:'FAKE_SECRET_MUST_NOT_LEAK '+request.url+' '+(phase==='oversized'?'x'.repeat(10000):'')}}));
  }else{
    response.setHeader('Content-Type','application/vnd.apple.mpegurl');response.end('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n'+(phase==='init'?'#EXT-X-MAP:URI="init.mp4?token=SECRET_QUERY"\n':'')+'#EXTINF:1,\n0.ts?token=SECRET_QUERY\n');
  }
});
await new Promise(accept=>errorServer.listen(0,'127.0.0.1',accept));
const errorCases=[];
try{
  for(const phase of ['playlist','init','segment','oversized']){
    const controller=new AbortController(),samples=[];
    const result=await runHlsViewer({playlistUrl:`http://127.0.0.1:${errorServer.address().port}/${phase}/SECRET_PATH/live.m3u8?token=SECRET_QUERY`,signal:controller.signal,identity:'fictional-error-'+phase,onSample:sample=>{samples.push(sample);if(sample.kind==='hls-http-error')controller.abort();}});
    errorCases.push({phase,result,samples});
  }
}finally{await new Promise(accept=>errorServer.close(accept));}
check('Echte lokale HTTP503 onderscheidt playlist/init/segment en whitelistcodes zonder geheime URL, token of bodytekst te bewaren',()=>{
  for(const {phase,result,samples} of errorCases){
    assert.equal(result.errors,1);assert.equal(result.decoded,false);assert.equal(samples.length,1);
    const sample=samples[0];assert.equal(sample.kind,'hls-http-error');assert.equal(sample.httpStatus,503);assert.equal(sample.requestPhase,phase==='oversized'?'playlist':phase);assert.equal(sample.serverErrorCode,phase==='playlist'?'hls_playlist':phase==='init'?'hls_storage':null);
    assert.equal(sample.reason,'HLS HTTP 503');assert.ok(!JSON.stringify(sample).includes('SECRET'));assert.ok(!JSON.stringify(sample).includes('token='));assert.ok(!JSON.stringify(sample).includes('http:'));assert.ok(!JSON.stringify(sample).includes('https:'));
  }
});
console.log(`${checks} betekenisvolle loadharnascontroles geslaagd; geen belastingtest op een externe dienst uitgevoerd.`);
