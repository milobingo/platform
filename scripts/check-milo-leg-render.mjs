// Actual approved artwork + production renderer. No browser or provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadHarness,createCanvas} from './check-milo-puppet-render.mjs';
import {MILO_PUPPET_CALIBRATION as C} from '../public/milo-puppet.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const sourceDistance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

test('the rendered walking puppet has connected hip/knee/ankle/foot chains and separate body layers',async()=>{
 const h=await loadHarness(),rig=h.newRig();
 try{
  assert.equal(rig.stats.legChains,'hip-knee-ankle-foot');
  assert(rig.stats.parts>=19);assert(rig.stats.layers>=28);assert.equal(rig.stats.tailSegments,2);
  const canvas=createCanvas(799,1000),ctx=canvas.getContext('2d'),positions=[];
  for(let i=0;i<32;i++){
   ctx.clearRect(0,0,799,1000);
   const frame=rig.draw(ctx,{x:399,y:960,height:850,time:i/24,idleTime:i/24,motion:'walk',motionBlend:1,immediate:true});
   const scale=850/rig.bounds.h;
   positions.push(frame.legs);
   for(const side of ['left','right']){
    const leg=frame.legs[side],source=C[side];
    // A bad parent/pivot hookup can look animated yet detach the lower leg.
    assert(Math.abs(distance(leg.hip,leg.knee)-sourceDistance(source.hip,source.knee)*scale)<.001,side+' thigh changed length');
    assert(Math.abs(distance(leg.knee,leg.ankle)-sourceDistance(source.knee,source.ankle)*scale)<.001,side+' shin changed length');
    assert(Math.abs(distance(leg.ankle,leg.foot)-sourceDistance(source.ankle,source.foot)*scale)<.001,side+' foot detached');
    for(const anchor of [leg.knee,leg.ankle]){
     assert(Number.isFinite(anchor.x)&&Number.isFinite(anchor.y));
     const alpha=ctx.getImageData(Math.round(anchor.x),Math.round(anchor.y),1,1).data[3];
     assert(alpha>170,side+' joint has a transparent seam during the stride');
    }
   }
  }
  const span=(side,key,axis)=>Math.max(...positions.map(p=>p[side][key][axis]))-Math.min(...positions.map(p=>p[side][key][axis]));
  for(const side of ['left','right']){
   assert(span(side,'knee','x')>8,side+' knee does not move visibly');
   assert(span(side,'ankle','y')>3,side+' foot never lifts');
   const bends=positions.map(p=>{const {hip,knee,ankle}=p[side],a={x:knee.x-hip.x,y:knee.y-hip.y},b={x:ankle.x-knee.x,y:ankle.y-knee.y};return Math.atan2(a.x*b.y-a.y*b.x,a.x*b.x+a.y*b.y);});
   assert(Math.max(...bends)-Math.min(...bends)>.1,side+' knee must bend independently of the hip');
  }
 }finally{rig.dispose();h.restore();}
});
