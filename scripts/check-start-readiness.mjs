import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {startReadiness} from '../frontend/start-readiness.js';
import {makeGame,generateBooks} from '../server/bingo-model.js';
import {publishGameRules} from '../server/game-rules.js';
import {gameCapacity} from '../server/game-capacity.js';
import {BingoStore} from '../server/bingo-store.js';
import {createSqliteDatabase} from '../server/node-storage.js';
import {handleBingo} from '../server/bingo.js';

function snapshot(){
 const game=makeGame({brandId:'milo',title:'Startcontrole',date:'2027-01-01T18:00:00Z',roundCount:1},'host','https://studio.example');
 generateBooks(game,1,'startcheck-books');game.books[0].accountId='family';game.books[0].name='Deelnemer';publishGameRules(game);
 return {game,production:'milo',demo:false,dirty:false,working:false,runner:{active:false,index:0,phase:'idle'},apiStatus:{configured:true},voiceMode:'ai',outputConnected:false,stage:{production:'milo',hostId:'milo',camera:'wide',paused:false},characters:[{id:'milo',name:'Milo'}],voicePhase:'idle',voiceText:'',previewCamera:'wide',showRuntime:{},now:Date.now()};
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
  const s=snapshot();change(s);assert.equal(row(s,name).status,'blocked');assert.equal(startReadiness(s).canStart,false);
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

async function ui(){
 const {window}=parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
 const errors=[],context={window,document:window.document,navigator:{userAgent:'startcheck-qa'},location:{hash:''},console,setTimeout,clearTimeout,setInterval,clearInterval,performance,queueMicrotask,TextEncoder,TextDecoder,URL,URLSearchParams,crypto,structuredClone};
 context.self=context;context.globalThis=context;
 const js=(await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {StartCheck} from './frontend/App.jsx';import RegieWorkspace from './frontend/RegieWorkspace.jsx';const root=createRoot(document.getElementById('root'));window.renderTest=(kind,s,operator)=>flushSync(()=>root.render(kind==='start'?<StartCheck s={s} operator={operator} run={fn=>Promise.resolve(fn()).catch(window.testError)}/>:<RegieWorkspace s={s} engine={operator} run={fn=>Promise.resolve(fn()).catch(window.testError)}/>));window.closeTest=()=>flushSync(()=>root.unmount());`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',loader:{'.css':'empty'},logLevel:'warning',plugins:[{name:'renderer-boundary',setup(b){
  b.onLoad({filter:/frontend\/App\.jsx$/},({path})=>({loader:'jsx',contents:readFileSync(path,'utf8').replace('const engine=new StudioEngine();','const engine={};')}));
  b.onLoad({filter:/frontend\/components\.jsx$/},({path})=>{let source=readFileSync(path,'utf8'),a=source.indexOf('export function Stage('),z=source.indexOf('export function Pattern(',a);return {loader:'jsx',contents:source.slice(0,a)+`export function Stage(){return <div className="mf-stage-frame"/>;}\n`+source.slice(z)};});
  b.onResolve({filter:/RegiePanels\.jsx$/},()=>({path:'panels',namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:'export default function Panels(){return null;}'}));
 }}]})).outputFiles[0].text;
 window.testError=error=>errors.push(error);vm.runInNewContext(js,context);return {window,document:window.document,errors,close:()=>window.closeTest(),click(node){assert(node);node.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));}};
}

test('U03: actual StartCheck disables blocked native starts, exposes reasons and permits an explicit healthy start',async()=>{
 const h=await ui();try{
  let starts=0;const operator={start:async()=>{starts++;}},s=snapshot();s.game.orders=[{status:'payment_reported'}];h.window.renderTest('start',s,operator);
  let start=[...h.document.querySelectorAll('button')].find(node=>node.textContent==='Start de show');assert.equal(start.disabled,true);assert.match(h.document.querySelector('#mf-start-blockers').textContent,/Betaalcontrole: 1/);h.click(start);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(starts,0);
  s.game.orders=[];h.window.renderTest('start',s,operator);start=[...h.document.querySelectorAll('button')].find(node=>node.textContent==='Start de show');assert.equal(start.disabled,false);h.click(start);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(starts,1);assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});

test('U03: fixed Program/Preview transport keeps pause and explicit voice/guest mute available independently of modules',async()=>{
 const h=await ui();try{
  const s=snapshot(),actions=[];let stopped=0,paused=0,starts=0;
  const operator={calls:{held:false},stopSpeech(){stopped++;},pause(){paused++;},start(){starts++;},liveCalls:{onAir:true,getSnapshot:()=>({call:{phase:'live'}}),action:async(action,body)=>{actions.push({action,...body});}}};
  h.window.renderTest('regie',s,operator);assert(h.document.querySelector('.rd-monitor-wall>.rd-program'));assert(h.document.querySelector('.rd-monitor-wall>.rd-preview'));
  const transport=h.document.querySelector('.rd-transport');const button=label=>transport.querySelector(`button[aria-label="${label}"]`);
  assert.equal(button('Start draaiboek').disabled,true);h.click(button('Start draaiboek'));assert.equal(starts,0);
  h.click(button('Pauzeren'));h.click(button('Stem dempen'));h.click(button('Gast dempen'));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(paused,1);assert.equal(stopped,1);assert.deepEqual(actions,[{action:'ai-mute',muted:true},{action:'mute',muted:true}]);assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});
