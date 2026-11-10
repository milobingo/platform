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


const h=harness(({url})=>{
 if(url==='/api/bingo/games')return Response.json({games:[]});
 if(url==='/api/characters')return Response.json({characters:Object.values(CHARACTERS),revision:0});
 if(url==='/api/openai/status')return Response.json({configured:false,revision:null,canManage:true});
 if(url==='/api/output')return Response.json({state:null,serverTime:Date.now()});
 return Response.json({});
});
try{
 const app=await bundle({entryPoints:[root+'/frontend/main.jsx'],plugins:[rendererPlugin]});h.run(app);await wait(900);
 assert(h.document.querySelector('.mf-broadcast-shell'));
 assert(h.document.querySelector('.mf-simple-preparation'));assert.equal(h.document.querySelectorAll('.mf-preparation-steps>button').length,3);assert.equal(h.document.querySelectorAll('.mf-standard-rounds>section').length,4);assert.equal(h.document.querySelectorAll('.mf-standard-rounds>section>ol>li').length,10);assert.equal(h.document.querySelector('.bs-show-hero'),null,'Milo opens its preparation route');
 assert.equal(h.document.querySelectorAll('.mf-sidebar .mf-nav-label').length,4);
 assert.equal(h.document.querySelectorAll('.mf-sidebar nav>a').length,13);
 await h.navigate('studio');
 assert(h.document.querySelector('.bs-camera-monitor .mf-stage-frame'));
 assert(h.document.querySelectorAll('.bs-shot-grid>button').length>=9);
 const findSelect=text=>[...h.document.querySelectorAll('label')].find(l=>l.textContent.includes(text))?.querySelector('select');
 const transition=findSelect('Overgang tussen shots');assert(transition);
 Object.defineProperty(transition,'value',{configurable:true,value:'cut'});h.event(transition,'change');await wait(30);
 const duration=findSelect('Duur van de beweging');assert(duration.disabled,'Direct cuts must disable camera duration');
 const refreshed=findSelect('Overgang tussen shots');Object.defineProperty(refreshed,'value',{configurable:true,value:'smooth'});h.event(refreshed,'change');await wait(30);
 assert(!findSelect('Duur van de beweging').disabled);
 assert.deepEqual(h.errors,[]);
 const legacy=harness(({url})=>{if(url==='/api/bingo/games')return Response.json({games:[]});if(url==='/api/characters')return Response.json({characters:Object.values(CHARACTERS),revision:0});if(url==='/api/openai/status')return Response.json({configured:false});return Response.json({});},'/','vlampie');
 try{legacy.run(app);await wait(600);assert(legacy.document.querySelector('.bs-show-hero .mf-stage-frame'),'Vlampie keeps its separate overview monitor');assert.equal(legacy.document.querySelectorAll('.bs-preflight>button').length,4,'Vlampie keeps its legacy preparation shortcuts');assert.equal(legacy.document.querySelector('.mf-simple-preparation'),null);assert(legacy.body().includes('VLAMPIES EIGEN STUDIO'));assert.deepEqual(legacy.errors,[]);}finally{legacy.close();}
 console.log('✓ Broadcast shell: overview, thirteen reachable routes including mail, four clear navigation groups, new studio monitor and actual cut/smooth camera controls');
}finally{h.close();}
