// Canonical game/server proof with an ASSUMED 8 s TV delay and 2 s input time.
// This does not measure a video player, physical TV, network delay or p95.
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,generateBooks,activateBlock,activeGoal,completionIndex,beginBingo,claimBook,settleWindow,familyDefault,claimContext,reserveBall} from '../server/bingo-model.js';
import {rulesContract} from '../server/game-rules.js';
import {createSqliteDatabase} from '../server/node-storage.js';
import {BingoStore} from '../server/bingo-store.js';
import {handleBingo} from '../server/bingo.js';

const ASSUMED_TV_DELAY_MS=8000,ASSUMED_INPUT_MS=2000,FAST_OPEN_MS=1000,BASE=Date.UTC(2026,10,22,12);
const required=(book,round,pattern)=>[...new Set(pattern.cells.map(index=>book.cards[round][index]).filter(Boolean))];

function fixture({round=0,step=0,earlierTv=false}={}){
 const game=makeGame({brandId:'milo',title:'Fictieve tv-meldvenstercontrole',timeZone:'Europe/Amsterdam',date:'2027-11-22T19:00',settings:{claimSeconds:30,retroBalls:3}},'fictitious-director','https://fixture.invalid',BASE-1000);
 generateBooks(game,32,'fictitious-tv-latency',BASE-1000);game.status='running';
 const block=game.plan.blocks.map((value,index)=>({value,index})).filter(entry=>entry.value.type==='round')[round];activateBlock(game,block.index,step,BASE-1000);
 const goal=activeGoal(game);let chosen;
 for(let a=0;a<game.books.length&&!chosen;a++)for(let b=a+1;b<game.books.length&&!chosen;b++){
  const fast=game.books[a],tv=game.books[b],fastNumbers=required(fast,round,goal.pattern),tvNumbers=required(tv,round,goal.pattern),common=fastNumbers.find(number=>tvNumbers.includes(number)),onlyFast=fastNumbers.find(number=>!tvNumbers.includes(number));
  if(common!==undefined&&(!earlierTv||onlyFast!==undefined))chosen={fast,tv,fastNumbers,tvNumbers,common,onlyFast};
 }
 assert(chosen,'Generated unique canonical cards must provide a usable completion fixture');
 const {fast,tv,fastNumbers,tvNumbers,common,onlyFast}=chosen;
 Object.assign(fast,{accountId:'fictitious-fast',profileId:'fictitious-fast-child',name:'Fictieve snelle speler',admitted:true});Object.assign(tv,{accountId:'fictitious-tv',profileId:'fictitious-tv-child',name:'Fictieve tv-speler',admitted:true});
 const union=[...new Set([...fastNumbers,...tvNumbers])];
 // Distinct generated cards remain unchanged. Arrange real ball numbers so
 // their last required ball is shared, or TV completes exactly one ball first.
 game.state.drawn=earlierTv?[...union.filter(number=>number!==onlyFast&&number!==common),common,onlyFast]:[...union.filter(number=>number!==common),common];
 game.state.lastCommit={number:game.state.drawn.at(-1),at:BASE};
 const families={fast:familyDefault('fast@example.invalid'),tv:familyDefault('tv@example.invalid')};families.fast.profiles=[{id:fast.profileId,name:fast.name,age:9}];families.tv.profiles=[{id:tv.profileId,name:tv.name,age:10}];
 const fastComplete=completionIndex(fast.cards[round],goal.pattern,game.state.drawn),tvComplete=completionIndex(tv.cards[round],goal.pattern,game.state.drawn);
 assert.equal(fastComplete,game.state.drawn.length);assert.equal(tvComplete,game.state.drawn.length-(earlierTv?1:0));
 return {game,goal,fast,tv,families};
}
function fastClaim(h){beginBingo(h.game,h.families.fast,h.fast.accountId,'fictitious-fast-open',BASE+FAST_OPEN_MS);return claimBook(h.game,h.families.fast,h.fast.accountId,h.fast.id,BASE+FAST_OPEN_MS+1);}
function tvClaim(h,at=BASE+ASSUMED_TV_DELAY_MS+ASSUMED_INPUT_MS){beginBingo(h.game,h.families.tv,h.tv.accountId,'fictitious-tv-open',at);return claimBook(h.game,h.families.tv,h.tv.accountId,h.tv.id,at+1);}

test('all ten canonical Milo prize steps accept an assumed 8-second TV viewer after a faster viewer opens the existing 30-second window',()=>{
 let checked=0;
 for(let round=0;round<4;round++)for(let step=0;step<(round===3?1:3);step++){
  const h=fixture({round,step}),rules=rulesContract(h.game),originalCards=structuredClone(h.game.books.map(book=>book.cards)),originalDrawn=[...h.game.state.drawn];
  assert.equal(h.game.settings.claimSeconds,30);assert.equal(h.game.settings.retroBalls,3);
  assert.equal(fastClaim(h).status,'valid');const windowId=h.game.state.window.id,deadline=h.game.state.window.endsAt;
  assert.equal(deadline,BASE+FAST_OPEN_MS+30000);assert.equal(tvClaim(h).status,'valid');assert.equal(h.game.state.window.id,windowId);assert.equal(h.game.state.window.endsAt,deadline);
  assert.equal(deadline-(BASE+ASSUMED_TV_DELAY_MS+ASSUMED_INPUT_MS+1),20999,'The assumed TV viewer retains almost 21 s after confirming the claim');
  assert.throws(()=>reserveBall(h.game,BASE+12000),/meldvenster|trekken|trekking|wachten|ballen|uitgevoerd|actieve|ronde/i);
  const result=settleWindow(h.game,deadline);assert.equal(result.entrants.length,2);assert.deepEqual(new Set(result.entrants.map(entry=>entry.bookId)),new Set([h.fast.id,h.tv.id]));assert(result.entrants.some(entry=>entry.bookId===result.winner.bookId));assert(result.minigame,'Equal earliest completion retains the existing single minigame/lottery result');
  const winner=structuredClone(result.winner);assert.equal(settleWindow(h.game,deadline+1),null);assert.deepEqual(h.game.results[0].winner,winner);assert.deepEqual(h.game.books.map(book=>book.cards),originalCards);assert.deepEqual(h.game.state.drawn,originalDrawn);assert.deepEqual(rulesContract(h.game),rules);checked++;
 }
 assert.equal(checked,10);
});

test('a TV viewer whose canonical full card completed one ball earlier keeps priority despite claiming later in the shared window',()=>{
 const h=fixture({round:0,step:2,earlierTv:true});assert.equal(fastClaim(h).status,'valid');assert.equal(tvClaim(h).status,'valid');
 const claims=h.game.state.window.claims;assert(claims[1].at>claims[0].at);assert.equal(claims[1].completeAt,claims[0].completeAt-1);
 const result=settleWindow(h.game,h.game.state.window.endsAt);assert.equal(result.winner.bookId,h.tv.id);assert.equal(result.entrants.length,1);assert.equal(result.minigame,null);assert.equal(result.completeAt,claims[1].completeAt);
});

test('the server deadline remains strict: one millisecond before is accepted, exactly at or after is closed without a false-bingo penalty',()=>{
 for(const offset of [-1,0,1]){
  const h=fixture({round:3,step:0});fastClaim(h);beginBingo(h.game,h.families.tv,h.tv.accountId,'fictitious-tv-announce',BASE+8000);const deadline=h.game.state.window.endsAt;
  if(offset<0)assert.equal(claimBook(h.game,h.families.tv,h.tv.accountId,h.tv.id,deadline+offset).status,'valid');
  else{
   const before=structuredClone(h.families.tv);assert.throws(()=>claimBook(h.game,h.families.tv,h.tv.accountId,h.tv.id,deadline+offset),error=>error.code==='closed'&&error.status===409);assert.throws(()=>beginBingo(h.game,h.families.tv,h.tv.accountId,'fictitious-expired-retry',deadline+offset),error=>error.code==='closed');assert.deepEqual(h.families.tv,before);assert.equal(h.game.state.window.claims.length,1);
  }
  assert.equal(h.game.state.window.endsAt,deadline);
 }
});

test('real Bingo HTTP handler persists both assumed fast/TV claims in one window and rejects a new claim at its deadline',async t=>{
 let clock=BASE;t.mock.method(Date,'now',()=>clock);const h=fixture({round:3,step:0}),db=createSqliteDatabase(':memory:'),store=new BingoStore(db);t.after(()=>db.close());await store.create(h.game);
 await store.editFamily(h.fast.accountId,h.families.fast.email,family=>Object.assign(family,h.families.fast));await store.editFamily(h.tv.accountId,h.families.tv.email,family=>Object.assign(family,h.families.tv));
 const call=async(account,action,body={})=>{
  const game=(await store.game(h.game.id)).data,request=new Request(`https://fixture.invalid/api/bingo/games/${game.id}/${action}`,{method:'POST',headers:{Origin:'https://fixture.invalid','Content-Type':'application/json','X-Vlampie-Bingo':'1','X-Vlampie-Player':'1'},body:JSON.stringify({requestId:crypto.randomUUID(),claimContext:claimContext(game),...body})});
  const response=await handleBingo(request,{DB:db,AUTH_IDENTITY:{user:account,admin:false,method:'test-provider'}});return {status:response.status,data:await response.json()};
 };
 clock=BASE+FAST_OPEN_MS;assert.equal((await call(h.fast.accountId,'begin')).status,200);assert.equal((await call(h.fast.accountId,'claim',{bookId:h.fast.id})).data.claim.status,'valid');
 const opened=(await store.game(h.game.id)).data.state.window;
 clock=BASE+ASSUMED_TV_DELAY_MS+ASSUMED_INPUT_MS;assert.equal((await call(h.tv.accountId,'begin')).status,200);const received=await call(h.tv.accountId,'claim',{bookId:h.tv.id});assert.equal(received.status,200);assert.equal(received.data.claim.status,'valid');
 const saved=(await store.game(h.game.id)).data;assert.equal(saved.state.window.id,opened.id);assert.equal(saved.state.window.endsAt,opened.endsAt);assert.equal(saved.state.window.claims.length,2);
 // A fresh operation at the exact server deadline is closed even if it refers
 // to a book accepted earlier. An exact original operation replay is separate.
 clock=opened.endsAt;const closed=await call(h.tv.accountId,'claim',{bookId:h.tv.id});assert.equal(closed.status,409);assert.equal(closed.data.error.code,'closed');
 const after=(await store.game(h.game.id)).data;assert.equal(after.state.window.claims.length,2);assert.equal(after.state.window.endsAt,opened.endsAt);const result=settleWindow(after,clock);assert.equal(result.entrants.length,2);assert(result.minigame);assert.deepEqual((await store.family(h.tv.accountId)).data.falseCounts,{});
});
