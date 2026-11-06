// Actual React component + shared Modal in a lightweight DOM. This checks
// controls and status truthfulness; it does not certify providers or audio.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';

const root=fileURLToPath(new URL('..',import.meta.url));
const code=(await build({stdin:{contents:`
 import React from 'react';
 import {createRoot} from 'react-dom/client';
 import {flushSync} from 'react-dom';
 import DirectorWhisper from './frontend/DirectorWhisper.jsx';
 const root=createRoot(document.getElementById('root'));
 window.qaRender=props=>flushSync(()=>root.render(<DirectorWhisper {...props}/>));
 window.qaClose=()=>flushSync(()=>root.unmount());
 window.qaRender(window.qaProps);
`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',loader:{'.css':'empty'},logLevel:'warning'})).outputFiles[0].text;
const {window}=parseHTML('<!doctype html><html><body><div id="root"></div></body></html>'),{document}=window;
document.oninput=null;
const timers=new Set(),frames=new Map(),errors=[],calls=[],requests=[];
let frame=0,sendError=null;
const wait=()=>new Promise(resolve=>setTimeout(resolve,16));
const timeout=(fn,ms,...args)=>{const timer=setTimeout(()=>{timers.delete(timer);fn(...args);},ms);timers.add(timer);return timer;};
window.HTMLElement.prototype.focus=function(){document._active=this;};
window.HTMLElement.prototype.getClientRects=()=>[{width:900,height:500}];
window.HTMLElement.prototype.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:900,bottom:500,width:900,height:500});
Object.defineProperty(document,'activeElement',{get:()=>document._active||document.body});
const observer=class{observe(){}unobserve(){}disconnect(){}};
const raf=fn=>{frames.set(++frame,fn);return frame;},cancel=id=>frames.delete(id);
const computed=()=>new Proxy({getPropertyValue:()=>'',transform:'none',opacity:'1',display:'block',visibility:'visible'},{get:(target,key)=>target[key]??''});
const matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
const context={window,document,console:{...console,error:(...args)=>errors.push(args.map(String).join(' '))},setTimeout:timeout,clearTimeout,requestAnimationFrame:raf,cancelAnimationFrame:cancel,performance,queueMicrotask,crypto:globalThis.crypto,structuredClone,URL,AbortController,AbortSignal,navigator:{userAgent:'director-whisper-dom-test'},location:{pathname:'/',origin:'https://handoff.invalid'},HTMLElement:window.HTMLElement,SVGElement:window.SVGElement,Element:window.Element,Node:window.Node,Event:window.Event,ResizeObserver:observer,IntersectionObserver:observer,getComputedStyle:computed,matchMedia,fetch:async(...args)=>{requests.push(args);throw new Error('Whisper UI must not request a provider directly');}};
Object.assign(window,{requestAnimationFrame:raf,cancelAnimationFrame:cancel,getComputedStyle:computed,matchMedia});
context.globalThis=context;context.self=context;
const whispers={
 send:async instruction=>{calls.push(['send',instruction]);if(sendError)throw sendError;},
 apply:()=>calls.push(['apply']),cancel:()=>calls.push(['cancel']),retry:async()=>calls.push(['retry']),resume:()=>calls.push(['resume'])
};
const engine={whispers,speak:()=>calls.push(['UNSAFE-direct-speak']),apply:()=>calls.push(['UNSAFE-direct-apply']),director:{speak:()=>calls.push(['UNSAFE-director-speak'])}};
let s={game:{id:'show-one'},production:'milo',stage:{hostId:'milo'},characters:[{id:'milo',name:'Milo'},{id:'stella',name:'Stella'}],demo:false,whisper:{phase:'idle',busy:false,simulated:false,canApply:false,canRetry:false}};
// Runtime.snapshot() always supplies a normalized current target even while
// its internal idle target is null. Mirror that public contract in this fake.
const snapshot=()=>{const call=engine.liveCalls?.call,live=call?.phase==='live',characterId=s.stage.hostId;return {...s,whisper:{...s.whisper,target:s.whisper.target??{gameId:s.demo?null:s.game.id,production:s.production,characterId,name:s.characters.find(c=>c.id===characterId)?.name||characterId,callId:call?.id??null,callName:live?call.context?.callName||'':'',live}}};};
window.qaProps={s:snapshot(),engine};
const text=()=>document.body.textContent;
const button=label=>[...document.querySelectorAll('button')].find(el=>el.getAttribute('aria-label')===label||el.textContent.trim()===label);
const dispatch=(node,type='click',extra={})=>{assert(node,'Missing '+type+' target');const event=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,extra);node.dispatchEvent(event);return event;};
const click=async label=>{const node=button(label);assert(node,'Missing button: '+label);assert(!node.disabled,'Unexpected disabled button: '+label);dispatch(node);await wait();return node;};
const draft=()=>document.querySelector('[aria-label="Privé regieaanwijzing"]');
const type=async value=>{const node=draft();assert(node,'Whisper input missing');Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(node,value);dispatch(node,'input');await wait();};
const render=async patch=>{s={...s,...patch};window.qaRender({s:snapshot(),engine});await wait();};
const state=async patch=>render({whisper:{...s.whisper,...patch}});
const noUnsafe=()=>assert(!calls.some(([kind])=>kind.startsWith('UNSAFE')),'UI bypassed the whisper runtime');
try{
 vm.runInNewContext(code,context,{filename:'director-whisper-ui-bundle.js'});await wait();await wait();
 assert.equal(document.querySelector('[role="dialog"]'),null);
 const trigger=button('Fluister naar Milo');assert(trigger);trigger.focus();
 await click('Fluister naar Milo');
 const dialog=document.querySelector('[role="dialog"]');assert(dialog,'Trigger must open the actual shared Modal');
 assert(!document.getElementById('root').contains(dialog),'The modal must portal outside clipped workspace panels');
 assert.equal(dialog.getAttribute('aria-modal'),'true');assert.equal(document.body.style.overflow,'hidden');
 assert(text().includes('De presentator kan er wel hoorbaar op reageren.'));assert(!text().includes('Voorbeeldmodus:'));
 assert(button('Fluister in').disabled,'Blank instructions must not be sendable');

 await click('Meer spanning');
 const first=draft().value;assert(first.includes('zonder een nummer of winnaar te verzinnen.'));
 assert.equal(calls.length,0,'A suggestion may fill the draft but must never send or speak');
 assert.equal(requests.length,0);
 await click('Fluister in');assert.deepEqual(calls,[['send',first]]);noUnsafe();

 await state({phase:'prepared',instruction:first,reply:'Zijn jullie klaar voor een beetje magie?',canApply:true,message:'Reactie gereed.'});
 assert(text().includes('Reactie klaar voor jouw controle'));assert(text().includes('Zijn jullie klaar voor een beetje magie?'));
 assert(text().includes('Pas met ‘Laat reactie uitspreken’'));
 assert(button('Laat reactie uitspreken'),'An unchanged reviewed proposal needs an explicit apply button');
 assert.equal(calls.filter(([kind])=>kind==='apply').length,0,'Receiving a proposal must not start audio');
 await click('Laat reactie uitspreken');assert.deepEqual(calls.at(-1),['apply']);noUnsafe();

 await type('  Vraag rustig of iedereen zijn boekje klaar heeft.  ');
 assert.equal(button('Laat reactie uitspreken'),undefined,'Editing the instruction must hide the old proposal apply action');
 assert(button('Verwerk nieuwe aanwijzing'));
 const beforeEditApply=calls.filter(([kind])=>kind==='apply').length;
 await click('Verwerk nieuwe aanwijzing');assert.deepEqual(calls.at(-1),['send','Vraag rustig of iedereen zijn boekje klaar heeft.']);
 assert.equal(calls.filter(([kind])=>kind==='apply').length,beforeEditApply);
 await state({instruction:'Vraag rustig of iedereen zijn boekje klaar heeft.'});
 assert(button('Laat reactie uitspreken'),'Trimmed unchanged instructions match the prepared proposal');
 await click('Voorstel wegleggen');assert.deepEqual(calls.at(-1),['cancel']);

 await state({phase:'queued',busy:true,canApply:false,waitReason:'Wacht op het lopende bingomeldvenster.'});
 assert(button('In behandeling…').disabled);assert(button('Rustiger praten').disabled);
 assert(text().includes('Wacht op het lopende bingomeldvenster.'));
 await click('Annuleren');assert.deepEqual(calls.at(-1),['cancel']);

 await state({phase:'prepared',busy:false,canApply:false,canResume:true,waitReason:''});
 await click('Stem vrijgeven');assert.deepEqual(calls.at(-1),['resume']);
 await state({phase:'idle',canResume:false});
 await type('Neem rustig de tijd.');
 const shortcut=dispatch(draft(),'keydown',{key:'Enter',ctrlKey:true,metaKey:false});await wait();
 assert(shortcut.defaultPrevented);assert.deepEqual(calls.at(-1),['send','Neem rustig de tijd.']);
 assert.equal(calls.filter(([kind])=>kind==='apply').length,beforeEditApply);

 await state({phase:'accepted',target:{name:'Milo',characterId:'milo',production:'milo',gameId:'show-one',callId:'call-one',callName:'Sophie',live:true},instruction:'Neem rustig de tijd.',reply:'',canApply:false,canRetry:false,message:'Aanwijzing ontvangen.'});
 assert(text().includes('Aanwijzing voor het actieve live gesprek'));
 assert(text().includes('Ontvangen in de live sessie'));
 assert(text().includes('niet dat de aanwijzing al is opgevolgd of uitgesproken.'));
 assert(!text().includes('Uitspraak afgerond'));assert(!button('Laat reactie uitspreken'));assert(!button('Opnieuw proberen'));

 await state({phase:'uncertain',busy:false,canRetry:false,error:'De ontvangst kon niet worden bevestigd.',message:''});
 assert(text().includes('Ontvangst onbevestigd'));assert(document.querySelector('[role="alert"]'));
 assert(!text().includes('Uitspraak afgerond'));assert(!button('Opnieuw proberen'),'Unknown receipt must not offer a potentially duplicate retry');
 assert(!button('Laat reactie uitspreken'));
 await state({phase:'failed',canRetry:true,error:'Niet verstuurd; opnieuw proberen is veilig.'});
 await click('Opnieuw proberen');assert.deepEqual(calls.at(-1),['retry']);

 await state({phase:'idle',canRetry:false,error:'',target:null});
 assert.equal(draft().value,'','Leaving a live target must clear its old draft');
 await type('Een nieuwe aanwijzing om de foutmelding te controleren.');
 sendError=new Error('De verbinding is tijdelijk niet bereikbaar.');
 await click('Fluister in');assert(document.querySelector('[role="alert"]').textContent.includes(sendError.message));sendError=null;
 await click('Sluiten');assert.equal(document.querySelector('[role="dialog"]'),null);assert.notEqual(document.body.style.overflow,'hidden');

 engine.liveCalls={call:{id:'call-sophie',entryId:'entry-sophie',profileId:'child-sophie',phase:'live',context:{callName:'Sophie',pronunciation:'Sofie'}}};
 await state({phase:'idle',target:null});await click('Fluister naar Milo');
 await type('Vraag Sophie naar haar favoriete kleur.');
 const beforeCallerChange=calls.length;
 engine.liveCalls.call={id:'call-daan',entryId:'entry-daan',profileId:'child-daan',phase:'live',context:{callName:'Daan',pronunciation:''}};
 await render({});
 assert.equal(draft().value,'','A new caller with the same presenter must clear the previous caller instruction');
 assert(text().includes('Fluister naar Milo'),'Caller replacement must not change the selected presenter');
 assert.equal(calls.length,beforeCallerChange,'Replacing a caller must not send the old draft');
 await type('Vraag Daan iets makkelijks.');
 engine.liveCalls.call={...engine.liveCalls.call,context:{...engine.liveCalls.call.context,callName:'Daniël'}};
 await render({});
 assert.equal(draft().value,'','Correcting the current child call name must invalidate the old draft');
 await type('Een aanwijzing met de oude uitspraak.');
 engine.liveCalls.call={...engine.liveCalls.call,context:{...engine.liveCalls.call.context,pronunciation:'Daa-nie-el'}};
 await render({});
 assert.equal(draft().value,'','Correcting pronunciation must clear the old draft through caller identity');
 await type('Een aanwijzing vóór de live overgang.');
 engine.liveCalls.call={...engine.liveCalls.call,phase:'returning'};
 await render({});
 assert.equal(draft().value,'','Leaving the live call must clear the old guest draft');
 assert.equal(calls.length,beforeCallerChange);engine.liveCalls.call=null;await render({});
 await click('Sluiten');

 await render({demo:true,whisper:{phase:'completed',busy:false,simulated:true,canApply:false,reply:'Fictieve voorbeeldreactie.'}});
 await click('Fluister naar Milo');
 assert(text().includes('DEMO'));assert(text().includes('Simulatie afgerond'));assert(!text().includes('Uitspraak afgerond'));
 assert(text().includes('geen OpenAI-aanvraag, audio of echte aflevering.'));
 assert(text().includes('VOORBEELDREACTIE'));
 await type('Een niet verstuurde tekst voor Milo.');
 await render({stage:{hostId:'stella'},whisper:{phase:'idle',busy:false,simulated:true,canApply:false}});
 assert(text().includes('Fluister naar Stella'));assert.equal(draft().value,'','Presenter changes must clear the old draft');
 await type('Een tekst die bij de oude show hoort.');await render({game:{id:'show-two'}});
 assert.equal(draft().value,'','Show changes must clear the old draft');
 draft().focus();const beforeEscape=calls.length;
 const escape=dispatch(draft(),'keydown',{key:'Escape'});await wait();
 assert(escape.defaultPrevented);assert.equal(document.querySelector('[role="dialog"]'),null);
 assert.equal(calls.length,beforeEscape,'Closing with Escape must not invoke any whisper/runtime action');
 assert.notEqual(document.body.style.overflow,'hidden');
 noUnsafe();assert.equal(requests.length,0);window.qaClose();assert.deepEqual(errors,[]);
 console.log('✓ Director whisper UI: portal/shared modal, local-only presets, runtime-only send, explicit reviewed apply, edited draft reprocessing, queue/cancel/resume, safe retry, live receipt truthfulness, uncertain state, demo labels, presenter/show/caller/name/pronunciation resets and Escape close. No providers or audio were exercised.');
}finally{for(const timer of timers)clearTimeout(timer);frames.clear();}
