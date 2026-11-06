import test from 'node:test';
import assert from 'node:assert/strict';
import {studioTourAt,MILO_TOUR_DURATION} from '../public/milo-studio-tour.js';
import {ShowCueRuntime} from '../frontend/show-cue-runtime.js';
import {getShowCue} from '../server/show-cues.js';
import {defaultPlan,createBlock,normalizePlan} from '../server/plan-model.js';
const cue=elapsed=>({id:'studio-tour',elapsed,duration:MILO_TOUR_DURATION});
test('the studio lap leaves and returns to the actual host mark with a continuous distance clock',()=>{
 for(const homeX of [805,960]){
  let previous=studioTourAt(cue(0),{homeX}),front=0,transitions=0;
  assert.equal(previous.x,homeX);assert.equal(previous.y,822);assert.equal(previous.blend,0);
  for(let tick=1;tick<=MILO_TOUR_DURATION*60;tick++){
   const p=studioTourAt(cue(tick/60),{homeX});
   for(const value of [p.x,p.y,p.height,p.bodyDistance,p.direction,p.blend,p.alpha])assert(Number.isFinite(value));
   assert(p.x>200&&p.x<1720&&p.y>800&&p.y<1040);
   assert(Math.hypot(p.x-previous.x,p.y-previous.y)<1.7,'No route/snapshot discontinuity');
   assert(p.bodyDistance>=previous.bodyDistance,'The gait cannot rewind on the return leg');
   if(p.layer==='front')front++;
   if(p.layer!==previous.layer){transitions++;assert(p.x<360||p.x>1570,'Depth switches must happen clear of the physical desk');}
   previous=p;
  }
  assert(front>600);assert.equal(transitions,2);
  assert(Math.abs(previous.x-homeX)<.00001);assert.equal(previous.y,822);assert.equal(previous.blend,0);
 }
});
test('preview seeks are deterministic and reduced motion stays at the desk',()=>{
 for(const elapsed of [0,4.2,12,24,40,52,63.9]){
  const packet=cue(elapsed),before=structuredClone(packet);
  assert.deepEqual(studioTourAt(packet),studioTourAt(packet));assert.deepEqual(packet,before);
  const still=studioTourAt(packet,{reducedMotion:true});assert.equal(still.x,960);assert.equal(still.y,822);assert.equal(still.motion,'idle');assert.equal(still.blend,0);
 }
 assert.equal(studioTourAt({id:'applause',elapsed:4}),null);
});
test('an early return changes floor position only while invisible and fades back at the desk',()=>{
 for(const returnAt of [8,24,42,61]){
  const start=studioTourAt({...cue(returnAt),returnAt}),near=studioTourAt({...cue(returnAt+1.2-.0001),returnAt}),home=studioTourAt({...cue(returnAt+1.2),returnAt}),done=studioTourAt({...cue(returnAt+2.4),returnAt});
  assert.equal(start.alpha,1);assert(near.alpha<.000001);assert(Math.abs(home.alpha)<1e-12);
  assert.equal(home.cameraX,start.cameraX,'The camera must not jump when the invisible actor returns to the desk');
  assert.equal(done.x,960);assert.equal(done.y,822);assert(Math.abs(done.alpha-1)<1e-12);assert.equal(done.motion,'idle');
 }
});
function fixture(){
 const events=[],engine={production:'milo',hostId:'milo',camera:'portrait',motion:'idle',game:{state:{drawn:[3,12,41],pending:null,window:null,resultId:null}},director:{paused:true,pending:null},runner:{phase:'idle'},voicePhase:'idle',audio:{unlock:async()=>true,cue:id=>events.push(id),stop(){}},bridge:{sendLocal(){},cue(){},controls(){}},emit(){}};
 const runtime=new ShowCueRuntime(engine);return {engine,runtime,events};
}
test('the real cue runtime freezes on pause and holds game data through a controlled stop',async()=>{
 const {engine,runtime,events}=fixture(),before=structuredClone(engine.game.state);
 await runtime.play('studio-tour');assert.equal(engine.camera,'establish');assert.equal(runtime.holding,true);
 runtime.tick(12);runtime.pause(true);runtime.tick(5);assert.equal(runtime.visual().showCue.elapsed,12);
 runtime.stop();assert.equal(runtime.holding,true);assert.equal(runtime.visual().showCue.returnAt,12);
 runtime.tick(1.2);assert.equal(runtime.holding,true);runtime.tick(1.21);
 assert.equal(runtime.active,null);assert.equal(engine.camera,'portrait');assert.equal(engine.motion,'idle');
 assert.deepEqual(engine.game.state,before);assert.deepEqual(events,[]);
});
test('Milo owns this walk in manual control, planner and inherited-host cues',async()=>{
 const {engine,runtime}=fixture();engine.hostId='stella';await assert.rejects(runtime.play('studio-tour'),/Kies Milo/);
 const plan=defaultPlan();plan.leadId='stella';plan.studioId='sterrenplein';
 const block=createBlock('show',plan,'milo');block.showCueId='studio-tour';block.speakerId='stella';plan.blocks=[block];
 assert.equal(normalizePlan(plan).blocks[0].speakerId,'milo');
 runtime.startRundown({id:'studio-tour',hostId:'stella',instanceId:'round-one'});assert.equal(runtime.active.hostId,'milo');
 assert.equal(getShowCue('studio-tour').duration,MILO_TOUR_DURATION);
});
