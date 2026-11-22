import {createHmac} from 'node:crypto';
import {isIP} from 'node:net';
export {CLOCK_EPOCH,crc16,encodeFrameTime,decodeFrameTime} from './timecode.mjs';

export const STAGES = Object.freeze([
  {name:'webrtc-25',webrtc:25,hls:0,seconds:300},
  {name:'webrtc-50',webrtc:50,hls:0,seconds:300},
  {name:'webrtc-100',webrtc:100,hls:0,seconds:300},
  {name:'webrtc-150',webrtc:150,hls:0,seconds:300},
  {name:'webrtc-200',webrtc:200,hls:0,seconds:1200},
  {name:'mixed-150-50',webrtc:150,hls:50,seconds:600},
]);
export const MEDIA_PROFILE = Object.freeze({width:1280,height:720,fps:30,videoBps:1186000,audioBps:64000,totalBps:1250000,simulcast:false});
// lk 2.20.1 starts --duration after group.Wait(), not before its join ramp.
// Reserve a little extra for the first independent full-room observation.
export const cliDurationSeconds = stage => stage.seconds+15;
export function fullOccupancyHoldSeconds(fullObservedAtMs,finishedAtMs){
  return Number.isFinite(fullObservedAtMs)&&Number.isFinite(finishedAtMs)?Math.max(0,(finishedAtMs-fullObservedAtMs)/1000):0;
}
export function summarizeTurnBurden(observations){
  const values=observations.filter(value=>value?.turnNetwork?.measured===true);
  if(values.length<2)return {measured:false,samples:values.length,reason:'Twee volledige waarnemingen van de eigen TURN-kerneltellers ontbreken.'};
  const counters={},rates=[];let reset=false;
  for(let i=1;i<values.length;i++){
    const before=values[i-1],after=values[i],seconds=(after.observedAtMs-before.observedAtMs)/1000;
    let bytes=0;
    for(const name of ['udp_in','udp_out','tls_in','tls_out']){
      const earlier=before.turnNetwork.counters[name],later=after.turnNetwork.counters[name];
      if(later.bytes<earlier.bytes||later.packets<earlier.packets||(earlier.handle!==undefined&&later.handle!==earlier.handle)){reset=true;continue;}
      counters[name]??={bytes:0,packets:0};counters[name].bytes+=later.bytes-earlier.bytes;counters[name].packets+=later.packets-earlier.packets;bytes+=later.bytes-earlier.bytes;
    }
    if(seconds>0)rates.push(bytes*8/seconds/1e6);
  }
  return {measured:!reset,samples:values.length,counterResetDetected:reset,scope:'Alleen eigen eth0 TURN-listeners UDP3480/TCP5349; hostbreed, niet per room.',includesProtocolOverhead:true,counters:reset?null:counters,combinedIngressAndEgressMbps:reset?null:summarize(rates),reason:reset?'Tellers zijn gereset; geen geldige fasebelasting afgeleid.':null};
}
export const ROOM_PREFIX = 'milo-staging-load-';
const fixtureUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function testRoomAllowed(room,{fixtureGameId,testOnly=false}={}) {
  return /^milo-staging-load-[a-z0-9][a-z0-9-]{4,60}$/.test(room||'')||(testOnly===true&&fixtureUuid.test(fixtureGameId||'')&&room===`programme-${fixtureGameId}`);
}
export function validateFixtureManifest(manifest,config) {
  if(manifest?.format!==1||manifest.tag!=='milo-staging-media-v1'||manifest.origin!==config.appOrigin||manifest.status!=='active'||manifest.gameId!==config.fixtureGameId||manifest.room!==config.room||manifest.room!==`programme-${manifest.gameId}`||!fixtureUuid.test(manifest.gameId||'')||!fixtureUuid.test(manifest.ownerId||'')||!fixtureUuid.test(manifest.marker||'')||!/^[a-f0-9]{32}$/.test(manifest.generation||'')||manifest.generation!==config.fixtureGeneration)throw new Error('De private fixturemanifest komt niet overeen met de eigen actieve besloten testshow.');
  const age=Date.now()-manifest.createdAt;
  if(!Number.isFinite(age)||age< -60000||age>86400000||manifest.removedAt)throw new Error('De technische fixture is niet nieuw/actief; maak een nieuwe afgeschermde fixture.');
  return {gameId:manifest.gameId,room:manifest.room,generation:manifest.generation,marker:manifest.marker};
}

export function percentile(values,p) {
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length)return null;
  return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];
}
export function summarize(values) {
  const finite=values.filter(Number.isFinite);
  return {samples:finite.length,p50:percentile(finite,.5),p95:percentile(finite,.95),max:finite.length?Math.max(...finite):null};
}
export function validateLoadConfiguration(c,{requireCapacity=true}={}) {
  if(c?.format!=='milo-media-load-v1'||c.environment!=='staging')throw new Error('Alleen de expliciete Milo-stagingconfiguratie is toegestaan.');
  if(c.appOrigin!=='https://milo-staging.dgwebservices.nl')throw new Error('Productie en externe toepassingen zijn geen toegestane testdoelen.');
  const livekit=new URL(c.livekitUrl);
  if(livekit.protocol!=='wss:'||livekit.username||livekit.password||livekit.port||livekit.pathname!=='/'||livekit.search||livekit.hash||!c.livekitHostname||livekit.hostname!==c.livekitHostname||livekit.hostname.endsWith('.livekit.cloud'))throw new Error('Geef de exact gecontroleerde eigen WSS-host op.');
  if(!testRoomAllowed(c.room,c))throw new Error('Een afgeschermde testroom of exact vastgelegde technische fixture-show is verplicht.');
  if(c.room?.startsWith('programme-')&&(!c.fixtureAttestationReference||c.fixturePrivacy!=='no-real-families'))throw new Error('De programme-room vereist bewijs van een nieuw besloten testspel zonder echte gezinnen.');
  if(!Array.isArray(c.targetPublicIps)||!c.targetPublicIps.length||c.targetPublicIps.some(ip=>!isIP(ip)))throw new Error('Gecontroleerde publieke doel-IP-adressen ontbreken.');
  if(!isIP(c.generator?.publicIp)||c.targetPublicIps.includes(c.generator.publicIp)||c.generator.externalNetwork!==true||!c.generator.networkDescription)throw new Error('De generator moet op een aantoonbaar ander netwerk staan.');
  if((requireCapacity&&c.generator.availableIngressMbps<350)||c.generator.clockErrorBoundMs>20||c.generator.clockErrorBoundMs<0)throw new Error('Generator vereist minstens 350 Mbit/s aantoonbare ontvangstruimte en klokfoutgrens ≤ 20 ms.');
  if(!c.inventory?.host||!c.inventory?.checkedAt||!c.inventory?.reference||c.inventory.activeRealShow!==false)throw new Error('Verse hostinventaris en controle op een echte uitzending ontbreken.');
  const age=Date.now()-Date.parse(c.inventory.checkedAt);
  if(!Number.isFinite(age)||age< -60000||age>3600000)throw new Error('De hostinventaris mag maximaal één uur oud zijn.');
  if(!c.ssh?.config||!c.ssh?.alias||!/^[-a-zA-Z0-9_.]+$/.test(c.ssh.alias))throw new Error('Beperkte SSH-observatietoegang ontbreekt.');
  if(!Array.isArray(c.criticalHealthUrls)||!c.criticalHealthUrls.length||c.criticalHealthUrls.some(value=>{const u=new URL(value);return u.protocol!=='https:'||u.username||u.password||u.search||u.hash;}))throw new Error('Read-only gezondheidscontroles van medebewoners zijn verplicht.');
  if(requireCapacity&&(!Number.isFinite(c.targetNetworkMbps)||c.targetNetworkMbps<350))throw new Error('Bevestigde netwerkcapaciteit ontbreekt of is te laag.');
  if(!/^[a-zA-Z0-9_-]{6,100}$/.test(c.publisherIdentity||''))throw new Error('Geef een afzonderlijke test-programmapublisher op.');
  if(c.sourceRoute==='browser-whip-test'){
    const whip=new URL(c.whipUrl);
    if(whip.origin!==c.appOrigin||whip.protocol!=='https:'||!/^\/whip\/[A-Za-z0-9_-]+$/.test(whip.pathname)||whip.search||whip.hash||whip.username||whip.password)throw new Error('De volledige private WHIP-endpoint moet bij de eigen stagingdienst horen.');
  }
  return c;
}
export function requireDnsPin(addresses,allowed) {
  if(!addresses.length||addresses.some(ip=>!allowed.includes(ip)))throw new Error('DNS wijkt af van de gecontroleerde eigen VPS.');
  return true;
}
export function viewerToken({apiKey,apiSecret,room,identity,now=Date.now(),ttl=3600,publisherIdentity,fixtureGameId,testOnly}) {
  if(!testRoomAllowed(room,{fixtureGameId,testOnly})||!identity.startsWith('milo-load-'))throw new Error('Alleen testrooms en testidentiteiten zijn toegestaan.');
  if(!apiKey||!apiSecret)throw new Error('Testcredentials ontbreken.');
  const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body=Buffer.from(JSON.stringify({iss:apiKey,sub:identity,nbf:Math.floor(now/1000)-5,exp:Math.floor(now/1000)+ttl,video:{room,roomJoin:true,canSubscribe:true,canPublish:false,canPublishData:false,canUpdateOwnMetadata:false,canSubscribeMetrics:false,canSubscribeSources:undefined},metadata:JSON.stringify({testOnly:true,expectedPublisher:publisherIdentity})})).toString('base64url');
  return `${header}.${body}.${createHmac('sha256',apiSecret).update(`${header}.${body}`).digest('base64url')}`;
}
export function parseLivePlaylist(text,playlistUrl) {
  if(!text.startsWith('#EXTM3U')||text.length>1000000)throw new Error('Ongeldige of te grote HLS-playlist.');
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if(lines.some(line=>line.startsWith('#EXT-X-STREAM-INF')))throw new Error('Kies expliciet de actieve media-variant, niet de masterplaylist.');
  if(lines.some(line=>line.startsWith('#EXT-X-KEY')&&!line.includes('METHOD=NONE')))throw new Error('Deze testclient ondersteunt geen versleutelde HLS-variant.');
  let duration=null,sequence=0,targetDuration=2,programTime=null,map=null;
  const segments=[];
  for(const line of lines){
    if(line.startsWith('#EXT-X-MEDIA-SEQUENCE:'))sequence=Number(line.split(':')[1]);
    else if(line.startsWith('#EXT-X-TARGETDURATION:'))targetDuration=Number(line.split(':')[1]);
    else if(line.startsWith('#EXT-X-PROGRAM-DATE-TIME:'))programTime=Date.parse(line.slice(25));
    else if(line.startsWith('#EXT-X-MAP:')){const match=/URI="([^"]+)"/.exec(line);if(match)map=new URL(match[1],playlistUrl).href;}
    else if(line.startsWith('#EXTINF:'))duration=Number(line.slice(8).split(',')[0]);
    else if(!line.startsWith('#')){
      if(!Number.isFinite(duration)||duration<=0||duration>30)throw new Error('Segmentduur ontbreekt of is onveilig.');
      const url=new URL(line,playlistUrl);
      if(url.origin!==new URL(playlistUrl).origin)throw new Error('HLS-segment wijst buiten de eigen allowlist.');
      segments.push({url:url.href,sequence:sequence++,seconds:duration,programTime});
      if(Number.isFinite(programTime))programTime+=duration*1000;
      duration=null;
    }
  }
  if(!Number.isFinite(targetDuration)||targetDuration<.25||targetDuration>30||segments.length>1000)throw new Error('Onveilige HLS-playlist.');
  if(map&&new URL(map).origin!==new URL(playlistUrl).origin)throw new Error('HLS-initsegment wijst buiten de eigen allowlist.');
  return {segments,targetDuration,map,ended:lines.includes('#EXT-X-ENDLIST')};
}
export function pressureReasons(current,previous,networkMbps) {
  const reasons=[];
  if(!current||current.format!=='milo-media-host-observation-v1')return ['Hostobservatie ontbreekt.'];
  if(current.memAvailableBytes<Math.max(1073741824,current.memTotalBytes*.12))reasons.push('Te weinig vrij hostgeheugen.');
  if(current.diskAvailableBytes<5368709120)reasons.push('Minder dan 5 GiB vrije hostschijf.');
  if(current.pressureMemoryFullAvg10>1)reasons.push('Geheugendruk raakt andere diensten.');
  if(previous){
    const elapsed=(current.observedAtMs-previous.observedAtMs)/1000;
    const total=current.cpuTotal-previous.cpuTotal,idle=current.cpuIdle-previous.cpuIdle;
    if(total>0&&(1-idle/total)>.9)reasons.push('Host-CPU boven 90%.');
    if(Number.isFinite(networkMbps)&&networkMbps>0&&elapsed>0&&(current.txBytes-previous.txBytes)*8/elapsed/1e6>networkMbps*.8)reasons.push('Uitgaand verkeer boven 80% van bevestigde netwerkcapaciteit.');
    if(current.oomKills>previous.oomKills)reasons.push('Kernel heeft een proces wegens geheugentekort beëindigd.');
  }
  return reasons;
}
export function parseCliTrackResults(raw) {
  const clean=raw.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'');
  const subscribers=new Map();let current=null;
  for(const line of clean.split(/\r?\n/)){
    const normalized=line.replace(/[│┃┆╎]/g,' ').trim();
    const match=/^(?:(Sub\s+\d+)\s+)?(TR_[a-zA-Z0-9_-]+)\s+(audio|video)\s+([\d,]+)\s+([\d.]+)\s*([kmMG]?)bps\s+\d+\s+\(([\d.]+)%\)/.exec(normalized);
    if(!match)continue;
    if(match[1])current=match[1].replace(/\s+/g,' ');
    if(!current)throw new Error('CLI-tracktabel mist de subscriberidentiteit.');
    const entry=subscribers.get(current)||{subscriber:current,tracks:[]};
    entry.tracks.push({trackId:match[2],kind:match[3],packets:Number(match[4].replaceAll(',','')),bitrateBps:Number(match[5])*({k:1000,m:1000000,M:1000000,G:1000000000}[match[6]]||1),packetLossPercent:Number(match[7])});
    subscribers.set(current,entry);
  }
  const entries=[...subscribers.values()];
  return {subscribers:entries,receivingAudioAndVideo:entries.filter(entry=>['audio','video'].every(kind=>entry.tracks.some(track=>track.kind===kind&&track.packets>0&&track.bitrateBps>0))).length};
}
