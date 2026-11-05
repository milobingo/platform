import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraRig,CAMERA_PRESETS,boundCamera,cameraEase,resolveCameraShot} from '../public/mf-camera.js';
import {ARENA_LAYOUT} from '../public/mf-broadcast-set.js';
const tick=(rig,seconds,options={})=>{for(let t=0;t<seconds;t+=1/60)rig.update(Math.min(1/60,seconds-t),options);return rig.snapshot();};
const pose=s=>({x:s.x,y:s.y,scale:s.scale});
const inside=s=>{for(const key of ['scale','x','y','parallaxX','parallaxY'])assert(Number.isFinite(s[key]),key);const hw=960/s.scale,hh=540/s.scale;assert(s.x>=hw-1e-6&&s.x<=1920-hw+1e-6);assert(s.y>=hh-1e-6&&s.y<=1080-hh+1e-6);};

test('the complete broadcast shot bank is composed for the new desk without rendering beyond the painted stage',()=>{
 assert.deepEqual(Object.keys(CAMERA_PRESETS),['establish','wide','host','portrait','duo','board','guest','magic','dolly','crane','orbit']);
 assert(CAMERA_PRESETS.wide.scale<CAMERA_PRESETS.host.scale);assert(CAMERA_PRESETS.host.scale<CAMERA_PRESETS.portrait.scale);
 const a=ARENA_LAYOUT,board=boundCamera(CAMERA_PRESETS.board),project=(x,y)=>({x:960+(x-board.x)*board.scale,y:540+(y-board.y)*board.scale});
 const top=project(a.board.x,a.board.y),bottom=project(a.board.x+a.board.width,a.board.y+a.board.height);
 assert(top.x>=20&&bottom.x<=1900&&top.y>=20&&bottom.y<=1060,'the fixed board shot must contain every row and column with an edge margin');
 assert(bottom.y-top.y>=250,'the board close-up must enlarge the five rows to a readable size');
 const host=boundCamera(CAMERA_PRESETS.host),portrait=boundCamera(CAMERA_PRESETS.portrait);
 assert(a.host.height*host.scale<650,'the normal presenter shot must not make Milo dominate the screen');
 for(const shot of [host,portrait]){
  const top=540+(a.host.y-a.host.height-shot.y)*shot.scale;
  const tabletop=540+(a.desk.occlusionY-shot.y)*shot.scale;
  assert(top>=35&&tabletop<=1035,'presenter shots retain headroom and show the desktop');
 }
 for(const id of Object.keys(CAMERA_PRESETS)){const rig=new CameraRig({shot:id});for(let n=0;n<1200;n++){inside(rig.update(.1));}}
 assert.equal(resolveCameraShot('tour'),'dolly');assert.equal(resolveCameraShot('front'),'host');assert.equal(resolveCameraShot('unknown'),'wide');
 const bad=boundCamera({x:Infinity,y:-Infinity,scale:0});assert.deepEqual(bad,{scale:1,x:960,y:540});
});

test('a deliberate camera move uses a timed zero-velocity ease rather than perpetual exponential catchup',()=>{
 const rig=new CameraRig({shot:'wide',moving:false}),start=pose(rig.snapshot());rig.setShot('host',{duration:1400});assert.deepEqual(pose(rig.snapshot()),start);
 const first=rig.update(1/60),middle=tick(rig,.68);assert(first.scale-start.scale<.0002,'The first frame should ease in softly');assert(middle.scale>start.scale&&middle.scale<CAMERA_PRESETS.host.scale);
 const final=tick(rig,1);assert.equal(final.transitioning,false);assert.deepEqual(pose(final),boundCamera(CAMERA_PRESETS.host));assert.equal(cameraEase(0),0);assert.equal(cameraEase(1),1);assert.equal(cameraEase(.5),.5);
});

test('frequent unchanged snapshots do not restart transitions or the cinematic path',()=>{
 const rig=new CameraRig({shot:'establish'});rig.setShot('dolly',{duration:1.2});
 for(let i=0;i<180;i++){if(i%6===0)rig.setShot('dolly',{duration:1.2});rig.update(1/60);}
 assert.equal(rig.snapshot().transitioning,false);assert(Math.abs(rig.snapshot().pathTime-3)<1e-8);assert(rig.snapshot().x<950);
});

test('interrupting a move starts exactly from its visible frame and never jumps to an obsolete preset',()=>{
 const rig=new CameraRig({shot:'wide',moving:false});rig.setShot('board');tick(rig,.4);const current=pose(rig.snapshot());rig.setShot('guest');assert.deepEqual(pose(rig.snapshot()),current);const next=rig.update(1/60);assert(Math.abs(next.x-current.x)<.03);assert(Math.abs(next.scale-current.scale)<.001);inside(tick(rig,2));
});

test('dolly, crane and orbit follow distinct composed trajectories; fixed number-board shots stay locked',()=>{
 const samples={};for(const shot of ['dolly','crane','orbit','board']){const rig=new CameraRig(shot),start=pose(rig.snapshot());tick(rig,12);samples[shot]={start,end:pose(rig.snapshot())};}
 assert(samples.dolly.end.x<samples.dolly.start.x-65);assert(samples.crane.end.y<samples.crane.start.y-20);assert(samples.orbit.end.x>samples.orbit.start.x+65);assert.deepEqual(samples.board.end,samples.board.start);
});

test('pause freezes both a transition and its physical path; disabling movement settles and remains still',()=>{
 const rig=new CameraRig('dolly');tick(rig,9);rig.setShot('orbit');tick(rig,.3);const before=rig.snapshot();tick(rig,8,{paused:true});assert.deepEqual(rig.snapshot(),before);
 tick(rig,3,{moving:false});const still=rig.snapshot();tick(rig,5,{moving:false});assert.deepEqual(pose(rig.snapshot()),pose(still));assert.equal(rig.snapshot().pathTime,still.pathTime);assert.equal(rig.snapshot().moving,false);
});

test('reduced motion and explicit cuts immediately use a stable composed frame without any ongoing travel',()=>{
 const rig=new CameraRig('orbit');tick(rig,8);rig.setShot('host',{reducedMotion:true});assert.equal(rig.snapshot().transitioning,false);assert.deepEqual(pose(rig.snapshot()),boundCamera(CAMERA_PRESETS.host));tick(rig,10,{reducedMotion:true});assert.deepEqual(pose(rig.snapshot()),boundCamera(CAMERA_PRESETS.host));assert.equal(rig.snapshot().pathTime,0);
 rig.setShot('board',{transition:'cut',reducedMotion:false});assert.equal(rig.snapshot().transitioning,false);assert.deepEqual(pose(rig.snapshot()),boundCamera(CAMERA_PRESETS.board));
});

test('invalid deltas, malicious coordinates and excessive durations remain finite and bounded',()=>{
 const rig=new CameraRig({shot:'unknown',duration:Infinity,motionIntensity:Infinity});for(const dt of [NaN,-1,Infinity,0])inside(rig.update(dt));rig.setShot('portrait',{duration:1e6});assert.equal(rig.transition.duration,4);rig.setShot('host',{duration:800});assert.equal(rig.transition.duration,.8);tick(rig,5);inside(rig.snapshot());
});
