// Controller/state-machine checks. Providers, media devices and network are
// injected boundaries; this script does not certify a real LiveKit/AI call.
import assert from 'node:assert/strict';
import {LiveCallRuntime} from '../frontend/live-call-runtime.js';
import {makeGame,generateBooks} from '../server/bingo-model.js';
import {makeLiveCall,transitionLiveCall} from '../server/live-call-model.js';
import {CHARACTERS} from '../server/characters.js';

const noop=()=>{};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
class SilentConnection {
 constructor(options){this.options=options;this.call=null;this.epoch=0;this.lastOK=Date.now();this.actions=[];}
 async action(name,body={}){this.actions.push({name,body});throw Error('A simulated call must not request a real action.');}
 async poll(){} async heartbeat(){return {}} leave(){} dispose(){this.disposed=true;}
}
function fixture({demo=true,Connection=SilentConnection,Media,Output}={}){
 const game=makeGame({brandId:'milo',title:'Runtime controle',roundCount:1,date:'2026-10-20T19:00'},'owner','https://bingo.example');
 generateBooks(game,2,'runtime-books');
 for(const [i,book] of game.books.entries())Object.assign(book,{accountId:'parent-family',profileId:i?'child-daan':'child-sophie',name:i?'Daan':'Sophie'});
 game.state.drawn=[3,7,42];game.state.epoch='epoch-one';
 game.participation=game.books.map(book=>({id:'entry-'+book.profileId,accountId:book.accountId,profileId:book.profileId,name:book.name,callConsentAt:1,callStatus:'accepted',micChecked:true,connectionChecked:true}));
 game.results=[{id:'confirmed-result',type:'bingo',winner:{accountId:'parent-family',profileId:'child-sophie'},prize:{title:'Een toverdoos'},roundIndex:0,createdAt:123}];
 const calls=[],failures=[],notices=[];
 const engine={demo,isOutput:false,game,clientId:'director-browser',hostId:'milo',voicePhase:'idle',magic:null,camera:'wide',speakerId:'milo',dirty:false,
  director:{scene:'entertainment',sceneAge:12,paused:false,pending:null,flow:null,drawBlocked:false,configure:value=>calls.push({method:'configure',value}),setScene(scene){this.scene=scene;calls.push({method:'scene',scene});},pause(){this.paused=true;}},
  runner:{autoDraw:true,age:12},bridge:{id:'output-browser',connected:true,routing:true,connect:async()=>{},sendLocal:noop},
  emit:noop,stopSpeech:()=>calls.push({method:'stopSpeech'}),fail:message=>failures.push(message),notify:message=>notices.push(message),syncGame:noop,
  acceptGame(value){this.game=value;},pause:async()=>{},post:async()=>{throw Error('Unexpected legacy call endpoint.');}};
 const realRequests=[];
 const runtime=new LiveCallRuntime(engine,{Connection,Media,Output,timers:false,request:async path=>{realRequests.push(path);return {configured:false};}});
 return {engine,runtime,calls,failures,notices,realRequests,queue:()=>runtime.getSnapshot().queue};
}
const prepare=({runtime,queue},name='Sophie',character='milo')=>runtime.prepare(queue().find(e=>e.name===name).id,{callName:name,pronunciation:'Sofie',reason:'Een gezellig showgesprek',note:'Begin met een makkelijke vraag.',confirmedFacts:[{confirmed:true,prize:'Verzonnen prijs'}]},90,character);
async function backstage(f){await prepare(f);await f.runtime.action('ring');await f.runtime.action('simulate',{outcome:'answer'});}
async function stage(f){await f.runtime.action('backstage-ready',{soundChecked:true,explanationGiven:true});await f.runtime.action('stage');}
async function completeReturn(f,{manual=false}={}){if(!manual)await f.runtime.action('simulate',{outcome:'returned'});await f.runtime.action('confirm-return',{confirmed:true,...(manual?{manual:true,note:'Ouder bevestigt dat YouTube weer zichtbaar en hoorbaar is.'}:{})});assert(f.runtime.drawHeld);await f.runtime.action('resume-draw');}

// All nine steps use the actual runtime and the shared server model.
{
 const f=fixture(),{runtime:r,engine:e}=f,original=[...e.game.state.drawn];
 assert.equal(f.queue().length,2);assert.equal(f.queue()[0].accountId,f.queue()[1].accountId);
 await prepare(f);assert.equal(r.call.phase,'preparing');assert(r.drawHeld);assert(e.director.drawBlocked);assert.equal(e.runner.autoDraw,false);assert.deepEqual(r.call.checkpoint.drawn,original);assert.equal(r.call.context.callName,'Sophie');assert.equal(r.call.context.confirmedFacts[0].prize,'Een toverdoos');assert.equal(r.call.context.confirmedFacts.length,1);
 await assert.rejects(r.prepare(f.queue()[1].id,{callName:'Daan'}),/bestaande belmoment/);assert.equal(r.call.name,'Sophie');
 await r.action('ring');assert.equal(r.call.phase,'ringing');await assert.rejects(r.action('go-live',{contextConfirmed:true}),/belstap/);
 await r.action('simulate',{outcome:'answer'});assert.equal(r.call.phase,'backstage');assert(r.call.heardCheckpointAt);assert(r.call.media.player.micReady);await r.connectPrivate();await r.privateMic(false);assert(r.getSnapshot().media.micMuted);await r.privateMic(true);assert.equal(r.getSnapshot().media.micMuted,false);
 await assert.rejects(r.action('stage'),/privé-voorgesprek/);await stage(f);assert.equal(r.call.phase,'staged');
 await r.action('context',{context:{...r.call.context,callName:'Sofie',note:'Deze roepnaam is gecontroleerd.',confirmedFacts:[{prize:'Verzonnen'}]}});assert.equal(r.call.phase,'backstage');assert.equal(r.call.checks.soundChecked,false);assert.equal(r.call.checks.explanationGiven,false);assert.equal(r.call.context.confirmedFacts[0].prize,'Een toverdoos');await stage(f);
 await assert.rejects(r.action('go-live'),/gastkaart/);e.voicePhase='speaking';await assert.rejects(r.action('go-live',{contextConfirmed:true}),/entertainmentmoment/);e.voicePhase='idle';e.magic={kind:'test'};await assert.rejects(r.action('go-live',{contextConfirmed:true}),/entertainmentmoment/);e.magic=null;
 let returnedToShow=0;e.showRuntime={manual:true,returnToShow:()=>returnedToShow++};await r.action('go-live',{contextConfirmed:true});assert.equal(r.call.phase,'live');assert.equal(returnedToShow,1);assert.equal(r.call.activeContext.callName,'Sofie');await assert.rejects(r.action('context',{context:{callName:'Ander kind'}}),/gastkaart staat vast/);assert.equal(r.call.activeContext.callName,'Sofie');assert.equal(r.call.characterId,'milo');assert.equal(e.director.scene,'call');assert.equal(e.camera,'host');assert(e.director.callHold);assert(f.calls.find(c=>c.method==='stopSpeech'));assert(r.stagePatch({show:{}}).liveCall.simulated);
 await r.action('mute',{muted:true});assert(r.call.muted);await r.action('finish');assert.equal(r.call.phase,'returning');assert(r.drawHeld);assert.equal(e.director.scene,'entertainment');assert.equal(e.director.sceneAge,12);assert.equal(e.camera,'wide');assert.equal(e.director.callHold,false);
 await assert.rejects(r.action('resume-draw'),/belstap/);await assert.rejects(r.action('confirm-return',{confirmed:true}),/bevestiging/);await completeReturn(f);assert.equal(r.call.phase,'completed');assert.equal(r.drawHeld,false);assert.equal(e.runner.autoDraw,false);assert.deepEqual(e.game.state.drawn,original);assert.equal(f.realRequests.length,0);assert.equal(r.connection.actions.length,0);
 await prepare(f,'Daan');assert.equal(r.call.context.callName,'Daan');assert.deepEqual(r.call.context.confirmedFacts,[]);assert.equal(r.call.activeContext,undefined);r.dispose();
}

// Every interrupted simulation remains held until explicit checked return/resume.
for(const outcome of ['declined','missed','mic-denied','disconnected']){
 const f=fixture();await prepare(f);await f.runtime.action('ring');await f.runtime.action('simulate',{outcome});assert.equal(f.runtime.call.phase,'returning',outcome);assert(f.runtime.drawHeld,outcome);if(outcome==='mic-denied')assert.match(f.runtime.call.reason,/microfoontoestemming/);await assert.rejects(f.runtime.action('resume-draw'),/belstap/);await completeReturn(f,{manual:true});assert.equal(f.runtime.drawHeld,false);assert.equal(f.realRequests.length,0);f.runtime.dispose();
}

// Preparing cannot cut short the current number, claim window, or result.
for(const kind of ['pending','director-pending','draw-flow','window','result']){
 const f=fixture();if(kind==='pending')f.engine.game.state.pending={number:8};if(kind==='director-pending')f.engine.director.pending={number:8};if(kind==='draw-flow')f.engine.director.flow={kind:'draw'};if(kind==='window')f.engine.game.state.window={status:'open'};if(kind==='result')f.engine.game.state.resultId='result-one';
 await assert.rejects(prepare(f),/lopende trekking/);assert.equal(f.runtime.call,null);assert.equal(f.engine.game.state.drawHold,undefined);assert.equal(f.engine.runner.autoDraw,true);f.runtime.dispose();
}

// A stop while output-window readiness is pending must never create a server call.
{
 const f=fixture({demo:false}),gate=deferred();f.engine.bridge.connect=()=>gate.promise;
 const pending=f.runtime.prepare(f.queue()[0].id,{callName:'Sophie'});const rejected=assert.rejects(pending,/geannuleerd/);await f.runtime.stop();gate.resolve();await rejected;assert.equal(f.runtime.connection.actions.length,0);assert.equal(f.runtime.drawHeld,false);assert.equal(f.runtime.getSnapshot().busy,false);assert.equal(f.engine.runner.autoDraw,false);f.runtime.dispose();
}

// If the server already acquired the hold while stop happened, cancel the new
// call, preserve its hold, and require the normal returning path.
{
 const gate=deferred(),entered=deferred();let f;
 class DelayedConnection extends SilentConnection {
  async action(name,body={}){this.actions.push({name,body});if(name==='prepare'){entered.resolve();await gate.promise;const e=f.engine,entry=e.game.participation.find(x=>x.id===body.entryId);this.call=makeLiveCall(e.game,entry,{clientId:e.clientId,outputId:e.bridge.id,character:CHARACTERS.milo,presenter:CHARACTERS.milo,context:body.context,maxSeconds:90});e.game.state.drawHold={id:this.call.id,callId:this.call.id};this.options.onChange(this.call);return {game:e.game,call:this.call};}if(name==='cancel'){transitionLiveCall(this.call,'cancel','host');this.options.onChange(this.call);return {game:f.engine.game,call:this.call};}throw Error('Unexpected action: '+name);}
 }
 f=fixture({demo:false,Connection:DelayedConnection});const pending=f.runtime.prepare(f.queue()[0].id,{callName:'Sophie'}),rejected=assert.rejects(pending,/geannuleerd/);await entered.promise;await f.runtime.stop();gate.resolve();await rejected;assert.deepEqual(f.runtime.connection.actions.map(a=>a.name),['prepare','cancel']);assert.equal(f.runtime.call.phase,'returning');assert(f.runtime.drawHeld);assert.equal(f.runtime.getSnapshot().busy,false);f.runtime.dispose();
}

// Authoritative server snapshots are refreshed after prepare/resume. This mock
// does not instantiate media or make provider/network requests.
{
 let f,refreshes=0;
 class ImmediateConnection extends SilentConnection {
  async action(name,body={}){this.actions.push({name,body});if(name==='prepare'){const e=f.engine,entry=e.game.participation[0];this.call=makeLiveCall(e.game,entry,{clientId:e.clientId,outputId:e.bridge.id,character:CHARACTERS.milo,presenter:CHARACTERS.milo,context:body.context,maxSeconds:90});e.game.state.drawHold={id:this.call.id,callId:this.call.id};}else{transitionLiveCall(this.call,name,'host',body);if(name==='resume-draw')f.engine.game.state.drawHold=null;}this.options.onChange(this.call);return {game:f.engine.game,call:this.call};}
 }
 f=fixture({demo:false,Connection:ImmediateConnection});f.engine.fetchLiveCallGame=async id=>{assert.equal(id,f.engine.game.id);refreshes++;return {game:f.engine.game};};await f.runtime.prepare(f.queue()[0].id,{callName:'Sophie'});assert.equal(refreshes,1);await f.runtime.action('cancel');await f.runtime.action('confirm-return',{confirmed:true,manual:true,note:'Ouder is terug bij YouTube; beeld en geluid gecontroleerd.'});await f.runtime.action('resume-draw');assert.equal(refreshes,2);assert.equal(f.runtime.drawHeld,false);assert.equal(f.engine.runner.autoDraw,false);assert(f.notices[0].includes('trekking is vrijgegeven'));f.runtime.dispose();
}

// A recovered server call from another production cannot take over the
// currently open studio. The operator must explicitly open its own show first.
{
 const f=fixture({demo:false}),e=f.engine,other={...structuredClone(e.game),id:'other-show',brandId:'vlampie'},entry=other.participation[0];
 const call=makeLiveCall(other,entry,{clientId:e.clientId,outputId:e.bridge.id,character:CHARACTERS.vlampie,presenter:CHARACTERS.vlampie,context:{callName:'Sophie'},maxSeconds:90});call.phase='live';f.runtime.connection.call=call;f.runtime.onCall(call);
 assert(f.runtime.getSnapshot().mismatchedGame);assert.equal(f.runtime.onAir,false);assert.equal(e.director.scene,'entertainment');assert.equal(e.speakerId,'milo');const base={hostId:'milo'};assert.equal(f.runtime.stagePatch(base),base);await assert.rejects(f.runtime.action('finish'),/Open eerst de show/);assert.equal(f.runtime.connection.actions.length,0);
 let recovered=0;e.recoverCallGame=async id=>{assert.equal(id,other.id);recovered++;e.game=other;e.hostId='vlampie';};await f.runtime.openActiveShow();assert.equal(recovered,1);assert.equal(f.runtime.getSnapshot().mismatchedGame,false);assert(f.runtime.onAir);assert.equal(e.speakerId,'vlampie');assert.equal(e.director.scene,'call');f.runtime.dispose();
}

// Every presenter uses the same controller and receives only that guest's card.
for(const characterId of Object.keys(CHARACTERS)){
 const f=fixture();await prepare(f,'Daan',characterId);assert.equal(f.runtime.call.characterId,characterId);assert.equal(f.runtime.call.context.callName,'Daan');assert.deepEqual(f.runtime.call.context.confirmedFacts,[]);assert.equal(f.realRequests.length,0);f.runtime.dispose();
}

// Joining the live monitor is deduplicated, with explicit autoplay recovery.
{
 const connected=deferred();let starts=0,joins=0;
 class Media {constructor(options){this.options=options;}async disconnect(){}async connect(target){joins++;assert.equal(target,'live');await connected.promise;}async startAudio(){starts++;}dispose(){}}
 const f=fixture({Media}),a=f.runtime.connectLiveMonitor(),b=f.runtime.connectLiveMonitor();await turn();assert.equal(joins,1);connected.resolve();await Promise.all([a,b]);assert.equal(f.runtime.connectingLive,null);await f.runtime.startAudio();assert.equal(starts,1);f.runtime.dispose();
}

// A slow output startup must not block controller polling/tick or its timeout
// checks. Its eventual rejection is observed by the runtime.
{
 const f=fixture({demo:false}),gate=deferred();let outputTicks=0;f.engine.isOutput=true;f.engine.remoteStage={gameId:f.engine.game.id};f.runtime.lastGame=f.runtime.gameId;f.runtime.output={state:()=>({phase:'connecting'}),sync:()=>gate.promise,tick:()=>outputTicks++,dispose(){}};
 await f.runtime.tick();assert.equal(outputTicks,1);assert.equal(f.runtime.ticking,false);gate.resolve();await turn();f.runtime.dispose();
}

console.log('✓ Live-call runtime: actual nine-step demo, confirmed context, all failure holds, explicit return, no provider calls, protected prepare/cancel races, refreshed snapshots, all presenter identities, other-show recovery and nonblocking output');
