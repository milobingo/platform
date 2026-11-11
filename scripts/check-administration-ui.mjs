// React integration checks in a lightweight DOM. The renderer boundary is mocked:
// these checks exercise state/events, not canvas appearance, real audio or providers.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {CHARACTERS} from '../server/characters.js';
import {makeGame,generateBooks} from '../server/bingo-model.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rendererPlugin={name:'vlampie-renderer-boundary',setup(builder){
 builder.onResolve({filter:/studio-25d\.js$/},()=>({path:'original-renderer',namespace:'qa'}));
 builder.onLoad({filter:/.*/,namespace:'qa'},()=>({loader:'js',contents:`
 export const SHOTS=Object.fromEntries(['wide','establish','front','desk','portrait','machine','audience','led','tour'].map(id=>[id,{}]));
 export class VlampieStudio25D{
  constructor(){this.frames=[];this.cameras=[];this.themes=[];window.qaRenderer=this;}
  async load(){} async setTheme(id){this.themes.push(id);}
  setCamera(id,animate){this.cameras.push({id,animate});}
  render(dt,state){this.frames.push({dt,state});}dispose(){this.disposed=true;}
 }`}));
}};
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

const {defaultPresentation,normalizePresentation}=await import('../server/presentation-model.js');
const {productionSettings}=await import('../server/production-model.js');
const g=makeGame({brandId:'milo',title:'Administratie QA',timeZone:'Europe/Amsterdam',date:'2026-11-01T14:00'},'qa-owner','https://bingo.example');generateBooks(g,2,'admin-qa');
Object.assign(g.books[0],{accountId:'family-a',profileId:'person-a',name:'Noor',admitted:true});
const family={accountId:'family-a',ownerName:'Ouder',email:'ouder@example.test',profiles:[{id:'person-a',name:'Noor',age:8},{id:'person-b',name:'Sam',age:9}],falseCounts:{[g.id]:2},cooldowns:{},blockedGames:{}};
let savedPresentation=defaultPresentation(),presentationRevision=0,rejectPresentationOnce=true,posts=[],notices=[];
const h=harness(({url,method,body})=>{
 if(url==='/api/bingo/families')return Response.json({families:[family]});
 if(url==='/api/auth/session')return Response.json({configured:true,authenticated:true,role:'regie',localAvailable:false});
 if(url==='/api/resend/settings')return Response.json({configured:false,keyConfigured:false,canManage:false,source:'none',revision:null,from:'',replyTo:'',deliveryEnabled:false,connectionTest:{tested:false,testedAt:null}});
 if(url==='/api/livekit/settings')return Response.json({source:'environment',canManage:false,configured:true,url:'wss://test-project.livekit.cloud',apiKey:'',apiKeyConfigured:true,secretConfigured:true,revision:method==='POST'?'livekit-v2':'livekit-v1',connectionTest:method==='POST'?{tested:true,testedAt:Date.now()}:null,...(method==='POST'?{tested:true}:{})});
 if(url==='/api/presentation/document'&&method==='PUT'){if(rejectPresentationOnce){rejectPresentationOnce=false;return Response.json({error:{message:'De instellingen zijn intussen gewijzigd.'}},{status:409});}assert.equal(body.revision,presentationRevision);savedPresentation=normalizePresentation(body.document);presentationRevision++;return Response.json({document:savedPresentation,revision:presentationRevision});}
 if(url==='/api/presentation/document')return Response.json({document:savedPresentation,revision:presentationRevision});
 if(url==='/api/bingo/games/'+g.id&&method==='PUT'){g.presentationSelection=body.presentationSelection;return Response.json({game:g});}
 return Response.json({error:{message:'Unmocked '+url}},{status:404});
});
const engine={game:g,demo:false,dirty:false,notify(){},fail(m){notices.push(m)},syncGame(){},emit(){},acceptGame(v){this.game=v;},post:async(action,body)=>{posts.push({action,body});if(action==='book-state'){const b=g.books.find(b=>b.id===body.bookId);if(body.operation==='issue')b.issueStatus=body.issueStatus;if(body.operation==='assign'){b.profileId=body.profileId;b.accountId=body.accountId;b.name=family.profiles.find(p=>p.id===body.profileId).name;}if(body.operation==='revoke'){b.revokedAt=Date.now();b.revokedReason=body.reason;b.admitted=false;}}return {game:g};}};
try{
 h.window.qaProps={s:{game:g,demo:false,production:'milo'},engine,run:async fn=>fn(),onInvite:()=>{}};
 h.run(await bundle({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PeopleAdministration,ConnectionSettings,PresentationSettings,RecoveryPanel} from './frontend/Administration.jsx';const root=createRoot(document.getElementById('root'));const pages={people:PeopleAdministration,connections:ConnectionSettings,presentation:PresentationSettings,recovery:RecoveryPanel};window.drawPage=id=>flushSync(()=>root.render(React.createElement(pages[id],window.qaProps)));window.closePage=()=>flushSync(()=>root.unmount());`,resolveDir:root,loader:'jsx'}}));
 h.window.drawPage('people');await wait(100);assert(h.body().includes('Noor'));const first=h.document.querySelector('.adm-book-fields select');Object.defineProperty(first,'value',{configurable:true,value:'sold'});h.event(first,'change');await wait(50);assert.equal(posts.at(-1).action,'book-state');assert.equal(posts.at(-1).body.issueStatus,'sold');assert.equal(posts.at(-1).body.bookId,g.books[0].id);
 h.click('Persoon corrigeren');await wait(30);const assignment=h.document.querySelector('[role=dialog] form');const person=assignment.querySelector('select');Object.defineProperty(person,'value',{configurable:true,value:'1'});h.event(assignment,'submit');await wait(60);assert.equal(posts.at(-1).body.operation,'assign');assert.equal(posts.at(-1).body.profileId,'person-b');assert.equal(posts.at(-1).body.accountId,'family-a');
 h.click('Gezinnen');await wait(30);assert(h.body().includes('ouder@example.test'));h.click('Toegang herstellen');await wait(30);const modal=h.document.querySelector('[role=dialog]');h.event([...modal.querySelectorAll('button')].find(b=>b.textContent==='Toegang herstellen'),'click');await wait(40);assert.equal(posts.at(-1).action,'unblock');assert.equal(posts.at(-1).body.accountId,'family-a');
 h.window.drawPage('connections');await wait(100);assert(h.body().includes('Aanmelden voor gezinnen'));assert(h.body().includes('Aanmelding gekoppeld'));assert(h.body().includes('Resend e-mailkoppeling'));assert(h.requests.some(r=>r.url==='/api/resend/settings'&&r.method==='GET'));assert(h.requests.some(r=>r.url==='/api/auth/session'&&r.method==='GET'));assert.equal(h.document.querySelectorAll('input[type=password]').length,0);assert(!h.requests.some(r=>r.url==='/api/player/mail-settings'));assert(!h.requests.some(r=>r.url==='/api/player/request-code'));
 h.event([...h.document.querySelectorAll('button')].find(b=>b.textContent==='Test opgeslagen koppeling'),'click');await wait(60);const livekit=h.requests.find(r=>r.url==='/api/livekit/settings'&&r.method==='POST');assert.deepEqual(livekit.body,{action:'test',revision:'livekit-v1'});assert.equal(livekit.headers['X-Vlampie-Call'],'1');assert(h.body().includes('Serververbinding getest'));assert(!h.requests.some(r=>r.url==='/api/calls/settings'));
 h.event([...h.document.querySelectorAll('button')].find(b=>b.textContent==='Belvoorbereiding opslaan').closest('form'),'submit');await wait(50);assert.equal(posts.at(-1).action,'production');assert.equal(posts.at(-1).body.production.calls.enabled,false);assert.equal(posts.at(-1).body.revision,0);
 h.window.drawPage('presentation');await wait(100);assert(!h.body().includes('Vlampie Grand Show'));assert(h.body().includes('Nog geen profiel voor deze productie'));h.click('Profiel toevoegen');await wait(30);assert(h.body().includes('Milo & Friends · nieuwe show'));h.click('Profielen & regels opslaan');await wait(60);assert(h.body().includes('De instellingen zijn intussen gewijzigd.'));assert(h.body().includes('Milo & Friends · nieuwe show'));assert.equal(savedPresentation.profiles.length,2);assert.equal(presentationRevision,0);h.click('Profielen & regels opslaan');await wait(60);assert.equal(savedPresentation.profiles.length,3);const newProfile=savedPresentation.profiles.at(-1);assert.equal(newProfile.brandId,'milo');assert.equal(presentationRevision,1);
 h.click('Deze show');await wait(30);const selection=h.document.querySelector('.adm-form select');Object.defineProperty(selection,'value',{configurable:true,value:newProfile.id});h.event(selection,'change');await wait(20);h.click('Gebruik in deze show');await wait(50);const chosen=h.requests.find(r=>r.url==='/api/bingo/games/'+g.id&&r.method==='PUT');assert.equal(chosen.body.presentationSelection.profileId,newProfile.id);assert.equal(chosen.body.presentationSelection.ruleIds.length,8);assert.equal(chosen.headers['X-Vlampie-Bingo'],'1');const profileWrite=h.requests.find(r=>r.url==='/api/presentation/document'&&r.method==='PUT');assert.equal(profileWrite.headers['X-Vlampie-Presentation'],'1');
 g.status='running';engine.stop=async()=>{posts.push({action:'stop'});return true};engine.runner={stop(){posts.push({action:'runner-stop'})}};engine.director={cancel(){posts.push({action:'cancel'})},externalHold:false};engine.stopSpeech=()=>{};engine.start=async()=>posts.push({action:'start'});h.window.drawPage('recovery');await wait(30);h.click('Controleer & hervat');await wait(20);h.click('Spelstand bevestigen & hervatten');await wait(60);const recoverIndex=posts.findIndex(p=>p.action==='recovery');assert(recoverIndex>0);assert.equal(posts[recoverIndex].body.expectedEpoch,g.state.epoch);assert.equal(posts[recoverIndex].body.expectedDrawn,g.state.drawn.length);assert.equal(posts[recoverIndex-1].action,'stop');assert.equal(posts.at(-1).action,'start');assert.equal(h.context.location.hash,'#/live');
 h.window.closePage();await wait(15);assert.deepEqual(h.errors,[]);console.log('✓ Native React administration: issue/assign/unblock, Supabase Auth status + environment-managed LiveKit test without secret fields, call preparation, presentation CAS conflict-preservation + show selection, safe recovery');
}finally{h.close();}
