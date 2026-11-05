import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import {fakeLiveSocket} from './gpt-live-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {CHARACTER_IDS,ALL_CHARACTER_IDS,CHARACTERS,LIVE_VOICES,normaliseCharacterSettings} from '../server/characters.js';
import {handleCharacterSettings as verifiedhandleCharacterSettings,CharacterSettingsStore} from '../server/character-settings.js';
import {handleOpenAI as verifiedhandleOpenAI} from '../server/openai.js';
import {defaultPlan,normalizePlan,planIssues,createBlock} from '../server/plan-model.js';
import {brandDefaults} from '../server/show-brands.js';

const migration=await readFile(new URL('../drizzle/0008_character_settings.sql',import.meta.url),'utf8');
function setup(){
 const db=new DatabaseSync(':memory:');db.exec(migration);const clips=new Map();
 const statement=(sql,args=[])=>({bind:(...args)=>statement(sql,args),first:async()=>db.prepare(sql).get(...args)||null});
 return {db,clips,env:{VLAMPIE_ADMIN_EMAIL:'owner@example.test',VLAMPIE_SETTINGS_KEY:'00'.repeat(32),DB:{prepare:sql=>statement(sql)},OPENAI_API_KEY:'test-only-not-a-real-key',SETTINGS:{get:async key=>clips.has(key)?{body:clips.get(key)}:null,put:async(key,value)=>clips.set(key,value),head:async key=>clips.has(key)?{}:null}}};
}
function req(path='/api/characters',{method='GET',body,user='owner-1',extra={}}={}){return new Request('https://studio.example'+path,{method,headers:{'oai-authenticated-user-id':user,'oai-authenticated-user-email':'owner@example.test',origin:'https://studio.example','content-type':'application/json','x-milo-characters':'1',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const noFetch=()=>{throw new Error('Must not make a paid upstream request');};
test('the twelve cast roles have distinct genuine voice identities and Vlampie remains separate',()=>{
 assert.equal(CHARACTER_IDS.length,12);assert.equal(ALL_CHARACTER_IDS.length,13);assert(!CHARACTER_IDS.includes('vlampie'));
 assert.equal(new Set(CHARACTER_IDS.map(id=>CHARACTERS[id].voice)).size,12);assert.equal(CHARACTERS.vlampie.voice,'ballad');
 for(const id of CHARACTER_IDS){assert(LIVE_VOICES.includes(CHARACTERS[id].voice));assert.equal(CHARACTERS[id].brandId,'milo');assert.equal(CHARACTERS[id].asset,`/assets/milo-friends/characters/${id}.png`);}
 assert.throws(()=>normaliseCharacterSettings('milo',{apiKey:'forbidden'}),/globale koppeling/);assert.throws(()=>normaliseCharacterSettings('milo',{speed:5}),/Spreektempo/);assert.throws(()=>normaliseCharacterSettings('milo',{voice:'invented'}),/stem/);
});
test('settings are durable, per-owner, and a stale tab cannot overwrite a newer cast revision',async()=>{
 const {db,env}=setup();const first=await(await handleCharacterSettings(req(),env)).json();assert.equal(first.revision,0);assert.equal(first.characters.length,13);assert.equal(first.globalKey,true);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM show_character_settings').get().n,0);
 const response=await handleCharacterSettings(req('/api/characters/stella',{method:'PUT',body:{revision:0,settings:{voice:'cedar',speed:.9,persona:'Ik ben Stella, een warm en dromerig hertje.',catchphrases:['De sterren luisteren mee.']}}}),env);assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.revision,1);assert.equal(saved.character.revision,1);
 const loaded=await(await handleCharacterSettings(req('/api/characters/stella'),env)).json();assert.equal(loaded.character.voice,'cedar');assert.equal(loaded.character.speed,.9);assert.deepEqual(loaded.character.catchphrases,['De sterren luisteren mee.']);assert.equal(loaded.characters.find(c=>c.id==='milo').voice,'verse');
 assert.equal((await handleCharacterSettings(req('/api/characters/milo',{method:'PUT',body:{revision:0,settings:{speed:1.1}}}),env)).status,409);
 assert.equal((await(await handleCharacterSettings(req('/api/characters/stella',{user:'owner-2'}),env)).json()).character.voice,'shimmer');
 assert.equal(JSON.stringify(loaded).includes(env.OPENAI_API_KEY),false);db.close();
});
test('owner identity, same origin and a dedicated write header protect cast preferences',async()=>{
 const {db,env}=setup();const body={revision:0,settings:{}};
 assert.equal((await handleCharacterSettings(req('/api/characters',{user:''}),env)).status,401);
 assert.equal((await handleCharacterSettings(req('/api/characters',{extra:{'oai-authenticated-user-email':'guest@example.test'}}),env)).status,403);
 assert.equal((await handleCharacterSettings(req('/api/characters/milo',{method:'PUT',body,extra:{origin:'https://elsewhere.example'}}),env)).status,403);
 assert.equal((await handleCharacterSettings(req('/api/characters/milo',{method:'PUT',body,extra:{'x-milo-characters':''}}),env)).status,403);
 assert.equal((await handleCharacterSettings(req('/api/characters/forged'),env)).status,404);
 assert.equal((await handleCharacterSettings(req(),{...env,DB:null})).status,503);db.close();
});
test('invalid settings never write a record or permit a per-character API secret',async()=>{
 const {db,env}=setup();for(const settings of [{key:'do-not-store'},{voice:'imaginary'},{idleMotion:'yes'},{gestureEnergy:101},{catchphrases:Array(13).fill('Too many')},{persona:'x'.repeat(4001)}])assert.equal((await handleCharacterSettings(req('/api/characters/milo',{method:'PUT',body:{settings,revision:0}}),env)).status,400);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM show_character_settings').get().n,0);db.close();
});
test('speech uses the saved character voice and the existing single global key; cache isolates revisions',async()=>{
 const {db,env,clips}=setup();const store=new CharacterSettingsStore(env.DB);await store.save('owner-1','milo',{voice:'cedar',style:'Warm en verwonderd.',speed:.92},0);
 let calls=0;const mock=async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/live/sessions');assert.equal(options.headers.Authorization,'Bearer '+env.OPENAI_API_KEY);return fakeLiveSocket({onStart:session=>{assert.equal(session.model,'gpt-live-1');assert.equal(session.audio.output.voice,'cedar');assert.match(session.instructions,/Milo Magico/);assert.match(session.instructions,/Warm en verwonderd/);assert.match(session.instructions,/0.92/);}});};
 const request=()=>req('/api/openai/speech',{method:'POST',body:{characterId:'milo',text:'Hallo allemaal!',voice:'forged'}});
 const first=await handleOpenAI(request(),env,mock);assert.equal(first.status,200);assert.equal(first.headers.get('x-milo-character'),'milo');assert.equal(calls,1);assert.equal(clips.size,1);
 const second=await handleOpenAI(request(),env,noFetch);assert.equal(second.status,200);assert.equal(second.headers.get('x-vlampie-cached'),'1');
 await store.save('owner-1','milo',{pronunciation:'Milo: Mie-lo.'},1);assert.equal((await handleOpenAI(request(),env,mock)).status,200);assert.equal(calls,2);assert.equal(clips.size,2);db.close();
});
test('an unknown character or missing durable cast store cannot spend upstream credit',async()=>{
 const {db,env}=setup();assert.equal((await handleOpenAI(req('/api/openai/speech',{method:'POST',body:{characterId:'unknown',text:'Hallo'}}),env,noFetch)).status,400);
 assert.equal((await handleOpenAI(req('/api/openai/speech',{method:'POST',body:{characterId:'milo',text:'Hallo'}}),{...env,DB:null},noFetch)).status,503);db.close();
});
test('new Milo shows include two magic cues, retain game rounds, and optional cast data survives normalization',()=>{
 const original=defaultPlan(),copy=brandDefaults(original,'milo');copy.cohostId='stella';const result=normalizePlan(copy);
 assert.equal(original.blocks.some(b=>b.type==='magic'),false);assert.equal(result.leadId,'milo');assert.equal(result.cohostId,'stella');assert.equal(normalizePlan(original).cohostId,null);assert.equal(result.studioId,'sterrenplein');assert.deepEqual(result.blocks.filter(b=>b.type==='magic').map(b=>b.magicId),['star-hat','silk-stars']);assert.equal(result.blocks.filter(b=>b.type==='round').length,original.blocks.filter(b=>b.type==='round').length);assert.deepEqual(planIssues(result),[]);
 const guest=createBlock('guest',copy);copy.blocks.push(guest);const normal=normalizePlan(copy);assert.equal(normal.blocks.at(-1).dialogue[0].speakerId,'kora');assert.equal(normal.blocks.at(-1).guestId,'kora');assert.equal(normal.blocks.at(-1).camera,'entrance');
 const bad=structuredClone(copy);bad.blocks.at(-1).dialogue[0].speakerId='forged';assert.throws(()=>normalizePlan(bad),/spreker/);
 assert.equal(brandDefaults(defaultPlan(),'vlampie').blocks.some(b=>b.type==='magic'),false);
});

function handleCharacterSettings(request,env,...args){return verifiedhandleCharacterSettings(request,verifiedTestEnvironment(request,env),...args);}
function handleOpenAI(request,env,...args){return verifiedhandleOpenAI(request,verifiedTestEnvironment(request,env),...args);}
