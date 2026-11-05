import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import {handlePlanner as verifiedhandlePlanner} from '../server/planner.js';
import {defaultPlan} from '../server/plan-model.js';

const migration=await fs.readFile(new URL('../drizzle/0000_broad_gravity.sql',import.meta.url),'utf8');
function setup(){
 const db=new DatabaseSync(':memory:');db.exec(migration);const images=new Map();
 const env={VLAMPIE_ADMIN_EMAIL:'owner@example.test',DB:{prepare:sql=>({bind:(...args)=>({first:async()=>db.prepare(sql).get(...args)||null})})},SETTINGS:{put:async(key,value,options)=>{images.set(key,{value,options});},get:async key=>{const row=images.get(key);return row?{body:row.value,httpMetadata:row.options.httpMetadata}:null;}}};
 return {env,db,images};
}
function request(route,{method='GET',body,user='owner-1',extra={}}={}){
 return new Request('https://studio.example/api/planner/'+route,{method,headers:{'oai-authenticated-user-id':user,'oai-authenticated-user-email':'owner@example.test',Origin:'https://studio.example','x-vlampie-planner':'1','Content-Type':'application/json',...extra},...(body===undefined?{}:{body:typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body)})});
}
test('show data persists in SQLite and stale tabs cannot overwrite a newer preparation',async()=>{
 const {env,db}=setup();const initial=await(await handlePlanner(request('document'),env)).json();assert.equal(initial.revision,0);assert(initial.document.blocks.length>0);
 const plan=defaultPlan();plan.title='Onze bingo';plan.patterns.push({id:'custom-v',title:'De letter V',cells:[0,4,6,8,12],freeCenter:true,variant:'fixed'});plan.prizes[0].description='Een eigen prijsomschrijving';
 const save=await handlePlanner(request('document',{method:'PUT',body:{document:plan,revision:0}}),env);assert.equal(save.status,200);assert.equal((await save.json()).revision,1);
 const stale=await handlePlanner(request('document',{method:'PUT',body:{document:defaultPlan(),revision:0}}),env);assert.equal(stale.status,409);
 const reload=await(await handlePlanner(request('document'),env)).json();assert.equal(reload.document.title,'Onze bingo');assert.equal(reload.document.patterns.at(-1).title,'De letter V');assert.equal(reload.document.prizes[0].description,'Een eigen prijsomschrijving');
 plan.blocks.reverse();assert.equal((await handlePlanner(request('document',{method:'PUT',body:{document:plan,revision:1}}),env)).status,200);assert.equal((await(await handlePlanner(request('document'),env)).json()).revision,2);
 assert.equal((await(await handlePlanner(request('document',{user:'owner-2'}),env)).json()).revision,0);db.close();
});
test('owner identity, origin and write header are required before accessing preparation data',async()=>{
 const {env,db}=setup();assert.equal((await handlePlanner(request('document',{user:''}),env)).status,401);assert.equal((await handlePlanner(request('document',{extra:{'oai-authenticated-user-email':'someone@example.test'}}),env)).status,403);assert.equal((await handlePlanner(request('document',{method:'PUT',body:{},extra:{Origin:'https://other.example'}}),env)).status,403);assert.equal((await handlePlanner(request('document',{method:'PUT',body:{},extra:{'x-vlampie-planner':''}}),env)).status,403);assert.equal((await handlePlanner(request('document'),{...env,DB:undefined})).status,503);db.close();
});
test('invalid patterns, arbitrary image links and oversized documents are rejected without writing',async()=>{
 const {env,db}=setup();for(const alter of [p=>p.patterns[0].cells.push(50),p=>p.blocks.push(p.blocks[0]),p=>p.prizes[0].image='https://outside.example/image.png',p=>p.blocks[1].text='a'.repeat(501)]){const plan=defaultPlan();alter(plan);assert.equal((await handlePlanner(request('document',{method:'PUT',body:{document:plan,revision:0}}),env)).status,400);}
 assert.equal((await handlePlanner(request('document',{method:'PUT',body:'x'.repeat(300000)}),env)).status,400);assert.equal(db.prepare('SELECT COUNT(*) AS count FROM show_workspaces').get().count,0);db.close();
});
test('prize images persist separately and are accessible only within their owner namespace',async()=>{
 const {env,db,images}=setup();const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1cAAAAASUVORK5CYII=','base64'));
 const upload=await handlePlanner(request('images',{method:'POST',body:png,extra:{'Content-Type':'image/png'}}),env);assert.equal(upload.status,201);const data=await upload.json(),route=data.image.replace('/api/planner/','');assert.equal(images.size,1);
 const image=await handlePlanner(request(route),env);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(new Uint8Array(await image.arrayBuffer()),png);
 assert.equal((await handlePlanner(request(route,{user:'owner-2'}),env)).status,404);
 assert.equal((await handlePlanner(request('images',{method:'POST',body:new Uint8Array([1,2,3]),extra:{'Content-Type':'image/png'}}),env)).status,400);assert.equal((await handlePlanner(request('images',{method:'POST',body:'<svg></svg>',extra:{'Content-Type':'image/svg+xml'}}),env)).status,400);db.close();
});

function handlePlanner(request,env,...args){return verifiedhandlePlanner(request,verifiedTestEnvironment(request,env),...args);}
