// Actual React forms with an injected request transport. Every credential below
// is an inert fixture; no provider, account or remote database is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';

const root=fileURLToPath(new URL('..',import.meta.url));
const bundle=(await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import OpenAISettings from './frontend/OpenAISettings.jsx';import LiveKitSettings from './frontend/LiveKitSettings.jsx';import ResendSettings from './frontend/ResendSettings.jsx';let root;window.providerRender=(kind,props)=>{root??=createRoot(document.getElementById('root'));flushSync(()=>root.render(React.createElement({openai:OpenAISettings,livekit:LiveKitSettings,resend:ResendSettings}[kind],props)));};window.providerClose=()=>{if(root)flushSync(()=>root.unmount());root=null;};`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',loader:{'.css':'empty'},logLevel:'warning'})).outputFiles[0].text;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const storage=()=>{const map=new Map();return {map,getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key),clear:()=>map.clear()};};
const OPENAI_KEY='sk-test-provider-settings-ui-not-a-real-key-123456';
const LIVEKIT_KEY='API_UI_FIXTURE_NOT_REAL_123456';
const RESEND_KEY='re_ui_fixture_not_a_real_key_1234567890';
const LIVEKIT_SECRET='livekit-ui-fixture-not-a-real-secret-1234567890';
const initial=kind=>({configured:true,canManage:true,source:'environment',environmentConfigured:true,revision:'revision-1',connectionTest:{tested:false,testedAt:null},...(kind==='livekit'?{url:'wss://ui-fixture.livekit.cloud',apiKeyConfigured:true,secretConfigured:true}:kind==='resend'?{source:'regie',keyConfigured:true,from:'show@ui-fixture.invalid',replyTo:'organisatie@ui-fixture.invalid',deliveryEnabled:false,deliveryMode:'disabled',allowedRecipients:[],environment:'staging',route:'resend'}:{})});

function harness(t,kind,respond){
 const {window}=parseHTML('<!doctype html><html><body><div id="root"></div></body></html>'),{document}=window;
 document.oninput=null;const timers=new Set(),frames=new Map(),calls=[],errors=[],logs=[],localStorage=storage(),sessionStorage=storage();let frame=0,networkCalls=0,emits=0,settingsLoads=0;
 const timeout=(fn,ms,...args)=>{const timer=setTimeout(()=>{timers.delete(timer);fn(...args);},ms);timers.add(timer);return timer;};
 const raf=fn=>{frames.set(++frame,fn);return frame;},cancel=id=>frames.delete(id),observer=class{observe(){}unobserve(){}disconnect(){}},computed=()=>new Proxy({getPropertyValue:()=>'',transform:'none',opacity:'1',display:'block',visibility:'visible'},{get:(target,key)=>target[key]??''}),matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 window.HTMLElement.prototype.focus=function(){document._active=this;};window.HTMLElement.prototype.getClientRects=()=>[{width:900,height:700}];window.HTMLElement.prototype.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:900,bottom:700,width:900,height:700});Object.defineProperty(document,'activeElement',{get:()=>document._active||document.body});
 Object.assign(window,{requestAnimationFrame:raf,cancelAnimationFrame:cancel,getComputedStyle:computed,matchMedia});
 const context={window,document,console:{...console,error:(...args)=>errors.push(args.map(String).join(' ')),log:(...args)=>logs.push(args.map(String).join(' '))},setTimeout:timeout,clearTimeout,requestAnimationFrame:raf,cancelAnimationFrame:cancel,performance,queueMicrotask,crypto:globalThis.crypto,structuredClone,URL,AbortController,AbortSignal,Response,localStorage,sessionStorage,navigator:{userAgent:'provider-settings-ui-test'},location:{pathname:'/',origin:'https://provider-ui.invalid'},HTMLElement:window.HTMLElement,SVGElement:window.SVGElement,Element:window.Element,Node:window.Node,Event:window.Event,ResizeObserver:observer,IntersectionObserver:observer,getComputedStyle:computed,matchMedia,addEventListener:window.addEventListener.bind(window),removeEventListener:window.removeEventListener.bind(window),dispatchEvent:window.dispatchEvent.bind(window),fetch:async()=>{networkCalls++;throw Error('Provider/network access is forbidden in settings UI checks');}};context.globalThis=context;context.self=context;
 const engine={emit:()=>{emits++;},liveCalls:{loadSettings:async()=>{settingsLoads++;}}};
 const request=async(path,body,signal)=>{calls.push({path,...(body===undefined?{}:{body:structuredClone(body)})});return respond(path,body,signal);};
 vm.runInNewContext(bundle,context,{filename:'provider-settings-ui-bundle.js'});
 const input=label=>[...document.querySelectorAll('label')].find(node=>[...node.querySelectorAll('span')].some(span=>span.textContent.trim()===label))?.querySelector('input,select,textarea');
 const button=label=>[...document.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')===label||node.textContent.trim()===label);
 const event=(node,type='click')=>{assert(node,'Missing '+type+' target');node.dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true}));};
 const click=async label=>{const node=button(label);assert(node,'Missing button '+label);assert(!node.disabled,'Disabled button '+label);event(node);await wait(35);};
 const type=async(label,value)=>{const node=input(label);assert(node,'Missing input '+label);assert(!node.disabled,'Disabled input '+label);if(node.localName==='select'){Object.defineProperty(node,'value',{configurable:true,value});event(node,'change');}else{Object.getOwnPropertyDescriptor(node.localName==='textarea'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype,'value').set.call(node,value);event(node,'input');}await wait(25);};
 const submit=async label=>{const node=button(label);assert(node&&!node.disabled,'Missing or disabled submit '+label);event(node.closest('form'),'submit');await wait(40);};
 const close=()=>{window.providerClose();for(const timer of timers)clearTimeout(timer);timers.clear();};
 const assertPrivate=()=>{const persisted=JSON.stringify([...localStorage.map,...sessionStorage.map,logs]);for(const value of [OPENAI_KEY,LIVEKIT_KEY,LIVEKIT_SECRET,RESEND_KEY])assert(!persisted.includes(value),'A typed credential must not be logged or persisted in browser storage');};
 t.after(()=>{close();assert.equal(networkCalls,0);assertPrivate();assert.deepEqual(errors.filter(error=>!error.includes('act(')),[]);});
 return {window,document,engine,calls,input,button,event,click,type,submit,close,assertPrivate,actions:()=>calls.filter(call=>call.body!==undefined),alert:()=>document.querySelector('[role="alert"]')?.textContent||'',sideEffects:()=>({emits,settingsLoads}),mount:async()=>{window.providerRender(kind,{s:{production:'milo',demo:false},engine,request});await wait(70);}};
}
const labels=kind=>({openai:{save:'Sleutel veilig opslaan',test:'Test verbinding',remove:'Koppeling uitschakelen'},livekit:{save:'LiveKit-koppeling opslaan',test:'Test opgeslagen koppeling',remove:'LiveKit-koppeling uitschakelen'},resend:{save:'Instellingen en verzendmodus opslaan',test:'Test Resend-koppeling',remove:'Resend-koppeling uitschakelen'}}[kind]);
async function fill(h,kind){if(kind==='openai')await h.type('OpenAI API-sleutel',OPENAI_KEY);else if(kind==='resend')await h.type('Resend API-sleutel',RESEND_KEY);else{await h.type('LiveKit API-key',LIVEKIT_KEY);await h.type('LiveKit API-secret',LIVEKIT_SECRET);}}

test('OpenAI environment credentials are redacted but replaceable; save, connection test and model test remain separate',async t=>{
 let state=initial('openai');const h=harness(t,'openai',async(path,body)=>{if(path==='status')return state;if(path==='live-test')return {modelAccessible:true,audioVerified:false,message:'Alleen modeltoegang gecontroleerd.'};if(body.action==='save'){state={...state,source:'regie',revision:'revision-2'};return {saved:true};}if(body.action==='test'){state={...state,revision:'revision-3',connectionTest:{tested:true,testedAt:Date.now()}};return {tested:true};}assert.fail('Unexpected OpenAI action');});
 await h.mount();assert.equal(h.input('OpenAI API-sleutel').type,'password');assert.equal(h.input('OpenAI API-sleutel').value,'');assert.equal(h.input('OpenAI API-sleutel').getAttribute('autocomplete')||h.input('OpenAI API-sleutel').getAttribute('autoComplete'),'new-password');
 await fill(h,'openai');assert(h.button('Test verbinding').disabled,'Unsaved keys must not be tested implicitly');await h.submit(labels('openai').save);
 assert.deepEqual(h.actions(),[{path:'settings',body:{action:'save',revision:'revision-1',key:OPENAI_KEY}}]);assert.equal(h.input('OpenAI API-sleutel').value,'');assert.equal(h.engine.apiStatus.source,'regie');h.assertPrivate();
 await h.click('Test verbinding');assert.deepEqual(h.actions()[1],{path:'settings',body:{action:'test',revision:'revision-2'}});
 await h.click('Test GPT-Live-toegang');assert.deepEqual(h.actions()[2],{path:'live-test',body:{}});assert(h.document.body.textContent.includes('Alleen modeltoegang gecontroleerd.'));
});

test('a successful OpenAI save clears the typed secret even when its following status read fails',async t=>{
 let saved=false,readFailure=true;const h=harness(t,'openai',async(path,body)=>{if(path==='status'){if(saved&&readFailure)throw Error('Status kon niet worden herladen.');return {...initial('openai'),source:saved?'regie':'environment',revision:saved?'revision-2':'revision-1'};}assert.equal(body.action,'save');saved=true;return {saved:true};});
 await h.mount();await fill(h,'openai');await h.submit(labels('openai').save);assert(saved);assert.equal(h.input('OpenAI API-sleutel').value,'');assert.match(h.alert(),/Status kon niet/);assert.equal(h.actions().length,1);
 readFailure=false;await h.click('Herlaad');assert.equal(h.alert(),'');assert.equal(h.engine.apiStatus.revision,'revision-2');assert.equal(h.input('OpenAI API-sleutel').value,'');assert.equal(h.actions().length,1,'A failed read must never repeat the key mutation');
});

test('both settings forms retain failed edits, refresh a stale revision, and retry only after a deliberate save',async t=>{
 for(const kind of ['openai','livekit']){
  let state=initial(kind),conflict=true;const h=harness(t,kind,async(_path,body)=>{if(body===undefined)return state;if(conflict){state={...state,revision:'revision-2'};throw Error('De instellingen zijn intussen gewijzigd. Herlaad eerst.');}assert.equal(body.revision,'revision-2');state={...state,source:'regie',revision:'revision-3'};return state;});
  await h.mount();await fill(h,kind);await h.submit(labels(kind).save);assert.match(h.alert(),/intussen gewijzigd/);assert.equal(h.actions().length,1);assert.equal(h.input(kind==='openai'?'OpenAI API-sleutel':'LiveKit API-secret').value,kind==='openai'?OPENAI_KEY:LIVEKIT_SECRET);
  await h.click('Herlaad');assert.equal(h.alert(),'');assert.equal(h.input(kind==='openai'?'OpenAI API-sleutel':'LiveKit API-secret').value,'');conflict=false;await fill(h,kind);await h.submit(labels(kind).save);assert.equal(h.actions().length,2);assert.equal(h.actions()[1].body.revision,'revision-2');h.close();
 }
});

test('canManage false removes credential editing and rotation controls while permitting an explicit stored-connection test',async t=>{
 for(const kind of ['openai','livekit','resend']){
  const state={...initial(kind),source:'regie',canManage:false};const h=harness(t,kind,async(_path,body)=>body===undefined?state:{...state,tested:true,connectionTest:{tested:true,testedAt:Date.now()}});await h.mount();
  assert.equal(h.document.querySelector('form'),null);assert.equal(h.document.querySelector('input[type="password"]'),null);assert.equal(h.button(labels(kind).save),undefined);assert.equal(h.button(labels(kind).remove),undefined);assert(!h.button('Serverinstellingen gebruiken'),'Server fallback control must be absent after restoration or without permission');
  await h.click(labels(kind).test);assert.equal(h.actions().length,1);if(kind==='openai'){assert.equal(h.actions()[0].path,'test');assert.deepEqual(h.actions()[0].body,{});}else assert.equal(h.actions()[0].body.action,'test');assert(!('key' in h.actions()[0].body));assert(!('apiSecret' in h.actions()[0].body));h.close();
 }
});

test('LiveKit never prefills returned key material and preserves blank credentials only for the unchanged project',async t=>{
 let state={...initial('livekit'),apiKey:'UNEXPECTED_SERVER_KEY_FIXTURE',apiSecret:'UNEXPECTED_SERVER_SECRET_FIXTURE'};const h=harness(t,'livekit',async(_path,body)=>{if(body===undefined)return state;assert.equal(body.action,'save');state={...initial('livekit'),source:'regie',revision:'revision-2'};return state;});await h.mount();
 assert.equal(h.input('LiveKit API-key').value,'');assert.equal(h.input('LiveKit API-secret').value,'');assert(!h.input('LiveKit API-key').hasAttribute('required'));assert(!h.input('LiveKit API-secret').hasAttribute('required'));
 await h.submit(labels('livekit').save);assert.deepEqual(h.actions(),[{path:'/api/livekit/settings',body:{action:'save',url:state.url,apiKey:'',apiSecret:'',revision:'revision-1'}}]);assert.equal(h.input('LiveKit API-key').value,'');assert.equal(h.input('LiveKit API-secret').value,'');
});

test('LiveKit requires a new secret after URL or key changes and tests only the explicitly saved project',async t=>{
 let state=initial('livekit');const h=harness(t,'livekit',async(_path,body)=>{if(body===undefined)return state;if(body.action==='save'){state={...state,url:body.url,source:'regie',revision:'revision-2',connectionTest:{tested:false,testedAt:null}};return state;}assert.equal(body.action,'test');return {...state,tested:true,connectionTest:{tested:true,testedAt:Date.now()}};});await h.mount();
 await h.type('LiveKit API-key',LIVEKIT_KEY);assert(h.input('LiveKit API-secret').hasAttribute('required'),'Changing the key requires its matching secret');assert(h.button(labels('livekit').test).disabled);
 await h.type('LiveKit API-key','');await h.type('LiveKit-project URL','wss://another-ui-fixture.livekit.cloud');assert(h.input('LiveKit API-key').hasAttribute('required'),'Changing project requires a new key');assert(h.input('LiveKit API-secret').hasAttribute('required'),'Changing project requires its secret');assert.equal(h.actions().length,0);
 await fill(h,'livekit');await h.submit(labels('livekit').save);assert.equal(h.actions().length,1);assert.deepEqual(h.actions()[0].body,{action:'save',url:'wss://another-ui-fixture.livekit.cloud',apiKey:LIVEKIT_KEY,apiSecret:LIVEKIT_SECRET,revision:'revision-1'});assert.equal(h.input('LiveKit API-key').value,'');assert.equal(h.input('LiveKit API-secret').value,'');
 await h.click(labels('livekit').test);assert.deepEqual(h.actions()[1],{path:'/api/livekit/settings',body:{action:'test',revision:'revision-2'}});assert(h.document.body.textContent.includes('Serververbinding getest'));assert(h.document.body.textContent.includes('twee apparaten'));
});

test('remove and environment fallback require explicit confirmation, preserve revision binding, and never resend typed secrets',async t=>{
 for(const kind of ['openai','livekit'])for(const action of ['remove','environment']){
  let state={...initial(kind),source:'regie'};const h=harness(t,kind,async(_path,body)=>{if(body===undefined)return state;assert.equal(body.action,action);state={...state,source:action==='remove'?'none':'environment',configured:action!=='remove',revision:'revision-2'};return state;});await h.mount();const label=action==='remove'?labels(kind).remove:'Serverinstellingen gebruiken';
  await h.click(label);assert.equal(h.actions().length,0);await h.click('Annuleren');assert.equal(h.actions().length,0);await h.click(label);assert.equal(h.actions().length,0);await h.click('Bevestigen');assert.deepEqual(h.actions()[0],{path:kind==='openai'?'settings':'/api/livekit/settings',body:{action,revision:'revision-1'}});assert.equal(h.actions().length,1);h.close();
 }
});

test('an initial failed status load offers a real retry for either provider without enabling credential writes first',async t=>{
 for(const kind of ['openai','livekit','resend']){
  let failed=true;const h=harness(t,kind,async()=>{if(failed)throw Error('De instellingen zijn tijdelijk niet beschikbaar.');return initial(kind);});await h.mount();assert.match(h.alert(),/tijdelijk niet/);assert.equal(h.document.querySelector('form'),null);assert.equal(h.actions().length,0);failed=false;await h.click('Opnieuw laden');assert.equal(h.alert(),'');assert(h.document.querySelector('form'));assert.equal(h.actions().length,0);h.close();
 }
});

test('an explicitly disabled connection can deliberately return to existing server settings',async t=>{
 for(const kind of ['openai','livekit']){
  let state={...initial(kind),source:'none',disabled:true,configured:false,revision:'disabled-revision'};
  const h=harness(t,kind,async(_path,body)=>{if(body===undefined)return state;assert.deepEqual(structuredClone(body),{action:'environment',revision:'disabled-revision'});state={...initial(kind),revision:'restored-revision'};return state;});
  await h.mount();await h.click('Serverinstellingen gebruiken');assert.equal(h.actions().length,0);await h.click('Bevestigen');assert.equal(h.actions().length,1);assert(!h.button('Serverinstellingen gebruiken'),'Server fallback control must be absent after restoration or without permission');h.close();
 }
});

test('late operation success or failure after unmount cannot update another view, reload settings or repeat a request',async t=>{
 for(const kind of ['openai','livekit','resend'])for(const outcome of ['success','failure']){
  const pending=deferred(),h=harness(t,kind,async(_path,body)=>body===undefined?initial(kind):pending.promise);await h.mount();await fill(h,kind);await h.submit(labels(kind).save);assert.equal(h.actions().length,1);h.close();const before={calls:h.calls.length,...h.sideEffects()};
  if(outcome==='success')pending.resolve({...initial(kind),source:'regie',revision:'revision-2'});else pending.reject(Error('Late fixture failure after unmount'));await wait(50);assert.deepEqual({calls:h.calls.length,...h.sideEffects()},before);assert.equal(h.document.getElementById('root').textContent,'');
 }
});

test('Resend redacts returned credentials, saves sender and reply address, and tests only the saved revision without sending a mail',async t=>{
 let state={...initial('resend'),key:'UNEXPECTED_STORED_RESEND_KEY_FIXTURE',apiKey:'UNEXPECTED_API_KEY_FIXTURE'};
 const h=harness(t,'resend',async(_path,body)=>{
  if(body===undefined)return state;
  if(body.action==='save'){state={...initial('resend'),from:body.from,replyTo:body.replyTo,revision:'revision-2'};return {...state,saved:true};}
  assert.equal(body.action,'test');state={...state,revision:'revision-3',connectionTest:{tested:true,testedAt:Date.now()}};return {...state,tested:true};
 });
 await h.mount();assert.equal(h.input('Resend API-sleutel').type,'password');assert.equal(h.input('Resend API-sleutel').value,'');assert(!h.document.body.textContent.includes('UNEXPECTED_'));assert(!h.input('Resend API-sleutel').hasAttribute('required'));
 await h.type('Resend API-sleutel',RESEND_KEY);await h.type('Afzenderadres','nieuwe-show@ui-fixture.invalid');await h.type('Antwoordadres','antwoord@ui-fixture.invalid');assert(h.button(labels('resend').test).disabled);
 await h.submit(labels('resend').save);assert.deepEqual(h.actions(),[{path:'/api/resend/settings',body:{action:'save',revision:'revision-1',key:RESEND_KEY,from:'nieuwe-show@ui-fixture.invalid',replyTo:'antwoord@ui-fixture.invalid',deliveryMode:'disabled',allowedRecipients:[]}}]);assert.equal(h.input('Resend API-sleutel').value,'');assert(h.document.body.textContent.includes('Opgeslagen · nog testen'));h.assertPrivate();
 await h.click(labels('resend').test);assert.deepEqual(h.actions()[1],{path:'/api/resend/settings',body:{action:'test',revision:'revision-2'}});assert(h.document.body.textContent.includes('Sleutel gecontroleerd'));assert(h.document.body.textContent.includes('Er is geen testmail verstuurd'));assert(h.document.body.textContent.includes('Mailverzending staat uit'));assert.equal(h.actions().length,2);
});

test('Resend sender-only edits preserve a blank stored key and keep key verification separate from allowlisted sending',async t=>{
 let state={...initial('resend'),deliveryEnabled:true,deliveryMode:'allowlist',allowedRecipients:['test@ui-fixture.invalid'],connectionTest:{tested:true,testedAt:Date.now()}};
 const h=harness(t,'resend',async(_path,body)=>{if(body===undefined)return state;assert.deepEqual(structuredClone(body),{action:'save',revision:'revision-1',key:'',from:'andere@ui-fixture.invalid',replyTo:'',deliveryMode:'allowlist',allowedRecipients:['test@ui-fixture.invalid']});state={...state,from:body.from,replyTo:'',revision:'revision-2',connectionTest:{tested:false,testedAt:null}};return state;});
 await h.mount();assert(h.document.body.textContent.includes('Sleutel gecontroleerd'));assert(h.document.body.textContent.includes('beperkt tot de vrijgegeven testadressen'));assert(h.button(labels('resend').save).disabled);
 await h.type('Afzenderadres','andere@ui-fixture.invalid');await h.type('Antwoordadres','');await h.submit(labels('resend').save);assert.equal(h.actions().length,1);assert(!h.document.body.textContent.includes('Sleutel gecontroleerd'));assert(h.document.body.textContent.includes('Opgeslagen · nog testen'));
});

test('a failed Resend save retains every edit and retries only after the director deliberately saves again',async t=>{
 let fail=true,state=initial('resend');const h=harness(t,'resend',async(_path,body)=>{if(body===undefined)return state;if(fail)throw Error('Opslaan is tijdelijk niet bevestigd. Probeer opnieuw.');state={...state,from:body.from,replyTo:body.replyTo,revision:'revision-2'};return state;});
 await h.mount();await fill(h,'resend');await h.type('Afzenderadres','nieuw@ui-fixture.invalid');await h.type('Antwoordadres','reactie@ui-fixture.invalid');await h.submit(labels('resend').save);assert.match(h.alert(),/tijdelijk niet bevestigd/);assert.equal(h.input('Resend API-sleutel').value,RESEND_KEY);assert.equal(h.input('Afzenderadres').value,'nieuw@ui-fixture.invalid');assert.equal(h.input('Antwoordadres').value,'reactie@ui-fixture.invalid');assert.equal(h.actions().length,1);await wait(90);assert.equal(h.actions().length,1);
 fail=false;await h.submit(labels('resend').save);assert.equal(h.alert(),'');assert.equal(h.actions().length,2);assert.equal(h.actions()[1].body.key,RESEND_KEY);assert.equal(h.input('Resend API-sleutel').value,'');h.assertPrivate();
});

test('a failed Resend test refreshes its failed receipt and revision without leaving stale success or retrying a provider call',async t=>{
 let state={...initial('resend'),connectionTest:{tested:true,testedAt:Date.now()}},failed=true;const h=harness(t,'resend',async(_path,body)=>{if(body===undefined)return state;assert.equal(body.action,'test');if(failed){state={...state,revision:'revision-2',connectionTest:{tested:false,testedAt:Date.now()}};throw Error('Deze sleutel heeft geen toegang om domeinen te controleren.');}assert.equal(body.revision,'revision-2');state={...state,revision:'revision-3',connectionTest:{tested:true,testedAt:Date.now()}};return state;});
 await h.mount();assert(h.document.body.textContent.includes('Sleutel gecontroleerd'));await h.click(labels('resend').test);assert.match(h.alert(),/geen toegang om domeinen/);assert(!h.document.body.textContent.includes('Sleutel gecontroleerd'));assert.equal(h.actions().length,1);assert.equal(h.calls.filter(call=>call.body===undefined).length,2);assert.equal(h.input('Resend API-sleutel').value,'');
 failed=false;await h.click(labels('resend').test);assert.equal(h.alert(),'');assert.equal(h.actions().length,2);assert(h.document.body.textContent.includes('Sleutel gecontroleerd'));assert(h.document.body.textContent.includes('Mailverzending staat uit'));
});

test('Resend disable and server fallback require confirmation and send no typed key or address fields',async t=>{
 for(const action of ['remove','environment']){
  let state=initial('resend');const h=harness(t,'resend',async(_path,body)=>{if(body===undefined)return state;assert.deepEqual(structuredClone(body),{action,revision:'revision-1'});state={...state,source:action==='remove'?'none':'environment',configured:action!=='remove',keyConfigured:false,disabled:action==='remove',revision:'revision-2'};return state;});await h.mount();await fill(h,'resend');
  const label=action==='remove'?labels('resend').remove:'Serverinstellingen gebruiken';await h.click(label);assert.equal(h.actions().length,0);await h.click('Annuleren');assert.equal(h.actions().length,0);await h.click(label);await h.click('Bevestigen');assert.deepEqual(h.actions(),[{path:'/api/resend/settings',body:{action,revision:'revision-1'}}]);assert.equal(h.input('Resend API-sleutel').value,'');h.close();
 }
});

test('existing server mail delivery never implies a Resend key or a successful Resend check',async t=>{
 const h=harness(t,'resend',async()=>({...initial('resend'),source:'environment',keyConfigured:false,route:'dg-gateway',from:'bestaand@ui-fixture.invalid',replyTo:'',connectionTest:{tested:false,testedAt:null},deliveryEnabled:true,deliveryMode:'live'}));await h.mount();
 assert(h.input('Resend API-sleutel').hasAttribute('required'));assert.equal(h.input('Resend API-sleutel').value,'');assert(h.button(labels('resend').test).disabled);assert(h.button(labels('resend').save).disabled);assert(!h.document.body.textContent.includes('Sleutel gecontroleerd'));assert(h.document.body.textContent.includes('Mailverzending is vrijgegeven'));assert.equal(h.actions().length,0);
});

test('Resend rejects incomplete management status before exposing credential editing',async t=>{
 let incomplete=true;const h=harness(t,'resend',async()=>incomplete?{configured:true,from:'show@ui-fixture.invalid'}:initial('resend'));await h.mount();assert.match(h.alert(),/niet volledig/);assert.equal(h.document.querySelector('form'),null);assert.equal(h.actions().length,0);incomplete=false;await h.click('Opnieuw laden');assert.equal(h.alert(),'');assert.equal(h.input('Resend API-sleutel').value,'');assert.equal(h.actions().length,0);
});

test('Resend defaults to disabled and requires an explicit saved allowlist before enabling test recipients',async t=>{
 let state={...initial('resend'),configured:false,keyConfigured:false,source:'none',from:'',replyTo:'',revision:null};const h=harness(t,'resend',async(_path,body)=>{if(body===undefined)return state;assert.deepEqual(structuredClone(body),{action:'save',revision:null,key:RESEND_KEY,from:'show@ui-fixture.invalid',replyTo:'',deliveryMode:'allowlist',allowedRecipients:['ouder@ui-fixture.invalid','regie@ui-fixture.invalid']});state={...initial('resend'),deliveryMode:'allowlist',allowedRecipients:body.allowedRecipients,deliveryEnabled:true,from:body.from,replyTo:'',revision:'revision-1'};return state;});
 await h.mount();assert.equal(h.input('Verzendmodus').value,'disabled');assert(h.input('Verzendmodus').querySelector('option[value="live"]').hasAttribute('disabled'));assert(h.document.body.textContent.includes('Mailverzending staat uit'));await fill(h,'resend');await h.type('Afzenderadres','show@ui-fixture.invalid');assert.equal(h.actions().length,0);
 await h.type('Verzendmodus','allowlist');assert(h.button(labels('resend').save).disabled);await h.type('Toegestane testadressen',' OUDER@ui-fixture.invalid, regie@ui-fixture.invalid\nouder@ui-fixture.invalid ');assert.equal(h.actions().length,0);await h.submit(labels('resend').save);assert.equal(h.actions().length,1);assert.equal(h.input('Resend API-sleutel').value,'');assert(h.document.body.textContent.includes('beperkt tot de vrijgegeven testadressen'));assert(!h.document.body.textContent.includes('Sleutel gecontroleerd'));
});

test('Resend production sending stays a deliberate policy edit and a server limit remains visible',async t=>{
 let state={...initial('resend'),environment:'production',hostPolicy:{mode:'disabled',limited:true}},h=harness(t,'resend',async(_path,body)=>{if(body===undefined)return state;assert.equal(body.deliveryMode,'live');assert.equal(body.key,'');state={...state,deliveryMode:'live',deliveryEnabled:false,revision:'revision-2'};return state;});
 await h.mount();assert(!h.input('Verzendmodus').querySelector('option[value="live"]').hasAttribute('disabled'));assert(h.document.body.textContent.includes('Mailverzending blijft uit, ook als je hierboven een ruimere modus kiest'));await h.type('Verzendmodus','live');assert.equal(h.actions().length,0);assert(h.document.body.textContent.includes('Na opslaan mogen showmails worden verstuurd'));await h.submit(labels('resend').save);assert.equal(h.actions().length,1);assert(h.document.body.textContent.includes('Mailverzending staat uit'));
});

test('Resend limits explicit test recipients before saving and never persists addresses or keys in browser storage',async t=>{
 const h=harness(t,'resend',async()=>initial('resend'));await h.mount();await h.type('Verzendmodus','allowlist');await h.type('Toegestane testadressen',Array.from({length:101},(_,index)=>`gezin${index}@ui-fixture.invalid`).join(', '));assert(h.button(labels('resend').save).disabled);assert.match(h.alert(),/maximaal 100/);assert.equal(h.actions().length,0);assert.equal(h.document.querySelector('input[type="password"]').value,'');
});

test('a failed new OpenAI or LiveKit test removes old success and reloads the revision for an explicit retry',async t=>{
 for(const kind of ['openai','livekit']){
  let state={...initial(kind),connectionTest:{tested:true,testedAt:Date.now()}},failed=true;
  const h=harness(t,kind,async(_path,body)=>{if(body===undefined)return state;assert.equal(body.action,'test');if(failed){state={...state,revision:'revision-2',connectionTest:{tested:false,testedAt:Date.now()}};throw Error('De opgeslagen providerverbinding is nu niet bevestigd.');}assert.equal(body.revision,'revision-2');state={...state,revision:'revision-3',connectionTest:{tested:true,testedAt:Date.now()}};return {...state,tested:true};});
  await h.mount();const badge=()=>h.document.querySelector('.mf-badge').textContent;assert.match(badge(),kind==='openai'?/Sleutel gecontroleerd/:/Serververbinding getest/);await h.click(labels(kind).test);assert.match(h.alert(),/nu niet bevestigd/);assert(!/Sleutel gecontroleerd|Serververbinding getest/.test(badge()));assert.equal(h.actions().length,1);assert.equal(h.calls.filter(call=>call.body===undefined).length,2);failed=false;await h.click(labels(kind).test);assert.equal(h.actions().length,2);assert.equal(h.alert(),'');assert.match(badge(),kind==='openai'?/Sleutel gecontroleerd/:/Serververbinding getest/);h.close();
 }
});

test('a synchronous double submission can issue only one credential change for every provider',async t=>{
 for(const kind of ['openai','livekit','resend']){
  const pending=deferred(),h=harness(t,kind,async(_path,body)=>body===undefined?initial(kind):pending.promise);await h.mount();await fill(h,kind);const form=h.button(labels(kind).save).closest('form');h.event(form,'submit');h.event(form,'submit');await wait(25);assert.equal(h.actions().length,1);pending.resolve({...initial(kind),source:'regie',revision:'revision-2'});await wait(50);assert.equal(h.actions().length,1);h.close();
 }
});

test('a production host allowlist remains visible even when the saved preference is live',async t=>{
 const h=harness(t,'resend',async()=>({...initial('resend'),environment:'production',deliveryMode:'live',deliveryEnabled:true,hostPolicy:{mode:'allowlist',limited:true}}));await h.mount();assert(h.document.body.textContent.includes('Mailverzending is beperkt tot de vrijgegeven testadressen'));assert(!h.document.body.textContent.includes('Mailverzending is vrijgegeven. Controleer'));assert(h.document.body.textContent.includes('Alleen de vooraf vrijgegeven adressen kunnen mail ontvangen'));
});
