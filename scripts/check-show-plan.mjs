import test from 'node:test';
import assert from 'node:assert/strict';
import {ShowDirector} from '../public/show-director.js';
import {ShowRunner} from '../public/show-runner.js';
import {defaultPlan,normalizePlan,planIssues,createBlock,moveBlock} from '../server/plan-model.js';

function rig(plan){
 const speech=[],notices=[],d=new ShowDirector({config:{voice:true,sound:false,comments:false,audience:false},onEvent:e=>{if(e.type==='speech')speech.push(e.text);}}),r=new ShowRunner(d,{onNotice:message=>notices.push(message)});
 const tick=(seconds=.5,voiceBusy=false)=>{d.tick(seconds,{voiceBusy});r.tick(seconds);};
 const until=(predicate,max=1200)=>{for(let i=0;i<max&&!predicate();i++)tick();assert(predicate(),'show did not reach expected state');};
 r.start(plan);return {d,r,tick,until,speech,notices};
}
function quickPlan(){const p=defaultPlan();p.blocks=p.blocks.filter(b=>b.type!=='round');for(const b of p.blocks){if('seconds'in b)b.seconds=1;if('hold'in b)b.hold=0;}return p;}

test('saved models validate, widgets can be reordered and running shows retain their own snapshot',()=>{
 const p=defaultPlan();assert.deepEqual(planIssues(normalizePlan(p)),[]);const b=createBlock('call',p);p.blocks.push(b);assert(moveBlock(p,b.id,p.blocks[0].id));assert.equal(p.blocks[0].type,'call');assert(moveBlock(p,b.id,null));assert.equal(p.blocks.at(-1).type,'call');assert.equal(moveBlock(p,b.id,b.id),false);
 const live=quickPlan(),h=rig(live);const title=h.r.block.title;live.blocks[0].title='Later gewijzigd';assert.equal(h.r.block.title,title);
 const bad=defaultPlan();bad.patterns[0].cells=[26];assert.throws(()=>normalizePlan(bad));bad.patterns[0].cells=[0];bad.blocks[3].goals[0].patternId='ontbreekt';assert.match(planIssues(normalizePlan(bad))[0],/patroon/);
});
test('countdown, custom speech, pauses and finale run automatically and wait for actual speech',()=>{
 const p=quickPlan(),h=rig(p);h.until(()=>h.r.block.type==='welcome');assert.equal(h.speech.at(-1),p.blocks.find(b=>b.type==='welcome').text);
 for(let i=0;i<20;i++)h.tick(.5,true);assert.equal(h.r.block.type,'welcome');
 h.d.pause();const age=h.d.flow.age,index=h.r.index;for(let i=0;i<5;i++)h.tick();assert.equal(h.d.flow.age,age);assert.equal(h.r.index,index);h.d.resume();h.until(()=>!h.r.active);
 assert.equal(h.r.phase,'complete');assert.equal(h.d.scene,'finale');assert(h.speech.includes(p.blocks.find(b=>b.type==='explanation').text));assert(h.speech.includes(p.blocks.at(-1).text));assert.equal(h.d.drawn.length,0);
});
test('a round runs every goal in order, rejects invalid bingo without losing the pending ball and resets the next round',()=>{
 const p=defaultPlan(),a=p.blocks.find(b=>b.type==='round'),b={...structuredClone(a),id:'volgende-ronde',title:'Ronde 2'};a.interval=0;a.goals.push({id:'tweede-prijs',patternId:p.patterns[3].id,prizeId:p.prizes[1].id});b.goals=[{id:'laatste-prijs',patternId:p.patterns[0].id,prizeId:p.prizes[0].id}];p.blocks=[a,b];const h=rig(p);
 h.until(()=>h.d.pending!==null);const pending=h.d.pending;h.d.reportBingo('Sanne','kaart-1');assert.equal(h.r.next(),false);for(let i=0;i<10;i++)h.tick();assert.equal(h.d.pending,pending);assert.equal(h.d.drawn.length,0);h.d.resolveBingo(false);h.until(()=>h.d.drawn.includes(pending));assert.equal(h.r.index,0);assert.equal(h.r.goal,0);
 h.d.reportBingo('Sanne','kaart-1');assert.equal(h.d.resolveBingo(true),false);assert(h.d.resolveBingo(true,{checked:true}));h.until(()=>h.r.goal===1);assert.equal(h.d.config.pattern,p.patterns[3].title);assert.equal(h.d.config.prize,p.prizes[1].title);assert(h.d.drawn.includes(pending));
 h.d.reportBingo('Jan','kaart-2');h.d.resolveBingo(true,{checked:true});h.until(()=>h.r.index===1);assert.deepEqual(h.d.drawn,[]);assert.equal(h.r.goal,0);assert.equal(h.d.config.round,'Ronde 2');
});
test('all 75 draws stop safely and a final approved bingo can still advance the timeline',()=>{
 const p=defaultPlan(),b=p.blocks.find(b=>b.type==='round');b.interval=0;p.blocks=[b,{id:'pauze-na-ronde',type:'pause',title:'Pauze',seconds:1,unit:'seconds'}];const h=rig(p);h.until(()=>h.r.phase==='waiting',4000);assert.equal(h.d.drawn.length,75);assert.equal(new Set(h.d.drawn).size,75);for(let i=0;i<20;i++)h.tick();assert.equal(h.r.index,0);assert.equal(h.d.pending,null);assert.equal(h.notices.length,1);
 h.d.reportBingo('Laatste winnaar','kaart-75');h.d.resolveBingo(true,{checked:true});h.until(()=>h.r.index===1);assert.equal(h.r.block.type,'pause');
});
test('belronde can hold for the regie or continue after its timer, and skipping never publishes a pending number',()=>{
 const p=quickPlan(),call=createBlock('call',p);call.seconds=1;p.blocks=[call,p.blocks.at(-1)];const h=rig(p);h.until(()=>h.r.phase==='waiting');for(let i=0;i<20;i++)h.tick();assert.equal(h.r.index,0);assert(h.r.next());h.until(()=>!h.r.active);
 call.advance='auto';const auto=rig(p);auto.until(()=>!auto.r.active);assert.equal(auto.r.index,1);
 const rp=defaultPlan();rp.blocks=[rp.blocks.find(b=>b.type==='round'),p.blocks.at(-1)];const round=rig(rp);round.until(()=>round.d.pending!==null);const pending=round.d.pending;assert(round.r.next());assert.equal(round.d.pending,null);assert(!round.d.drawn.includes(pending));
});
