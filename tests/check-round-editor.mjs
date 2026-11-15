import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,generateBooks,normalizeBingoPlan,completionIndex} from '../server/bingo-model.js';
import {prepareAutomaticRules,rulesCurrent} from '../server/game-rules.js';
import {roundBlocks,roundEditAccess,addRound,removeRound,moveRound,addRoundGoal,removeRoundGoal,changeRoundGoal,canMoveRoundGoal,moveRoundGoal} from '../frontend/round-editor-model.js';

const game=()=>makeGame({brandId:'milo',title:'Rondes bewerken',date:'2027-12-02T12:30:00Z'},'round-editor-test','https://studio.example');

test('round editor exposes draft changes while showing the actual card, participation and running locks',()=>{
 const value=game();prepareAutomaticRules(value);assert.deepEqual(roundEditAccess(value),{locked:false,rulesBound:false,structureLocked:false,goalsLocked:false,message:''});
 generateBooks(value,1,'round-editor-cards');let access=roundEditAccess(value);assert.equal(access.structureLocked,true);assert.equal(access.goalsLocked,false);assert.match(access.message,/rondekaarten/);
 value.books[0].accountId='family';access=roundEditAccess(value);assert.equal(access.rulesBound,true);assert.equal(access.goalsLocked,true);assert.match(access.message,/bestaande deelnemers/);
 value.status='running';access=roundEditAccess(value);assert.equal(access.locked,true);assert.match(access.message,/live regie/);
 value.status='finished';assert.equal(roundEditAccess(value).locked,true);
 value.status='draft';value.books=[];value.orders=[{status:'cancelled'}];assert.equal(roundEditAccess(value).rulesBound,true,'The rules service also retains cancelled order contracts');
 assert.equal(roundEditAccess(value,{demo:true}).structureLocked,false,'Rehearsal cards do not bind a real game');
 assert.equal(roundEditAccess(value,{runnerActive:true}).locked,true);assert.equal(roundEditAccess(value,{busy:true}).locked,true);
});

test('adding the missing three rounds repairs a one-round draft without overwriting existing scripts, prizes or goals',()=>{
 const value=game(),plan=value.plan,first=roundBlocks(plan)[0];plan.blocks=plan.blocks.filter(block=>block.type!=='round'||block.id===first.id);first.title='Mijn eerste ronde';
 const presentation=structuredClone(plan.blocks.filter(block=>block.type!=='round')),prior=structuredClone(first),prizes=structuredClone(plan.prizes);
 for(let index=0;index<3;index++)addRound(plan,{production:'milo',speakerId:'milo'});
 assert.deepEqual(roundBlocks(plan).map(round=>round.goals.length),[3,3,3,1]);assert.equal(roundBlocks(plan)[3].title,'Finaleronde');assert.deepEqual(roundBlocks(plan)[0],prior);assert.deepEqual(plan.prizes,prizes);assert.deepEqual(plan.blocks.filter(block=>block.type!=='round'),presentation);
 assert.equal(plan.blocks.at(-1).type,'finale');assert(roundBlocks(plan).every(round=>round.newBoard&&round.interval===15));assert.doesNotThrow(()=>normalizeBingoPlan(plan));
 const final=roundBlocks(plan)[3],lastIndex=plan.blocks.indexOf(final);moveRound(plan,final.id,-1);assert.equal(roundBlocks(plan)[2].id,final.id);assert.equal(plan.blocks[lastIndex].id,roundBlocks(plan)[3].id);assert.deepEqual(plan.blocks.filter(block=>block.type!=='round'),presentation);
 removeRound(plan,final.id);assert.equal(roundBlocks(plan).length,3);assert.equal(plan.blocks.some(block=>block.id===final.id),false);assert.doesNotThrow(()=>normalizeBingoPlan(plan));
});

test('all ten price steps still require the intended cells, including both outer rows instead of any single row',()=>{
 const value=game();generateBooks(value,1,'round-editor-ten');let total=0;
 for(const [roundIndex,round] of roundBlocks(value.plan).entries())for(const [goalIndex,goal] of round.goals.entries()){
  const pattern=value.plan.patterns.find(item=>item.id===goal.patternId),card=value.books[0].cards[roundIndex],numbers=pattern.cells.filter(cell=>cell!==12).map(cell=>card[cell]);
  assert.notEqual(completionIndex(card,pattern,numbers),null);assert.equal(completionIndex(card,pattern,numbers.slice(0,-1)),null);total++;
  if(goalIndex===1){assert.equal(pattern.variant,'fixed');assert.equal(completionIndex(card,pattern,card.slice(0,5)),null);assert.equal(completionIndex(card,pattern,card.slice(20)),null);}
 }
 assert.equal(total,10);
});

test('price steps can be added, changed, reordered and removed without creating an invalid full-card sequence',()=>{
 const value=game(),plan=value.plan,round=roundBlocks(plan)[0],full=round.goals.at(-1),added=addRoundGoal(plan,round.id);
 assert.equal(round.goals.at(-1).id,full.id);assert.equal(round.goals.length,4);assert.doesNotThrow(()=>normalizeBingoPlan(plan));
 const index=round.goals.indexOf(added);assert.equal(canMoveRoundGoal(plan,round,added.id,-1),true);moveRoundGoal(plan,round.id,added.id,-1);assert.equal(round.goals.indexOf(added),index-1);
 assert.equal(canMoveRoundGoal(plan,round,full.id,-1),false);assert.throws(()=>moveRoundGoal(plan,round.id,full.id,-1),/laatste prijsstap/);
 changeRoundGoal(plan,round.id,added.id,'prizeId','prijs-hoofdprijs');assert.equal(added.prizeId,'prijs-hoofdprijs');changeRoundGoal(plan,round.id,added.id,'patternId','patroon-diagonaal');assert.equal(added.patternId,'patroon-diagonaal');
 assert.throws(()=>changeRoundGoal(plan,round.id,added.id,'patternId','patroon-vol'),/al een volle kaart/);removeRoundGoal(plan,round.id,full.id);changeRoundGoal(plan,round.id,added.id,'patternId','patroon-vol');assert.equal(round.goals.at(-1).id,added.id);assert.doesNotThrow(()=>normalizeBingoPlan(plan));
 while(round.goals.length>1)removeRoundGoal(plan,round.id,round.goals[0].id);assert.throws(()=>removeRoundGoal(plan,round.id,round.goals[0].id),/minstens één/);
});

test('round and goal capacity limits keep the resulting draft printable and saveable',()=>{
 const value=game(),plan=value.plan;while(roundBlocks(plan).length<8)addRound(plan);assert.throws(()=>addRound(plan),/acht rondes/);const round=roundBlocks(plan)[0];while(round.goals.length<10)addRoundGoal(plan,round.id);assert.throws(()=>addRoundGoal(plan,round.id),/tien prijsstappen/);assert.doesNotThrow(()=>normalizeBingoPlan(plan));
 while(roundBlocks(plan).length>1)removeRound(plan,roundBlocks(plan).at(-1).id);assert.throws(()=>removeRound(plan,roundBlocks(plan)[0].id),/minstens één/);
});

test('normal preparation rules follow edited rounds instead of retaining the old published preview',()=>{
 const value=game();prepareAutomaticRules(value);const round=roundBlocks(value.plan)[0];changeRoundGoal(value.plan,round.id,round.goals[0].id,'patternId','patroon-diagonaal');assert.equal(rulesCurrent(value),false);prepareAutomaticRules(value);assert.equal(rulesCurrent(value),true);assert.equal(value.rulesPublication.contract.rounds[0].goals[0].pattern.id,'patroon-diagonaal');
});

test('a library containing only full card cannot accidentally add a second terminal step',()=>{
 const value=game(),plan=value.plan;plan.patterns=plan.patterns.filter(pattern=>pattern.id==='patroon-vol');plan.blocks=plan.blocks.filter(block=>block.type!=='round'||block.title==='Finaleronde');
 const round=roundBlocks(plan)[0];assert.throws(()=>addRoundGoal(plan,round.id),/ander speelpatroon/);assert.equal(round.goals.length,1);assert.doesNotThrow(()=>normalizeBingoPlan(plan));
});
