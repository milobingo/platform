import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {makeGame,activateBlock,reserveBall,commitBall} from '../server/bingo-model.js';
import {handleBingo} from '../server/bingo.js';
import {BingoStore} from '../server/bingo-store.js';
import {createSqliteDatabase} from '../server/node-storage.js';

const intervals=globalThis.setInterval,clearIntervals=globalThis.clearInterval;
globalThis.crypto??=webcrypto;
globalThis.setInterval=()=>0;globalThis.clearInterval=()=>{};
globalThis.location={origin:'https://studio.example',pathname:'/'};
const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
globalThis.document={body:{dataset:{brand:'milo'},classList:{contains:()=>false}}};
globalThis.BroadcastChannel=class{postMessage(){}close(){}};
const utterances=[];
globalThis.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
globalThis.speechSynthesis={getVoices:()=>[{lang:'nl-NL'}],speak:u=>{utterances.push(u);u.onstart?.();},cancel(){},pause(){},resume(){}};
let router;
globalThis.fetch=async(url,options={})=>{
 if(url==='/api/bingo/games'&&(!options.method||options.method==='GET'))return Response.json({games:[]});
 if(url==='/api/characters')return Response.json({characters:Object.values((await import('../server/characters.js')).CHARACTERS),revision:0});
 if(url==='/api/openai/status')return Response.json({configured:false});
 if(router)return router(url,options);
 throw Error('Unexpected request '+url);
};
const {StudioEngine}=await import('../frontend/engine.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const hostCopy=g=>{const h=structuredClone(g);delete h.state.deck;return h;};
const noAudio={unlock:async()=>true,duck(){},pause(){},resume(){},stop(){},cue(){},dispose(){},setMuted(){},setLevels(){}};
async function rig({live=false,goal=0}={}){
 router=null;const e=new StudioEngine();await flush();e.audio=noAudio;e.bridge.showAudio=noAudio;e.director.configure({voice:false,sound:false,comments:false});
 const server=makeGame({brandId:'milo',title:'Integration show',timeZone:'Europe/Amsterdam',date:'2026-11-01T14:00',roundCount:2},'test',location.origin);server.revision=3;server.status='running';server.plan.cohostId='stella';
 const round=server.plan.blocks.findIndex(b=>b.type==='round');activateBlock(server,round,goal);
 e.game=live?hostCopy(server):server;e.demo=!live;e.loading=false;e.voiceMode=live?'ai':'browser';e.apiStatus={configured:live};e.syncGame();e.speakerId=e.hostId='milo';
 const calls=[];router=async(url,opts)=>{
  const action=url.split('/').at(-1),body=opts.body?JSON.parse(opts.body):{};calls.push({action,body});
  if(action===server.id&&(!opts.method||opts.method==='GET'))return Response.json({game:hostCopy(server)});
  let result;
  if(action==='activate')activateBlock(server,body.blockIndex,body.goalIndex);
  else if(action==='start'){server.status='running';server.state.phase='interlude';}
  else if(action==='reserve')result={pending:reserveBall(server)};
  else if(action==='commit')result={commit:commitBall(server,body.token)};
  else if(action==='pause')server.state.paused=!!body.paused;
  else if(action==='heartbeat')return Response.json({ok:true});
  else if(action==='finish-result'){const r=server.results.find(r=>r.id===body.resultId);result={applied:!r.acknowledged};r.acknowledged=true;server.state.resultId=null;server.state.phase='running';}
  else throw Error('Unexpected test action '+action);
  server.revision++;return Response.json({...result,...(action==='reserve'?{}:{game:hostCopy(server)})});
 };
 const tick=async(seconds=.5)=>{e.director.tick(seconds,{voiceBusy:e.voicePhase!=='idle'});e.runner.tick(seconds);await flush();};
 const until=async predicate=>{for(let i=0;i<250&&!predicate();i++)await tick();assert(predicate(),'show did not reach expected phase');};
 return {e,server,calls,round,tick,until};
}
after(()=>{globalThis.setInterval=intervals;globalThis.clearInterval=clearIntervals;});

test('stage restores cohost and all saved settings, mouth follows the active audio owner, magic uses renderer milliseconds',async()=>{
 const {e}=await rig();try{
 assert.equal(e.stage().cohostId,'stella');assert.equal(e.stage().characterSettings,e.characters);assert.equal(e.stage().mouth,undefined);
 e.voiceMode='ai';e.outputRouting=true;assert.equal(e.stage().mouth,undefined);
 e.isOutput=true;e.remoteStage={voiceMode:'ai',outputRouting:true,mouth:0};e.bridge.meter=()=>.64;assert.equal(e.stage().mouth,.64);
 e.isOutput=false;e.magic={id:'star-hat',elapsed:3.5};assert.equal(e.stage().magic.elapsed,3500);
 }finally{e.dispose();}
});
test('starting a real draft requires configured AI and never silently falls back to a browser voice',async()=>{
 const {e,server,calls}=await rig({live:true});try{
 server.status='draft';e.game=hostCopy(server);
 e.voiceMode='browser';await assert.rejects(()=>e.start(),/browserstem/);assert.equal(calls.some(call=>call.action==='start'),false);
 e.voiceMode='ai';e.apiStatus.configured=false;await assert.rejects(()=>e.start(),/centrale personagestem/);assert.equal(calls.some(call=>call.action==='start'),false);assert.equal(server.status,'draft');
 }finally{e.dispose();}
});
test('an explicit successful retry clears the failed-start error while preserving input and never starts the show',async()=>{
 const {e}=await rig({live:true}),db=createSqliteDatabase(':memory:'),store=new BingoStore(db),requests=[];
 try{
  const game=makeGame({brandId:'milo',title:'Opslag opnieuw proberen',date:'2027-01-01T18:00:00Z'},'retry-host',location.origin);await store.create(game);e.acceptGame(hostCopy(game),true);let failStorage=true;
  router=async(url,options)=>{requests.push({path:url,method:options.method});if(options.method==='PUT'&&failStorage)return Response.json({error:{code:'storage_failure',message:'De opslag is tijdelijk niet bereikbaar.'}},{status:500});return handleBingo(new Request(location.origin+url,{...options,headers:{...options.headers,Origin:location.origin}}),{DB:db,AUTH_IDENTITY:{user:'retry-host',email:'host@example.test',admin:true}});};
  e.editPlan(plan=>{plan.blocks.find(block=>block.type==='welcome').text='Deze eigen welkomsttekst moet behouden blijven.';});const input=structuredClone(e.game.plan);
  try{await e.start();assert.fail('The failed storage must reject the start');}catch(error){assert.match(error.message,/Niet opgeslagen/);e.fail(error.message);}
  assert.match(e.error,/Niet opgeslagen/);assert.equal(e.preparationAutosave.state.status,'error');assert.equal(e.dirty,true);assert.deepEqual(e.game.plan,input);assert.equal(e.working,false);
  failStorage=false;await e.retryPreparation();
  assert.equal(e.error,'');assert.equal(e.preparationAutosave.state.status,'saved');assert.equal(e.dirty,false);assert.equal(e.working,false);assert.deepEqual(e.game.plan,input);assert.deepEqual((await store.game(game.id)).data.plan,input);assert.equal((await store.game(game.id)).data.status,'draft');assert.equal(requests.some(request=>request.path.endsWith('/start')),false);
 }finally{e.dispose();await db.close();}
});
test('live recovery restores the current goal and keeps the server and local director paused until explicit resume',async()=>{
 const {e,server,calls,round}=await rig({live:true,goal:1});try{
 server.state.paused=true;e.game=hostCopy(server);e.hostId=e.speakerId='bruno';const epoch=server.state.epoch;
 await e.resumeRegie();await flush();await flush();
 assert.equal(e.hostId,'milo');assert.equal(e.speakerId,'milo');assert.equal(e.runner.index,round);assert.equal(e.runner.goal,1);assert.equal(server.state.paused,true);assert.equal(e.director.paused,true);assert.equal(server.state.epoch,epoch);
 assert.equal(calls.filter(c=>c.action==='activate'||c.action==='start'||c.action==='pause').length,0);assert.deepEqual(calls.map(call=>call.action),[server.id,'heartbeat']);
 }finally{e.dispose();}
});
test('real reserve and commit stay authoritative; pausing the spin cannot commit or duplicate a number',async()=>{
 const {e,server,calls,until,tick}=await rig({live:true});try{
 await e.start();await flush();await until(()=>e.runner.phase==='drawing');await e.draw();await until(()=>!!server.state.pending);
 assert.equal(server.state.drawn.length,0);await e.pause(true);for(let i=0;i<25;i++)await tick();assert.equal(server.state.drawn.length,0);
 await e.pause(false);await until(()=>server.state.drawn.length===1);await until(()=>!e.director.flow);
 assert.equal(calls.filter(c=>c.action==='reserve').length,1);assert.equal(calls.filter(c=>c.action==='commit').length,1);assert.deepEqual(e.director.drawn,server.state.drawn);assert.deepEqual(e.game.state.drawn,server.state.drawn);
 }finally{e.dispose();}
});
test('a delayed official reveal rechecks cancellation and every local hold before sending a commit',async t=>{
 for(const kind of ['pause','cancel','minigame','show-cue','window'])await t.test(kind,async()=>{
  const {e,calls}=await rig({live:true});try{
   e.game.settings.rulesProfile='milo-standard-v1';e.game.state.drawClock={intervalMs:15000,nextAt:Date.now()+30};e.director.flow={kind:'draw',index:0,steps:[{scene:'draw',duration:4.3}],age:0};
   const committing=e.director.requestCommit('not-yet-committed');
   if(kind==='pause')e.director.pause();
   if(kind==='cancel')e.director.cancel(false);
   if(kind==='minigame')e.showRuntime={holding:true,visual:value=>value,dispose(){}};
   if(kind==='show-cue')e.showCues.active={source:'manual',elapsed:0,duration:10,id:'star-shower',restore:{camera:e.camera,motion:e.motion}};
   if(kind==='window')e.game.state.window={status:'open'};
   await assert.rejects(committing,/veilig hervatten/);assert.equal(calls.some(call=>call.action==='commit'),false);assert.deepEqual(e.game.state.drawn,[]);
  }finally{e.dispose();}
 });
});
test('acknowledging a claim cancels the interrupted draw and advances only after winner speech ends',async()=>{
 const {e,server,round,tick}=await rig();try{
 await e.start();await flush();e.runner.phase='drawing';e.director.cancel(false);e.director.draw();e.director.drawn=[11];server.state.drawn=[11];
 const result={id:'result-1',type:'bingo',winner:{name:'Noor'},acknowledged:false};server.results.push(result);server.state.resultId=result.id;server.state.phase='result';server.state.goalWon=true;e.director.externalHold=true;
 await Promise.all([e.resultNext(),e.resultNext()]);assert.equal(e.director.flow,null);assert.equal(e.director.approvals,1);assert.equal(e.director.narrationHold,true);assert.deepEqual(server.state.drawn,[11]);assert.equal(e.runner.index,round);
 for(let i=0;i<5;i++)await tick();assert.equal(e.runner.goal,0);utterances.at(-1).onend();await tick();await tick();await flush();assert.equal(e.runner.goal,1);assert.equal(server.state.goalIndex,1);
 }finally{e.dispose();}
});
test('a failed browser phrase is retried on resume and stale callbacks cannot end its replacement',async()=>{
 const {e}=await rig();try{
 e.speak('Probeer deze zin','milo','browser',true);const old=utterances.at(-1);old.onerror({error:'audio-busy'});assert.equal(e.director.paused,true);assert.equal(e.failedSpeech.text,'Probeer deze zin');
 await e.pause(false);const replacement=utterances.at(-1);assert.notEqual(replacement,old);assert.equal(replacement.text,old.text);assert.equal(e.voicePhase,'playing');assert.equal(e.director.paused,false);
 old.onend();assert.equal(e.voicePhase,'playing');replacement.onend();assert.equal(e.voicePhase,'idle');
 }finally{e.dispose();}
});
test('cast cue timing pauses, ends cleanly, preserves cohost, and Vlampie keeps native cameras',async()=>{
 const {e}=await rig();try{
 e.event({type:'cast-cue',action:'start',magicId:'silk-stars',guestId:'kora',duration:16});e.lastFrame=performance.now()-250;e.tick();const elapsed=e.magic.elapsed;assert(elapsed>.1);
 await e.pause(true);for(let i=0;i<10;i++){e.lastFrame=performance.now()-300;e.tick();}assert.equal(e.magic.elapsed,elapsed);assert.equal(e.stage().magic.elapsed,elapsed*1000);
 e.event({type:'cast-cue',action:'end',returnSpeakerId:'milo'});assert.equal(e.magic,null);assert.equal(e.guestId,null);assert.equal(e.speakerId,'milo');assert.equal(e.cohostId,'stella');
 e.production='vlampie';e.event({type:'camera',camera:'machine'});assert.equal(e.camera,'machine');
 }finally{e.dispose();}
});
test('an old polling response cannot rewind a newer commit',async()=>{
 const {e,server}=await rig({live:true});try{
 const old=hostCopy(server);let resolve;router=()=>new Promise(r=>resolve=r);const poll=e.refresh();await flush();server.revision+=2;server.state.drawn=[33];e.acceptGame(hostCopy(server));resolve(Response.json({game:old}));await poll;
 assert.deepEqual(e.game.state.drawn,[33]);assert.equal(e.game.revision,server.revision);
 }finally{e.dispose();}
});
test('stop waits for pending activation before pausing the server and never leaves the old block running',async()=>{
 const {e,server,round}=await rig({live:true});try{
 server.status='draft';e.game=hostCopy(server);
 let resolve;const normal=router;router=async(url,opts)=>{if(url.endsWith('/activate'))await new Promise(r=>resolve=r);return normal(url,opts);};
 await e.start({blockIndex:round,goalIndex:0});await flush();assert(resolve);const stopping=e.stop();await flush();resolve();await stopping;await flush();assert.equal(server.state.paused,true);assert.equal(e.runner.active,false);assert.equal(e.director.flow,null);
 }finally{e.dispose();}
});

test('output snapshots retain the authoritative director scene through the bridge show channel',async()=>{
 const {e}=await rig();try{
 e.production='vlampie';e.director.setScene('board','led');const state=e.bridge.state();assert.equal(state.snapshot.show,undefined);assert.equal(state.show.scene,'board');
 e.isOutput=true;e.receive({kind:'snapshot',payload:state.snapshot});e.receive({kind:'show',payload:state.show});assert.equal(e.stage().scene,'board');assert.equal(e.stage().show.scene,'board');assert.equal(e.stage().show.drawnCount,e.director.drawn.length);assert.deepEqual(e.stage().drawn,e.game.state.drawn);
 }finally{e.dispose();}
});

test('saved rehearsal survives reload and production switches, then becomes a real show with edited plan/settings and no demo players',async()=>{
 storage.clear();const {e}=await rig();let reloaded,db;
 try{
 e.editPlan(plan=>{plan.leadId='stella';plan.cohostId='milo';plan.blocks.find(b=>b.type==='welcome').text='Stella opent onze eigen première.';});e.game.settings.claimSeconds=90;e.game.title='Onze eigen première';await e.savePlan();assert.equal(e.dirty,false);e.dispose();
 reloaded=new StudioEngine();await flush();reloaded.audio=noAudio;reloaded.bridge.showAudio=noAudio;
 assert.equal(reloaded.game.plan.blocks.find(b=>b.type==='welcome').text,'Stella opent onze eigen première.');assert.equal(reloaded.hostId,'stella');assert.equal(reloaded.cohostId,'milo');assert.equal(reloaded.game.settings.claimSeconds,90);assert.equal(reloaded.game.title,'Onze eigen première');
 await reloaded.productionSwitch('vlampie');assert.equal(reloaded.production,'vlampie');await reloaded.productionSwitch('milo');assert.equal(reloaded.hostId,'stella');assert.equal(reloaded.game.settings.claimSeconds,90);
 const requests=[];db=createSqliteDatabase(':memory:');router=async(url,opts)=>{const body=opts.body&&JSON.parse(opts.body);requests.push({url,method:opts.method,body});return handleBingo(new Request(location.origin+url,{...opts,headers:{...opts.headers,Origin:location.origin}}),{DB:db,AUTH_IDENTITY:{user:'real-owner',email:'owner@example.test',admin:true}});};
 await reloaded.savePremiere();assert.equal(reloaded.demo,false);assert.equal(reloaded.dirty,false);assert.equal(reloaded.game.status,'draft');assert.equal(reloaded.game.plan.leadId,'stella');assert.equal(reloaded.game.plan.cohostId,'milo');assert.equal(reloaded.game.plan.blocks.find(b=>b.type==='welcome').text,'Stella opent onze eigen première.');assert.equal(reloaded.game.plan.blocks.filter(b=>b.type==='round').length,2);assert.equal(reloaded.game.settings.claimSeconds,90);assert.equal(reloaded.game.books.length,0);assert.equal(reloaded.game.batches.length,0);assert.equal(reloaded.game.results.length,0);assert.equal(requests.length,1);assert.equal(requests[0].method,'POST');assert(requests.every(({body})=>!('books'in body)&&!('state'in body)&&!('results'in body)));const real=(await new BingoStore(db).game(reloaded.game.id)).data;assert.equal(real.plan.leadId,'stella');assert.equal(real.settings.claimSeconds,90);assert.equal(real.books.length,0);assert.equal(real.rulesPublication.automatic,true);
 }finally{e.dispose();reloaded?.dispose();storage.clear();await db?.close();}
});

test('stop during a pending result acknowledgement cannot start late winner speech or progression',async()=>{
 const {e,server}=await rig({live:true});try{
  const r={id:'late-result',type:'bingo',winner:{name:'Noor'},acknowledged:false};server.results.push(r);server.state.resultId=r.id;server.state.phase='result';e.game=hostCopy(server);
  const post=e.post.bind(e);let release;e.post=(action,body)=>action==='finish-result'?new Promise(resolve=>{release=()=>post(action,body).then(resolve);}):post(action,body);
  const ack=e.resultNext();await flush();await e.stop();release();await ack;
  assert.equal(server.results[0].acknowledged,true);assert.equal(e.voicePhase,'idle');assert.equal(e.director.paused,true);assert.equal(e.runner.active,false);assert.equal(e.director.approvals,0);
 }finally{e.dispose();}
});


test('the local call demonstration is explicitly reachable without replacing real books or bypassing an active hold',async()=>{
 const {e,server,calls}=await rig({live:true});try{
  server.state.paused=false;e.game=hostCopy(server);await assert.rejects(e.openRehearsal(),/Pauzeer eerst/);
  e.game.state.drawHold={id:'held-call'};await assert.rejects(e.openRehearsal(),/belmoment/);e.game.state.drawHold=null;
  server.state.paused=true;e.game=hostCopy(server);const before=structuredClone(server);await e.openRehearsal();
  assert.equal(e.demo,true);assert.equal(e.voiceMode,'browser');assert.notEqual(e.game.id,server.id);assert(e.game.books.some(b=>b.profileId));assert.deepEqual(server,before);assert.equal(calls.length,0);
 }finally{e.dispose();}
});

test('manual show cue holds automatic drawing, publishes the same clock, and restores without unpausing an idle show',async()=>{
 const {e,until}=await rig();try{
  await e.start();await flush();await until(()=>e.runner.phase==='drawing');e.runner.autoDraw=true;e.runner.age=e.runner.block.interval+1;
  const before=[...e.game.state.drawn],priorCamera=e.camera;await e.playShowCue('welcome-wave');
  for(let i=0;i<5;i++){e.lastFrame=performance.now()-300;e.tick();}
  assert.deepEqual(e.game.state.drawn,before);assert.equal(e.director.flow,null);assert.equal(e.runner.autoDraw,true);assert.equal(e.stage().showCue.source,'manual');
  const packet=e.bridge.state();assert.deepEqual(packet.snapshot.showCue,e.stage().showCue);assert.equal(packet.snapshot.movement,null);
  await e.pause(true);const age=e.stage().showCue.elapsed;for(let i=0;i<5;i++){e.lastFrame=performance.now()-300;e.tick();}assert.equal(e.stage().showCue.elapsed,age);assert.equal(e.stage().paused,true);
  await e.pause(false);assert.equal(e.stage().paused,false);e.showCues.tick(10);assert.equal(e.stage().showCue,null);assert.equal(e.camera,priorCamera);
  e.runner.autoDraw=false;e.director.paused=true;e.setMotion('clap');assert.equal(e.stage().paused,false);assert.equal(e.stage().movement.id,'clap');e.showCues.tick(6);assert.equal(e.motion,'idle');assert.equal(e.director.paused,true);
 }finally{e.dispose();}
});

test('rundown show cue can feature another friend, clears previews, and stopping it does not draw',async()=>{
 const {e}=await rig();try{
  e.game.plan.blocks=[{id:'friend-spotlight',type:'show',title:'Stella schittert',showCueId:'star-shower',speakerId:'stella'}];
  await e.start({blockIndex:0,goalIndex:0});await flush();await flush();
  assert.equal(e.stage().hostId,'stella');assert.equal(e.stage().speakerId,'stella');assert.equal(e.stage().cohostId,null);assert.equal(e.stage().showCue.source,'rundown');assert.equal(e.previewStage().showCue,null);assert.equal(e.previewStage().movement,null);
  e.stopShowCue();assert.equal(e.stage().showCue,null);assert.equal(e.hostId,'milo');assert.equal(e.stage().cohostId,'stella');assert.equal(e.director.paused,true);assert.equal(e.director.flow,null);assert.deepEqual(e.game.state.drawn,[]);
 }finally{e.dispose();}
});

test('manual speech animates the presenter above a paused rundown without releasing game state',async()=>{
 const {e,server}=await rig();try{
  await e.pause(true);const drawn=structuredClone(server.state.drawn);
  e.speak('Een rustig praatje terwijl de trekking wacht.','milo','browser');
  assert.equal(e.stage().paused,true);assert.equal(e.stage().speechActive,true);
  const utterance=utterances.at(-1);utterance.onpause();
  assert.equal(e.stage().speechActive,false);assert.equal(e.voicePhase,'paused');
  utterance.onresume();assert.equal(e.stage().speechActive,true);
  e.stopSpeech();assert.equal(e.stage().speaking,false);assert.equal(e.stage().speechActive,false);
  assert.equal(server.state.paused,true);assert.deepEqual(server.state.drawn,drawn);
 }finally{e.dispose();}
});

test('slow voice design survives the normal settings deadline and saves the returned profile once',async t=>{
 const {e}=await rig();try{
  t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(AbortSignal,'timeout',ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('signal timed out','TimeoutError')),ms);return controller.signal;});
  let requests=0,failure;const saved=e.characters.map(c=>c.id==='milo'?{...c,customVoiceId:'voice_slow_milo'}:c);
  router=async(url,options)=>{assert.equal(url,'/api/openai/design-voice');assert.deepEqual(JSON.parse(options.body),{characterId:'milo',revision:e.characterRevision});requests++;
   return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});setTimeout(()=>resolve(Response.json({characters:saved,revision:12})),70000);});
  };
  const pending=e.designVoice('milo').catch(error=>{failure=error;});
  assert.equal(e.working,true);t.mock.timers.tick(15001);await flush();assert.equal(failure,undefined);assert.equal(e.working,true);
  t.mock.timers.tick(54999);await pending;assert.equal(failure,undefined);assert.equal(e.characterRevision,12);assert.equal(e.characters.find(c=>c.id==='milo').customVoiceId,'voice_slow_milo');assert.equal(requests,1);assert.equal(e.working,false);
 }finally{e.dispose();}
});
test('voice design timeout gives a recovery message and never automatically creates another voice',async t=>{
 const {e}=await rig();try{
  t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(AbortSignal,'timeout',ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('signal timed out','TimeoutError')),ms);return controller.signal;});
  let requests=0;router=async(url,options)=>{requests++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));};
  const revision=e.characterRevision,pending=assert.rejects(e.designVoice('milo'),/Herlaad eerst het profiel/);
  t.mock.timers.tick(195000);await pending;assert.equal(requests,1);assert.equal(e.characterRevision,revision);assert.equal(e.working,false);assert.doesNotMatch(e.error,/signal timed out/);
 }finally{e.dispose();}
});

test('overview snapshot always exposes the active presenter identity',async()=>{
 const {e}=await rig();try{assert.equal(e.snapshot().hostId,'milo');e.setHost('stella');assert.equal(e.getSnapshot().hostId,'stella');assert.equal(e.getSnapshot().hostId,e.getSnapshot().stage.hostId);}finally{e.dispose();}
});
test('invalid character settings and voice-design calls cannot emit undefined API routes',async()=>{
 const {e}=await rig();try{router=()=>{throw Error('must not call the API');};await assert.rejects(e.saveCharacter('undefined',{}),/geldig personage/);await assert.rejects(e.designVoice(undefined),/geldig personage/);}finally{e.dispose();}
});
