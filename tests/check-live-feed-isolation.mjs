import test from 'node:test';
import assert from 'node:assert/strict';
import {createSqliteDatabase} from '../server/node-storage.js';
import {makeGame,generateBooks,activateBlock} from '../server/bingo-model.js';
import {BingoStore} from '../server/bingo-store.js';
import {publishGameRules} from '../server/game-rules.js';
import {handleLiveFeed} from '../server/live-feed.js';
import {FamilyLiveFeed} from '../frontend/family-live-feed.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const snapshot=(account,revision=1)=>({complete:true,scope:'scope-'+account,game:{id:'fixture-game',revision,brandId:'milo',books:[{id:'private-book-'+account}],state:{drawn:Array.from({length:revision},(_,i)=>i+1)}},booksVersion:'books-'+account,configVersion:'config',familyRevision:1});

test('equal numeric versions from another family never authorize unchanged or reuse its books',async t=>{
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const store=new BingoStore(DB),game=makeGame({brandId:'milo',date:'2027-01-15T19:00',timeZone:'Europe/Amsterdam'},'host','https://fixture.example');generateBooks(game,2,'isolated-feed');
 game.books.forEach((book,i)=>Object.assign(book,{accountId:i?'family-b':'family-a',profileId:'private-child-'+i,name:i?'Alias B':'Alias A'}));publishGameRules(game);game.status='running';activateBlock(game,game.plan.blocks.findIndex(b=>b.type==='round'));await store.create(game);
 for(const user of ['family-a','family-b'])await store.family(user,user+'@example.test');
 const read=async(user,query)=>{const response=await handleLiveFeed(new Request('https://fixture.example/api/bingo/games/'+game.id+'/live?brand=milo&'+query),{DB,AUTH_IDENTITY:{user,email:user+'@example.test',admin:false,method:'test-provider'}});assert.equal(response.status,200);return response.json();};
 const a=await read('family-a','snapshot=1'),query=new URLSearchParams({since:a.game.revision,familySince:a.familyRevision,booksVersion:a.booksVersion,configVersion:a.configVersion,scope:a.scope});
 const b=await read('family-b',query);assert.equal(b.game.revision,a.game.revision);assert.equal(b.familyRevision,a.familyRevision);assert.equal(b.complete,true);assert.notEqual(b.scope,a.scope);assert(b.game.books.every(book=>book.accountId==='family-b'));assert(!JSON.stringify(b).includes(a.game.books[0].id));
 const own=new URLSearchParams({since:b.game.revision,familySince:b.familyRevision,booksVersion:b.booksVersion,configVersion:b.configVersion,scope:b.scope});const unchanged=await read('family-b',own);assert.equal(unchanged.unchanged,true);assert.equal(unchanged.scope,b.scope);
});

test('a response arriving after account change cannot repopulate the previous family cache',async()=>{
 const first=deferred(),paths=[];let count=0;const client=new FamilyLiveFeed(async path=>{paths.push(path);return ++count===1?first.promise:snapshot('b');});client.setAccount('family-a');
 const stale=client.read('fixture-game','milo'),rejected=assert.rejects(stale,error=>error.name==='AbortError');client.setAccount('family-b');first.resolve(snapshot('a'));await rejected;
 const current=await client.read('fixture-game','milo');assert.equal(current.game.books[0].id,'private-book-b');assert(new URL(paths[1],'https://fixture.example').searchParams.has('snapshot'));assert(!JSON.stringify(current).includes('private-book-a'));
});

test('logout-style clear invalidates an in-flight request even when the same account later returns',async()=>{
 const first=deferred();let count=0;const client=new FamilyLiveFeed(async()=>++count===1?first.promise:snapshot('a',2));client.setAccount('family-a');const stale=client.read('fixture-game','milo'),rejected=assert.rejects(stale,error=>error.name==='AbortError');client.clear();first.resolve(snapshot('a',1));await rejected;assert.equal(client.entries.size,0);assert.equal((await client.read('fixture-game','milo')).game.revision,2);
});

test('two concurrent snapshots cannot roll back the current account cache when an older response arrives late',async()=>{
 const older=deferred(),newer=deferred();let count=0;const client=new FamilyLiveFeed(()=>++count===1?older.promise:newer.promise);client.setAccount('family-a');const a=client.read('fixture-game','milo'),b=client.read('fixture-game','milo');newer.resolve(snapshot('a',2));assert.equal((await b).game.revision,2);older.resolve(snapshot('a',1));assert.equal((await a).game.revision,2);assert.equal(client.entries.get('fixture-game').game.revision,2);
});
