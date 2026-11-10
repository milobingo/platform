import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
import {makeGame,generateBooks} from '../server/bingo-model.js';
import {bindingRules,rulesContract} from '../server/game-rules.js';
import {PreparationAutosave} from '../frontend/show-preparation.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const named=(node,name)=>[...node.querySelectorAll('button')].find(button=>button.textContent===name);
const forbidden=node=>[...node.querySelectorAll('button')].filter(button=>/publiceer|vastzetten|draaiboek opslaan|wijzigingen opslaan/i.test(button.textContent));
let bundle;
async function ui(t){
 const {window}=parseHTML('<!doctype html><html><body><div id="root"></div></body></html>'),errors=[];
 if(!bundle)bundle=(await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import ShowPreparation,{PreparationStatus,PreparationStart} from './frontend/ShowPreparation.jsx';const root=createRoot(document.getElementById('root'));window.renderTest=(kind,s,operator,callbacks={})=>flushSync(()=>root.render(<><input aria-label="Bewaarde invoer" readOnly value={s.game.plan.blocks.find(block=>block.type==='welcome')?.text||''}/>{kind==='status'?<PreparationStatus s={s} operator={operator} run={fn=>Promise.resolve(fn()).catch(window.testError)}/>:kind==='start'?<PreparationStart s={s} operator={operator} run={fn=>Promise.resolve(fn()).catch(window.testError)} {...callbacks}/>:<ShowPreparation s={s} operator={operator} run={fn=>Promise.resolve(fn()).catch(window.testError)} {...callbacks}/>}</>));window.closeTest=()=>flushSync(()=>root.unmount());`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',loader:{'.css':'empty'},logLevel:'warning',plugins:[{name:'stage-boundary',setup(builder){builder.onLoad({filter:/frontend\/components\.jsx$/},({path})=>{const source=readFileSync(path,'utf8'),a=source.indexOf('export function Stage('),z=source.indexOf('export function Pattern(',a);return {loader:'jsx',contents:source.slice(0,a)+'export function Stage(){return <div/>;}\n'+source.slice(z)};});}}]})).outputFiles[0].text;
 const context={window,document:window.document,navigator:{userAgent:'simple-preparation-qa'},console,setTimeout,clearTimeout,setInterval,clearInterval,performance,queueMicrotask,TextEncoder,TextDecoder,URL,URLSearchParams,crypto,structuredClone};context.self=context;context.globalThis=context;window.testError=error=>errors.push(error);vm.runInNewContext(bundle,context);
 const h={window,document:window.document,errors,render(kind,s,operator,callbacks){window.renderTest(kind,s,operator,callbacks);},click(node){assert(node,'Requested control must exist');node.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));},async settle(){await tick();await tick();},input(){return window.document.querySelector('input[aria-label="Bewaarde invoer"]').value;}};
 t.after(()=>window.closeTest());return h;
}
function snapshot({ready=true,roundCount=4}={}){
 const game=makeGame({brandId:'milo',title:'Eenvoudig voorbereiden',date:'2027-01-01T18:00:00Z',roundCount},'host','https://studio.example');
 if(ready){generateBooks(game,1,'ui-preparation-books');game.books[0].accountId='family';game.books[0].name='Noor';}
 return {game,production:'milo',demo:false,dirty:false,preparation:{status:'saved',error:'',conflict:false},working:false,loading:false,serverStatusVerified:true,runner:{active:false},apiStatus:{configured:true},voiceMode:'ai',outputConnected:false};
}
function operatorFor(s){return {game:s.game,runner:{active:false},bridge:{preparationStatus:{gameId:s.game.id,connected:false,audioActivated:false},connect:async()=>{},testSound:async()=>{}},flushPreparation:async()=>{},emit(){},start:async()=>{},resumeRegie:async()=>{},loadStandardRules:async()=>{}};}

test('Milo shows one preparation route, all ten shared price steps and a quiet rules preview without manual save or publication',async t=>{
 const h=await ui(t),s=snapshot(),operator=operatorFor(s);h.render('show',s,operator);
 const nav=h.document.querySelector('nav[aria-label="Show voorbereiden"]');assert(nav);assert.deepEqual([...nav.querySelectorAll('button')].map(button=>button.textContent.replace(/^\d/,'')),['Voorbereiden','Uitzending testen','Start show']);
 assert.equal(h.document.querySelectorAll('.mf-standard-rounds>section').length,4);assert.equal(h.document.querySelectorAll('.mf-standard-rounds li').length,10);assert.equal((h.document.querySelector('.mf-standard-rounds').textContent.match(/Eén volle rij is geen bingo/g)||[]).length,3);
 for(const rule of bindingRules(rulesContract(s.game)))assert(h.document.querySelector('.mf-rules-preview').textContent.includes(rule.text));assert.equal(forbidden(h.document).length,0);assert.equal(h.errors.length,0);
 h.click(named(nav,'3Start show'));await h.settle();assert(h.document.querySelector('[data-rules-state="readonly"]'));assert.match(h.document.querySelector('[data-rules-state="readonly"]').textContent,/automatisch vastgelegd/);assert.equal(h.document.querySelector('[data-check="rules"][data-status="blocked"]'),null);assert.equal(forbidden(h.document).length,0);
});

test('a real failed autosave keeps every input and is retried only by the explicit retry control',async t=>{
 const h=await ui(t),s=snapshot();s.game.plan.blocks.find(block=>block.type==='welcome').text='Alle eigen invoer blijft staan.';let fail=true,writes=0;
 const operator=operatorFor(s),render=()=>h.render('status',s,operator),autosave=new PreparationAutosave({read:()=>s.game,persist:async(game,revision)=>{writes++;if(fail)throw Error('Opslag tijdelijk niet bereikbaar.');return {game:{...game,preparationRevision:revision+1}};},apply:result=>{s.game=operator.game=result.game;},schedule:()=>0,cancel(){},onChange(){s.preparation=autosave.state;s.dirty=autosave.state.dirty;render();}});t.after(()=>autosave.dispose());operator.retryPreparation=()=>autosave.flush();
 autosave.mark();assert.match(h.document.querySelector('[data-save-status]').textContent,/Opslaan…/);await assert.rejects(autosave.flush());await h.settle();assert.equal(writes,1);assert.equal(h.input(),'Alle eigen invoer blijft staan.');assert.match(h.document.querySelector('[data-save-status]').textContent,/Niet opgeslagen/);assert(named(h.document,'Opnieuw proberen'));
 render();await h.settle();assert.equal(writes,1,'Rendering an error must not silently retry writes');h.click(named(h.document,'Opnieuw proberen'));await h.settle();assert.equal(writes,2);assert.equal(h.input(),'Alle eigen invoer blijft staan.');assert.equal(h.errors.length,1);
 fail=false;h.click(named(h.document,'Opnieuw proberen'));await h.settle();assert.equal(writes,3);assert.equal(h.input(),'Alle eigen invoer blijft staan.');assert.equal(h.document.querySelector('[data-save-status]').getAttribute('data-save-status'),'saved');assert.match(h.document.querySelector('[data-save-status]').textContent,/Opgeslagen/);assert.equal(named(h.document,'Opnieuw proberen'),undefined);
});

test('a conflicting draft is replaced only after the explicit second confirmation and cancel preserves its input',async t=>{
 const h=await ui(t),s=snapshot();s.game.plan.blocks.find(block=>block.type==='welcome').text='Mijn lokale tekst';s.dirty=true;s.preparation={status:'error',error:'Een ander venster heeft de voorbereiding gewijzigd.',conflict:true};const operator=operatorFor(s);let replacements=0,retries=0;
 const render=()=>h.render('status',s,operator);operator.retryPreparation=async()=>{retries++;};operator.loadSavedPreparation=async()=>{replacements++;s.game.plan.blocks.find(block=>block.type==='welcome').text='Versie op de server';s.preparation={status:'saved'};s.dirty=false;render();};render();
 assert.equal(h.input(),'Mijn lokale tekst',h.document.querySelector('input').outerHTML);assert.equal(named(h.document,'Mijn wijzigingen vervangen'),undefined);assert.equal(replacements,0);h.click(named(h.document,'Opgeslagen versie bekijken'));await h.settle();assert.match(h.document.body.textContent,/Kopieer eerst de tekst die je wilt bewaren/);assert.equal(replacements,0);assert.equal(h.input(),'Mijn lokale tekst');
 h.click(named(h.document,'Annuleren'));await h.settle();assert.equal(named(h.document,'Mijn wijzigingen vervangen'),undefined);assert.equal(h.input(),'Mijn lokale tekst');assert.equal(replacements,0);
 h.click(named(h.document,'Opgeslagen versie bekijken'));await h.settle();h.click(named(h.document,'Mijn wijzigingen vervangen'));await h.settle();assert.equal(replacements,1);assert.equal(retries,0);assert.equal(h.input(),'Versie op de server');assert.equal(h.errors.length,0);
});

test('a dirty start invokes one preparation-aware action and never asks for a separate save or publication',async t=>{
 const h=await ui(t),s=snapshot(),operator=operatorFor(s);s.dirty=true;s.preparation={status:'saving'};const actions=[];operator.start=async()=>{actions.push('start');};operator.post=async action=>{actions.push(action);};h.render('start',s,operator,{onStarted:()=>actions.push('opened-live')});
 const start=named(h.document,'Start show');assert(start);assert.equal(start.disabled,false);assert.equal(forbidden(h.document).length,0);h.click(start);await h.settle();assert.deepEqual(actions,['start','opened-live']);assert.equal(h.errors.length,0);
});

test('standard rules are offered only for an unbound deviating concept and never overwrite a running show',async t=>{
 const h=await ui(t),s=snapshot({ready:false,roundCount:1}),operator=operatorFor(s);let conversions=0;operator.loadStandardRules=async()=>{conversions++;};h.render('show',s,operator);assert(named(h.document,'Standaardregels laden'));assert.equal(conversions,0);h.click(named(h.document,'Standaardregels laden'));await h.settle();assert.equal(conversions,1);
 s.game.status='running';h.render('show',s,operator);await h.settle();assert.equal(named(h.document,'Standaardregels laden'),undefined);assert.equal(conversions,1);assert.equal(forbidden(h.document).length,0);
});

test('Hervat regie remains available for an existing window or call hold and uses the recovery action without start',async t=>{
 const h=await ui(t),s=snapshot(),operator=operatorFor(s),actions=[];s.game.status='running';s.serverStatusVerified=false;s.game.state.window={status:'open'};s.game.state.drawHold={id:'call-hold'};s.game.state.paused=true;operator.start=async()=>actions.push('start');operator.resumeRegie=async()=>actions.push('resume-regie');h.render('start',s,operator,{onStarted:()=>actions.push('opened-live')});
 const resume=named(h.document,'Hervat regie');assert(resume);assert.equal(resume.disabled,false);h.click(resume);await h.settle();assert.deepEqual(actions,['resume-regie','opened-live']);assert.equal(s.game.state.paused,true);assert.equal(s.game.state.window.status,'open');assert.equal(s.game.state.drawHold.id,'call-hold');assert.equal(h.errors.length,0);
});

test('Uitzending testen separates connection, actual audio and the operator OBS checks and provides both capture routes',async t=>{
 const h=await ui(t),s=snapshot(),operator=operatorFor(s),actions=[];operator.flushPreparation=async()=>actions.push('flush');operator.bridge.connect=async()=>actions.push('connect');operator.bridge.testSound=async()=>actions.push('test-sound');h.render('show',s,operator,{onOpenOutput:id=>actions.push('open:'+id)});
 h.click(named(h.document.querySelector('nav'),'2Uitzending testen'));await h.settle();assert.equal(h.document.querySelectorAll('.mf-broadcast-checks>li').length,3);assert(named(h.document,'Open uitzendvenster'));assert(named(h.document,'Kopieer OBS-link'));assert(named(h.document,'Speel testgeluid'));assert.match(h.document.body.textContent,/OBS → Bronnen → rechtsklik → Interactie → Beeld & geluid activeren/);assert.match(h.document.body.textContent,/Vensteropname/);assert.match(h.document.body.textContent,/Toepassingsaudio vastleggen/);assert.equal(h.document.body.textContent.includes('OBS door jou gecontroleerd:'),false);
 h.click(named(h.document,'Speel testgeluid'));await h.settle();assert.deepEqual(actions,['flush','connect','test-sound']);assert.equal(h.document.body.textContent.includes('OBS door jou gecontroleerd:'),false);assert.equal(h.errors.length,0);
});

test('Milo preparation status cannot appear in the separate Vlampie environment',async t=>{
 const h=await ui(t),s=snapshot(),operator=operatorFor(s);s.production='vlampie';s.game.brandId='vlampie';s.preparation={status:'error',error:'Milo only',conflict:true};h.render('status',s,operator);assert.equal(h.document.querySelector('[data-save-status]'),null);assert.equal(h.document.body.textContent.includes('Milo only'),false);
});
