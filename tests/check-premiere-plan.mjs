import {test} from 'node:test';
import assert from 'node:assert/strict';
import {premierePlan,PREMIERE_TITLE,PREMIERE_DATE} from '../server/premiere-plan.js';
import {planIssues,normalizePlan} from '../server/plan-model.js';
import {makeGame,generateBooks,activateBlock,playerGame} from '../server/bingo-model.js';
import {rulesContract} from '../server/game-rules.js';
import {patternRequirement} from '../server/standard-show.js';
import {showAudioScripts} from '../server/show-audio-manifest.js';

test('attachment becomes an independent usable four-card programme with ten official prize steps',()=>{
 const plan=premierePlan(),second=premierePlan(),rounds=plan.blocks.filter(b=>b.type==='round');
 assert.deepEqual(planIssues(plan),[]);assert.equal(plan.blocks.length,28);assert.equal(plan.leadId,'milo');assert.equal(plan.studioId,'sterrenplein');
 assert.deepEqual(rounds.map(b=>b.goals.length),[3,3,3,1]);assert.ok(rounds.every(b=>b.newBoard&&b.interval===15));
 assert.ok(plan.blocks.every(b=>!second.blocks.some(other=>other.id===b.id)));
 assert.equal(plan.blocks[0].seconds,60);assert.equal(plan.blocks[17].seconds,90);
 assert.equal(plan.blocks[18].guestId,'piko');assert.deepEqual(plan.blocks[18].dialogue.map(t=>t.speakerId),['piko','milo','piko','milo','piko']);
 assert.equal(plan.blocks[10].magicId,'star-hat');assert.equal(plan.blocks[23].magicId,'silk-stars');
 assert.deepEqual(plan.blocks.filter(b=>b.type==='magic').map(b=>b.duration),[14,15]);
 assert.equal(plan.blocks[26].type,'finale');assert.equal(plan.blocks[27].showCueId,'curtain-call');assert.equal(plan.blocks[27].duration,10);
 assert.deepEqual(plan.blocks[5].explanationSteps.map(step=>step.patternId),['patroon-hoeken','patroon-boven-onder','patroon-vol']);
 assert.equal(plan.blocks[5].explanationSteps.map(step=>step.text).join(' '),plan.blocks[5].text);
 for(const [index,round]of rounds.entries())assert.deepEqual(round.goals.map(g=>g.patternId),index===3?['patroon-vol']:['patroon-hoeken','patroon-boven-onder','patroon-vol']);
 assert.match(patternRequirement(plan.patterns.find(p=>p.id==='patroon-boven-onder')),/Eén volle rij is geen bingo/);
 assert.equal(normalizePlan(plan).manualCues.length,20);
});

test('ten goal/card bindings and private operator instructions survive real game creation and four fresh boards',()=>{
 const plan=premierePlan(),game=makeGame({title:PREMIERE_TITLE,date:PREMIERE_DATE,timeZone:'Europe/Amsterdam',brandId:'milo',plan,roundCount:4,settings:{mode:'auto',rulesProfile:'milo-standard-v1'}},'attachment-fixture','https://fixture.invalid');
 generateBooks(game,1,'attachment-card-fixture');
 assert.equal(game.books[0].cards.length,4);assert.equal(game.date,'2026-12-02T12:30:00.000Z');
 const contract=rulesContract(game);assert.equal(contract.rounds.length,4);assert.deepEqual(contract.rounds.map(r=>r.goals.length),[3,3,3,1]);
 const rounds=game.plan.blocks.map((b,i)=>b.type==='round'?i:-1).filter(i=>i>=0);
 for(const [index,blockIndex]of rounds.entries()){
  game.state.drawn=[1,2,3];activateBlock(game,blockIndex,0);assert.deepEqual(game.state.drawn,[]);assert.equal(game.state.roundIndex,index);
  if(index<3){game.state.drawn=[1,2,3];activateBlock(game,blockIndex,1);assert.deepEqual(game.state.drawn,[1,2,3]);}
 }
 const scripts=showAudioScripts(game);for(const cue of plan.manualCues)assert.ok(scripts.some(s=>s.kind==='manual'&&s.id===cue.id));
 const feed=JSON.stringify(playerGame(game,'unrelated-family'));
 assert.ok(!feed.includes('operatorNotes'));assert.ok(!feed.includes('manualCues'));assert.ok(!feed.includes(plan.blocks[2].operatorNotes));
 assert.ok(!scripts.some(s=>s.text.includes('REGIE:')));
});
