import {importLegacyFixture} from './legacy-fixture-bundle.mjs';
import {enableLitDomCompatibility} from './dom-lit-compat.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {createRehearsal,demoStart,demoDraw,demoClaim,demoSettle,demoAdvance,DEMO_KEY} from '../public/studio-hub-model.js';
import {activeGoal,completionIndex} from '../server/bingo-model.js';
const d=createRehearsal();demoStart(d);const book=d.game.books[0];
while(completionIndex(book.cards[0],activeGoal(d.game).pattern,d.game.state.drawn)===null)demoDraw(d);
assert.equal(demoClaim(d,book.id).status,'valid');const count=d.game.state.drawn.length;
assert.throws(()=>demoDraw(d));assert.equal(demoSettle(d,d.game.state.window.endsAt-1),null);
assert(demoSettle(d,d.game.state.window.endsAt));assert.equal(d.game.state.phase,'result');
demoAdvance(d);assert.equal(d.game.state.goalIndex,1);assert.equal(d.game.state.drawn.length,count);assert.equal(new Set(d.game.state.drawn).size,count);
const bad=createRehearsal();demoStart(bad);assert.equal(demoClaim(bad,bad.game.books[0].id).status,'false');assert.throws(()=>demoClaim(bad,bad.game.books[1].id),/afkoel/);
const {window}=parseHTML(readFileSync('scripts/fixtures/legacy-hub.html','utf8'));
for(const k of ['window','document','customElements','HTMLElement','Element','Document','ShadowRoot','CSSStyleSheet','Event','CustomEvent','Node'])if(window[k])globalThis[k]=window[k];
enableLitDomCompatibility(document,customElements);
const location={pathname:'/',search:'?demo=1',hash:'',origin:'https://example.test',href:'https://example.test/?demo=1'};
globalThis.location=location;window.location=location;window.scrollTo=()=>{};globalThis.addEventListener=window.addEventListener.bind(window);globalThis.removeEventListener=window.removeEventListener.bind(window);
const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
globalThis.setInterval=()=>1;globalThis.clearInterval=()=>{};globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;window.HTMLElement.prototype.focus=function(){};
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(value){for(const o of this.querySelectorAll('option'))o.toggleAttribute('selected',o.value===value);}});
const NativeFormData=globalThis.FormData;globalThis.FormData=class extends NativeFormData{constructor(form){super();if(form)for(const el of form.querySelectorAll('input,select,textarea'))if(el.name&&!el.disabled)this.append(el.name,el.value||'');}};
let writes=0;globalThis.fetch=async()=>{writes++;throw Error('Unexpected network request in rehearsal');};
await importLegacyFixture('public/studio-hub.js');const hub=document.querySelector('studio-hub');
const tick=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setTimeout(r,1));await hub.updateComplete;};await tick();assert(hub.game);assert.equal(hub.error,'');assert(document.querySelector('.hero-card'),JSON.stringify({route:hub.route,loading:hub.loading,error:hub.error,html:hub.innerHTML.slice(-4000)}));assert(values.has(DEMO_KEY));
for(const route of ['shows','prepare','books','library','settings','analysis','live','player','overview']){hub.go(route);await tick();assert(document.querySelector('#main').textContent.trim().length>100,route);}
hub.go('prepare');for(const tab of ['draaiboek','rondes','regels','check']){hub.tab=tab;await tick();assert(!hub.error,tab);}
for(const modal of ['create','generate','block','prize','book','link','claim','demo-person','demo-link','reset']){hub.modal=modal;await tick();assert(document.querySelector('[role=dialog]'),JSON.stringify({modal,property:hub.modal,pending:hub.isUpdatePending,tail:hub.innerHTML.slice(-1800)}));assert(document.querySelector('#modal-title').textContent,modal);hub.modal='';await tick();}
hub.go('live');await tick();let start=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Start oefenshow'));assert(start);start.click();await tick();assert.equal(hub.game.status,'running');
let draw=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Volgende bal'));draw.click();await tick();assert.equal(hub.game.state.drawn.length,1);assert(document.querySelector('.stage-number strong').textContent!=='–');
hub.go('player');hub.playerTab='boekjes';await tick();const cell=document.querySelector('.play-card button');assert(cell);cell.click();await tick();assert(document.querySelector('.play-card button').classList.contains('marked'));assert.equal(writes,0);
hub.modal='demo-person';await tick();const form=document.querySelector('.modal form');form.querySelector('[name=name]').value='Testkind';form.querySelector('[name=age]').value='8';form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await tick();assert(hub.game.books.some(b=>b.name==='Testkind'));
// The real mode lists actual data, saves only on explicit action and uses the existing game endpoint.
const real=createRehearsal().game;real.books=[];real.batches=[];real.status='draft';const req=[];
globalThis.fetch=async(url,options={})=>{req.push({url,options});if(url==='/api/bingo/games')return Response.json({games:[hub.summary(real)]});if(url==='/api/bingo/games/'+real.id){if(options.method==='PUT'){const body=JSON.parse(options.body);assert.equal(body.settings.claimSeconds,45);return Response.json({game:{...real,...body}});}return Response.json({game:real});}throw Error('Unexpected URL '+url);};
hub.demo=false;hub.dirty=false;hub.draft=null;await hub.load();await tick();assert.equal(hub.game.id,real.id);assert(req.every(r=>r.options.method==='GET'));hub.edit().settings.claimSeconds=45;await hub.save();await tick();assert.equal(hub.game.settings.claimSeconds,45);assert(req.some(r=>r.options.method==='PUT'));assert(!hub.dirty);assert.equal(hub.error,'');
console.log('Studio V2: all workspaces, dossier tabs, modal rendering, rehearsal isolation, unique draws, valid/false bingo, 30-second window, pattern continuation, card marking, player creation and explicit real API save passed.');
