import test from 'node:test';
import assert from 'node:assert/strict';
import {createSqliteDatabase} from '../server/node-storage.js';
import {BingoStore} from '../server/bingo-store.js';
import {handleBingo} from '../server/bingo.js';
import {makeGame,generateBooks,activateBlock,activeGoal,beginBingo,claimBook,claimContext,familyDefault,settleWindow} from '../server/bingo-model.js';
import {makeReport} from '../server/production-model.js';

async function fixture(t,{window=false,result=false,hold=false,status='running'}={}){
 const db=createSqliteDatabase(':memory:');t.after(()=>db.close());const store=new BingoStore(db);
 const game=makeGame({brandId:'milo',title:'Milo annuleringsrepetitie',date:'2027-12-05T19:00:00Z',roundCount:2,settings:{cooldownSeconds:0}},'host','https://studio.example');
 generateBooks(game,2,'cancel-fixture-books');game.books.forEach((b,i)=>Object.assign(b,{accountId:'family',profileId:'child-'+i,name:'Kind '+i}));game.status='running';
 activateBlock(game,game.plan.blocks.findIndex(b=>b.type==='round'));activeGoal(game).pattern.cells=[0];game.books.forEach(b=>b.cards[0][0]=1);game.state.drawn=[1];game.state.deck=[1,2,...Array.from({length:73},(_,i)=>i+3)];game.state.history=[{roundIndex:0,drawn:[4,5],closedAt:123}];
 game.orders=[{id:'preserved-order',status:'fulfilled',amountCents:500,serviceEvents:[{eventId:'prior-service-event'}]}];game.mailDomainEvents=[{eventId:'prior-prize-mail-event'}];
 if(window){const family=familyDefault();beginBingo(game,family,'family','initial-announcement',Date.now()-40000);claimBook(game,family,'family',game.books[0].id,game.state.window.startedAt+1);}
 if(result){game.results=[{id:'unpublished-result',type:'bingo',winner:{accountId:'family',profileId:'child-0',bookId:game.books[0].id,name:'Kind 0',ticket:'0001'},entrants:[{bookId:game.books[0].id,name:'Kind 0',ticket:'0001'}],prize:{title:'Voorbeeldprijs'},acknowledged:false,createdAt:123,roundIndex:0,goalIndex:0}];game.state.phase='result';game.state.resultId='unpublished-result';}
 if(hold){game.state.callId='unclosed-call';game.state.drawHold={id:'unclosed-call',callId:'unclosed-call',checkpoint:{drawn:[1],lastNumber:1}};}
 game.status=status;await store.create(game);
 const request=({action='force-cancel',body={},user='host',admin=user==='host',method='POST',origin='https://studio.example',header=true,authenticated=true}={})=>new Request(`https://studio.example/api/bingo/games/${game.id}${action?'/' + action:''}`,{method,headers:{...(origin?{Origin:origin}:{}),...(header?{'X-Vlampie-Bingo':'1'}:{}),'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify({requestId:'force-cancel-request-001',regieId:'regie-main',confirm:true,expectedTitle:game.title,...body})})});
 const call=async options=>{const r=await handleBingo(request(options),{DB:db,AUTH_IDENTITY:options?.authenticated===false?null:{user:options?.user||'host',email:'test@example.test',admin:options?.admin??(!options?.user||options.user==='host')}});return {status:r.status,data:await r.json()};};
 const snapshot=async()=>JSON.stringify((await store.game(game.id)).data);
 return {db,store,game,request,call,snapshot};
}

test('force cancellation requires verified host ownership, same-origin headers and explicit confirmation without any mutation',async t=>{
 const h=await fixture(t),before=await h.snapshot();
 for(const [options,status] of [[{authenticated:false},401],[{user:'family'},403],[{user:'other-host',admin:true},403],[{origin:'https://evil.example'},403],[{origin:null},403],[{header:false},403],[{body:{confirm:false}},400],[{body:{expectedTitle:'Andere show'}},409],[{body:{reason:'x'.repeat(301)}},400],[{body:{requestId:''}},400],[{body:{requestId:['coerced-request-id']}},400]]){
  const r=await h.call(options);assert.equal(r.status,status,JSON.stringify(r));assert.equal(await h.snapshot(),before);
 }
});

test('forced cancellation overrides an active control lease, pending draw, open claims and a call hold without settling or changing history',async t=>{
 const h=await fixture(t,{window:true,hold:true});await h.store.mutate(h.game.id,{},g=>{g.state.control={id:'another-regie',until:Date.now()+60000};g.state.pending={token:'uncommitted-ball',number:2,epoch:g.state.epoch};g.state.drawClock={nextAt:Date.now()+15000};});
 const before=(await h.store.game(h.game.id)).data,r=await h.call({body:{reason:'Alleen de regie mag deze auditreden zien'}});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.applied,true);
 const g=(await h.store.game(h.game.id)).data;assert.equal(g.status,'finished');assert.equal(g.state.phase,'complete');assert.equal(g.state.paused,true);assert.equal(g.state.pending,null);assert.equal(g.state.drawClock,null);assert.equal(g.state.control,null);assert.equal(g.state.window.status,'cancelled');
 const reloaded=await h.call({action:'',method:'GET'});assert.equal(reloaded.data.game.cancellation.cleanupPending,true,'a stored hold without closure proof stays visible after reload');
 assert.equal(g.cancellation.by,'host');assert.equal(g.cancellation.checkpoint.pending.token,'uncommitted-ball');assert.equal(g.cancellation.checkpoint.windowId,before.state.window.id);assert.equal(g.cancelledAt,g.finishedAt);
 for(const key of ['books','batches','results','orders','mailDomainEvents'])assert.deepEqual(g[key],before[key],key);
 for(const key of ['drawn','history','deck','callId','drawHold'])assert.deepEqual(g.state[key],before.state[key],key);
 assert.deepEqual(g.state.window.claims,before.state.window.claims);assert.deepEqual(g.state.window.announcements,before.state.window.announcements);assert.equal(g.events.filter(e=>e.type==='window-closed').length,0);assert.equal(g.events.filter(e=>e.type==='show-force-cancelled').length,1);
 assert.equal(settleWindow(g,Date.now()+100000),null);assert.equal(g.results.length,0);assert.equal(makeReport(g).show.cancelledAt,g.cancelledAt);
});

test('unpublished results remain unpublished and all stale regie mutation routes are refused after cancellation',async t=>{
 const h=await fixture(t,{result:true}),r=await h.call();assert.equal(r.status,200,JSON.stringify(r));const before=await h.snapshot();
 for(const [action,body] of [['heartbeat',{}],['pause',{paused:false}],['pause',{paused:true}],['reserve',{}],['commit',{token:'earlier-ball'}],['activate',{blockIndex:0}],['raffle',{}],['start',{}],['extend',{seconds:30}],['finish',{}],['finish-result',{resultId:'unpublished-result'}],['production',{revision:0,production:{}}],['publish-rules',{}],['delivery',{resultId:'unpublished-result',delivered:true}]]){
  const denied=await h.call({action,body:{requestId:crypto.randomUUID(),...body}});assert.equal(denied.status,409,`${action}: ${JSON.stringify(denied)}`);assert.equal(await h.snapshot(),before,action);
 }
 const g=(await h.store.game(h.game.id)).data;assert.equal(g.state.resultId,'unpublished-result');assert.equal(g.results[0].acknowledged,false);assert.deepEqual(g.mailDomainEvents,h.game.mailDomainEvents);
});

test('double clicks, independent tabs and durable retries produce exactly one cancellation event',async t=>{
 const h=await fixture(t),[a,b]=await Promise.all([h.call(),h.call({body:{requestId:'other-regie-cancel-002'}})]);assert.equal(a.status,200,JSON.stringify(a));assert.equal(b.status,200,JSON.stringify(b));assert.equal(Number(a.data.applied)+Number(b.data.applied),1);
 let g=(await h.store.game(h.game.id)).data;assert.equal(g.events.filter(e=>e.type==='show-force-cancelled').length,1);const original=g.cancellation;
 await h.store.mutate(g.id,{},game=>{game.ops=[];game.operationReceipts=[];});const before=await h.snapshot();const retry=await h.call({body:{requestId:original.requestId}});assert.equal(retry.status,200,JSON.stringify(retry));assert.equal(retry.data.applied,false);assert.equal(await h.snapshot(),before);
 const changed=await h.call({body:{requestId:original.requestId,reason:'Een andere reden'}});assert.equal(changed.status,409);assert.equal(changed.data.error.code,'request_conflict');assert.equal(await h.snapshot(),before);
 g=(await h.store.game(g.id)).data;assert.deepEqual(g.cancellation,original);
});

for(const status of ['draft','finished'])test(`force cancellation refuses a ${status} show without changing it`,async t=>{
 const h=await fixture(t,{status}),before=await h.snapshot(),r=await h.call();assert.equal(r.status,409);assert.equal(r.data.error.code,'show_not_running');assert.equal(await h.snapshot(),before);
});

test('a failed durable cancellation write keeps the entire running show and a retry can succeed',async t=>{
 const h=await fixture(t),execute=h.db.execute.bind(h.db),before=await h.snapshot();let fail=true;
 h.db.execute=async(sql,args)=>{if(fail&&/^UPDATE bingo_games SET revision/.test(sql)){fail=false;throw Error('injected durable storage failure');}return execute(sql,args);};
 const first=await h.call();assert.equal(first.status,503);assert.equal(await h.snapshot(),before);const retry=await h.call();assert.equal(retry.status,200);assert.equal(retry.data.applied,true);
});

test('a draw waiting on a stale CAS cannot commit after cancellation wins the database race',async t=>{
 const h=await fixture(t);await h.store.mutate(h.game.id,{},g=>{g.state.pending={token:'draw-pending',number:2,epoch:g.state.epoch};});const execute=h.db.execute.bind(h.db);let intercepted=false;
 h.db.execute=async(sql,args)=>{if(!intercepted&&/^UPDATE bingo_games SET revision/.test(sql)&&JSON.parse(args[1]).state.drawn.length===2){intercepted=true;const cancelled=await h.call();assert.equal(cancelled.status,200,JSON.stringify(cancelled));}return execute(sql,args);};
 const draw=await h.call({action:'commit',body:{requestId:'inflight-draw-request',token:'draw-pending'}});assert.equal(draw.status,409,JSON.stringify(draw));assert(intercepted);const g=(await h.store.game(h.game.id)).data;assert.deepEqual(g.state.drawn,[1]);assert.equal(g.status,'finished');assert.equal(g.events.filter(e=>e.type==='ball-committed').length,0);
});

test('cancellation retries a lost CAS against the latest officially committed draw rather than replacing it',async t=>{
 const h=await fixture(t);await h.store.mutate(h.game.id,{},g=>{g.state.pending={token:'winning-draw',number:2,epoch:g.state.epoch};});const execute=h.db.execute.bind(h.db);let intercepted=false;
 h.db.execute=async(sql,args)=>{if(!intercepted&&/^UPDATE bingo_games SET revision/.test(sql)&&JSON.parse(args[1]).cancellation){intercepted=true;const committed=await h.call({action:'commit',body:{requestId:'winning-draw-request',token:'winning-draw'}});assert.equal(committed.status,200,JSON.stringify(committed));}return execute(sql,args);};
 const cancel=await h.call();assert.equal(cancel.status,200,JSON.stringify(cancel));assert(intercepted);const g=(await h.store.game(h.game.id)).data;assert.deepEqual(g.state.drawn,[1,2]);assert.equal(g.cancellation.checkpoint.drawnCount,2);assert.equal(g.state.lastCommit.token,'winning-draw');assert.equal(g.events.filter(e=>e.type==='ball-committed').length,1);assert.equal(g.events.filter(e=>e.type==='show-force-cancelled').length,1);
});

test('the shared store refuses terminal game resurrection even when an internal writer bypasses API guards',async t=>{
 const h=await fixture(t,{result:true});assert.equal((await h.call()).status,200);const before=await h.snapshot();
 for(const write of [g=>{g.status='running';},g=>{g.state.paused=false;},g=>{g.state.drawn.push(2);},g=>{g.state.phase='running';},g=>{g.state.pending={number:2};},g=>{g.state.control={id:'stale-tab',until:Date.now()+15000};},g=>{g.results[0].acknowledged=true;},g=>{g.state.window={status:'open'};},g=>{g.books[0].admitted=false;}]){
  await assert.rejects(h.store.mutate(h.game.id,{},write),e=>e.code==='show_cancelled');assert.equal(await h.snapshot(),before);
 }
});

test('players see cancellation without private operator, reason or pending draw details and cannot add claims',async t=>{
 const h=await fixture(t,{window:true}),context=claimContext(h.game),reason='PRIVATE-OPERATOR-CANCELLATION-REASON';assert.equal((await h.call({body:{reason}})).status,200);
 const publicGame=await h.call({action:'',method:'GET',user:'family'});assert.equal(publicGame.status,200);assert(publicGame.data.game.cancelledAt);assert.equal(publicGame.data.game.state.window.status,'cancelled');assert(!JSON.stringify(publicGame).includes(reason));assert(!publicGame.data.game.cancellation);
 const listResponse=await handleBingo(new Request('https://studio.example/api/bingo/games'),{DB:h.db,AUTH_IDENTITY:{user:'family',email:'family@example.test',admin:false}}),list=await listResponse.json();assert(list.games[0].cancelledAt);assert(!JSON.stringify(list).includes(reason));
 for(const action of ['begin','claim']){const before=await h.snapshot(),denied=await h.call({action,user:'family',body:{claimContext:context,bookId:h.game.books[0].id,requestId:crypto.randomUUID()}});assert.equal(denied.status,409);assert.equal(await h.snapshot(),before);}
});

test('force cancelling Milo leaves the separate Vlampie show unchanged',async t=>{
 const h=await fixture(t),vlampie=makeGame({brandId:'vlampie',title:'Vlampie blijft apart',date:'2027-12-06T19:00:00Z'},'host','https://studio.example');await h.store.create(vlampie);const before=JSON.stringify((await h.store.game(vlampie.id)).data);assert.equal((await h.call()).status,200);assert.equal(JSON.stringify((await h.store.game(vlampie.id)).data),before);
});
