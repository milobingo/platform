import test from 'node:test';
import assert from 'node:assert/strict';
import {SHOW_EFFECT_IDS,showEffectParticles,cueVisualState,motionEnvelope,drawShowEffects} from '../public/mf-show-effects.js';
import {poseAt,RIG_PROFILES,rigPoint,normaliseRigProfile} from '../public/mf-rig.js';

test('all show effects render deterministic finite paths without touching cue or game data',()=>{
 const g={addColorStop(){}};
 const ctx=new Proxy({globalAlpha:1,createRadialGradient:()=>g,createLinearGradient:()=>g},{get:(o,key)=>key in o?o[key]:(...args)=>{for(const arg of args)if(typeof arg==='number')assert(Number.isFinite(arg),String(key)+' received a non-finite coordinate');}});
 for(const id of SHOW_EFFECT_IDS){
  const cue={id,instanceId:'one',elapsed:3.4,duration:10,drawn:[7,31,75]},before=structuredClone(cue);
  const first=showEffectParticles(cue),second=showEffectParticles(cue);assert.deepEqual(first,second);
  for(const p of first){assert(Number.isFinite(p.x)&&Number.isFinite(p.y));assert(p.alpha>=0&&p.alpha<=1);}
  for(const reducedMotion of [false,true])for(const layer of ['back','front'])drawShowEffects(ctx,{cue,reducedMotion,layer});
  assert.deepEqual(cue,before);
 }
});
test('reduced motion freezes particle positions at a stable tableau through the cue',()=>{
 for(const id of SHOW_EFFECT_IDS){
  const a=showEffectParticles({id,duration:12,elapsed:2},{reducedMotion:true});
  const b=showEffectParticles({id,duration:12,elapsed:9},{reducedMotion:true});
  assert.deepEqual(a,b,id+' drifted under reduced motion');
  assert.equal(cueVisualState({id,duration:12,elapsed:2},{reducedMotion:true}).time,5.76);
 }
 assert.equal(cueVisualState({id:'unknown',elapsed:2,duration:12}),null);
});
test('gestures smoothly enter and settle to the exact idle pose at both ends',()=>{
 assert.equal(motionEnvelope(0,6),0);assert.equal(motionEnvelope(6,6),0);assert.equal(motionEnvelope(3,6),1);
 assert(motionEnvelope(.1,6)<motionEnvelope(.3,6));assert(motionEnvelope(5.8,6)<motionEnvelope(5.3,6));
 for(const motion of ['wave','point','cheer','clap','dance','surprise','bow','magic']){
  const idle=poseAt(1.2,'idle',1),start=poseAt(1.2,motion,1,-1,motionEnvelope(0,6)),end=poseAt(1.2,motion,1,-1,motionEnvelope(6,6));
  assert.deepEqual(start,idle);assert.deepEqual(end,idle);assert.notDeepEqual(poseAt(1.2,motion,1),idle);
 }
});
test('new dance and clap remain bounded for all twelve cutout profiles',()=>{
 assert.equal(Object.keys(RIG_PROFILES).length,12);
 for(const id of Object.keys(RIG_PROFILES))for(const motion of ['dance','clap','magic'])for(let t=0;t<9;t+=.17){
  const p=poseAt(t,motion,1.8),profile=normaliseRigProfile(id);
  for(const v of Object.values(p))assert(Number.isFinite(v)&&Math.abs(v)<.65);
  for(const point of [[.15,.58],[.85,.58],[.4,.98],[.6,.98],[.5,.2]]){const [x,y]=rigPoint(...point,profile,p);assert(Number.isFinite(x)&&Number.isFinite(y));assert(x>-.12&&x<1.12&&y>-.1&&y<1.1);}
 }
});

test('renderer ignores repeated remote packets, freezes the visible frame on pause, and resumes without rewinding',async()=>{
 const keys=['document','window','Image','fetch','requestAnimationFrame','cancelAnimationFrame','CustomEvent'],originals=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
 const gradient={addColorStop(){}};
 const context=()=>new Proxy({measureText:s=>({width:String(s).length*8}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},{get:(o,k)=>o[k]??(()=>{})});
 class Surface{constructor(){this.children=[];this.width=0;this.height=0;this.ctx=context();}append(...nodes){this.children.push(...nodes);}appendChild(node){this.children.push(node);}setAttribute(){}remove(){}dispatchEvent(){}getContext(){return this.ctx;}getBoundingClientRect(){return {width:1920,height:1080};}}
 globalThis.document={createElement:()=>new Surface()};globalThis.window={devicePixelRatio:1,addEventListener(){},removeEventListener(){}};globalThis.Image=class{set src(_){} };globalThis.fetch=async()=>({ok:true,json:async()=>({})});globalThis.CustomEvent=class{};
 let frame,now=100;globalThis.requestAnimationFrame=fn=>{frame=fn;return 1;};globalThis.cancelAnimationFrame=()=>{};
 let studio;
 try{
  const {mountStudio}=await import('../public/mf-studio.js?cue-clock-test');
  const cue={id:'magic-orbit',instanceId:'one',elapsed:2,duration:12,paused:false},movement={id:'wave',elapsed:1,duration:6};
  const magic={id:'star-hat',startedAt:123,elapsed:3000,playing:true};
  studio=mountStudio(new Surface(),{state:{movingCamera:false,showRoundTitle:false,showCue:cue,movement,magic}});
  frame(now);let previous=studio.snapshot();
  for(let i=0;i<30;i++){
   studio.update({showCue:{...cue},movement:{...movement},magic:{...magic}});frame(now+=40);const current=studio.snapshot();
   assert(current.showCue.elapsed>previous.showCue.elapsed,'Repeated cue packet rewound the cue');
   assert(current.movement.elapsed>previous.movement.elapsed,'Repeated movement packet rewound the gesture');
   assert(current.magic.elapsed>previous.magic.elapsed,'Repeated magic packet passed the .35s tolerance and rewound');previous=current;
  }
  studio.update({paused:true,showCue:{...cue},movement:{...movement}});const frozen=studio.snapshot();
  assert.equal(frozen.showCue.elapsed,previous.showCue.elapsed);assert.equal(frozen.movement.elapsed,previous.movement.elapsed);
  for(let i=0;i<15;i++){studio.update({showCue:{...cue},movement:{...movement}});frame(now+=40);assert.equal(studio.snapshot().showCue.elapsed,frozen.showCue.elapsed);assert.equal(studio.snapshot().movement.elapsed,frozen.movement.elapsed);}
  studio.update({paused:false,showCue:{...cue},movement:{...movement}});frame(now+=40);
  assert(studio.snapshot().showCue.elapsed>frozen.showCue.elapsed);assert(studio.snapshot().movement.elapsed>frozen.movement.elapsed);
  studio.update({showCue:{...cue,paused:true}});const cueFreeze=studio.snapshot().showCue.elapsed;
  for(let i=0;i<5;i++){frame(now+=40);studio.update({showCue:{...cue,paused:true}});assert.equal(studio.snapshot().showCue.elapsed,cueFreeze);}
  studio.update({showCue:{...cue,paused:false}});frame(now+=40);assert(studio.snapshot().showCue.elapsed>cueFreeze);
  studio.update({showCue:{...cue,source:'preview',paused:true,elapsed:2.5},movement:{...movement,paused:true,elapsed:2.5}});
  studio.update({showCue:{...cue,source:'preview',paused:true,elapsed:2.42},movement:{...movement,paused:true,elapsed:2.42}});
  assert.equal(studio.snapshot().showCue.elapsed,2.42,'Small backwards preview scrubs must be exact');assert.equal(studio.snapshot().movement.elapsed,2.42);
  studio.update({showCue:{...cue,instanceId:'two',elapsed:0}});assert.equal(studio.snapshot().showCue.elapsed,0,'A new instance must begin at its supplied time');
  studio.update({magic:{...magic,elapsed:7000}});assert(Math.abs(studio.snapshot().magic.elapsed-7)<.00001,'New authoritative magic time must still synchronize');
  studio.update({magic:null,showCue:null,movement:null,paused:true,speaking:true,speechActive:true});
  const heldScene=studio.snapshot().time,performerStart=studio.snapshot().performerTime;
  for(let i=0;i<10;i++)frame(now+=40);
  assert.equal(studio.snapshot().time,heldScene,'Manual speech must not advance the held show timeline');
  assert(studio.snapshot().performerTime>performerStart,'Manual speech needs its own active character clock');
  studio.update({speechActive:false});const heldPerformer=studio.snapshot().performerTime;
  for(let i=0;i<5;i++)frame(now+=40);
  assert.equal(studio.snapshot().performerTime,heldPerformer,'Pausing speech freezes the character clock');

 }finally{studio?.destroy();for(const key of keys)originals[key]===undefined?delete globalThis[key]:globalThis[key]=originals[key];}
});
