import test from 'node:test';
import assert from 'node:assert/strict';
import {createSqliteDatabase} from '../server/node-storage.js';
import {handleBingo} from '../server/bingo.js';
import {BingoStore} from '../server/bingo-store.js';
import {makeGame,gameSettings,playerGame,generateBooks,activateBlock,beginBingo,claimBook,settleWindow,familyDefault,activeGoal} from '../server/bingo-model.js';
import {verifiedTestEnvironment} from './verified-test-identity.mjs';

function setup(){
 const db=createSqliteDatabase(':memory:'),env={DB:db,VLAMPIE_ADMIN_EMAIL:'host@example.test'};
 const call=async(route,{method='GET',body,user='host',email=user==='host'?'host@example.test':user+'@example.test',headers={}}={},status=200)=>{
  const request=new Request('https://studio.example/api/bingo'+route,{method,headers:{Origin:'https://studio.example','x-vlampie-bingo':'1','Content-Type':'application/json','oai-authenticated-user-id':user,'oai-authenticated-user-email':email,...headers},...(body===undefined?{}:{body:JSON.stringify({regieId:'regie-main',requestId:crypto.randomUUID(),...body})})});
  const response=await handleBingo(request,verifiedTestEnvironment(request,env)),data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
 };
 return {db,store:new BingoStore(db),call};
}

// Claims use actual server card-completion checks. The earliest two cards tie;
// later eligible cards include repeated books, another account and legacy books.
function consolationFixture(enabled=true){
 const g=makeGame({date:'2026-12-05T19:00',settings:{retroBalls:3,cooldownSeconds:0,consolationEnabled:enabled,consolationPrizeTitle:'Een sterrensticker',minigames:['horses']}},'host','https://studio.example');
 generateBooks(g,10,'consolation-fixture');g.status='running';activateBlock(g,g.plan.blocks.findIndex(b=>b.type==='round'));
 const goal=activeGoal(g);goal.pattern.cells=[0];goal.pattern.variant='fixed';g.state.drawn=[1,2,3,4,5,6];
 const values=[3,3,4,5,6,2,7,4,5,6],persons=['early-a','early-b','later','later','early-a','too-old','false','later',null,null],families={a:familyDefault(),b:familyDefault()};
 for(const [i,book] of g.books.entries()){book.cards[0][0]=values[i];book.accountId=i===7?'b':'a';book.profileId=persons[i];book.name='Kind '+i;}
 beginBingo(g,families.a,'a','announce-a',100);beginBingo(g,families.b,'b','announce-b',101);
 for(const [i,book] of g.books.entries())claimBook(g,families[book.accountId],book.accountId,book.id,102+i);
 return {g,families};
}

test('consolation settings are opt-in and validate the saved title and boolean',()=>{
 const defaults=gameSettings();assert.equal(defaults.consolationEnabled,false);assert.equal(defaults.consolationPrizeTitle,'Een kleine verrassing');
 assert.equal(gameSettings({consolationEnabled:true,consolationPrizeTitle:'  Een sticker  '}).consolationPrizeTitle,'Een sticker');
 for(const value of ['true',1,null])assert.throws(()=>gameSettings({consolationEnabled:value}),/troostprijs/);
 for(const value of ['', 'x'.repeat(91),12])assert.throws(()=>gameSettings({consolationPrizeTitle:value}),/troostprijs/);
 const {g}=consolationFixture(false);delete g.settings.consolationEnabled;delete g.settings.consolationPrizeTitle;
 const result=settleWindow(g,g.state.window.endsAt);assert.deepEqual(result.consolations,[]);assert.equal(result.completeAt,3);assert.equal(result.entrants.length,2);
});

test('consolations keep earliest priority, exclude false/late/tied players and deduplicate children without rerolling',()=>{
 const {g,families}=consolationFixture(),beforeBooks=JSON.stringify(g.books),beforeDrawn=[...g.state.drawn];
 assert.deepEqual(g.state.window.claims.map(c=>c.status),['valid','valid','valid','valid','valid','late','false','valid','valid','valid']);
 const result=settleWindow(g,g.state.window.endsAt);assert.equal(result.completeAt,3);assert.equal(result.entrants.length,2);assert.equal(result.minigame,'horses');assert(result.entrants.some(c=>c.bookId===result.winner.bookId));
 assert.equal(result.consolations.length,3);assert.equal(new Set(result.consolations.map(a=>a.id)).size,3);
 assert.deepEqual(result.consolations.map(a=>a.bookId),[g.books[2].id,g.books[7].id,g.books[8].id]);
 assert(result.consolations.every(a=>a.completeAt>3&&a.prize.title==='Een sterrensticker'&&a.delivered===false));
 assert(!result.consolations.some(a=>result.entrants.some(e=>e.accountId===a.accountId&&e.profileId===a.profileId)));
 assert.equal(g.state.resultId,result.id);assert.equal(g.state.goalWon,true);assert.deepEqual(g.state.drawn,beforeDrawn);assert.equal(JSON.stringify(g.books),beforeBooks);assert.equal(families.a.falseCounts[g.id],1);
 const saved=JSON.stringify(result);assert.equal(settleWindow(g,g.state.window.endsAt+1000),null);assert.equal(JSON.stringify(g.results[0]),saved);
 assert.equal(playerGame(g,'b').results.length,0,'unannounced main and consolation results remain hidden');
 result.acknowledged=true;const publicResult=playerGame(g,'b').results[0];assert.equal(publicResult.mine,false);assert.equal(publicResult.consolations.filter(a=>a.mine).length,1);
 for(const a of publicResult.consolations){assert(!('accountId' in a));assert(!('profileId' in a));assert.equal(a.mine,a.bookId===g.books[7].id);}
 assert.equal(playerGame(g,'unrelated').results[0].consolations.filter(a=>a.mine).length,0);
});

test('only the owning host can mark each consolation delivered, with independent state and idempotent retries',async()=>{
 const h=setup(),{g}=consolationFixture();const result=settleWindow(g,g.state.window.endsAt),award=result.consolations[0];result.acknowledged=true;await h.store.create(g);const route=`/games/${g.id}`;
 const original=JSON.stringify((await h.store.game(g.id)).data.results[0]);
 await h.call(route+'/delivery',{method:'POST',user:'a',body:{resultId:result.id,awardId:award.id,delivered:true}},403);
 await h.call(route+'/delivery',{method:'POST',user:'another-host',email:'host@example.test',body:{resultId:result.id,awardId:award.id,delivered:true}},403);
 await h.call(route+'/delivery',{method:'POST',headers:{Origin:'https://other.example'},body:{resultId:result.id,awardId:award.id,delivered:true}},403);
 assert.equal(JSON.stringify((await h.store.game(g.id)).data.results[0]),original);
 for(const awardId of ['not-an-award','',null])await h.call(route+'/delivery',{method:'POST',body:{resultId:result.id,awardId,delivered:true}},400);
 const requestId='consolation-delivery-retry',first=await h.call(route+'/delivery',{method:'POST',body:{requestId,resultId:result.id,awardId:award.id,delivered:true}}),saved=first.game.results[0],delivered=saved.consolations.find(a=>a.id===award.id);
 assert.equal(saved.delivered,undefined);assert.equal(delivered.delivered,true);assert.equal(typeof delivered.deliveredAt,'number');assert(saved.consolations.filter(a=>a.id!==award.id).every(a=>a.delivered===false));
 const repeated=await h.call(route+'/delivery',{method:'POST',body:{requestId,resultId:result.id,awardId:award.id,delivered:false}});assert.equal(repeated.game.results[0].consolations.find(a=>a.id===award.id).delivered,true);assert.equal(repeated.game.events.filter(e=>e.type==='prize-delivery'&&e.awardId===award.id).length,1);
 const undone=await h.call(route+'/delivery',{method:'POST',body:{resultId:result.id,awardId:award.id,delivered:false}});assert.equal(undone.game.results[0].consolations.find(a=>a.id===award.id).deliveredAt,null);
 const main=await h.call(route+'/delivery',{method:'POST',body:{resultId:result.id,delivered:true}});assert.equal(main.game.results[0].delivered,true);assert(main.game.results[0].consolations.every(a=>a.delivered===false));assert.deepEqual(main.game.results[0].winner,result.winner);assert.equal(main.game.state.resultId,result.id);
 const publicResult=(await h.call(route+'?player=1',{user:'a'})).game.results[0];assert.equal(publicResult.consolations.filter(a=>a.mine).length,2);assert(publicResult.consolations.every(a=>!('accountId'in a)&&!('profileId'in a)));
 h.db.close();
});


test('legacy books without child identities cannot multiply consolation awards for one account',()=>{
 const {g}=consolationFixture();
 const result=settleWindow(g,g.state.window.endsAt);
 const unknown=result.consolations.filter(award=>!award.profileId);
 assert.equal(unknown.length,1);assert.equal(unknown[0].bookId,g.books[8].id);
 const early=consolationFixture().g;
 for(const claim of early.state.window.claims)if(claim.accountId==='a')claim.profileId=null;
 const main=settleWindow(early,early.state.window.endsAt);
 assert.equal(main.consolations.filter(award=>award.accountId==='a').length,0,'an earliest legacy entrant cannot also win consolation through another book');
 assert.equal(main.consolations.filter(award=>award.accountId==='b').length,1);
});
