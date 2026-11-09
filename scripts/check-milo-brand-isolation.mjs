import {gameRequestFixture} from './game-request-fixture.mjs';
import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {repairLegacyPlanBrand,brandGameDescription,brandProfile} from '../server/show-brands.js';
import {createBlock,BLOCK_TYPES,blockSummary} from '../server/plan-model.js';
import {makeGame,defaultGamePlan,generateBooks,MINIGAMES} from '../server/bingo-model.js';
import {productionSettings,playerProduction} from '../server/production-model.js';
import {handleBingo as verifiedhandleBingo} from '../server/bingo.js';
import {BingoStore} from '../server/bingo-store.js';
import {DatabaseSync} from 'node:sqlite';
import {activateBlock} from '../server/bingo-model.js';

const oldPlan=()=>defaultGamePlan(4);
test('legacy Milo stock cues migrate without changing cue IDs/order, rounds, books or custom Vlampie appearances',async()=>{
 const g=makeGame({brandId:'milo',timeZone:'Europe/Amsterdam',date:'2026-11-01T14:00',roundCount:4},'host','https://studio.example');
 g.plan=oldPlan();g.production={revision:2,memory:{enabled:true,message:'Wat fijn dat jij erbij was. Tot de volgende Vlampie’s Bingo!'}};generateBooks(g,2,'original-books');
 g.plan.blocks.push({id:'my-custom-story',type:'story',title:'Vlampie is vandaag te gast',text:'Milo heeft Vlampie uitgenodigd om bij ons te komen kijken.',speakerId:'milo',hold:2});
 g.plan.blocks.push({id:'guest-says-hello',type:'welcome',title:'Welkom bij Vlampie',text:'Hallo allemaal! Welkom bij Vlampie’s Bingo. Pak je kaart erbij, we maken er een gezellige show van!',speakerId:'vlampie',hold:2});
 g.plan.blocks.push({id:'custom-welcome',type:'welcome',title:'Welkom bij Vlampie',text:'Milo maakt vandaag een uitstapje naar Vlampie. Dat is speciaal voor hem bedacht.',speakerId:'milo',hold:2});
 const before=structuredClone(g),row={id:g.id,owner_id:'host',revision:3,document:JSON.stringify(g)};
 const env={VLAMPIE_ADMIN_EMAIL:'host@example.test',DB:{prepare:()=>({bind:()=>({first:async()=>row})})}};
 const response=await handleBingo(new Request('https://studio.example/api/bingo/games/'+g.id,{headers:{'oai-authenticated-user-id':'host','oai-authenticated-user-email':'host@example.test'}}),env);
 assert.equal(response.status,200);const {game}=await response.json();
 assert.equal(game.plan.blocks.find(b=>b.id==='blok-welkom').title,'Welkom bij Milo & Friends');
 assert(!game.plan.blocks.find(b=>b.id==='blok-welkom').text.includes('Vlampie'));
 assert(game.plan.blocks.filter(b=>b.type==='pause').every(b=>b.title==='Magische pauze'));
 assert.equal(game.plan.leadId,'milo');assert.equal(game.plan.studioId,'sterrenplein');
 assert.deepEqual(game.plan.blocks.map(b=>b.id),before.plan.blocks.map(b=>b.id));
 assert.deepEqual(game.plan.blocks.filter(b=>b.type==='round'),before.plan.blocks.filter(b=>b.type==='round'));
 assert.deepEqual(game.plan.patterns,before.plan.patterns);assert.deepEqual(game.plan.prizes,before.plan.prizes);assert.deepEqual(game.books,before.books);
 for(const id of ['my-custom-story','guest-says-hello','custom-welcome'])assert.deepEqual(game.plan.blocks.find(b=>b.id===id),before.plan.blocks.find(b=>b.id===id));
 assert.deepEqual(g,before,'read compatibility must not rewrite stored game objects');
 assert.equal(game.production.memory.message,'Wat fijn dat jij erbij was. Tot de volgende Milo & Friends BingoShow!');
 assert.deepEqual(repairLegacyPlanBrand(game.plan,'milo'),game.plan,'migration is idempotent');
});

test('new/reloaded Milo cues use active production and selected character; Vlampie stays original',()=>{
 const original=oldPlan(),repaired=repairLegacyPlanBrand(original,'milo');
 const g=makeGame({brandId:'milo',timeZone:'Europe/Amsterdam',date:'2026-11-01T14:00',roundCount:4,plan:original},'host','https://studio.example');
 assert.equal(g.plan.leadId,'milo');assert(!g.plan.blocks.some(b=>b.title==='Welkom bij Vlampie'||b.title==='Pakjespauze'));
 assert(createBlock('welcome',repaired).text.includes('Milo & Friends BingoShow'));
 assert.equal(createBlock('call',{...repaired,leadId:'stella'},'milo').text,'Tijd voor een gezellig moment met Stella!');
 assert.equal(createBlock('call',{},'milo').text,'Tijd voor een gezellig moment met Milo!');
 assert.equal(createBlock('call',original,'vlampie').text,'Tijd voor een gezellig moment met Vlampie!');
 assert(createBlock('welcome',original,'vlampie').text.includes('Vlampie’s Bingo'));
 assert.deepEqual(repairLegacyPlanBrand(original,'vlampie'),original);
 assert(Object.values(BLOCK_TYPES).every(b=>!b.description.includes('Vlampie')));
 assert(!blockSummary({type:'story',text:''},repaired).includes('Vlampie'));
});

test('Milo production templates are separate while custom memory and profile text stay intact',()=>{
 const legacy='Wat fijn dat jij erbij was. Tot de volgende Vlampie’s Bingo!',custom='Bedankt Vlampie voor je gastbezoek!';
 assert.equal(productionSettings(undefined,'vlampie').memory.message,legacy);
 assert.equal(productionSettings({memory:{message:custom}},'milo').memory.message,custom);
 const g={brandId:'milo',timeZone:'Europe/Amsterdam',date:'2026-11-01T14:00',status:'draft',participation:[],production:{memory:{message:legacy}}};
 assert(playerProduction(g,'family').memory.message.includes('Milo & Friends'));
 assert.equal(brandProfile({brandId:'milo',name:'Vlampie Grand Show'},'milo').name,'Milo & Friends · Sterrenplein');
 assert.equal(brandProfile({brandId:'milo',name:'Vlampie komt op bezoek',prompt:'Een speciaal verhaal over Vlampie'},'milo').name,'Vlampie komt op bezoek');
 for(const game of MINIGAMES){const d=brandGameDescription(game,'milo');assert(!/Vlampie|kruidnoten|pakjesboot|schoorsteen/i.test(d));assert.equal(brandGameDescription(game,'vlampie'),game.description);}
});

test('shared store interprets Milo defaults without GET writes; a real mutation logs canonical title and retains card identities',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE bingo_games (id TEXT PRIMARY KEY, owner_id TEXT, revision INTEGER, document TEXT, updated_at INTEGER)');
 const stmt=(sql,args=[])=>({bind:(...args)=>stmt(sql,args),first:async()=>db.prepare(sql).get(...args)||null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:db.prepare(sql).run(...args)})}),store=new BingoStore({prepare:sql=>stmt(sql)});
 try{
  const game=makeGame({brandId:'milo',timeZone:'Europe/Amsterdam',date:'2026-11-01T14:00',roundCount:4},'host','https://studio.example');game.plan=oldPlan();generateBooks(game,2,'canonical-preserve');await store.create(game);
  const rawBefore=db.prepare('SELECT document FROM bingo_games WHERE id=?').get(game.id).document,bookBefore=structuredClone(game.books),roundsBefore=structuredClone(game.plan.blocks.filter(b=>b.type==='round')),idsBefore=game.plan.blocks.map(b=>b.id);
  const read=(await store.game(game.id)).data;assert.equal(read.plan.blocks[1].title,'Welkom bij Milo & Friends');assert.equal(db.prepare('SELECT document FROM bingo_games WHERE id=?').get(game.id).document,rawBefore,'GET must not silently update persistent state');
  const updated=(await store.mutate(game.id,{},g=>activateBlock(g,1))).game;
  assert.equal(updated.events.at(-1).title,'Welkom bij Milo & Friends');assert.deepEqual(updated.plan.blocks.map(b=>b.id),idsBefore);assert.deepEqual(updated.books,bookBefore);assert.deepEqual(updated.plan.blocks.filter(b=>b.type==='round'),roundsBefore);
  const stored=JSON.parse(db.prepare('SELECT document FROM bingo_games WHERE id=?').get(game.id).document);assert.equal(stored.plan.blocks[1].title,'Welkom bij Milo & Friends');assert.equal(stored.revision,2);
  const vlampie=makeGame({timeZone:'Europe/Amsterdam',date:'2026-11-01T14:00'},'host','https://studio.example');await store.create(vlampie);assert.deepEqual((await store.game(vlampie.id)).data,vlampie);
 }finally{db.close();}
});

function handleBingo(request,env,...args){return gameRequestFixture(verifiedhandleBingo,request,verifiedTestEnvironment(request,env),...args);}
