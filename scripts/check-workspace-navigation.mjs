// Semantic navigation regression: every existing workspace and nested worktab
// must remain reachable after a full shell/layout renewal. Lightweight DOM only;
// this test does not prove browser geometry or real provider connectivity.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {CHARACTERS} from '../server/characters.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Geometry and CSS correctness are covered by browser QA and the production build.
const styleBoundary={name:'navigation-css-boundary',setup(builder){builder.onResolve({filter:/\.css$/},args=>({path:args.path,namespace:'qa-style'}));builder.onLoad({filter:/.*/,namespace:'qa-style'},()=>({loader:'js',contents:''}));}};
async function bundle(options){return (await build({bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',loader:{'.css':'empty'},logLevel:'warning',plugins:[styleBoundary],...options})).outputFiles[0].text;}
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


const {defaultPresentation}=await import('../server/presentation-model.js');
const presentation=defaultPresentation();
const h=harness(({url})=>{
 if(url==='/api/bingo/games')return Response.json({games:[]});
 if(url==='/api/characters')return Response.json({characters:Object.values(CHARACTERS),revision:0});
 if(url==='/api/openai/status')return Response.json({configured:false,revision:null,canManage:true});
 if(url==='/api/output')return Response.json({state:null,serverTime:Date.now()});
 if(url==='/api/presentation/document')return Response.json({document:presentation,revision:0});
 if(url==='/api/bingo/families')return Response.json({families:[]});
 if(url==='/api/auth/session')return Response.json({configured:true,authenticated:true,role:'regie',localAvailable:false});
 if(url==='/api/livekit/settings')return Response.json({source:'environment',canManage:false,configured:false,url:'',apiKey:'',apiKeyConfigured:false,secretConfigured:false,revision:null,connectionTest:null});
 if(url.includes('/archive'))return Response.json({total:81,items:[]});
 return Response.json({});
});
const main=()=>h.document.querySelector('main#mf-main');
const expect=(selector,message)=>assert(main()?.querySelector(selector),message||'Missing '+selector);
const buttons=(selector='button')=>[...main().querySelectorAll(selector)];
const clickExact=async(label,scope=main())=>{const options=[...scope.querySelectorAll('button')],el=options.find(e=>e.textContent.trim()===label)||options.find(e=>e.textContent.trim().startsWith(label));assert(el,'Missing reachable control: '+label);h.event(el,'click');await wait(240);return el;};
const routeIds=['overview','shows','script','live','audience','studio','characters','library','books','orders','mail','people','settings'];
try{
 h.run(await bundle({entryPoints:[root+'/frontend/main.jsx']}));await wait(900);
 const beforeSkip=h.context.location.hash,skip=h.document.querySelector('a.mf-skip'),skipEvent=new h.window.Event('click',{bubbles:true,cancelable:true});assert(skip);skip.dispatchEvent(skipEvent);if(!skipEvent.defaultPrevented)h.context.location.hash=skip.getAttribute('href');await wait(240);assert.equal(h.context.location.hash,beforeSkip,'Skip-to-content must not replace the workspace hash route');assert.equal(h.document.activeElement,main(),'Skip-to-content must focus the main landmark');
 const nav=[...h.document.querySelectorAll('nav[aria-label="Hoofdnavigatie"]>a')];
 assert.equal(nav.length,13,'All thirteen workspaces including the mail studio must remain in the shell');
 assert.deepEqual(nav.map(a=>a.getAttribute('href').replace('#/','')).sort(),[...routeIds].sort());
 let pages=0,nested=0;
 for(const id of routeIds){
  await h.navigate(id);pages++;
  assert(main(),'Every route must keep the same main landmark: '+id);
  assert(main().textContent.trim().length>60,'Workspace has no usable content: '+id);
  assert.equal(h.document.querySelector('nav[aria-label="Hoofdnavigatie"] a[aria-current="page"]')?.getAttribute('href'),'#/'+id);
  assert(!h.body().includes('De studio kon niet starten.'),'Workspace crashed: '+id);
  if(id==='shows'){expect('input');assert(buttons().some(b=>b.textContent.includes('Nieuwe show')));}
  if(id==='script'){
   const labels=['Draaiboek','Cast & stemmen','Rondes & patronen','Prijzen','Startcheck'];
   for(const label of labels){const tab=buttons('[role=tab]').find(b=>b.textContent.trim()===label);assert(tab,'Missing script tab '+label);h.event(tab,'click');await wait(240);assert.equal(tab.getAttribute('aria-selected'),'true');nested++;
    if(label==='Draaiboek'){expect('input');assert(buttons().some(b=>b.textContent.includes('Repeteer dit moment')));}
    if(label==='Cast & stemmen')expect('select');
    if(label==='Rondes & patronen')expect('select[aria-label="Prijs bij dit patroon"]');
    if(label==='Prijzen')assert(buttons().some(b=>b.textContent.includes('Prijs toevoegen')));
    if(label==='Startcheck')assert(buttons().some(b=>/Start de (?:repetitie|show)/.test(b.textContent)));
   }
  }
  if(id==='live'){
   expect('[aria-label="Programmonitor"]');expect('[aria-label="Previewmonitor"]');expect('[aria-label="Showtransport"]');
   expect('[aria-label="Modulaire werkpanelen"]');
   const modules=buttons('[data-module-id]');assert.equal(modules.length,7,'All seven live modules must remain reachable');for(const control of modules){const moduleId=control.getAttribute('data-module-id');h.event(control,'click');await wait(60);assert(main().querySelector('[data-panel-id=\"'+moduleId+'\"]'),'Live module cannot be opened: '+moduleId);}
   assert(buttons().some(b=>b.textContent.includes('Volgende bal')));assert(buttons().some(b=>b.textContent.trim()==='TAKE'));
  }
  if(id==='audience'){
   const tabs=main().querySelector('nav[aria-label="Publiekswerkplek"]');assert(tabs);
   for(const label of ['Live chat','Kijkersvragen','Belregie']){await clickExact(label,tabs);nested++;assert(main().textContent.length>100);}
   expect('input'); // child/context selection and call preparation remain present
  }
  if(id==='studio'){expect('select');assert(buttons().length>=7,'Studio shot controls missing');}
  if(id==='characters'){const links=new Set([...main().querySelectorAll('a[href^="#/characters/"]')].map(a=>a.getAttribute('href')));for(const id of Object.keys(CHARACTERS).filter(id=>id!=='vlampie'))assert(links.has('#/characters/'+id),'Missing character settings link '+id);}
  if(id==='library'){
   const tabs=main().querySelector('nav[aria-label="Showbibliotheek"]');assert(tabs);
   for(const label of ['Beweging & magie','Scènes & momenten','Beslisspellen','Voorprogramma','Verhaallijnen','Geluid & stemmen','Prijzen & afsluiting']){
    await clickExact(label,tabs);nested++;assert(main().textContent.length>150,'Library worktab is empty: '+label);
    if(label==='Beweging & magie')expect('input[aria-label="Zoek een showmoment"]');
    if(label==='Scènes & momenten')assert(buttons().some(b=>b.textContent.includes('Zet deze scène live')));
    if(label==='Beslisspellen')expect('input[type=checkbox]');
    if(label==='Voorprogramma')expect('input[type=datetime-local]');
    if(label==='Verhaallijnen')assert(buttons().some(b=>b.textContent.includes('Eigen hoofdstuk')));
    if(label==='Geluid & stemmen')expect('input[type=range]');
    if(label==='Prijzen & afsluiting')assert(buttons().some(b=>b.textContent.includes('Show afsluiten')));
   }
  }
  if(id==='books'){expect('a[href*="example-color.pdf"]');assert(buttons().some(b=>b.textContent.includes('Boekjes genereren')));expect('table');}
  if(id==='orders')expect('input[aria-label="Bestellingen zoeken"]');
  if(id==='people'){
   const tabs=main().querySelector('[role=tablist][aria-label="Deelnemersadministratie"]');assert(tabs);
   for(const label of ['Boekjes & uitgifte','Gezinnen','Prijzen & verslag','Herstel']){await clickExact(label,tabs);nested++;assert(main().textContent.length>120);}
  }
  if(id==='settings'){
   for(const label of ['AI & stemmen','Deze show','E-mail & bellen','Profielen & spelregels','Herstel & controle']){await clickExact(label);nested++;assert(main().textContent.length>120);
    if(label==='AI & stemmen'){assert.equal(main().querySelectorAll('input[type=password]').length,1);assert.equal(main().querySelector('input[type=password]').value,'');assert(buttons().some(b=>b.textContent==='Test verbinding'));assert.equal(buttons('.mf-settings-cast>button').length,12);}
    if(label==='Deze show')expect('input[name=claim]');
    if(label==='E-mail & bellen'){expect('input[type=email]');assert.equal(main().querySelectorAll('input[type=password]').length,0);assert(main().textContent.includes('Aanmelden voor gezinnen'));}
    if(label==='Profielen & spelregels'){
     const subtabs=main().querySelector('[role=tablist][aria-label="Presentatie-instellingen"]');assert(subtabs);
     for(const item of ['Presentatieprofielen','Spelregels','Deze show']){await clickExact(item,subtabs);nested++;}
    }
   }
  }
 }
 await h.navigate('characters/milo');
 const castNav=main().querySelector('nav[aria-label="Personage-instellingen"],.cp-nav');assert(castNav);
 for(const label of ['Stem & uitspraak','Karakter & wereld','Trucjes & show','Gesprek met kinderen','Kennis & geheugen','Beweging']){await clickExact(label,castNav);nested++;assert(main().querySelector('input,select,textarea,summary'),'Missing editable character worktab '+label);}
 assert.deepEqual(h.errors,[],'Workspace navigation must not generate unhandled React/runtime errors');
 assert(!h.requests.some(r=>r.method!=='GET'),'Opening workspaces must not send state-changing or provider requests');
 console.log(`✓ Workspace navigation: ${pages} main routes, ${nested} nested worktabs, seven live modules and all twelve character settings links; no provider calls or writes`);
}finally{h.close();}
