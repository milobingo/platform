import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';

// Actual controlled React component; transport is injected, never a provider.
const video='ezsA3hsxIEc',other='dQw4w9WgXcQ',wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const bundle=(await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import BroadcastSettings from './frontend/BroadcastSettings.jsx';let root;window.renderBroadcast=props=>{root??=createRoot(document.getElementById('root'));flushSync(()=>root.render(<BroadcastSettings key={props.s.game.id} {...props} delay={25}/>));};window.closeBroadcast=()=>root?.unmount();`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',loader:{'.css':'empty'},logLevel:'warning'})).outputFiles[0].text;
const snapshot=(status='running',id='broadcast-show')=>({game:{id,status,settings:{youtubeId:''},broadcastRevision:0},production:'milo',demo:false});
function harness(t,respond){
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>'),{document}=window,calls=[],errors=[],timers=new Set();document.oninput=null;
 const type=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'type');Object.defineProperty(window.HTMLInputElement.prototype,'type',{...type,get(){return type.get.call(this)||'text';}});
 const timeout=(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);fn();},ms);timers.add(timer);return timer;};
 let state=snapshot();const engine={saveBroadcast:async payload=>{calls.push(structuredClone(payload));const data=await respond(payload,calls.length);if(data.game?.id===state.game.id){state={...state,game:data.game};render();}return data;}};
 const context={window,document,navigator:{userAgent:'broadcast-ui-fixture'},console:{...console,error:(...args)=>errors.push(args.map(String).join(' '))},setTimeout:timeout,clearTimeout,performance,queueMicrotask,crypto,structuredClone,URL,HTMLElement:window.HTMLElement,SVGElement:window.SVGElement,Element:window.Element,Node:window.Node,Event:window.Event,TextEncoder,TextDecoder,fetch:()=>{throw Error('Network/provider access is forbidden in this UI fixture');}};context.self=context;context.globalThis=context;vm.runInNewContext(bundle,context);
 const render=()=>window.renderBroadcast({s:state,engine}),input=()=>document.querySelector('input'),button=label=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===label),event=(node,name)=>node.dispatchEvent(new window.Event(name,{bubbles:true,cancelable:true}));
 const setInput=async value=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input(),value);event(input(),'input');await wait(10);};
 t.after(()=>{window.closeBroadcast();for(const timer of timers)clearTimeout(timer);assert.deepEqual(errors,[]);});
 return {calls,input,button,body:()=>document.body.textContent,type:setInput,blur:()=>event(input(),'focusout'),click:label=>event(button(label),'click'),async render(next=state){state=next;render();await wait(10);}};
}
const confirmed=(payload,revision=payload.expectedBroadcastRevision+1)=>({broadcast:{youtubeId:payload.youtubeId,revision},game:{id:payload.gameId,status:'running',settings:{youtubeId:payload.youtubeId},broadcastRevision:revision}});

test('a running-show URL autosaves to the separate broadcast API and confirms the normalized server ID',async t=>{
 const h=harness(t,async payload=>confirmed(payload));await h.render();await h.type('https://youtu.be/'+video+'?si=fixture');assert(h.body().includes('Opslaan…'));await wait(70);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].youtubeId,video);assert.equal(h.calls[0].expectedBroadcastRevision,0);assert.equal(h.input().value,video);assert(h.body().includes('Opgeslagen · '+video));
 const reloaded=snapshot();reloaded.game.settings.youtubeId=video;reloaded.game.broadcastRevision=1;await h.render(reloaded);assert.equal(h.input().value,video);assert.equal(h.calls.length,1);
});
test('a failed autosave keeps the complete input and only an explicit retry reuses its request ID',async t=>{
 let failing=true;const h=harness(t,async payload=>{if(failing)throw Error('De opslag is tijdelijk niet bereikbaar.');return confirmed(payload);});await h.render();const value='https://www.youtube.com/live/'+video;await h.type(value);await wait(60);assert.equal(h.calls.length,1);assert.equal(h.input().value,value);assert(h.body().includes('Niet opgeslagen'));assert(h.body().includes('opslag is tijdelijk'));await wait(90);assert.equal(h.calls.length,1);
 failing=false;h.click('Opnieuw proberen');await wait(40);assert.equal(h.calls.length,2);assert.equal(h.calls[0].requestId,h.calls[1].requestId);assert(h.body().includes('Opgeslagen · '+video));
});
test('a conflicting tab preserves input and requires explicit confirmation against the current broadcast revision',async t=>{
 let conflicting=true;const h=harness(t,async payload=>{if(conflicting)throw Object.assign(Error('De uitzending is in een ander venster gewijzigd.'),{code:'broadcast_conflict',broadcast:{youtubeId:other,revision:4}});return confirmed(payload);});await h.render();await h.type(video);await wait(60);assert.equal(h.input().value,video);assert(h.body().includes('Nu opgeslagen: '+other));await wait(70);assert.equal(h.calls.length,1);
 conflicting=false;h.click('Opnieuw proberen');await wait(35);assert.equal(h.calls[1].expectedBroadcastRevision,4);assert.notEqual(h.calls[0].requestId,h.calls[1].requestId);assert(h.body().includes('Opgeslagen · '+video));
});
test('edits during an in-flight save stay visible and are serialized after the confirmed revision',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve),h=harness(t,async(payload,index)=>{if(index===1)await gate;return confirmed(payload);});await h.render();await h.type(video);await wait(45);assert.equal(h.calls.length,1);await h.type(other);assert.equal(h.input().value,other);release();await wait(100);
 assert.equal(h.calls.length,2);assert.equal(h.calls[1].youtubeId,other);assert.equal(h.calls[1].expectedBroadcastRevision,1);assert.equal(h.input().value,other);assert(h.body().includes('Opgeslagen · '+other));
});
test('invalid input never sends a request and terminal shows never claim an unsaved change was stored',async t=>{
 const h=harness(t,async()=>assert.fail('Unexpected save'));await h.render();await h.type('https://evil.example/'+video);await wait(60);assert.equal(h.calls.length,0);assert(h.body().includes('geldige YouTube-link'));assert.equal(h.input().value,'https://evil.example/'+video);
 for(const cancelled of [false,true]){const state=snapshot('finished','terminal-'+cancelled);state.game.settings.youtubeId=other;if(cancelled)state.game.cancelledAt=123;await h.render(state);assert(h.input().disabled);assert.equal(h.input().value,other);assert.equal(h.button('Opnieuw proberen'),undefined);assert(h.body().includes(cancelled?'show is geannuleerd':'show is afgelopen'));}
 assert.equal(h.calls.length,0);
});
test('switching shows cancels pending debounce and ignores an old show response',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve),h=harness(t,async payload=>{await gate;return confirmed(payload);});await h.render();await h.type(video);await wait(45);assert.equal(h.calls.length,1);
 const next=snapshot('running','different-show');next.game.settings.youtubeId=other;await h.render(next);release();await wait(50);assert.equal(h.input().value,other);assert.equal(h.calls.length,1);assert(h.body().includes('Opgeslagen · '+other));
});
