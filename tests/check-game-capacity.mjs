import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createSqliteDatabase} from '../server/node-storage.js';
import {BingoStore} from '../server/bingo-store.js';
import {handleBingo} from '../server/bingo.js';
import {makeGame,generateBooks,activateBlock,activeGoal} from '../server/bingo-model.js';
import {publishGameRules} from '../server/game-rules.js';
import {gameCapacity,GAME_DOCUMENT_BYTES,GAME_EVENT_LIMIT,GAME_CORE_EVENT_RESERVE} from '../server/game-capacity.js';
import {renderMailTemplate,sampleMailContext} from '../server/mail-templates.js';

const measures={storage:'native SQLite :memory:; PostgreSQL target load not measured',providerCalls:0};
function game(books){const g=makeGame({brandId:'milo',timeZone:'Europe/Amsterdam',date:'2027-12-05T19:00:00Z',roundCount:4},'host','https://studio.example');for(let i=0;g.books.length<books;i++)generateBooks(g,Math.min(150,books-g.books.length),'fixture-'+i);return g;}
function api(t){const db=createSqliteDatabase(':memory:'),store=new BingoStore(db);t.after(()=>db.close());const call=async(g,action,body,user='host')=>{const response=await handleBingo(new Request(`https://studio.example/api/bingo/games/${g.id}/${action}`,{method:'POST',headers:{Origin:'https://studio.example','X-Vlampie-Bingo':'1','Content-Type':'application/json'},body:JSON.stringify({regieId:'capacity-regie',requestId:crypto.randomUUID(),...body})}),{DB:db,AUTH_IDENTITY:{user,email:user+'@example.test',admin:user==='host'}});return {status:response.status,data:await response.json()};};return {db,store,call};}

test('C01: 4000 actual cards and 81 two-sheet orders retain old snapshots with measured start reserve',async t=>{
 const full=game(1000),a=gameCapacity(full);assert.equal(a.cardCount,4000);assert.equal(a.startReady,true);assert(a.projectedBytes<GAME_DOCUMENT_BYTES);measures.fourThousandCards=a;
 const g=game(162);g.orders=[];const message=(kind,long=false)=>renderMailTemplate(kind,{brandId:'milo',...(long?{template:{body:'Voorbeeld '.repeat(800)}}:{}),context:sampleMailContext(kind,'milo','https://studio.example'),origin:'https://studio.example',from:'organisatie@example.test',to:'fixture@example.test'});
 for(let i=0;i<81;i++){const id=crypto.randomUUID(),accountId='family-'+i,pair=g.books.slice(i*2,i*2+2);pair.forEach(book=>Object.assign(book,{accountId,orderId:id,issueStatus:'paid-ready'}));g.orders.push({id,number:'MF-'+i,accountId,email:accountId+'@example.test',quantity:2,show:{id:g.id,brandId:'milo'},status:'fulfilled',payment:{state:'verified'},bookIds:pair.map(book=>book.id),paymentMail:{status:'sent',payload:message('payment-link'),providerId:'fixture-receipt-'+i},readyMail:{status:'sent',payload:message('books-ready'),providerId:'fixture-ready-'+i}});}
 publishGameRules(g);measures.eightyOneOrdersDefaultCopy=gameCapacity(g);for(const order of g.orders){order.paymentMail.payload=message('payment-link',true);order.readyMail.payload=message('books-ready',true);}const b=gameCapacity(g);assert(b.bytes>1500000,'valid long frozen HTML snapshots reproduce the old 1.5MB ceiling');assert(b.startReady);measures.eightyOneOrdersLongCopy=b;
 const h=api(t);await h.store.create(g);const before=JSON.stringify((await h.store.game(g.id)).data.orders),started=await h.call(g,'start',{});assert.equal(started.status,200,JSON.stringify(started.data));assert.equal(JSON.stringify((await h.store.game(g.id)).data.orders),before,'no historical payload, receipt or issued card is discarded');
});

test('C01: start and opening a window fail before mutations when their reserved capacity is unavailable',async t=>{
 const h=api(t),g=game(1);Object.assign(g.books[0],{accountId:'a',name:'Fixture'});publishGameRules(g);g.privateLegacyHistory='x'.repeat(GAME_DOCUMENT_BYTES-600000);await h.store.create(g);const before=JSON.stringify((await h.store.game(g.id)).data),start=await h.call(g,'start',{});assert.equal(start.status,409);assert.equal(start.data.error.code,'game_capacity');assert.equal(JSON.stringify((await h.store.game(g.id)).data),before);
 const live=game(1);live.books[0].accountId='a';live.status='running';activateBlock(live,live.plan.blocks.findIndex(b=>b.type==='round'));live.events=Array.from({length:GAME_EVENT_LIMIT-GAME_CORE_EVENT_RESERVE},(_,i)=>({type:'fixture-history',at:i}));await h.store.create(live);const snapshot=JSON.stringify((await h.store.game(live.id)).data),response=await h.call(live,'begin',{claimContext:(await import('../server/bingo-model.js')).claimContext(live)},'a');assert.equal(response.status,409);assert.equal(response.data.error.code,'game_capacity');assert.equal(JSON.stringify((await h.store.game(live.id)).data),snapshot);
});

test('C01: 100 concurrent households claim all 400 books with durable CAS outcomes and one saved draw',async t=>{
 const h=api(t),g=game(400);for(const [i,b] of g.books.entries())Object.assign(b,{accountId:'family-'+Math.floor(i/4),profileId:'child-'+i,name:'Fixture '+i});g.status='running';activateBlock(g,g.plan.blocks.findIndex(b=>b.type==='round'));activeGoal(g).pattern.cells=[0];g.books.forEach(b=>b.cards[0][0]=1);g.state.drawn=[1];const capacity=gameCapacity(g);assert(capacity.startReady);await h.store.create(g);
 const {claimContext}=await import('../server/bingo-model.js'),captured=claimContext(g),stats={conflicts:0,retries:0,requests:0},started=performance.now();let peak=capacity.bytes;
 const retry=async(action,body,user)=>{for(let attempt=0;attempt<20;attempt++){stats.requests++;const response=await h.call(g,action,body,user);if(response.status===200)return response.data;if(response.status!==409||response.data.error.code!=='conflict')assert.fail(JSON.stringify(response));stats.conflicts++;stats.retries++;await new Promise(resolve=>setTimeout(resolve,10+(attempt%4)*5));}assert.fail('bounded retry exhausted');};
 const opened=await Promise.all(Array.from({length:100},(_,i)=>retry('begin',{requestId:'load-begin-'+i,claimContext:captured},'family-'+i)));assert.equal(new Set(opened.map(r=>r.game.state.window.id)).size,1);
 const window=opened[0].game.state.claimContext;const claims=await Promise.all(g.books.map((book,i)=>retry('claim',{requestId:'load-claim-'+i,claimContext:window,bookId:book.id},book.accountId)));
 assert.equal(claims.length,400);assert(claims.every(r=>r.claim.status==='valid'));assert.equal(new Set(claims.map(r=>r.claim.id)).size,400);
 const saved=(await h.store.game(g.id)).data;peak=Math.max(peak,gameCapacity(saved).bytes);assert.equal(saved.state.window.claims.length,400);assert.equal(saved.state.window.announcements.length,100);
 const {settleWindow}=await import('../server/bingo-model.js');await h.store.mutate(g.id,{},game=>settleWindow(game,game.state.window.endsAt));const settled=(await h.store.game(g.id)).data;peak=Math.max(peak,gameCapacity(settled).bytes);assert.equal(settled.results.length,1);assert.equal(settled.results[0].entrants.length,400);assert.equal(settled.events.filter(e=>e.type==='window-closed').length,1);assert(settled.results[0].entrants.some(e=>e.bookId===settled.results[0].winner.bookId));
 measures.concurrentHouseholds={households:100,books:400,cardCount:1600,claims:400,results:1,elapsedMs:Math.round(performance.now()-started),peakDocumentBytes:peak,...stats};console.log('CAPACITY_MEASUREMENTS '+JSON.stringify(measures));
});
