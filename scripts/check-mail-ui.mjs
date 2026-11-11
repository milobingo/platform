// Real React mail workspace + browser-only demo. No mail provider is called.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {mailDemoRequest,mailDemoState,getDemoMailPreferences,setDemoMailPreferences} from '../frontend/mail-demo.js';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handleMailAPI} from '../server/mail-api.js';
import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import {MailStore} from '../server/mail-store.js';
import {BingoStore} from '../server/bingo-store.js';
import {makeGame} from '../server/bingo-model.js';

const storage=()=>{const map=new Map();return {getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key),clear:()=>map.clear(),map};};
globalThis.localStorage=storage();
let providerCalls=0;globalThis.fetch=async()=>{providerCalls++;throw Error('Provider access forbidden in mail UI checks');};
assert.equal(mailDemoState('milo').settings.newsletterEnabled,true);
assert.equal(getDemoMailPreferences('milo','parent-one').subscribed,false,'Module availability must never imply newsletter consent');
setDemoMailPreferences('milo','parent-one',true);
assert.equal(mailDemoState('milo').audience.subscribed,19);
assert.equal(mailDemoState('vlampie').audience.subscribed,18,'Brands cannot share consent');
let draft=mailDemoState('milo').campaigns[0];
let prepared=(await mailDemoRequest('/campaigns/'+draft.id+'/prepare',{method:'POST',body:{brandId:'milo',revision:draft.revision}})).campaign;
assert.equal(prepared.stats.total,19);
await assert.rejects(mailDemoRequest('/campaigns/'+draft.id+'/send',{method:'POST',body:{brandId:'milo'}}),/Bevestig/);
setDemoMailPreferences('milo','parent-one',false);
while(prepared.stats.pending)prepared=(await mailDemoRequest('/campaigns/'+draft.id+'/send',{method:'POST',body:{brandId:'milo',confirm:true}})).campaign;
assert.equal(prepared.stats.skipped,1,'A prepared audience must recheck a later unsubscribe');
assert.equal(prepared.stats.accepted,18);
assert.equal(providerCalls,0,'No demo action may send a real mail');
localStorage.clear();

const root=fileURLToPath(new URL('..',import.meta.url));
const bundle=(await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import CommunicationWorkspace from './frontend/CommunicationWorkspace.jsx';let root=createRoot(document.getElementById('root'));window.qaRender=props=>{root??=createRoot(document.getElementById('root'));flushSync(()=>root.render(React.createElement(CommunicationWorkspace,props)));};window.qaClose=()=>{flushSync(()=>root?.unmount());root=null;};window.qaRender(window.qaProps);`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',loader:{'.css':'empty'},logLevel:'warning'})).outputFiles[0].text;
const {window}=parseHTML('<!doctype html><html><body><div id="root"></div></body></html>'),{document}=window;
document.oninput=null;const timers=new Set(),frames=new Map(),errors=[],requests=[];let frame=0;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const timeout=(fn,ms,...args)=>{const t=setTimeout(()=>{timers.delete(t);fn(...args);},ms);timers.add(t);return t;};
window.HTMLElement.prototype.focus=function(){document._active=this;};window.HTMLElement.prototype.getClientRects=()=>[{width:900,height:700}];window.HTMLElement.prototype.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:900,bottom:700,width:900,height:700});Object.defineProperty(document,'activeElement',{get:()=>document._active||document.body});
const raf=fn=>{frames.set(++frame,fn);return frame;},cancel=id=>frames.delete(id),observer=class{observe(){}unobserve(){}disconnect(){}},computed=()=>new Proxy({getPropertyValue:()=>'',transform:'none',opacity:'1',display:'block',visibility:'visible'},{get:(target,key)=>target[key]??''}),matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
Object.assign(window,{requestAnimationFrame:raf,cancelAnimationFrame:cancel,getComputedStyle:computed,matchMedia});
const demoStorage=storage(),sessionStorage=storage();
let backend=null,backendSends=0,db=null,stateTransport=null;
const context={window,document,console:{...console,error:(...args)=>errors.push(args.map(String).join(' '))},setTimeout:timeout,clearTimeout,requestAnimationFrame:raf,cancelAnimationFrame:cancel,performance,queueMicrotask,crypto:globalThis.crypto,structuredClone,URL,AbortController,AbortSignal,Response,localStorage:demoStorage,sessionStorage,navigator:{userAgent:'mail-ui-test'},location:{pathname:'/',origin:'https://handoff.invalid'},HTMLElement:window.HTMLElement,SVGElement:window.SVGElement,Element:window.Element,Node:window.Node,Event:window.Event,ResizeObserver:observer,IntersectionObserver:observer,getComputedStyle:computed,matchMedia,addEventListener:window.addEventListener.bind(window),removeEventListener:window.removeEventListener.bind(window),dispatchEvent:window.dispatchEvent.bind(window),fetch:async(path,options={})=>{requests.push(String(path));if(stateTransport&&String(path).startsWith('/api/mail/state?'))return stateTransport(path,options);if(backend&&String(path).startsWith('/api/mail/')){const request=new Request('https://handoff.invalid'+path,{...options,headers:{...(options.headers||{}),Origin:'https://handoff.invalid','oai-authenticated-user-id':'host','oai-authenticated-user-email':'host@example.test'}});return handleMailAPI(request,verifiedTestEnvironment(request,backend),async()=>{backendSends++;throw Error('No provider sends allowed in the UI contract test');});}return new Response('',{status:404});}};context.globalThis=context;context.self=context;
window.qaProps={s:{production:'milo',demo:true,game:{id:'demo-game',title:'Milo’s show',timeZone:'Europe/Amsterdam',date:'2026-11-18T12:30:00Z'},games:[]},engine:{}};
const text=()=>document.body.textContent;
const button=label=>[...document.querySelectorAll('button')].find(el=>el.getAttribute('aria-label')===label||el.textContent.trim()===label);
const event=(node,type='click')=>{assert(node,'Missing '+type+' target');node.dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true}));};
const click=async label=>{const node=button(label);assert(node,'Missing button: '+label);assert(!node.disabled,'Disabled button: '+label);event(node);await wait(25);};
const stored=()=>JSON.parse(demoStorage.getItem('milo-mail-workspace-demo-v1:milo'));
try{
 vm.runInNewContext(bundle,context,{filename:'mail-ui-bundle.js'});await wait(70);
 assert(text().includes('Fictieve voorbeeldgezinnen'));
 assert.equal(document.querySelectorAll('.cm-template-list>button').length,17);
 const preview=document.querySelector('iframe');assert(preview);assert.equal(preview.getAttribute('sandbox'),'');assert((preview.srcDoc||preview.getAttribute('srcDoc')||preview.getAttribute('srcdoc')||'').includes('<base target="_blank">'),'Preview links cannot navigate the live application');
 const enabled=document.querySelector('.cm-toggle input');assert(enabled.disabled,'Security mail must remain enabled');
 const urlField=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Link van de knop'));assert(urlField.querySelector('input').disabled,'Transactional CTA must retain its authoritative link');
 const booksButton=[...document.querySelectorAll('.cm-template-list>button')].find(b=>b.textContent.includes('Bingobladen staan klaar'));event(booksButton);await wait(30);
 const field=label=>[...document.querySelectorAll('.cm-form label')].find(l=>l.querySelector('input')&&l.querySelector('span')?.textContent===label)?.querySelector('input');
 const typeInput=async(node,value)=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(node,value);event(node,'input');await wait(25);};
 await typeInput(field('Onderwerp'),'{{voornaam}}, jullie bingobladen staan klaar!');await click('Template opslaan');await wait(30);assert(button('Template opslaan').disabled,'Saving a changed subject must clear dirty state');
 await typeInput(field('Kop in de mail'),'Een beetje magie voor {{gezinsnaam}}');await click('Template opslaan');await wait(30);assert(button('Template opslaan').disabled,'Saving a second changed field must clear dirty state');
 await typeInput(field('Kop in de mail'),'Nog meer magie voor ');const titleField=field('Kop in de mail');titleField.selectionStart=titleField.value.length;titleField.selectionEnd=titleField.value.length;event(titleField,'focusin');const chip=[...document.querySelectorAll('.cm-shortcodes button')].find(b=>b.querySelector('code')?.textContent==='{{gezinsnaam}}');event(chip);await wait(25);assert(field('Kop in de mail').value.includes('{{gezinsnaam}}'));await click('Template opslaan');await wait(30);assert(button('Template opslaan').disabled,'Saving after shortcode insertion must clear dirty state regardless of object-key order');
 await click('Acties & triggers');assert.equal(document.querySelectorAll('.cm-automation-row').length,17);assert(text().includes('Na bevestigde publicatie door de regie'));
 await click('Nieuwsbrieven');const campaignButton=[...document.querySelectorAll('.cm-campaign-list>button')].find(b=>b.textContent.includes('Een nieuwe show vol verwondering'));event(campaignButton);await wait(35);
 await click('Ontvangers klaarzetten');assert.equal(stored().campaigns[0].status,'prepared');assert.equal(stored().campaigns[0].stats.accepted,0);
 await click('Verzending controleren');const confirm=button('Campagne simuleren');assert(confirm.disabled,'Opening a confirmation must not authorize sending');assert.equal(stored().campaigns[0].stats.accepted,0);
 const checkbox=document.querySelector('.cm-check input');checkbox.checked=true;event(checkbox);await wait(20);assert(!button('Campagne simuleren').disabled);
 await click('Campagne simuleren');assert(stored().campaigns[0].stats.accepted>0,'Confirmed campaign should process a first local batch');
 await click('Verzending pauzeren');await wait(450);const count=stored().campaigns[0].stats.accepted;assert.equal(count,5);assert(stored().campaigns[0].stats.pending>0);assert(text().includes('Verder verzenden'));await wait(420);assert.equal(stored().campaigns[0].stats.accepted,count,'Pause must prevent later batches without undoing the current one');
 window.qaClose();await wait(30);window.qaRender(window.qaProps);await wait(70);assert.equal(stored().campaigns[0].stats.accepted,count,'Remount/refresh must not restart a partial campaign');
 assert(requests.every(path=>['/assets/milo-friends/logo.png','/assets/studio-logo.png'].includes(path)),'Demo UI must never request mail/provider APIs');
 // Exercise requests generated by the real non-demo form against the real API,
 // with an ephemeral SQLite/D1 adapter. This catches plain-context versus
 // template-shortcode mismatches that a browser demo alone cannot reveal.
 window.qaClose();await wait(20);db=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const statement=(sql,args=[])=>({sql,args,bind:(...next)=>statement(sql,next),first:async()=>db.prepare(sql).get(...args)||null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:db.prepare(sql).run(...args)})}),objects=new Map();
 backend={VLAMPIE_ADMIN_EMAIL:'host@example.test',VLAMPIE_SETTINGS_KEY:'07'.repeat(32),DB:{prepare:sql=>statement(sql),batch:async rows=>rows.map(r=>/RETURNING|^SELECT/i.test(r.sql)?{results:db.prepare(r.sql).all(...r.args)}:{results:[],meta:db.prepare(r.sql).run(...r.args)})},SETTINGS:{get:async key=>{const value=objects.get(key);return value?{etag:value.etag,json:async()=>JSON.parse(value.data)}:null;},put:async(key,data,options={})=>{const prior=objects.get(key),condition=options.onlyIf;if(condition?.etagDoesNotMatch==='*'&&prior||condition?.etagMatches&&condition.etagMatches!==prior?.etag)return null;const result={etag:crypto.randomUUID(),data};objects.set(key,result);return result;}}};
 const show=makeGame({title:'De echte contractshow',timeZone:'Europe/Amsterdam',date:'2026-11-18T13:30'},'host','https://handoff.invalid');show.brandId='milo';await new BingoStore(backend.DB).create(show);window.qaProps={s:{...window.qaProps.s,demo:false,game:show,games:[show]},engine:{}};sessionStorage.clear();window.qaRender(window.qaProps);await wait(80);await click('Nieuwsbrieven');
 const selectValue=(label,value)=>{const node=[...document.querySelectorAll('.cm-form label')].find(l=>l.querySelector('span')?.textContent===label)?.querySelector('select');assert(node,'Missing select '+label);for(const option of node.querySelectorAll('option'))option.selected=option.value===value;Object.defineProperty(node,'value',{value,writable:true,configurable:true});event(node,'change');};
 for(const type of ['newsletter','show-reminder','show-changed','show-thanks']){
  if(type!=='newsletter')await click('Nieuw');
  selectValue('Soort bericht',type);await wait(25);await typeInput(field('Campagnenaam'),'Contract '+type);
  if(type==='show-changed'){const node=[...document.querySelectorAll('.cm-form label')].find(l=>l.querySelector('span')?.textContent==='Bevestigde wijziging')?.querySelector('textarea');Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(node,'De show begint op het bevestigde tijdstip.');event(node,'input');await wait(20);}
  assert(!button('Concept opslaan').disabled,JSON.stringify({type,error:document.querySelector('.cm-preview-error')?.textContent,notice:document.querySelector('.cm-feedback')?.textContent,fields:[...document.querySelectorAll('.cm-form input')].map(n=>({value:n.value,disabled:n.disabled})),text:document.querySelector('.cm-form textarea')?.value}));await click('Concept opslaan');await wait(60);assert(!document.querySelector('.cm-feedback.error'),document.querySelector('.cm-feedback.error')?.textContent);
  const saved=(await new MailStore(backend.DB).list('campaign','milo')).find(c=>c.name==='Contract '+type);assert(saved,'Actual API failed to store UI-generated '+type+' payload');assert.equal(saved.templateId,type);assert(!saved.newsletterText.includes('{{'),'Plain newsletter content cannot inherit template shortcodes');if(type!=='newsletter')assert.equal(saved.showId,show.id);
 }
 assert.equal(backendSends,0,'Saving real-API campaign concepts must not contact a provider');
 // The broad browser tour starts with no saved shows, so its StudioEngine
 // remains in demo mode. Exercise failed non-demo loads here explicitly: a
 // failed request must never be presented as a search with zero templates.
 const states={};
 for(const brand of ['milo','vlampie']){
  const request=new Request('https://handoff.invalid/api/mail/state?brand='+brand,{headers:{Origin:'https://handoff.invalid','oai-authenticated-user-id':'host','oai-authenticated-user-email':'host@example.test'}});
  const response=await handleMailAPI(request,verifiedTestEnvironment(request,backend));assert.equal(response.status,200);states[brand]=await response.json();assert.equal(states[brand].templates.length,17);
 }
 const defer=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
 const loadAlert=()=>[...document.querySelectorAll('[role="alert"]')].find(node=>node.querySelector('h2')?.textContent==='Je mailtemplates konden niet worden geladen');
 const assertLoadFailure=label=>{assert(loadAlert(),label+': a persistent load-error heading must explain the failure');assert(button('Opnieuw laden'),label+': explicit retry must be available');assert(!document.querySelector('.cm-library'),label+': a failed load must not display a template count');assert(!document.querySelector('.cm-editor'),label+': a failed load must not display an editable template');assert(!text().includes('Geen mail bij deze zoekopdracht'),label+': a transport failure is not a search result');};
 const assertLoaded=brand=>{assert.equal(document.querySelector('.cm-workspace')?.getAttribute('data-mail-brand'),brand);assert.equal(document.querySelectorAll('.cm-template-list>button').length,17);assert(!loadAlert(),'Successful loading must clear the load error');assert(!document.querySelector('.cm-feedback.error'),'Successful loading must clear the old transport message');assert.equal(document.querySelector('.cm-editor>header h2')?.textContent,'Veilig inloggen');assert(document.querySelector('.cm-toggle input')?.disabled,'The Auth template remains mandatory after retry');assert(button('Template opslaan')?.disabled,'The externally managed Auth template cannot become writable after retry');assert(field('Link van de knop')?.disabled,'The Auth CTA remains protected after retry');};
 const remount=async brand=>{window.qaClose();await wait(10);sessionStorage.clear();window.qaProps={s:{...window.qaProps.s,demo:false,production:brand},engine:{}};window.qaRender(window.qaProps);await wait(70);};
 // Stored credentials must not expose a send action when the separately
 // selected delivery policy is off. Legacy snapshots without that field
 // retain their existing configured-provider behavior.
 for(const brand of ['milo','vlampie']){
  stateTransport=()=>Response.json({...states[brand],provider:{...states[brand].provider,configured:true,deliveryEnabled:false,deliveryReason:'Kies een toegestane verzendmodus bij Instellingen.'}});await remount(brand);assertLoaded(brand);assert(button('Testmail').disabled,'An explicitly disabled policy must prevent testmail offers');assert(text().includes('De mailkoppeling is opgeslagen. Verzending staat uit.'));assert(!requests.some(path=>path==='/api/mail/test'));
  stateTransport=()=>Response.json({...states[brand],provider:{...states[brand].provider,configured:true,deliveryEnabled:undefined}});await remount(brand);assert(!button('Testmail').disabled,'Legacy status without a policy flag keeps its existing configured-provider behavior');
 }
 const failures=[['401',()=>Response.json({error:{message:'Log opnieuw in om de mailwerkplek te laden.'}},{status:401})],['503',()=>Response.json({error:{message:'De mailadministratie is tijdelijk niet beschikbaar.'}},{status:503})],['offline',()=>{throw new TypeError('Failed to fetch');}],['invalid-json-200',()=>new Response('<html>Unexpected proxy response</html>')],['missing-fields-200',()=>Response.json({})],['empty-templates-200',brand=>Response.json({...states[brand],templates:[]})]];
 for(const brand of ['milo','vlampie'])for(const [name,reply] of failures){
  stateTransport=()=>reply(brand);await remount(brand);assertLoadFailure(brand+' '+name);
  await click('Acties & triggers');assertLoadFailure(brand+' '+name+' after tab change');await click('Mailtemplates');assertLoadFailure(brand+' '+name+' after returning');
  const pending=defer();stateTransport=()=>pending.promise;await click('Opnieuw laden');assert(document.querySelector('.cm-loading'),'An explicit retry must enter loading');assert(button('Communicatie verversen').disabled,'Refresh must not enqueue a second request while loading');assert(!document.querySelector('.cm-library'),'Retry must not expose the empty template count');
  pending.resolve(Response.json(states[brand]));await wait(70);assertLoaded(brand);
 }
 for(const brand of ['milo','vlampie']){
  stateTransport=()=>Response.json(states[brand]);await remount(brand);assertLoaded(brand);
  const pending=defer();stateTransport=()=>pending.promise;await click('Communicatie verversen');assert(document.querySelector('.cm-loading'),'Header refresh must re-enter loading');assert(button('Communicatie verversen').disabled);pending.resolve(Response.json(states[brand]));await wait(70);assertLoaded(brand);
 }
 // Resolve an old production request even if the transport ignores abort, to
 // prove the component's response scope rather than relying on cancellation.
 for(const outcome of ['success','failure']){
  const old=defer(),current={...states.vlampie,templates:states.vlampie.templates.map(template=>template.id==='auth-code'?{...template,subject:'Vlampie nieuwste snapshot {{inlogcode}}'}:template)};
  stateTransport=path=>new URL('https://handoff.invalid'+path).searchParams.get('brand')==='milo'?old.promise:Response.json(current);
  await remount('milo');assert(document.querySelector('.cm-loading'));window.qaProps={...window.qaProps,s:{...window.qaProps.s,production:'vlampie'}};window.qaRender(window.qaProps);await wait(70);assertLoaded('vlampie');assert.equal(field('Onderwerp').value,'Vlampie nieuwste snapshot {{inlogcode}}');
  if(outcome==='success')old.resolve(Response.json(states.milo));else old.reject(new Error('Late failed Milo response'));await wait(70);assertLoaded('vlampie');assert.equal(field('Onderwerp').value,'Vlampie nieuwste snapshot {{inlogcode}}','An older production response cannot overwrite the current template');
 }
 stateTransport=null;assert.equal(backendSends,0,'Load failures, retries and stale responses must not contact a mail provider');
 assert.equal(errors.filter(e=>!e.includes('act(')).length,0,errors.join('\n'));
 console.log('✓ Mail UI:17 templates, protected Auth/CTA, strict preview sandbox, dirty clearing, campaign confirmation/pause/no restart, four actual UI→API save contracts, both brands failing 401/503/offline/invalid or empty 200 with explicit retry, refresh loading, and late-production response isolation. No mail provider was called.');
}finally{try{window.qaClose();}catch{}for(const timer of timers)clearTimeout(timer);db?.close();}
