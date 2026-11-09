import test from 'node:test';
import assert from 'node:assert/strict';
import {createSqliteDatabase} from '../server/node-storage.js';
import {createGameMutationQueue} from '../server/node-game-queue.js';
import {BingoStore} from '../server/bingo-store.js';
import {handleBingo} from '../server/bingo.js';
import {makeGame,generateBooks,activateBlock,activeGoal,beginBingo,claimContext,settleWindow} from '../server/bingo-model.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

function optIntoQueueForTest(t){
 const mutate=BingoStore.prototype.mutate;
 // Production opts in only for family begin/claim. These optional-mode clock
 // cases deliberately exercise the generic store contract, not route policy.
 t.mock.method(BingoStore.prototype,'mutate',function(id,options={},operation){return mutate.call(this,id,{...options,serializeLocal:true},operation);});
}

async function fixture(t,{window=true}={}){
 const clock={now:1800000000000};t.mock.method(Date,'now',()=>clock.now);
 const db=createSqliteDatabase(':memory:'),queue=createGameMutationQueue(),held=new Set();
 // Use the real native scheduling hook with a local durable SQL adapter. These
 // tests cover HTTP/model timing, not PostgreSQL network or throughput proof.
 db.kind='postgres';db.withGameMutation=(id,operation)=>queue.run(id,operation);
 t.after(async()=>{for(const release of held)release();await queue.close();await db.close();});
 const store=new BingoStore(db),game=makeGame({brandId:'milo',date:'2027-12-05T19:00:00Z',roundCount:1},'host','https://studio.example',clock.now);
 generateBooks(game,1,'queued-time-fixture',clock.now);Object.assign(game.books[0],{accountId:'family',profileId:'child',name:'Voorbeeld',admitted:true});
 game.status='running';activateBlock(game,game.plan.blocks.findIndex(block=>block.type==='round'),0,clock.now);
 activeGoal(game).pattern.cells=[0];game.books[0].cards[0][0]=2;game.state.drawn=[1];
 const family=await store.family('family');
 if(window)beginBingo(game,family.data,'family','initial-announcement',clock.now-1000);
 await store.create(game);
 const call=async(action,body={},user='family')=>{
  const response=await handleBingo(new Request(`https://studio.example/api/bingo/games/${game.id}/${action}`,{method:'POST',headers:{Origin:'https://studio.example','X-Vlampie-Bingo':'1','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),regieId:'regie-current',...body})}),{DB:db,AUTH_IDENTITY:{user,email:user+'@example.test',admin:user==='host'}});
  return {status:response.status,data:await response.json()};
 };
 const snapshot=async()=>({game:await db.prepare('SELECT revision,document FROM bingo_games WHERE id = ?').bind(game.id).first(),family:await db.prepare('SELECT revision,document FROM bingo_families WHERE account_id = ?').bind('family').first()});
 const enqueue=async(action,body={},user='family')=>{
  const gate=deferred(),entered=deferred(),queued=deferred();held.add(gate.resolve);
  const blocking=queue.run(game.id,async()=>{entered.resolve();await gate.promise;});await entered.promise;
  const original=db.withGameMutation;
  db.withGameMutation=(id,operation)=>{const pending=original(id,operation);queued.resolve();return pending;};
  const response=call(action,body,user);
  try{await Promise.race([queued.promise,response.then(result=>{throw Error('The API returned before queue admission: '+JSON.stringify(result));})]);}
  finally{db.withGameMutation=original;}
  return async executionNow=>{clock.now=executionNow;gate.resolve();await blocking;held.delete(gate.resolve);return response;};
 };
 return {db,store,game,clock,call,snapshot,enqueue};
}

for(const action of ['claim','begin','extend'])test(`${action==='extend'?'optional store mode: ':''}queued ${action} is rejected at the exact server deadline without a sanction, deadline or control-lease write`,{timeout:3000},async t=>{
 const h=await fixture(t),before=await h.snapshot(),deadline=h.game.state.window.endsAt;
 if(action==='extend')optIntoQueueForTest(t);
 h.clock.now=deadline-1;
 const release=await h.enqueue(action,{claimContext:claimContext(h.game),bookId:h.game.books[0].id,serializeLocal:false,...(action==='extend'?{seconds:60}:{})},action==='extend'?'host':'family');
 const result=await release(deadline);assert.equal(result.status,409,JSON.stringify(result.data));assert.equal(result.data.error.code,'closed');
 assert.deepEqual(await h.snapshot(),before,'a queued expired operation must not commit any game/family changes');
});

test('a queued first announcement opens its full configured window from execution time',{timeout:3000},async t=>{
 const h=await fixture(t,{window:false}),received=h.clock.now,release=await h.enqueue('begin',{claimContext:claimContext(h.game)});
 const executed=received+9000,result=await release(executed);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.serverTime,executed,'the family timer must not inherit time spent waiting in the queue');
 const stored=(await h.store.game(h.game.id)).data;assert.equal(stored.state.window.startedAt,executed);assert.equal(stored.state.window.endsAt,executed+stored.settings.claimSeconds*1000);assert.equal(stored.state.window.announcements[0].at,executed);
});

test('optional store mode: a queued control heartbeat checks the current lease and grants fifteen seconds from execution',{timeout:3000},async t=>{
 const h=await fixture(t,{window:false}),received=h.clock.now,oldUntil=received+5000;
 await h.store.mutate(h.game.id,{},game=>{game.state.control={id:'earlier-regie',until:oldUntil};});
 optIntoQueueForTest(t);
 const release=await h.enqueue('heartbeat',{},'host'),executed=oldUntil+1,result=await release(executed);
 assert.equal(result.status,200,JSON.stringify(result.data));assert.deepEqual((await h.store.game(h.game.id)).data.state.control,{id:'regie-current',until:executed+15000});
});

test('the actual control heartbeat route uses normal CAS without entering the native family FIFO',{timeout:3000},async t=>{
 const h=await fixture(t,{window:false});
 t.mock.method(h.db,'withGameMutation',()=>assert.fail('a non-family route must not enter the local queue'));
 const result=await h.call('heartbeat',{serializeLocal:true},'host');assert.equal(result.status,200,JSON.stringify(result.data));
 assert.deepEqual((await h.store.game(h.game.id)).data.state.control,{id:'regie-current',until:h.clock.now+15000});
});

test('an accepted durable claim replay after settlement returns its original receipt without another sanction or mutation',{timeout:3000},async t=>{
 const h=await fixture(t),body={requestId:'accepted-claim-before-deadline',claimContext:claimContext(h.game),bookId:h.game.books[0].id},first=await h.call('claim',body);
 assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.claim.status,'false');assert.equal(first.data.family.falseCounts[h.game.id],1);
 h.clock.now=h.game.state.window.endsAt;
 await h.store.mutate(h.game.id,{},game=>settleWindow(game,h.clock.now));
 const before=await h.snapshot(),release=await h.enqueue('claim',body),retry=await release(h.clock.now+1000);
 assert.equal(retry.status,200,JSON.stringify(retry.data));assert.deepEqual(retry.data.claim,first.data.claim);assert.equal(retry.data.family.falseCounts[h.game.id],1);assert.deepEqual(await h.snapshot(),before);
});

test('a lost database CAS refreshes the execution clock before retrying a claim at the deadline',{timeout:3000},async t=>{
 const h=await fixture(t),deadline=h.game.state.window.endsAt,batch=h.db.batch.bind(h.db);h.clock.now=deadline-1;
 let attempts=0,externalSnapshot;
 h.db.batch=async statements=>{
  attempts++;
  if(attempts===1){
   // An independent writer bypasses this process's queue. Keep its actual SQL
   // revision change while the original game/family batch loses and rolls back.
   const row=await h.store.game(h.game.id),external={...row.data,revision:row.revision+1,externalWriter:true};
   await h.db.prepare('UPDATE bingo_games SET revision = ?,document = ? WHERE id = ? AND revision = ? RETURNING revision').bind(external.revision,JSON.stringify(external),h.game.id,row.revision).first();
   externalSnapshot=await h.snapshot();h.clock.now=deadline;
  }
  return batch(statements);
 };
 const result=await h.call('claim',{claimContext:claimContext(h.game),bookId:h.game.books[0].id});
 assert.equal(result.status,409,JSON.stringify(result.data));assert.equal(result.data.error.code,'closed');assert.equal(attempts,1,'the retry must refuse before another write');assert.deepEqual(await h.snapshot(),externalSnapshot);
});
