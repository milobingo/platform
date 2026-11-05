import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {SHOW_CUES,MOTION_CUES} from '../server/show-cues.js';
import {ShowCueRuntime} from '../frontend/show-cue-runtime.js';
import {defaultPlan,createBlock,normalizePlan,planIssues} from '../server/plan-model.js';
import {ShowDirector} from '../public/show-director.js';
import {ShowRunner} from '../public/show-runner.js';
globalThis.crypto??=webcrypto;
function fixture(){
 const events=[],e={production:'milo',hostId:'milo',camera:'portrait',motion:'idle',voicePhase:'idle',magic:null,game:{state:{drawn:[4,19,38],pending:null,window:null,resultId:null,drawHold:null}},director:{paused:true,externalHold:false,pending:null,flow:null,scene:'host',pause(){this.paused=true;}},runner:{phase:'idle',active:false},audio:{unlock:async()=>true,cue:id=>events.push(['audio',id]),stop:()=>events.push(['stop'])},bridge:{sendLocal(){},cue:id=>events.push(['output-audio',id]),controls:id=>events.push(['control',id])},emit(){}};
 const runtime=new ShowCueRuntime(e);e.showCues=runtime;return {e,runtime,events};
}
function elapse(runtime,seconds){for(let age=0;age<seconds;age+=.1)runtime.tick(.1);}

test('every show cue has bounded timing and a validated fixed-duration plan block',()=>{
 const p=defaultPlan();p.leadId='milo';p.studioId='sterrenplein';p.blocks=[];
 for(const cue of SHOW_CUES){const b=createBlock('show',p,'milo');Object.assign(b,{showCueId:cue.id,duration:999});p.blocks.push(b);}
 const clean=normalizePlan(p);assert.deepEqual(clean.blocks.map(b=>b.duration),SHOW_CUES.map(c=>c.duration));assert.deepEqual(planIssues(clean),[]);assert(SHOW_CUES.every(c=>c.duration<=12&&c.duration>0));
 p.blocks[0].showCueId='fake-winner';assert.throws(()=>normalizePlan(p),/bestaand showelement/);
 p.blocks[0].showCueId=SHOW_CUES[0].id;p.studioId='showtime';p.leadId='vlampie';assert.throws(()=>normalizePlan(p),/Milo/);
});

test('manual choreography runs above a paused show, restores camera, and relays one sound without changing drawn numbers',async()=>{
 const {e,runtime,events}=fixture(),before=structuredClone(e.game.state);await runtime.play('welcome-wave');
 assert.equal(e.camera,'establish');assert.equal(e.director.paused,true);assert.equal(runtime.paused,false);assert.equal(runtime.holding,true);
 runtime.tick(1.5);assert.equal(e.camera,'host');assert.equal(runtime.visual().showCue.elapsed,1.5);
 runtime.pause(true);runtime.tick(20);assert.equal(runtime.visual().showCue.elapsed,1.5);runtime.pause(false);elapse(runtime,5);
 assert.equal(runtime.active,null);assert.equal(e.camera,'portrait');assert.equal(e.motion,'idle');assert.equal(e.director.paused,true);assert.deepEqual(e.game.state,before);
 assert.deepEqual(events.filter(e=>e[0].includes('audio')),[['audio','friendly'],['output-audio','friendly']]);
});

test('all gestures have a finite clock and settle to idle; unknown motion never starts',()=>{
 const {e,runtime}=fixture();for(const cue of MOTION_CUES){runtime.motion(cue.id);assert.equal(e.motion,cue.id);assert.equal(runtime.visual().movement.duration,cue.duration);elapse(runtime,cue.duration+.2);assert.equal(e.motion,'idle');assert.equal(runtime.active,null);}
 assert.throws(()=>runtime.motion('unbounded-spin'),/beschikbaar gebaar/);assert.equal(runtime.active,null);
});

test('manual cues cannot interrupt a draw, speech, claim window, result, active call or competing manual scene',async()=>{
 for(const patch of [
  e=>e.game.state.pending={number:21},e=>e.director.flow={kind:'draw'},e=>e.voicePhase='playing',
  e=>e.game.state.window={status:'open'},e=>e.game.state.resultId='winner-awaiting-check',
  e=>e.liveCalls={onAir:true},e=>e.director.callHold=true,e=>e.showRuntime={holding:true},
  e=>{e.director.paused=false;e.director.flow={kind:'planned'};},
 ]){const {e,runtime}=fixture();patch(e);const before=structuredClone(e.game.state);await assert.rejects(runtime.play('applause'));assert.equal(runtime.active,null);assert.deepEqual(e.game.state,before);}
});

test('backstage entertainment preserves a persistent draw hold; on-air freeze and refusal keep the caller clear',async()=>{
 const {e,runtime}=fixture();e.game.state.drawHold={id:'call-hold',checkpoint:38};e.liveCalls={active:true,onAir:false};
 const before=structuredClone(e.game.state);await runtime.play('star-shower');runtime.tick(2);assert.equal(runtime.active.elapsed,2);assert.deepEqual(e.game.state,before);
 e.liveCalls.onAir=true;runtime.tick(4);assert.equal(runtime.active.elapsed,2);assert.equal(runtime.visual().showCue.paused,true);
 runtime.reset();await assert.rejects(runtime.play('star-shower'),/belmoment/);assert.deepEqual(e.game.state,before);
});

test('magic restores camera/motion on completion or stop, and canceled audio unlock cannot start a late cue',async()=>{
 const {e,runtime,events}=fixture();await runtime.magic('silk-stars');assert.equal(e.magic.id,'silk-stars');runtime.tick(2);assert.equal(e.magic.elapsed,2);runtime.pause(true);runtime.tick(5);assert.equal(e.magic.elapsed,2);runtime.pause(false);elapse(runtime,14);assert.equal(e.magic,null);assert.equal(e.camera,'portrait');assert.equal(e.motion,'idle');
 await runtime.magic('star-hat');runtime.stop();assert.equal(e.magic,null);assert.equal(e.camera,'portrait');assert(events.some(e=>e[0]==='control'&&e[1]==='stop'));
 let release;e.audio.unlock=()=>new Promise(resolve=>release=resolve);const pending=runtime.play('dance');runtime.stop();release(true);assert.equal(await pending,false);assert.equal(runtime.active,null);
});

test('Vlampie retains timed native gestures but cannot start Milo show effects',async()=>{
 const {e,runtime}=fixture();e.production='vlampie';e.hostId='vlampie';await assert.rejects(runtime.play('applause'),/eigen studio/);runtime.motion('wave');elapse(runtime,6);assert.equal(runtime.active,null);assert.equal(e.camera,'portrait');
});

test('rundown uses one cue clock, relays sound once, pauses, and ends without a ball or a speech request',()=>{
 const events=[],e={production:'milo',hostId:'milo',camera:'portrait',motion:'idle',game:{state:{}},audio:{cue:id=>events.push(['audio',id]),stop(){}},bridge:{cue:id=>events.push(['output-audio',id]),sendLocal(){},controls(){}},emit(){}};
 const runtime=new ShowCueRuntime(e);e.showCues=runtime;const d=e.director=new ShowDirector({config:{voice:true,sound:true},onEvent:event=>{events.push(event);if(event.type==='show-cue'){if(event.action==='start')runtime.startRundown(event);else runtime.reset();}if(event.type==='camera')e.camera=event.camera;if(event.type==='motion')e.motion=event.motion;if(event.type==='sound')runtime.sound(event.cue);}});
 const runner=e.runner=new ShowRunner(d),p=defaultPlan();p.leadId='stella';p.studioId='sterrenplein';p.blocks=[{...createBlock('show',p,'milo'),showCueId:'magic-orbit'}];runner.start(normalizePlan(p));
 assert.equal(runtime.active.hostId,'stella');assert.equal(runtime.holding,false);assert.equal(runtime.active.elapsed,0);assert.equal(d.flow.steps[0].duration,12);
 const tick=dt=>{runtime.tick(dt);d.tick(dt);runner.tick(dt);};tick(2);assert.equal(runtime.active.elapsed,2);assert.equal(d.flow.age,2);d.pause();tick(3);assert.equal(runtime.active.elapsed,2);assert.equal(d.flow.age,2);d.resume();for(let i=0;i<30&&runner.active;i++)tick(.5);
 assert.equal(runner.active,false);assert.equal(runtime.active,null);assert.equal(e.camera,'portrait');assert.deepEqual(d.drawn,[]);assert.equal(d.pending,null);assert.equal(events.filter(e=>e.type==='speech').length,0);assert.equal(events.filter(e=>Array.isArray(e)&&e[0]==='audio').length,1);assert.equal(events.filter(e=>Array.isArray(e)&&e[0]==='output-audio').length,1);
});
