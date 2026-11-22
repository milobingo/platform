import {parseLivePlaylist} from './media-profile.mjs';
import {setTimeout as delay} from 'node:timers/promises';

export function hlsBrowserIsFresh(sample,now){
  return !!sample&&!sample.error&&sample.connected===true&&sample.frames>0&&Number.isFinite(sample.lastFrameAt)&&now-sample.lastFrameAt>=0&&now-sample.lastFrameAt<=5000&&Number.isFinite(sample.lastAudioAt)&&now-sample.lastAudioAt>=0&&now-sample.lastAudioAt<=20000;
}

export function createHlsContinuityTracker(identities){
  const clients=new Map(identities.map(identity=>[identity,{identity,firstSuccessAtMs:null,lastSuccessAtMs:null,continuousSinceMs:null,segmentSeconds:2,segments:0,continuousMediaSeconds:0,errors:0,stalls:0,lastSequence:null,failed:false}]));
  const freshnessMs=client=>Math.max(5000,client.segmentSeconds*2000+1000);
  function record(sample){
    const client=clients.get(sample.identity);
    if(!client)throw new Error('Onverwachte HLS-testidentiteit.');
    const at=sample.observedAtMs;
    if(sample.kind==='hls-http-error'){
      client.errors=Math.max(client.errors+1,sample.errors||0);client.failed=true;client.continuousSinceMs=null;client.continuousMediaSeconds=0;
      return {discontinuity:true,identity:client.identity,reason:'segment-request-failed'};
    }
    if(sample.kind!=='hls-http')return {discontinuity:false};
    const discontinuity=client.failed||(client.lastSuccessAtMs!==null&&at-client.lastSuccessAtMs>freshnessMs(client))||(sample.stalls||0)>client.stalls||(client.lastSequence!==null&&sample.sequence!==client.lastSequence+1);
    if(discontinuity||client.continuousSinceMs===null){client.continuousSinceMs=at;client.continuousMediaSeconds=0;}
    client.firstSuccessAtMs??=at;client.lastSuccessAtMs=at;client.segmentSeconds=sample.segmentSeconds;client.segments=sample.segments;
    client.lastSequence=sample.sequence;client.errors=Math.max(client.errors,sample.errors||0);client.stalls=Math.max(client.stalls,sample.stalls||0);client.failed=false;client.continuousMediaSeconds+=sample.segmentSeconds;
    return {discontinuity,identity:client.identity,reason:discontinuity?'segment-continuity-lost':null};
  }
  function snapshot(now){
    const viewers=[...clients.values()].map(client=>{
      const fresh=client.lastSuccessAtMs!==null&&now>=client.lastSuccessAtMs&&now-client.lastSuccessAtMs<=freshnessMs(client)&&!client.failed;
      return {...client,fresh,freshnessLimitMs:freshnessMs(client),continuousHoldSeconds:fresh&&client.continuousSinceMs!==null?(now-client.continuousSinceMs)/1000:0};
    });
    return {ready:viewers.length>0&&viewers.every(viewer=>viewer.fresh),freshViewers:viewers.filter(viewer=>viewer.fresh).length,expectedViewers:viewers.length,viewers};
  }
  return {record,snapshot};
}

const serverErrorCodes=new Set(['hls_access','hls_origin','hls_missing','hls_waiting','hls_ended','hls_storage','hls_playlist','hls_unavailable','broadcast_configuration','broadcast_storage','broadcast_access','broadcast_forbidden']);
async function serverErrorCode(response){
  const reader=response.body?.getReader();if(!reader)return null;
  const chunks=[];let bytes=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4096){await reader.cancel();return null;}chunks.push(Buffer.from(value));}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8')),code=body?.error?.code;
    return serverErrorCodes.has(code)?code:null;
  }catch{return null;}finally{reader.releaseLock();}
}
async function request(url,signal,limit) {
  const startedAt=Date.now();
  const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),redirect:'error',cache:'no-store'});
  if(!response.ok)throw Object.assign(new Error(`HLS HTTP ${response.status}`),{httpStatus:response.status,serverErrorCode:await serverErrorCode(response)});
  const contentLength=Number(response.headers.get('content-length'));
  if(contentLength>limit)throw new Error('HLS-respons overschrijdt de limiet.');
  const body=Buffer.from(await response.arrayBuffer());
  if(body.length>limit)throw new Error('HLS-respons overschrijdt de limiet.');
  return {body,elapsedMs:Date.now()-startedAt};
}
export async function runHlsViewer({playlistUrl,signal,onSample,identity}) {
  let lastSequence=-1,mapFetched=null,bytes=0,segments=0,errors=0,stalls=0;
  const startedAt=Date.now();let firstSegmentAt=null;
  try{
    while(!signal.aborted){
      const requestStarted=Date.now();
      let requestPhase='playlist';
      try{
        const manifest=await request(playlistUrl,signal,1000000);bytes+=manifest.body.length;
        const playlist=parseLivePlaylist(manifest.body.toString('utf8'),playlistUrl);
        if(playlist.ended)throw new Error('De HLS-feed is beëindigd tijdens de proef.');
        if(playlist.map&&mapFetched!==playlist.map){requestPhase='init';const init=await request(playlist.map,signal,5000000);bytes+=init.body.length;mapFetched=playlist.map;}
        // Start at the actual live edge. Never drain an archive or catch up in a burst.
        if(lastSequence<0&&playlist.segments.length)lastSequence=playlist.segments.at(-1).sequence-1;
        const next=playlist.segments.find(segment=>segment.sequence>lastSequence);
        if(next){
          if(next.sequence>lastSequence+1)stalls++;
          requestPhase='segment';const segment=await request(next.url,signal,10000000);bytes+=segment.body.length;segments++;lastSequence=next.sequence;firstSegmentAt??=Date.now();
          onSample({kind:'hls-http',identity,observedAtMs:Date.now(),bytes,segments,errors,stalls,sequence:next.sequence,timeToFirstSegmentMs:firstSegmentAt-startedAt,downloadMs:segment.elapsedMs,segmentSeconds:next.seconds,decoded:false,latencyMs:null});
          // One completed segment at its viewing tempo, including fetch time.
          await delay(Math.max(0,next.seconds*1000-(Date.now()-requestStarted)),undefined,{signal});
        }else await delay(Math.max(250,playlist.targetDuration*500),undefined,{signal});
      }catch(error){
        if(signal.aborted)break;
        errors++;onSample({kind:'hls-http-error',identity,observedAtMs:Date.now(),errors,requestPhase,httpStatus:Number.isInteger(error.httpStatus)?error.httpStatus:null,serverErrorCode:serverErrorCodes.has(error.serverErrorCode)?error.serverErrorCode:null,reason:String(error.message).replace(/https?:\/\/\S+/g,'[URL verwijderd]')});
        await delay(2000,undefined,{signal});
      }
    }
  }catch(error){if(!signal.aborted)throw error;}
  return {identity,bytes,segments,errors,stalls,timeToFirstSegmentMs:firstSegmentAt===null?null:firstSegmentAt-startedAt,decoded:false};
}
