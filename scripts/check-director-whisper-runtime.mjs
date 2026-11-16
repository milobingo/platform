import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {DirectorWhisperRuntime} from '../frontend/director-whisper-runtime.js';
import {createOpenAIVoice} from '../public/openai-voice.js';
import {OutputBridge} from '../public/output-bridge.js';

globalThis.crypto??=webcrypto;
const pending=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const prepared=(body,extra={})=>({status:'prepared',requestId:body.requestId,characterId:body.characterId,gameId:body.gameId,contextCallId:null,reply:'We nemen rustig de tijd voor een gezellig moment.',simulated:false,...extra});
const liveCall=()=>({id:'call-one',gameId:'show-one',phase:'live',characterId:'milo',entryId:'entry-one',profileId:'child-one',accountId:'family-one',context:{callName:'Sophie',pronunciation:'Soo-fie'}});
function rig(options={}){
 let sequence=0;const spoken=[],requests=[];
 const e={isOutput:false,demo:false,production:'milo',hostId:'milo',speakerId:'stella',characterRevision:1,clientId:'director-one',characters:[{id:'milo',name:'Milo'},{id:'stella',name:'Stella'},{id:'vlampie',name:'Vlampie'}],game:{id:'show-one',state:{epoch:'epoch-one',roundIndex:0,goalIndex:0,drawn:[1,22],pending:null,window:null,resultId:null,paused:false,drawHold:null}},director:{pending:null,flow:null,scene:'host',paused:false,narrationHold:false,callHold:false},runner:{phase:'drawing'},voicePhase:'idle',speechToken:0,currentSpeech:null,caption:'',voiceText:'Bestaand regieveld',log:[],showCues:{active:null,holding:false},showRuntime:{holding:false},calls:{held:false},liveCalls:{call:null,onAir:false,drawHeld:false},magic:null,
  emit(){this.whispers?.validateContext();this.emits=(this.emits||0)+1;},
  stage(){return {hostId:this.hostId,caption:this.caption,drawn:this.game.state.drawn};},
  stopSpeech({replacement=false,whisperInternal=false}={}){if(!whisperInternal)this.whispers.speechStopped({replacement});this.speechToken++;this.currentSpeech=null;this.voicePhase='idle';this.caption='';this.director.narrationHold=false;},
  speak(text,id,mode,planned){this.stopSpeech({replacement:true});spoken.push({text,id,mode,planned});this.currentSpeech={text,id,mode,planned};this.caption=text;this.voicePhase='loading';this.director.narrationHold=true;},
  voice:{resume:async()=>{e.voicePhase='playing';}}
 };
 e.bridge={state:()=>({snapshot:e.stage()})};
 const prepare=options.prepare||(async body=>{requests.push(body);return prepared(body);});
 const live=options.live||(async body=>{requests.push(body);return {status:'accepted',requestId:body.requestId,characterId:body.characterId,gameId:body.gameId,callId:body.callId,acceptedAt:123,simulated:false};});
 const w=e.whispers=new DirectorWhisperRuntime(e,{prepare,live,uuid:()=>`request-${++sequence}`,now:()=>123});
 return {e,w,spoken,requests};
}

test('a normal hint stays a private proposal until explicit approval and waits for the current utterance',async()=>{
 const {e,w,spoken,requests}=rig();
 e.currentSpeech={text:'De lopende uitspraak.'};e.voicePhase='playing';
 await w.send('Neem het tempo even terug en stel een makkelijke vraag.');
 assert.equal(requests[0].characterId,'milo','target the presenter, not a random previous speaker');
 assert.equal(w.snapshot().phase,'prepared');assert.equal(w.snapshot().canApply,true);
 for(let i=0;i<4;i++)w.tick();assert.equal(spoken.length,0);
 w.apply();w.tick();assert.equal(w.snapshot().phase,'queued');assert.match(w.snapshot().waitReason,/huidige uitspraak/);assert.equal(spoken.length,0);
 e.currentSpeech=null;e.voicePhase='idle';w.tick();
 assert.deepEqual(spoken,[{text:w.snapshot().reply,id:'milo',mode:'ai',planned:false}]);assert.equal(e.director.narrationHold,true);
 e.voicePhase='playing';w.tick();assert.equal(w.snapshot().phase,'speaking');
 e.voicePhase='idle';e.currentSpeech=null;e.director.narrationHold=false;w.speechEnded();assert.equal(w.snapshot().phase,'completed');w.tick();assert.equal(spoken.length,1);
});

test('raw instructions never enter captions, text controls, logs or the output bridge; echoed hints are rejected',async()=>{
 const hint='VRAAG GEEN PERSOONLIJKE GEGEVENS AAN DE GAST.';
 const {e,w,spoken}=rig();await w.send(hint);w.tick();
 assert.equal(spoken.length,0);assert.equal(e.voiceText,'Bestaand regieveld');assert.equal(e.caption,'');assert.deepEqual(e.log,[]);
 assert(!JSON.stringify(e.stage()).includes(hint));assert(!JSON.stringify(e.bridge.state()).includes(hint));assert.equal(w.snapshot().instruction,hint);
 const bad=rig({prepare:async body=>prepared(body,{reply:`De geheime regie zegt: ${hint}`})});await assert.rejects(bad.w.send(hint),/herhaalde de privéaanwijzing/);assert.equal(bad.w.snapshot().canApply,false);assert.equal(bad.spoken.length,0);
});

test('short and Unicode-normalized instruction echoes never become an approvable proposal',async()=>{
 for(const [hint,reply] of [['Vraag iets','"VRAAG iets!"'],['Zeg hé','Zeg he.'],['Vraag iets','ＶＲＡＡＧ ＩＥＴＳ！'],['Een zeer vertrouwelijke regieaanwijzing','Vooraf: een zeer vertrouwelijke regieaanwijzing.']]){
  const {w,spoken}=rig({prepare:async body=>prepared(body,{reply})});
  await assert.rejects(w.send(hint),/herhaalde de privéaanwijzing/);assert.equal(w.snapshot().canApply,false);assert.equal(spoken.length,0);
 }
});

test('safe playback waits for draws, claim windows, results, cues and pauses without changing server state',async()=>{
 const cases=[
  ['pending draw',e=>e.game.state.pending={number:44},/nummertrekking/],
  ['director draw',e=>e.director.flow={kind:'draw'},/nummertrekking/],
  ['claim window',e=>e.game.state.window={status:'open',expiresAt:987},/meldvenster/],
  ['result',e=>e.game.state.resultId='result-one',/bingocontrole/],
  ['magic',e=>e.magic={id:'star-hat'},/magiemoment/],
  ['cue',e=>e.showCues.holding=true,/bewegings-/],
  ['manual',e=>e.showRuntime.holding=true,/terug in de show/],
  ['sync',e=>e.runner.phase='sync',/showstand/],
  ['paused',e=>e.director.paused=true,/hervat/],
  ['draw hold',e=>e.game.state.drawHold={callId:'held'},/terugkeer/]
 ];
 for(const [label,change,message] of cases){
  const {e,w,spoken}=rig();await w.send('Maak ruimte voor een kort gezellig moment.');change(e);const before=structuredClone(e.game.state);w.apply();w.tick();assert.equal(spoken.length,0,label);assert.match(w.snapshot().waitReason,message,label);assert.deepEqual(e.game.state,before,label);
 }
});

test('backstage entertainment is allowed while the persistent draw hold remains intact',async()=>{
 const {e,w,spoken}=rig({prepare:async body=>prepared(body,{contextCallId:'call-one'})});
 e.liveCalls.call={...liveCall(),phase:'backstage'};e.liveCalls.drawHeld=true;e.game.state.drawHold={id:'call-one',reason:'private pre-call'};
 const before=structuredClone(e.game.state);await w.send('Vertel iets gezelligs terwijl de regie voorbereidt.');assert.equal(w.snapshot().target.callName,'');w.apply();w.tick();assert.equal(spoken.length,1);assert.deepEqual(e.game.state,before);assert.equal(e.liveCalls.drawHeld,true);
});

test('a pending go-live command cannot race an approved backstage reply into the studio',async()=>{
 const {e,w,spoken}=rig({prepare:async body=>prepared(body,{contextCallId:'call-one'})});
 e.liveCalls.call={...liveCall(),phase:'staged'};e.liveCalls.drawHeld=true;e.game.state.drawHold={id:'call-one'};
 await w.send('Een gezellig verhaal terwijl het belmoment wordt voorbereid.');w.apply();e.liveCalls.busy=true;const before=structuredClone(e.game.state);w.tick();
 assert.equal(spoken.length,0);assert.equal(w.snapshot().phase,'queued');assert.match(w.snapshot().waitReason,/lopende belactie/);assert.deepEqual(e.game.state,before);
 e.liveCalls.call.phase='live';e.liveCalls.busy=false;e.emit();w.tick();assert.equal(w.snapshot().phase,'cancelled');assert.equal(spoken.length,0,'live acknowledgement invalidates the normal-show proposal before playback');
 const backstage=rig({prepare:async body=>prepared(body,{contextCallId:'call-one'})});backstage.e.liveCalls.call={...liveCall(),phase:'backstage'};backstage.e.liveCalls.busy=true;backstage.e.liveCalls.drawHeld=true;backstage.e.game.state.drawHold={id:'call-one'};
 await backstage.w.send('Een tweede kort verhaal voor het publiek.');backstage.w.apply();backstage.w.tick();assert.equal(backstage.spoken.length,0);backstage.e.liveCalls.busy=false;backstage.w.tick();assert.equal(backstage.spoken.length,1,'confirmed backstage phase may entertain without releasing drawing');assert.deepEqual(backstage.e.game.state.drawHold,{id:'call-one'});
});

test('show, production, host, caller, guest-name and goal changes invalidate prepared proposals',async()=>{
 const changes=[e=>e.game.id='show-two',e=>e.production='vlampie',e=>e.hostId='stella',e=>e.characterRevision++,e=>e.game.state.epoch='epoch-two',e=>e.game.state.goalIndex++,e=>e.liveCalls.call={...liveCall(),phase:'backstage'}];
 for(const change of changes){const {e,w,spoken}=rig();await w.send('Neem rustig de tijd voor het publiek.');change(e);e.emit();assert.equal(w.snapshot().phase,'cancelled');assert.equal(w.snapshot().instruction,'');assert.equal(w.snapshot().reply,'');w.tick();assert.equal(spoken.length,0);}
 for(const change of [e=>e.liveCalls.call.profileId='child-two',e=>e.liveCalls.call.context.callName='Noor']){
  const {e,w}=rig({prepare:async body=>prepared(body,{contextCallId:'call-one'})});e.liveCalls.call={...liveCall(),phase:'backstage'};await w.send('Een kort verhaal voor het publiek.');change(e);e.emit();assert.equal(w.snapshot().phase,'cancelled');assert.equal(w.snapshot().instruction,'');
 }
});

test('cancel, context changes and disposal ignore late provider results',async()=>{
 for(const operation of [(e,w)=>w.cancel(),(e,w)=>{e.hostId='stella';e.emit();},(e,w)=>w.dispose()]){
  const deferred=pending();let body,signal;const {e,w,spoken}=rig({prepare:(b,o)=>{body=b;signal=o.signal;return deferred.promise;}});const sending=w.send('Een momentje rust voor de volgende zin.');operation(e,w);assert.equal(signal.aborted,true);deferred.resolve(prepared(body));await sending;w.tick();assert.equal(spoken.length,0);assert.notEqual(w.snapshot().phase,'prepared');assert.equal(w.snapshot().reply,'');
 }
});

test('normal network recovery is manual, uses the same request ID and never automatically regenerates',async()=>{
 const requests=[];const {w,spoken}=rig({prepare:async body=>{requests.push(body);if(requests.length===1)throw new TypeError('Verbinding verbroken');return prepared(body);}});
 await assert.rejects(w.send('Een vriendelijk welkom voor iedereen.'),/Verbinding/);assert.equal(w.snapshot().phase,'failed');assert.equal(w.snapshot().canRetry,true);w.tick();assert.equal(requests.length,1);
 await w.retry();assert.equal(requests.length,2);assert.equal(requests[0].requestId,requests[1].requestId);assert.equal(w.snapshot().phase,'prepared');assert.equal(spoken.length,0);
});

test('a live whisper uses the pinned existing call and confirms receipt only, never local speech',async()=>{
 const {e,w,spoken,requests}=rig();e.liveCalls.call=liveCall();e.liveCalls.onAir=true;
 await w.send('Rond het gesprek rustig af met een zwaai.');
 assert.deepEqual(requests[0],{role:'host',clientId:'director-one',gameId:'show-one',callId:'call-one',characterId:'milo',instruction:'Rond het gesprek rustig af met een zwaai.',requestId:'request-1'});
 assert.equal(w.snapshot().phase,'accepted');assert.match(w.snapshot().message,/nog niet.*opgevolgd/);assert.equal(w.snapshot().canApply,false);assert.equal(w.snapshot().canRetry,false);w.tick();assert.equal(spoken.length,0);assert.equal(e.caption,'');
});

test('live timeouts and rejected appends cannot be retried automatically; cancellation cannot retract an append',async()=>{
 for(const [error,phase] of [[Object.assign(new Error('Afgewezen'),{code:'whisper_rejected',uncertain:false,retryable:false}),'failed'],[new TypeError('Netwerk weg'),'uncertain']]){
  let count=0;const {e,w}=rig({live:async()=>{count++;throw error;}});e.liveCalls.call=liveCall();await assert.rejects(w.send('Stel de gast nog een makkelijke vraag.'));assert.equal(w.snapshot().phase,phase);assert.equal(w.snapshot().canRetry,false);await assert.rejects(w.retry());w.tick();assert.equal(count,1);
 }
 const deferred=pending();let body;const {e,w}=rig({live:b=>{body=b;return deferred.promise;}});e.liveCalls.call=liveCall();const sending=w.send('Rond het gesprek met een zwaai af.');w.cancel();assert.equal(w.snapshot().phase,'uncertain');assert.match(w.snapshot().message,/niet worden teruggehaald/);deferred.resolve({status:'accepted',...body,acceptedAt:123,simulated:false});await sending;assert.equal(w.snapshot().phase,'uncertain');await assert.rejects(w.send('Rond het gesprek met een zwaai af.'),/onzeker/);w.cancel();assert.equal(w.snapshot().phase,'cancelled');
});

test('a mismatched show or live ACK cannot be presented as delivered',async()=>{
 const first=rig({prepare:async b=>prepared(b,{gameId:'wrong-show'})});await assert.rejects(first.w.send('Maak het tempo iets rustiger.'),/hoort niet/);assert.equal(first.w.snapshot().phase,'failed');assert.equal(first.spoken.length,0);
 const second=rig({live:async b=>({status:'accepted',...b,callId:'wrong-call',acceptedAt:123,simulated:false})});second.e.liveCalls.call=liveCall();await assert.rejects(second.w.send('Zwaai vriendelijk naar de gast.'),/niet bevestigd/);assert.equal(second.w.snapshot().phase,'uncertain');
});

test('demo proposals and live receipts remain local and silent with explicit simulation labels',async()=>{
 let network=0;const {e,w,spoken}=rig({prepare:()=>{network++;throw Error('No network allowed');},live:()=>{network++;throw Error('No network allowed');}});e.demo=true;
 await w.send('Neem rustig de tijd voor iedereen.');assert.equal(w.snapshot().phase,'prepared');assert.equal(w.snapshot().simulated,true);assert.match(w.snapshot().message,/Simulatie/);w.tick();assert.equal(spoken.length,0);w.apply();w.tick();assert.equal(w.snapshot().phase,'completed');assert.match(w.snapshot().message,/geen audio, caption of uitzending/);assert.equal(e.caption,'');
 e.liveCalls.call=liveCall();e.liveCalls.onAir=true;await w.send('Rond het voorbeeldgesprek rustig af.');assert.equal(w.snapshot().phase,'accepted');assert.equal(w.snapshot().simulated,true);assert.match(w.snapshot().message,/Geen verbinding of audio/);assert.equal(network,0);assert.equal(spoken.length,0);
});

test('autoplay readiness resumes only owned speech; stopping or replacing it cannot complete a stale reply',async()=>{
 const {e,w,spoken}=rig();await w.send('Vertel een vriendelijk verhaal voor iedereen.');w.apply();w.tick();e.voicePhase='ready';w.tick();assert.equal(w.snapshot().canResume,true);await w.resume();assert.equal(w.snapshot().phase,'speaking');assert.equal(spoken.length,1);
 e.stopSpeech();assert.equal(w.snapshot().phase,'cancelled');assert.equal(w.snapshot().instruction,'');w.speechEnded();assert.equal(w.snapshot().phase,'cancelled');
 await w.send('Een volgende reactie ter controle.');e.stopSpeech();assert.equal(w.snapshot().phase,'cancelled');
 await w.send('Bewaar dit voorstel terwijl een andere zin klinkt.');e.speak('Een gewone zin.','stella','ai',false);assert.equal(w.snapshot().phase,'prepared');assert.equal(w.snapshot().canApply,true);
});

test('a ready reaction rechecks every current priority before permission or global voice resume',async()=>{
 const changes=[
  e=>e.game.state.pending={number:44},e=>e.director.pending=44,e=>e.director.flow={kind:'draw'},
  e=>e.game.state.window={status:'open'},e=>e.game.state.resultId='result-one',e=>e.director.scene='checking',
  e=>e.game.state.paused=true,e=>e.director.paused=true,e=>e.showCues.holding=true,e=>e.magic={id:'star-hat'},
  e=>e.showRuntime.holding=true,e=>e.calls.held=true,e=>e.runner.phase='sync',e=>e.liveCalls.busy=true,
  e=>e.game.state.drawHold={callId:'held'},e=>e.liveCalls.onAir=true,e=>e.director.callHold=true,
 ];
 for(const change of changes){
  const {e,w,spoken}=rig();let resumes=0;e.voice.resume=async()=>{resumes++;e.voicePhase='playing';};e.voice.pause=async()=>{};
  await w.send('Een goedgekeurde reactie die op audiotoestemming wacht.');w.apply();w.tick();e.voicePhase='ready';w.tick();
  assert.equal(w.snapshot().canResume,true);const state=structuredClone(e.game.state),director=structuredClone(e.director);
  change(e);const blocked=structuredClone(e.game.state);assert.equal(w.snapshot().canResume,false);
  await assert.rejects(w.resume(),/Wacht|Zet|live gesprek/);w.tick();assert.equal(w.snapshot().phase,'queued');assert.equal(resumes,0);assert.equal(spoken.length,1);assert.deepEqual(e.game.state,blocked);
  e.game.state=state;e.director=director;e.showCues={active:null,holding:false};e.showRuntime.holding=false;e.calls.held=false;e.runner.phase='drawing';e.liveCalls.busy=false;e.liveCalls.onAir=false;e.magic=null;
  assert.equal(w.snapshot().canResume,true);await w.resume();assert.equal(resumes,1);assert.equal(w.snapshot().phase,'speaking');assert.equal(spoken.length,1);
 }
});

test('a higher-priority window pauses an owned reaction without replaying or releasing the game',async()=>{
 const {e,w,spoken}=rig();let pauses=0;e.voice.pause=async()=>{pauses++;e.voicePhase='paused';};
 await w.send('Een korte reactie voor het publiek.');w.apply();w.tick();e.voicePhase='playing';w.tick();
 e.game.state.window={status:'open',endsAt:12345};const blocked=structuredClone(e.game.state);w.tick();w.tick();
 assert.equal(pauses,1);assert.equal(w.snapshot().phase,'queued');assert.match(w.snapshot().waitReason,/meldvenster/);assert.equal(w.snapshot().canResume,false);assert.deepEqual(e.game.state,blocked);
 e.game.state.window=null;w.tick();assert.equal(w.snapshot().canResume,true);assert.equal(e.voicePhase,'paused');
 await w.resume();assert.equal(w.snapshot().phase,'speaking');assert.equal(spoken.length,1);
});

test('actual audio controller defers decoded local and output audio when a later priority blocks playback',async()=>{
 for(const output of [false,true]){
  const decoded=pending(),finished=pending();let allowed=true,starts=0,resumes=0,requests=0;
  class Context{
   constructor(){this.state='running';this.destination={};this.currentTime=0;}
   async resume(){this.state='running';}async suspend(){this.state='suspended';}
   createBufferSource(){return {connect(){},disconnect(){},stop(){},start(){starts++;}};}
   async decodeAudioData(){return decoded.promise;}
  }
  const remote={play(_clip,_text,_duration,onStart){starts++;onStart();return finished.promise;},resume(){resumes++;},pause(){},stop(){}};
  const voice=createOpenAIVoice({Context,canPlay:()=>allowed,getRemote:()=>output?remote:null,fetcher:async()=>{requests++;return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'audio/wav'}});}});
  const speaking=voice.speak('Een gecontroleerde reactie.');await Promise.resolve();allowed=false;decoded.resolve({duration:1});await speaking;
  assert.equal(voice.phase,'ready');assert.equal(starts,0);await voice.resume();assert.equal(starts,0);assert.equal(resumes,0);
  allowed=true;await voice.resume();assert.equal(starts,1);assert.equal(requests,1);assert.equal(voice.phase,'playing');
  allowed=false;await voice.resume();assert.equal(resumes,0);assert.equal(starts,1);voice.stop();finished.resolve();
 }
});

test('actual paired output bridges recheck a later priority at ready ACK and direct resume before source.start',async()=>{
 let allowed=true,starts=0;const packets=[],phases=[];
 const producer=Object.assign(Object.create(OutputBridge.prototype),{latest:{output:{audioReady:true,until:Date.now()+60000}},offset:0,routing:true,sendLocal(){phases.push(this.command?.phase);if(this.command)packets.push(structuredClone(this.command));}});
 class Context{constructor(){this.state='running';this.destination={};this.currentTime=0;}async resume(){this.state='running';}async decodeAudioData(){return {duration:1};}createBufferSource(){return {connect(){},disconnect(){},stop(){},start(){starts++;}};}}
 const voice=createOpenAIVoice({Context,canPlay:()=>allowed,getRemote:()=>producer.remote,fetcher:async()=>new Response(new Uint8Array([1]),{headers:{'content-type':'audio/wav','x-vlampie-clip':'a'.repeat(64)}})});
 const savedRouter=networkRouter;networkRouter=async url=>{assert.match(url,/^\/api\/openai\/clips\/[a-f0-9]{64}$/);return new Response(new Uint8Array([1]));};
 const operation=voice.speak('Een gecontroleerde reactie.');
 try{
  await new Promise(resolve=>setImmediate(resolve));assert.equal(producer.command.phase,'prepare');
  const output=Object.assign(Object.create(OutputBridge.prototype),{gain:{},context:new Context(),active:true,audioReady:true,receive(){},channel:{postMessage({ack}){producer.acceptAck(ack);}}});
  allowed=false;await output.applyVoice(packets.shift());
  assert.equal(producer.command.phase,'pause');assert.equal(voice.phase,'ready');assert.equal(starts,0);assert(!phases.includes('play'));
  producer.remote.resume();assert.equal(producer.command.phase,'pause');assert.equal(starts,0);assert(!phases.includes('play'));
  allowed=true;await voice.resume();assert.equal(producer.command.phase,'play');
  await output.applyVoice(packets.at(-1));assert.equal(starts,1);assert.equal(voice.phase,'playing');
  output.source.onended();await operation;assert.equal(voice.phase,'idle');
 }finally{voice.stop();producer.cancelVoice();networkRouter=savedRouter;await operation;}
});

test('output windows cannot send hints, and Vlampie remains within his own production',async()=>{
 const {e,w}=rig();e.isOutput=true;await assert.rejects(w.send('Een korte aanwijzing.'),/alleen vanuit de regie/);e.isOutput=false;e.production='vlampie';await assert.rejects(w.send('Een korte aanwijzing.'),/eigen productie/);e.hostId='vlampie';await w.send('Een rustig welkom voor iedereen.');assert.equal(w.snapshot().target.characterId,'vlampie');
});

// Exercise the actual engine lifecycle without any audio provider or remote API.
const intervals=globalThis.setInterval,clearIntervals=globalThis.clearInterval;
globalThis.setInterval=()=>0;globalThis.clearInterval=()=>{};
globalThis.location={origin:'https://studio.example',pathname:'/'};
globalThis.localStorage={getItem:()=>null,setItem(){}};
globalThis.document={body:{dataset:{brand:'milo'},classList:{contains:()=>false}}};
globalThis.BroadcastChannel=class{postMessage(){}close(){}};
globalThis.speechSynthesis={getVoices:()=>[],cancel(){},pause(){},resume(){}};
let networkRouter;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
 if(url==='/api/bingo/games')return Response.json({games:[]});
 if(url==='/api/auth/session')return Response.json({authenticated:true,role:'regie',localAvailable:true});
 if(url==='/api/characters')return Response.json({characters:Object.values((await import('../server/characters.js')).CHARACTERS),revision:0});
 if(url==='/api/openai/status')return Response.json({configured:false});
 if(networkRouter)return networkRouter(url,options);
 throw Error('Unexpected request '+url);
};
const {StudioEngine}=await import('../frontend/engine.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const noAudio={duck(){},pause(){},resume(){},stop(){},cue(){},dispose(){}};
after(()=>{globalThis.setInterval=intervals;globalThis.clearInterval=clearIntervals;globalThis.fetch=originalFetch;});

test('actual engine snapshot is private and a failed approved response cannot replay on resume or a host switch',async()=>{
 const e=new StudioEngine();await flush();try{
  e.audio=noAudio;e.bridge.showAudio=noAudio;e.demo=false;e.game.status='draft';e.apiStatus={configured:true};e.director.paused=false;
  const spoken=[];e.voice={stop(){},resume(){},pause(){},speak(text,speed,context){spoken.push({text,context});},dispose(){}};
  e.whispers.prepare=async body=>prepared(body);
  const hint='Spreek even rustig, de regie controleert een verbinding.';
  await e.whispers.send(hint);assert.equal(e.snapshot().whisper.instruction,hint);assert(!JSON.stringify(e.stage()).includes(hint));assert(!JSON.stringify(e.bridge.state()).includes(hint));assert(!JSON.stringify(e.game).includes(hint));assert(!JSON.stringify(e.log).includes(hint));
  e.whispers.apply();e.whispers.tick();assert.equal(spoken.length,1);assert.equal(e.director.narrationHold,true);assert.notEqual(e.caption,hint);
  e.speechFailed('Test: audio kon niet starten.');assert.equal(e.whispers.snapshot().phase,'failed');assert.equal(e.failedSpeech,null);assert.equal(e.runner.voiceFailed,false);
  e.setHost('stella');await e.pause(false);assert.equal(spoken.length,1,'resume must not repeat an old privately prepared response');assert.equal(e.whispers.snapshot().instruction,'');
 }finally{e.dispose();}
});

test('default live transport preserves definitive rejection flags from the server',async()=>{
 const e=new StudioEngine();await flush();try{
  e.demo=false;e.liveCalls={call:{...liveCall(),gameId:e.game.id},onAir:true,dispose(){},stagePatch:s=>s};
  networkRouter=async(url,options)=>{assert.equal(url,'/api/live-calls/whisper');assert.equal(options.headers['X-Vlampie-Call'],'1');return Response.json({error:'De actieve sessie wees deze aanwijzing af.',code:'whisper_rejected',uncertain:false,retryable:false},{status:502});};
  await assert.rejects(e.whispers.send('Rond het gesprek rustig af.'),/wees deze aanwijzing af/);assert.equal(e.whispers.snapshot().phase,'failed');assert.equal(e.whispers.snapshot().canRetry,false);
 }finally{networkRouter=null;e.dispose();}
});

test('ordinary director cancellation preserves private proposals and waiting replies but stops owned playback',async()=>{
 const e=new StudioEngine();await flush();try{
  e.audio=noAudio;e.bridge.showAudio=noAudio;e.demo=false;e.game.status='draft';e.apiStatus={configured:true};e.director.paused=false;
  const spoken=[];e.voice={stop(){},resume(){},pause(){},speak(text){spoken.push(text);},dispose(){}};e.whispers.prepare=async body=>prepared(body);
  await e.whispers.send('Neem even rustig de tijd na de uitslag.');e.director.cancel(false);assert.equal(e.whispers.snapshot().phase,'prepared');
  e.game.state.window={status:'open',endsAt:9876543210};e.whispers.apply();e.whispers.tick();assert.equal(spoken.length,0);const before=structuredClone(e.game.state);
  e.director.cancel(false);assert.equal(e.whispers.snapshot().phase,'queued','a routine draw/result transition must retain the approved reply');assert.deepEqual(e.game.state,before);e.whispers.tick();assert.equal(spoken.length,0);
  e.game.state.window=null;e.whispers.tick();assert.equal(spoken.length,1);e.director.cancel(false);assert.equal(e.whispers.snapshot().phase,'cancelled','a routine cancellation must stop audio already owned by the private reaction');assert.equal(e.whispers.snapshot().reply,'');assert.equal(e.currentSpeech,null);assert.equal(e.voicePhase,'idle');
 }finally{e.dispose();}
});
