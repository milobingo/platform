// React integration checks in a lightweight DOM. The renderer boundary is mocked:
// these checks exercise state/events, not canvas appearance, real audio or providers.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {CHARACTERS} from '../server/characters.js';
import {makeGame} from '../server/bingo-model.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rendererPlugin={name:'navigation-renderer-boundary',setup(builder){
 builder.onResolve({filter:/mf-studio\.js$/},()=>({path:'milo-renderer',namespace:'navigation-qa'}));
 builder.onResolve({filter:/studio-25d\.js$/},()=>({path:'vlampie-renderer',namespace:'navigation-qa'}));
 builder.onLoad({filter:/.*/,namespace:'navigation-qa'},args=>({loader:'js',contents:args.path==='milo-renderer'?`
 export const CAMERA_PRESETS={wide:{label:'Totaal'}};export const MAGIC_MOMENTS=[];
 export function mountStudio(){return {update(){},destroy(){}};}`:`
 export const SHOTS=Object.fromEntries(['wide','establish','front','desk','portrait','machine','audience','led','tour'].map(id=>[id,{}]));
 export class VlampieStudio25D{async load(){}async setTheme(){}setCamera(){}render(){}dispose(){}}`}));
}};
async function bundle(options){return (await build({bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',loader:{'.css':'empty'},logLevel:'warning',...options})).outputFiles[0].text;}
function harness(fetcher=async()=>Response.json({}),pathname='/',production='milo'){
 const {window}=parseHTML('<!doctype html><html><body><div id="root"></div></body></html>'),{document}=window;
 const timers=new Set(),intervals=new Set(),errors=[],requests=[];
 const timeout=(fn,ms,...args)=>{const t=setTimeout(()=>{timers.delete(t);fn(...args);},ms);timers.add(t);return t;};
 const interval=(fn,ms)=>{const t=setInterval(fn,ms);intervals.add(t);return t;};
 const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
 const localStorage=storage(),sessionStorage=storage(),url=new URL(pathname,'https://bingo.example');localStorage.setItem('mf-production',production);
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
 const fetch=async(url,opts={})=>{const request={url:String(url),method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):null};requests.push(request);return fetcher(request);};
 const raf=fn=>timeout(()=>fn(performance.now()),16),matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
 let microphoneRequests=0;
 class Stream{constructor(tracks=[]){this.tracks=tracks;}getTracks(){return this.tracks;}}
 class Peer{
  constructor(){this.iceGatheringState='complete';}
  addTrack(){}async createOffer(){return {type:'offer',sdp:'v=0\r\nnavigation-offer'};}
  async setLocalDescription(value){this.localDescription=value;}
  createDataChannel(){return this.channel={readyState:'open',send(text){if(JSON.parse(text).type==='session.close')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'session.closed'})}));},close(){this.closed=true;}};}
  async setRemoteDescription(value){this.remoteDescription=value;this.connectionState='connected';this.channel.onmessage?.({data:JSON.stringify({type:'session.started'})});}
  close(){this.closed=true;}
 }
 class AudioStub{async play(){}pause(){}}
 const history={replaceState(state,title,value){if(value!==undefined)url.href=new URL(value,url).href;}};
 const navigator={userAgent:'dom-qa',clipboard:{writeText:async()=>{}},mediaDevices:{getUserMedia:async()=>{microphoneRequests++;return new Stream([{stop(){}}]);}}};
 const context={window,document,location,history,navigator,localStorage,sessionStorage,RTCPeerConnection:Peer,MediaStream:Stream,Audio:AudioStub,
  console:{...console,error:(...s)=>{errors.push(s.map(String).join(' '));console.error(...s);}},setTimeout:timeout,clearTimeout,setInterval:interval,clearInterval,requestAnimationFrame:raf,cancelAnimationFrame:clearTimeout,performance,crypto:globalThis.crypto,queueMicrotask,structuredClone,fetch,Headers,Response,Request,AbortController,AbortSignal,URL,URLSearchParams,TextEncoder,TextDecoder,Blob,atob,btoa,
  Image:ImageStub,ResizeObserver:Observer,IntersectionObserver:Observer,MutationObserver:window.MutationObserver,BroadcastChannel:Channel,SpeechSynthesisUtterance:class{constructor(t){this.text=t;}},speechSynthesis,Event:window.Event,CustomEvent:window.CustomEvent,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,SVGElement:window.SVGElement,Element:window.Element,Node:window.Node,NodeFilter:window.NodeFilter,getComputedStyle:computed,matchMedia,
  FormData:class{constructor(form){this.values=new Map([...form.querySelectorAll('input,select,textarea')].filter(e=>e.name).map(e=>[e.name,e.value??e.getAttribute('value')??'']));}get(k){return this.values.get(k)||null;}}};
 Object.assign(window,{location,history,localStorage,sessionStorage,matchMedia,getComputedStyle:computed,requestAnimationFrame:raf,cancelAnimationFrame:clearTimeout,Image:ImageStub,ResizeObserver:Observer,IntersectionObserver:Observer,BroadcastChannel:Channel,fetch,speechSynthesis});
 for(const name of ['addEventListener','removeEventListener','dispatchEvent'])context[name]=window[name].bind(window);
 context.globalThis=context;context.self=context;context.global=context;
 const rejection=e=>errors.push(String(e?.stack||e));process.on('unhandledRejection',rejection);
 const event=(el,type)=>{assert.ok(el,'Missing DOM control for '+type);el.dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true}));};
 const click=label=>{const buttons=[...document.querySelectorAll('button')],el=buttons.find(e=>e.textContent.trim()===label)||buttons.find(e=>e.textContent.includes(label));event(el,'click');return el;};
 const body=()=>document.body.textContent;
 return {window,document,context,requests,errors,event,click,body,run:js=>vm.runInNewContext(js,context,{filename:'ui-regression.js'}),
  async navigate(route){location.hash='/'+route;await wait(250);assert.ok(!body().includes('De studio kon niet starten.'),'Route crashed: '+route);},
  get microphoneRequests(){return microphoneRequests;},close(){window.qaUnmount?.();for(const t of timers)clearTimeout(t);for(const t of intervals)clearInterval(t);process.off('unhandledRejection',rejection);}};
}


// Exercise the actual App and StudioEngine. Only canvas rendering, browser media
// and HTTP providers are replaced; route parsing, clicks and profile calls are real.
const appBundle=await bundle({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import App from './frontend/App.jsx';const root=createRoot(document.getElementById('root'));window.qaUnmount=()=>flushSync(()=>root.unmount());flushSync(()=>root.render(React.createElement(App)));`,resolveDir:root,loader:'jsx'},plugins:[rendererPlugin]});
async function until(predicate,message){for(let i=0;i<160;i++){if(predicate())return;await wait(10);}assert.fail(message);}
async function setup({host='milo',hash='',saved=true}={}){
 const production=host==='vlampie'?'vlampie':'milo',game=makeGame({brandId:production,title:'Navigatieregressie',timeZone:'Europe/Amsterdam',date:'2026-11-01T14:00'},'qa-owner','https://bingo.example');game.plan.leadId=host;game.revision=1;
 let revision=0;let characters=Object.values(CHARACTERS).map(c=>({...c}));
 const h=harness(({url,method,body})=>{
  if(url==='/api/bingo/games')return Response.json({games:saved?[game]:[]});
  if(url==='/api/bingo/games/'+game.id)return Response.json({game});
  if(url==='/api/characters')return Response.json({characters,revision});
  if(url==='/api/openai/status')return Response.json({configured:true,revision:null,canManage:true});
  if(url.startsWith('/api/characters/')&&method==='PUT'){const id=url.split('/').at(-1);assert(CHARACTERS[id],'Invalid profile save: '+id);assert.equal(body.settings.id,id);characters=characters.map(c=>c.id===id?{...c,...body.settings}:c);return Response.json({characters,revision:++revision});}
  if(url==='/api/openai/design-voice'){assert(CHARACTERS[body.characterId],'Invalid design character');characters=characters.map(c=>c.id===body.characterId?{...c,customVoiceId:'voice_navigation_test'}:c);return Response.json({characters,revision:++revision});}
  if(url==='/api/openai/live-preview'){assert(CHARACTERS[body.characterId],'Invalid microphone character');assert.match(body.sdp,/^v=0/);return Response.json({realtimeId:'live_navigation_test',sdp:'v=0\r\nnavigation-answer'});}
  if(url==='/api/openai/live-preview-stop')return Response.json({closed:true});
  if(url==='/api/output')return Response.json({state:null,serverTime:Date.now()});
  if(url.startsWith('/api/live-calls'))return Response.json({call:null,drawHeld:false});
  return Response.json({error:{message:'No fixture for '+url}},{status:404});
 },'/'+hash,production);
 h.run(appBundle);await until(()=>h.body().includes('Show Studio'),'App did not mount');await wait(100);return h;
}
function profileRequests(h){return h.requests.filter(r=>r.url.startsWith('/api/characters/')||r.url==='/api/openai/design-voice'||r.url==='/api/openai/live-preview');}

await test('the overview presenter button opens the actual Milo, Stella and Vlampie profiles',async()=>{
 for(const host of ['milo','stella','vlampie']){
  const h=await setup({host,saved:host!=='milo'});try{
   await until(()=>h.document.querySelector('.bs-presenter-card h2')?.textContent===CHARACTERS[host].name,'Overview lost selected host '+host);
   h.click('Personage-instellingen');await until(()=>h.context.location.hash==='#/characters/'+host,'Overview generated an invalid profile route for '+host);
   await until(()=>h.document.querySelector('.cp-heading h1')?.textContent===CHARACTERS[host].name,'Wrong profile opened for '+host);
   assert.equal(h.context.location.hash.includes('undefined'),false);assert.deepEqual(h.errors,[]);
  }finally{h.close();}
 }
});
await test('a legacy undefined route restores Milo and sends the same canonical id to save, voice design and microphone',async()=>{
 const h=await setup({hash:'#/characters/undefined'});try{
  await until(()=>h.context.location.hash==='#/characters/milo','Legacy route was not canonicalized');
  await until(()=>h.body().includes('Heeee Danilo, Djayce en Bentley!'),'Legacy Milo lost the Milo-specific audition text');
  h.click('Personage opslaan');await until(()=>h.requests.some(r=>r.url==='/api/characters/milo'&&r.method==='PUT'),'Save did not use Milo id');await wait(35);
  h.click('Eigen GPT-Live-stem ontwerpen');await until(()=>h.requests.some(r=>r.url==='/api/openai/design-voice'),'Voice design was not requested');await wait(35);
  h.click('Start microfoontest');await until(()=>h.body().includes('GPT-Live verbonden'),'Microphone did not connect');
  assert.equal(h.requests.find(r=>r.url==='/api/openai/live-preview').body.characterId,'milo');assert.equal(h.requests.find(r=>r.url==='/api/openai/design-voice').body.characterId,'milo');assert.equal(h.microphoneRequests,1);
  h.click('Gesprek stoppen');await until(()=>h.requests.some(r=>r.url==='/api/openai/live-preview-stop'),'Stop did not run');
  assert(profileRequests(h).every(r=>!r.url.includes('undefined')&&!r.url.includes('null')));assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});
await test('legacy recovery waits for the loaded show and preserves Stella as presenter',async()=>{
 const h=await setup({host:'stella',hash:'#/characters/undefined'});try{
  await until(()=>h.context.location.hash==='#/characters/stella','Legacy recovery selected the startup fallback instead of the loaded host');
  await until(()=>h.document.querySelector('.cp-heading h1')?.textContent===CHARACTERS.stella.name,'Stella was not restored');assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});
await test('a malformed character route shows no editable Milo fallback and cannot request microphone access or profile writes',async()=>{
 const h=await setup({hash:'#/characters/not-a-character'});try{
  await until(()=>h.body().includes('Dit personage bestaat niet'),'Unknown route did not display an explicit missing-character state');
  assert.equal(h.document.querySelector('.cp-heading'),null);assert.equal([...h.document.querySelectorAll('button')].some(b=>b.textContent.includes('Start microfoontest')),false);assert.equal(profileRequests(h).length,0);assert.equal(h.microphoneRequests,0);assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});
