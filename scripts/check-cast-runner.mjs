import test from 'node:test';
import assert from 'node:assert/strict';
import {ShowDirector} from '../public/show-director.js';
import {ShowRunner} from '../public/show-runner.js';
import {defaultPlan,createBlock,normalizePlan} from '../server/plan-model.js';
import {brandDefaults} from '../server/show-brands.js';
import {CHARACTER_IDS} from '../server/characters.js';

function rig(blocks){
 const events=[],director=new ShowDirector({config:{voice:true,sound:false,comments:false},onEvent:event=>events.push(event)}),runner=new ShowRunner(director);
 const plan=defaultPlan();plan.leadId='milo';plan.studioId='sterrenplein';plan.blocks=blocks;runner.start(normalizePlan(plan));
 const tick=(seconds=.5,voiceBusy=false)=>{director.tick(seconds,{voiceBusy});runner.tick(seconds);};
 const until=(predicate,max=500)=>{for(let i=0;i<max&&!predicate();i++)tick();assert(predicate(),'cast cue did not complete');};
 return {events,director,runner,tick,until};
}
test('a magic cue exposes timing and cast events without selecting or confirming a bingo number',()=>{
 const block=createBlock('magic');block.duration=3;block.hold=0;const h=rig([block]);
 assert.equal(h.director.config.magicId,'star-hat');assert.equal(h.director.camera,'magic');
 assert(h.events.some(e=>e.type==='cast-cue'&&e.action==='start'&&e.magicId==='star-hat'&&e.cueId===block.id));
 assert(h.events.some(e=>e.type==='cast-speaker'&&e.characterId==='milo'));
 for(let i=0;i<20;i++)h.tick(.5,true);assert.equal(h.runner.phase,'flow');assert.equal(h.director.drawn.length,0);
 h.director.pause();const age=h.director.flow.age;for(let i=0;i<5;i++)h.tick();assert.equal(h.director.flow.age,age);h.director.resume();h.until(()=>!h.runner.active);
 assert.equal(h.director.drawn.length,0);assert.equal(h.director.pending,null);assert(h.events.some(e=>e.type==='cast-cue'&&e.action==='end'));assert.equal(h.director.config.magicId,null);
});
test('guest dialogue speaks in order, retains a committed ball, and stop clears the guest',()=>{
 const guest=createBlock('guest');guest.duration=3;guest.hold=0;const h=rig([guest]);h.director.drawn=[27];h.until(()=>!h.runner.active);
 assert.deepEqual(h.events.filter(e=>e.type==='cast-speaker').map(e=>e.characterId),['milo','kora','milo']);assert.equal(h.events.filter(e=>e.type==='speech').length,3);assert.deepEqual(h.director.drawn,[27]);assert.equal(h.director.config.guestId,null);
 const stopped=rig([guest]);stopped.runner.stop();assert.equal(stopped.director.config.guestId,null);assert(stopped.events.some(e=>e.type==='cast-cue'&&e.action==='end'));
});

test('each friend can present inherited premiere cues while Milo retains the magic cues',()=>{
 for(const id of CHARACTER_IDS){
  const plan=brandDefaults(defaultPlan(),'milo');plan.leadId=id;
  const welcome=plan.blocks.find(b=>b.type==='welcome');assert(welcome);
  assert.equal(welcome.speakerId,undefined);
  assert(plan.blocks.filter(b=>b.type==='magic').every(b=>b.speakerId==='milo'));
  plan.blocks=[welcome];const events=[];const director=new ShowDirector({config:{voice:true},onEvent:e=>events.push(e)});
  const runner=new ShowRunner(director);runner.start(normalizePlan(plan));
  assert.equal(director.config.speakerId,id);assert(events.some(e=>e.type==='speech'));runner.stop();
 }
});
