import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {startReadiness} from '../frontend/start-readiness.js';
import {makeGame,generateBooks} from '../server/bingo-model.js';
import {publishGameRules,bindingRules,rulesContract} from '../server/game-rules.js';
import {gameCapacity} from '../server/game-capacity.js';
import {BingoStore} from '../server/bingo-store.js';
import {createSqliteDatabase} from '../server/node-storage.js';
import {handleBingo} from '../server/bingo.js';
import {STANDARD_MILO_PROFILE} from '../server/standard-show.js';

function snapshot({brand='milo'}={}){
 const game=makeGame({brandId:brand,title:'Startcontrole',date:'2027-01-01T18:00:00Z',roundCount:1},'host','https://studio.example');
 generateBooks(game,1,'startcheck-books');game.books[0].accountId='family';game.books[0].name='Deelnemer';publishGameRules(game);
 return {game,production:brand,demo:false,dirty:false,working:false,runner:{active:false,index:0,phase:'idle'},apiStatus:{configured:true},voiceMode:'ai',outputConnected:false,stage:{production:'milo',hostId:'milo',camera:'wide',paused:false},characters:[{id:'milo',name:'Milo'}],voicePhase:'idle',voiceText:'',previewCamera:'wide',showRuntime:{},now:Date.now()};
}
const row=(s,id,live)=>startReadiness(s,live).rows.find(item=>item.id===id);
async function actualStart(t,s){
 const db=createSqliteDatabase(':memory:'),store=new BingoStore(db);t.after(()=>db.close());await store.create(s.game);
 const before=JSON.stringify((await store.game(s.game.id)).data);
 const response=await handleBingo(new Request(`https://studio.example/api/bingo/games/${s.game.id}/start`,{method:'POST',headers:{Origin:'https://studio.example','X-Vlampie-Bingo':'1','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),regieId:'startcheck-regie'})}),{DB:db,AUTH_IDENTITY:{user:'host',email:'host@example.test',admin:true}});
 const data=await response.json(),after=JSON.stringify((await store.game(s.game.id)).data);
 return {response,data,before,after};
}

test('U03: unpaid requests stay playable; each unresolved financial state agrees with the atomic API guard',async t=>{
 for(const pending of [null,{status:'requested'},{status:'payment_pending'}]){
  const s=snapshot();if(pending)s.game.orders=[pending];assert.equal(startReadiness(s).canStart,true);
  const api=await actualStart(t,s);assert.equal(api.response.status,200);assert.equal(api.data.game.status,'running');
 }
 for(const order of [{status:'payment_reported'},{status:'payment_pending',payment:{state:'verified'}},{status:'cancelled',reconciliation:{state:'required'}},{status:'requested',reconciliation:{state:'processing'}},...['required','processing','failed'].map(state=>({status:'cancelled',refund:{state}}))]){
  const s=snapshot();s.game.orders=[order];assert.equal(startReadiness(s).canStart,false);assert.equal(row(s,'orders').code,'orders_unresolved');
  const api=await actualStart(t,s);assert.equal(api.response.status,409);assert.equal(api.data.error.code,'orders_unresolved');assert.equal(api.after,api.before,'A blocked start must not claim a lease or change stored game data');
 }
});

test('U03: fulfilled orders require the same complete, owned, nonrevoked issuance as the server',async t=>{
 for(const invalid of ['incomplete','foreign-family','revoked','bad-status']){
  const s=snapshot(),book=s.game.books[0];book.orderId='order';book.issueStatus='assigned';
  s.game.orders=[{id:'order',status:'fulfilled',accountId:'family',show:{id:s.game.id,brandId:'milo'},quantity:1,bookIds:[book.id]}];
  if(invalid==='incomplete')s.game.orders[0].quantity=2;
  if(invalid==='foreign-family')s.game.orders[0].accountId='other';
  if(invalid==='revoked')book.revokedAt=Date.now();
  if(invalid==='bad-status')book.issueStatus='generated';
  assert.equal(row(s,'orders').status,'blocked');const api=await actualStart(t,s);assert.equal(api.response.status,409);assert.equal(api.data.error.code,row(s,'orders').code);assert.equal(api.after,api.before);
 }
});

test('U03: rules, effective patterns, schedule and admission remain current server-derived checks',async t=>{
 for(const [name,change] of [['rules',s=>{s.game.settings.claimSeconds++;}],['plan',s=>{s.game.plan.patterns[0].cells=[12];}],['schedule',s=>{s.game.date='2027-01-01T18:00';delete s.game.timeZone;}],['accounts',s=>{s.game.books[0].admitted=false;}]]){
  const s=snapshot({brand:name==='rules'?'vlampie':'milo'});change(s);assert.equal(row(s,name).status,'blocked');assert.equal(startReadiness(s).canStart,false);
  const api=await actualStart(t,s);assert(api.response.status>=400);assert.equal(api.after,api.before);
 }
});

test('U03: start reserve displays measured bytes and every reported shortage blocks the start',()=>{
 const s=snapshot();s.game.capacity=gameCapacity(s.game);assert.equal(row(s,'capacity').status,'ready');assert.match(row(s,'capacity').detail,/Servermeting.*MiB.*showreserve.*meldvensterreserve/);
 s.game.capacity.startReady=false;assert.equal(startReadiness(s).canStart,false);assert.equal(row(s,'capacity').code,'game_capacity');
 const running=snapshot();running.game.status='running';running.game.orders=[{status:'payment_reported'}];running.game.capacity={startReady:false};assert.equal(startReadiness(running).canStart,true,'Resuming an admitted show must not silently revoke existing admission');
});

test('U03/L01: an active call, incomplete cleanup and a persisted hold cannot start a show',async t=>{
 for(const field of ['drawHold','callId']){
  const s=snapshot();s.game.state[field]=field==='callId'?'call-id':{id:'hold-id'};assert.equal(row(s,'calls').status,'blocked');
  const api=await actualStart(t,s);assert.equal(api.response.status,409);assert.equal(api.data.error.code,'call_draw_hold');assert.equal(api.after,api.before);
 }
 const s=snapshot();
 for(const live of [{call:{phase:'live'}},{call:{phase:'returning'}},{call:{phase:'completed',resourcesClosed:false}},{call:{phase:'completed',resourcesClosed:true,recoveryStatus:'manual-reconciliation'}},{call:{phase:'completed',resourcesClosed:true,cleanupError:'unconfirmed'}},{mismatchedGame:true},{drawHeld:true}])assert.equal(startReadiness(s,live).canStart,false);
 assert.equal(row(s,'calls',{call:{phase:'completed',resourcesClosed:true,recoveryStatus:'closed'}}).status,'ready');
});

test('U03: key/configuration/output never claim audible success; disabled optional calls do not block offline rehearsal',()=>{
 const s=snapshot();assert.equal(startReadiness(s).canStart,true);assert.equal(row(s,'voice').status,'warning');assert.equal(row(s,'media').status,'off');assert.equal(row(s,'output').status,'off');
 s.outputConnected=true;assert.equal(row(s,'output').status,'warning');
 s.game.production={calls:{enabled:true}};assert.equal(row(s,'media',{settings:{configured:true}}).status,'warning');assert.equal(row(s,'media',{settings:{configured:false}}).status,'off');
 s.demo=true;s.apiStatus={configured:false};s.voiceMode='browser';s.outputConnected=false;assert.equal(startReadiness(s).canStart,true);assert.equal(row(s,'voice').status,'off');
 s.demo=false;assert.equal(row(s,'voice').status,'blocked');
});

test('U03/Milo: pending preparation does not require manual save or rules publication; the atomic start finalizes current rules',async t=>{
 const s=snapshot();delete s.game.rulesPublication;s.dirty=true;s.preparation={status:'saving'};
 assert.equal(row(s,'saved').status,'warning');assert.match(row(s,'saved').detail,/Start show bewaart eerst/);assert.equal(row(s,'rules').status,'ready');assert.match(row(s,'rules').detail,/automatisch vast/);assert.equal(startReadiness(s).canStart,true);
 const api=await actualStart(t,s);assert.equal(api.response.status,200);assert.equal(api.data.game.status,'running');assert(api.data.game.rulesPublication.finalizedAt);assert.deepEqual(api.data.game.rulesPublication.contract,rulesContract(s.game));
});

async function ui(){
 const {window}=parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
 const errors=[],context={window,document:window.document,navigator:{userAgent:'startcheck-qa'},location:{hash:''},console,setTimeout,clearTimeout,setInterval,clearInterval,performance,queueMicrotask,TextEncoder,TextDecoder,URL,URLSearchParams,crypto,structuredClone};
 context.self=context;context.globalThis=context;
 const js=(await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {StartCheck} from './frontend/App.jsx';import RegieWorkspace from './frontend/RegieWorkspace.jsx';const root=createRoot(document.getElementById('root'));window.renderTest=(kind,s,operator,onSave)=>flushSync(()=>root.render(kind==='start'?<StartCheck s={s} operator={operator} onSave={onSave} run={fn=>Promise.resolve(fn()).catch(window.testError)}/>:<RegieWorkspace s={s} engine={operator} run={fn=>Promise.resolve(fn()).catch(window.testError)}/>));window.closeTest=()=>flushSync(()=>root.unmount());`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',loader:{'.css':'empty'},logLevel:'warning',plugins:[{name:'renderer-boundary',setup(b){
  b.onLoad({filter:/frontend\/App\.jsx$/},({path})=>({loader:'jsx',contents:readFileSync(path,'utf8').replace('const engine=new StudioEngine();','const engine={};')}));
  b.onLoad({filter:/frontend\/components\.jsx$/},({path})=>{let source=readFileSync(path,'utf8'),a=source.indexOf('export function Stage('),z=source.indexOf('export function Pattern(',a);return {loader:'jsx',contents:source.slice(0,a)+`export function Stage(){return <div className="mf-stage-frame"/>;}\n`+source.slice(z)};});
  b.onResolve({filter:/RegiePanels\.jsx$/},()=>({path:'panels',namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:'export default function Panels(){return null;}'}));
 }}]})).outputFiles[0].text;
 window.testError=error=>errors.push(error);vm.runInNewContext(js,context);return {window,document:window.document,errors,close:()=>window.closeTest(),click(node){assert(node);node.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));}};
}


const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const rulesNode=h=>h.document.querySelector('[data-check="rules"]');
const buttonNamed=(node,label)=>[...node.querySelectorAll('button')].find(button=>button.textContent===label);
function rulesSnapshot({published=false,stale=false,dirty=false}={}){
 const s=snapshot({brand:'vlampie'});s.game.books=[];s.game.batches=[];
 if(!published)delete s.game.rulesPublication;
 if(stale)s.game.settings.claimSeconds+=30;
 s.dirty=dirty;return s;
}
async function rulesUi(t,s,{failPublish=false,onSave}={}){
 const h=await ui(),db=createSqliteDatabase(':memory:'),store=new BingoStore(db),posts=[],notices=[];
 t.after(()=>{h.close();return db.close();});await store.create(structuredClone(s.game));
 const render=()=>h.window.renderTest('start',s,operator,onSave);
 const operator={game:s.game,async task(operation,notice){try{const result=await operation();if(notice)notices.push(notice);return result;}finally{render();}},async post(action){
  posts.push(action);if(failPublish)throw new Error('Publiceren is tijdelijk niet beschikbaar.');
  const response=await handleBingo(new Request(`https://studio.example/api/bingo/games/${s.game.id}/${action}`,{method:'POST',headers:{Origin:'https://studio.example','X-Vlampie-Bingo':'1','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),regieId:'rules-ui-fixture'})}),{DB:db,AUTH_IDENTITY:{user:'host',email:'host@example.test',admin:true}});
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error.message),{code:data.error.code});operator.game=s.game=data.game;return data;
 }};
 render();return {...h,s,operator,store,posts,notices,render,async settle(){for(let attempt=0;attempt<20;attempt++){await tick();if(!h.document.querySelector('[aria-busy="true"]')){await tick();return;}}}};
}

test('U03/Vlampie: rules readiness distinguishes missing publication, changed preparation and the current published version',()=>{
 const missing=rulesSnapshot(),stale=rulesSnapshot({published:true,stale:true}),current=rulesSnapshot({published:true});
 assert.equal(row(missing,'rules').status,'blocked');assert.match(row(missing,'rules').detail,/nog niet gepubliceerd/i);
 assert.equal(row(stale,'rules').status,'blocked');assert.match(row(stale,'rules').detail,/gewijzigd|verouderd|niet meer.*actueel/i);
 assert.notEqual(row(missing,'rules').detail,row(stale,'rules').detail);
 assert.equal(row(current,'rules').status,'ready');assert.match(row(current,'rules').detail,/versie\s*1/i);
});

test('U03/Vlampie: the inline rules preview publishes only after an explicit click and stays ready after stored reload',async t=>{
 const h=await rulesUi(t,rulesSnapshot()),inline=rulesNode(h);assert(inline);
 assert.equal(inline.getAttribute('data-status'),'blocked');assert.equal(inline.querySelector('summary')?.textContent,'Spelregels bekijken');
 for(const rule of bindingRules(rulesContract(h.s.game))){assert(inline.textContent.includes(rule.title));assert(inline.textContent.includes(rule.text));}
 assert.equal(h.posts.length,0,'Rendering the review must not publish rules');h.render();await h.settle();assert.equal(h.posts.length,0,'Re-rendering the review must not publish rules');
 const publish=buttonNamed(rulesNode(h),'Publiceer spelregels');assert(publish);assert.equal(publish.disabled,false);h.click(publish);await h.settle();
 assert.deepEqual(h.posts,['publish-rules']);assert.equal(h.notices.length,1);assert.equal(rulesNode(h).getAttribute('data-status'),'ready');assert.equal(h.s.game.rulesPublication.version,1);
 h.operator.game=h.s.game=(await h.store.game(h.s.game.id)).data;h.render();await h.settle();assert.equal(rulesNode(h).getAttribute('data-status'),'ready');assert.deepEqual(h.posts,['publish-rules']);assert.equal(h.errors.length,0);
});

test('U03/Vlampie: a failed rules publication stays blocked and does not announce successful publication',async t=>{
 const h=await rulesUi(t,rulesSnapshot(),{failPublish:true});h.click(buttonNamed(rulesNode(h),'Publiceer spelregels'));await h.settle();
 assert.deepEqual(h.posts,['publish-rules']);assert.equal(h.notices.length,0);assert.equal(rulesNode(h).getAttribute('data-status'),'blocked');assert.equal(h.s.game.rulesPublication,undefined);assert.equal((await h.store.game(h.s.game.id)).data.rulesPublication,undefined);
 assert.equal(h.errors.length,1);assert.match(h.errors[0].message,/tijdelijk niet beschikbaar/);
});

test('U03/Vlampie: changed saved rules without participants offer an explicit current-version publication beside the blocker',async t=>{
 const h=await rulesUi(t,rulesSnapshot({published:true,stale:true})),before=structuredClone(h.s.game.rulesPublication),inline=rulesNode(h);
 assert.equal(inline.getAttribute('data-status'),'blocked');const publish=buttonNamed(inline,'Publiceer actuele spelregels');assert(publish);assert.equal(publish.disabled,false);assert.equal(h.posts.length,0);
 assert(inline.textContent.includes(bindingRules(rulesContract(h.s.game)).find(rule=>rule.id==='core-window').text),'The review must contain the current rules being published');
 h.click(publish);await h.settle();assert.deepEqual(h.posts,['publish-rules']);assert.equal(h.s.game.rulesPublication.version,2);assert.deepEqual(structuredClone(h.s.game.rulesHistory),[before]);assert.equal(rulesNode(h).getAttribute('data-status'),'ready');assert.equal(h.errors.length,0);
});

test('U03/Vlampie: unsaved preparation explains the prerequisite and saves without automatically publishing',async t=>{
 const s=rulesSnapshot({dirty:true});let saves=0,h;
 h=await rulesUi(t,s,{onSave:async()=>{saves++;s.dirty=false;h.render();}});const inline=rulesNode(h);assert.match(inline.textContent,/sla.*eerst.*op|eerst.*opslaan/i);
 assert.equal(!!buttonNamed(inline,'Publiceer spelregels'),false);const save=buttonNamed(inline,'Draaiboek opslaan');assert(save);h.click(save);await h.settle();
 assert.equal(saves,1);assert.deepEqual(h.posts,[]);assert.equal(rulesNode(h).getAttribute('data-status'),'blocked');assert.equal(!!buttonNamed(rulesNode(h),'Publiceer spelregels'),true);assert.equal(h.errors.length,0);
});

test('U03/Vlampie: existing participation locks changed rules while current rules expose only their published version',async t=>{
 for(const participation of ['book','order']){
  const s=rulesSnapshot({published:true,stale:true});if(participation==='book')s.game.books=[{id:'locked-book',accountId:'family',admitted:true}];else s.game.orders=[{id:'locked-order',status:'requested'}];
  const h=await rulesUi(t,s),inline=rulesNode(h);assert.equal(inline.getAttribute('data-status'),'blocked');assert.match(inline.textContent,/deelnemers|bestellingen/i);assert.equal([...inline.querySelectorAll('button')].some(button=>/Publiceer/.test(button.textContent)),false);assert.equal(h.posts.length,0);assert.equal(h.errors.length,0);
 }
 const h=await rulesUi(t,rulesSnapshot({published:true})),inline=rulesNode(h);assert.equal(inline.getAttribute('data-status'),'ready');assert.match(inline.textContent,/versie\s*1/i);const link=inline.querySelector('a[href*="/spelregels?spel="]');assert(link);assert(link.getAttribute('href').includes(encodeURIComponent(h.s.game.id)));assert.equal([...h.document.querySelectorAll('button')].some(button=>/Publiceer.*(?:regels|spelregels)/i.test(button.textContent)),false);assert.equal(h.posts.length,0);
});

test('U03: actual StartCheck disables blocked native starts, exposes reasons and permits an explicit healthy start',async()=>{
 const h=await ui();try{
  let starts=0;const operator={start:async()=>{starts++;}},s=snapshot();s.game.orders=[{status:'payment_reported'}];h.window.renderTest('start',s,operator);
  let start=[...h.document.querySelectorAll('button')].find(node=>node.textContent==='Start show');assert.equal(start.disabled,true);assert.match(h.document.querySelector('.mf-preparation-blockers').textContent,/Betaalcontrole: 1/);h.click(start);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(starts,0);
  s.game.orders=[];h.window.renderTest('start',s,operator);start=[...h.document.querySelectorAll('button')].find(node=>node.textContent==='Start show');assert.equal(start.disabled,false);h.click(start);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(starts,1);assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});

test('U03: fixed Program/Preview transport keeps pause and explicit voice/guest mute available independently of modules',async()=>{
 const h=await ui();try{
  const s=snapshot({brand:'vlampie'}),actions=[];let stopped=0,paused=0,starts=0;
  const operator={calls:{held:false},stopSpeech(){stopped++;},pause(){paused++;},start(){starts++;},liveCalls:{onAir:true,getSnapshot:()=>({call:{phase:'live'}}),action:async(action,body)=>{actions.push({action,...body});}}};
  h.window.renderTest('regie',s,operator);assert(h.document.querySelector('.rd-monitor-wall>.rd-program'));assert(h.document.querySelector('.rd-monitor-wall>.rd-preview'));
  const transport=h.document.querySelector('.rd-transport');assert(transport);const button=label=>h.document.querySelector(`button[aria-label="${label}"]`);
  assert.equal(button('Start show').disabled,true);h.click(button('Start show'));assert.equal(starts,0);
  h.click(button('Pauzeren'));h.click(button('Stem dempen'));h.click(button('Gast dempen'));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(paused,1);assert.equal(stopped,1);assert.deepEqual(actions,[{action:'ai-mute',muted:true},{action:'mute',muted:true}]);assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});

test('Milo regie explains an explicitly waiting showmoment and keeps the next-cue action deliberate',async()=>{
 const h=await ui();try{
  const s=snapshot(),operator={calls:{held:false},showCallCues:{held:false}};let advances=0;operator.nextCue=()=>advances++;
  s.game.status='running';s.game.settings.rulesProfile=STANDARD_MILO_PROFILE;s.runner={active:true,index:s.game.plan.blocks.findIndex(block=>block.type!=='round'),phase:'waiting',kind:'call'};s.drawClock={blocked:true,remainingMs:15000};s.game.callCues=[{id:'planned-manual',source:'manual',status:'planned',name:'Fictief kindje'}];const before=structuredClone(s.game);
  h.window.renderTest('regie',s,operator);await tick();
  const heading=h.document.querySelector('.mf-live-heading>div>span:last-child'),timer=h.document.querySelector('.mf-live-countdown');assert.equal(heading.textContent,'Wacht op Volgende cue');assert.equal(timer.querySelector('small').textContent,'Wacht op Volgende cue');assert.equal(timer.textContent.includes('15 seconden'),false);assert.equal(timer.querySelector('.mf-live-clock-track'),null);assert.equal(advances,0);
  const next=h.document.querySelector('.rd-transport button[aria-label="Volgende cue"]');assert(next);assert.equal(next.disabled,false);h.click(next);await tick();assert.equal(advances,1);assert.deepEqual(s.game,before);assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});

test('Milo waiting labels retain bingo-window, result, call-hold and manual-pause priorities',async()=>{
 const h=await ui();try{
  const s=snapshot(),operator={calls:{held:false},showCallCues:{held:false}};s.game.status='running';s.game.settings.rulesProfile=STANDARD_MILO_PROFILE;s.runner={active:true,index:s.game.plan.blocks.findIndex(block=>block.type!=='round'),phase:'waiting'};s.drawClock={blocked:true,remainingMs:15000};
  for(const [held,header,detail] of [
   ['window','BINGO-meldvenster','BINGO-meldvenster'],
   ['result','Uitslag / minigame','Uitslag / minigame'],
   ['draw-hold','Trekking geblokkeerd · belmoment','Belblokkade · bekijk de belkaart'],
   ['call-cue','Belmoment · bekijk de belkaart','Belmoment · bekijk de belkaart'],
   ['call-active','Belmoment · bekijk de belkaart','Belmoment · bekijk de belkaart'],
   ['paused','Show gepauzeerd','Gepauzeerd']
  ]){
   s.game.state.window=held==='window'?{id:'official-window',status:'open',endsAt:Date.now()+60000,claims:[]}:null;s.game.state.resultId=['window','result'].includes(held)?'official-result':null;s.game.state.drawHold=['window','result','draw-hold'].includes(held)?{id:'official-call-hold'}:null;s.game.state.paused=true;operator.showCallCues.held=['window','result','draw-hold','call-cue'].includes(held);operator.liveCalls=held==='call-active'?{active:true}:undefined;
   const before=structuredClone(s.game);h.window.renderTest('regie',s,operator);await tick();assert.equal(h.document.querySelector('.mf-live-heading>div>span:last-child').textContent,header,held);const timer=h.document.querySelector('.mf-live-countdown');assert.equal(timer.querySelector('small').textContent,detail,held);assert.equal(timer.textContent.includes('15 seconden'),false);assert.deepEqual(s.game,before);
  }
  assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});

test('Milo drawing retains the official countdown and Vlampie retains its existing waiting presentation',async()=>{
 const h=await ui();try{
  const s=snapshot(),operator={calls:{held:false},showCallCues:{held:false}};s.game.status='running';s.game.settings.rulesProfile=STANDARD_MILO_PROFILE;s.game.state.roundIndex=0;s.game.state.goalIndex=0;s.game.state.phase='running';s.runner={active:true,index:s.game.plan.blocks.findIndex(block=>block.type==='round'),phase:'drawing',kind:'round'};s.drawClock={blocked:false,remainingMs:10500};h.window.renderTest('regie',s,operator);
  assert.equal(h.document.querySelector('.mf-live-heading>div>span:last-child').textContent,'Bingoronde actief');const timer=h.document.querySelector('.mf-live-countdown');assert.equal(timer.querySelector('strong').textContent,'11 s');assert.equal(timer.querySelector('small').textContent,'15 seconden per officiële bal');assert(timer.querySelector('.mf-live-clock-track'));
  const vlampie=snapshot({brand:'vlampie'});vlampie.game.status='running';vlampie.runner={active:true,index:0,phase:'waiting'};h.window.renderTest('regie',vlampie,operator);assert.equal(h.document.querySelector('.mf-live-essentials'),null);assert.equal(h.document.querySelector('.rd-console-status>div>strong').textContent,'Wachten op de regie');assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});

test('Milo distinguishes a connected output from the selected audio route before calling',async()=>{
 const h=await ui();try{
  const s=snapshot(),state={call:null,cues:[{id:'planned-manual',source:'manual',status:'planned',name:'Fictieve speler'}],queue:[],busy:false,error:'',media:null,mode:'real'},operator={calls:{held:false},liveCalls:{subscribe:()=>()=>{},getSnapshot:()=>state}};
  const before=structuredClone(s.game);s.outputConnected=true;s.outputRouting=false;
  h.window.renderTest('regie',s,operator);await tick();
  assert.equal(h.document.querySelector('.rd-console-status>.rd-output-missing').textContent,'Uitvoer verbonden · audio via regie');
  assert.match(h.document.querySelector('.mcc-card [role="status"]').textContent,/Bij bellen.*bestaande uitzendvenster/);
  s.outputRouting=true;h.window.renderTest('regie',s,operator);await tick();
  assert.equal(h.document.querySelector('.rd-console-status>.rd-output-ready').textContent,'Beeld & geluid verbonden');assert.equal(h.document.querySelector('.mcc-card [role="status"]'),null);
  s.outputConnected=false;h.window.renderTest('regie',s,operator);await tick();assert.equal(h.document.querySelector('.rd-console-status>.rd-output-missing').textContent,'Uitvoer niet verbonden');
  assert.deepEqual(s.game,before);assert.deepEqual(h.errors,[]);
  const vlampie=snapshot({brand:'vlampie'});vlampie.outputConnected=true;vlampie.outputRouting=false;h.window.renderTest('regie',vlampie,operator);await tick();assert.equal(h.document.querySelector('.rd-console-status>.rd-output-ready').textContent,'Uitvoer verbonden');
 }finally{h.close();}
});
