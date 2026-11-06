import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {MAGIC_CUES,MAGIC_IDS,getMagicCue} from '../server/magic-cues.js';
import {CHARACTERS,normaliseCharacterSettings,characterIdentity} from '../server/characters.js';
import {createBlock,defaultPlan,normalizePlan,planIssues} from '../server/plan-model.js';
import {ShowCueRuntime} from '../frontend/show-cue-runtime.js';
import {ShowRuntime} from '../frontend/show-runtime.js';
import {ShowDirector} from '../public/show-director.js';
import {ShowRunner} from '../public/show-runner.js';
globalThis.crypto??=webcrypto;

function fixture(){
 const events=[],e={production:'milo',hostId:'milo',camera:'portrait',motion:'listen',voicePhase:'idle',magic:null,
  game:{id:'rehearsal',state:{drawn:[4,19,38],pending:null,window:null,resultId:null,drawHold:null},books:[{id:'book-1',numbers:[4,19,27]}]},
  director:{paused:true,externalHold:false,pending:null,flow:null,scene:'host',pause(){this.paused=true;}},runner:{phase:'idle',active:false},
  audio:{unlock:async()=>true,cue:id=>events.push(['audio',id]),stop:()=>events.push(['stop'])},
  bridge:{sendLocal(){},cue:id=>events.push(['output-audio',id]),controls:id=>events.push(['control',id])},emit(){}};
 const runtime=new ShowCueRuntime(e);e.showCues=runtime;return {e,runtime,events};
}
const planFor=()=>({...defaultPlan(),leadId:'milo',studioId:'sterrenplein',blocks:[]});

test('twelve different authored tricks have complete, immutable performance metadata',()=>{
 assert.equal(MAGIC_CUES.length,12);assert.equal(new Set(MAGIC_IDS).size,12);
 assert.deepEqual(MAGIC_IDS.slice(0,2),['star-hat','silk-stars']);
 assert.deepEqual(MAGIC_CUES.slice(0,2).map(c=>c.duration),[14,15]);
 assert.equal(new Set(MAGIC_CUES.map(c=>c.description)).size,12);
 assert.equal(new Set(MAGIC_CUES.map(c=>c.intro)).size,12);assert(MAGIC_CUES.every(c=>typeof c.intro==='string'&&c.intro.length>20&&c.intro.length<150));
 assert.equal(new Set(MAGIC_CUES.map(c=>c.prop)).size,12);
 assert.equal(new Set(MAGIC_CUES.map(c=>c.choreography)).size,12);
 assert(Object.isFrozen(MAGIC_CUES));assert(Object.isFrozen(MAGIC_IDS));
 for(const [index,cue] of MAGIC_CUES.entries()){
  assert.equal(getMagicCue(cue.id),cue);assert(Object.isFrozen(cue));assert(Object.isFrozen(cue.phases));
  assert(cue.title&&cue.description&&cue.intro&&cue.theme&&cue.color&&cue.art);assert.equal(cue.hostId,'milo');
  assert.equal(cue.camera,'magic');assert.equal(cue.motion,'magic');
  if(index>=2)assert(cue.duration>=16&&cue.duration<=24);
  assert.deepEqual(Object.keys(cue.phases),['prepare','suspense','reveal','settle']);
  let boundary=0;
  for(const range of Object.values(cue.phases)){assert(Object.isFrozen(range));assert.equal(range[0],boundary);assert(range[1]>range[0]);boundary=range[1];}
  assert.equal(boundary,cue.duration);
  assert(CHARACTERS.milo.tricks.includes(cue.id),'Milo must know the actual cue ID');
 }
 assert.equal(getMagicCue('fake-trick'),null);assert.match(CHARACTERS.milo.tricks,/daadwerkelijk gestart/);
 const saved=normaliseCharacterSettings('milo',{tricks:'Mijn persoonlijke tekst over de twee oude trucs.'});
 assert.equal(saved.tricks,'Mijn persoonlijke tekst over de twee oude trucs.','Updating the catalog must preserve a saved custom profile');
 const identity=characterIdentity(saved);for(const cue of MAGIC_CUES)assert(identity.includes(cue.id),'Current catalog must remain known with an old saved profile');
 assert.match(identity,/daadwerkelijk gestart/);
});

test('all twelve can be planned with their own default duration; explicit saved timings remain compatible',()=>{
 const plan=planFor();
 for(const cue of MAGIC_CUES){const block=createBlock('magic',plan,'milo');block.magicId=cue.id;delete block.duration;plan.blocks.push(block);}
 const clean=normalizePlan(plan);assert.deepEqual(clean.blocks.map(b=>b.duration),MAGIC_CUES.map(c=>c.duration));assert.deepEqual(planIssues(clean),[]);
 plan.blocks[0].duration=3;assert.equal(normalizePlan(plan).blocks[0].duration,3,'Saved intentional cue durations must remain valid');
 plan.blocks[0].magicId='fake-trick';assert.throws(()=>normalizePlan(plan),/bestaand magiemoment/);
 plan.blocks[0].magicId='star-hat';plan.blocks[0].speakerId='stella';assert.throws(()=>normalizePlan(plan),/Milo voert/);
});

test('adding any trick to the rundown uses its exact duration and never changes game state',()=>{
 const plan=planFor();plan.blocks=[{id:'finale',type:'finale',title:'Tot ziens',text:'Tot de volgende keer!',hold:0}];
 const game={state:{drawn:[3,7,42]},books:[{id:'book-1'}]},before=structuredClone(game),notices=[];
 const owner={engine:{game,production:'milo',hostId:'stella',editPlan:edit=>edit(plan),notify:text=>notices.push(text)}};
 for(const cue of MAGIC_CUES)ShowRuntime.prototype.addMoment.call(owner,'magic',{title:cue.title,magicId:cue.id});
 assert.equal(plan.blocks.at(-1).type,'finale');assert.deepEqual(plan.blocks.slice(0,-1).map(b=>[b.magicId,b.duration,b.speakerId,b.text]),MAGIC_CUES.map(c=>[c.id,c.duration,'milo',c.intro]));
 assert.deepEqual(game,before);assert.equal(notices.length,12);
 assert.throws(()=>ShowRuntime.prototype.addMoment.call(owner,'magic',{magicId:'fake-trick'}),/bestaand magiemoment/);
 assert.equal(plan.blocks.length,13);
 const savedText='Dit is onze eigen geschreven introductie voor de ringen.';
 ShowRuntime.prototype.addMoment.call(owner,'magic',{magicId:'linking-rings',text:savedText});assert.equal(plan.blocks.at(-2).text,savedText);
 const savedPlan=normalizePlan(plan);assert.equal(savedPlan.blocks.at(-2).text,savedText);assert.equal(savedPlan.blocks[0].text,MAGIC_CUES[0].intro);
 ShowRuntime.prototype.addMoment.call(owner,'magic',{magicId:'floating-table',text:''});assert.equal(plan.blocks.at(-2).text,'','An explicit empty script remains an editor choice, not a generic hat line');
});

test('every manual trick has one audio cue, freezes, resumes, settles and preserves official game data',async()=>{
 for(const cue of MAGIC_CUES){
  const {e,runtime,events}=fixture(),before=structuredClone(e.game);
  assert.equal(await runtime.magic(cue.id),true);assert.equal(e.camera,'magic');assert.equal(e.motion,'magic');
  assert.equal(runtime.active.hostId,'milo');assert.equal(e.magic.duration,cue.duration);assert.equal(runtime.holding,true);
  runtime.tick(2);runtime.pause(true);runtime.tick(30);assert.equal(e.magic.elapsed,2);assert.equal(runtime.paused,true);
  runtime.pause(false);e.director.externalHold=true;runtime.tick(10);assert.equal(e.magic.elapsed,2);e.director.externalHold=false;
  runtime.tick(cue.duration);assert.equal(runtime.active,null);assert.equal(e.magic,null);assert.equal(e.camera,'portrait');assert.equal(e.motion,'listen');
  assert.equal(e.director.paused,true);assert.deepEqual(e.game,before);
  assert.deepEqual(events.filter(e=>e[0].includes('audio')),[['audio',cue.sound],['output-audio',cue.sound]]);
  await runtime.magic(cue.id);runtime.tick(1);runtime.stop();assert.equal(e.magic,null);assert.equal(e.camera,'portrait');assert.equal(e.motion,'listen');assert.deepEqual(e.game,before);
 }
});

test('a call/draw hold survives magic, on-air speech freezes it, and invalid or late requests cannot start',async()=>{
 const {e,runtime}=fixture();e.game.state.drawHold={id:'call-hold',checkpoint:38};e.liveCalls={active:true,onAir:false};
 const before=structuredClone(e.game);await runtime.magic('bubble-world');runtime.tick(2);e.liveCalls.onAir=true;runtime.tick(20);assert.equal(e.magic.elapsed,2);runtime.reset();assert.deepEqual(e.game,before);
 await assert.rejects(runtime.magic('flower-hat'),/belmoment/);e.liveCalls=null;
 await assert.rejects(runtime.magic('fake-trick'),/bestaand magiemoment/);assert.equal(runtime.active,null);
 e.hostId='stella';await assert.rejects(runtime.magic('star-rabbit'),/Kies Milo/);e.hostId='milo';
 e.production='vlampie';await assert.rejects(runtime.magic('star-rabbit'),/eigen studio/);e.production='milo';
 let release;e.audio.unlock=()=>new Promise(resolve=>release=resolve);const cancelled=runtime.magic('flower-hat');runtime.stop();release(true);assert.equal(await cancelled,false);assert.equal(runtime.active,null);
 const switched=runtime.magic('flower-hat');e.hostId='stella';release(true);await assert.rejects(switched,/Kies Milo/);assert.equal(runtime.active,null);assert.deepEqual(e.game,before);
});

test('all twelve execute in a timed rundown with cast context, pause and cleanup, without any drawn ball',()=>{
 for(const cue of MAGIC_CUES){
  const plan=planFor(),block=createBlock('magic',plan,'milo');Object.assign(block,{magicId:cue.id,hold:0});delete block.duration;plan.blocks=[block];
  const events=[],d=new ShowDirector({config:{voice:false,sound:false},onEvent:e=>events.push(e)}),runner=new ShowRunner(d);runner.start(normalizePlan(plan));
  assert.equal(d.flow.steps[0].duration,cue.duration);assert(events.some(e=>e.type==='cast-cue'&&e.action==='start'&&e.magicId===cue.id&&e.duration===cue.duration));
  d.tick(2);runner.tick(2);d.pause();const age=d.flow.age;d.tick(30);runner.tick(30);assert.equal(d.flow.age,age);d.resume();
  for(let t=0;t<cue.duration+10&&runner.active;t+=.5){d.tick(.5);runner.tick(.5);}
  assert.equal(runner.active,false);assert.equal(d.config.magicId,null);assert.deepEqual(d.drawn,[]);assert.equal(d.pending,null);assert(events.some(e=>e.type==='cast-cue'&&e.action==='end'&&e.magicId===cue.id));
 }
});
