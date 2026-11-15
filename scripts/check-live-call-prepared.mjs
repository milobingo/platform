// Provider-free playback and graph tests. These do not claim a real LiveKit,
// YouTube or OBS rehearsal with a family/device has succeeded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveCallOutput} from '../frontend/live-call-output.js';
import {LiveCallAudio} from '../frontend/live-call-audio.js';
import {LIVE_CALL_LINES} from '../public/live-call-script.js';
import {Context,Stream,Track,call,reaches} from './live-call-audio-fixtures.mjs';
import {callSourceLabel,callResumeLabel,childAvailability,nextCallCue} from '../frontend/live-call-card-model.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
class PreparedContext extends Context{
 constructor(){super();this.sampleRate=48000;this.sources=[];this.automatic=true;}
 async decodeAudioData(){return {duration:.3};}
 createBuffer(_channels,length,rate){return {duration:length/rate,getChannelData:()=>new Float32Array(length)};}
 createBufferSource(){const node=this.createGain();node.start=(_at=0,offset=0)=>{node.offset=offset;node.started=true;if(this.automatic)queueMicrotask(()=>node.onended?.());};node.stop=()=>{node.stopped=true;};this.sources.push(node);return node;}
}
function setup({ready=true,grant=true,magicReady=false,missingAudio=false,sharedClaims=new Set()}={}){
 const current={...call(),mode:'prepared',magicReadyAt:magicReady?1:undefined},context=new PreparedContext(),events=[],requests=[];
 const bridge={active:true,audioReady:ready,context,latest:{routing:true},mixer:{voice:100},showAudio:{setMuted:v=>events.push(['music-muted',v])},stopSource:()=>{},preparedCallClip:async(key,charId,id)=>{assert.equal(id,current.id);assert.equal(charId,current.characterId);events.push(['line',key]);return missingAudio?null:{bytes:new Uint8Array([1]).buffer,text:LIVE_CALL_LINES[key],clip:key,fingerprint:'prepared-show'};}};
 const engine={isOutput:true,demo:false,bridge},media={connect:async()=>{},publishPresenterTrack:async track=>events.push(['return-published',track.id]),disconnect:async()=>events.push(['disconnected'])};let output;
 const api={lastOK:0,request:async(path,body)=>{requests.push({path,body});throw Error('No provider/network request is allowed in a prepared call.');},action:async(action,body={})=>{events.push(['action',action,body]);if(action==='magic-ready')current.magicReadyAt=Date.now();if(action==='magic-claim'){const key=current.magic.id;if(!grant||sharedClaims.has(key))return {effectGranted:false};sharedClaims.add(key);current.magic.effectClaim={at:Date.now()};return {effectGranted:true};}if(action==='magic-played')current.magic.playedAt=Date.now();if(action==='finish'||action==='fail'){current.phase='returning';await output.sync(current);}return {call:structuredClone(current)};}};
 class ForbiddenPeer{constructor(){throw Error('Prepared calls must never construct an AI peer.');}}
 output=new LiveCallOutput({engine,media,api,Peer:ForbiddenPeer,Stream});
 return {output,engine,bridge,current,context,events,requests};
}
async function start(h){const task=h.output.sync(h.current);await flush();h.output.remoteTrack(new Track('guest-'+h.current.id),{identity:h.current.guestIdentity,target:'live'});await task;for(let i=0;i<5;i++)await flush();}
async function settle(h){for(let i=0;i<12&&h.output.preparedTask;i++)await flush();assert.equal(h.output.preparedTask,null);}

test('prepared greeting uses cached lines, publishes presenter return first, waits for selected guest and never opens an AI peer',async()=>{
 const h=setup();const task=h.output.sync(h.current);await flush();assert.equal(h.events.some(e=>e[0]==='line'),false);assert.equal(h.output.remoteTrack(new Track('private'),{identity:'host',target:'backstage'}),false);h.output.remoteTrack(new Track('child'),{identity:h.current.guestIdentity,target:'live'});await task;await settle(h);
 assert.deepEqual(h.events.filter(e=>e[0]==='line').map(e=>e[1]),['greeting','choice']);assert.equal(h.events[1][0],'return-published');assert(h.current.magicReadyAt);assert.equal(h.output.state().connected,true);assert.equal(h.output.audio.listening,false);assert.equal(h.output.peer,undefined);assert.deepEqual(h.requests,[]);
 assert.equal(h.bridge.getLiveCall(),h.current);for(let i=0;i<3;i++){await h.output.sync({...h.current,version:i+2});await settle(h);}assert.equal(h.events.filter(e=>e[0]==='line').length,2);await h.output.dispose();assert.equal(h.bridge.getLiveCall,undefined);
});

test('chosen prepared effect claims once across reload/output controllers and receipt follows a real sound start',async()=>{
 const claims=new Set(),h=setup({magicReady:true,sharedClaims:claims});h.current.magic={id:'one-effect',choice:'bubbles',effectId:'call-bubbles'};await start(h);await settle(h);
 const source=h.context.sources.at(-1);assert(source.started);assert.equal(h.output.effect.id,'wonder');assert(h.current.magic.playedAt);assert.deepEqual(h.events.filter(e=>e[0]==='line').map(e=>e[1]),['bubbles','countdown']);assert.equal(h.events.filter(e=>e[1]==='magic-claim').length,1);assert.equal(h.events.filter(e=>e[1]==='magic-played').length,1);
 for(let i=0;i<4;i++){await h.output.sync({...h.current,version:i+3});await settle(h);}assert.equal(h.events.filter(e=>e[1]==='magic-claim').length,1);await h.output.dispose();
 const replay=setup({magicReady:true,sharedClaims:claims});replay.current.magic={id:'one-effect',choice:'bubbles',effectId:'call-bubbles'};await start(replay);await settle(replay);assert.equal(replay.output.effect,undefined);assert.equal(replay.events.some(e=>e[1]==='magic-played'),false);assert.equal(replay.current.magic.playedAt,undefined);await replay.output.dispose();
});

test('prepared audio is mix-minus, cannot enter AI, pauses for listening and stops synchronously on return',async()=>{
 const context=new PreparedContext();context.automatic=false;const audio=new LiveCallAudio({context,Stream});await audio.unlock();const c={...call(),mode:'prepared'};audio.setSession(c);audio.setListening(true);audio.attachGuest(new Track('child'),{identity:c.guestIdentity});const guest=audio.guestSource;
 const task=audio.playPreparedBuffer({duration:5});const source=audio.preparedSource;assert(reaches(source,audio.programDestination));assert(reaches(source,audio.presenterDestination));assert(reaches(source,context.destination));assert(!reaches(source,audio.aiInputDestination));assert(!reaches(guest,audio.presenterDestination));assert(!reaches(guest,audio.aiInputDestination));
 context.currentTime=1.25;audio.setSession({...c,aiMuted:true});assert.equal(audio.preparedSource,null);assert(source.stopped);assert.equal(audio.preparedTask.offset,1.25);assert(!reaches(source,audio.presenterDestination));audio.setSession({...c,aiMuted:false});const resumed=audio.preparedSource;assert.equal(resumed.offset,1.25);resumed.onended();await task;
 audio.setSession({...c,aiMuted:true});const queued=audio.playPreparedBuffer({duration:2});assert.equal(audio.preparedSource,null,'a late decoded line waits for listening to end');audio.setSession({...c,aiMuted:false});assert(audio.preparedSource.started);audio.preparedSource.onended();await queued;
 const interrupted=audio.playPreparedBuffer({duration:5}),rejected=assert.rejects(interrupted,/gestopt/),playing=audio.preparedSource;audio.stopSession();assert(playing.stopped);assert(!reaches(guest,audio.programDestination));assert.equal(audio.preparedTask,null);await rejected;await audio.dispose();
});

test('thank-and-close uses prepared outro before closing; missing fixed audio closes safely with the draw hold untouched',async()=>{
 const h=setup({magicReady:true});await start(h);h.current.outroRequestedAt=Date.now();await h.output.sync(h.current);await settle(h);assert(h.events.some(e=>e[0]==='line'&&e[1]==='thank'));assert(h.events.some(e=>e[0]==='action'&&e[1]==='finish'));assert.equal(h.current.phase,'returning');assert.equal(h.output.audio.enabled,false);assert.equal(h.events.some(e=>e[1]==='resume-draw'),false);assert.equal(h.requests.length,0);await h.output.dispose();
 const failure=setup({missingAudio:true});await start(failure);await settle(failure);assert.equal(failure.current.phase,'returning');assert.equal(failure.output.audio.enabled,false);assert.equal(failure.events.some(e=>e[1]==='fail'),true);assert.equal(failure.events.some(e=>e[1]==='magic-ready'),false);assert.equal(failure.events.some(e=>e[1]==='resume-draw'),false);assert.equal(failure.requests.length,0);await failure.output.dispose();
});

test('call card reports actual readiness, random ordinal and finale continuation without inventing consent or returning proof',()=>{
 const now=Date.now(),entry={callConsentAt:1,callConsentEnabled:true,child:true,parentConsent:true,micChecked:true,connectionChecked:true,headphones:true,callPresenceAt:now,technicalReadyAt:now};assert.equal(childAvailability(entry,now).ready,true);assert.equal(childAvailability({...entry,callStatus:'declined'},now).ready,true);for(const changed of [{callConsentEnabled:false},{callPresenceAt:now-45001},{parentConsent:false},{headphones:false},{technicalReadyAt:now-1800001},{child:false}])assert.equal(childAvailability({...entry,...changed},now).ready,false);
 assert.equal(callSourceLabel({source:'random',randomIndex:2}),'Willekeurig 2 van 2');assert.equal(callResumeLabel({resumeTarget:'ending'}),'Verder naar afsluiting');assert.equal(callResumeLabel({resumeTarget:'next-round'}),'Start volgende ronde');assert.equal(nextCallCue([{id:'r',source:'random',status:'pending',createdAt:1},{id:'w',source:'winner',status:'waiting-announcement',createdAt:2}]).id,'w');assert.equal(nextCallCue([{status:'skipped'}]),null);
});
