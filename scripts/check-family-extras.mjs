// Family integration checks in a lightweight DOM. These exercise actual React
// events, API payloads, QR parsing and LiveKit controller teardown. Canvas appearance,
// physical camera/microphone access and live media/provider playback are not mocked as passing.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {makeGame} from '../server/bingo-model.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bundle(options){return (await build({bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',loader:{'.css':'empty'},logLevel:'warning',...options})).outputFiles[0].text;}
function harness(fetcher=async()=>Response.json({}),pathname='/'){
 const {window}=parseHTML('<!doctype html><html><body><div id="root"></div></body></html>'),{document}=window;
 const timers=new Set(),intervals=new Set(),errors=[],requests=[];
 const timeout=(fn,ms,...args)=>{const t=setTimeout(()=>{timers.delete(t);fn(...args);},ms);timers.add(t);return t;};
 const interval=(fn,ms)=>{const t=setInterval(fn,ms);intervals.add(t);return t;};
 const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
 const localStorage=storage(),sessionStorage=storage(),url=new URL(pathname,'https://bingo.example');
 const location={get href(){return url.href},set href(v){url.href=v},get pathname(){return url.pathname},get search(){return url.search},get hash(){return url.hash},set hash(v){url.hash=v;timeout(()=>window.dispatchEvent(new window.Event('hashchange')),0)},get origin(){return url.origin},reload(){}};
 const gradient={addColorStop(){}};
 const canvas=new Proxy({measureText:s=>({width:String(s).length*8}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,canvas:{width:1280,height:720}},{get:(t,k)=>t[k]??(()=>{})});
 window.HTMLCanvasElement.prototype.getContext=()=>canvas;
 window.HTMLElement.prototype.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:900,bottom:500,width:900,height:500});
 window.HTMLElement.prototype.focus=function(){document._active=this;};
 Object.defineProperty(document,'activeElement',{get:()=>document._active||document.body});
 window.HTMLElement.prototype.scrollIntoView=()=>{};window.HTMLElement.prototype.scrollTo=()=>{};window.scrollTo=()=>{};window.open=()=>({closed:false});
 class ImageStub{constructor(){this.width=this.naturalWidth=800;this.height=this.naturalHeight=1200;}set src(v){this._src=v}get src(){return this._src}}
 class Observer{observe(){}unobserve(){}disconnect(){}}
 class Channel{postMessage(){}close(){}}
 const computed=()=>new Proxy({getPropertyValue:()=>'',fontSize:'14px',display:'block',visibility:'visible',position:'static',transform:'none',opacity:'1'},{get:(t,k)=>t[k]??''});
 const speechSynthesis={pause(){},resume(){},cancel(){},getVoices(){return []},speak(u){u.onstart?.();timeout(()=>u.onend?.(),20);}};
 const fetch=async(url,opts={})=>{const request={url:String(url),method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):null,headers:opts.headers||{}};requests.push(request);return fetcher(request);};
 const raf=fn=>timeout(()=>fn(performance.now()),16),matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
 const context={window,document,location,history:{replaceState(){}},navigator:{userAgent:'dom-qa',clipboard:{writeText:async()=>{}}},localStorage,sessionStorage,
  console:{...console,error:(...s)=>{errors.push(s.map(String).join(' '));console.error(...s);}},setTimeout:timeout,clearTimeout,setInterval:interval,clearInterval,requestAnimationFrame:raf,cancelAnimationFrame:clearTimeout,performance,crypto:globalThis.crypto,queueMicrotask,structuredClone,fetch,Headers,Response,Request,AbortController,AbortSignal,URL,URLSearchParams,TextEncoder,TextDecoder,Blob,atob,btoa,
  Image:ImageStub,ResizeObserver:Observer,IntersectionObserver:Observer,MutationObserver:window.MutationObserver,BroadcastChannel:Channel,SpeechSynthesisUtterance:class{constructor(t){this.text=t;}},speechSynthesis,Event:window.Event,CustomEvent:window.CustomEvent,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,SVGElement:window.SVGElement,Element:window.Element,Node:window.Node,NodeFilter:window.NodeFilter,getComputedStyle:computed,matchMedia,
  FormData:class{constructor(form){this.values=new Map([...form.querySelectorAll('input,select,textarea')].filter(e=>e.name).map(e=>[e.name,e.value??e.getAttribute('value')??'']));}get(k){return this.values.get(k)||null;}}};
 Object.assign(window,{location,localStorage,sessionStorage,matchMedia,getComputedStyle:computed,requestAnimationFrame:raf,cancelAnimationFrame:clearTimeout,Image:ImageStub,ResizeObserver:Observer,IntersectionObserver:Observer,BroadcastChannel:Channel,fetch,speechSynthesis});
 for(const name of ['addEventListener','removeEventListener','dispatchEvent'])context[name]=window[name].bind(window);
 context.globalThis=context;context.self=context;context.global=context;
 const rejection=e=>errors.push(String(e?.stack||e));process.on('unhandledRejection',rejection);
 const event=(el,type)=>{assert.ok(el,'Missing DOM control for '+type);el.dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true}));};
 const click=label=>{const buttons=[...document.querySelectorAll('button')],el=buttons.find(e=>e.textContent.trim()===label)||buttons.find(e=>e.textContent.includes(label));event(el,'click');return el;};
 const body=()=>document.body.textContent;
 return {window,document,context,requests,errors,event,click,body,run:js=>vm.runInNewContext(js,context,{filename:'ui-regression.js'}),
  async navigate(route){location.hash='/'+route;await wait(420);assert.ok(!body().includes('De studio kon niet starten.'),'Route crashed: '+route);},
  close(){for(const t of timers)clearTimeout(t);for(const t of intervals)clearInterval(t);process.off('unhandledRejection',rejection);}};
}

async function checkFamilyCompletion(){
 const {generateBooks,playerGame}=await import('../server/bingo-model.js');
 const full=makeGame({brandId:'milo',title:'Family UI regressie',timeZone:'Europe/Amsterdam',date:'2026-11-01T14:00',roundCount:4},'qa-owner','https://bingo.example');generateBooks(full,2,'family-completion');full.production=(await import('../server/production-model.js')).productionSettings();full.production.calls.enabled=true;
 const separateVlampie=makeGame({brandId:'vlampie',title:'Vlampie blijft apart',timeZone:'Europe/Amsterdam',date:'2026-12-05T19:00'},'qa-owner','https://bingo.example');separateVlampie.status='running';
 full.status='running';Object.assign(full.state,{phase:'running',roundIndex:0,blockIndex:full.plan.blocks.findIndex(b=>b.type==='round'),epoch:'qa-family-epoch',drawn:[7,24,62]});full.settings.youtubeId='abcdefghijk';
 const family={accountProfileId:'parent',ownerName:'Ouder',email:'parent@example.test',profiles:[{id:'noor',name:'Noor',age:8,dateOfBirth:'2018-01-02'}],cooldowns:{},blockedGames:{}};
 for(const b of full.books)Object.assign(b,{accountId:'qa-family',profileId:'noor',name:'Noor',age:8,admitted:true});
 const h=harness(({url,method,body})=>{
  if(url==='/api/player/session')return Response.json({authenticated:true,accountId:'qa-family',email:family.email,method:'email',family});
  if(url.startsWith('/api/player/brand'))return Response.json({brandId:'milo'});
  if(url==='/api/bingo/me')return Response.json({accountId:'qa-family',family});
  if(url==='/api/bingo/games')return Response.json({games:[separateVlampie,full]});
  if(url==='/api/bingo/games/'+full.id+'?player=1'||url.startsWith('/api/bingo/games/'+full.id+'/live?'))return Response.json({game:playerGame(full,'qa-family'),complete:true,familyRevision:1,booksVersion:'fixture',scope:'qa-family',serverTime:Date.now()});
  if(url==='/api/bingo/games/'+full.id+'/participation'&&method==='POST')return Response.json({game:playerGame(full,'qa-family')});
  if(url==='/api/bingo/games/'+full.id+'/begin'&&method==='POST'){full.state.windowSequence=(full.state.windowSequence||0)+1;full.state.window={id:'qa-window',status:'open',startedAt:Date.now(),endsAt:Date.now()+30000,announcements:[{accountId:'qa-family',status:'accepted'}],claims:[]};return Response.json({game:playerGame(full,'qa-family'),serverTime:Date.now()});}
  if(url==='/api/bingo/games/'+full.id+'/claim'&&method==='POST'){const claim={id:'qa-claim',accountId:'qa-family',bookId:body.bookId,status:'received'};full.state.window.claims.push(claim);return Response.json({game:playerGame(full,'qa-family'),claim,serverTime:Date.now()});}
  return Response.json({error:{message:'Unmocked family route '+url}},{status:404});
 },'/spelen');
 try{
  h.run(await bundle({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import FamilyApp from './frontend/FamilyApp.jsx';createRoot(document.getElementById('root')).render(React.createElement(FamilyApp));`,resolveDir:root,loader:'jsx'}}));await wait(850);
  assert.equal(h.document.querySelector('.fam-lounge-intro'),null,'The broadcast should not be pushed down by a welcome hero');
  assert.equal(h.document.querySelector('.fam-game-focus'),null,'The old sidebar must not compete with the full-width broadcast');
  assert.equal(h.document.querySelector('.family-app')?.dataset.brand,'milo');
  assert.equal(h.document.querySelector('.fam-brand img')?.getAttribute('src'),'/assets/milo-friends/logo.png');
  assert.deepEqual([...h.document.querySelectorAll('.fam-tabs button span')].map(e=>e.textContent),['Kijken','Boekjes','Gezin','Meedoen','Prijzen']);
  const persistentBroadcast=h.document.querySelector('.fam-broadcast-persistent');
  const iframe=h.document.querySelector('.fam-youtube-frame iframe');assert(iframe,'Running show must mount the YouTube player');
  const rows=[...h.document.querySelectorAll('.fam-number-grid > .fam-number-row')];
  assert.equal(rows.length,5,'The called-number board must contain five rows');
  for(const row of rows)assert.equal(row.querySelectorAll('.fam-number-ball').length,15,'Every row must contain fifteen numbered balls');
  const balls=[...h.document.querySelectorAll('.fam-number-grid .fam-number-ball')];
  assert.deepEqual(balls.map(el=>Number(el.dataset.number)),Array.from({length:75},(_,i)=>i+1),'All official numbers must remain visible in numerical order');
  const boardState=()=>({drawn:[...h.document.querySelectorAll('.fam-number-ball.is-drawn')].map(el=>Number(el.dataset.number)),latest:[...h.document.querySelectorAll('.fam-number-ball.is-latest')].map(el=>Number(el.dataset.number))});
  assert.deepEqual(boardState(),{drawn:[7,24,62],latest:[62]},'Only server-confirmed numbers may light up');
  assert.deepEqual([...h.document.querySelectorAll('.fam-broadcast-persistent,.fam-play-console,.fam-chat')].map(el=>el===persistentBroadcast?'broadcast':el.classList.contains('fam-play-console')?'numbers-and-bingo':'chat'),['broadcast','numbers-and-bingo','chat'],'Watching, official numbers/BINGO and chat must follow the requested order');
  const sphere=h.document.querySelector('button.fam-bingo-sphere');assert(sphere,'The show must provide the spherical BINGO action');assert.equal(sphere.disabled,false);
  const writesBeforeBoard=h.requests.filter(r=>r.method==='POST').length;h.event(balls[74],'click');await wait(20);assert.equal(h.requests.filter(r=>r.method==='POST').length,writesBeforeBoard,'The official number board is read-only');
  full.state.drawn.push(53);full.revision=(full.revision||0)+1;await wait(3150);
  assert.deepEqual(boardState(),{drawn:[7,24,53,62],latest:[53]},'Server refresh must light the new ball and clear the old latest highlight');
  assert.equal(h.document.querySelector('.fam-number-ball[data-number="62"]'),balls[61],'Updating the draw must preserve existing ball elements');
  h.click('Meedoen');await wait(420);assert.equal(h.document.querySelector('.fam-broadcast-persistent'),persistentBroadcast,'Broadcast must remain mounted across family tabs');
  assert(h.body().includes('Niet alleen kijken. Meedoen!'));assert(h.body().includes('Hallo Noor!'));
  const greeting=[...h.document.querySelectorAll('button')].find(b=>b.textContent.includes('Meld begroeting aan'));assert(greeting.disabled,'Consent gate should disable greeting');
  const consent=h.document.querySelector('.greeting input[type=checkbox]');consent.checked=true;h.event(consent,'click');await wait(40);
  assert.equal(greeting.disabled,false,'Greeting should enable after consent');h.click('Meld begroeting aan');await wait(40);
  const request=h.requests.find(r=>r.url.endsWith('/participation'));assert.equal(request.body.kind,'greeting');assert.equal(request.body.profileId,'noor');assert.equal(request.body.consent,true);assert.equal(request.headers['X-Vlampie-Player'],'1');
  h.click('Boekjes');await wait(420);const number=[...h.document.querySelectorAll('.fam-card-numbers button')].find(b=>!b.classList.contains('free'));const label=number.getAttribute('aria-label');h.event(number,'click');await wait(30);assert.equal(number.getAttribute('aria-pressed'),'true');h.click('Gezin');await wait(420);h.click('Boekjes');await wait(420);assert([...h.document.querySelectorAll('.fam-card-numbers button')].some(b=>b.getAttribute('aria-label')===label+', afgestreept'&&b.getAttribute('aria-pressed')==='true'),'Marks must survive tab navigation');
  h.click('Kijken');await wait(420);assert.equal(h.document.querySelector('.fam-youtube-frame iframe'),iframe,'YouTube iframe must not reload on tab changes');const beforeClaim=h.requests.filter(r=>/\/(begin|claim)$/.test(r.url)).length;h.click('BINGO!');await wait(50);assert(h.body().includes('Heb je écht BINGO?'));assert.equal(h.requests.filter(r=>/\/(begin|claim)$/.test(r.url)).length,beforeClaim,'Opening a BINGO confirmation must not announce bingo');h.click('Ja, meld deze BINGO!');await wait(90);const begin=h.requests.find(r=>r.url.endsWith('/begin')),claim=h.requests.find(r=>r.url.endsWith('/claim'));assert.equal(begin.body.claimContext.epoch,'qa-family-epoch');assert.equal(claim.body.bookId,full.books[0].id);assert.equal(claim.body.windowId,'qa-window');h.click('Terug naar de show');await wait(220);
  h.click('Boekjes');await wait(420);h.click('Open QR-scanner');await wait(80);assert(h.body().includes('Scan jullie bingoboekje.'));assert(h.body().includes('Camera openen'));h.click('Ik vul de acht tekens zelf in');await wait(80);assert(h.body().includes('Een eigen boekje voor iedere speler.'));
  assert.equal([...h.document.querySelectorAll('a')].some(a=>a.getAttribute('href')?.includes('/klassiek')),false);
  assert.deepEqual(h.errors,[]);console.log('✓ Family: broadcast → read-only 5×15 number board with live refresh → chat, spherical confirmed BINGO, Milo logo, persistent YouTube, saved marks, consent and QR/manual workflow');
 }finally{h.close();}
}
async function checkExplicitVlampieEntrance(){
 const {playerGame}=await import('../server/bingo-model.js'),full=makeGame({brandId:'vlampie',title:'Vlampie blijft apart',timeZone:'Europe/Amsterdam',date:'2026-12-05T19:00'},'qa-owner','https://bingo.example');
 const family={ownerName:'Ouder',email:'parent@example.test',profiles:[],blockedGames:{},cooldowns:{}};
 const h=harness(({url})=>{
  if(url==='/api/player/session')return Response.json({authenticated:true,accountId:'qa-vlampie',method:'email',family});
  if(url.startsWith('/api/player/brand'))return Response.json({brandId:'vlampie'});
  if(url==='/api/bingo/games')return Response.json({games:[full]});
  if(url==='/api/bingo/games/'+full.id+'?player=1'||url.startsWith('/api/bingo/games/'+full.id+'/live?'))return Response.json({game:playerGame(full,'qa-vlampie'),complete:true,familyRevision:1,booksVersion:'fixture',scope:'qa-vlampie',serverTime:Date.now()});
  return Response.json({error:{message:'Unmocked Vlampie fixture route '+url}},{status:404});
 },'/spelen?spel='+full.id);
 try{
  h.run(await bundle({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import FamilyApp from './frontend/FamilyApp.jsx';createRoot(document.getElementById('root')).render(React.createElement(FamilyApp));`,resolveDir:root,loader:'jsx'}}));await wait(850);
  assert.equal(h.document.querySelector('.family-app')?.dataset.brand,'vlampie');assert.equal(h.document.querySelector('.fam-brand img')?.getAttribute('src'),'/assets/studio-logo.png');assert.equal(h.document.querySelector('.fam-waiting-backdrop')?.getAttribute('src'),'/assets/studio-master-v14.png');assert(h.body().includes('Vlampie blijft apart'));assert(!h.document.querySelector('img[src="/assets/milo-friends/logo.png"]'));assert.deepEqual(h.errors,[]);console.log('✓ Brand separation: generic entrance prefers Milo; explicit Vlampie keeps its logo, studio and selected game');
 }finally{h.close();}
}
async function checkCallAvailability(){
 const game={id:'game-availability',status:'running',books:[{profileId:'noor',admitted:true},{profileId:'lio',admitted:true}],production:{calls:{enabled:true},participation:[]}},profiles=[{id:'noor',name:'Noor',age:8},{id:'lio',name:'Lio',age:7}];
 const h=harness(({url,method})=>url.endsWith('/participation')&&method==='POST'?Response.json({game}):Response.json({error:'Unexpected fixture route'},{status:404}));
 try{
  h.run(await bundle({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {FamilyParticipation} from './frontend/FamilyExtras.jsx';const root=createRoot(document.getElementById('root'));window.qaChecks=[];const callState={active:false,checkConnection:async(profileId,status,level)=>{window.qaChecks.push(profileId);status('Testfixture, geen echte verbinding');level(.4);return {microphone:true,connection:true,micChecked:true,connectionChecked:true,simulated:true};}};flushSync(()=>root.render(React.createElement(FamilyParticipation,{game:${JSON.stringify(game)},profiles:${JSON.stringify(profiles)},onGame:()=>{},callState})));window.qaClose=()=>flushSync(()=>root.unmount());`,resolveDir:root,loader:'jsx'}}));await wait(70);
  assert.equal(h.window.qaChecks.length,0,'Ordinary visitor must not preflight automatically');const select=h.document.querySelector('select');Object.defineProperty(select,'value',{value:'lio',writable:true,configurable:true});h.event(select,'change');await wait(40);assert(h.body().includes('Hallo Lio!'));const calling=h.document.querySelector('.calling'),inputs=[...calling.querySelectorAll('input[type=checkbox]')];assert.equal(inputs.length,3);for(const input of inputs){input.checked=true;h.event(input,'click');}await wait(40);
  const available=[...calling.querySelectorAll('button')].find(e=>e.textContent.includes('Beschikbaar om'));assert(available.disabled,'Consents are insufficient without a real preflight');h.click('Test microfoon & verbinding');await wait(40);assert.deepEqual(Array.from(h.window.qaChecks),['lio']);assert.equal(available.disabled,false);h.click('Beschikbaar om gebeld te worden');await wait(50);const request=h.requests.find(r=>r.url.endsWith('/participation'));assert.equal(request.body.profileId,'lio');for(const field of ['enabled','consent','parentConsent','micChecked','connectionChecked','headphones'])assert.equal(request.body[field],true,field);assert(h.body().includes('Houd deze app geopend.'));h.window.qaClose();assert.deepEqual(h.errors,[]);console.log('✓ Availability: explicit child, no automatic preflight, consent/headphone/test gate and checked availability payload (fixture media only)');
 }finally{h.close();}
}
async function checkQrParser(){
 const h=harness();try{h.run(await bundle({stdin:{contents:`import {parseBookQr} from './frontend/FamilyExtras.jsx';window.qaParse=parseBookQr;`,resolveDir:root,loader:'jsx'}}));
  const parse=h.window.qaParse;assert.equal(parse('ABCD-1234').code,'ABCD-1234');assert.equal(parse('https://bingo.example/spelen?spel=game-1&boek='+'a'.repeat(72)).gameId,'game-1');assert.throws(()=>parse('https://bad.example/other?spel=g&boek='+'a'.repeat(72)));assert.throws(()=>parse('javascript:alert(1)'));assert.throws(()=>parse('https://bingo.example/spelen?spel=game-1'));console.log('✓ QR parser: manual code, valid book URL and invalid/non-book URLs');
 }finally{h.close();}
}


async function checkCallLifecycle(){
 const game={id:'game-life',brandId:'milo',production:{participation:[{callId:'call-life',callStatus:'available'}]}};
 const selected={id:'call-life',gameId:'game-life',name:'Noor',context:{callName:'Noortje'},phase:'ringing',characterName:'Stella Sterrenstof',profileId:'noor',version:1,createdAt:Date.now()-1000,drawHeld:true,checkpoint:{id:'checkpoint-life',drawnCount:3,lastNumber:42,drawn:[3,12,42]}};
 const h=harness(({url,method,body})=>{
  if(url.startsWith('/api/live-calls'))return Response.json({serverTime:Date.now(),call:method==='POST'?{...selected,phase:'returning',outcome:'failed'}:selected});
  return Response.json({error:{message:'Unmocked call route '+url}},{status:404});
 },'/spelen');
 try{
  h.run(await bundle({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {usePlayerCall} from './frontend/FamilyExtras.jsx';import FamilyLiveCall from './frontend/FamilyLiveCall.jsx';const root=createRoot(document.getElementById('root'));const info={ready:true,framePresent:true,playing:true,muted:false,volume:80,currentTime:123};const broadcast={subscribe:()=>()=>{},getSnapshot:()=>info,restore:async()=>info,getInfo:()=>info};function Probe(){const state=usePlayerCall({game:${JSON.stringify(game)},accountId:'family-life',enabled:true,broadcast});window.qaCall=state;return React.createElement(FamilyLiveCall,{callState:state,broadcast,game:${JSON.stringify(game)}});}flushSync(()=>root.render(React.createElement(Probe)));window.qaClose=()=>flushSync(()=>root.unmount());`,resolveDir:root,loader:'jsx'}}));
  await wait(250);assert.equal(h.window.qaCall.active,true);assert.equal(h.window.qaCall.call.phase,'ringing');assert(h.document.querySelector('.fam-call-panel[role=dialog]'));assert(h.body().includes('Stella Sterrenstof belt je!'));assert(h.body().includes('Noortje'));assert(h.body().includes('privé tot jij en je ouder akkoord geven'),'The invitation preserves parent permission and private staging');assert(h.body().includes('42'));assert.equal(h.document.body.style.overflow,'hidden');
  const answer=[...h.document.querySelectorAll('button')].find(b=>b.textContent==='Opnemen');assert.equal(answer.disabled,false,'The prior show preparation avoids a second checklist');assert(h.body().includes('Zet het geluid van de show zachter'));assert.equal(h.requests.some(r=>r.url.includes('/token')||r.url.includes('/realtime')||r.url.includes('/preflight')),false,'Ringing ordinary app does not request a room or AI session');
  h.window.qaClose();await wait(40);assert.equal(h.document.querySelector('[role=dialog]'),null);assert.notEqual(h.document.body.style.overflow,'hidden');assert(h.requests.some(r=>r.method==='POST'&&r.body.action==='fail'&&r.body.role==='player'&&r.headers['X-Vlampie-Player']==='1'),'Unmount must report failure while retaining the draw hold');const polls=h.requests.filter(r=>r.url.startsWith('/api/live-calls?')).length;await wait(1400);assert.equal(h.requests.filter(r=>r.url.startsWith('/api/live-calls?')).length,polls,'Unmounted call must stop polling');assert.deepEqual(h.errors,[]);console.log('✓ Player call: selected child, simple ring dialog with untouched YouTube, no room/AI before answer, teardown failure and stopped polling');
 }finally{h.close();}
}

async function checkMiloPersistentCallPermission(){
 const game={id:'milo-persistent-permission',brandId:'milo',status:'running',books:[{profileId:'noor',admitted:true},{profileId:'lio',admitted:true}],production:{calls:{enabled:true},participation:[{profileId:'noor',callConsentEnabled:true,callConsentAt:1000,callStatus:'done',parentConsent:true,micChecked:true,connectionChecked:true,headphones:true}]}},profiles=[{id:'noor',name:'Noor',age:8},{id:'lio',name:'Lio',age:7}];
 const h=harness(({url,method,body})=>{if(!url.endsWith('/participation')||method!=='POST')return Response.json({error:'Unexpected fixture route'},{status:404});let entry=game.production.participation.find(entry=>entry.profileId===body.profileId);if(!entry){entry={profileId:body.profileId};game.production.participation.push(entry);}Object.assign(entry,{callConsentEnabled:body.enabled,parentConsent:body.parentConsent,...(body.micChecked?{micChecked:true,connectionChecked:true,headphones:true}:{})});return Response.json({game});});
 try{
  h.run(await bundle({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {FamilyParticipation} from './frontend/FamilyExtras.jsx';const root=createRoot(document.getElementById('root'));window.qaChecks=[];function Probe(){const [game,setGame]=useState(${JSON.stringify(game)});const callState={active:false,checkConnection:async id=>{window.qaChecks.push(id);return {microphone:true,connection:true,simulated:true};}};return React.createElement(FamilyParticipation,{game,profiles:${JSON.stringify(profiles)},onGame:setGame,callState});}flushSync(()=>root.render(React.createElement(Probe)));window.qaClose=()=>flushSync(()=>root.unmount());`,resolveDir:root,loader:'jsx'}}));await wait(70);
  assert(h.body().includes('Mag gebeld worden · toestemming opgeslagen'),'A completed historical call does not remove current permission');assert.equal(h.window.qaChecks.length,0,'Permission never starts preflight automatically');h.click('Beltoestemming intrekken');await wait(50);assert.equal(h.requests.at(-1).body.profileId,'noor');assert.equal(h.requests.at(-1).body.enabled,false);assert(h.body().includes('Beltoestemming staat uit'));
  const select=h.document.querySelector('select');Object.defineProperty(select,'value',{value:'lio',writable:true,configurable:true});h.event(select,'change');await wait(30);assert(h.body().includes('Hallo Lio!'));const calling=h.document.querySelector('.calling'),checkboxes=[...calling.querySelectorAll('input[type=checkbox]')];for(const input of checkboxes.slice(0,2)){input.checked=true;h.event(input,'click');}await wait(30);h.click('Mag gebeld worden inschakelen');await wait(50);const enabled=h.requests.at(-1).body;assert.equal(enabled.profileId,'lio');assert.equal(enabled.enabled,true);assert.equal(enabled.parentConsent,true);assert.equal(enabled.micChecked,false,'Persistent consent and technical readiness are separate');assert.equal(h.window.qaChecks.length,0);
  h.click('Test microfoon & verbinding');await wait(30);assert.deepEqual(Array.from(h.window.qaChecks),['lio']);const headphone=h.document.querySelector('.calling .fam-invitation input[type=checkbox]');headphone.checked=true;h.event(headphone,'click');await wait(30);h.click('Geluidscontrole opslaan');await wait(50);assert.equal(h.requests.at(-1).body.profileId,'lio');assert.equal(h.requests.at(-1).body.micChecked,true);assert.equal(h.requests.at(-1).body.connectionChecked,true);assert.equal(h.requests.at(-1).body.headphones,true);assert.equal(game.production.participation.find(entry=>entry.profileId==='noor').callConsentEnabled,false,'Changing one child does not change a sibling');assert.deepEqual(h.errors,[]);h.window.qaClose();console.log('✓ Milo permission: persistent after done, per child, separate opt-in and explicit technical preflight; sibling stays withdrawn');
 }finally{h.close();}
}

await checkMiloPersistentCallPermission();await checkFamilyCompletion();await checkExplicitVlampieEntrance();await checkCallAvailability();await checkQrParser();await checkCallLifecycle();
