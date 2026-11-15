// Actual OutputBridge + obsFetch; inert capability, transport bytes and audio
// clock. This does not exercise a provider, account or real OBS installation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputBridge} from '../public/output-bridge.js';
import {obsOutputState} from '../server/node-obs-access.js';

const GAME='11111111-1111-4111-8111-111111111111',TOKEN='a'.repeat(43)+'.'+'b'.repeat(43),FP='c'.repeat(64),NEXT='d'.repeat(64);
const key=n=>n.toString(16).padStart(64,'0');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function until(predicate){for(let i=0;i<100&&!predicate();i++)await flush();assert(predicate(),'Output preloading did not reach the expected state');}
const audio=marker=>new Response(new Uint8Array([marker,73,68,51]),{headers:{'Content-Type':'audio/wav'}});
const list=(clips=[key(1),key(2)],fingerprint=FP)=>({version:1,gameId:GAME,fingerprint,total:clips.length,ready:clips.length,complete:true,items:clips.map(clip=>({key:clip,clip,ready:true,durationMs:1000}))});

function fixture(t,{obs=true,manifest=list()}={}){
 const descriptors=Object.fromEntries(['location','window','fetch'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)])),window=new EventTarget(),requests=[],events=[],decodes=[],sources=[],clock={now:Date.now()};let respond,decode,resume;
 t.mock.method(Date,'now',()=>clock.now);
 const context={state:'running',currentTime:0,decodeAudioData:async bytes=>{decodes.push(new Uint8Array(bytes)[0]);return decode?decode(bytes):{duration:1};},resume:async()=>{if(resume)await resume();context.state='running';},createBufferSource:()=>{const source={connect(){},disconnect(){},start(){source.started=true;},stop(){source.stopped=true;}};sources.push(source);return source;}};
 const bridge=Object.assign(Object.create(OutputBridge.prototype),{id:'22222222-2222-4222-8222-222222222222',isOutput:true,obs,enabled:true,active:true,audioReady:true,accessEpoch:0,offset:0,targetGameId:GAME,seen:new Set(),context,gain:{gain:{value:1}},mixer:{voice:100,music:25,effects:50},showAudio:{setLevels(){},setMuted(){},stop(){},enableBackground(){},pause(){},resume(){},cue(){},meters:{}},receive:event=>events.push(event),channel:{postMessage:event=>events.push(event),close(){}}});
 const packet=(fingerprint=FP,extra={})=>({producer:{id:'33333333-3333-4333-8333-333333333333',instanceId:'44444444-4444-4444-8444-444444444444',gameId:GAME,generation:1,until:Date.now()+15000},seq:1,publishedAt:Date.now(),snapshot:{gameId:GAME,paused:false,audioPreparation:{fingerprint,total:manifest.total,complete:true}},output:{id:bridge.id,until:Date.now()+7000,audioReady:true,generation:1,seq:1},routing:true,mixer:{voice:100,music:25,effects:50},voice:null,events:[],...extra});
 let current=packet();const loss=()=>bridge.loseOutput('De OBS-link of verbinding is ingetrokken.');window.addEventListener('milo-obs-access-lost',loss);
 Object.defineProperties(globalThis,{location:{configurable:true,writable:true,value:{origin:'https://preload-fixture.invalid',pathname:'/uitzending',search:'?show='+GAME,hash:obs?'#obs='+TOKEN:''}},window:{configurable:true,writable:true,value:window},fetch:{configurable:true,writable:true,value:async(path,options={})=>{const request={path,options,method:options.method||'GET',body:options.body?JSON.parse(options.body):null};requests.push(request);if(respond)return respond(request);if(path.endsWith('/show-audio'))return Response.json(manifest);if(path.includes('/clips/'))return audio(Number.parseInt(path.slice(-2),16));if(path.endsWith('/output'))return Response.json({state:current,serverTime:Date.now()});throw Error('Unexpected preload fixture path');}}});
 const consume=state=>{current=state;bridge.latest=state;bridge.consume(state);};
 const load=async(state=current)=>{consume(state);if(bridge.preloadPending)await bridge.preloadPending;await until(()=>!bridge.preloadPending);};
 const command=(clip=key(1),fingerprint=FP,id='static-voice')=>({id,clip,phase:'prepare',text:'Bernhard één! Eén!',preparedOnly:true,preparedFingerprint:fingerprint});
 t.after(()=>{bridge.dispose();window.removeEventListener('milo-obs-access-lost',loss);for(const [name,descriptor] of Object.entries(descriptors))if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
 return {bridge,window,requests,events,decodes,sources,packet,consume,load,command,context,respond:fn=>{respond=fn;},decode:fn=>{decode=fn;},resume:fn=>{resume=fn;},advance:ms=>{clock.now+=ms;}};
}
function assertScoped(requests){for(const request of requests){assert(request.path.startsWith('/api/obs/'));assert.equal(new Headers(request.options.headers).get('X-Milo-OBS-Token'),TOKEN);assert.equal(request.options.credentials,'omit');assert.equal(request.options.cache,'no-store');assert.equal(request.options.redirect,'error');}}

test('OBS loads all 75 fixed clips through its scoped capability before any command and plays prepared bytes without another GET',async t=>{
 const manifest=list(Array.from({length:75},(_,i)=>key(i+1))),h=fixture(t,{manifest});let inFlight=0,maximum=0;
 h.respond(async request=>{if(request.path.endsWith('/show-audio'))return Response.json(manifest);if(request.path.includes('/clips/')){inFlight++;maximum=Math.max(maximum,inFlight);await flush();inFlight--;return audio(Number.parseInt(request.path.slice(-2),16));}if(request.path.endsWith('/output'))return Response.json({state:h.packet(),serverTime:Date.now()});throw Error('Unexpected request');});
 await h.load();assert.equal(h.bridge.outputAudioPreparation.fingerprint,FP);assert.equal(h.bridge.outputAudioPreparation.ready,75);assert.equal(h.bridge.outputAudioPreparation.total,75);assert.equal(h.bridge.preloadedClips.size,75);assert.equal(maximum,2);assert.equal(h.decodes.length,0);assert.equal(h.sources.length,0);assertScoped(h.requests);
 assert.equal(h.requests[0].path,'/api/obs/show-audio');assert.equal(h.requests[0].method,'GET');assert.equal(h.requests.length,76);
 const count=h.requests.length;await h.bridge.applyVoice(h.command(key(15)));assert.equal(h.bridge.ack.status,'ready');await h.bridge.applyVoice({...h.command(key(15)),phase:'play'});assert.equal(h.bridge.ack.status,'playing');assert.equal(h.sources.filter(source=>source.started).length,1);assert.deepEqual(h.decodes,[15]);assert.equal(h.requests.length,count,'fixed playback must use only previously fetched bytes');
 h.sources[0].onended();assert.equal(h.bridge.ack.status,'ended');await h.bridge.heartbeat();const heartbeat=h.requests.at(-1);assert.equal(heartbeat.path,'/api/obs/output');assert.deepEqual(heartbeat.body.audioPreparation,{fingerprint:FP,total:75,ready:75});
});

test('ordinary authenticated output uses the same manifest contract through POST and never receives an OBS token',async t=>{
 const h=fixture(t,{obs:false});await h.load();assert.equal(h.requests[0].path,'/api/openai/show-audio');assert.equal(h.requests[0].method,'POST');assert.deepEqual(h.requests[0].body,{gameId:GAME});assert(h.requests.every(request=>new Headers(request.options.headers).get('X-Milo-OBS-Token')===null));assert.equal(h.bridge.outputAudioPreparation.ready,2);
});

test('a missing prepared-only clip never falls back to a runtime GET',async t=>{
 const h=fixture(t);await h.load();const before=h.requests.length;await h.bridge.applyVoice(h.command(key(99)));assert.equal(h.requests.length,before);assert.equal(h.bridge.ack.status,'error');assert.equal(h.sources.length,0);
});

for(const fingerprint of [undefined,NEXT])test(`a ${fingerprint?'different':'missing'} prepared command fingerprint cannot borrow current cached bytes`,async t=>{
 const h=fixture(t);await h.load();const before=h.requests.length,command={...h.command(),preparedFingerprint:fingerprint};await h.bridge.applyVoice(command);await h.bridge.applyVoice({...command,phase:'play'});assert.equal(h.requests.length,before);assert.equal(h.decodes.length,0);assert.equal(h.sources.length,0);assert.equal(h.bridge.ack.status,'error');
});

test('OBS projection carries only a valid prepared fingerprint and the public preload receipt',()=>{
 const state={producer:{gameId:GAME},snapshot:{gameId:GAME,audioPreparation:{fingerprint:FP,total:75,complete:true,items:[{text:'private preparation text'}]}},output:{audioPreparation:{fingerprint:FP,ready:75,total:75,internal:'private receipt'}},voice:{id:'voice',clip:key(1),preparedOnly:true,preparedFingerprint:FP,profile:'private profile'}};
 const visible=obsOutputState(state,{gameId:GAME});assert.equal(visible.voice.preparedFingerprint,FP);assert.equal(visible.voice.preparedOnly,true);assert.equal(visible.voice.profile,undefined);assert.deepEqual(visible.snapshot.audioPreparation,{fingerprint:FP,total:75,complete:true});assert.deepEqual(visible.output.audioPreparation,{fingerprint:FP,ready:75,total:75});
 state.voice.preparedFingerprint='not-a-fingerprint';assert.equal(obsOutputState(state,{gameId:GAME}).voice.preparedFingerprint,undefined);
});

test('a new dynamic current-voice command retains its scoped clip GET',async t=>{
 const h=fixture(t);await h.load();const before=h.requests.length,command={id:'dynamic-question',clip:key(90),text:'Wat een leuke publieksvraag!',phase:'prepare',preparedOnly:false};await h.bridge.applyVoice(command);assert.equal(h.requests.length,before+1);assert.equal(h.requests.at(-1).path,'/api/obs/clips/'+key(90));assert.equal(h.bridge.ack.status,'ready');await h.bridge.applyVoice({...command,phase:'play'});assert.equal(h.sources.filter(source=>source.started).length,1);assertScoped(h.requests);
});

test('partial preloading cannot acknowledge or play a fixed clip before the whole current manifest is ready',async t=>{
 const h=fixture(t),held=deferred();h.respond(async request=>{if(request.path.endsWith('/show-audio'))return Response.json(list());if(request.path.endsWith(key(2))){await held.promise;return audio(2);}return audio(1);});
 h.consume(h.packet());await until(()=>h.bridge.preloadedClips?.has(key(1)));assert.equal(h.bridge.outputAudioPreparation.ready,1);const pending=h.bridge.preloadPending,voice=h.bridge.applyVoice(h.command());await flush();assert(!['ready','playing'].includes(h.bridge.ack?.status));assert.equal(h.sources.length,0);
 held.resolve();await pending;await voice;assert.equal(h.sources.filter(source=>source.started).length,0);
});

test('a new fingerprint aborts and supersedes an old blocked preload immediately and ignores its late bytes',async t=>{
 const h=fixture(t,{manifest:list([key(1)])}),held=deferred();let current=FP,oldSignal;
 h.respond(async request=>{if(request.path.endsWith('/show-audio'))return Response.json(list([current===FP?key(1):key(3)],current));if(request.path.endsWith(key(1))){oldSignal=request.options.signal;await held.promise;return audio(1);}return audio(3);});
 h.consume(h.packet());await until(()=>!!oldSignal);const oldPending=h.bridge.preloadPending;current=NEXT;h.consume(h.packet(NEXT,{seq:2}));await flush();assert(oldSignal.aborted,'superseded work must not hold the new manifest hostage');assert(h.requests.filter(request=>request.path.endsWith('/show-audio')).length>=2);
 held.resolve();await oldPending;if(h.bridge.preloadPending)await h.bridge.preloadPending;assert.equal(h.bridge.outputAudioPreparation.fingerprint,NEXT);assert.equal(h.bridge.outputAudioPreparation.ready,1);assert(!h.bridge.preloadedClips.has(key(1)));assert(h.bridge.preloadedClips.has(key(3)));
});

for(const stage of ['decode','resume'])test(`a manifest change during prepared ${stage} cannot reactivate the old clip`,async t=>{
 const h=fixture(t,{manifest:list([key(1)])});await h.load();const held=deferred(),command=h.command();let entered=false;
 if(stage==='decode')h.decode(async()=>{entered=true;await held.promise;return {duration:1};});else {await h.bridge.applyVoice(command);h.resume(async()=>{entered=true;await held.promise;});}
 const pending=h.bridge.applyVoice(stage==='decode'?command:{...command,phase:'play'});await until(()=>entered);
 h.respond(async request=>request.path.endsWith('/show-audio')?Response.json(list([key(3)],NEXT)):audio(3));h.consume(h.packet(NEXT,{seq:2,voice:stage==='decode'?command:{...command,phase:'play'}}));held.resolve();await pending;if(h.bridge.preloadPending)await h.bridge.preloadPending;
 assert.equal(h.sources.filter(source=>source.started).length,0);assert(!h.events.some(event=>event.kind==='speech-start'));assert(!(h.bridge.ack?.id===command.id&&h.bridge.ack.status==='playing'));
});

for(const cause of ['revoke','cancel','dispose'])test(`late preload bytes after ${cause} cannot restore static audio readiness`,async t=>{
 const h=fixture(t,{manifest:list([key(1)])}),held=deferred();let signal;
 h.respond(async request=>{if(request.path.endsWith('/show-audio'))return Response.json(list([key(1)]));signal=request.options.signal;await held.promise;return audio(1);});h.consume(h.packet());await until(()=>!!signal);const pending=h.bridge.preloadPending;
 if(cause==='revoke')h.window.dispatchEvent(new Event('milo-obs-access-lost'));else if(cause==='cancel')h.bridge.stopForCancellation({...h.packet(),cancelledAt:Date.now(),cancelledGameId:GAME});else h.bridge.dispose();
 assert(signal.aborted);held.resolve();await pending;assert(!h.bridge.preloadedClips?.has(key(1)));assert.equal(h.sources.length,0);assert(!(h.bridge.outputAudioPreparation?.ready>0));if(cause!=='dispose'){assert.equal(h.bridge.active,false);assert.equal(h.bridge.audioReady,false);}
});

test('partial preload failure reports an error, backs off, and retries only missing clips without duplicating completed work',async t=>{
 const h=fixture(t);let failed=true;h.respond(async request=>{if(request.path.endsWith('/show-audio'))return Response.json(list());if(request.path.endsWith(key(2))&&failed){await until(()=>h.bridge.preloadedClips?.has(key(1)));return new Response(new Uint8Array());}return audio(Number.parseInt(request.path.slice(-2),16));});
 await h.load();assert(h.bridge.outputAudioPreparation.error);assert.equal(h.bridge.outputAudioPreparation.ready,1);const count=h.requests.length;for(let i=0;i<5;i++)h.consume(h.packet());await flush();assert.equal(h.requests.length,count,'failed preload retries must stay bounded');
 failed=false;h.advance(5100);await h.load(h.packet(FP,{seq:2}));assert.equal(h.bridge.outputAudioPreparation.ready,2);assert.equal(h.bridge.outputAudioPreparation.error,undefined);assert.equal(h.requests.filter(request=>request.path.endsWith(key(1))).length,1);assert.equal(h.requests.filter(request=>request.path.endsWith(key(2))).length,2);
});

test('a temporary HTTP503 for one fixed clip never revokes OBS, clears completed clips or replaces the confirmed picture',async t=>{
 const h=fixture(t);let failed=true;h.respond(async request=>{if(request.path.endsWith('/show-audio'))return Response.json(list());if(request.path.endsWith(key(2))&&failed){await until(()=>h.bridge.preloadedClips?.has(key(1)));return Response.json({error:'Temporarily unavailable'},{status:503});}return audio(Number.parseInt(request.path.slice(-2),16));});
 await h.load();assert.equal(h.bridge.active,true);assert.equal(h.bridge.audioReady,true);assert.equal(h.bridge.accessEpoch,0);assert.equal(h.bridge.preloadedClips.size,1);assert.equal(h.bridge.outputAudioPreparation.ready,1);assert(h.bridge.outputAudioPreparation.error);assert(!h.events.some(event=>event.kind==='snapshot'&&event.payload.outputWaiting));
 failed=false;h.advance(5100);await h.load(h.packet(FP,{seq:2}));assert.equal(h.bridge.outputAudioPreparation.ready,2);assert.equal(h.requests.filter(request=>request.path.endsWith(key(1))).length,1);assertScoped(h.requests);
});

test('a failed dynamic voice request reports only that utterance and leaves the confirmed OBS frame and prepared show audio intact',async t=>{
 const h=fixture(t);await h.load();h.respond(()=>Response.json({error:'Temporary voice error'},{status:503}));const command={id:'dynamic-request-failure',clip:key(90),text:'Een vraag voor het publiek',phase:'prepare',preparedOnly:false};await h.bridge.applyVoice(command);
 assert.equal(h.bridge.ack.id,command.id);assert.equal(h.bridge.ack.status,'error');assert.equal(h.bridge.active,true);assert.equal(h.bridge.audioReady,true);assert.equal(h.bridge.preloadedClips.size,2);assert.equal(h.bridge.accessEpoch,0);assert(!h.events.some(event=>event.kind==='snapshot'&&event.payload.outputWaiting));assertScoped(h.requests);
});

for(const invalid of ['duplicate','invalid-key','wrong-count'])test(`malformed ${invalid} manifest is rejected before any unscoped or extra clip request`,async t=>{
 const manifest=invalid==='duplicate'?list([key(1),key(1)]):invalid==='invalid-key'?list(['../../private']):{...list(),total:3},h=fixture(t,{manifest});await h.load();assert(h.bridge.outputAudioPreparation.error);assert.equal(h.requests.length,1);assert.equal(h.bridge.outputAudioPreparation.ready,0);assert.equal(h.sources.length,0);assertScoped(h.requests);
});

test('producer readiness cannot trust an expired output lease with an old complete audio receipt',async t=>{
 const h=fixture(t);Object.assign(h.bridge,{isOutput:false,routing:true,getGame:()=>({id:GAME})});h.bridge.latest=h.packet(FP,{output:{id:h.bridge.id,until:Date.now()-1,audioReady:true,generation:1,seq:1,audioPreparation:{fingerprint:FP,total:2,ready:2}}});
 let publishes=0;h.bridge.publish=async()=>{publishes++;h.bridge.latest=h.packet(FP,{output:{id:h.bridge.id,until:Date.now()+7000,audioReady:true,generation:1,seq:1,audioPreparation:{fingerprint:FP,total:2,ready:2}}});};
 await h.bridge.ensurePreparedAudio(FP,{timeoutMs:1000});assert(publishes>0,'a fresh output lease must be observed before accepting readiness');
});
