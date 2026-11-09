import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../server/bingo-model.js';
import {BingoStore} from '../server/bingo-store.js';
import {createSqliteDatabase} from '../server/node-storage.js';
import {handleBingo} from '../server/bingo.js';

function fixture(brandId='milo'){
 const game=model.makeGame({brandId,date:'2026-12-05T19:00:00Z',roundCount:2,settings:{cooldownSeconds:0}},'host','https://studio.example');
 model.generateBooks(game,3,'fixture-books');game.books.forEach((book,i)=>Object.assign(book,{accountId:i===2?'b':'a',profileId:'child-'+i,name:'Kind '+i}));
 game.status='running';const blockIndex=game.plan.blocks.findIndex(b=>b.type==='round');model.activateBlock(game,blockIndex);
 model.activeGoal(game).pattern.cells=[0];game.books.forEach(book=>book.cards[0][0]=1);game.state.drawn=[1];
 return {game,blockIndex,a:model.familyDefault(),b:model.familyDefault()};
}
function winner(h){model.beginBingo(h.game,h.a,'a','announce',100);model.claimBook(h.game,h.a,'a',h.game.books[0].id,101);return model.settleWindow(h.game,h.game.state.window.endsAt);}
async function api(t,h=fixture()){
 const db=createSqliteDatabase(':memory:'),store=new BingoStore(db);t.after(()=>db.close());await store.create(h.game);
 const call=async(action,body,user='a',method=body===undefined?'GET':'POST')=>{const response=await handleBingo(new Request(`https://studio.example/api/bingo/games/${h.game.id}${action?'/' + action:''}`,{method,headers:{Origin:'https://studio.example','X-Vlampie-Bingo':'1','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify({regieId:'regie-main',requestId:crypto.randomUUID(),...body})})}),{DB:db,AUTH_IDENTITY:{user,email:user+'@example.test',admin:user==='host'}});return {status:response.status,data:await response.json()};};
 return {...h,store,call};
}
const context=game=>model.claimContext(game);

test('S03: effective free centre rejects a centre-only pattern for either imported flag',()=>{
 for(const freeCenter of [false,true]){const plan=model.defaultGamePlan(2);plan.patterns[0].cells=[12];plan.patterns[0].freeCenter=freeCenter;assert.throws(()=>model.makeGame({date:'2026-12-05T19:00:00Z',roundCount:2,plan},'host','https://studio.example'),/patroon|middenvak/i);}
 const h=fixture();assert.equal(model.completionIndex(h.game.books[0].cards[0],{variant:'fixed',freeCenter:false,cells:[12]},[]),null);
});

test('S02: an acknowledged goal cannot reopen, reroll or reset the round deck',()=>{
 for(const brand of ['milo','vlampie']){const h=fixture(brand),r=winner(h);r.acknowledged=true;h.game.state.phase='running';h.game.state.resultId=null;model.activateBlock(h.game,h.blockIndex,1);const before=JSON.stringify(h.game);assert.throws(()=>model.activateBlock(h.game,h.blockIndex,0),/afgerond|verleden|definitief/i);assert.equal(JSON.stringify(h.game),before);const next=h.game.plan.blocks.findIndex((b,i)=>i>h.blockIndex&&b.type==='round');model.activateBlock(h.game,next);assert.equal(h.game.state.drawn.length,0);const after=JSON.stringify(h.game);assert.throws(()=>model.activateBlock(h.game,h.blockIndex,1),/verleden|afgerond/i);assert.equal(JSON.stringify(h.game),after);assert.equal(h.game.results.length,1);}
});

test('S02: a second regie tab cannot finish an unpublished saved result',async t=>{
 const h=fixture();winner(h);const server=await api(t,h),before=JSON.stringify((await server.store.game(h.game.id)).data);const refused=await server.call('finish',{},'host');assert.equal(refused.status,409);assert.equal(JSON.stringify((await server.store.game(h.game.id)).data),before);const ack=await server.call('finish-result',{resultId:h.game.results[0].id},'host');assert.equal(ack.status,200);assert.equal((await server.call('finish',{},'host')).status,200);
});

test('S05: changed-input replay never returns another family claim',async t=>{
 const server=await api(t),g=server.game;model.beginBingo(g,server.a,'a','announce-a');model.beginBingo(g,server.b,'b','announce-b');await server.store.mutate(g.id,{},stored=>{stored.state=g.state;});
 const body={requestId:'same-request-123',windowId:g.state.window.id,bookId:g.books[0].id,...(model.claimContext?{claimContext:context(g)}:{})};const first=await server.call('claim',body);assert.equal(first.status,200);
 const b=await server.call('claim',{...body,requestId:'family-b-claim-123',bookId:g.books[2].id},'b');assert.equal(b.status,200);
 const changed=await server.call('claim',{...body,bookId:g.books[2].id});assert([403,409].includes(changed.status));assert(!JSON.stringify(changed.data).includes(g.books[2].id));assert(!JSON.stringify(changed.data).includes('Kind 2'));
 const retry=await server.call('claim',body);assert.equal(retry.status,200);assert.deepEqual(retry.data.claim,first.data.claim);
});

test('S01/S04: concurrent same-goal dialogs share one window; a historical open dialog cannot create its successor',async t=>{
 const server=await api(t),captured=context(server.game);
 const [a,b]=await Promise.all([server.call('begin',{claimContext:captured},'a'),server.call('begin',{claimContext:captured},'b')]);
 assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.data.game.state.window.id,b.data.game.state.window.id);
 let saved=(await server.store.game(server.game.id)).data;assert.equal(saved.state.window.announcements.length,2);assert.equal(saved.state.windowSequence,1);
 const oldOpen=context(saved),deadline=Date.now()-1;await server.store.mutate(saved.id,{},game=>{game.state.window.endsAt=deadline;model.settleWindow(game,Date.now());});
 saved=(await server.store.game(saved.id)).data;const oldClosed=JSON.stringify(saved),denied=await server.call('begin',{claimContext:oldOpen});assert.equal(denied.status,409);assert.equal(denied.data.error.code,'context_changed');assert.equal(JSON.stringify((await server.store.game(saved.id)).data),oldClosed);
 const next=context(saved),[c,d]=await Promise.all([server.call('begin',{claimContext:next}),server.call('begin',{claimContext:next},'b')]);assert.equal(c.status,200);assert.equal(d.status,200);assert.equal(c.data.game.state.window.id,d.data.game.state.window.id);assert.notEqual(c.data.game.state.window.id,oldOpen.windowId);
 const current=(await server.store.game(saved.id)).data;assert.equal(current.state.windowSequence,2);assert.equal(current.events.filter(event=>event.type==='window-closed').length,1);
 // A dialog from before the first window has expired, even though the goal's epoch stayed the same.
 assert.equal((await server.call('begin',{claimContext:captured})).status,409);
});

test('S01: after a false window, another own book can announce after cooldown without deleting history',async t=>{
 const server=await api(t);await server.store.mutate(server.game.id,{},g=>{g.books[0].cards[0][0]=2;});
 const start=(await server.call('begin',{claimContext:context(server.game)})).data.game;
 const falseClaim=await server.call('claim',{claimContext:start.state.claimContext,bookId:server.game.books[0].id});assert.equal(falseClaim.status,200);assert.equal(falseClaim.data.claim.status,'false');
 await server.store.mutate(server.game.id,{},g=>{g.state.window.endsAt=Date.now()-1;model.settleWindow(g,Date.now());});
 const closed=(await server.store.game(server.game.id)).data,next=(await server.call('begin',{claimContext:context(closed)})).data.game;
 const valid=await server.call('claim',{claimContext:next.state.claimContext,bookId:server.game.books[1].id});assert.equal(valid.status,200);assert.equal(valid.data.claim.status,'valid');
 assert.equal(valid.data.family.falseCounts[server.game.id],1);assert.equal((await server.store.game(server.game.id)).data.events.filter(event=>event.type==='window-closed').length,1);
});

test('S04: stale goal, round, pattern and foreign-show contexts do not claim, sanction or change a deadline',async t=>{
 const server=await api(t),original=context(server.game);
 for(const patch of [{goalId:'other-goal'},{roundId:'other-round'},{patternVersion:'other-pattern'},{gameId:crypto.randomUUID()},{brandId:'vlampie'},{epoch:'old-epoch'}]){
  const before=JSON.stringify((await server.store.game(server.game.id)).data),response=await server.call('begin',{claimContext:{...original,...patch}});assert.equal(response.status,409);assert.equal(response.data.error.code,'context_changed');assert.equal(JSON.stringify((await server.store.game(server.game.id)).data),before);
 }
 await server.store.mutate(server.game.id,{},g=>model.activateBlock(g,server.blockIndex,1));
 assert.equal((await server.call('begin',{claimContext:original})).status,409);
 assert.equal((await server.store.family('a')).data.falseCounts[server.game.id],undefined);
 const legacy=await server.call('begin',{epoch:(await server.store.game(server.game.id)).data.state.epoch});assert.equal(legacy.status,409,'oldest direct endpoint requires a complete context too');
});

test('S05: concurrent request collisions bind the authenticated actor, input and action without another family projection',async t=>{
 const server=await api(t),opened=(await server.call('begin',{claimContext:context(server.game)})).data.game,c=opened.state.claimContext;
 const body={requestId:'collision-claim-0001',claimContext:c},[a,b]=await Promise.all([server.call('claim',{...body,bookId:server.game.books[0].id}),server.call('claim',{...body,bookId:server.game.books[1].id})]);
 assert.deepEqual([a.status,b.status].sort(),[200,409]);let saved=(await server.store.game(server.game.id)).data;assert.equal(saved.state.window.claims.length,1);
 assert.equal((await server.call('begin',{claimContext:context(saved)},'b')).status,200);
 const ownB=await server.call('claim',{...body,bookId:server.game.books[2].id},'b');assert.equal(ownB.status,200);assert.equal(ownB.data.claim.accountId,'b');
 const chosen=a.status===200?server.game.books[0].id:server.game.books[1].id,first=a.status===200?a:b;
 const retry=await server.call('claim',{...body,bookId:chosen});assert.equal(retry.status,200);assert.deepEqual(retry.data.claim,first.data.claim);
 const changedGoal=await server.call('claim',{...body,bookId:chosen,claimContext:{...c,goalId:'different'}});assert.equal(changedGoal.status,409);assert.equal(changedGoal.data.error.code,'request_conflict');
 saved=(await server.store.game(server.game.id)).data;await server.store.mutate(saved.id,{},g=>{g.books.find(book=>book.id===chosen).accountId='b';});
 assert.equal((await server.call('claim',{...body,bookId:chosen})).status,403,'replay authorization uses current ownership, before receipt lookup');
});

test('S02: simultaneous refresh settlement persists one result and one winner, including an imported old result without goalKey',async t=>{
 const h=fixture();model.beginBingo(h.game,h.a,'a','first',Date.now()-40000);model.claimBook(h.game,h.a,'a',h.game.books[0].id,h.game.state.window.startedAt+1);
 const server=await api(t,h),[a,b]=await Promise.all([server.call(''),server.call('')]);assert.equal(a.status,200);assert.equal(b.status,200);
 const saved=(await server.store.game(h.game.id)).data;assert.equal(saved.results.length,1);assert.equal(saved.events.filter(event=>event.type==='window-closed').length,1);const winnerId=saved.results[0].winner.bookId;
 await server.store.mutate(h.game.id,{},g=>{const r=g.results[0];delete r.goalKey;delete r.roundId;delete r.goalId;r.acknowledged=true;g.state.phase='running';g.state.resultId=null;});
 const legacy=(await server.store.game(h.game.id)).data,before=JSON.stringify(legacy);assert.throws(()=>model.activateBlock(legacy,server.blockIndex,0),/afgerond/);assert.equal(JSON.stringify(legacy),before);assert.equal(legacy.results[0].winner.bookId,winnerId);
});

test('S03: imported invalid drafts fail publication, save and start; valid free centre completes at the last real ball',async t=>{
 const h=fixture();h.game.status='draft';h.game.state.phase='lobby';model.activeGoal(h.game).pattern.cells=[12];model.activeGoal(h.game).pattern.freeCenter=false;
 const server=await api(t,h),before=JSON.stringify((await server.store.game(h.game.id)).data);
 const refusedSave=await server.call('',{plan:h.game.plan},'host','PUT');assert.equal(refusedSave.status,400);assert.equal(refusedSave.data.error.code,'invalid_pattern');
 for(const action of ['publish-rules','start']){const response=await server.call(action,{},'host');assert.equal(response.status,400);assert.equal(response.data.error.code,'invalid_pattern');assert.equal(JSON.stringify((await server.store.game(h.game.id)).data),before);}
 const card=Array(25).fill(9);card[0]=1;card[12]=0;card[24]=75;const pattern={variant:'fixed',cells:[0,12,24],freeCenter:false};assert.equal(model.completionIndex(card,pattern,[]),null);assert.equal(model.completionIndex(card,pattern,[1]),null);assert.equal(model.completionIndex(card,pattern,[1,75]),2);
});

test('S05: public results use explicit aliases, own fields stay private and unrelated host family lists are scoped',async t=>{
 const h=fixture(),r=winner(h);r.acknowledged=true;r.winner.secret='never-project';r.secret='private-receipt';r.consolations=[{id:'award-id',bookId:h.game.books[2].id,accountId:'b',profileId:'private-child-b',name:'Kind 2',ticket:'0003',prize:{title:'Sticker',description:'',image:''}}];
 const projected=model.playerGame(h.game,'unrelated'),serialized=JSON.stringify(projected);
 for(const secret of ['private-receipt','never-project','private-child-b',...h.game.books.map(book=>book.id)])assert(!serialized.includes(secret));
 const publicResult=projected.results[0];for(const person of [publicResult.winner,...publicResult.entrants,...publicResult.consolations]){assert(!('bookId'in person));assert(!('accountId'in person));assert(!('profileId'in person));}
 assert.equal(model.playerGame(h.game,'a').results[0].winner.bookId,h.game.books[0].id);assert.equal(model.playerGame(h.game,'b').results[0].consolations[0].bookId,h.game.books[2].id);
 const server=await api(t,h);await server.store.editFamily('a','a@example.test',f=>{f.profiles=[{id:'child-a',name:'Kind A',age:9,dateOfBirth:'2017-01-01'}];});await server.store.editFamily('unrelated','other@example.test',f=>{f.profiles=[{id:'private-unrelated',name:'Private',age:42,dateOfBirth:'1984-01-01'}];});
 const response=await handleBingo(new Request('https://studio.example/api/bingo/families'),{DB:server.store.db,AUTH_IDENTITY:{user:'host',admin:true}});assert.equal(response.status,200);const familyData=await response.json();assert.equal(familyData.families.length,1);assert.equal(familyData.families[0].accountId,'a');assert(!JSON.stringify(familyData).includes('dateOfBirth'));assert(!JSON.stringify(familyData).includes('unrelated'));
});

test('L01 shared game invariant: every model draw path blocks callId and drawHold, including pending commit',()=>{
 for(const blocker of ['callId','drawHold']){const h=fixture(),pending=model.reserveBall(h.game);h.game.state[blocker]=blocker==='callId'?'call-id':{id:'hold-id'};const before=JSON.stringify(h.game);assert.throws(()=>model.reserveBall(h.game),/belmoment/);assert.throws(()=>model.commitBall(h.game,pending.token),/belmoment/);assert.throws(()=>model.activateBlock(h.game,h.blockIndex,1),/belmoment/);assert.equal(JSON.stringify(h.game),before);}
});

test('S01/S04: real cooldown persists; at the exact server deadline no claim or false sanction is accepted',async t=>{
 const h=fixture();h.game.settings.cooldownSeconds=60;h.game.books[0].cards[0][0]=2;const s=await api(t,h);
 const opened=(await s.call('begin',{claimContext:context(h.game)})).data.game;assert.equal((await s.call('claim',{bookId:h.game.books[0].id,claimContext:opened.state.claimContext})).data.claim.status,'false');
 await s.store.mutate(h.game.id,{},g=>{g.state.window.endsAt=Date.now()-1;model.settleWindow(g,Date.now());});const closed=(await s.store.game(h.game.id)).data,before=JSON.stringify(closed);
 assert.equal((await s.call('begin',{claimContext:context(closed)})).status,429);assert.equal(JSON.stringify((await s.store.game(h.game.id)).data),before);
 const pure=fixture();model.beginBingo(pure.game,pure.a,'a','open',100);const deadline=pure.game.state.window.endsAt,unchanged=JSON.stringify(pure.a);assert.throws(()=>model.claimBook(pure.game,pure.a,'a',pure.game.books[0].id,deadline),/gesloten/);assert.equal(JSON.stringify(pure.a),unchanged);assert.equal(pure.game.state.window.claims.length,0);assert.equal(model.settleWindow(pure.game,deadline).empty,true);
});

test('S04: an exact claim retry after window closure and progression returns its own immutable outcome without a second sanction',async t=>{
 const s=await api(t),opened=(await s.call('begin',{claimContext:context(s.game)})).data.game;
 const body={requestId:'retry-after-progression',bookId:s.game.books[0].id,claimContext:opened.state.claimContext};const initial=await s.call('claim',body);assert.equal(initial.status,200);
 await s.store.mutate(s.game.id,{},g=>{g.state.window.endsAt=Date.now()-1;const r=model.settleWindow(g,Date.now());r.acknowledged=true;g.state.resultId=null;g.state.phase='running';model.activateBlock(g,s.blockIndex,1);});
 const before=(await s.store.game(s.game.id)).data,retry=await s.call('claim',body);assert.equal(retry.status,200);assert.deepEqual(retry.data.claim,initial.data.claim);assert.equal(JSON.stringify((await s.store.game(s.game.id)).data),JSON.stringify(before));assert.equal(retry.data.family.falseCounts[s.game.id],undefined);
});

test('U01/S05: the published 150-book family limit applies to direct registration and host assignment atomically',async t=>{
 const h=fixture();h.game.status='draft';h.game.state.phase='lobby';h.game.books=[];h.game.batches=[];model.generateBooks(h.game,150,'limit-first');model.generateBooks(h.game,1,'limit-extra');h.game.books.slice(0,150).forEach(book=>Object.assign(book,{accountId:'a',profileId:'child-a',name:'Fixture'}));
 const {publishGameRules}=await import('../server/game-rules.js');publishGameRules(h.game);const s=await api(t,h);await s.store.editFamily('a','a@example.test',family=>{family.profiles=[{id:'child-a',name:'Fixture',age:10}];});
 const extra=h.game.books[150],before=JSON.stringify((await s.store.game(h.game.id)).data);
 const denied=await s.call('register',{profileId:'child-a',code:extra.code});assert.equal(denied.status,409);assert.equal(denied.data.error.code,'book_limit');assert.equal(JSON.stringify((await s.store.game(h.game.id)).data),before);
 const assigned=await s.call('book-state',{operation:'assign',accountId:'a',profileId:'child-a',bookId:extra.id},'host');assert.equal(assigned.status,409);assert.equal(assigned.data.error.code,'book_limit');assert.equal(JSON.stringify((await s.store.game(h.game.id)).data),before);
 const unrelated=await s.call('book-state',{operation:'assign',accountId:'a',profileId:'child-a',bookId:extra.id},'b');assert.equal(unrelated.status,403);
 const ownAgain=await s.call('register',{profileId:'child-a',code:h.game.books[0].code});assert.equal(ownAgain.status,200);assert.equal(ownAgain.data.game.books.length,150,'an exact existing ownership does not spend a second slot');
});

test('S05: the original bound claim outcome survives more than 250 other operations without a growing replay cache',async t=>{
 const s=await api(t),beginBody={requestId:'durable-begin-operation',claimContext:context(s.game)},opened=(await s.call('begin',beginBody)).data.game;
 const body={requestId:'durable-claim-operation',bookId:s.game.books[0].id,claimContext:opened.state.claimContext},initial=await s.call('claim',body);assert.equal(initial.status,200);assert(!('operation'in initial.data.claim));assert(!('operation'in initial.data.game.state.window.claims[0]));
 await s.store.mutate(s.game.id,{},g=>{g.state.window.endsAt=Date.now()-1;const r=model.settleWindow(g,Date.now());r.acknowledged=true;g.state.resultId=null;g.state.phase='running';model.activateBlock(g,s.blockIndex,1);});
 for(let i=0;i<260;i++)await s.store.mutate(s.game.id,{requestId:'unrelated-operation-'+i},g=>{g.state.paused=!!(i%2);});
 let saved=(await s.store.game(s.game.id)).data;assert.equal(saved.ops.length,250);assert(!saved.ops.some(key=>key.includes(body.requestId)));const before=JSON.stringify(saved);
 const retry=await s.call('claim',body);assert.equal(retry.status,200);assert.deepEqual(retry.data.claim,initial.data.claim);assert.equal(JSON.stringify((await s.store.game(s.game.id)).data),before);
 const beginRetry=await s.call('begin',beginBody);assert.equal(beginRetry.status,200);assert.equal(JSON.stringify((await s.store.game(s.game.id)).data),before);
 const changed=await s.call('claim',{...body,bookId:s.game.books[1].id});assert.equal(changed.status,409);assert.equal(changed.data.error.code,'request_conflict');assert(!JSON.stringify(changed.data).includes(s.game.books[1].id));
 await s.store.mutate(s.game.id,{},g=>{g.books[0].accountId='b';});assert.equal((await s.call('claim',body)).status,403);
 saved=(await s.store.game(s.game.id)).data;assert.equal(saved.operationReceipts.length,2,'only two bounded cache receipts; durable primary binding lives with its original private record');
});

test('U01: a legacy draft above the family limit blocks publication and start without rewriting existing books',async t=>{
 const h=fixture();h.game.status='draft';h.game.books=[];h.game.batches=[];model.generateBooks(h.game,150,'legacy-limit-one');model.generateBooks(h.game,1,'legacy-limit-two');h.game.books.forEach(book=>Object.assign(book,{accountId:'a',name:'Fixture'}));const s=await api(t,h),before=JSON.stringify((await s.store.game(h.game.id)).data);
 for(const action of ['publish-rules','start']){const response=await s.call(action,{},'host');assert.equal(response.status,409);assert.equal(response.data.error.code,'book_limit');assert.equal(JSON.stringify((await s.store.game(h.game.id)).data),before);}
});

test('U03/L01: a direct start cannot activate a draft while a durable call cleanup hold remains',async t=>{
 const h=fixture();h.game.status='draft';h.game.state.phase='lobby';h.game.state.drawHold={id:'fixture-held-call',status:'cleanup-required',checkpoint:{drawn:1}};
 const server=await api(t,h);await server.call('publish-rules',{},'host');
 const before=JSON.stringify((await server.store.game(h.game.id)).data),response=await server.call('start',{},'host');
 assert.equal(response.status,409);assert.equal(response.data.error.code,'call_draw_hold');assert.equal(JSON.stringify((await server.store.game(h.game.id)).data),before);
});
