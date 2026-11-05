import {miloPoseAt,createMiloPoseSmoother} from './milo-motion.js';

/**
 * Milo's original illustration, separated into rigid, overlapping source-pixel
 * pieces. Joints move the pieces, never stretch his face or the embroidery.
 * All coordinates below are measured on the 799 × 916 approved illustration.
 */
export const MILO_PUPPET_CALIBRATION=Object.freeze({
 width:799,height:916,
 body:[414,655],neck:[419,369],hat:[449,174],tail:[283,674],
 left:{shoulder:[286,423],elbow:[240,495],wrist:[187,528],hand:[125,536],hip:[373,661],ankle:[301,824],foot:[285,862]},
 right:{shoulder:[523,431],elbow:[568,500],wrist:[650,538],hand:[710,546],hip:[466,663],ankle:[476,817],foot:[518,853]},
 mouth:[365,294,105,73],eyes:[[347,213,60,51],[452,244,56,51]],
 irises:[[362,226,35,36],[459,256,33,33]],
});
const C=MILO_PUPPET_CALIBRATION;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const PARTS={
 tail:[[39,610],[105,588],[168,588],[231,603],[309,633],[331,683],[283,761],[203,811],[119,798],[48,763],[11,700],[12,635]],
 leftLeg:[[338,606],[421,627],[409,703],[381,765],[347,831],[314,856],[249,839],[260,785],[285,715],[309,650]],
 rightLeg:[[415,625],[505,610],[536,682],[523,746],[513,821],[480,845],[429,830],[421,760],[414,696]],
 leftFoot:[[266,800],[348,817],[351,850],[334,886],[292,903],[213,897],[209,867],[228,829]],
 rightFoot:[[427,801],[501,795],[540,815],[590,839],[610,872],[584,887],[502,885],[423,862]],
 torso:[[310,348],[461,360],[515,379],[539,413],[528,474],[542,542],[564,606],[582,677],[595,740],[572,774],[529,794],[493,762],[464,709],[415,675],[365,663],[324,713],[276,756],[231,774],[207,743],[210,686],[249,616],[275,558],[292,503],[297,447],[280,403]],
 leftUpper:[[269,375],[305,389],[318,433],[294,486],[253,522],[217,516],[208,486],[227,450],[230,415]],
 leftForearm:[[221,466],[265,482],[264,521],[234,557],[204,578],[174,580],[157,543],[165,498]],
 leftHand:[[112,459],[145,477],[176,495],[197,511],[195,548],[179,579],[135,588],[66,579],[47,556],[52,514],[83,489]],
 rightUpper:[[494,383],[534,393],[553,432],[579,468],[598,488],[590,528],[556,540],[529,507],[515,462],[501,430]],
 rightForearm:[[559,469],[605,477],[649,493],[669,513],[671,550],[654,581],[609,579],[572,552],[550,515]],
 rightHand:[[644,503],[674,489],[710,464],[733,475],[734,501],[769,511],[789,526],[785,559],[754,580],[699,587],[661,571],[639,545]],
 head:[[217,169],[250,109],[299,101],[339,126],[365,110],[536,128],[587,135],[614,164],[594,225],[615,291],[601,335],[563,370],[488,389],[419,386],[346,369],[291,346],[245,310],[219,255]],
 hat:[[331,22],[383,8],[483,18],[542,35],[560,70],[559,112],[549,153],[577,176],[600,212],[599,244],[577,263],[554,245],[525,219],[482,198],[427,179],[372,164],[338,154],[326,129]],
};
const I=[1,0,0,1,0,0];
function mul(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
const move=(x=0,y=0)=>[1,0,0,1,x,y];
function pivot(m,p,angle=0,sx=1,sy=1){const co=Math.cos(angle),si=Math.sin(angle);return mul(m,mul(move(...p),mul([co*sx,si*sx,-si*sy,co*sy,0,0],move(-p[0],-p[1]))));}
const point=(m,p)=>({x:m[0]*p[0]+m[2]*p[1]+m[4],y:m[1]*p[0]+m[3]*p[1]+m[5]});
const apply=(ctx,m)=>ctx.transform(...m);
function surface(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.ceil(w));c.height=Math.max(1,Math.ceil(h));return c;}
function polygon(ctx,points,dx=0,dy=0){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x-dx,y-dy):ctx.moveTo(x-dx,y-dy));ctx.closePath();}
function cropPart(image,points,subtract=[]){
 const minX=Math.max(0,Math.floor(Math.min(...points.map(p=>p[0])))-2),minY=Math.max(0,Math.floor(Math.min(...points.map(p=>p[1])))-2);
 const w=Math.min(C.width-minX,Math.ceil(Math.max(...points.map(p=>p[0])))-minX+3),h=Math.min(C.height-minY,Math.ceil(Math.max(...points.map(p=>p[1])))-minY+3);
 const canvas=surface(w,h),ctx=canvas.getContext('2d');
 polygon(ctx,points,minX,minY);ctx.clip();ctx.drawImage(image,0,0,image.naturalWidth||image.width,image.naturalHeight||image.height,-minX,-minY,C.width,C.height);
 for(const sub of subtract){ctx.globalCompositeOperation='destination-out';polygon(ctx,sub,minX,minY);ctx.fill();}
 return {canvas,x:minX,y:minY,w,h};
}
function maskedPatch(image,rect,{feather=false}={}){
 const [x,y,w,h]=rect,canvas=surface(w,h),ctx=canvas.getContext('2d');
 ctx.drawImage(image,x/C.width*(image.naturalWidth||image.width),y/C.height*(image.naturalHeight||image.height),w/C.width*(image.naturalWidth||image.width),h/C.height*(image.naturalHeight||image.height),0,0,w,h);
 ctx.globalCompositeOperation='destination-in';ctx.save();ctx.translate(w/2,h/2);ctx.scale(w/2,h/2);
 if(feather){const gradient=ctx.createRadialGradient(0,0,.7,0,0,1);gradient.addColorStop(0,'#fff');gradient.addColorStop(1,'#fff0');ctx.fillStyle=gradient;ctx.fillRect(-1,-1,2,2);}else{ctx.beginPath();ctx.arc(0,0,1,0,Math.PI*2);ctx.fill();}
 ctx.restore();return {canvas,x,y,w,h};
}
function neutralBounds(image){
 const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height,c=surface(w,h),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
 let bounds={x:26,y:24,w:749,h:874};
 try{const pixels=ctx.getImageData(0,0,w,h).data;let x0=w,y0=h,x1=0,y1=0;for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2)if(pixels[(y*w+x)*4+3]>100){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}if(x1>x0&&y1>y0)bounds={x:Math.max(0,x0-2)*C.width/w,y:Math.max(0,y0-2)*C.height/h,w:Math.min(w-x0,x1-x0+5)*C.width/w,h:Math.min(h-y0,y1-y0+5)*C.height/h};}catch{}
 c.width=c.height=1;return bounds;
}
function paint(ctx,part,m){ctx.save();apply(ctx,m);ctx.drawImage(part.canvas,part.x,part.y);ctx.restore();}
// The eye sockets stay fixed in the approved face. Only the source iris and
// its catchlights travel through a small clipped aperture, like a real gaze.
const EYE_APERTURES=[
 [[352,237],[355,226],[366,219],[380,218],[392,223],[399,235],[398,247],[392,254],[380,259],[366,253],[357,246]],
 [[457,269],[463,258],[474,251],[485,251],[494,258],[499,269],[496,279],[486,286],[473,285],[463,279]],
];
function gaze(ctx,irises,dx,dy,m){
 if(Math.abs(dx)+Math.abs(dy)<.025)return;
 ctx.save();apply(ctx,m);
 irises.forEach((iris,index)=>{
  const [x,y,w,h]=C.eyes[index];
  ctx.save();polygon(ctx,EYE_APERTURES[index]);ctx.clip();
  const sclera=ctx.createRadialGradient(x+w*.42,y+h*.30,1,x+w*.5,y+h*.55,w*.62);
  sclera.addColorStop(0,'#fffdfb');sclera.addColorStop(.72,'#f5eee9');sclera.addColorStop(1,'#bbb0a8');
  ctx.fillStyle=sclera;ctx.fillRect(x,y,w,h);
  // The small vertical range and slightly converged targets prevent wandering
  // eyes, while the original illustration supplies the actual iris texture.
  ctx.drawImage(iris.canvas,iris.x+dx,iris.y+dy,iris.w,iris.h);
  ctx.restore();
 });
 ctx.restore();
}
function closeLid(ctx,image,rect,amount,m,index){
 if(amount<.005)return;
 const [x,y,w,h]=rect;
 ctx.save();apply(ctx,m);ctx.beginPath();ctx.ellipse(x+w/2,y+h/2,w*.49,h*.48,0,0,Math.PI*2);ctx.clip();
 // Unobscured mask fur forms the lid. The small sample excludes whiskers,
 // white eyebrow markings and the iris; the opposite lid mirrors its grain.
 const fur=[324,219,20,12];
 if(index===0)ctx.drawImage(image,...fur,x,y,w,h);
 else{ctx.save();ctx.translate(x+w,y);ctx.scale(-1,1);ctx.drawImage(image,...fur,0,0,w,h);ctx.restore();}
 const aperture=Math.max(0,1-amount),height=h*aperture;
 if(height>.5)ctx.drawImage(image,x,y,w,h,x,y+(h-height)/2,w,height);
 if(amount>.65){
  ctx.globalAlpha*=clamp((amount-.65)/.35,0,1);
  const light=ctx.createLinearGradient(0,y,0,y+h);light.addColorStop(0,'#8c625633');light.addColorStop(.6,'#966b5544');light.addColorStop(1,'#24181511');ctx.fillStyle=light;ctx.fillRect(x,y,w,h);
  ctx.beginPath();ctx.moveTo(x+w*.07,y+h*.49);ctx.quadraticCurveTo(x+w*.5,y+h*.66,x+w*.93,y+h*.49);ctx.strokeStyle='#281a18';ctx.lineWidth=2.5;ctx.stroke();
 }
 ctx.restore();
}

export function createMiloPuppet(image,{talkImage=null,profile={}}={}){
 const bounds=neutralBounds(image),parts={};
 for(const [name,shape] of Object.entries(PARTS))parts[name]=cropPart(image,shape,name==='head'?[PARTS.hat]:[]);
 const mouthPatch=talkImage?maskedPatch(talkImage,C.mouth,{feather:true}):null;
 const irises=C.irises.map(rect=>maskedPatch(image,rect));
 const poseSmoother=createMiloPoseSmoother();
 const shoulderCaps={left:maskedPatch(image,[263,399,45,53]),right:maskedPatch(image,[503,405,42,51])};
 const elbowCaps={left:maskedPatch(image,[220,475,39,40]),right:maskedPatch(image,[549,481,40,39])};
 let previous=null,lastPose=null,lastFace=null,disposed=false;
 const stats={kind:'articulated',parts:Object.keys(parts).length,joints:17,triangles:0,source:'approved-milo-pixels'};
 function draw(ctx,opts={}){
  if(disposed)return null;
  const {x=0,y=0,height=500,time=0,idleTime=time,motion='idle',energy=1,speaking=false,mouth=0,blink=0,magicProgress=-1,magicId=null,alpha=1,motionBlend=1,deltaTime=1/60,paused=false,reducedMotion=false,immediate=false,attentionX=0,attentionY=0,expression='neutral'}=opts;
  let desired=miloPoseAt({time,idleTime,motion,energy,blend:motionBlend,speaking,mouth,magicProgress,magicId,reducedMotion,attentionX,attentionY,expression});
  const dt=clamp(Number(deltaTime)||0,0,.1),jump=previous&&Math.abs(Number(idleTime)-previous.time)>.5;
  // A frame-rate-independent critically damped spring carries momentum
  // through a change of performance, without a sudden shoulder/hand snap.
  // Pause retains exact pose values; explicit preview seeks bypass the spring.
  desired=poseSmoother.sample(desired,{deltaTime:dt,paused,seek:immediate||(!paused&&jump)||reducedMotion});
  lastPose={...desired};previous={time:Number(idleTime),motion};
  const pose=desired,face=paused&&lastFace&&!immediate?{...lastFace,mouth:speaking?lastFace.mouth:0}:{mouth:speaking?clamp(Number(mouth)||0,0,1):0,blink:reducedMotion?0:clamp(Number(blink)||0,0,1)};
  if(lastFace&&!paused&&!immediate){const f=1-Math.exp(-dt*28);face.mouth=lastFace.mouth+(face.mouth-lastFace.mouth)*f;}
  lastFace={...face};
  const scale=height/bounds.h,width=bounds.w*scale;
  let base=mul(move(x,y),mul([scale,0,0,scale,0,0],move(-bounds.x-bounds.w/2,-bounds.y-bounds.h)));
  base=mul(base,move((pose.rootX||0)*C.height,(pose.rootY||0)*C.height));
  const body=pivot(base,C.body,pose.bodyRot||0,1,pose.bodyScaleY||1);
  const head=pivot(mul(body,move((pose.headX||0)*C.height,(pose.headY||0)*C.height)),C.neck,pose.headRot||0);
  const leftUpper=pivot(body,C.left.shoulder,pose.leftUpper||0),rightUpper=pivot(body,C.right.shoulder,pose.rightUpper||0);
  const leftForearm=pivot(leftUpper,C.left.elbow,pose.leftForearm||0),rightForearm=pivot(rightUpper,C.right.elbow,pose.rightForearm||0);
  const leftHand=pivot(leftForearm,C.left.wrist,pose.leftHand||0),rightHand=pivot(rightForearm,C.right.wrist,pose.rightHand||0);
  const leftLeg=pivot(base,C.left.hip,pose.leftLeg||0),rightLeg=pivot(base,C.right.hip,pose.rightLeg||0);
  const leftFoot=pivot(leftLeg,C.left.ankle,pose.leftFoot||0),rightFoot=pivot(rightLeg,C.right.ankle,pose.rightFoot||0);
  const hat=pivot(mul(head,move(0,-clamp(pose.hatLift||0,-.006,.012)*C.height)),C.hat,pose.hatRot||0);
  ctx.save();ctx.globalAlpha*=alpha;ctx.imageSmoothingEnabled=true;
  paint(ctx,parts.tail,pivot(body,C.tail,pose.tailRot||0));
  paint(ctx,parts.leftLeg,leftLeg);paint(ctx,parts.rightLeg,rightLeg);paint(ctx,parts.leftFoot,leftFoot);paint(ctx,parts.rightFoot,rightFoot);
  // Upper sleeves behind the jacket; cuffs and hands remain naturally in front.
  paint(ctx,shoulderCaps.left,body);paint(ctx,shoulderCaps.right,body);
  paint(ctx,parts.leftUpper,leftUpper);paint(ctx,parts.rightUpper,rightUpper);
  paint(ctx,parts.torso,body);
  paint(ctx,elbowCaps.left,leftUpper);paint(ctx,elbowCaps.right,rightUpper);
  paint(ctx,parts.leftForearm,leftForearm);paint(ctx,parts.rightForearm,rightForearm);
  paint(ctx,parts.leftHand,leftHand);paint(ctx,parts.rightHand,rightHand);
  paint(ctx,parts.head,head);paint(ctx,parts.hat,hat);
  if(mouthPatch&&face.mouth>.015){
   const open=clamp(face.mouth*1.45,0,1),[mx,my,mw,mh]=C.mouth;
   ctx.save();apply(ctx,head);ctx.globalAlpha*=clamp(open*2.2,0,1);const h=mh*(.62+.38*open);ctx.drawImage(mouthPatch.canvas,mx,my+(mh-h)*.22,mw,h);ctx.restore();
  }
  gaze(ctx,irises,clamp((pose.eyeX||0)*C.height,-3.8,3.8),clamp((pose.eyeY||0)*C.height,-2.6,2.6),head);
  C.eyes.forEach((rect,index)=>closeLid(ctx,image,rect,face.blink,head,index));
  ctx.restore();
  const leftWrist=point(leftHand,C.left.wrist),rightWrist=point(rightHand,C.right.wrist),headAnchor=point(head,C.neck),hatAnchor=point(hat,C.hat),hands={left:point(leftHand,C.left.hand),right:point(rightHand,C.right.hand)};
  return {wrist:rightWrist,grip:hands.right,leftWrist,rightWrist,hands,head:headAnchor,hat:hatAnchor,bounds,width,height,triangles:0,pose:{...pose},stats};
 }
 return {draw,bounds,profile:{...profile,kind:'articulated'},stats,dispose(){disposed=true;for(const part of [...Object.values(parts),...Object.values(shoulderCaps),...Object.values(elbowCaps),...irises,mouthPatch].filter(Boolean))part.canvas.width=part.canvas.height=1;poseSmoother.reset();previous=lastPose=lastFace=null;}};
}
