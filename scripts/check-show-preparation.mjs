import test from 'node:test';
import assert from 'node:assert/strict';
import {PreparationAutosave,drawClockStatus,preparationFingerprint} from '../frontend/show-preparation.js';
import {StudioEngine} from '../frontend/engine.js';
import {makeGame,generateBooks,activateBlock} from '../server/bingo-model.js';
import {BingoStore} from '../server/bingo-store.js';
import {createSqliteDatabase} from '../server/node-storage.js';
import {handleBingo} from '../server/bingo.js';
import {STANDARD_DRAW_LEAD_MS} from '../server/standard-show.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function controller(persist){
 let input={title:'Eerste invoer'},saved=null,timer=null;
 const autosave=new PreparationAutosave({read:()=>input,persist,apply:(result,{current})=>{saved=result.game;if(current)input={title:saved.title};},schedule:fn=>(timer=fn,1),cancel:()=>{timer=null;}});
 return {autosave,get input(){return input;},get saved(){return saved;},edit(title){input={title};autosave.mark();},fire(){const fn=timer;timer=null;fn?.();},get scheduled(){return !!timer;}};
}

test('preparation debounce coalesces typing; a save never replaces newer input',async()=>{
 const first=deferred(),writes=[];let h;
 h=controller(async(value,revision)=>{writes.push({value,revision});if(writes.length===1)await first.promise;return {game:{...value,preparationRevision:revision+1}};});
 h.edit('Titel tijdens typen');h.edit('Definitieve titel');assert(h.scheduled);assert.equal(writes.length,0);
 const saving=h.autosave.flush();assert.equal(writes.length,1);assert.equal(writes[0].value.title,'Definitieve titel');
 h.edit('Nog nieuwere invoer');first.resolve();await saving;
 assert.deepEqual(writes.map(write=>[write.value.title,write.revision]),[['Definitieve titel',0],['Nog nieuwere invoer',1]]);
 assert.equal(h.input.title,'Nog nieuwere invoer');assert.equal(h.saved.title,'Nog nieuwere invoer');assert.deepEqual(h.autosave.state,{status:'saved',error:'',conflict:false,dirty:false});h.autosave.dispose();
});

test('a real failed write retains input; explicit retry sends the same preparation revision',async()=>{
 const writes=[];let fail=true;
 const h=controller(async(value,revision)=>{writes.push({value,revision});if(fail)throw Error('Opslag tijdelijk onbereikbaar');return {game:{...value,preparationRevision:revision+1}};});
 h.edit('Bewaar deze complete invoer');await assert.rejects(h.autosave.flush(),/onbereikbaar/);
 assert.equal(h.input.title,'Bewaar deze complete invoer');assert.equal(h.autosave.state.status,'error');assert.equal(h.autosave.state.dirty,true);assert.equal(h.saved,null);
 fail=false;await h.autosave.flush();assert.deepEqual(writes.map(write=>write.revision),[0,0]);assert.equal(h.autosave.state.status,'saved');h.autosave.dispose();
});

test('a stale tab cannot silently adopt the new revision or overwrite another tab',async()=>{
 const h=controller(async()=>{throw Object.assign(Error('Ander regievenster'),{code:'preparation_conflict'});});
 h.autosave.reset(4);h.edit('Mijn eigen onopgeslagen wijziging');await assert.rejects(h.autosave.flush());
 assert.equal(h.autosave.revision,4);assert.equal(h.autosave.state.conflict,true);assert.equal(h.input.title,'Mijn eigen onopgeslagen wijziging');h.autosave.dispose();
});

test('switching shows invalidates the old response without dirtying the newly selected show',async()=>{
 const write=deferred(),h=controller(async()=>write.promise);
 h.edit('Oude show');const saving=h.autosave.flush();h.autosave.reset(7);write.resolve({game:{title:'Oude show',preparationRevision:1}});await saving;
 assert.equal(h.saved,null);assert.equal(h.autosave.revision,7);assert.equal(h.autosave.state.dirty,false);assert.equal(h.autosave.state.status,'saved');h.autosave.dispose();
});

function engineFor(game){
 const e=Object.create(StudioEngine.prototype);
 Object.assign(e,{game:structuredClone(game),production:game.brandId,demo:false,dirty:false,clientId:crypto.randomUUID(),voiceMode:'ai',apiStatus:{configured:true},listeners:new Set(),log:[],serverTimeOffset:0,localDrawNextAt:0,autoDrawBlocked:true,voicePhase:'idle',audio:{unlock:async()=>true},director:{configure(){},cancel(){this.flow=null;},visual:()=>({}),pause(){this.paused=true;},draw(){this.flow={kind:'draw'};this.draws=(this.draws||0)+1;return true;}},runner:{active:false,phase:'idle',visual:()=>({}),start(plan,options){this.active=true;this.started={plan,options};}},syncGame(){},stopSpeech(){this.voicePhase='idle';},emit(){this.trackPreparationChange();}});
 e.preparationAutosave=e.makePreparationAutosave();e._preparationFingerprint=preparationFingerprint(e.game);return e;
}
async function apiHarness(t){
 const db=createSqliteDatabase(':memory:'),store=new BingoStore(db),game=makeGame({brandId:'milo',title:'Automatische voorbereiding',date:'2027-01-01T18:00:00Z'},'host','https://studio.example');
 generateBooks(game,1,'auto-prepare-books');game.books[0].accountId='family';game.books[0].name='Deelnemer';await store.create(game);
 const originalFetch=globalThis.fetch,originalStorage=globalThis.sessionStorage,backup=new Map(),requests=[];
 globalThis.sessionStorage={setItem:(key,value)=>backup.set(key,value),getItem:key=>backup.get(key)||null,removeItem:key=>backup.delete(key)};
 let failWrites=false,delay=null;
 globalThis.fetch=async(url,options={})=>{
  const request=new Request('https://studio.example'+url,{...options,headers:{...options.headers,Origin:'https://studio.example'}});requests.push({method:request.method,path:new URL(request.url).pathname,body:options.body&&JSON.parse(options.body)});
  if(request.method==='PUT'&&delay){const wait=delay;delay=null;await wait;}
  if(request.method==='PUT'&&failWrites)return new Response(JSON.stringify({error:{message:'Opslag tijdelijk niet beschikbaar',code:'storage_failure'}}),{status:500,headers:{'Content-Type':'application/json'}});
  return handleBingo(request,{DB:db,AUTH_IDENTITY:{user:'host',email:'host@example.test',admin:true}});
 };
 const engines=[];t.after(async()=>{for(const e of engines)e.preparationAutosave.dispose();globalThis.fetch=originalFetch;if(originalStorage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=originalStorage;await db.close();});
 return {game,store,requests,backup,engine(value=game){const e=engineFor(value);engines.push(e);return e;},failWrites(value){failWrites=value;},delayNextWrite(){const d=deferred();delay=d.promise;return d.resolve;}};
}

test('Start show flushes the last edit, verifies server status and freezes rules once; double clicks share one start',async t=>{
 const h=await apiHarness(t),e=h.engine();e.editPlan(plan=>{plan.blocks.find(block=>block.type==='welcome').text='De laatste voorbereide welkomsttekst.';});
 const release=h.delayNextWrite(),a=e.start(),b=e.start();assert.equal(a,b);assert.equal(e.starting,true);assert.throws(()=>e.editPlan(plan=>{plan.blocks[0].title='Te late wijziging';}),/show wordt gestart/);release();await Promise.all([a,b]);assert.equal(e.starting,false);
 const writes=h.requests.filter(request=>request.method==='PUT'),starts=h.requests.filter(request=>request.path.endsWith('/start'));
 assert.equal(writes.length,1);assert.equal(starts.length,1);assert.equal(writes[0].body.expectedPreparationRevision,0);assert(h.requests.findIndex(request=>request.method==='PUT')<h.requests.findIndex(request=>request.path.endsWith('/start')));
 const stored=(await h.store.game(h.game.id)).data;assert.equal(stored.status,'running');assert.equal(stored.plan.blocks.find(block=>block.type==='welcome').text,'De laatste voorbereide welkomsttekst.');assert(stored.rulesPublication?.finalizedAt);assert.equal(stored.events.filter(event=>event.type==='show-started').length,1);assert.equal(e.serverStatusVerified,true);assert.equal(e.dirty,false);
});

test('a failed preparation blocks the start without losing input and retries successfully',async t=>{
 const h=await apiHarness(t),e=h.engine();h.failWrites(true);e.editPlan(plan=>{plan.blocks[0].title='Niet verloren invoer';});
 await assert.rejects(e.start(),/Niet opgeslagen.*invoer blijft bewaard/);assert.equal(e.starting,false);assert.equal(e.game.plan.blocks[0].title,'Niet verloren invoer');assert.equal(e.preparationAutosave.state.status,'error');assert.equal(e.dirty,true);assert.equal(h.requests.some(request=>request.path.endsWith('/start')),false);assert.equal((await h.store.game(h.game.id)).data.status,'draft');assert(h.backup.size>0);
 h.failWrites(false);await e.start();assert.equal((await h.store.game(h.game.id)).data.plan.blocks[0].title,'Niet verloren invoer');assert.equal(e.game.status,'running');assert.equal(h.backup.size,0);
});

test('two tabs keep preparation conflicts visible and cannot both claim live control',async t=>{
 const h=await apiHarness(t),first=h.engine(),second=h.engine();first.editPlan(plan=>{plan.blocks[0].title='Eerste tab';});await first.flushPreparation();second.editPlan(plan=>{plan.blocks[0].title='Tweede tab blijft hier';});
 await assert.rejects(second.flushPreparation(),/ander regievenster/);assert.equal(second.game.plan.blocks[0].title,'Tweede tab blijft hier');assert.equal(second.preparationAutosave.state.conflict,true);assert.equal((await h.store.game(h.game.id)).data.plan.blocks[0].title,'Eerste tab');
 await second.loadSavedPreparation();await first.start();await assert.rejects(second.start(),/ander regievenster/);assert.equal((await h.store.game(h.game.id)).data.events.filter(event=>event.type==='show-started').length,1);
});

test('polling accepts live server state while retaining pending preparation input',async t=>{
 const h=await apiHarness(t),e=h.engine();e.editPlan(plan=>{plan.blocks[0].title='Mijn tekst tijdens opslag';});const release=h.delayNextWrite(),saving=e.flushPreparation();const fresh=structuredClone(h.game);fresh.revision=20;fresh.state.window={id:'nieuw-venster',status:'open'};e.acceptGame(fresh);
 assert.equal(e.game.plan.blocks[0].title,'Mijn tekst tijdens opslag');assert.equal(e.game.state.window.id,'nieuw-venster');release();await saving;assert.equal(e.game.plan.blocks[0].title,'Mijn tekst tijdens opslag');assert.equal(e.game.state.window.id,'nieuw-venster');assert.equal(e.dirty,false);
});

test('printing new booklets first flushes preparation and cannot restore an older plan over the editor',async t=>{
 const h=await apiHarness(t),e=h.engine();e.editPlan(plan=>{plan.blocks[0].title='Voorbereiding bij nieuwe boekjes';});await e.generate(1);
 assert.equal(h.requests[0].method,'PUT');assert(h.requests[1].path.endsWith('/generate'));assert.equal(e.game.plan.blocks[0].title,'Voorbereiding bij nieuwe boekjes');assert.equal(e.game.books.length,2);assert.equal(e.dirty,false);
});

test('Hervat regie checks the real server and restores an existing board without starting or releasing any hold',async t=>{
 for(const kind of ['paused','window','result','call'])await t.test(kind,async t=>{
  const h=await apiHarness(t);await h.store.mutate(h.game.id,{},(game,_family,now)=>{
   game.status='running';game.startedAt=now-90000;activateBlock(game,game.plan.blocks.findIndex(block=>block.type==='round'),0,now);game.state.drawn=game.state.deck.slice(0,3);game.state.lastCommit={number:game.state.drawn.at(-1),at:now-60000,index:3};
   if(kind==='paused')game.state.paused=true;
   if(kind==='window'){game.state.phase='window';game.state.window={id:'existing-window',status:'open',startedAt:now,endsAt:now+30000,frozenAt:3,announcements:[],claims:[]};}
   if(kind==='result'){game.state.phase='result';game.state.resultId='existing-result';}
   if(kind==='call'){game.state.drawHold={id:'existing-call-hold',reason:'test',checkpoint:{}};game.state.callId='existing-call';}
  });
  const before=structuredClone((await h.store.game(h.game.id)).data.state),e=h.engine();assert.equal(e.game.status,'draft','The page intentionally holds a stale draft snapshot before reconnecting');await e.resumeRegie();
  const after=(await h.store.game(h.game.id)).data.state;for(const key of ['drawn','lastCommit','phase','paused','window','resultId','drawHold','callId','epoch','drawClock'])assert.deepEqual(after[key],before[key],key);
  assert.equal(e.game.status,'running');assert.equal(e.serverStatusVerified,true);assert.equal(e.runner.active,true);assert.equal(e.director.paused,true);assert.equal(e.drawClock().blocked,true);assert.equal(h.requests.some(request=>request.path.endsWith('/start')||request.path.endsWith('/pause')||request.path.endsWith('/activate')||request.path.endsWith('/reserve')),false);assert.equal(h.requests.filter(request=>request.path.endsWith('/heartbeat')).length,1);
 });
});

test('a reload restores an unsaved draft from this tab and leaves another production untouched',async t=>{
 const h=await apiHarness(t),first=h.engine();h.failWrites(true);first.editPlan(plan=>{plan.blocks[0].title='Herstel deze invoer na herladen';});await assert.rejects(first.flushPreparation());
 const reloaded=h.engine();reloaded.restorePreparationBackup();assert.equal(reloaded.game.plan.blocks[0].title,'Herstel deze invoer na herladen');assert.equal(reloaded.dirty,true);h.failWrites(false);await reloaded.flushPreparation();assert.equal((await h.store.game(h.game.id)).data.plan.blocks[0].title,'Herstel deze invoer na herladen');
 const vlampie=h.engine({...h.game,brandId:'vlampie'});vlampie.restorePreparationBackup();assert.notEqual(vlampie.game.plan.blocks[0].title,'Herstel deze invoer na herladen');assert.equal(vlampie.dirty,false);
});

test('opening a running show only reads its status; the idle page cannot claim the control lease',async t=>{
 const h=await apiHarness(t),e=h.engine();e.game.status='running';e.lastFrame=performance.now();e.lastHeartbeat=-10000;e.gameAudioClock={read:value=>value};e.stage=()=>({show:{}});e.director.tick=()=>{};e.runner.tick=()=>{};
 e.tick();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.requests.length,0);assert.equal(e.runner.active,false);assert.equal((await h.store.game(h.game.id)).data.state.control,undefined);
});

test('the authoritative fifteen-second clock has no catch-up batch and starts a fresh interval after every hold',()=>{
 const game=makeGame({brandId:'milo',title:'Klok',date:'2027-01-01T18:00:00Z'},'host','https://studio.example'),e=engineFor(game);e.game.status='running';e.game.state.drawClock={intervalMs:15000,nextAt:15000};e.runner.active=true;e.runner.phase='drawing';let now=0;e.serverNow=()=>now;e.autoDrawTick();
 now=15000-STANDARD_DRAW_LEAD_MS-1;e.autoDrawTick();assert.equal(e.director.draws||0,0);now++;e.autoDrawTick();assert.equal(e.director.draws,1);now=90000;e.autoDrawTick();assert.equal(e.director.draws,1,'An unfinished draw cannot create a catch-up batch');
 const holds=[()=>{e.game.state.paused=true;},()=>{e.game.state.window={status:'open'};},()=>{e.game.state.resultId='result';},()=>{e.showRuntime={holding:true};},()=>{e.game.state.drawHold={id:'call'};}];
 for(const hold of holds){e.game.state.paused=false;e.game.state.window=null;e.game.state.resultId=null;e.game.state.drawHold=null;e.showRuntime=null;e.director.flow=null;hold();e.autoDrawTick();const count=e.director.draws;e.game.state.paused=false;e.game.state.window=null;e.game.state.resultId=null;e.game.state.drawHold=null;e.showRuntime=null;now+=50000;e.autoDrawTick();assert.equal(e.director.draws,count);assert.equal(e.drawClock().remainingMs,15000);now+=15000-STANDARD_DRAW_LEAD_MS-1;e.autoDrawTick();assert.equal(e.director.draws,count);now++;e.autoDrawTick();assert.equal(e.director.draws,count+1);}
 assert.equal(drawClockStatus(e.game,{now:999999,blocked:true}).remainingMs,15000);e.preparationAutosave.dispose();
});
