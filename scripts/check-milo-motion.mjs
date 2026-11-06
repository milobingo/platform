import test from 'node:test';
import assert from 'node:assert/strict';
import {miloPoseAt,MILO_MOTION_IDS,MILO_MOTION_JOINTS,MILO_WALK_PERIOD,solveMiloLeg,createMiloPoseSmoother,easeMilo} from '../public/milo-motion.js';

const rotate=([x,y],a)=>[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1]],sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
function handAt(p,side){
 const {shoulder,elbow,wrist,hand}=MILO_MOTION_JOINTS[side];
 const a=p[side+'Upper'],b=a+p[side+'Forearm'],c=b+p[side+'Hand'];
 const joint=add(shoulder,rotate(sub(elbow,shoulder),a));
 return add(add(joint,rotate(sub(wrist,elbow),b)),rotate(sub(hand,wrist),c));
}
const distance=(a,b)=>Math.hypot(...sub(a,b));
function ankleAt(p,side){
 const {hip,knee,ankle}=MILO_MOTION_JOINTS[side],upper=p[side+'Leg'],lower=upper+p[side+'Knee'];
 const joint=add(hip,rotate(sub(knee,hip),upper));
 const local=add(joint,rotate(sub(ankle,knee),lower));
 const pivot=[414,655],turned=add(pivot,rotate(sub(local,pivot),p.pelvisRot));
 return add(turned,[(p.rootX+p.pelvisX)*916,(p.rootY+p.pelvisY)*916]);
}

test('all Milo performances sample finite, bounded, continuous poses including both magic acts',()=>{
 for(const motion of MILO_MOTION_IDS)for(const magicId of ['star-hat','silk-stars']){
  let previous=null;
  for(let i=0;i<900;i++){
   const time=i/60,p=miloPoseAt({motion,time,idleTime:24+time,magicId,magicProgress:motion==='magic'?time/15:-1});
   for(const [key,value] of Object.entries(p)){
    assert(Number.isFinite(value),`${motion}:${key} is not finite`);
    assert(Math.abs(value)<3.15,`${motion}:${key} exceeds a full joint turn`);
    if(previous)assert(Math.abs(value-previous[key])<.16,`${motion}:${key} has a one-frame jump`);
   }
   assert(p.hatLift>=0&&p.hatLift<=.008,'Hat should remain attached to the original head');
   assert(p.bodyScaleY>.94&&p.bodyScaleY<1.04,'Body must not squash into a rubber cutout');
   previous=p;
  }
 }
});

test('greeting visibly raises Milo’s hand and animates elbow and wrist independently',()=>{
 const p=miloPoseAt({motion:'wave',time:1.1}),q=miloPoseAt({motion:'wave',time:1.4});
 const a=handAt(p,'left'),b=handAt(q,'left');
 assert(a[1]<MILO_MOTION_JOINTS.left.hand[1]-150,'Wave did not lift the actual hand far enough');
 assert(distance(a,b)>12,'Raised hand has no visible waving arc');
 assert(Math.abs(p.leftForearm-q.leftForearm)>.08);assert(Math.abs(p.leftHand-q.leftHand)>.08);
 assert(Math.abs(p.leftUpper-q.leftUpper)<.08,'Shoulder should remain calmer than elbow and wrist');
});

test('clapping brings actual palms together in front of the waistcoat',()=>{
 const open=miloPoseAt({motion:'clap',time:0}),closed=miloPoseAt({motion:'clap',time:Math.PI/5.6});
 const ol=handAt(open,'left'),or=handAt(open,'right'),cl=handAt(closed,'left'),cr=handAt(closed,'right');
 assert(distance(cl,cr)<80,'Closed hands remain too far apart for a clap');
 assert(distance(ol,or)>distance(cl,cr)+45,'Clapping should close hands, not push them outward');
 for(const [x,y] of [cl,cr]){assert(x>340&&x<490,'Clap must stay in front of the torso');assert(y>470&&y<590,'Clap must stay below the face and above the desk');}
});

test('high energy preserves the physical clap and chin destinations',()=>{
 for(const energy of [1,1.2,100/70,1.6]){
  const closed=miloPoseAt({motion:'clap',time:Math.PI/5.6,energy});
  const left=handAt(closed,'left'),right=handAt(closed,'right');
  assert(distance(left,right)<80,'Energy must not swing the hands beyond their clap target');
  for(const [x,y] of [left,right]){assert(x>340&&x<490);assert(y>470&&y<590);}
  const thoughtful=miloPoseAt({motion:'think',time:1.4,energy});
  assert(distance(handAt(thoughtful,'right'),[506,376])<20,'Thinking hand should remain by the chin');
  assert.deepEqual(miloPoseAt({motion:'clap',time:3,idleTime:8,blend:0,energy}),miloPoseAt({motion:'idle',idleTime:8,energy}),'Energy must not change the idle pose at a cue boundary');
 }
});

test('gesture blend returns to the same ongoing idle phase at both cue edges',()=>{
 for(const motion of MILO_MOTION_IDS.filter(m=>!['idle','speak'].includes(m))){
  const options={idleTime:12.3,energy:.9,speaking:false};
  const idle=miloPoseAt({...options,motion:'idle'});
  assert.deepEqual(miloPoseAt({...options,motion,time:0,blend:0}),idle,motion+' start jumped idle phase');
  assert.deepEqual(miloPoseAt({...options,motion,time:8,blend:0}),idle,motion+' end jumped idle phase');
 }
 assert.equal(easeMilo(0),0);assert.equal(easeMilo(1),1);
 assert(easeMilo(.001)<1e-7);assert(1-easeMilo(.999)<1e-7);
});

test('talking adds slow expressive gesture beats and respects an active choreography',()=>{
 const quiet=miloPoseAt({time:1.8,motion:'idle'}),talk=miloPoseAt({time:1.8,motion:'idle',speaking:true,mouth:.5});
 assert(Math.abs(talk.rightUpper-quiet.rightUpper)>.1);
 assert(Math.abs(talk.headRot-quiet.headRot)>.01);
 for(const motion of ['wave','clap','magic'])assert.deepEqual(miloPoseAt({time:1.8,motion,speaking:true}),miloPoseAt({time:1.8,motion,speaking:false}));
});

test('magical choreography follows two distinct acts rather than one looping hand pose',()=>{
 const hatA=miloPoseAt({motion:'magic',time:1.4,magicProgress:.1,magicId:'star-hat'});
 const hatB=miloPoseAt({motion:'magic',time:7,magicProgress:.5,magicId:'star-hat'});
 const silkA=miloPoseAt({motion:'magic',time:3.4,magicProgress:3.4/15,magicId:'silk-stars'});
 const silkB=miloPoseAt({motion:'magic',time:4.1,magicProgress:4.1/15,magicId:'silk-stars'});
 assert(hatA.leftUpper>hatB.leftUpper+.2,'Hat preparation should raise the supporting hand');
 assert(hatB.rightUpper<hatA.rightUpper-.2,'Levitation should use a distinct presenting arm');
 assert(Math.abs(silkA.rightHand-silkB.rightHand)>.1,'Ribbon wrist should describe a visible loop');
 assert.notDeepEqual(hatB,miloPoseAt({motion:'magic',time:7,magicProgress:.5,magicId:'silk-stars'}));
});

test('the critically damped pose settles without snapping, freezes exactly and allows deterministic seeking',()=>{
 const idle=miloPoseAt({time:0}),wave=miloPoseAt({time:1,motion:'wave'}),s=createMiloPoseSmoother();
 s.sample(idle);const initial=s.sample(wave,{deltaTime:1/60});
 assert(initial.leftUpper>idle.leftUpper&&initial.leftUpper<wave.leftUpper);
 const stopped=s.snapshot();for(let i=0;i<20;i++)assert.deepEqual(s.sample(wave,{paused:true,deltaTime:.05}),stopped);
 let settled;for(let i=0;i<150;i++)settled=s.sample(wave,{deltaTime:1/60});
 assert(Math.abs(settled.leftUpper-wave.leftUpper)<1e-8);
 assert.deepEqual(s.sample(idle,{seek:true}),idle);
 const a=createMiloPoseSmoother(),b=createMiloPoseSmoother();a.sample(idle);b.sample(idle);
 for(let i=0;i<30;i++)a.sample(wave,{deltaTime:1/30});for(let i=0;i<120;i++)b.sample(wave,{deltaTime:1/120});
 for(const key of Object.keys(idle))assert(Math.abs(a.snapshot()[key]-b.snapshot()[key])<1e-10,'Smoothing changed with frame rate');
});

test('reduced motion and zero energy freeze the full skeleton while leaving facial audio independent',()=>{
 const still=miloPoseAt({reducedMotion:true});
 for(const motion of MILO_MOTION_IDS){assert.deepEqual(miloPoseAt({time:9,motion,reducedMotion:true,speaking:true}),still);assert.deepEqual(miloPoseAt({time:9,motion,energy:0}),still);}
 const invalid=miloPoseAt({time:NaN,idleTime:Infinity,energy:'oops',blend:NaN,mouth:NaN});
 for(const value of Object.values(invalid))assert(Number.isFinite(value));
});

test('walking alternates planted feet and raised swing legs without stretching their source geometry',()=>{
 for(const side of ['left','right']){
  const rest=solveMiloLeg(side,MILO_MOTION_JOINTS[side].ankle);
  assert(Math.abs(rest.leg)<1e-10&&Math.abs(rest.knee)<1e-10,'The IK rest pose must match the approved drawing');
 }
 let leftLift=0,rightLift=0,leftKneeMin=Infinity,leftKneeMax=-Infinity,bootRollMin=Infinity,bootRollMax=-Infinity;
 for(let frame=0;frame<=640;frame++){
  const phase=frame/640,p=miloPoseAt({motion:'walk',walkPhase:phase,idleTime:6});
  const u=phase%1,v=(phase+.5)%1;
  const left=ankleAt(p,'left'),right=ankleAt(p,'right');
  const l=MILO_MOTION_JOINTS.left.ankle[1]-left[1],r=MILO_MOTION_JOINTS.right.ankle[1]-right[1];
  assert(l>=-1e-8&&r>=-1e-8,'A foot passed below its calibrated floor height');
  if(u<=.62)assert(Math.abs(l)<1e-8,'Left support foot should stay planted');
  if(v<=.62)assert(Math.abs(r)<1e-8,'Right support foot should stay planted');
  assert(l<1e-8||r<1e-8,'Walking must never become a two-foot hop');
  leftLift=Math.max(leftLift,l);rightLift=Math.max(rightLift,r);
  leftKneeMin=Math.min(leftKneeMin,p.leftKnee);leftKneeMax=Math.max(leftKneeMax,p.leftKnee);
  const roll=p.leftFoot+p.leftLeg+p.leftKnee+p.pelvisRot;
  bootRollMin=Math.min(bootRollMin,roll);bootRollMax=Math.max(bootRollMax,roll);
 }
 assert(leftLift>18&&rightLift>18,'Both legs must visibly lift during their own swing');
 assert(leftKneeMax-leftKneeMin>.35,'The knee should flex independently of the hip');
 assert(bootRollMax-bootRollMin>.14,'The ankle should add its own toe-off/swing roll');
});

test('walking is continuous at every contact and can follow the travelled distance in either direction',()=>{
 for(const direction of [-1,0,1])for(const boundary of [0,.12,.5,.62,1,20.5]){
  const before=miloPoseAt({motion:'walk',walkPhase:boundary-1e-6,idleTime:3,walkDirection:direction});
  const after=miloPoseAt({motion:'walk',walkPhase:boundary+1e-6,idleTime:3,walkDirection:direction});
  for(const key of Object.keys(before))assert(Math.abs(after[key]-before[key])<.0001,`${key} snapped at a foot contact`);
 }
 const timed=miloPoseAt({motion:'walk',time:MILO_WALK_PERIOD*.35,idleTime:3});
 const travelled=miloPoseAt({motion:'walk',time:900,walkPhase:42.35,idleTime:3});
 for(const key of Object.keys(timed))assert(Math.abs(timed[key]-travelled[key])<1e-12,'Travel distance must drive the same pose independently of elapsed cue time');
 const forwardA=ankleAt(miloPoseAt({motion:'walk',walkPhase:.1,walkDirection:1}),'left');
 const forwardB=ankleAt(miloPoseAt({motion:'walk',walkPhase:.4,walkDirection:1}),'left');
 const backwardA=ankleAt(miloPoseAt({motion:'walk',walkPhase:.1,walkDirection:-1}),'left');
 const backwardB=ankleAt(miloPoseAt({motion:'walk',walkPhase:.4,walkDirection:-1}),'left');
 assert(forwardA[0]-forwardB[0]>45,'The support step is too short for a studio walk');
 assert(backwardB[0]-backwardA[0]>45,'Walking direction must reverse support-foot travel');
 const middle=ankleAt(miloPoseAt({motion:'walk',walkPhase:.25,walkDirection:1}),'left');
 assert(Math.abs((forwardA[0]+forwardB[0])/2-middle[0])<1e-8,'Planted foot should travel at constant speed against stage translation');
});

test('walk stride and energy settle safely without destroying the inverse-kinematic foot destinations',()=>{
 const idle=miloPoseAt({motion:'idle',idleTime:8});
 assert.deepEqual(miloPoseAt({motion:'walk',idleTime:8,walkStride:0}),idle,'Zero stride must use the same ongoing idle pose');
 for(const phase of [.1,.36,.72,.9]){
  const ordinary=miloPoseAt({motion:'walk',walkPhase:phase});
  for(const energy of [1.2,100/70,1.6]){
   const lively=miloPoseAt({motion:'walk',walkPhase:phase,energy});
   for(const side of ['left','right'])assert(distance(ankleAt(ordinary,side),ankleAt(lively,side))<1e-8,'Energy must not move a foot away from its physical destination');
  }
 }
 for(const stride of [-999,.001,.5,1,1.1,999,NaN])for(const direction of [-999,0,999,NaN]){
  const p=miloPoseAt({motion:'walk',walkPhase:12.77,walkStride:stride,walkDirection:direction});
  for(const value of Object.values(p))assert(Number.isFinite(value)&&Math.abs(value)<3.15);
 }
});


test('long idle acting stays continuous and non-repeating across many episode boundaries',()=>{
 let previous=null,maxJump=0;
 for(let frame=0;frame<120*100;frame++){
  const p=miloPoseAt({motion:'idle',idleTime:frame/120,attentionX:.35,attentionY:-.2,expression:'curious'});
  if(previous)for(const key of Object.keys(p)){const delta=Math.abs(p[key]-previous[key]);maxJump=Math.max(maxJump,delta);assert(delta<.015,`${key} snapped between quiet acting episodes`);}
  previous=p;
 }
 assert(maxJump>.0001,'Idle character is unexpectedly static');
 const first=miloPoseAt({motion:'idle',idleTime:3}),later=miloPoseAt({motion:'idle',idleTime:3+12.7});
 assert.notDeepEqual(first,later,'Quiet acting must not restart the same fixed pose every episode');
 assert.deepEqual(miloPoseAt({motion:'idle',time:90,idleTime:3}),first,'Cue time must not rewind the continuous idle phase');
});

test('conversation has expressive phrases separated by quieter rests',()=>{
 const speeds=[];let previous;
 for(let frame=0;frame<60*30;frame++){
  const p=miloPoseAt({motion:'speak',idleTime:frame/60,speaking:true});
  if(previous)speeds.push(Math.abs(p.rightUpper-previous.rightUpper)+Math.abs(p.leftUpper-previous.leftUpper)+Math.abs(p.headRot-previous.headRot));
  previous=p;
 }
 const sorted=speeds.sort((a,b)=>a-b),quiet=sorted[Math.floor(sorted.length*.15)],expressive=sorted[Math.floor(sorted.length*.90)];
 assert(expressive>quiet*3,'Speech should alternate between phrases and held/resting poses');
 assert(expressive>.001,'Speech must still produce visible body gestures');
});

test('contextual attention follows a guest gently and yields to exact choreographed cues',()=>{
 const left=miloPoseAt({idleTime:3,attentionX:-1,attentionY:-1,expression:'warm'}),right=miloPoseAt({idleTime:3,attentionX:1,attentionY:1,expression:'warm'});
 assert(right.headX-left.headX>.007);assert(right.eyeX-left.eyeX>.009);assert(right.headY>left.headY);
 for(const motion of ['wave','clap','dance','magic']){
  assert.deepEqual(miloPoseAt({motion,time:2,attentionX:1,attentionY:1,expression:'excited'}),miloPoseAt({motion,time:2}),motion+' should keep its authored attention at full cue blend');
  assert.deepEqual(miloPoseAt({motion,time:2,idleTime:3,blend:0,attentionX:.4,expression:'curious'}),miloPoseAt({motion:'idle',idleTime:3,attentionX:.4,expression:'curious'}),motion+' should settle back into the same attentive idle pose');
 }
 assert.deepEqual(miloPoseAt({time:2,attentionX:999,attentionY:-999}),miloPoseAt({time:2,attentionX:1,attentionY:-1}));
 assert.deepEqual(miloPoseAt({time:2,expression:'unknown'}),miloPoseAt({time:2}));
 assert.deepEqual(miloPoseAt({time:2,reducedMotion:true,attentionX:1,expression:'excited'}),miloPoseAt({reducedMotion:true}));
});
