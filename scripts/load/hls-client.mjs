import {parseLivePlaylist} from './media-profile.mjs';
import {setTimeout as delay} from 'node:timers/promises';

async function request(url,signal,limit) {
  const startedAt=Date.now();
  const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),redirect:'error',cache:'no-store'});
  if(!response.ok)throw new Error(`HLS HTTP ${response.status}`);
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
      try{
        const manifest=await request(playlistUrl,signal,1000000);bytes+=manifest.body.length;
        const playlist=parseLivePlaylist(manifest.body.toString('utf8'),playlistUrl);
        if(playlist.ended)throw new Error('De HLS-feed is beëindigd tijdens de proef.');
        if(playlist.map&&mapFetched!==playlist.map){const init=await request(playlist.map,signal,5000000);bytes+=init.body.length;mapFetched=playlist.map;}
        // Start at the actual live edge. Never drain an archive or catch up in a burst.
        if(lastSequence<0&&playlist.segments.length)lastSequence=playlist.segments.at(-1).sequence-1;
        const next=playlist.segments.find(segment=>segment.sequence>lastSequence);
        if(next){
          if(next.sequence>lastSequence+1)stalls++;
          const segment=await request(next.url,signal,10000000);bytes+=segment.body.length;segments++;lastSequence=next.sequence;firstSegmentAt??=Date.now();
          onSample({kind:'hls-http',identity,observedAtMs:Date.now(),bytes,segments,errors,stalls,timeToFirstSegmentMs:firstSegmentAt-startedAt,downloadMs:segment.elapsedMs,segmentSeconds:next.seconds,decoded:false,latencyMs:null});
          // One completed segment at its viewing tempo, including fetch time.
          await delay(Math.max(0,next.seconds*1000-(Date.now()-requestStarted)),undefined,{signal});
        }else await delay(Math.max(250,playlist.targetDuration*500),undefined,{signal});
      }catch(error){
        if(signal.aborted)break;
        errors++;onSample({kind:'hls-http-error',identity,observedAtMs:Date.now(),errors,reason:String(error.message).replace(/https?:\/\/\S+/g,'[URL verwijderd]')});
        await delay(2000,undefined,{signal});
      }
    }
  }catch(error){if(!signal.aborted)throw error;}
  return {identity,bytes,segments,errors,stalls,timeToFirstSegmentMs:firstSegmentAt===null?null:firstSegmentAt-startedAt,decoded:false};
}
