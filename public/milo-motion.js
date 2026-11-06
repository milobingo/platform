import {getMagicCue} from './magic-cues.js';
/** Milo's articulated performance. Angles are radians; translations are fractions
 * of the 916px source height. All choreography is a pure sample of show time.
 * The scene owns timing, pause and the active cue: this module never advances it.
 */
const PI=Math.PI,TAU=PI*2;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const finite=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
const mix=(a,b,t)=>a+(b-a)*t;
export const easeMilo=t=>{t=clamp(finite(t));return t*t*t*(t*(t*6-15)+10);};
const ramp=(t,a,b)=>easeMilo((t-a)/(b-a));
const windowAt=(t,a,b,c,d)=>ramp(t,a,b)*(1-ramp(t,c,d));
const angle=a=>Math.atan2(Math.sin(a),Math.cos(a));

export const MILO_MOTION_JOINTS=Object.freeze({
 left:Object.freeze({shoulder:[286,423],elbow:[240,495],wrist:[187,528],hand:[125,536],hip:[373,661],knee:[340,739],ankle:[301,824],foot:[285,862]}),
 right:Object.freeze({shoulder:[523,431],elbow:[568,500],wrist:[650,538],hand:[710,546],hip:[466,663],knee:[471,739],ankle:[476,817],foot:[518,853]}),
});
export const MILO_WALK_PERIOD=1.28;
export const MILO_MOTION_IDS=Object.freeze(['idle','speak','wave','welcome','point','cheer','celebrate','think','listen','look','clap','dance','surprise','bow','walk','enter','exit','magic']);
const neutral=()=>({bodyRot:0,headRot:0,tailRot:0,hatRot:0,leftUpper:0,leftForearm:0,leftHand:0,rightUpper:0,rightForearm:0,rightHand:0,leftLeg:0,rightLeg:0,leftKnee:0,rightKnee:0,leftFoot:0,rightFoot:0,pelvisX:0,pelvisY:0,pelvisRot:0,chestRot:0,rootX:0,rootY:0,headX:0,headY:0,hatLift:0,bodyScaleY:1,eyeX:0,eyeY:0});

/** Two joints aim the original hand centre, keeping limb lengths unchanged.
 * bend controls which side of the shoulder/hand line the elbow occupies.
 */
export function solveMiloArm(side,target,{bend=side==='left'?1:-1}={}){
 const {shoulder:s,elbow:e,hand:h}=MILO_MOTION_JOINTS[side]||MILO_MOTION_JOINTS.left;
 const upperLength=Math.hypot(e[0]-s[0],e[1]-s[1]),foreLength=Math.hypot(h[0]-e[0],h[1]-e[1]);
 const dx=finite(target?.[0],h[0])-s[0],dy=finite(target?.[1],h[1])-s[1];
 const dist=clamp(Math.hypot(dx,dy),Math.abs(upperLength-foreLength)+.001,upperLength+foreLength-.001),heading=Math.atan2(dy,dx);
 const alpha=Math.acos(clamp((upperLength*upperLength+dist*dist-foreLength*foreLength)/(2*upperLength*dist),-1,1));
 const upperWorld=heading+(bend<0?-alpha:alpha),joint=[s[0]+Math.cos(upperWorld)*upperLength,s[1]+Math.sin(upperWorld)*upperLength];
 const hand=[s[0]+Math.cos(heading)*dist,s[1]+Math.sin(heading)*dist],foreWorld=Math.atan2(hand[1]-joint[1],hand[0]-joint[0]);
 const upper=angle(upperWorld-Math.atan2(e[1]-s[1],e[0]-s[0]));
 return {upper,forearm:angle(foreWorld-Math.atan2(h[1]-e[1],h[0]-e[0])-upper)};
}
/** The leg uses the very same source-pixel anchors as the drawing rig. The
 * returned hip/knee rotations reach an ankle target without lengthening a leg.
 */
export function solveMiloLeg(side,target,{bend=-1}={}){
 const {hip:h,knee:k,ankle:a}=MILO_MOTION_JOINTS[side]||MILO_MOTION_JOINTS.left;
 const upperLength=Math.hypot(k[0]-h[0],k[1]-h[1]),lowerLength=Math.hypot(a[0]-k[0],a[1]-k[1]);
 const dx=finite(target?.[0],a[0])-h[0],dy=finite(target?.[1],a[1])-h[1];
 const distance=clamp(Math.hypot(dx,dy),Math.abs(upperLength-lowerLength)+1e-7,upperLength+lowerLength-1e-7),heading=Math.atan2(dy,dx);
 const alpha=Math.acos(clamp((upperLength*upperLength+distance*distance-lowerLength*lowerLength)/(2*upperLength*distance),-1,1));
 const upperWorld=heading+(bend<0?-alpha:alpha),joint=[h[0]+Math.cos(upperWorld)*upperLength,h[1]+Math.sin(upperWorld)*upperLength];
 const ankle=[h[0]+Math.cos(heading)*distance,h[1]+Math.sin(heading)*distance],lowerWorld=Math.atan2(ankle[1]-joint[1],ankle[0]-joint[0]);
 const leg=angle(upperWorld-Math.atan2(k[1]-h[1],k[0]-h[0]));
 return {leg,knee:angle(lowerWorld-Math.atan2(a[1]-k[1],a[0]-k[0])-leg)};
}
function aim(p,side,x,y,bend){const a=solveMiloArm(side,[x,y],{bend});p[side+'Upper']=a.upper;p[side+'Forearm']=a.forearm;}
function walkPose(p,t,{walkStride=1,walkDirection=1,walkPhase=null}={}){
 const strideScale=clamp(finite(walkStride,1),0,1.1),amount=Math.min(1,strideScale),direction=clamp(finite(walkDirection,1),-1,1),rest={...p};
 if(amount===0)return;
 const phase=walkPhase!==null&&Number.isFinite(Number(walkPhase))?Number(walkPhase):t/MILO_WALK_PERIOD,beat=phase*TAU,stride=Math.sin(beat),bounce=(1-Math.cos(beat*2))/2;
 // A little knee compression leaves genuine reach for the swing leg. The
 // pelvis carries the weight; shoulders and head counter it with a soft lag.
 p.rootX=0;p.rootY=-bounce*.0015;
 p.pelvisX=-stride*direction*.0028;p.pelvisY=.024+Math.cos(beat*2)*.0015;p.pelvisRot=stride*direction*.009;
 p.chestRot=-Math.sin(beat-.25)*.018;p.bodyRot=Math.sin(beat-.15)*.006;
 p.bodyScaleY=1+Math.cos(beat*2-.3)*.0018;
 p.headRot=-Math.sin(beat-.35)*.018;p.headX=-stride*.0012;p.headY=-bounce*.001;
 p.hatRot=Math.sin(beat-.7)*.004;p.tailRot=Math.sin(beat-.9)*.082;
 p.leftUpper=-.34+stride*.16;p.rightUpper=.32+stride*.16;
 p.leftForearm=-.16+Math.sin(beat-.4)*.065;p.rightForearm=.15+Math.sin(beat-.4)*.065;
 p.leftHand=-.04+Math.sin(beat-.8)*.055;p.rightHand=.04+Math.sin(beat-.8)*.055;
 for(const [side,offset] of [['left',0],['right',.5]]){
  const u=((phase+offset)%1+1)%1,stance=.62,swing=clamp((u-stance)/(1-stance));
  // The planted foot travels back at constant speed against the moving stage
  // position. A quintic swing joins that velocity at both ends, avoiding a
  // foot-stop at lift/landing. At least one foot always supports the body.
  const slope=-(1-stance)/stance,swingTravel=slope*swing+(1-slope)*easeMilo(swing);
  const slide=(u<stance?mix(50,-50,u/stance):mix(-50,50,swingTravel))*strideScale*direction;
  const lift=Math.sin(swing*PI)**2*19,ankle=MILO_MOTION_JOINTS[side].ankle;
  const walkingX=side==='left'?340:ankle[0];
  const target=[walkingX+slide-p.pelvisX*916-p.rootX*916,ankle[1]-lift-p.pelvisY*916-p.rootY*916];
  const dx=target[0]-414,dy=target[1]-655,c=Math.cos(-p.pelvisRot),s=Math.sin(-p.pelvisRot);
  const leg=solveMiloLeg(side,[414+dx*c-dy*s,655+dx*s+dy*c]);
  p[side+'Leg']=leg.leg;p[side+'Knee']=leg.knee;
  const roll=(u<stance?Math.sin(u/stance*TAU)*.055:-Math.sin(swing*PI)*.10);
  // Keep the boot level while hip and knee articulate, then add a small
  // independently authored ankle roll for toe-off and a relaxed swing.
  p[side+'Foot']=roll-leg.leg-leg.knee-p.pelvisRot;
 }
 for(const key of Object.keys(p))p[key]=mix(rest[key],p[key],amount);
}
// Quintic interpolation gives fresh, reproducible phrasing without per-frame
// random calls or a hard restart when a noise interval changes.
const hash=(n,seed=0)=>{const v=Math.sin(n*127.1+seed*311.7)*43758.5453123;return v-Math.floor(v);};
function drift(t,seed,period=4){const at=t/period,index=Math.floor(at);return mix(hash(index,seed),hash(index+1,seed),easeMilo(at-index))*2-1;}
function episode(t,period,seed){
 const index=Math.floor(t/period),local=t-index*period;
 const start=.6+hash(index,seed)*1.4,duration=2.8+hash(index,seed+1)*1.5;
 const phase=(local-start)/duration;
 return {index,local,phase,side:hash(index,seed+2)>.5?1:-1,kind:Math.floor(hash(index,seed+3)*3),amount:windowAt(phase,0,.25,.66,1)};
}
function idlePose(t,speaking,mouth){
 const p=neutral(),breath=Math.sin(t*1.44+Math.sin(t*.23)*.22),exhale=Math.sin(t*2.88+.4)*.13;
 const shift=drift(t,2,8.3)*.7+Math.sin(t*.41)*.3,soft=drift(t,5,4.7),interest=episode(t,12.7,11);
 p.bodyRot=shift*.017;p.rootX=shift*.0045;p.rootY=-(breath+exhale)*.002;p.bodyScaleY=1+(breath+exhale)*.0045;
 p.headRot=-shift*.016+drift(t,3,3.8)*.022;p.headY=-breath*.0015;
 p.leftUpper=-.09+soft*.035;p.rightUpper=.075-drift(t,7,5.1)*.032;
 p.leftForearm=.035+drift(t,17,3.7)*.035;p.rightForearm=-.025-drift(t,19,4.3)*.032;
 p.leftHand=drift(t,23,3.4)*.035;p.rightHand=drift(t,29,4.1)*.033;
 p.tailRot=Math.sin(t*.61-.9+drift(t,31,6)*.3)*.051;p.hatRot=-p.headRot*.12+Math.sin(t*.83-.35)*.003;
 p.eyeX=drift(t,37,3.1)*.0018;p.eyeY=drift(t,41,4.7)*.0008;
 // An occasional glance or relaxed hand adjustment, with generous stillness
 // between them. The head leads and the shoulders catch up more slowly.
 const glance=interest.amount*interest.side,follow=interest.amount*Math.sin(clamp(interest.phase)*PI);
 if(!speaking){
  p.headRot+=glance*.038;p.headX+=glance*.0025;p.eyeX+=glance*.0028;
  p.bodyRot-=glance*.008;p.tailRot-=glance*.016;
  if(interest.kind===0){p.headY-=interest.amount*.003;p.eyeY-=interest.amount*.0012;}
  else if(interest.kind===1){
   if(interest.side>0){p.rightUpper-=follow*.18;p.rightForearm-=follow*.12;p.rightHand+=follow*.075;}
   else{p.leftUpper+=follow*.17;p.leftForearm+=follow*.11;p.leftHand-=follow*.07;}
  }else{p.headRot+=interest.amount*.025;p.leftUpper-=follow*.065;p.rightUpper+=follow*.065;}
 }
 if(speaking){
  // A phrase is a small acting unit, not a constant metronomic arm loop. Each
  // has a preparation, two soft emphasis beats, a held palm and a quiet settle.
  const phrase=episode(t,6.8,53),u=phrase.phase,active=phrase.amount;
  const beat=windowAt(u,0,.22,.38,.64)+windowAt(u,.38,.53,.68,.92)*.65;
  const nod=active*(.026+Math.sin(u*TAU*1.2-.3)*.018);
  p.headRot+=nod;p.headY-=beat*.0038;p.bodyRot+=phrase.side*active*.012;
  // A low-energy open palm remains available even between larger phrases.
  p.rightUpper-=.12;p.rightForearm-=.035;
  if(phrase.side>0){p.rightUpper-=active*.20;p.rightForearm-=beat*.16;p.rightHand+=active*.075+beat*.035;p.leftUpper+=active*.065;}
  else{p.leftUpper+=active*.19;p.leftForearm+=beat*.14;p.leftHand-=active*.07+beat*.03;p.rightUpper-=active*.065;}
  p.bodyScaleY+=clamp(mouth)*.0012;p.hatRot-=nod*.1;
 }
 return p;
}
function attentionPose(x,y,expression,t){
 const p=neutral();p.bodyScaleY=0;
 p.headRot=x*.042+y*.012;p.headX=x*.004;p.headY=y*.0035;p.eyeX=x*.0046;p.eyeY=y*.0028;
 p.bodyRot=-x*.006;p.hatRot=-x*.004;
 if(expression==='curious'){p.headRot+=.024;p.headY-=.003;p.eyeY-=.0008;}
 else if(expression==='warm'){p.headRot-=.016;p.headY-=.0015;}
 else if(expression==='excited'){p.rootY=-.0025*(1-Math.cos(t*3.2));p.headY-=.003;p.tailRot=Math.sin(t*1.7)*.02;}
 else if(expression==='listening'){const nod=episode(t,5.9,71);p.headRot-=.022;p.headY+=nod.amount*Math.sin(clamp(nod.phase)*TAU)*.003;}
 return p;
}
function magicPose(p,t,progress,id){
 const silk=id==='silk-stars',duration=getMagicCue(id)?.duration||(silk?15:14),u=clamp(progress>=0?progress:t/duration),seconds=u*duration;
 const prepare=windowAt(u,0,.10,.16,.24),spell=windowAt(u,.12,.25,.68,.82),reveal=windowAt(u,.61,.73,.86,.96),settle=1-ramp(u,.90,1);
 if(silk){
  // The wrist leads the ribbon. Elbow, shoulder and torso follow more slowly.
  p.rightUpper=-.16-spell*(.48+Math.sin(seconds*1.25-.7)*.15)-reveal*.12;
  p.rightForearm=-.12-spell*(.37+Math.sin(seconds*1.8)*.27);
  p.rightHand=spell*(Math.sin(seconds*2.2+.6)*.30)+reveal*.12;
  p.leftUpper=.10+prepare*.20+spell*(.22+Math.sin(seconds*1.25+1.7)*.11)+reveal*.22;
  p.leftForearm=.08+spell*(.25+Math.sin(seconds*1.8+1.1)*.15);
  p.leftHand=spell*Math.sin(seconds*1.9-1)*.16;
  p.bodyRot=Math.sin(seconds*1.25-.9)*.023*spell;p.headRot=-Math.sin(seconds*1.25-.5)*.048*spell-reveal*.035;
  p.headY=-reveal*.007;p.rootY=-Math.sin(seconds*1.8)*.003*spell;
 }else if(id==='star-hat'){
  p.rightUpper=-.15-prepare*.18-spell*.65-reveal*.13;
  p.rightForearm=-.10-prepare*.25-spell*(.33+Math.sin(seconds*1.5)*.13);
  p.rightHand=prepare*.12+spell*Math.sin(seconds*1.8)*.19+reveal*.18;
  p.leftUpper=.08+prepare*.66+spell*.26+reveal*.37;
  p.leftForearm=.04+prepare*.48+spell*.18+reveal*.14;
  p.leftHand=prepare*.15+spell*Math.sin(seconds*1.35+.5)*.09;
  p.headRot=prepare*.045-spell*.065+reveal*.025;p.headY=-spell*.009;
  p.hatRot=-prepare*.045+spell*Math.sin(seconds*.8)*.018;p.hatLift=prepare*.005;
  p.bodyRot=prepare*.025-spell*.015;p.rootY=-spell*.004;
 }
 if(id!=='star-hat'&&!silk){
  const hold=windowAt(u,.10,.22,.77,.92),turn=Math.sin(seconds*1.35),revealAt=ramp(u,.40,.65),flourish=windowAt(u,.51,.67,.78,.91);
  p.rightUpper=-.24-hold*.36;p.rightForearm=-.15-hold*.34;p.rightHand=Math.sin(seconds*1.2)*.16*hold;
  p.leftUpper=.16+hold*.24;p.leftForearm=.12+hold*.16;
  p.headRot=-hold*.04+flourish*.025;p.headY=-flourish*.005;p.bodyRot=-hold*.012;p.eyeX=-hold*.002;
  switch(id){
   case 'flower-hat':
    p.leftUpper+=prepare*.38+flourish*.17;p.leftForearm+=prepare*.36;p.leftHand=-hold*.18;
    p.rightUpper-=spell*.12;p.rightHand+=flourish*.16;p.headRot-=flourish*.02;break;
   case 'linking-rings': {
    const gap=105-50*revealAt+Math.sin(seconds*1.1)*9*hold;
    // Keep room for each elbow: a destination too close to the shoulder
    // folds the forearm through its ±PI boundary and reverses its easing.
    aim(p,'left',414-gap,565+turn*8*hold,1);aim(p,'right',414+gap,565-turn*8*hold,-1);
    p.leftHand=-turn*.25*hold;p.rightHand=turn*.25*hold;p.headRot=turn*.025*hold;break;
   }
   case 'floating-table':
    p.leftUpper=.20+hold*.40;p.rightUpper=-.20-hold*.40;
    p.leftForearm=.14+hold*.32;p.rightForearm=-.14-hold*.32;
    p.leftHand=-hold*.28;p.rightHand=hold*.28;p.rootY=-flourish*.004;break;
   case 'rainbow-cube':
    p.leftUpper=.18+hold*(.25+turn*.13);p.rightUpper=-.20-hold*(.25-turn*.13);
    p.leftForearm=.30*hold-turn*.15*hold;p.rightForearm=-.30*hold-turn*.15*hold;
    p.leftHand=turn*.35*hold;p.rightHand=-turn*.35*hold;p.bodyRot=turn*.019*hold;break;
   case 'cookie-mystery':
    p.rightUpper=-.25-hold*.42+flourish*.23;p.rightForearm=-.13-hold*.27+flourish*.19;
    p.leftUpper=.10+flourish*.50;p.leftForearm=.04+flourish*.38;p.headRot=prepare*.08-flourish*.09;p.headY=prepare*.008-flourish*.008;break;
   case 'star-rabbit':
    p.leftUpper=.14+prepare*.67+flourish*.25;p.leftForearm=.08+prepare*.49+flourish*.22;
    p.rightUpper-=revealAt*.20*settle;p.rightForearm-=flourish*.21;p.hatLift=prepare*.007;p.headRot=-flourish*.06;break;
   case 'bubble-world':
    p.leftUpper=.15+hold*(.20+revealAt*.33);p.rightUpper=-.15-hold*(.20+revealAt*.33);
    p.leftForearm=.12+hold*.20;p.rightForearm=-.12-hold*.20;p.leftHand=-hold*.2;p.rightHand=hold*.2;
    p.headY=-revealAt*.007*settle;p.bodyScaleY=1+flourish*.008;break;
   case 'reverse-hourglass':
    p.rightHand=Math.sin((u-.15)*Math.PI*2)*.55*hold;p.rightForearm=-.1-hold*.42;
    p.leftUpper=.2+hold*.36;p.leftForearm=.1+hold*.29;p.headRot=-p.rightHand*.10;break;
   case 'wand-multiplication':
    p.rightHand=turn*.36*hold;p.rightUpper=-.15-hold*(.45+flourish*.12);
    p.leftUpper=.12+flourish*.45;p.leftForearm=.06+flourish*.35;p.leftHand=-flourish*.16;break;
   case 'banana-surprise':
    p.leftUpper=.10+prepare*.64+flourish*.39;p.leftForearm=.08+prepare*.44+flourish*.30;
    p.rightUpper=-.15-hold*.34-flourish*.12;p.rightForearm=-.1-hold*.22;
    p.headRot=prepare*.04-flourish*.11;p.headY=-flourish*.012;p.rootY=-flourish*.004;break;
  }
 }
 p.tailRot=Math.sin(seconds*.8-.6)*.055;p.bodyScaleY=1+Math.sin(seconds*1.4)*.004;
 // A small closing bow acknowledges the reveal and smoothly returns to neutral.
 const bow=windowAt(u,.83,.89,.93,.995);p.headRot+=bow*.11;p.headY+=bow*.006;p.bodyScaleY-=bow*.012;
 for(const k of ['leftUpper','leftForearm','leftHand','rightUpper','rightForearm','rightHand'])p[k]*=settle;
}

export function miloPoseAt({time=0,idleTime=time,motion='idle',energy=1,blend=1,speaking=false,mouth=0,magicProgress=-1,magicId='star-hat',reducedMotion=false,attentionX=0,attentionY=0,expression='neutral',walkStride=1,walkDirection=1,walkPhase=null}={}){
 const t=finite(time),it=finite(idleTime,t),e=clamp(finite(energy,1),0,1.6),b=clamp(finite(blend,1));
 if(reducedMotion||e===0)return neutral();
 const base=idlePose(it,(speaking&&['idle','speak'].includes(motion))||motion==='speak',clamp(finite(mouth))),p={...base};
 if(['wave','welcome'].includes(motion)){
  // A raised upper arm, a greeting arc at the elbow, and a smaller wrist wave.
  p.leftUpper=.86+Math.sin(t*1.8)*.045;p.leftForearm=.62+Math.sin(t*5.4)*.20;p.leftHand=Math.sin(t*6.5+.4)*.25;
  p.rightUpper=.08+Math.sin(t*1.8-.5)*.035;p.rightForearm=-.055;
  p.headRot=-.04+Math.sin(t*1.8-.5)*.035;p.bodyRot=.018+Math.sin(t*1.8-.8)*.012;
  p.tailRot=Math.sin(t*1.35-1)*.07;p.eyeX=-.003;
  if(motion==='welcome'){p.rightUpper=-.25-Math.sin(t*1.2)*.12;p.rightForearm=-.18;p.rootY=-.004*Math.sin(t*1.8);}
 }else if(motion==='point'){
  p.rightUpper=-.72+Math.sin(t*1.4-.6)*.018;p.rightForearm=.21+Math.sin(t*1.8)*.035;p.rightHand=-.16+Math.sin(t*1.7-.3)*.023;
  p.leftUpper=-.12;p.leftForearm=.12;p.bodyRot=-.035;p.headRot=.065;p.headX=.004;p.eyeX=.004;
 }else if(['cheer','celebrate'].includes(motion)){
  const bounce=(1-Math.cos(t*3.7))/2;
  p.leftUpper=.88;p.leftForearm=.65+Math.sin(t*3.7)*.08;p.leftHand=.08+Math.sin(t*4.4)*.13;
  p.rightUpper=-.88;p.rightForearm=-.62-Math.sin(t*3.7)*.08;p.rightHand=-.08-Math.sin(t*4.4)*.13;
  p.rootY=-bounce*.018;p.bodyScaleY=1+bounce*.012;p.headY=-bounce*.005;p.headRot=Math.sin(t*1.85)*.035;
  p.tailRot=Math.sin(t*1.85-1)*.09;p.leftFoot=-bounce*.035;p.rightFoot=bounce*.035;
 }else if(['think','listen','look'].includes(motion)){
  const thought=motion==='think',interest=motion==='listen';
  const response=episode(it,5.9,67),nod=response.amount*Math.sin(clamp(response.phase)*TAU);
  if(thought){aim(p,'right',506,376,-1);p.rightHand=-.14;p.headRot=.085+drift(it,73,3.7)*.018;p.headX=.003;p.eyeX=.002+drift(it,79,2.7)*.001;p.leftForearm+=response.amount*.04;}
  else{p.leftUpper=-.12;p.rightUpper=.11;p.leftForearm=.08;p.rightForearm=-.11;p.headRot=(interest?-.075:.06)+nod*.022;p.eyeX=(interest?-.0025:.003)+drift(it,83,3.3)*.001;}
  p.headY=-.003+Math.sin(t*1.3)*.0015+nod*.003;p.bodyRot=-p.headRot*.2;p.tailRot=Math.sin(t*.6)*.025;
 }else if(motion==='clap'){
  // Meet in front of the waistcoat, not outside the body. A quintic beat gives
  // each contact a brief soft stop, then separates the hands for the next clap.
  const contact=easeMilo((1-Math.cos(t*5.6))/2),gap=mix(120,44,contact),center=417,y=530+Math.sin(t*2.8)*4;
  aim(p,'left',center-gap/2,y,1);aim(p,'right',center+gap/2,y,-1);
  p.leftHand=-.10-contact*.06;p.rightHand=.10+contact*.06;
  p.bodyRot=Math.sin(t*2.8)*.009;p.bodyScaleY=1+contact*.004;p.headRot=Math.sin(t*2.8-.3)*.027;p.headY=-contact*.003;
  p.tailRot=Math.sin(t*1.4-.8)*.055;
 }else if(motion==='dance'){
  const beat=Math.sin(t*3.5),follow=Math.sin(t*3.5-.55),bounce=(1-Math.cos(t*7))/2;
  p.rootX=beat*.014;p.rootY=-bounce*.012;p.bodyRot=beat*.055;p.bodyScaleY=1+bounce*.006;
  p.headRot=-follow*.07;p.headX=-beat*.003;p.tailRot=-Math.sin(t*3.5-.9)*.13;
  p.leftUpper=.31+beat*.30;p.leftForearm=.19+follow*.22;p.leftHand=Math.sin(t*3.5-1)*.16;
  p.rightUpper=-.31+beat*.30;p.rightForearm=-.19+follow*.22;p.rightHand=Math.sin(t*3.5-1)*.16;
  p.leftLeg=beat*.075;p.rightLeg=-beat*.075;p.leftFoot=-beat*.04;p.rightFoot=beat*.04;
 }else if(motion==='surprise'){
  p.leftUpper=.48;p.leftForearm=.42;p.leftHand=.15;p.rightUpper=-.48;p.rightForearm=-.42;p.rightHand=-.15;
  p.headRot=-.025+Math.sin(t*1.7)*.012;p.headY=-.012+Math.sin(t*2)*.0015;p.rootY=-.007;p.bodyScaleY=1.018;p.eyeY=-.0015;p.tailRot=.07+Math.sin(t*.9)*.015;
 }else if(motion==='bow'){
  const bow=windowAt(t,0,.95,2.35,3.7);
  p.bodyRot=-.025*bow;p.bodyScaleY=1-.042*bow;p.rootY=.009*bow;p.headRot=.19*bow;p.headY=.023*bow;
  p.leftUpper=-.30*bow;p.leftForearm=-.20*bow;p.leftHand=-.08*bow;
  p.rightUpper=.19*bow;p.rightForearm=.38*bow;p.rightHand=.10*bow;p.tailRot=-.08*bow;p.hatRot=.025*bow;
 }else if(['walk','enter','exit'].includes(motion)){
  walkPose(p,t,{walkStride,walkDirection,walkPhase});
 }else if(motion==='magic'||magicProgress>=0){magicPose(p,t,finite(magicProgress,-1),magicId);}
 const result={};
 for(const key of Object.keys(base)){
  const zero=key==='bodyScaleY'?1:0,rest=zero+(base[key]-zero)*e;
  // Hands and planted feet have physical destinations. Scaling their solved
  // angles separately would miss a clap or push a walking boot off its floor.
  // Keep the whole leg/pelvis chain consistent at normal/high energy.
  const aimedArms=/Upper|Forearm|Hand/.test(key)&&(motion==='clap'||(motion==='think'&&key.startsWith('right')));
  const aimedWalk=['walk','enter','exit'].includes(motion)&&/^(?:(?:left|right)(?:Leg|Knee|Foot)|pelvis(?:X|Y|Rot)|root(?:X|Y))$/.test(key);
  const aimed=aimedArms||aimedWalk;
  const target=aimed?mix(rest,p[key],Math.min(e,1)):zero+(p[key]-zero)*e;
  result[key]=mix(rest,target,b);
 }
 // Contextual attention yields to the cue's choreography, while its blend
 // edges return to exactly the same ongoing idle/attention pose.
 const free=['idle','speak','listen','look','think'].includes(motion),weight=(free?1:1-b)*e;
 const attention=attentionPose(clamp(finite(attentionX),-1,1),clamp(finite(attentionY),-1,1),expression,it);
 for(const key of Object.keys(result))result[key]+=attention[key]*weight;
 return result;
}

/** A critically damped transition between sampled poses. It is presentation-only:
 * paused draws return the exact previous pose, seek/scrub can bypass smoothing,
 * and an interrupted gesture can settle without snapping to a different pose.
 */
export function createMiloPoseSmoother(){
 let current=null,velocity={};
 return {
  sample(target,{deltaTime=1/60,paused=false,seek=false}={}){
   if(!current||seek){current={...target};velocity={};return {...current};}
   if(paused)return {...current};
   const dt=clamp(finite(deltaTime,1/60),0,.12);if(dt===0)return {...current};
   for(const key of Object.keys(target)){
    const value=finite(target[key],key==='bodyScaleY'?1:0),omega=/Hand|Forearm/.test(key)?19:/head|hat/.test(key)?15:13;
    const displacement=current[key]-value,v=velocity[key]||0,decay=Math.exp(-omega*dt),common=v+omega*displacement;
    current[key]=value+(displacement+common*dt)*decay;velocity[key]=(v-omega*common*dt)*decay;
   }
   return {...current};
  },
  reset(pose=null){current=pose?{...pose}:null;velocity={};},
  snapshot(){return current?{...current}:null;},
 };
}
