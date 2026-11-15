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

// This checks actual React controls against a deterministic local simulation.
// It does not certify real LiveKit, microphones, OBS, YouTube or OpenAI access.
const requests=[],listeners=new Set();
const queue=[{id:'entry-sophie',accountId:'parent-a',profileId:'child-sophie',name:'Sophie',familyName:'Gezin van ouder',child:true,callStatus:'accepted',micChecked:true,connectionChecked:true},{id:'entry-daan',accountId:'parent-a',profileId:'child-daan',name:'Daan',familyName:'Gezin van ouder',child:true,callStatus:'accepted',micChecked:true,connectionChecked:true}];
let state={call:null,queue,busy:false,error:'',mode:'demo',drawHeld:false,media:null,settings:{configured:false}};
const set=next=>{state={...state,...next};for(const fn of listeners)fn();};
const changeCall=fn=>{const next=structuredClone(state.call);fn(next);set({call:next,drawHeld:next.phase!=='completed'});};
let audioStarts=0,showOpens=0;
const runtime={startAudio:async()=>{audioStarts++;set({media:{...state.media,audioReady:true}});},openActiveShow:async()=>{showOpens++;},subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},getSnapshot:()=>state,loadSettings:async()=>state.settings,
 prepare:async(entryId,context,maxSeconds,characterId)=>{requests.push({action:'prepare',entryId,context,maxSeconds,characterId});const entry=queue.find(e=>e.id===entryId);set({call:{id:'call-'+entryId,entryId,name:entry.name,profileId:entry.profileId,characterId,phase:'preparing',context:{...context,confirmedFacts:entry.name==='Sophie'?[{confirmed:true,resultId:'server-result',type:'bingo',round:'Ronde 1',prize:'Een toverdoos'}]:[]},checks:{},media:{},checkpoint:{id:'check-1',drawnCount:3,lastNumber:42,drawn:[3,7,42]},returnState:{}},drawHeld:true});},
 connectPrivate:async()=>{requests.push({action:'connect-private'});changeCall(c=>{c.media.host={connected:true,micReady:true};});set({media:{connected:true,target:'backstage',micEnabled:true}});},
 privateMic:async enabled=>{requests.push({action:'private-mic',enabled});set({media:{...state.media,micEnabled:enabled}});},
 action:async(action,extra={})=>{requests.push({action,...extra});changeCall(c=>{
  if(action==='ring')c.phase='ringing';
  if(action==='simulate'&&extra.outcome==='answer'){c.phase='backstage';c.media.player={connected:true,micReady:true};}
  if(action==='context'){c.context={...extra.context,confirmedFacts:c.context.confirmedFacts};c.checks={};}
  if(action==='backstage-ready')c.checks={...c.checks,soundChecked:extra.soundChecked,explanationGiven:extra.explanationGiven};
  if(action==='stage')c.phase='staged';
  if(action==='go-live')c.phase='live';
  if(action==='mute')c.muted=extra.muted;
  if(action==='finish'){c.phase='returning';c.outcome='ended';}
  if(action==='simulate'&&extra.outcome==='returned')c.returnState.playerConfirmedAt=12345;
  if(action==='confirm-return'){c.phase='returned';c.returnState.hostConfirmedAt=12346;}
  if(action==='resume-draw')c.phase='completed';
  if(action==='simulate'&&['declined','missed','mic-denied','disconnected'].includes(extra.outcome)){c.phase='returning';c.outcome=extra.outcome;}
 });}
};
const game={id:'game-regie',brandId:'milo',plan:{leadId:'milo',blocks:[]},production:{calls:{enabled:true}},state:{drawn:[3,7,42]}};
state={...state,cues:[]};
runtime.schedule=async body=>{requests.push({action:'cue-schedule',...body});const entry=queue.find(item=>item.id===body.entryId);const cue={id:'manual-1',source:'manual',entryId:entry.id,name:entry.name,context:body.context,characterId:body.characterId,mode:body.mode,status:'pending'};set({cues:[cue]});return cue;};
runtime.inviteCue=async(cueId,body)=>{const cue=state.cues.find(item=>item.id===cueId);await runtime.prepare(cue.entryId,cue.context,45,body.characterId);changeCall(call=>{call.source='manual';call.cueId=cueId;call.mode='prepared';call.phase='ringing';});};
runtime.stop=async()=>runtime.action('finish');
const oldAction=runtime.action;runtime.action=async(name,body={})=>{if(name==='simulate'&&body.outcome==='agree-live'){changeCall(call=>{call.liveAgreement={agreedAt:1};});return;}if(name==='thank')name='finish';await oldAction(name,body);if(name==='finish')changeCall(call=>{call.resourcesClosed=true;});};
const oldPrivate=runtime.connectPrivate;runtime.connectPrivate=async()=>{await oldPrivate();changeCall(call=>{call.media.host.playerTrackReceived=true;});};
const h=harness(()=>Response.json({}));h.window.qaProps={s:{game,hostId:'milo',production:'milo',characters:Object.values(CHARACTERS),demo:true,apiStatus:{configured:false}},engine:{liveCalls:runtime},run:async fn=>fn()};
const toggle=async text=>{const label=[...h.document.querySelectorAll('label')].find(label=>label.textContent.includes(text));assert(label,'Checkbox '+text+' missing');const input=label.querySelector('input');input.checked=true;h.event(input,'click');await wait(25);};
try{
 h.run(await bundle({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import MiloCallCard from './frontend/MiloCallCard.jsx';const root=createRoot(document.getElementById('root'));flushSync(()=>root.render(React.createElement(MiloCallCard,window.qaProps)));window.qaRender=props=>flushSync(()=>root.render(React.createElement(MiloCallCard,props)));window.qaClose=()=>flushSync(()=>root.unmount());`,resolveDir:root,loader:'jsx'}}));await wait(80);
 assert(h.body().includes('SIMULATIE'));assert(h.document.querySelector('[aria-label="Belkaart"]'));h.click('Plan belmoment');await wait(30);assert.equal(state.cues[0].entryId,'entry-sophie');assert.equal(state.cues[0].context.callName,'Sophie');assert.equal(state.drawHeld,false,'Planning does not block a show');
 h.click('Bel het kindje');await wait(30);assert.equal(state.call.phase,'ringing');assert(state.drawHeld);assert(h.body().includes('Sophie'));h.click('Kindje neemt op');await wait(25);assert.equal(state.call.phase,'backstage');h.click('Verbinding met het gezin openen');await wait(25);assert(state.call.media.host.playerTrackReceived);assert(!h.body().includes('geluid verstaanbaar'),'The saved show preflight is not a second manual test');h.click('Klaar voor live');await wait(25);assert.equal(state.call.phase,'staged');
 let live=[...h.document.querySelectorAll('button')].find(button=>button.textContent==='Live met Milo');assert(live.disabled);h.click('Gezin stemt in met live');await wait(25);await toggle('De controlekaart klopt');h.click('Live met Milo');await wait(25);assert.equal(state.call.phase,'live');assert(requests.find(request=>request.action==='go-live').contextConfirmed);h.click('Kindje dempen');await wait(25);assert(state.call.muted);
 h.click('Bedank & sluit af');await wait(25);assert.equal(state.call.phase,'returning');assert(state.drawHeld);assert(!h.body().includes('herkenningszin'));assert(!h.document.querySelector('.mcc-return textarea'));assert(!h.document.querySelector('.mcc-return input'),'No YouTube return checklist');h.click('Gesprek veilig afsluiten');await wait(25);assert.equal(state.call.phase,'returned');assert(state.drawHeld);h.click('Hervat trekking');await wait(25);assert.equal(state.call.phase,'completed');assert.equal(state.drawHeld,false);
 set({mismatchedGame:true,call:{...state.call,phase:'returning',gameId:'other-show'}});await wait(25);assert(h.body().includes('belmoment open in een andere show'));h.click('Open die show');await wait(25);assert.equal(showOpens,1);h.window.qaClose();assert.deepEqual(h.errors,[]);console.log('✓ Milo Belkaart UI: planned child, deliberate invitation, passive track check, parent live agreement, explicit host live, mute, safe closure without YouTube checklist and other-show recovery');
}finally{h.close();}
