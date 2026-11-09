import test from 'node:test';
import assert from 'node:assert/strict';
import {createSqliteDatabase} from '../server/node-storage.js';
import {makeGame,generateBooks,activateBlock,playerGame} from '../server/bingo-model.js';
import {BingoStore} from '../server/bingo-store.js';
import {publishGameRules} from '../server/game-rules.js';
import {handleLiveFeed} from '../server/live-feed.js';
import {FamilyLiveFeed} from '../frontend/family-live-feed.js';

async function fixture(){
 const DB=createSqliteDatabase(':memory:'),store=new BingoStore(DB),game=makeGame({date:'2027-11-18T13:30',timeZone:'Europe/Amsterdam',brandId:'milo',roundCount:4},'host','https://studio.example');
 generateBooks(game,6,'feed-fixture');game.books.forEach((b,i)=>Object.assign(b,{accountId:i<3?'family-a':'family-b',profileId:'private-profile-'+i,name:i<3?'Alias A':'Alias B'}));
 publishGameRules(game);game.status='running';activateBlock(game,game.plan.blocks.findIndex(b=>b.type==='round'));await store.create(game);
 for(const user of ['family-a','family-b'])await store.family(user,user+'@example.test');
 const read=async(user,query='')=>handleLiveFeed(new Request('https://studio.example/api/bingo/games/'+game.id+'/live?brand=milo&'+query),{DB,AUTH_IDENTITY:{user,email:user+'@example.test',admin:false,method:'test-provider'}});
 return {DB,store,game,read};
}
test('feed versions reduce payload, preserve cards and converge after a missed update',async()=>{
 const f=await fixture(),first=await (await f.read('family-a','snapshot=1')).json();assert(first.complete);assert.equal(first.game.books.length,3);
 const q=new URLSearchParams({scope:first.scope,since:first.game.revision,familySince:first.familyRevision,booksVersion:first.booksVersion,configVersion:first.configVersion});
 const same=await (await f.read('family-a',q)).json();assert(same.unchanged);assert(!same.game);
 await f.store.mutate(f.game.id,{},g=>{g.state.drawn=[1,17,44];});
 const delta=await (await f.read('family-a',q)).json();assert(!delta.complete);assert(!delta.game.books);assert.deepEqual(delta.game.state.drawn,[1,17,44]);
 assert(Buffer.byteLength(JSON.stringify(same))<Buffer.byteLength(JSON.stringify(first))/10);
 assert(Buffer.byteLength(JSON.stringify(delta))<Buffer.byteLength(JSON.stringify(first))/2);
 const sizes={fullBytes:Buffer.byteLength(JSON.stringify(first)),unchangedBytes:Buffer.byteLength(JSON.stringify(same)),updateBytes:Buffer.byteLength(JSON.stringify(delta))};console.log(JSON.stringify({feedMeasurements:sizes}));
 let queryIndex=0;const client=new FamilyLiveFeed(async()=>[first,delta,{...same,scope:first.scope}][queryIndex++]);
 await client.read(f.game.id,'milo');const current=await client.read(f.game.id,'milo');assert.deepEqual(current.game.books,first.game.books);assert.deepEqual(current.game.state.drawn,[1,17,44]);assert.equal((await client.read(f.game.id,'milo')).game.revision,current.game.revision);
 await f.DB.close();
});
test('feed scope, account revocation, brand variants and database caches remain isolated',async()=>{
 const f=await fixture(),a=await (await f.read('family-a','snapshot=1')).json(),b=await (await f.read('family-b','snapshot=1&accountId=family-a')).json();
 assert(b.game.books.every(book=>book.accountId==='family-b'));assert(!JSON.stringify(b).includes(a.game.books[0].id));
 const wrong=await handleLiveFeed(new Request('https://studio.example/api/bingo/games/'+f.game.id+'/live?brand=vlampie'),{DB:f.DB,AUTH_IDENTITY:{user:'family-a',email:'family-a@example.test'}});assert.equal(wrong.status,403);
 const anonymous=await handleLiveFeed(new Request('https://studio.example/api/bingo/games/'+f.game.id+'/live?brand=milo'),{DB:f.DB,AUTH_IDENTITY:null});assert.equal(anonymous.status,401);
 await f.store.mutate(f.game.id,{},g=>{g.books[0].revokedAt=Date.now();});const revoked=await (await f.read('family-a','snapshot=1')).json();assert(revoked.game.books[0].revokedAt);
 const other=createSqliteDatabase(':memory:');await new BingoStore(other).create({...f.game,title:'Separate database'});
 const response=await handleLiveFeed(new Request('https://studio.example/api/bingo/games/'+f.game.id+'/live?brand=milo&snapshot=1'),{DB:other,AUTH_IDENTITY:{user:'family-a',email:'family-a@example.test'}});assert.equal((await response.json()).game.title,'Separate database');
 await other.close();await f.DB.close();
});
test('the feed closes an expired window before answering unchanged',async()=>{
 const f=await fixture();await f.store.mutate(f.game.id,{},g=>{g.state.phase='window';g.state.window={id:'expired',status:'open',startedAt:Date.now()-40000,endsAt:Date.now()-1,frozenAt:0,epoch:g.state.epoch,claims:[],announcements:[]};});
 const before=await f.store.game(f.game.id),response=await f.read('family-a','since='+before.revision+'&familySince=1');assert.equal(response.status,200);
 assert.equal((await f.store.game(f.game.id)).data.state.window.status,'closed');assert.equal((await f.store.game(f.game.id)).data.state.phase,'running');
 await f.DB.close();
});
