// Exercises layout persistence and real React portals in a lightweight DOM.
// Child windows are simulated here; browser popup/resize appearance is checked separately.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {normalizeLayout,movePanel,revealPanel,resizeColumns,layoutKey} from '../frontend/regie-layout.js';

const ids=['rundown','cameras','bingo','presentation','audience','show','audio'];
const valid=normalizeLayout({slots:['unknown','bingo','bingo','cameras'],weights:[-100,100]},ids);
assert.deepEqual(valid,{slots:['bingo','cameras'],weights:[.55,2.5]});
assert.deepEqual(normalizeLayout({},ids).slots,['rundown','cameras','bingo']);
assert.deepEqual(movePanel(normalizeLayout({},ids),'bingo','rundown').slots,['bingo','rundown','cameras']);
assert.deepEqual(revealPanel(normalizeLayout({},ids),'audience',99).slots,['rundown','cameras','audience']);
const resized=resizeColumns(normalizeLayout({},ids),0,100);
assert.equal(resized.weights[0]+resized.weights[1],2);assert(resized.weights[1]>=.55);
assert.notEqual(layoutKey('vlampie'),layoutKey('milo'));

const root=fileURLToPath(new URL('..',import.meta.url)),wait=()=>new Promise(r=>setTimeout(r,20));
const code=(await build({stdin:{contents:`
 import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';import RegiePanels from './frontend/RegiePanels.jsx';
 function Stateful({id}){const[n,setN]=useState(0);useEffect(()=>{window.mounts[id]=(window.mounts[id]||0)+1;return()=>{window.unmounts[id]=(window.unmounts[id]||0)+1;};},[]);return <div><span data-value={id}>{n}</span><button data-increment={id} onClick={()=>setN(n+1)}>Bijwerken</button><a href="#/audience">Naar publiek</a></div>;}
 const root=createRoot(document.getElementById('root'));window.dispose=()=>root.unmount();window.render=()=>root.render(<RegiePanels panels={['rundown','cameras','bingo','presentation','audience','show','audio'].map(id=>({id,title:id,content:<Stateful id={id}/>}))} production="milo" onNotice={n=>window.notices.push(n)} focusPanel={window.focusPanel}/>);window.render();
 `,loader:'jsx',resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser',loader:{'.css':'empty'},logLevel:'error'})).outputFiles[0].text;
const {window}=parseHTML('<html><head><style>.test{color:red}</style><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div></body></html>'),{document}=window;
const memory=new Map(),localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},intervals=new Set(),children=[],notices=[];
let blocked=false;
const mediaListeners=new Set(),media={matches:false,addEventListener:(type,fn)=>mediaListeners.add(fn),removeEventListener:(type,fn)=>mediaListeners.delete(fn)};window.matchMedia=()=>media;
window.mounts={};window.unmounts={};window.notices=notices;window.location={href:'https://bingo.example/#/live',hash:'#/live'};window.focus=()=>{};
window.open=(url,name)=>{
 assert.equal(url,'about:blank','Never load a second app/engine in a panel window');
 if(blocked)return null;
 const {document:doc}=parseHTML('<html><head></head><body></body></html>'),listeners=new Map();
 const child={document:doc,closed:false,name,focus(){this.focused=true;},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);},close(){if(this.closed)return;this.closed=true;listeners.get('pagehide')?.();}};
 children.push(child);return child;
};
window.HTMLElement.prototype.focus=function(){document._active=this;};
const context={window,document,localStorage,console,setTimeout,clearTimeout,setInterval:(fn,ms)=>{const id=setInterval(fn,ms);intervals.add(id);return id;},clearInterval:id=>{clearInterval(id);intervals.delete(id);},requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout,queueMicrotask,performance,URL,HTMLElement:window.HTMLElement,Element:window.Element,Node:window.Node,Event:window.Event,navigator:{userAgent:'portal-test'}};
context.globalThis=context;context.self=context;
const click=(selector,doc=document)=>{const node=doc.querySelector(selector);assert(node,'Missing '+selector);assert(!node.disabled,'Disabled '+selector);node.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));};
const dockIds=()=>[...document.querySelectorAll('.rd-panel-slot [data-panel-id]')].map(n=>n.dataset.panelId);
try{
 vm.runInNewContext(code,context);await wait();await wait();
 assert.deepEqual(dockIds(),['rundown','cameras','bingo']);
 click('[data-module-id="audience"]');await wait();click('[data-increment="audience"]');await wait();
 const target=document.querySelector('[data-panel-id="audience"]'),mounts=window.mounts.audience;
 click('[data-module-id="show"]');await wait();assert(document.querySelector('.rd-panel-parking [data-panel-id="audience"]'));
 click('[data-module-id="audience"]');await wait();assert.equal(document.querySelector('[data-panel-id="audience"]'),target);assert.equal(document.querySelector('[data-value="audience"]').textContent,'1');assert.equal(window.mounts.audience,mounts);
 click('[aria-label="audience losmaken"]');await wait();
 const child=children.at(-1);assert.equal(child.document.querySelector('[data-panel-id="audience"]'),target);assert.equal(document.querySelector('[data-panel-id="audience"]'),null);assert.equal(window.mounts.audience,mounts);assert(child.document.querySelector('link[rel="stylesheet"]'));assert(child.document.querySelector('base').href.includes('bingo.example'));
 click('[data-increment="audience"]',child.document);await wait();assert.equal(child.document.querySelector('[data-value="audience"]').textContent,'2');
 click('a[href="#/audience"]',child.document);assert.equal(window.location.hash,'/audience');
 child.close();await wait();assert.equal(document.querySelector('[data-panel-id="audience"]'),target);assert.equal(window.unmounts.audience||0,0);assert.equal(document.querySelector('[data-value="audience"]').textContent,'2');
 blocked=true;click('[aria-label="audience losmaken"]');await wait();assert(document.querySelector('.rd-panel-slot [data-panel-id="audience"]'));assert(notices.at(-1).includes('pop-ups'));blocked=false;
 click('[aria-label="audience naar links"]');await wait();assert.deepEqual(dockIds(),['rundown','audience','cameras']);assert.deepEqual(JSON.parse(memory.get(layoutKey('milo'))).slots,dockIds());
 media.matches=true;for(const changed of mediaListeners)changed();await wait();assert.equal(dockIds().length,1,'A narrow console must show one fitted dock, never a wide horizontal dock strip');
 const picker=document.querySelector('select[aria-label="Mobiel werkpaneel"]');assert(picker);const choose=id=>{Object.defineProperty(picker,'value',{value:id,configurable:true,writable:true});picker.dispatchEvent(new window.Event('change',{bubbles:true}));};
 choose('audio');await wait();assert.deepEqual(dockIds(),['audio']);choose('audience');await wait();assert.deepEqual(dockIds(),['audience']);assert.equal(document.querySelector('[data-panel-id="audience"]'),target);assert.equal(document.querySelector('[data-value="audience"]').textContent,'2','Narrow dock changes must retain the same unsaved form state');assert.equal(window.mounts.audience,mounts);
 media.matches=false;for(const changed of mediaListeners)changed();await wait();assert.equal(dockIds().length,3,'Returning to desktop must restore the saved multi-dock layout');
 click('[aria-label="audience losmaken"]');await wait();assert.equal(children.at(-1).closed,false);
 window.dispose();await wait();assert.equal(children.at(-1).closed,true);assert.equal(intervals.size,0);assert.equal(mediaListeners.size,0,'Responsive media listener is removed with the console');
 console.log('✓ Modular regie: clamped saved layouts, reorder, resize bounds, single mounted panel, retained local state, same portal across documents, close/blocked popup handling, mobile one-panel selection/state, desktop restoration, main navigation and window/timer cleanup');
}finally{window.dispose?.();for(const id of intervals)clearInterval(id);}
