import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {parseHTML} from 'linkedom';
import {ShowPlanner} from '../public/show-planner.js';
import {handlePlanner as verifiedhandlePlanner} from '../server/planner.js';
const html=await fs.readFile(new URL('./fixtures/legacy-studio.html',import.meta.url),'utf8'),migration=await fs.readFile(new URL('../drizzle/0000_broad_gravity.sql',import.meta.url),'utf8');
async function setup(){
 const {document,window}=parseHTML(html);globalThis.document=document;globalThis.matchMedia=()=>({matches:false});
 // Linkedom omits the native select.value setter; emulate that browser primitive.
 const proto=window.HTMLSelectElement.prototype,descriptor=Object.getOwnPropertyDescriptor(proto,'value');if(!descriptor.set)Object.defineProperty(proto,'value',{configurable:true,get:descriptor.get,set(value){for(const option of this.options)option.selected=option.value===String(value);}});
 const db=new DatabaseSync(':memory:');db.exec(migration);const images=new Map();const env={VLAMPIE_ADMIN_EMAIL:'owner@example.test',DB:{prepare:sql=>({bind:(...args)=>({first:async()=>db.prepare(sql).get(...args)||null})})},SETTINGS:{put:async(key,value,options)=>{images.set(key,{value,options});},get:async key=>{const row=images.get(key);return row?{body:row.value,httpMetadata:row.options.httpMetadata}:null;}}};
 let writeDelay=null;globalThis.fetch=async(url,options={})=>{if(options.method==='PUT'&&writeDelay){const wait=writeDelay;writeDelay=null;await wait;}return handlePlanner(new Request('https://studio.example'+url,{...options,headers:{...options.headers,Origin:'https://studio.example','oai-authenticated-user-id':'owner-ui','oai-authenticated-user-email':'owner@example.test'}}),env);};
 const notices=[],planner=new ShowPlanner({onNotice:message=>notices.push(message)});await planner.loading;
 const fire=(selector,name,props={})=>{const el=typeof selector==='string'?document.querySelector(selector):selector;assert(el,selector);const event=new window.Event(name,{bubbles:true,cancelable:true});Object.assign(event,props);el.dispatchEvent(event);return event;};
 const input=(selector,value)=>{document.querySelector(selector).value=value;fire(selector,'input');};
 return {document,window,planner,db,images,env,fire,input,notices,delayNextWrite(){let release;writeDelay=new Promise(resolve=>release=resolve);return release;},close(){clearTimeout(planner.timer);db.close();}};
}
test('widgets can be inserted by click and drag, reordered, copied, and configured in the inspector',async()=>{
 const h=await setup(),p=h.planner;assert(p.ready);assert.equal(h.document.querySelectorAll('.timeline-step').length,7);assert.equal(h.document.querySelectorAll('.widget-card').length,11);
 // The Milo handover adds story, magic and guest cues to the original eight widgets.
 for(const kind of ['story','magic','guest'])assert(h.document.querySelector(`[data-widget="${kind}"]`));
 h.fire('[data-widget="pause"]','click');assert.equal(p.document.blocks.at(-1).type,'pause');h.input('[data-field="title"]','Kruidnotenpauze');h.input('[data-field="duration"]','2');assert.equal(p.document.blocks.at(-1).seconds,120);
 const id=p.document.blocks.at(-1).id;h.fire(`[data-block-id="${id}"] [data-block-action="up"]`,'click');assert.equal(p.document.blocks.at(-2).id,id);h.fire(`[data-block-id="${id}"] [data-block-action="copy"]`,'click');assert.equal(p.document.blocks.filter(b=>b.title==='Kruidnotenpauze').length,2);
 let slot=h.document.querySelector('.timeline-drop');h.document.elementFromPoint=()=>slot;const transfer={setData(){}};h.fire('[data-widget="countdown"]','dragstart',{dataTransfer:transfer});h.fire('#planner-flow','dragover',{clientX:10,clientY:10,dataTransfer:transfer});h.fire('#planner-flow','drop',{clientX:10,clientY:10});assert.equal(p.document.blocks[0].type,'countdown');
 h.document.querySelector('#page-voorbereiding').getBoundingClientRect=()=>({top:0,bottom:900});slot=h.document.querySelector('.timeline-drop');h.fire('[data-widget="welcome"]','pointerdown',{pointerType:'touch',pointerId:3,clientX:0,clientY:0});h.fire('[data-widget="welcome"]','pointermove',{pointerId:3,clientX:30,clientY:30});h.fire('[data-widget="welcome"]','pointerup',{pointerId:3,clientX:30,clientY:30});assert.equal(p.document.blocks[0].type,'welcome');
 await p.flush();assert.equal(p.revision,1);h.close();
});
test('a custom pattern and prize upload can be saved and linked to a round',async()=>{
 const h=await setup(),p=h.planner;h.fire('#pattern-new','click');h.input('#pattern-name','De letter V');for(const n of [0,4,6,8])h.fire(`[data-cell="${n}"]`,'click');h.fire('#pattern-form','submit');await p.flush();const pattern=p.document.patterns.at(-1);assert.equal(pattern.title,'De letter V');assert.deepEqual(pattern.cells,[0,4,6,8]);
 h.fire('#prize-new','click');h.input('#catalog-prize-title','Een bordspel');h.input('#catalog-prize-description','Een spel voor het hele gezin.');
 const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1cAAAAASUVORK5CYII=','base64'));const file=new File([png],'prijs.png',{type:'image/png'});Object.defineProperty(h.document.querySelector('#prize-upload'),'files',{configurable:true,value:[file]});globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});await p.uploadPrize();assert.equal(h.images.size,1);assert.match(p.prizeDraft.image,/^\/api\/planner\/images\//);h.fire('#prize-form','submit');await p.flush();const prize=p.document.prizes.at(-1);assert.equal(prize.title,'Een bordspel');
 const round=p.document.blocks.find(b=>b.type==='round');h.fire(`[data-select-block="${round.id}"]`,'click');h.document.querySelector('[data-goal-field="patternId"]').value=pattern.id;h.fire('[data-goal-field="patternId"]','change');h.document.querySelector('[data-goal-field="prizeId"]').value=prize.id;h.fire('[data-goal-field="prizeId"]','change');await p.flush();assert.equal(round.goals[0].patternId,pattern.id);assert.equal(round.goals[0].prizeId,prize.id);assert(h.document.querySelector(`[data-block-id="${round.id}"]`).textContent.includes('De letter V'));
 h.fire('#pattern-delete','click');assert(p.document.patterns.some(x=>x.id===pattern.id));assert.match(h.document.querySelector('#pattern-status').textContent,/gebruikt/);h.close();
});
test('edits made during a save are serialized and cannot be lost by the earlier response',async()=>{
 const h=await setup(),p=h.planner;h.input('#planner-title','Eerste wijziging');const release=h.delayNextWrite(),saving=p.flush();h.input('#planner-title','Laatste wijziging');release();await saving;assert.equal(p.revision,2);assert.equal(p.dirty,false);const row=h.db.prepare('SELECT document FROM show_workspaces').get();assert.equal(JSON.parse(row.document).title,'Laatste wijziging');h.close();
});
test('a conflicting tab preserves its own draft until the saved version is explicitly loaded',async()=>{
 const h=await setup(),p=h.planner;await p.flush();const remote=structuredClone(p.document);remote.title='Andere regie';const response=await handlePlanner(new Request('https://studio.example/api/planner/document',{method:'PUT',headers:{Origin:'https://studio.example','oai-authenticated-user-id':'owner-ui','oai-authenticated-user-email':'owner@example.test','x-vlampie-planner':'1','Content-Type':'application/json'},body:JSON.stringify({document:remote,revision:1})}),h.env);assert.equal(response.status,200);
 h.input('#planner-title','Mijn eigen tekst');await assert.rejects(p.flush());assert.equal(p.document.title,'Mijn eigen tekst');assert(p.conflict);assert(!p.ready);assert.equal(h.document.querySelector('#planner-alert').hidden,false);await p.load();assert.equal(p.document.title,'Andere regie');assert(p.ready);h.close();
});

function handlePlanner(request,env,...args){return verifiedhandlePlanner(request,verifiedTestEnvironment(request,env),...args);}
