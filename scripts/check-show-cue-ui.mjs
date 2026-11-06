// DOM interaction coverage. Canvas is an observed boundary here; actual show
// rendering is covered by the native-canvas studio checks, not this harness.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {makeGame} from '../server/bingo-model.js';
import {CHARACTERS} from '../server/characters.js';
import {SHOW_CUES} from '../server/show-cues.js';
import {MAGIC_CUES} from '../server/magic-cues.js';

const root=fileURLToPath(new URL('..',import.meta.url)),wait=()=>new Promise(r=>setTimeout(r,12));
const renderer={name:'observed-show-preview',setup(b){b.onResolve({filter:/mf-studio\.js$/},()=>({path:'renderer',namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},()=>({loader:'js',contents:`
 export const MAGIC_MOMENTS=[{id:'star-hat',title:'De zwevende sterrenhoed',duration:14},{id:'silk-stars',title:'Van lint naar sterrenvlinder',duration:15}];
 export function mountStudio(node,{state}){window.previewState=state;return {update(s){window.previewState=s;},destroy(){}};}
 `}));}};
const code=(await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Panel,{ShowCueQuick} from './frontend/ShowCuePanel.jsx';const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<Panel s={window.state} engine={window.engine} run={fn=>fn()}/>);window.renderQuick=()=>root.render(<ShowCueQuick s={window.state} engine={window.engine} run={fn=>fn()}/>);window.render();`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',loader:{'.css':'empty'},plugins:[renderer],logLevel:'warning'})).outputFiles[0].text;
const {window}=parseHTML('<html><body><div id="root"></div></body></html>'),{document}=window;
document.oninput=null;
let now=0,id=0;const frames=new Map(),timers=new Set(),calls=[],requests=[];
const raf=fn=>{frames.set(++id,fn);return id;},cancel=id=>frames.delete(id),timeout=(fn,ms,...args)=>{const t=setTimeout(()=>{timers.delete(t);fn(...args);},ms);timers.add(t);return t;};
const game=makeGame({brandId:'milo',title:'Showcue repetitie',date:'2026-11-01T14:00',roundCount:1},'owner','https://bingo.example');
window.state={production:'milo',demo:true,game,characters:Object.values(CHARACTERS),voicePhase:'idle',runner:{active:false},stage:{production:'milo',hostId:'milo',speakerId:'milo',camera:'wide',motion:'idle',paused:true,drawn:[]}};
window.engine={director:{pending:null},playShowCue:id=>calls.push(['play',id]),magicMoment:id=>calls.push(['magic',id]),setMotion:id=>calls.push(['motion',id]),addShowCue:id=>{const c=SHOW_CUES.find(c=>c.id===id);game.plan.blocks.push({id:'test-'+id,type:'show',showCueId:id,duration:c.duration});calls.push(['add',id]);},pause:value=>calls.push(['pause',value]),stopShowCue:()=>calls.push(['stop'])};
const observer=class{observe(){}unobserve(){}disconnect(){}};
const context={window,document,console,setTimeout:timeout,clearTimeout,requestAnimationFrame:raf,cancelAnimationFrame:cancel,performance:{now:()=>now},queueMicrotask,crypto:globalThis.crypto,structuredClone,URL,AbortController,AbortSignal,fetch:async(...args)=>{requests.push(args);throw Error('A silent preview must not fetch');},navigator:{userAgent:'cue-ui-test'},location:{pathname:'/',origin:'https://bingo.example'},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),HTMLElement:window.HTMLElement,SVGElement:window.SVGElement,Element:window.Element,Node:window.Node,Event:window.Event,ResizeObserver:observer,IntersectionObserver:observer,getComputedStyle:()=>({getPropertyValue:()=>'',transform:'none',opacity:'1'})};
context.globalThis=context;context.self=context;Object.assign(window,{requestAnimationFrame:raf,cancelAnimationFrame:cancel,matchMedia:context.matchMedia});
const event=(el,type='click')=>{assert(el,'Missing '+type+' control');assert(!el.disabled,'Control unexpectedly disabled: '+el.textContent);el.dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true}));};
const click=label=>event([...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent.trim()===label));
const advance=async ms=>{for(let t=0;t<ms;t+=40){now+=40;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(now));await wait();}};
try{
 vm.runInNewContext(code,context);await wait();await wait();
 assert.equal(document.querySelectorAll('.sc-card').length,SHOW_CUES.length+MAGIC_CUES.length);
 assert.equal(document.querySelectorAll('.sc-gesture-grid button').length,9);
 assert.equal(window.previewState.showCue,null);
 click('Voorbeeld afspelen');await wait();await advance(400);
 assert.equal(window.previewState.showCue.id,'welcome-wave');assert(window.previewState.showCue.elapsed>.2);assert.equal(window.previewState.camera,'establish');
 assert.equal(calls.length,0);assert.equal(requests.length,0);
 click('Voorbeeld pauzeren');await wait();const paused=window.previewState.showCue.elapsed;await advance(160);assert.equal(window.previewState.showCue.elapsed,paused);
 click('Voorbeeld opnieuw afspelen');await wait();assert.equal(window.previewState.showCue.elapsed,0);await advance(80);assert(window.previewState.showCue.elapsed>0);await advance(1440);assert.equal(window.previewState.camera,'host','Preview must follow the real timed camera beats');
 event([...document.querySelectorAll('.sc-card')].find(b=>b.textContent.includes(SHOW_CUES.find(c=>c.id==='dance').title)));await wait();
 assert.equal(window.previewState.showCue,null);assert.equal(calls.length,0);
 window.engine.liveCalls={active:true,onAir:false,switchingLive:false};window.render();await wait();click('Start dit moment live');assert.deepEqual(calls,[['play','dance']],'Backstage availability alone must not disable entertainment');window.engine.liveCalls=null;
 click('Aan draaiboek toevoegen');assert.equal(game.plan.blocks.at(-1).showCueId,'dance');assert.equal(game.plan.blocks.at(-1).duration,8);
 event([...document.querySelectorAll('.sc-gesture-grid button')].find(b=>b.textContent.includes('Dans')));assert.deepEqual(calls.at(-1),['motion','dance']);
 window.state={...window.state,stage:{...window.state.stage,paused:false,showCue:{id:'dance',instanceId:'live-1',elapsed:3,duration:8,paused:false,source:'manual'}}};window.render();await wait();
 assert.equal(Number(document.querySelector('progress').getAttribute('value')),3);click('Showmoment pauzeren');assert.deepEqual(calls.at(-1),['pause',true]);click('Stop showmoment');assert.deepEqual(calls.at(-1),['stop']);
 window.state={...window.state,stage:{...window.state.stage,showCue:null,magic:{id:'star-hat',elapsed:3500,duration:14,manual:true},paused:false}};window.render();await wait();assert.equal(Number(document.querySelector('progress').getAttribute('value')),3.5);assert(document.querySelector('.sc-active').textContent.includes('De zwevende sterrenhoed'));click('Stop showmoment');assert.deepEqual(calls.at(-1),['stop']);
 window.state={...window.state,stage:{...window.state.stage,showCue:null,magic:null,hostId:'stella'}};window.render();await wait();event([...document.querySelectorAll('.sc-card')].find(b=>b.textContent.includes('De zwevende sterrenhoed')));await wait();click('Voorbeeld afspelen');await wait();await advance(80);
 assert.equal(window.previewState.hostId,'milo');assert.equal(window.previewState.magic.id,'star-hat');assert.equal(window.previewState.showCue,null);assert([...document.querySelectorAll('button')].find(b=>b.textContent==='Start dit moment live').disabled);
 event([...document.querySelectorAll('[aria-label="Soort showmoment"] button')].find(b=>b.textContent.startsWith('Goochelatelier')));await wait();
 assert.equal(document.querySelectorAll('.sc-card').length,12);
 const beforeMagicCalls=calls.length;
 for(const cue of MAGIC_CUES){
  event([...document.querySelectorAll('.sc-card')].find(b=>b.textContent.includes(cue.title)));await wait();
  assert.equal(document.querySelector('.sc-preview-copy h3').textContent,cue.title);
  assert.equal(Number(document.querySelector('[aria-label="Tijdpositie voorbeeld"]').getAttribute('max')),cue.duration);
  assert.equal(document.querySelectorAll('.sc-magic-phases>span').length,4);
  click('Voorbeeld afspelen');await wait();await advance(80);
  assert.equal(window.previewState.magic.id,cue.id);assert.equal(window.previewState.magic.duration,cue.duration);assert.equal(window.previewState.hostId,'milo');
 }
 const mobilePicker=document.querySelector('[aria-label="Moment voor de voorvertoning"]');
 assert.equal(mobilePicker.querySelectorAll('option').length,13,'Mobile selector must retain every filtered trick');
 Object.defineProperty(mobilePicker,'value',{configurable:true,value:'magic:bubble-world',writable:true});
 event(mobilePicker,'change');await wait();
 assert.equal(document.querySelector('.sc-preview-copy h3').textContent,MAGIC_CUES.find(c=>c.id==='bubble-world').title,'Mobile selection must update the same silent preview');
 assert.equal(window.previewState.magic,null,'Selecting on mobile must not start a live or preview performance');
 assert.equal(calls.length,beforeMagicCalls,'Every magic preview must remain local and silent');
 const search=document.querySelector('[aria-label="Zoek een showmoment"]');
 Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(search,'zandloper');event(search,'input');await wait();
 assert.equal(document.querySelectorAll('.sc-card').length,1);assert(document.querySelector('.sc-card').textContent.includes('omgekeerde zandloper'));
 Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(search,'');event(search,'input');await wait();
 event([...document.querySelectorAll('[aria-label="Soort showmoment"] button')].find(b=>b.textContent.startsWith('Showmomenten')));await wait();assert.equal(document.querySelectorAll('.sc-card').length,SHOW_CUES.length);
 event([...document.querySelectorAll('[aria-label="Soort showmoment"] button')].find(b=>b.textContent.startsWith('Alles')));await wait();assert.equal(document.querySelectorAll('.sc-card').length,SHOW_CUES.length+12);
 window.state={...window.state,production:'vlampie',stage:{...window.state.stage,production:'vlampie',hostId:'vlampie'}};window.render();await wait();assert.equal(document.querySelector('.sc-library'),null);window.renderQuick();await wait();assert.equal(document.querySelector('.sc-quick'),null);
 assert.equal(requests.length,0);
 console.log('✓ Show cue UI: selectable moments, silent local preview/play/pause/replay, intentional live start, correct rundown cue, timed gesture action, active pause/stop, all 12 filtered/searched magic previews and Vlampie isolation');
}finally{for(const t of timers)clearTimeout(t);frames.clear();}
