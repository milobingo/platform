// Real OutputBridge and capability fetch path with controlled audio-clock,
// meter and network fixtures. Actual OBS mixer/proof recording remains external.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {OutputBridge} from '../public/output-bridge.js';
import {handleOutput} from '../server/output.js';
import {fixture as relayFixture} from './live-calls-fixture.mjs';
import {verifiedTestEnvironment} from './verified-test-identity.mjs';

const GAME='11111111-1111-4111-8111-111111111111';
const TOKEN='a'.repeat(43)+'.'+'b'.repeat(43);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<60&&!predicate();i++)await flush();assert(predicate(),'OBS recovery did not reach its expected state');}

function fixture(t,{obs=true,blocked=false,signal=true}={}){
 const originals=Object.fromEntries(['location','document','window','AudioContext','BroadcastChannel','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const {document}=parseHTML('<!doctype html><html><body></body></html>'),window=new EventTarget(),requests=[],received=[],contexts=[],nodes=[],mixConnections=[],clock={now:Date.now()},muted=[];let playing=false,respond,stops=0,unlocks=0;
 t.mock.method(Date,'now',()=>clock.now);
 class Context{
  constructor(){this.state=blocked?'suspended':'running';this.currentTime=0;this.sampleRate=8000;contexts.push(this);}
  resume(){if(!blocked)this.state='running';return Promise.resolve();}
  createGain(){const gain={gain:{value:0},connect:target=>mixConnections.push(['gain',target])};return gain;}
  createMediaStreamDestination(){return {stream:{getTracks:()=>[]}};}
  createAnalyser(){return {fftSize:256,connect:target=>mixConnections.push(['analyser',target]),getByteTimeDomainData(bytes){for(let i=0;i<bytes.length;i++)bytes[i]=playing&&signal?128+(i%2?16:-16):128;}};}
  createBuffer(_channels,length,rate){return {duration:length/rate,getChannelData:()=>new Float32Array(length)};}
  createBufferSource(){const node={connect:target=>mixConnections.push(['source',target]),disconnect(){},start(){playing=true;node.started=true;},stop(){playing=false;node.stopped=true;}};nodes.push(node);return node;}
 }
 const packet=(patch={})=>({producer:{id:'22222222-2222-4222-8222-222222222222',instanceId:'33333333-3333-4333-8333-333333333333',generation:4,gameId:GAME,until:Date.now()+15000},seq:9,publishedAt:Date.now(),snapshot:{gameId:GAME,paused:true,lastNumber:41,drawn:[7,19,41],bingoPending:true},show:{scene:'bingo',paused:true,drawBlocked:true},routing:true,mixer:{voice:100,music:25,effects:50},events:[],voice:null,...patch});
 Object.defineProperties(globalThis,{location:{value:{origin:'https://obs-recovery.invalid',pathname:'/uitzending',search:'?show='+GAME,hash:obs?'#obs='+TOKEN:''},configurable:true,writable:true},document:{value:document,configurable:true,writable:true},window:{value:window,configurable:true,writable:true},AudioContext:{value:Context,configurable:true,writable:true},BroadcastChannel:{value:class{postMessage(){}close(){}},configurable:true,writable:true},fetch:{value:async(path,options={})=>{const body=options.body?JSON.parse(options.body):null;requests.push({path,method:options.method||'GET',body,token:new Headers(options.headers).get('X-Milo-OBS-Token')});if(respond)return respond(path,options,body);return Response.json({state:packet(),serverTime:Date.now()});},configurable:true,writable:true}});
 const bridge=new OutputBridge({isOutput:true,getId:()=>'',showAudio:{unlock:async()=>{unlocks++;return true;},setMuted:value=>muted.push(value),setLevels(){},stop(){stops++;},pause(){},resume(){},cue(){},meters:{}},receive:message=>received.push(message)});clearInterval(bridge.timer);bridge.timer=null;
 t.after(()=>{bridge.dispose();for(const [key,descriptor]of Object.entries(originals))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
 const prove=async()=>{await until(()=>!!bridge.activationProbe||!!bridge.testPlayback);await wait(25);const source=(bridge.activationProbe||bridge.testPlayback).source;contexts.at(-1).currentTime+=.65;playing=false;source.onended?.();await until(()=>bridge.active===true||!bridge.activating);};
 return {bridge,document,window,requests,received,contexts,nodes,mixConnections,muted,packet,prove,respond:fn=>{respond=fn;},advance:ms=>{clock.now+=ms;},get stops(){return stops;},get unlocks(){return unlocks;}};
}

function assertOutputOnly(requests){assert(requests.every(request=>request.path==='/api/obs/output'),'OBS recovery must use only its scoped output endpoint');assert(requests.every(request=>request.method==='GET'||request.body?.action==='output-heartbeat'),'recovery cannot publish, start, resume, release holds or draw');assert(requests.every(request=>request.token===TOKEN));}

test('a new OBS source waits for verified producer state and completed silent PCM activation, with no audible jingle or test receipt',async t=>{
 const h=fixture(t);await flush();assert.equal(h.contexts.length,0,'mount alone cannot start audio before a valid producer exists');assert.equal(h.bridge.audioReady,undefined);assert.equal(h.bridge.panel.hidden,false);
 await h.bridge.tick();await until(()=>h.nodes.length===1);assert.equal(h.contexts.length,1);assert.equal(h.bridge.active,undefined);assert.equal(h.bridge.audioReady,undefined);assert.equal(h.bridge.panel.hidden,false);assert.equal(h.requests.filter(r=>r.body).length,0,'readiness is not reported before playback');
 assert(h.bridge.panel.classList.contains('output-unlock--obs'));assert([...h.bridge.panel.querySelectorAll('button')].every(button=>button.hidden));
 await h.prove();assert.equal(h.bridge.audioReady,true);assert.equal(h.bridge.active,true);assert.equal(h.bridge.panel.hidden,true);assert.equal(h.bridge.testAck,undefined);assert(h.nodes[0].buffer.getChannelData(0).every(value=>value===0));assert.match(h.bridge.panel.querySelector('small').textContent,/Uitzendaudio geactiveerd.*OBS-mixer/);assert(h.mixConnections.some(([kind,target])=>kind==='source'&&target===h.bridge.gain));
 h.bridge.consume(h.packet({seq:10}));h.bridge.consume(h.packet({seq:11}));await flush();assert.equal(h.nodes.length,1);assert.equal(h.contexts.length,1);assertOutputOnly(h.requests);
});

for(const failure of ['409','503','network'])test(`an established OBS source keeps its confirmed picture/cache across ${failure}, mutes before lease expiry and recovers without another jingle`,async t=>{
 const h=fixture(t);await h.bridge.tick();await h.prove();const originalEpoch=h.bridge.accessEpoch,originalReads=h.requests.length;let failed=true;
 const clip=new ArrayBuffer(8);h.bridge.preloadedClips=new Map([['prepared-clip',clip]]);
 h.respond(()=>{if(failed){if(failure==='network')throw Error('Netwerk tijdelijk weg');return Response.json({error:failure==='409'?'De producer is tijdelijk niet verbonden.':'Relay tijdelijk niet bereikbaar.'},{status:Number(failure)});}return Response.json({state:h.packet({seq:12}),serverTime:Date.now()});});
 const snapshots=h.received.filter(event=>event.kind==='snapshot').length;await h.bridge.tick();assert.equal(h.bridge.active,true);assert.equal(h.bridge.audioReady,true);assert.equal(h.bridge.accessEpoch,originalEpoch);assert.equal(h.received.filter(event=>event.kind==='snapshot').length,snapshots,'one failed heartbeat never replaces the scene with an empty waiting snapshot');
 h.advance(5100);await h.bridge.tick();assert.equal(h.bridge.active,false);assert.equal(h.bridge.audioReady,false);assert.equal(h.bridge.accessEpoch,originalEpoch,'a transport outage does not revoke the show capability');assert.equal(h.bridge.preloadedClips.get('prepared-clip'),clip);
 const frozen=h.received.filter(event=>event.kind==='snapshot').at(-1).payload;assert.equal(frozen.gameId,GAME);assert.deepEqual(frozen.drawn,[7,19,41]);assert.equal(frozen.lastNumber,41);assert.equal(frozen.outputWaiting,true);assert.equal(frozen.paused,true);
 await h.bridge.tick();await h.bridge.tick();assert.equal(h.bridge.accessEpoch,originalEpoch);assert(h.requests.length>originalReads);
 failed=false;h.advance(11000);await h.bridge.tick();await until(()=>h.bridge.active);assert.equal(h.bridge.panel.hidden,true);assert.equal(h.bridge.reconnectNeeded,false);assert.equal(h.contexts.length,1,'an existing audio graph is reused');assert.equal(h.nodes.length,1,'reconnecting does not play another test tone');assertOutputOnly(h.requests);
 const restored=h.received.filter(event=>event.kind==='snapshot'&&!event.payload.outputWaiting).at(-1).payload;assert.equal(restored.gameId,GAME);assert.deepEqual(restored.drawn,[7,19,41]);assert.equal(restored.paused,true);assert.equal(restored.bingoPending,true);
});

test('a single failed heartbeat followed by success keeps the running graph and never clears the board or prepared clips',async t=>{
 const h=fixture(t);await h.bridge.tick();await h.prove();const clip=new ArrayBuffer(8),snapshots=h.received.length,epoch=h.bridge.accessEpoch;h.bridge.preloadedClips=new Map([['prepared',clip]]);
 let failed=true;h.respond(()=>failed?Response.json({error:'Relay busy'},{status:503}):Response.json({state:h.packet({seq:10}),serverTime:Date.now()}));
 await h.bridge.tick();failed=false;h.advance(500);await h.bridge.tick();assert(h.bridge.active);assert(h.bridge.audioReady);assert(h.bridge.panel.hidden);assert.equal(h.bridge.accessEpoch,epoch);assert.equal(h.bridge.preloadedClips.get('prepared'),clip);assert.equal(h.nodes.length,1);assert(h.received.slice(snapshots).every(event=>event.kind!=='snapshot'||!event.payload.outputWaiting));assertOutputOnly(h.requests);
});

test('a hanging heartbeat is muted by the watchdog before the seven-second audio lease can expire',async t=>{
 const h=fixture(t);await h.bridge.tick();await h.prove();let release;const pending=new Promise(resolve=>{release=resolve;});h.respond(()=>pending);
 const polling=h.bridge.tick();await flush();assert(h.bridge.busy);h.advance(5100);await h.bridge.tick();assert.equal(h.bridge.active,false);assert.equal(h.bridge.audioReady,false);const frozen=h.received.filter(event=>event.kind==='snapshot').at(-1).payload;assert.deepEqual(frozen.drawn,[7,19,41]);assert.equal(frozen.outputWaiting,true);
 release(Response.json({state:h.packet({seq:12}),serverTime:Date.now()}));await polling;h.respond(()=>Response.json({state:h.packet({seq:13}),serverTime:Date.now()}));h.advance(600);await h.bridge.tick();await until(()=>h.bridge.active);assert.equal(h.nodes.length,1);assertOutputOnly(h.requests);
});

test('revocation after a transport outage still immediately erases cached audio and the previously shown OBS frame',async t=>{
 const h=fixture(t);await h.bridge.tick();await h.prove();h.bridge.preloadedClips=new Map([['prepared',new ArrayBuffer(8)]]);h.respond(()=>Response.json({error:'Relay busy'},{status:503}));h.advance(5100);await h.bridge.tick();assert.equal(h.bridge.preloadedClips.size,1);const epoch=h.bridge.accessEpoch;
 h.respond(()=>Response.json({error:'Deze OBS-link is ingetrokken.'},{status:401}));await h.bridge.tick();assert.equal(h.bridge.preloadedClips.size,0);assert.equal(h.bridge.accessEpoch,epoch+1);assert.equal(h.bridge.reuseAudioProof,false);const snapshot=h.received.filter(event=>event.kind==='snapshot').at(-1).payload;assert.equal(snapshot.gameId,undefined);assert.equal(snapshot.drawn,undefined);assert(!h.bridge.audioReady);assertOutputOnly(h.requests);
});

for(const status of [401,403,409,503])test(`the original ${status} relay error survives the capability-loss event instead of becoming a misleading epoch error`,async t=>{
 const h=fixture(t),message='SPECIFIEKE-SERVERMELDING-'+status;h.respond(()=>Response.json({error:{message}},{status}));await assert.rejects(h.bridge.api(),error=>error.status===status&&error.message===message);assert.equal(h.contexts.length,0);assert.equal(h.nodes.length,0);assert.equal(h.bridge.panel.hidden,false);assertOutputOnly(h.requests);
});

test('a browser that actually blocks autoplay never acknowledges audio, hides the status or starts a tone, and retries stay bounded',async t=>{
 const h=fixture(t,{blocked:true});await h.bridge.tick();await until(()=>!h.bridge.activating&&h.contexts.length===1);assert.equal(h.bridge.audioReady,false);assert.equal(h.bridge.active,false);assert.equal(h.bridge.panel.hidden,false);assert.equal(h.nodes.length,0);assert.equal(h.requests.filter(r=>r.body?.audioReady).length,0);assert.match(h.bridge.panel.querySelector('small').textContent,/blokkeert geluid|geblokkeerd/);
 for(let i=0;i<5;i++)await h.bridge.tick();assert.equal(h.unlocks,1,'polling must not spin activation attempts while backoff is active');h.advance(11000);await h.bridge.tick();await until(()=>!h.bridge.activating);assert.equal(h.unlocks,2);assert.equal(h.contexts.length,1);assert.equal(h.nodes.length,0);assertOutputOnly(h.requests);
});

test('silent activation never claims audible test playback; an explicit missing-signal test still fails',async t=>{
 const h=fixture(t,{signal:false});await h.bridge.tick();await h.prove();assert.equal(h.bridge.active,true);assert.equal(h.bridge.audioReady,true);assert.equal(h.bridge.testAck,undefined);
 const testing=assert.rejects(h.bridge.playProgramTest(),/Geen hoorbaar testsignaal/);await h.prove();await testing;assert.equal(h.bridge.testAck.status,'error');assert(!h.requests.some(request=>request.body?.testAck?.status==='played'));
});
test('a silent probe ended callback without audio-clock progress cannot activate an OBS source',async t=>{
 const h=fixture(t);await h.bridge.tick();await until(()=>!!h.bridge.activationProbe);h.bridge.activationProbe.source.onended();await until(()=>!h.bridge.activating);assert.equal(h.bridge.audioReady,false);assert.equal(h.bridge.active,false);assert.equal(h.bridge.panel.hidden,false);assert.equal(h.requests.filter(request=>request.body?.audioReady).length,0);assert.equal(h.bridge.testAck,undefined);
});

for(const invalid of ['mismatched-show','expired-producer','stale-publication','inconsistent-show','stale-generation'])test(`${invalid} never automatically opens audio or releases the paused show`,async t=>{
 const h=fixture(t);let value=h.packet();if(invalid==='mismatched-show')value.snapshot.gameId='other-show';if(invalid==='expired-producer')value.producer.until=Date.now()-1;if(invalid==='stale-publication')value.publishedAt=Date.now()-9000;if(invalid==='inconsistent-show')value.producer.gameId='other-show';if(invalid==='stale-generation'){h.bridge.receivedGeneration=5;h.bridge.latest=h.packet({producer:{...value.producer,generation:5}});}
 h.respond(()=>Response.json({state:value,serverTime:Date.now()}));if(invalid==='stale-generation')h.bridge.consume(value);else await h.bridge.tick();await flush();assert.equal(h.contexts.length,0);assert.equal(h.nodes.length,0);assert(!h.bridge.active);assert.equal(h.requests.filter(r=>r.body).length,0);assertOutputOnly(h.requests);
});

test('a cancelled show invalidates an already queued activation and old running snapshots cannot reactivate its audio',async t=>{
 const h=fixture(t),running=h.packet();h.bridge.latest=running;h.bridge.consume(running);h.bridge.consume({...running,cancelledAt:Date.now(),cancelledGameId:GAME,routing:false});await flush();assert.equal(h.contexts.length,0);assert.equal(h.nodes.length,0);assert.equal(h.bridge.audioReady,false);assert.equal(h.bridge.active,false);h.bridge.consume({...running,seq:10});await flush();assert.equal(h.nodes.length,0);assert.equal(h.requests.length,0);assert.equal(h.bridge.panel.hidden,false);assert.match(h.bridge.panel.textContent,/geannuleerd/);
});

test('a capability loss between state consumption and its activation microtask cancels that queued attempt',async t=>{
 const h=fixture(t),running=h.packet();h.bridge.latest=running;h.bridge.consume(running);h.window.dispatchEvent(new Event('milo-obs-access-lost'));await flush();assert.equal(h.contexts.length,0,'a revoked or lost epoch cannot use the previously queued state');assert.equal(h.nodes.length,0);assert.equal(h.requests.length,0);assert(!h.bridge.active);
});

test('revoked OBS access never opens audio and cannot silently switch into another show',async t=>{
 const h=fixture(t);h.respond(()=>Response.json({error:'Deze OBS-link is ingetrokken.'},{status:401}));await h.bridge.tick();await flush();assert.equal(h.contexts.length,0);assert.equal(h.nodes.length,0);assert.match(h.bridge.error,/ingetrokken/);const epoch=h.bridge.accessEpoch;await h.bridge.tick();assert.equal(h.bridge.accessEpoch,epoch);assert.equal(h.bridge.targetGameId,GAME);assertOutputOnly(h.requests);
});

test('regular browser output retains explicit manual activation while valid programme state still restores immediately',async t=>{
 const h=fixture(t,{obs:false});await h.bridge.tick();await flush();assert.equal(h.contexts.length,0);assert.equal(h.nodes.length,0);assert(!h.bridge.panel.classList.contains('output-unlock--obs'));assert.equal(h.bridge.panel.querySelector('[data-output-activate]').hidden,false);
 const activating=h.bridge.activate();await h.prove();await activating;assert.equal(h.bridge.audioReady,true);assert.equal(h.bridge.active,true);assert.equal(h.bridge.panel.hidden,true);assert(h.requests.every(request=>request.path==='/api/output'));assert(h.requests.every(request=>request.token===null));assert(h.requests.every(request=>request.method==='GET'||request.body?.action==='output-heartbeat'));
});

test('an OBS source waits silently for another live audio lease and activates automatically once that lease expires',async t=>{
 const h=fixture(t),until=Date.now()+7000;h.respond(()=>Response.json({state:h.packet({output:{id:'44444444-4444-4444-8444-444444444444',until,audioReady:true,generation:4,seq:9}}),serverTime:Date.now()}));
 await h.bridge.tick();await flush();assert.equal(h.contexts.length,0,'an unclaimed source cannot play its activation tone over the current audio owner');assert.equal(h.nodes.length,0);assert.equal(h.requests.filter(request=>request.body).length,0);
 h.advance(7500);await h.bridge.tick();await h.prove();assert.equal(h.bridge.audioReady,true);assert.equal(h.bridge.active,true);assert.equal(h.nodes.length,1);assertOutputOnly(h.requests);
});

async function producerFixture(t,{otherClient=false,otherInstance=false,brandId='milo'}={}){
 const h=await relayFixture(t),instanceId=crypto.randomUUID(),actions=[];
 await h.bingo.mutate(h.game.id,{},game=>{game.state.control={id:h.ids.host,until:Date.now()+60000};game.state.paused=true;game.state.drawHold={callId:'kept-call-hold'};});
 const state={producer:{id:otherClient?crypto.randomUUID():h.ids.host,instanceId:otherInstance?crypto.randomUUID():instanceId,gameId:h.game.id,generation:4,until:Date.now()-1},generation:4,seq:9,publishedAt:Date.now()-16000,snapshot:{gameId:h.game.id,paused:true,lastNumber:27,drawn:[7,13,27]},show:null,events:[],voice:null,output:null,routing:false,mixer:{voice:100,music:25,effects:50}};
 await h.env.DB.prepare('UPDATE studio_outputs SET document = ? WHERE owner_id = ?').bind(JSON.stringify(state),'host').run();
 const bridge=Object.assign(Object.create(OutputBridge.prototype),{id:instanceId,isOutput:false,enabled:true,generation:4,seq:9,claimedGame:h.game.id,getId:()=>h.ids.host,getGame:()=>({...h.game,brandId}),getSnapshot:()=>state.snapshot,getShow:()=>null,events:[],command:null,mixer:state.mixer,routing:false,latest:state,offset:0});
 bridge.api=async body=>{actions.push(body?.action||'GET');const request=h.req('host',body?{...body,clientId:bridge.clientId}:undefined,{path:'/api/output',headers:{'X-Vlampie-Output':'1'}}),response=await handleOutput(request,verifiedTestEnvironment(request,h.env)),data=await response.json();if(!response.ok)throw Object.assign(Error(data.error),{status:response.status});bridge.latest=data.state;return data.state;};
 const gameBefore=(await h.bingo.game(h.game.id)).data;
 return {h,bridge,actions,gameBefore};
}

test('a throttled Milo producer reclaims only its own expired relay lease using real SQLite CAS, without starting or releasing the game',async t=>{
 const {h,bridge,actions,gameBefore}=await producerFixture(t);await bridge.publish();
 assert.deepEqual(actions,['publish','GET','producer-claim','publish']);assert.equal(bridge.generation,5);assert.equal(bridge.seq,1);assert.equal(bridge.latest.producer.id,h.ids.host);assert.equal(bridge.latest.producer.instanceId,bridge.id);assert.equal(bridge.latest.snapshot.gameId,h.game.id);assert.deepEqual(bridge.latest.snapshot.drawn,[7,13,27]);
 assert.deepEqual((await h.bingo.game(h.game.id)).data,gameBefore,'relay recovery cannot clear pause/call hold, start a round or draw a ball');
 await bridge.publish();assert.equal(bridge.seq,2);assert.deepEqual(actions.slice(4),['publish'],'healthy subsequent publication does not reclaim repeatedly');
});

for(const change of [{otherClient:true},{otherInstance:true},{brandId:'vlampie'}])test(`expired relay recovery never claims another tab or alters Vlampie: ${JSON.stringify(change)}`,async t=>{
 const {h,bridge,actions,gameBefore}=await producerFixture(t,change);await assert.rejects(bridge.publish(),error=>error.status===409);assert(!actions.includes('producer-claim'));assert.equal(bridge.generation,4);assert.deepEqual((await h.bingo.game(h.game.id)).data,gameBefore);
});
