import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame} from '../server/bingo-model.js';
import {normalizePlan,planIssues,createBlock} from '../server/plan-model.js';
import {premierePlan} from '../server/premiere-plan.js';
import {addMissingRandomCalls,callRundownSummary} from '../server/call-rundown.js';
import {showAudioScripts} from '../server/show-audio-manifest.js';
import {CHARACTER_IDS} from '../server/characters.js';
import {LIVE_CALL_LINES} from '../public/live-call-script.js';

const game=brandId=>makeGame({brandId,title:'Fictieve belrepetitie',date:'2027-01-01T12:00:00Z',roundCount:4},'fictional-owner','https://example.invalid');
test('new standard Milo and premiere have two movable calls after rounds one and three, with all winner switches initially off',()=>{
 for(const plan of [game('milo').plan,premierePlan()]){
  const summary=callRundownSummary(plan);assert.equal(summary.randomCount,2);assert(summary.randomReady);assert(summary.winnerRounds.every(r=>!r.enabled));
  for(const [slot,block] of plan.blocks.filter(b=>b.type==='random-call').entries()){
   const index=plan.blocks.indexOf(block);assert.equal(plan.blocks[index-1].type,'round');assert.equal(plan.blocks.slice(0,index).filter(b=>b.type==='round').length,slot===0?1:3);
  }
  assert.deepEqual(planIssues(plan),[]);
 }
 for(const roundCount of [1,2,5,8])assert.equal(callRundownSummary(makeGame({brandId:'milo',date:'2027-01-01T12:00:00Z',roundCount},'fictional-owner','https://example.invalid').plan).randomCount,2);
});
test('reading an existing draft never inserts calls, explicit add is idempotent and never overwrites existing content',()=>{
 const plan=game('milo').plan;plan.blocks=plan.blocks.filter(b=>b.type!=='random-call');const before=structuredClone(plan);
 assert.equal(normalizePlan(plan).blocks.filter(b=>b.type==='random-call').length,0);
 const added=addMissingRandomCalls(plan);assert.equal(added.length,2);assert.deepEqual(plan.blocks.filter(b=>b.type!=='random-call'),before.blocks);
 assert.deepEqual(addMissingRandomCalls(plan),[]);assert.equal(plan.blocks.filter(b=>b.type==='random-call').length,2);
});
test('winner switches survive normalization and the server rejects a third random block',()=>{
 const plan=game('milo').plan,rounds=plan.blocks.filter(b=>b.type==='round');rounds[1].callFullCardWinner=true;rounds[3].callFullCardWinner=false;
 const normalized=normalizePlan(plan);assert.equal(normalized.blocks.find(b=>b.id===rounds[1].id).callFullCardWinner,true);assert.equal(normalized.blocks.find(b=>b.id===rounds[3].id).callFullCardWinner,false);
 plan.blocks.push(createBlock('random-call',plan,'milo'));assert(planIssues(plan).some(issue=>/twee/.test(issue)));
 const vlampie=game('vlampie');assert.equal(vlampie.plan.blocks.filter(b=>b.type==='random-call').length,0);assert.throws(()=>createBlock('random-call',vlampie.plan,'vlampie'));
});
test('all fixed magic-call lines are in the existing explicit preparation manifest for every permitted Milo presenter',()=>{
 const milo=game('milo'),scripts=showAudioScripts(milo),staticCalls=scripts.filter(s=>s.kind==='live-call');
 for(const characterId of CHARACTER_IDS)for(const [key,text]of Object.entries(LIVE_CALL_LINES))assert(staticCalls.some(s=>s.characterId===characterId&&s.id===key&&s.text===text));
 assert.equal(staticCalls.length,CHARACTER_IDS.length*Object.keys(LIVE_CALL_LINES).length);assert(!JSON.stringify(staticCalls).includes('fictional-owner'));
 assert.equal(showAudioScripts(game('vlampie')).filter(s=>s.kind==='live-call').length,0);
 for(const block of milo.plan.blocks.filter(b=>b.type==='random-call'))assert(scripts.some(s=>s.kind==='call-fallback'&&s.id===block.id));
});
