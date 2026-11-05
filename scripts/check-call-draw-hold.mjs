import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {makeGame,generateBooks,activateBlock,reserveBall,commitBall,beginBingo,claimBook,settleWindow,familyDefault,playerGame} from '../server/bingo-model.js';
import {ShowDirector} from '../public/show-director.js';
import {ShowRunner} from '../public/show-runner.js';
import {defaultPlan} from '../public/plan-model.js';

globalThis.crypto??=webcrypto;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function gameFixture(){
 const game=makeGame({brandId:'milo',title:'Belmoment zonder gemiste nummers',date:'2026-11-01T14:00',roundCount:2},'owner','https://show.example');
 generateBooks(game,1,'test-books');const book=game.books[0];Object.assign(book,{accountId:'family',profileId:'child-one',name:'Sophie'});
 const family=familyDefault();family.profiles=[{id:'child-one',name:'Sophie'}];game.status='running';const round=game.plan.blocks.findIndex(b=>b.type==='round');activateBlock(game,round);
 return {game,book,family,round,hold(){const checkpoint={id:'checkpoint-one',epoch:game.state.epoch,roundIndex:game.state.roundIndex,drawnCount:game.state.drawn.length,lastNumber:game.state.drawn.at(-1)??null};game.state.drawHold={id:'call-one',checkpoint,accountId:'private-parent-id',profileId:'private-child-id',note:'Private regienotitie'};return checkpoint;}};
}
function heldError(fn){assert.throws(fn,error=>error.status===409&&error.code==='call_draw_hold');}
function directorFixture(){const events=[],director=new ShowDirector({config:{voice:true,sound:false,comments:false},onEvent:event=>events.push(event)});return {director,events};}
function planFixture(types=['story','round']){
 const plan=defaultPlan(),round=plan.blocks.find(b=>b.type==='round');
 plan.blocks=types.map((type,index)=>type==='round'?{...structuredClone(round),id:'round-'+index,title:'Ronde '+index,goals:round.goals.map((goal,n)=>({...goal,id:'goal-'+index+'-'+n}))}:{id:'story-'+index,type:'story',title:'Een magisch verhaal',text:'Mijn hoed heeft vandaag iets bijzonders meegenomen!',hold:0});return plan;
}

test('central hold rejects fresh reserve/commit/round activation without changing deck, board, pending draw or epoch',()=>{
 const h=gameFixture(),pending=reserveBall(h.game);h.hold();const before=structuredClone(h.game);
 heldError(()=>reserveBall(h.game));heldError(()=>commitBall(h.game,pending.token));heldError(()=>activateBlock(h.game,h.round));
 assert.deepEqual(h.game,before);assert.equal(h.game.state.pending.number,pending.number);
 h.game.state.drawHold=null;assert.equal(commitBall(h.game,pending.token).number,pending.number);const ack=structuredClone(h.game.state.lastCommit);h.hold();
 assert.deepEqual(commitBall(h.game,pending.token),ack,'A committed request can be acknowledged idempotently while held');assert.equal(h.game.state.drawn.length,1);heldError(()=>commitBall(h.game,'a-new-token'));
});

test('entertainment during hold retains the last active round and a delayed viewer can still announce and claim bingo',()=>{
 const h=gameFixture(),card=h.book.cards[0],goal=h.game.plan.patterns.find(p=>p.id===h.game.plan.blocks[h.round].goals[0].patternId);
 h.game.state.drawn=goal.cells.map(index=>card[index]).filter(Boolean);const checkpoint=h.hold(),epoch=h.game.state.epoch,deck=[...h.game.state.deck];
 const story={id:'live-call-story',type:'story',title:'Milo vertelt',text:'Een magische verrassing!',hold:0};h.game.plan.blocks.push(story);activateBlock(h.game,h.game.plan.blocks.length-1,0,1000);
 assert.equal(h.game.state.phase,'running');assert.equal(h.game.state.epoch,epoch);assert.deepEqual(h.game.state.deck,deck);assert.equal(h.game.state.drawHold.checkpoint,checkpoint);
 beginBingo(h.game,h.family,'family','late-youtube-announcement',2000);const window=structuredClone(h.game.state.window);const claim=claimBook(h.game,h.family,'family',h.book.id,2100);assert.equal(claim.status,'valid');assert.equal(settleWindow(h.game,window.endsAt-1),null);assert.equal(h.game.state.window.status,'open');assert.equal(h.game.state.window.endsAt,window.endsAt);assert(h.game.state.drawHold);
});

test('a hold never shortens or closes an existing claim window, including failed round changes and draw attempts',()=>{
 const h=gameFixture();h.game.state.drawn=[1,2,3];beginBingo(h.game,h.family,'family','announcement',1000);h.hold();const window=structuredClone(h.game.state.window);
 heldError(()=>reserveBall(h.game));heldError(()=>commitBall(h.game,'old-pending'));assert.throws(()=>activateBlock(h.game,h.round),/meldvenster/);
 assert.deepEqual(h.game.state.window,window);assert.equal(settleWindow(h.game,window.endsAt-1),null);assert.deepEqual(h.game.state.window,window);assert(h.game.state.drawHold);
 assert.equal(settleWindow(h.game,window.endsAt).empty,true);assert.equal(h.game.state.window.status,'closed');assert(h.game.state.drawHold,'Normal claim settlement cannot release the call hold');
});

test('player snapshot exposes the public checkpoint and all drawn numbers without private hold context or another family book',()=>{
 const h=gameFixture();h.game.state.drawn=[7,19,48];const checkpoint=h.hold();h.game.books.push({...structuredClone(h.book),id:'other-book',accountId:'other-family',name:'Private other child',token:'other-secret'});
 const view=playerGame(h.game,'family');assert.deepEqual(view.state.drawn,[7,19,48]);assert.deepEqual(view.state.drawHold,{id:'call-one',reason:'Belmoment: de trekking wacht op bevestigde terugkeer.',checkpoint});
 const serialized=JSON.stringify(view);for(const secret of ['private-parent-id','private-child-id','Private regienotitie','Private other child','other-secret',h.book.token])assert(!serialized.includes(secret));assert.equal(view.books.length,1);
});

test('director blocks manual and scripted draws while held; ordinary entertainment keeps moving',()=>{
 const {director:d,events}=directorFixture();let picks=0,commits=0;d.requestPick=async()=>{picks++;};d.requestCommit=async()=>{commits++;};d.drawBlocked=true;
 assert.equal(d.draw(),false);assert.equal(d.take('draw'),false);assert.equal(d.take('round'),false);assert.equal(d.program([{scene:'draw',duration:1,pick:true}]),false);assert.equal(d.program([{scene:'reveal',duration:1,commit:true}]),false);
 assert.equal(d.program([{scene:'host',duration:2,speech:'Kijk eens naar mijn magische hoed!'}]),true);d.tick(1);assert.equal(d.sceneAge,1);assert(d.flow);d.tick(1);assert.equal(d.flow,null);assert.equal(picks,0);assert.equal(commits,0);assert.equal(events.filter(e=>e.type==='speech').length,1);assert.equal(d.visual().drawBlocked,true);
 d.reset();assert.equal(d.drawBlocked,true,'Resetting a visual board cannot clear a server hold');
});

test('a hold freezes a pending spin and explicit release resumes the same token exactly once',async()=>{
 const {director:d}=directorFixture();let picks=0,commits=0;d.requestPick=async()=>{picks++;return {number:28,token:'reserved-one'};};d.requestCommit=async token=>{commits++;assert.equal(token,'reserved-one');return {number:28};};
 d.draw();d.tick(2);await flush();assert.equal(picks,1);assert.equal(d.pending,28);const flow=d.flow,age=flow.age,sceneAge=d.sceneAge;d.drawBlocked=true;for(let n=0;n<10;n++)d.tick(10);assert.equal(flow.age,age);assert.equal(d.sceneAge,sceneAge);assert.equal(commits,0);assert.equal(d.resume(),false);
 d.drawBlocked=false;d.tick(5);await flush();assert.equal(commits,1);assert.deepEqual(d.drawn,[28]);for(let n=0;n<8;n++)d.tick(5);assert.equal(commits,1);assert.deepEqual(d.drawn,[28]);
});

test('a hold between entering a draw step and its microtask prevents any server request',async()=>{
 const {director:d}=directorFixture();let picks=0;d.requestPick=async()=>{picks++;return {number:9,token:'token-nine'};};d.draw();d.tick(2);d.drawBlocked=true;await flush();assert.equal(picks,0);assert(d.flow.drawBlocked);d.tick(10);assert.equal(picks,0);d.drawBlocked=false;d.tick(.1);await flush();assert.equal(picks,1);assert.equal(d.pending,9);
});

test('late successful commit acknowledgement is displayed once, and cancelled flows ignore late responses',async()=>{
 const {director:d,events}=directorFixture(),pending=defer();let commits=0;d.requestPick=async()=>({number:34,token:'token-34'});d.requestCommit=async()=>{commits++;return pending.promise;};d.draw();d.tick(2);await flush();d.tick(5);await flush();assert.equal(commits,1);d.drawBlocked=true;pending.resolve({number:34});await flush();assert.deepEqual(d.drawn,[34]);assert.equal(events.filter(e=>e.type==='commit').length,1);d.tick(100);assert.equal(events.filter(e=>e.type==='commit').length,1);
 const other=directorFixture().director,late=defer();other.requestPick=()=>late.promise;other.draw();other.tick(2);await flush();other.cancel();late.resolve({number:55,token:'stale'});await flush();assert.equal(other.pending,null);assert.deepEqual(other.drawn,[]);
});

test('runner continues entertainment while held and waits at the next round without activating or resetting it',async()=>{
 const {director:d}=directorFixture(),runner=new ShowRunner(d),activated=[];d.drawn=[7,19];d.number=19;d.drawBlocked=true;runner.beforeBlock=async index=>activated.push(index);const plan=planFixture();runner.start(plan);await flush();assert.equal(runner.index,0);assert.equal(runner.phase,'flow');d.tick(3);runner.tick(1);assert.equal(runner.phase,'hold');runner.tick(1);assert.equal(runner.phase,'draw-held');assert.deepEqual(activated,[0]);assert.deepEqual(d.drawn,[7,19]);assert.equal(runner.index,0);assert.equal(runner.next(),false);runner.tick(100);assert.deepEqual(activated,[0]);
 d.drawBlocked=false;runner.tick(.1);await flush();assert.deepEqual(activated,[0,1]);assert.equal(runner.index,1);assert.equal(runner.phase,'round-intro');assert.deepEqual(d.drawn,[]);assert.deepEqual(runner.plan.blocks.filter(b=>b.type==='round').map(b=>b.id),plan.blocks.filter(b=>b.type==='round').map(b=>b.id));
});

test('runner freezes automatic draws, round announcements and next-goal progression while held',async()=>{
 const {director:d}=directorFixture(),runner=new ShowRunner(d),plan=planFixture(['round']);plan.blocks[0].goals.push({...plan.blocks[0].goals[0],id:'next-goal'});runner.start(plan);d.cancel(false);runner.phase='drawing';runner.age=3;d.drawBlocked=true;let draws=0;d.draw=()=>{draws++;return true;};runner.tick(100);assert.equal(runner.age,3);assert.equal(draws,0);assert.equal(runner.drawNow(),false);
 d.approvals++;runner.tick(100);assert.equal(runner.phase,'drawing');assert.equal(runner.goal,0);d.drawBlocked=false;runner.tick(1);assert.equal(runner.goal,1);assert.equal(runner.phase,'round-intro');d.cancel(false);runner.phase='winner';d.drawBlocked=true;runner.announceGoal();assert.equal(runner.phase,'draw-held');assert.equal(d.flow,null);d.drawBlocked=false;runner.tick(.1);assert.equal(runner.phase,'round-intro');
});

test('runner blocks a round before async activation and stale failures after stop stay inert',async()=>{
 const {director:d}=directorFixture(),runner=new ShowRunner(d);let activations=0;runner.beforeBlock=async()=>{activations++;};runner.start(planFixture(['round']));d.drawBlocked=true;await flush();assert.equal(activations,0);assert.equal(runner.phase,'draw-held');assert.equal(runner.index,-1);d.drawBlocked=false;runner.tick(.1);await flush();assert.equal(activations,1);assert.equal(runner.index,0);
 const other=new ShowRunner(d),wait=defer();other.beforeBlock=()=>wait.promise;other.start(planFixture());await flush();other.stop();wait.reject(Error('late activation failed'));await flush();assert.equal(other.phase,'idle');assert.equal(other.active,false);
});
