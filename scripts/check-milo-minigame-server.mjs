import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {MINIGAMES,minigamesForBrand,enabledMinigameIds,gameSettings,makeGame,activateBlock} from '../server/bingo-model.js';
import {brandGameName} from '../server/show-brands.js';
import {handleBingo as verifiedhandleBingo} from '../server/bingo.js';
import {fixture} from './live-calls-fixture.mjs';

const games=['plingo','ribbons','mirrors','potion','butterfly'];
const miloOnly=games.slice(1);
test('new Milo games are available only to Milo while legacy selections remain intact',()=>{
 assert.equal(MINIGAMES.length,16);assert.equal(minigamesForBrand('milo').length,16);
 for(const brand of ['vlampie','rocco',undefined]){
  assert.equal(minigamesForBrand(brand).length,12);
  for(const id of miloOnly){assert(!minigamesForBrand(brand).some(g=>g.id===id));assert.throws(()=>gameSettings({minigames:[id]},brand),/productie/);}
 }
 for(const id of games){assert(minigamesForBrand('milo').some(g=>g.id===id));assert.deepEqual(gameSettings({minigames:[id]},'milo').minigames,[id]);}
 assert(gameSettings({},'milo').minigames.includes('butterfly'));
 assert(!gameSettings().minigames.includes('butterfly'));
 assert.deepEqual(gameSettings({minigames:['wheel','gifts']},'milo').minigames,['wheel','gifts']);
 for(const value of [[],['unknown'],['ribbons','unknown'],'ribbons',null])assert.throws(()=>gameSettings({minigames:value},'milo'));
 assert.equal(brandGameName(MINIGAMES.find(g=>g.id==='plingo'),'milo'),'Milo’s Sterrenplingo');
 for(const id of miloOnly)assert(!/Vlampie|Rocco/.test(brandGameName(MINIGAMES.find(g=>g.id===id),'milo')));
 const older={brandId:'milo',settings:{minigames:['wheel','plingo']}};assert.deepEqual(enabledMinigameIds(older),['wheel','plingo']);assert.deepEqual(older.settings.minigames,['wheel','plingo']);
 const foreign={brandId:'vlampie',settings:{minigames:['butterfly','plingo']}};assert.deepEqual(enabledMinigameIds(foreign),['plingo']);assert.deepEqual(foreign.settings.minigames,['butterfly','plingo']);
});

test('new shows use their brand defaults without expanding an explicitly saved game pool',()=>{
 const input={date:'2026-11-11T13:30',roundCount:1};
 for(const brandId of ['milo','vlampie','rocco']){
  const game=makeGame({...input,brandId},'host','https://studio.example');
  assert.deepEqual(game.settings.minigames,minigamesForBrand(brandId).map(g=>g.id));
 }
 const selected=makeGame({...input,brandId:'milo',settings:{minigames:['plingo']}},'host','https://studio.example');assert.deepEqual(selected.settings.minigames,['plingo']);
 assert.throws(()=>makeGame({...input,brandId:'vlampie',settings:{minigames:['potion']}},'host','https://studio.example'),/productie/);
});

test('every chosen Milo game persists one authoritative tied-bingo result and never changes cards or drawn balls',async t=>{
 for(const id of games)await t.test(id,async t=>{
  const h=await fixture(t);
  await h.bingo.mutate(h.game.id,{},g=>{
   activateBlock(g,g.plan.blocks.findIndex(b=>b.type==='round'));
   g.settings.minigames=[id];g.state.drawn=[7,13,27];
   g.state.window={id:'equal-'+id,status:'open',startedAt:1,endsAt:2,frozenAt:3,epoch:g.state.epoch,announcements:[],claims:g.books.map(b=>({id:crypto.randomUUID(),bookId:b.id,accountId:b.accountId,profileId:b.profileId,name:b.name,ticket:b.ticket,status:'valid',completeAt:3,at:1}))};
   g.state.phase='window';
  });
  const before=(await h.bingo.game(h.game.id)).data;
  const read=()=>handleBingo(h.req('host',undefined,{path:'/api/bingo/games/'+h.game.id}),h.env);
  const response=await read(),payload=await response.json();assert.equal(response.status,200,JSON.stringify(payload));
  const after=(await h.bingo.game(h.game.id)).data,result=after.results.at(-1);
  assert.equal(result.minigame,id);assert.equal(result.entrants.length,2);assert(result.entrants.some(e=>e.bookId===result.winner.bookId));
  assert.equal(after.state.resultId,result.id);assert.equal(after.state.phase,'result');assert.equal(result.acknowledged,false);
  assert.deepEqual(after.books,before.books);assert.deepEqual(after.state.drawn,before.state.drawn);
  await read();const reloaded=(await h.bingo.game(h.game.id)).data;assert.equal(reloaded.results.length,after.results.length);assert.deepEqual(reloaded.results.at(-1),result,'Reloading cannot reroll the winner or change its reveal');
 });
});

test('raffle retry keeps its winner and brand switch removes only future foreign game choices',async t=>{
 const h=await fixture(t);await h.bingo.mutate(h.game.id,{},g=>g.settings.minigames=['potion']);
 const body={regieId:h.ids.host,requestId:'milo-raffle-once',prize:'De magische toverdoos'},path='/api/bingo/games/'+h.game.id+'/raffle';
 const request=()=>handleBingo(h.req('host',body,{path}),h.env);
 assert.equal((await request()).status,200);const after=(await h.bingo.game(h.game.id)).data,result=structuredClone(after.results.at(-1));
 assert.equal(result.minigame,'potion');assert.equal((await request()).status,200);
 assert.deepEqual((await h.bingo.game(h.game.id)).data.results,after.results);
 const response=await handleBingo(h.req('host',{regieId:h.ids.host,brandId:'vlampie'},{path:'/api/bingo/games/'+h.game.id+'/brand'}),h.env);assert.equal(response.status,200);
 const switched=(await h.bingo.game(h.game.id)).data;assert(!switched.settings.minigames.some(id=>miloOnly.includes(id)));
 assert.deepEqual(switched.results.at(-1),result,'An explicit production switch must not rewrite an existing reveal or winner');
 assert.deepEqual(switched.books,after.books);assert.deepEqual(switched.state.drawn,after.state.drawn);
 const me=await handleBingo(h.req('host',undefined,{path:'/api/bingo/me'}),h.env);assert.equal((await me.json()).minigames.length,12);
 const miloMe=await handleBingo(new Request('https://studio.example/api/bingo/me?brand=milo',{headers:{'oai-authenticated-user-id':'host','oai-authenticated-user-email':'host@example.test'}}),h.env);assert.equal((await miloMe.json()).minigames.length,16);
});

function handleBingo(request,env,...args){return verifiedhandleBingo(request,verifiedTestEnvironment(request,env),...args);}
