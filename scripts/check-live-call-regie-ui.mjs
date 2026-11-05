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
const game={id:'game-regie',plan:{leadId:'milo'},production:{calls:{enabled:true}},state:{drawn:[3,7,42]}};
const h=harness(()=>Response.json({}));h.window.qaProps={s:{game,hostId:'milo',production:'milo',characters:Object.values(CHARACTERS),demo:true,apiStatus:{configured:false}},engine:{liveCalls:runtime},run:async fn=>fn()};
const toggle=async text=>{const label=[...h.document.querySelectorAll('label')].find(l=>l.textContent.includes(text));assert(label,'Checkbox '+text+' missing');const input=label.querySelector('input');input.checked=true;h.event(input,'click');await wait(25);};
try{
 h.run(await bundle({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import LiveCallDesk from './frontend/LiveCallDesk.jsx';const root=createRoot(document.getElementById('root'));flushSync(()=>root.render(React.createElement(LiveCallDesk,window.qaProps)));window.qaRender=props=>flushSync(()=>root.render(React.createElement(LiveCallDesk,props)));window.qaClose=()=>flushSync(()=>root.unmount());`,resolveDir:root,loader:'jsx'}}));await wait(100);
 assert(h.body().includes('SIMULATIE'));assert(h.body().includes('Een demo bewijst geen geslaagde koppeling'));assert.equal(h.document.querySelectorAll('.lcd-family').length,1);assert.equal(h.document.querySelectorAll('.lcd-child').length,2);
 h.click('Belmoment voorbereiden');await wait(35);assert.equal(requests[0].entryId,'entry-sophie');assert.equal(requests[0].context.callName,'Sophie');assert.equal(requests[0].characterId,'milo');assert(state.drawHeld);assert(h.body().includes('Laatste nummer vóór het belmoment: 42'));assert(h.body().includes('Bingo bevestigd · Ronde 1 · Prijs: Een toverdoos'));assert(!h.body().includes('server-result'));
 h.click('Bellen');await wait(25);assert.equal(state.call.phase,'ringing');h.click('Deelnemer neemt op');await wait(25);assert.equal(state.call.phase,'backstage');assert(!h.body().includes('Live in de uitzending'));
 h.click('Achter de schermen spreken');await wait(25);assert(connected());
 await toggle('Ik heb het kindje gehoord');await toggle('Ik heb uitgelegd');h.click('Geluidscheck bevestigen');await wait(25);assert(state.call.checks.soundChecked);
 h.click('Klaarzetten voor Milo');await wait(25);assert.equal(state.call.phase,'staged');let live=[...h.document.querySelectorAll('button')].find(b=>b.textContent==='Live met Milo');assert(live.disabled,'Controlled context must be confirmed before live');await toggle('De roepnaam, uitspraakhulp');h.click('Live met Milo');await wait(25);assert.equal(state.call.phase,'live');assert(requests.find(r=>r.action==='go-live').contextConfirmed);
 h.click('Demp deelnemer');await wait(25);assert.equal(state.call.muted,true);h.click('Gesprek beëindigen');await wait(25);assert.equal(state.call.phase,'returning');assert(state.drawHeld,'Finish must not release the draw hold');
 h.click('YouTube werkt weer');await wait(25);assert(state.call.returnState.playerConfirmedAt);await toggle('Ik heb gecontroleerd dat dit gezin');h.click('Terugkeer naar de uitzending bevestigen');await wait(25);assert.equal(state.call.phase,'returned');assert(state.drawHeld,'Return confirmation is separate from drawing resume');h.click('Nummertrekking hervatten');await wait(25);assert.equal(state.call.phase,'completed');assert(!state.drawHeld);
 h.click('Daan');await wait(25);const readOnly=h.document.querySelector('.lcd-form-grid input');assert.equal(readOnly.value,'Daan');assert(!h.document.querySelector('.lcd-facts').textContent.includes('Een toverdoos'),'A new guest must never inherit the previous guest facts');h.click('Belmoment voorbereiden');await wait(25);assert.equal(requests.filter(r=>r.action==='prepare').at(-1).context.callName,'Daan');
 h.click('Verbindingsverlies');await wait(25);assert.equal(state.call.phase,'returning');assert(state.drawHeld);await toggle('Ik controleer de terugkeer handmatig');await wait(20);assert(h.body().includes('Hoe heb je de terugkeer gecontroleerd?'));
 // A live transition itself is not proof that any media or presenter is ready.
 const realProps={...h.window.qaProps,s:{...h.window.qaProps.s,demo:false,apiStatus:{configured:true}}};set({mode:'real',call:{...state.call,gameId:game.id,phase:'live',realtimeStatus:'starting',media:{player:{connected:false},output:{connected:false,audioReady:false}}},media:{connected:true,target:'live',audioReady:false}});h.window.qaRender(realProps);await wait(40);assert(h.body().includes('GELUID VERBINDEN'));assert(!h.body().includes('Rechtstreeks verbonden'));h.click('Gespreksgeluid activeren');await wait(25);assert.equal(audioStarts,1);set({call:{...state.call,realtimeStatus:'ready',media:{player:{connected:true},output:{connected:true,audioReady:true}}}});await wait(25);assert(h.body().includes('LIVE GESPREK'));assert(h.body().includes('Controleer in je koptelefoon'));
 // An active call from another show must not reveal the wrong production's
 // guest/presenter controls or offer to prepare another call.
 set({mismatchedGame:true,call:{...state.call,gameId:'other-show'}});await wait(25);assert(h.body().includes('Er staat nog een belmoment open in een andere show.'));assert(!h.document.querySelector('.lcd-guest-card'));assert(!h.document.querySelector('.lcd-queue'));h.click('Open de show met het belmoment');await wait(25);assert.equal(showOpens,1);
 h.window.qaClose();assert.deepEqual(h.errors,[]);console.log('✓ Regie UI: selected child, nine deliberate steps, private checks/context confirmation, demo labels, failure hold, fresh context, real audio readiness/autoplay and other-show recovery');
}finally{h.close();}
function connected(){return state.call.media.host?.connected&&state.call.media.player?.connected;}
