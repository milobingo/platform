// React integration checks in a lightweight DOM. The renderer boundary is mocked:
// these checks exercise state/events, not canvas appearance, real audio or providers.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
 // Advertise native input events so React uses its modern change-event path.
 document.oninput=null;
 const inputType=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'type');
 Object.defineProperty(window.HTMLInputElement.prototype,'type',{...inputType,get(){return inputType.get.call(this)||'text';}});
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
 const speechSynthesis={pause(){},resume(){},cancel(){},getVoices(){return []},speak(u){this.lastUtterance=u;u.onstart?.();timeout(()=>u.onend?.(),20);}};
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
 h.run(await bundle({entryPoints:[root+'/frontend/main.jsx'],plugins:[{name:'qa-engine-access',setup(b){b.onLoad({filter:/frontend\/App\.jsx$/},({path})=>({loader:'jsx',contents:readFileSync(path,'utf8').replace('const engine=new StudioEngine();','const engine=new StudioEngine();window.qaEngine=engine;')}));}}]}));await wait(1000);
 await h.navigate('live');const engine=h.window.qaEngine;assert.ok(engine.workspaceEnabled);
 assert.equal(h.document.querySelectorAll('.rd-program .mf-stage-frame').length,1);assert.equal(h.document.querySelectorAll('.rd-preview .mf-stage-frame').length,1);
 assert.equal(h.document.querySelectorAll('.rd-monitor-wall>.rd-program').length,1);assert.equal(h.document.querySelectorAll('.rd-monitor-wall>.rd-preview').length,1);
 assert(h.document.querySelector('.rd-monitor-wall .rd-quick-host'),'Direct presenter controls must share the compact monitor row');
 assert(h.document.querySelector('.rd-transport'),'The fixed show transport must remain outside the replaceable panels');
 assert(h.document.querySelector('select[aria-label="Mobiel werkpaneel"]'),'Every dock remains selectable in the narrow viewport');
 assert(h.document.querySelector('button[aria-label="Camera’s en scènes openen"]'),'Camera module is directly reachable next to TAKE');
 assert(h.document.querySelector('[data-panel-id="rundown"] .rd-rundown'));assert(h.document.querySelector('[data-panel-id="cameras"] .rd-camera-bank'));assert(h.document.querySelector('[data-panel-id="bingo"] .rd-last-number'));
 const openModule=async id=>{const button=h.document.querySelector(`button[data-module-id="${id}"]`);assert(button,'Missing module selector: '+id);h.event(button,'click');await wait(30);assert(h.document.querySelector(`.rd-panel-slot [data-panel-id="${id}"]`),'Module did not open in the visible dock: '+id);};
 const quickButton=label=>{const button=[...h.document.querySelectorAll('.rd-quick-host button')].find(b=>b.getAttribute('aria-label')===label||b.textContent.trim()===label);assert(button,'Missing fixed presenter action: '+label);return button;};
 assert(h.document.querySelector('.rd-quick-host textarea[aria-label="Directe presentatortekst"]'));
 for(const label of ['Laat spreken','Stop stem','Zwaaien','Aanwijzen','Juichen','Applaudisseren'])quickButton(label);
 assert.equal(h.document.querySelectorAll('.rd-quick-host .rd-quick-magic button').length,2,'Milo must have both magic actions available without opening a module');
 engine.voiceText='Hoi allemaal, welkom bij Milo en zijn vrienden!';engine.voiceMode='browser';engine.emit();await wait(20);
 h.event(quickButton('Laat spreken'),'click');assert.equal(h.window.speechSynthesis.lastUtterance.text,engine.voiceText);assert.equal(engine.voicePhase,'playing');h.event(quickButton('Stop stem'),'click');assert.equal(engine.voicePhase,'idle');assert.equal(engine.currentSpeech,null);await wait(25);
 h.event(quickButton('Zwaaien'),'click');await wait(20);assert.equal(engine.stage().movement?.id,'wave','Fixed gesture buttons must control the real show runtime');assert.equal(h.document.querySelector('.rd-transport .rd-next-ball').disabled,true,'A manual gesture must hold the fixed draw control');h.event(quickButton('Stop moment'),'click');await wait(20);assert.equal(engine.stage().movement,null);
 const changeSelect=(label,value)=>{const el=h.document.querySelector(`select[aria-label="${label}"]`);assert(el);Object.defineProperty(el,'value',{value,writable:true,configurable:true});h.event(el,'change');};
 changeSelect('Camera-overgang','cut');await wait(20);assert.equal(engine.cameraTransition,'cut');changeSelect('Duur camerabeweging','2200');await wait(20);assert.equal(engine.cameraDuration,2200);changeSelect('Camera-overgang','smooth');changeSelect('Duur camerabeweging','1400');

 engine.game.state.drawHold={id:'qa-held-call'};engine.emit();await wait(25);assert(h.document.querySelector('.rd-alert-strip.hold'));const drawButtons=[...h.document.querySelectorAll('.rd-next-ball')];assert.equal(drawButtons.length,1,'Only the fixed transport draws a ball; the control module does not duplicate it');assert(drawButtons.every(b=>b.disabled),'The fixed draw control must obey the server hold');await assert.rejects(()=>engine.draw(),/geblokkeerd/);assert.equal(engine.game.state.drawHold.id,'qa-held-call','A rejected draw must not clear the call hold');engine.game.state.drawHold=null;engine.emit();await wait(25);
 const claimWindow={id:'qa-open-window',status:'open',endsAt:Date.now()+60000,claims:[]};engine.game.state.window=claimWindow;engine.emit();await wait(25);assert(h.document.querySelector('[data-panel-id="bingo"] .rd-bingo-grid').firstElementChild.classList.contains('rd-claims'),'An active reporting window must put review before number history');assert.equal(h.document.querySelector('.rd-transport .rd-next-ball').disabled,true);assert.equal(h.document.querySelector('.rd-transport-primary button').disabled,true);await assert.rejects(()=>engine.draw(),/meldvenster/);assert.equal(engine.game.state.window,claimWindow,'The UI must not close an existing bingo reporting window');engine.game.state.window=null;engine.emit();await wait(25);assert(h.document.querySelector('[data-panel-id="bingo"] .rd-bingo-grid').firstElementChild.classList.contains('rd-bingo'),'Normal round control returns after the window clears');engine.game.state.resultId='qa-review-priority';engine.emit();await wait(25);assert(h.document.querySelector('[data-panel-id="bingo"] .rd-bingo-grid').firstElementChild.classList.contains('rd-claims'),'A pending server result must put review first too');engine.game.state.resultId=null;engine.emit();await wait(25);
 const drawn=JSON.stringify(engine.game.state.drawn),before=engine.stage().scene;h.click('Spelregels');await wait(30);assert.equal(engine.previewStage().scene,'rules');assert.equal(engine.stage().scene,before,'Preview selection went on air');
 h.click('TAKE');await wait(50);assert.equal(engine.stage().scene,'rules');assert.equal(engine.camera,engine.previewCamera,'Taken scene/camera must match preview');
 assert.equal(h.document.querySelector('.rd-next-ball').disabled,true);const next=[...h.document.querySelectorAll('.rd-transport button')].find(x=>x.textContent.includes('draaiboek')||x.textContent.includes('Volgende cue'));assert.equal(next.disabled,true);
 h.click('Pauzeren');await wait(25);assert.equal(engine.showRuntime.manual.paused,true);h.click('Hervatten');await wait(25);assert.equal(engine.showRuntime.manual.paused,false);
 h.click('Terug naar show');await wait(30);assert.equal(engine.showRuntime.manual,null);assert.equal(JSON.stringify(engine.game.state.drawn),drawn);
 h.click('Presentator');await wait(20);h.click('Presentator close-up');await wait(20);h.click('TAKE');await wait(40);assert.equal(engine.camera,'portrait');assert.equal(engine.showRuntime.manual,null);assert.notEqual(engine.stage().scene,'rules');
 await openModule('audience');assert(h.document.querySelector('.aw-dock'));const audienceRuntime=engine.calls,callRuntime=engine.liveCalls,chat=engine.calls.chat,chatSurface=engine.calls.chatSurface,chatHost=h.document.querySelector('.aw-chat>div');assert(chatHost.shadowRoot?.querySelector('.lc-header')?.textContent.includes('Live chat'),'Host chat did not mount inside its style boundary');h.click('Bellen');await wait(35);assert(h.body().includes('Belregie'));
 const callName=h.document.querySelector('.lcd-root input[placeholder="Bijvoorbeeld Sophie"]');assert(callName,'The call control card must expose the child call name');Object.getOwnPropertyDescriptor(h.window.HTMLInputElement.prototype,'value').set.call(callName,'Sofie uit de controlekaart');h.event(callName,'input');await wait(25);engine.emit();await wait(25);assert.equal(callName.value,'Sofie uit de controlekaart','The typed call name must enter the controlled form state');
 await openModule('presentation');assert.equal(engine.calls,audienceRuntime,'Changing work panels must not recreate the audience runtime');assert.equal(engine.liveCalls,callRuntime,'Changing work panels must not recreate the live-call runtime');assert.equal(engine.calls.chat,chat,'Changing work panels must not recreate the chat controller');assert.equal(engine.calls.chatSurface,chatSurface,'Changing work panels must preserve the existing chat surface');assert(h.document.querySelector('.rd-panel-parking [data-panel-id="audience"]'),'Previously opened modules must be parked instead of unmounted');
 await openModule('audience');assert(h.document.querySelector('.aw-dock-tabs button[aria-selected="true"]').textContent.startsWith('Bellen'),'The chosen audience tab must survive a work-panel switch');assert.equal(h.document.querySelector('.lcd-root input[placeholder="Bijvoorbeeld Sophie"]'),callName,'The call form must keep the same mounted input');assert.equal(callName.value,'Sofie uit de controlekaart','Unsaved child-name corrections must survive module switches');h.click('Chat');await wait(35);assert.equal(h.document.querySelector('.aw-chat>div').shadowRoot?.contains(chatSurface),true,'The existing chat surface must return to the visible audience panel');
 assert.equal(JSON.stringify(engine.game.state.drawn),drawn,'Changing modules must not draw a number');assert.deepEqual(h.errors,[]);engine.dispose();console.log('✓ Integrated actual engine + modular regie: compact monitor/control structure, independent preview, scene/camera TAKE, hold guards, pause/resume, return, persistent audience/chat/call runtimes; drawn state unchanged');
}finally{h.close();}
