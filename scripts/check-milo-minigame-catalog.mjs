import {canvasRuntime} from './canvas-runtime.mjs';
// Real React catalog + ShowRuntime interactions in a lightweight DOM.
// The unrelated studio and motion-layout boundaries are replaced; thumbnails
// still paint through the actual game renderer into native Canvas.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';

const root=fileURLToPath(new URL('..',import.meta.url));
const {createCanvas}=canvasRuntime;
const wait=ms=>new Promise(done=>setTimeout(done,ms));
const {window}=parseHTML('<!doctype html><html><body><div id="root"></div></body></html>'),{document}=window;
const errors=[],requests=[],timers=new Set(),surfaces=new WeakMap();
window.HTMLCanvasElement.prototype.getContext=function(){
 if(!surfaces.has(this))surfaces.set(this,createCanvas(Number(this.getAttribute('width'))||720,Number(this.getAttribute('height'))||290));
 return surfaces.get(this).getContext('2d');
};
window.HTMLElement.prototype.getBoundingClientRect=()=>({width:900,height:500,left:0,top:0,right:900,bottom:500});
const timeout=(fn,ms,...args)=>{const id=setTimeout(()=>{timers.delete(id);fn(...args);},ms);timers.add(id);return id;};
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
const localStorage=storage(),sessionStorage=storage(),location={hash:'',href:'https://bingo.example/#/library',origin:'https://bingo.example',pathname:'/'};
const matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}}),raf=fn=>timeout(()=>fn(performance.now()),16);
const context={window,document,location,localStorage,sessionStorage,navigator:{userAgent:'catalog-qa'},console:{...console,error:(...v)=>errors.push(v.map(String).join(' '))},setTimeout:timeout,clearTimeout,queueMicrotask,performance,crypto:globalThis.crypto,structuredClone,URL,Headers,Response,Request,AbortController,AbortSignal,TextEncoder,TextDecoder,Blob,atob,btoa,Event:window.Event,CustomEvent:window.CustomEvent,Element:window.Element,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,SVGElement:window.SVGElement,Node:window.Node,requestAnimationFrame:raf,cancelAnimationFrame:clearTimeout,matchMedia,getComputedStyle:()=>({getPropertyValue:()=>'',transform:'none',opacity:'1'}),fetch:async(...args)=>{requests.push(args);throw Error('Catalog must not call a provider or game endpoint');}};
Object.assign(window,{location,localStorage,sessionStorage,matchMedia,requestAnimationFrame:raf,cancelAnimationFrame:clearTimeout});
for(const name of ['addEventListener','removeEventListener','dispatchEvent'])context[name]=window[name].bind(window);
context.globalThis=context;context.self=context;context.global=context;

const source=`import React from 'react';
import {createRoot} from 'react-dom/client';
import ShowElements from './frontend/ShowElements.jsx';
import {makeGame} from './server/bingo-model.js';
import {CHARACTERS} from './server/characters.js';
const root=createRoot(document.getElementById('root'));
let engine;
function render(){const s={production:engine.production,game:engine.game,demo:false,dirty:engine.dirty,working:false,voicePhase:'idle',runner:{active:false,phase:'idle'},stage:{production:engine.production,hostId:engine.production,paused:true,speaking:false,motion:'idle'},characters:Object.values(CHARACTERS)};root.render(<ShowElements key={engine.game.id} s={s} engine={engine} run={fn=>Promise.resolve().then(fn).catch(e=>window.qaErrors.push(e.message))}/>);}
window.qaErrors=[];window.qaSelect=(production='milo',running=false)=>{
 const game=makeGame({brandId:production,title:'Catalogustest',date:'2026-11-11T13:30',roundCount:1,settings:{minigames:['wheel','gifts']}},'owner','https://bingo.example');game.status=running?'running':'draft';
 engine={game,production,demo:false,dirty:false,hostId:production,voicePhase:'idle',camera:'host',motion:'idle',runner:{active:false},director:{paused:true,pending:null,visual:()=>({scene:'host',age:0,paused:true})},audio:{unlock:async()=>true},bridge:{sendLocal(){}},characters:Object.values(CHARACTERS),emit:render,savePlan:async()=>{engine.saved=[...engine.game.settings.minigames];engine.dirty=false;render();}};
 window.qaEngine=engine;render();
};window.qaUnmount=()=>root.unmount();window.qaSelect();`;
const plugins=[{name:'catalog-boundaries',setup(b){
 b.onResolve({filter:/mf-studio\.js$/},()=>({path:'studio',namespace:'qa'}));
 b.onResolve({filter:/^motion\/react$/},()=>({path:'motion',namespace:'qa'}));
 b.onLoad({filter:/.*/,namespace:'qa'},({path})=>({loader:'jsx',resolveDir:root,contents:path==='studio'?`export const MAGIC_MOMENTS=[{id:'star-hat',duration:14,title:'Sterrenhoed'},{id:'silk-stars',duration:15,title:'Sterrenvlinder'}];export function mountStudio(){return {update(){},destroy(){}};}`:`import React from 'react';export const AnimatePresence=({children})=>children;export const motion=new Proxy({},{get:(_,tag)=>React.forwardRef(({children,initial,animate,exit,transition,layout,whileHover,whileTap,...props},ref)=>React.createElement(tag,{...props,ref},children))});`}));
}}];
const compiled=(await build({stdin:{contents:source,resolveDir:root,sourcefile:'catalog-test.jsx',loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',loader:{'.css':'empty'},plugins,logLevel:'warning',define:{'process.env.NODE_ENV':'"production"'}})).outputFiles[0].text;
const click=label=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);assert(button,'Missing button '+label);button.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));return button;};
async function openGames(){await wait(60);click('Beslisspellen');await wait(80);}
try{
 vm.runInNewContext(compiled,context,{filename:'catalog-test.js'});await openGames();
 const cards=[...document.querySelectorAll('.se-game')];assert.equal(cards.length,16);
 const top=cards.slice(0,5).map(card=>card.querySelector('h3').textContent);
 assert.deepEqual(top,['Milo’s Sterrenplingo','Het Lintenlabyrint','Het Spiegelpaleis','De Bruisende Toverdrank','De Keuze van de Sterrenvlinder']);
 assert.equal(document.querySelectorAll('canvas.se-game-thumbnail[data-rendered="true"]').length,5,'Actual React effects must paint all five thumbnail canvases');
 assert.equal(document.querySelectorAll('.se-game-example').length,5,'Demo stills must be labelled as examples');
 const before=JSON.stringify(window.qaEngine.game.state);click('Kies deze vijf');await wait(30);
 assert.deepEqual(Array.from(window.qaEngine.game.settings.minigames),['plingo','ribbons','mirrors','potion','butterfly']);assert.equal(window.qaEngine.dirty,true);assert.equal(JSON.stringify(window.qaEngine.game.state),before);
 click('Spelkeuze opslaan');await wait(30);assert.deepEqual(Array.from(window.qaEngine.saved),['plingo','ribbons','mirrors','potion','butterfly']);assert.equal(window.qaEngine.dirty,false);
 window.qaSelect('milo',true);await openGames();assert(document.querySelector('.se-magic-selection button').hasAttribute('disabled'));assert([...document.querySelectorAll('.se-game-copy input')].every(i=>i.hasAttribute('disabled')));
 window.qaSelect('vlampie');await openGames();assert.equal(document.querySelectorAll('.se-game').length,12);assert.equal(document.querySelector('.se-magic-selection'),null);assert.equal(document.querySelectorAll('canvas.se-game-thumbnail').length,0);
 assert(![...document.querySelectorAll('.se-game h3')].some(h=>/Lintenlabyrint|Spiegelpaleis|Toverdrank|Sterrenvlinder/.test(h.textContent)));
 assert.deepEqual(Array.from(window.qaErrors),[]);assert.deepEqual(errors,[]);assert.equal(requests.length,0);
 console.log('✓ Actual React catalog + ShowRuntime: five real Canvas thumbnails, selection/save route, running-show guard and Vlampie isolation; no API or provider calls');
}finally{window.qaUnmount?.();for(const timer of timers)clearTimeout(timer);}
