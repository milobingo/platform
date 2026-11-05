// React integration checks in a lightweight DOM. The renderer boundary is mocked:
// these checks exercise state/events, not canvas appearance, real audio or providers.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {CHARACTERS} from '../server/characters.js';
import {makeGame} from '../server/bingo-model.js';

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
 const fetch=async(url,opts={})=>{const request={url:String(url),method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):null};requests.push(request);return fetcher(request);};
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

async function checkAdmin(){
 let saved=null;const characters=Object.values(CHARACTERS).map(c=>({...c}));
 const h=harness(({url,method,body})=>{
  if(url==='/api/bingo/games'&&method==='POST'){saved=makeGame(body,'qa-owner','https://bingo.example');return Response.json({game:saved});}
  if(url==='/api/bingo/games')return Response.json({games:saved?[saved]:[]});
  if(url==='/api/characters/milo'&&method==='PUT'){characters[0]={...characters[0],...body.settings};return Response.json({characters,revision:1});}
  if(url==='/api/characters')return Response.json({characters,revision:0});
  if(url==='/api/openai/status')return Response.json({configured:false,revision:null,canManage:true});
  if(saved&&url==='/api/bingo/games/'+saved.id)return Response.json({game:saved});
  if(url==='/api/output')return Response.json({state:null,serverTime:Date.now()});
  return Response.json({error:{message:'Unmocked UI route: '+url}},{status:404});
 });
 try{
  h.run(await bundle({entryPoints:[root+'/frontend/main.jsx']}));await wait(900);
  h.click('Nieuwe show');await wait(35);const form=h.document.querySelector('[role=dialog] form');assert.ok(form,'New-show modal form missing');
  form.querySelector('input[name=title]').value='Regressie familiepremière';h.event(form,'submit');await wait(420);
  const create=h.requests.find(r=>r.url==='/api/bingo/games'&&r.method==='POST');assert.equal(create?.body.title,'Regressie familiepremière');assert.equal(saved.title,'Regressie familiepremière');
  await h.navigate('characters/milo');const voice=[...h.document.querySelectorAll('label')].find(e=>e.textContent.includes('Stemidentiteit'))?.querySelector('select');assert.ok(voice);
  // linkedom does not infer an option value from its text like a browser does.
  [...voice.options].forEach(o=>o.selected=o.textContent==='cedar');Object.defineProperty(voice,'value',{configurable:true,value:'cedar'});h.event(voice,'change');await wait(25);h.click('Personage opslaan');await wait(100);
  const update=h.requests.find(r=>r.url==='/api/characters/milo'&&r.method==='PUT');assert.equal(update?.body.settings.voice,'cedar');assert.equal(update?.body.revision,0);assert.equal(characters[0].voice,'cedar');
  await h.navigate('script');h.click('Draaiboek');await wait(30);
  const cues=h.document.querySelectorAll('.mf-cue-list>button').length;assert.ok(cues>0,'Initial show cues missing');
  for(let i=0;i<cues;i++){h.click('Verwijderen');await wait(25);}await wait(40);
  assert.ok(h.body().includes('Een nieuw verhaal begint met één moment.'),'Deleting the last cue must render the empty timeline');
  assert.ok(!h.body().includes('De studio kon niet starten.'),'Deleting the last cue crashed the app');
  h.click('Voeg een showmoment toe');await wait(25);h.click('Magiemoment');await wait(60);assert.equal(h.document.querySelectorAll('.mf-cue-list>button').length,1,'Adding a cue after an empty timeline failed');
  await h.navigate('settings');const voices=[...h.document.querySelectorAll('.mf-settings-cast>button')];assert.equal(voices.length,12,'Milo settings contain only the twelve friends');assert(voices.every(b=>!b.textContent.includes('Vlampie')),'Vlampie has a separate production settings list');
  assert.deepEqual(h.errors,[]);console.log('✓ React admin: create show, character save, empty timeline recovery, twelve production-specific voice settings');
 }finally{h.close();}
}

async function checkVlampie(){
 const h=harness();
 try{
  h.run(await bundle({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {Stage} from './frontend/components.jsx';const root=createRoot(document.getElementById('root'));window.updateStage=s=>flushSync(()=>root.render(React.createElement(Stage,{state:s})));window.closeStage=()=>flushSync(()=>root.unmount());`,resolveDir:root,loader:'jsx'},plugins:[rendererPlugin]}));
  const initial={production:'vlampie',camera:'machine',motion:'point',theme:'sinterklaas',lastNumber:42,drawn:[3,42],speaking:true,mouth:.8,characterSettings:[{id:'milo',gestureEnergy:10},{id:'vlampie',gestureEnergy:84,idleMotion:false,lipSync:true}],pattern:{title:'Volle kaart',cells:[0,1,2]},show:{brandId:'vlampie',scene:'checking',sceneRevision:19,title:'Vlampies jubileum',round:'Feestronde',age:2.1,number:42,claim:{name:'Noor',card:'B12',status:'checking'},prize:'Een knuffel',transition:'slide',transitionMs:900,gameStage:{kind:'memory'},rules:['We spelen samen'],patternFreeCenter:false,patternVariant:'rotate',audience:true}};
  h.window.updateStage(initial);await wait(65);const renderer=h.window.qaRenderer;assert.ok(renderer.frames.length,'Stage never called the legacy renderer');const latest=()=>renderer.frames.at(-1).state;
  for(const key of ['scene','sceneRevision','title','round','age','number','prize','transition','transitionMs','patternFreeCenter','patternVariant','audience'])assert.equal(latest().show[key],initial.show[key],key+' was lost by adapter');
  assert.equal(latest().show.claim.name,'Noor');assert.equal(latest().show.gameStage.kind,'memory');assert.equal(latest().show.pattern,'Volle kaart');assert.equal(latest().show.patternCells.length,3);assert.equal(latest().bingoNumber,42);assert.equal(latest().bingoDrawn.length,2);assert.equal(latest().energy,84);assert.equal(latest().idle,false);assert.equal(latest().mouth.open,.8);assert.ok(renderer.themes.includes('sinterklaas'));
  for(const [camera,expected] of [['desk','desk'],['entrance','audience'],['machine','machine'],['led','led'],['front','front'],['establish','establish'],['tour','tour'],['audience','audience'],['host','desk'],['board','led'],['close','portrait'],['dolly','tour'],['orbit','tour'],['crane','establish']]){h.window.updateStage({...initial,camera});await wait(22);assert.equal(renderer.cameras.at(-1).id,expected,camera);}
  h.window.updateStage({...initial,scene:'draw',show:{...initial.show,scene:'draw',sceneRevision:20,age:1.75,number:null},characterSettings:{id:'vlampie',gestureEnergy:30,lipSync:false,idleMotion:true}});await wait(25);assert.equal(latest().show.sceneRevision,20);assert.equal(latest().show.number,null);assert.equal(latest().bingoPending,true);assert.equal(latest().bingoElapsed,1.75);assert.equal(latest().mouth.open,0);assert.equal(latest().energy,30);
  h.window.updateStage({...initial,paused:true,show:{...initial.show,reducedMotion:true},mouth:{open:.9,round:.2}});await wait(25);assert.equal(latest().stopped,true);assert.equal(latest().show.paused,true);assert.equal(latest().speaking,false);assert.equal(latest().mouth.open,0);assert.equal(latest().lightShow,false);assert.equal(renderer.cameras.at(-1).animate,false);
  h.window.closeStage();await wait(25);assert.equal(renderer.disposed,true);assert.equal(h.document.querySelector('canvas'),null);assert.deepEqual(h.errors,[]);
  console.log('✓ Vlampie adapter: director visuals, claims, patterns, 14 cameras, mouth, pause and cleanup');
 }finally{h.close();}
}
await checkAdmin();await checkVlampie();
