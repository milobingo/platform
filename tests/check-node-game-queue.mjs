import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createGameMutationQueue} from '../server/node-game-queue.js';
import {createPostgresDatabase,createSqliteDatabase,postgresSql} from '../server/node-storage.js';
import {BingoStore} from '../server/bingo-store.js';
import {assertOwnedBook,assertDrawAvailable} from '../server/bingo-model.js';
import {loadManifest} from '../scripts/deploy/database.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const errorCode=code=>error=>error.status===503&&error.code===code;
const game=()=>({id:randomUUID(),ownerId:'host',brandId:'vlampie',books:[],ops:[],events:[],state:{},status:'draft',counter:0});

test('native FIFO is fair per game, independent across games, and exposes only aggregate metrics',{timeout:2000},async()=>{
 const queue=createGameMutationQueue(),gate=deferred(),entered=deferred(),order=[];
 const first=queue.run('private-game-id',async()=>{order.push(1);entered.resolve();await gate.promise;});await entered.promise;
 const pending=[queue.run('private-game-id',()=>order.push(2)),queue.run('private-game-id',()=>order.push(3))];
 await queue.run('other-game',()=>order.push('other'));assert.deepEqual(order,[1,'other']);
 assert.equal(queue.snapshot().pending,3);assert.equal(queue.snapshot().keys,1);assert(!JSON.stringify(queue.snapshot()).includes('private-game-id'));
 gate.resolve();await Promise.all([first,...pending]);assert.deepEqual(order,[1,'other',2,3]);assert.equal(queue.snapshot().pending,0);assert.equal(queue.snapshot().active,0);assert.equal(queue.snapshot().keys,0);assert.equal(queue.snapshot().completed,4);assert.equal(queue.snapshot().maxDepth,3);await queue.close();
});

test('per-game and adapter admission bounds return retriable503 without discarding accepted FIFO slots',{timeout:2000},async()=>{
 const queue=createGameMutationQueue({maxPendingPerGame:2,maxPending:3}),gate=deferred(),order=[];
 const active=queue.run('a',()=>gate.promise),waiting=queue.run('a',()=>order.push('a'));
 await assert.rejects(queue.run('a',()=>assert.fail('overfull game must not run')),errorCode('game_queue_full'));
 const other=queue.run('b',()=>gate.promise);await assert.rejects(queue.run('c',()=>assert.fail('overfull adapter must not run')),errorCode('game_queue_full'));
 gate.resolve();await Promise.all([active,waiting,other]);assert.deepEqual(order,['a']);assert.equal(queue.snapshot().rejected,2);assert.equal(queue.snapshot().keys,0);await queue.close();
});

test('waiting TTL rejects before callback entry and later work still executes; source error does not poison the queue',{timeout:2000},async()=>{
 const queue=createGameMutationQueue({maxWaitMs:20}),gate=deferred(),entered=deferred();
 const active=queue.run('a',async()=>{entered.resolve();await gate.promise;});await entered.promise;
 const expired=queue.run('a',()=>assert.fail('expired operation must never enter'));await assert.rejects(expired,errorCode('game_queue_timeout'));assert.equal(queue.snapshot().expired,1);assert.equal(queue.snapshot().pending,1);
 gate.resolve();await active;await assert.rejects(queue.run('a',()=>{throw Error('injected callback failure');}),/injected callback failure/);assert.equal(await queue.run('a',()=>42),42);assert.equal(queue.snapshot().keys,0);await queue.close();
});

test('nested same-key, cross-key and cross-adapter waits fail immediately instead of forming lock cycles',{timeout:2000},async()=>{
 const queue=createGameMutationQueue(),other=createGameMutationQueue();
 for(const [target,key] of [[queue,'a'],[queue,'b'],[other,'a']])await assert.rejects(queue.run('a',()=>target.run(key,()=>assert.fail('nested callback cannot run'))),errorCode('game_queue_nested'));
 assert.equal(await queue.run('a',()=>17),17);assert.equal(queue.snapshot().pending,0);assert.equal(other.snapshot().pending,0);await Promise.all([queue.close(),other.close()]);
});

test('closing rejects pending work and new admission, then drains the active operation before resolving',{timeout:2000},async()=>{
 const queue=createGameMutationQueue(),gate=deferred(),entered=deferred();let closed=false;
 const active=queue.run('a',async()=>{entered.resolve();await gate.promise;return 'committed';});await entered.promise;
 const rejected=assert.rejects(queue.run('a',()=>assert.fail('closed waiter cannot run')),errorCode('game_queue_closed'));
 const closing=queue.close().then(()=>{closed=true;});await rejected;await tick();assert.equal(closed,false);await assert.rejects(queue.run('b',()=>{}),errorCode('game_queue_closed'));
 gate.resolve();assert.equal(await active,'committed');await closing;assert.equal(closed,true);assert.equal(queue.snapshot().pending,0);assert.equal(queue.snapshot().keys,0);await queue.close();
});

test('SQLite does not acquire the native queue, including when an unrelated hook is present',async()=>{
 const db=createSqliteDatabase(':memory:');try{db.withGameMutation=()=>assert.fail('SQLite must retain its original mutation path');const store=new BingoStore(db),g=game();await store.create(g);await store.mutate(g.id,{serializeLocal:true},current=>{current.counter++;});assert.equal((await store.game(g.id)).data.counter,1);assert.equal(db.gameMutationQueueStats,undefined);}finally{await db.close();}
});

const testUrl=process.env.MILO_TEST_DATABASE_URL;
let fixture;
async function dropDatabase(admin,name){
 for(let attempt=0;attempt<40;attempt++){
  try{await admin.query('DROP DATABASE "'+name+'"');return;}catch(error){if(error.code!=='55006')throw error;if(attempt===39)throw Error('The isolated queue fixture still has a live connection after cleanup.');await new Promise(resolve=>setTimeout(resolve,50));}
 }
}
before(async()=>{
 if(!testUrl)return;
 const base=new URL(testUrl);assert(['127.0.0.1','localhost','[::1]'].includes(base.hostname)&&/test/i.test(base.pathname),'Queue integration requires an explicitly local test database.');
 const admin=new Pool({connectionString:testUrl}),name='milo_queue_test_'+randomUUID().replaceAll('-',''),idleErrors=[];let source,db,other,created=false;
 admin.on('error',()=>idleErrors.push('admin_pool_error'));
 try{
  await admin.query('CREATE DATABASE "'+name+'"');created=true;base.pathname='/'+name;source=new Pool({connectionString:base.toString()});source.on('error',()=>idleErrors.push('source_pool_error'));
  for(const migration of (await loadManifest()).migrations)await source.query(migration.sql);
  db=await createPostgresDatabase(base.toString(),{allowLoopback:true});other=await createPostgresDatabase(base.toString(),{allowLoopback:true});fixture={admin,name,source,db,other,idleErrors};
 }catch(error){await db?.close();await other?.close();await source?.end();try{if(created)await dropDatabase(admin,name);}finally{await admin.end();}throw error;}
});
after(async()=>{if(!fixture)return;await fixture.db.close();await fixture.other.close();await fixture.source.end();try{await dropDatabase(fixture.admin,fixture.name);assert.deepEqual(fixture.idleErrors,[]);}finally{await fixture.admin.end();}});

test('actual PostgreSQL explicitly selected family writes serialize100 requests across store instances with no local CAS retries',{skip:!testUrl,timeout:20000},async()=>{
 const {db}=fixture,g=game();await new BingoStore(db).create(g);const before=db.gameMutationQueueStats(),batch=db.batch.bind(db);let conflicts=0;
 db.batch=async statements=>{const results=await batch(statements);if(!results[0]?.results?.length)conflicts++;return results;};
 try{await Promise.all(Array.from({length:100},(_,i)=>new BingoStore(db).mutate(g.id,{serializeLocal:true,accountId:'family-'+i,requestId:'fifo-request-'+i},(current,family)=>{current.counter++;family.counter=(family.counter||0)+1;})));}finally{db.batch=batch;}
 const store=new BingoStore(db),saved=await store.game(g.id),stats=db.gameMutationQueueStats();assert.equal(saved.data.counter,100);assert.equal(saved.revision,101);assert.equal(conflicts,0);assert.equal(stats.started-before.started,100);assert.equal(stats.completed-before.completed,100);assert.equal(stats.pending,0);assert.equal(stats.keys,0);
 for(let i=0;i<100;i++)assert.equal((await store.family('family-'+i)).data.counter,1);
});

test('actual PostgreSQL waiting does not consume pool connections or block another game',{skip:!testUrl,timeout:10000},async()=>{
 const {db}=fixture,gate=deferred(),entered=deferred(),g=game();await new BingoStore(db).create(g);
 const active=db.withGameMutation('held-without-connection',async()=>{entered.resolve();await gate.promise;});await entered.promise;
 const waiting=Array.from({length:20},()=>db.withGameMutation('held-without-connection',()=>{}));
 try{await Promise.all(Array.from({length:10},()=>db.prepare('SELECT 1 AS value').first()));await new BingoStore(db).mutate(g.id,{},current=>{current.counter++;});assert.equal((await new BingoStore(db).game(g.id)).data.counter,1);}finally{gate.resolve();await Promise.all([active,...waiting]);}
});

test('actual PostgreSQL authority is refreshed after waiting and before an existing durable replay',{skip:!testUrl,timeout:10000},async()=>{
 const {db}=fixture,store=new BingoStore(db),g=game(),gate=deferred(),entered=deferred();g.books=[{id:'owned-book',accountId:'a',admitted:true}];await store.create(g);let replayChecks=0;
 const change=store.mutate(g.id,{serializeLocal:true},async current=>{entered.resolve();await gate.promise;current.books[0].accountId='b';});await entered.promise;
 const denied=assert.rejects(new BingoStore(db).mutate(g.id,{serializeLocal:true,authorize:current=>assertOwnedBook(current,'a','owned-book'),durableReplay:()=>{replayChecks++;return {result:'private-old-receipt'};}},()=>assert.fail('forbidden replay must never mutate')),error=>error.status===403);
 gate.resolve();await change;await denied;assert.equal(replayChecks,0);assert.equal((await store.game(g.id)).data.books[0].accountId,'b');
});

test('another real PostgreSQL adapter bypasses the local FIFO safely: original CAS retries and rejects the newly committed call hold',{skip:!testUrl,timeout:10000},async()=>{
 const {db,other}=fixture,store=new BingoStore(db),external=new BingoStore(other),g=game(),gate=deferred(),entered=deferred();await store.create(g);let attempts=0;const executionTimes=[];
 const local=assert.rejects(store.mutate(g.id,{serializeLocal:true,requestId:'queued-draw'},async(current,_family,executionNow)=>{attempts++;executionTimes.push(executionNow);assertDrawAvailable(current);if(attempts===1){entered.resolve();await gate.promise;}current.counter++;}),error=>error.code==='call_draw_hold');await entered.promise;
 await external.mutate(g.id,{requestId:'external-hold'},current=>{current.state.drawHold={id:'external-call'};});gate.resolve();await local;
 const saved=await store.game(g.id);assert.equal(attempts,2);assert(executionTimes.every(Number.isSafeInteger));assert(executionTimes[1]>executionTimes[0],'Each CAS retry must receive a fresh server execution time');assert.equal(saved.data.counter,0);assert.equal(saved.data.state.drawHold.id,'external-call');assert.equal(saved.revision,2);
});

test('an ordinary mutation on the same native adapter bypasses a busy family FIFO and still forces a safe fresh CAS retry',{skip:!testUrl,timeout:10000},async()=>{
 const {db}=fixture,store=new BingoStore(db),g=game(),gate=deferred(),entered=deferred();await store.create(g);const before=db.gameMutationQueueStats();let attempts=0;
 const family=store.mutate(g.id,{serializeLocal:true,requestId:'queued-family'},async current=>{attempts++;if(attempts===1){entered.resolve();await gate.promise;}current.counter++;});await entered.promise;
 try{await store.mutate(g.id,{requestId:'ordinary-controller'},current=>{current.counter++;});assert.equal((await store.game(g.id)).data.counter,1);assert.equal(db.gameMutationQueueStats().started-before.started,1,'An ordinary command must not be enqueued behind a family burst');}finally{gate.resolve();}
 await family;assert.equal(attempts,2);assert.equal((await store.game(g.id)).data.counter,2);assert.equal(db.gameMutationQueueStats().pending,0);
});

test('a real PostgreSQL adapter facade without the optional hook retains the original concurrent CAS contract',{skip:!testUrl,timeout:10000},async()=>{
 const {db}=fixture,facade={kind:'postgres',prepare:db.prepare,batch:db.batch.bind(db)},store=new BingoStore(facade),g=game(),gate=deferred(),entered=deferred();await store.create(g);let attempts=0;
 const first=store.mutate(g.id,{serializeLocal:true,requestId:'without-hook-a'},async current=>{attempts++;if(attempts===1){entered.resolve();await gate.promise;}current.counter++;});await entered.promise;
 await store.mutate(g.id,{serializeLocal:true,requestId:'without-hook-b'},current=>{current.counter++;});gate.resolve();await first;
 assert.equal((await store.game(g.id)).data.counter,2);assert.equal(attempts,2);assert.equal(facade.withGameMutation,undefined);
});

test('actual PostgreSQL transaction failure after the first statement rolls back game/family and releases the FIFO for a successful retry',{skip:!testUrl,timeout:10000},async()=>{
 const {db,source}=fixture,store=new BingoStore(db),g=game();await store.create(g);const family=await store.family('rollback-family'),before=await store.game(g.id),batch=db.batch.bind(db);let inject=true;
 db.batch=async statements=>{
  if(!inject)return batch(statements);inject=false;const client=await source.connect();
  try{await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await client.query(postgresSql(statements[0].sql),statements[0].args);throw Error('injected after game write');}finally{await client.query('ROLLBACK');client.release();}
 };
 const action=()=>new BingoStore(db).mutate(g.id,{serializeLocal:true,accountId:'rollback-family',requestId:'rollback-stable'},(current,currentFamily)=>{current.counter++;currentFamily.counter=(currentFamily.counter||0)+1;});
 try{await assert.rejects(action(),/injected after game write/);assert.deepEqual(await store.game(g.id),before);assert.equal((await store.family('rollback-family')).revision,family.revision);await action();assert.equal((await store.game(g.id)).data.counter,1);assert.equal((await store.family('rollback-family')).data.counter,1);assert.equal(db.gameMutationQueueStats().pending,0);}finally{db.batch=batch;}
});
