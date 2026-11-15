// Inert capability fixtures and local React DOM only. No account, provider,
// database or actual OBS instance is contacted by these security/UI checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {isObsSource,obsSourceToken,obsFetch} from '../public/obs-access.js';
import {OutputBridge} from '../public/output-bridge.js';
import {LiveCallConnection,requestLiveCall} from '../frontend/live-call-api.js';

const TOKEN='A'.repeat(43)+'.'+'Q'.repeat(43),GAME='qa-show-one',OTHER='qa-show-two';
const location={origin:'https://obs-fixture.invalid',pathname:'/uitzending',hash:'#obs='+TOKEN};
const inertState=(gameId=GAME)=>({configured:false,gameId,activeGameId:null,currentAccessId:null,expiresAt:null,expired:false});
const activeState=(gameId=GAME)=>({...inertState(gameId),configured:true,activeGameId:gameId,currentAccessId:'qa-access-one',expiresAt:Date.now()+604800000});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('OBS capability is fragment-only and attaches only to the dedicated same-origin output API scope',async()=>{
 assert(isObsSource(location));assert.equal(obsSourceToken(location),TOKEN);
 for(const value of [{...location,pathname:'/'},{...location,hash:'#'+TOKEN},{...location,hash:'#obs=short'},{...location,hash:'#obs='+TOKEN+'&obs='+TOKEN}])assert.equal(obsSourceToken(value),null);
 const calls=[],fetcher=async(path,options)=>{calls.push({path,options});return new Response('{}');};
 for(const path of ['/api/output','/api/openai/clips/'+'a'.repeat(64),'/api/live-calls?role=output','/api/live-calls/token','/api/live-calls/realtime-stop','/api/obs/session'])await obsFetch(path,{headers:{'X-Fixture':'kept'}},{location,fetcher});
 assert.deepEqual(calls.map(call=>call.path),['/api/obs/output','/api/obs/clips/'+'a'.repeat(64),'/api/obs/live-calls?role=output','/api/obs/live-calls/token','/api/obs/live-calls/realtime-stop','/api/obs/session']);
 for(const {options} of calls){assert.equal(options.headers.get('X-Milo-OBS-Token'),TOKEN);assert.equal(options.headers.get('X-Fixture'),'kept');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');}
 calls.length=0;
 for(const path of ['/api/auth/session','/api/obs/access','/api/characters','/api/live-calls-evil','/api/openai/clips/not-a-sha','https://another.invalid/api/output'])await obsFetch(path,{}, {location,fetcher});
 for(const {options} of calls)assert.equal(new Headers(options.headers).get('X-Milo-OBS-Token'),null);
 await assert.rejects(obsFetch('/api/output',{}, {location:{...location,hash:'#obs=broken'},fetcher}),/ongeldig/);
 assert.equal(calls.length,6,'Invalid OBS fragments must be rejected before fetch');
});

test('ordinary regie/player transport remains unchanged and cannot read an OBS token from another route',async()=>{
 const options={method:'POST',headers:{'X-Vlampie-Output':'1'},body:'{}'},calls=[];
 await obsFetch('/api/output',options,{location:{...location,pathname:'/'},fetcher:async(path,init)=>{calls.push({path,init});return new Response('{}');}});
 assert.equal(calls[0].path,'/api/output');assert.equal(calls[0].init,options);
});

test('scoped denial and network loss signal immediate silence; deliberate fetch cancellation does not',async t=>{
 const original=globalThis.window,window=new EventTarget();globalThis.window=window;t.after(()=>{globalThis.window=original;});let losses=0;window.addEventListener('milo-obs-access-lost',()=>losses++);
 await obsFetch('/api/output',{}, {location,fetcher:async()=>new Response('{}',{status:401})});assert.equal(losses,1);
 await assert.rejects(obsFetch('/api/live-calls',{}, {location,fetcher:async()=>{throw Error('fixture network down');}}),/network down/);assert.equal(losses,2);
 await assert.rejects(obsFetch('/api/output',{}, {location,fetcher:async()=>{throw new DOMException('fixture cancellation','AbortError');}}),{name:'AbortError'});assert.equal(losses,2);
});

test('output live-call polling and pagehide keepalive use the scoped capability transport',async t=>{
 const before={location:globalThis.location,fetch:globalThis.fetch};t.after(()=>Object.assign(globalThis,before));Object.assign(globalThis,{location});const calls=[];
 globalThis.fetch=async(path,options)=>{calls.push({path,options});return new Response(JSON.stringify({call:null}));};
 await requestLiveCall('/api/live-calls?role=output&gameId='+GAME);
 const connection=new LiveCallConnection({role:'output',getGameId:()=>GAME,getClientId:()=>'qa-output'});connection.call={id:'qa-call',phase:'live'};connection.leave();await wait(0);connection.dispose();
 assert.equal(calls[0].path,'/api/obs/live-calls?role=output&gameId='+GAME);assert.equal(calls[1].path,'/api/obs/live-calls');assert.equal(calls[1].options.keepalive,true);assert.equal(calls[1].options.headers.get('X-Milo-OBS-Token'),TOKEN);assert.equal(JSON.parse(calls[1].options.body).role,'output');
});

test('OBS output never opens the unprojected BroadcastChannel and fails closed before audio activation',async t=>{
 const before={location:globalThis.location,BroadcastChannel:globalThis.BroadcastChannel};t.after(()=>Object.assign(globalThis,before));let channels=0;Object.assign(globalThis,{location,BroadcastChannel:class{constructor(){channels++;}}});
 class FixtureBridge extends OutputBridge{mount(){}}
 const events=[],bridge=new FixtureBridge({isOutput:true,showAudio:{setMuted:value=>events.push(['mute',value]),stop:()=>events.push(['stop'])},receive:event=>events.push(event)});t.after(()=>bridge.dispose());
 assert.equal(channels,0);assert.equal(bridge.channel,null);bridge.lastSnapshot={characterSettings:[{knowledge:'private old state'}],liveCall:{name:'Private caller'}};bridge.api=async()=>{throw Object.assign(Error('OBS-link ingetrokken'),{status:401});};await bridge.tick();
 assert.equal(bridge.audioReady,false);assert.equal(bridge.active,false);assert(events.some(event=>Array.isArray(event)&&event[0]==='stop'));
 const snapshot=events.find(event=>event.kind==='snapshot').payload;assert.equal(snapshot.outputWaiting,true);assert(!('characterSettings' in snapshot));assert(!('liveCall' in snapshot));
});

test('activation cannot heartbeat ready with a suspended context or failed show-audio unlock',async()=>{
 for(const [state,unlocked] of [['suspended',true],['running',false],['running',true]]){
  let heartbeats=0;const bridge=Object.assign(Object.create(OutputBridge.prototype),{accessEpoch:0,audioGraphReady:true,context:{state,resume:async()=>{}},showAudio:{unlock:async()=>unlocked,setMuted(){},stop(){}},panel:{hidden:false,querySelector:()=>({textContent:''})},heartbeat:async()=>{heartbeats++;},playProgramTest:async()=>{},stopSource(){}});
  if(state==='running'&&unlocked){await bridge.activate();assert.equal(bridge.audioReady,true);assert.equal(bridge.active,true);assert.equal(heartbeats,1);}
  else {await assert.rejects(bridge.activate(),/Geluid is nog geblokkeerd/);assert.equal(bridge.audioReady,false);assert.equal(bridge.active,false);assert.equal(heartbeats,0);}
 }
});

test('a valid producer snapshot retries transient OBS activation and respects the autoplay retry backoff',async()=>{
 let retries=0;const bridge=Object.assign(Object.create(OutputBridge.prototype),{obs:true,isOutput:true,context:{state:'running'},active:false,audioReady:false,offset:0,seen:new Set(),showAudio:{setLevels(){},setMuted(){}},receive(){},activate:async()=>{retries++;}});
 const state={producer:{id:'qa-producer',generation:1},seq:1,snapshot:{gameId:GAME},publishedAt:Date.now(),events:[],routing:false};bridge.consume(state);await wait(0);assert.equal(retries,1);
 bridge.automaticAudioBlocked=true;bridge.nextAutomaticAt=Date.now()+10000;bridge.consume({...state,seq:2});await wait(0);assert.equal(retries,1);bridge.nextAutomaticAt=0;bridge.consume({...state,seq:3});await wait(0);assert.equal(retries,2);
});

const root=fileURLToPath(new URL('..',import.meta.url));
const bundle=(await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import ObsSourceSettings from './frontend/ObsSourceSettings.jsx';let root;window.renderOBS=props=>{root??=createRoot(document.getElementById('root'));flushSync(()=>root.render(React.createElement(ObsSourceSettings,props)));};window.closeOBS=()=>root&&flushSync(()=>root.unmount());`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',loader:{'.css':'empty'},logLevel:'warning'})).outputFiles[0].text;
function harness(t,respond,onConnect){
 const {window}=parseHTML('<!doctype html><html><body><div id="root"></div></body></html>'),{document}=window,calls=[],copies=[],errors=[],persisted=[],connects=[];
 const raf=()=>1,computed=()=>new Proxy({getPropertyValue:()=>''},{get:(object,key)=>object[key]||''});window.HTMLElement.prototype.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:900,bottom:700,width:900,height:700});
 const storage={getItem:()=>null,setItem:(...args)=>persisted.push(args)};
 const context={window,document,location:{origin:'https://obs-ui.invalid'},navigator:{userAgent:'OBS fixture',clipboard:{writeText:async value=>copies.push(value)}},console:{...console,error:(...args)=>errors.push(args.map(String).join(' '))},setTimeout,clearTimeout,performance,queueMicrotask,crypto,structuredClone,URL,AbortController,AbortSignal,Response,HTMLElement:window.HTMLElement,SVGElement:window.SVGElement,Element:window.Element,Node:window.Node,Event:window.Event,requestAnimationFrame:raf,cancelAnimationFrame(){},getComputedStyle:computed,matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),localStorage:storage,sessionStorage:storage,fetch:()=>{throw Error('Real network access is forbidden in OBS UI checks');}};context.self=context;context.globalThis=context;
 vm.runInNewContext(bundle,context,{filename:'obs-source-ui-fixture.js'});
 const request=async(gameId,body)=>{calls.push({gameId,...(body?{body:structuredClone(body)}:{})});return respond(gameId,body);};
 const render=async(gameId=GAME,demo=false,extra={})=>{window.renderOBS({s:{demo,game:{id:gameId},...extra},request,onConnect:async id=>{connects.push(id);await onConnect?.(id);}});await wait(45);};
 const button=label=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===label);
 const click=async label=>{const node=button(label);assert(node,'Missing OBS action '+label);assert(!node.disabled,'OBS action unexpectedly disabled');node.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));await wait(35);};
 t.after(()=>{window.closeOBS();assert.deepEqual(persisted,[]);assert.deepEqual(errors,[]);});return {document,calls,copies,connects,render,button,click};
}

test('starting the show-bound producer is explicit, opens no popup and is unavailable for unsaved edits',async t=>{
 const h=harness(t,async gameId=>inertState(gameId));await h.render();assert.deepEqual(h.connects,[]);assert.deepEqual(h.calls,[]);
 await h.click('Beeld naar OBS sturen');assert.deepEqual(h.connects,[GAME]);assert.deepEqual(h.calls,[]);assert.match(h.document.body.textContent,/Houd deze regiepagina open/);
 await h.render(OTHER,false,{dirty:true});assert(h.button('Beeld naar OBS sturen').disabled);assert.deepEqual(h.connects,[GAME]);
});

test('OBS management is lazy; initial create and revoke are explicit, scoped and keep the raw link out of status/storage',async t=>{
 let state=inertState();const h=harness(t,async(gameId,body)=>{
  if(!body)return {...state,gameId};
  if(body.action==='create'){assert.equal(body.expectedAccessId,null);state=activeState(gameId);return {...state,token:TOKEN};}
  assert.equal(body.action,'revoke');assert.equal(body.expectedAccessId,'qa-access-one');state=inertState(gameId);return state;
 });
 await h.render();assert.equal(h.calls.length,0);assert(h.button('OBS-link beheren'));await h.click('OBS-link beheren');assert.equal(h.calls.length,1);assert(h.button('OBS-link maken'));assert.equal(h.document.querySelector('input'),null);
 await h.click('OBS-link maken');assert.equal(h.calls.length,2);const input=h.document.querySelector('input');assert(input.getAttributeNames().some(name=>name.toLowerCase()==='readonly'));assert.equal(input.value,'https://obs-ui.invalid/uitzending#obs='+TOKEN);assert.equal(h.copies.length,0);
 await h.click('OBS-link kopiëren');assert.equal(h.copies[0],input.value);
 await h.click('OBS-link intrekken');assert.equal(h.calls.length,2,'Revocation requires confirmation');await h.click('Annuleren');assert.equal(h.calls.length,2);
 await h.click('OBS-link intrekken');await h.click('Bevestigen');assert.equal(h.calls.length,3);assert.equal(h.document.querySelector('input'),null);assert(h.button('OBS-link maken'));
 assert.deepEqual(h.calls.map(call=>call.body).filter(Boolean),[{action:'create',expectedAccessId:null},{action:'revoke',expectedAccessId:'qa-access-one'}]);
});

test('an existing link for another show requires explicit replacement and a stale status error never auto-retries the mutation',async t=>{
 const h=harness(t,async(gameId,body)=>{if(!body)return {...activeState(OTHER),gameId};assert.equal(body.action,'create');assert.equal(body.expectedAccessId,'qa-access-one');throw Error('De OBS-link is intussen gewijzigd. Vernieuw de status.');});
 await h.render();await h.click('OBS-link beheren');assert.match(h.document.body.textContent,/actieve OBS-link voor een andere show/);await h.click('Nieuwe OBS-link maken');assert.equal(h.calls.length,1);await h.click('Bevestigen');assert.equal(h.calls.length,2);assert.match(h.document.querySelector('[role="alert"]').textContent,/intussen gewijzigd/);assert.equal(h.document.querySelector('input'),null);await wait(80);assert.equal(h.calls.length,2);
});

test('show changes discard a delayed capability and reset lazy management; rehearsal cannot create one',async t=>{
 const pending=deferred();const h=harness(t,async(gameId,body)=>body?pending.promise:inertState(gameId));
 await h.render();await h.click('OBS-link beheren');await h.click('OBS-link maken');await h.render(OTHER);pending.resolve({...activeState(),token:TOKEN});await wait(40);
 assert.equal(h.document.querySelector('input'),null);assert(h.button('OBS-link beheren'));assert.equal(h.calls.length,2);
 await h.render(OTHER,true);assert.equal(h.button('OBS-link beheren'),undefined);assert.equal(h.button('OBS-link maken'),undefined);assert.match(h.document.body.textContent,/Sla eerst een show op/);assert.equal(h.calls.length,2);
});
