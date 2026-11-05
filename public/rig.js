// Raster puppet rig. All character artwork comes from the generated atlases.
export const MOTIONS = ['idle','wave','welcome','cheer','think','bow','look','point'];
export const EXPRESSIONS = ['neutral','happy','surprised','thinking'];
export const durations = {idle:0,wave:4400,welcome:3600,cheer:5000,think:4100,bow:3600,look:3200,point:3800};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ease=v=>{v=clamp(v,0,1);return v*v*(3-2*v)};
const rad=v=>v*Math.PI/180;
export function poseAt(motion,elapsed,energy=65,idle=true,time=0){
  const a=clamp(energy,0,100)/100;
  const breath=idle?Math.sin(time*1.6):0;
  const p={left:idle?Math.sin(time*1.2)*.018*a:0,right:idle?-Math.sin(time*1.2+.6)*.018*a:0,head:idle?Math.sin(time*.68)*.013*a:0,body:idle?Math.sin(time*.85)*.006*a:0,bounce:breath*2.4*a,stretch:1+breath*.002*a,lean:0,cheer:0};
  const duration=durations[motion]??0;
  if(!duration)return p;
  const t=clamp(elapsed/duration,0,1);
  const envelope=ease(t/.19)*ease((1-t)/.2);
  const gesture=.65+.35*a;
  if(motion==='wave'){p.left+=rad(139+Math.sin(elapsed*.009)*10*a)*envelope;p.head+=rad(-3)*envelope;}
  if(motion==='welcome'){p.left+=rad(31)*envelope*gesture;p.right-=rad(31)*envelope*gesture;p.head+=Math.sin(t*Math.PI*4)*.035*envelope;}
  if(motion==='cheer'){p.left+=rad(107+Math.sin(elapsed*.011)*9*a)*envelope;p.right-=rad(107+Math.sin(elapsed*.011+.5)*9*a)*envelope;p.bounce-=Math.abs(Math.sin(elapsed*.007))*28*a*envelope;p.head+=Math.sin(elapsed*.006)*.035*a*envelope;p.cheer=envelope;}
  if(motion==='think'){p.head+=rad(10)*envelope;p.right-=rad(10)*envelope;p.body+=rad(-1.5)*envelope;}
  if(motion==='bow'){p.stretch-=.09*Math.sin(t*Math.PI)**2;p.head+=rad(8)*envelope;p.left+=rad(10)*envelope;p.right-=rad(10)*envelope;p.bounce+=30*Math.sin(t*Math.PI)**2;}
  return p;
}
const PARTS={
  torso:[588,83,362,446],legs:[1051,41,441,488],left:[133,562,275,431],right:[649,562,274,431]
};
const HEADS=[[19,24,377,462],[400,23,372,463],[771,25,377,462],[1151,24,375,463],[16,526,380,466],[397,528,378,464],[776,528,374,465],[1151,528,378,464]];
export class VlampieRig{
 constructor(parts,expressions,makeCanvas){
   this.parts=parts;this.expressions=expressions;this.makeCanvas=makeCanvas;
   this.heads=HEADS.map(r=>{const c=makeCanvas(400,490),x=c.getContext('2d');x.drawImage(expressions,...r,0,0,400,490);return c});
   this.mouths=this.heads.map(c=>this.patch(c,[110,355,184,99],12));
   this.eyes=this.heads.map(c=>this.patch(c,[66,238,277,126],13));
 }
 patch(source,box,feather){
   const [x,y,w,h]=box,c=this.makeCanvas(w,h),ctx=c.getContext('2d');
   ctx.drawImage(source,x,y,w,h,0,0,w,h);ctx.globalCompositeOperation='destination-in';
   const hor=ctx.createLinearGradient(0,0,w,0);hor.addColorStop(0,'transparent');hor.addColorStop(feather/w,'black');hor.addColorStop(1-feather/w,'black');hor.addColorStop(1,'transparent');ctx.fillStyle=hor;ctx.fillRect(0,0,w,h);
   const ver=ctx.createLinearGradient(0,0,0,h);ver.addColorStop(0,'transparent');ver.addColorStop(feather/h,'black');ver.addColorStop(1-feather/h,'black');ver.addColorStop(1,'transparent');ctx.fillStyle=ver;ctx.fillRect(0,0,w,h);ctx.globalCompositeOperation='source-over';
   return {canvas:c,box};
 }
 sprite(ctx,name,x,y,w,h){ctx.drawImage(this.parts,...PARTS[name],x,y,w,h)}
 arm(ctx,side,angle){
   ctx.save();ctx.translate(side==='left'?-149:149,550);ctx.rotate(angle);
   const ratio=.93;
   if(side==='left')this.sprite(ctx,'left',-228*ratio,-45*ratio,275*ratio,431*ratio);
   else this.sprite(ctx,'right',-47*ratio,-45*ratio,274*ratio,431*ratio);
   ctx.restore();
 }
 draw(ctx,width,height,{motion='idle',motionElapsed=0,energy=65,idle=true,time=0,expression='neutral',mouth=0,blink=false,overlay=false}={}){
   const pose=poseAt(motion,motionElapsed,energy,idle,time);
   const scale=Math.min(height*.88/1360,width*.94/860);
   ctx.save();ctx.translate(width/2,height*.065);ctx.scale(scale,scale);
   if(!overlay){ctx.save();ctx.translate(0,1355);ctx.scale(1,.16);const g=ctx.createRadialGradient(0,0,10,0,0,215);g.addColorStop(0,'rgba(0,4,25,.3)');g.addColorStop(1,'rgba(0,4,25,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,215,0,Math.PI*2);ctx.fill();ctx.restore();}
   // Hips stay anchored while upper body breathes, leans, and gestures.
   this.sprite(ctx,'legs',-227,854,454,502);
   ctx.translate(0,865);ctx.rotate(pose.body);ctx.scale(1,pose.stretch);ctx.translate(0,-865+pose.bounce);
   this.arm(ctx,'left',pose.left);this.arm(ctx,'right',pose.right);
   this.sprite(ctx,'torso',-181,448,362,446);
   ctx.save();ctx.translate(0,467);ctx.rotate(pose.head);ctx.translate(-200,-467);
   ctx.drawImage(this.heads[0],0,0);
   let eyes=expression==='surprised'?6:expression==='thinking'?7:0;
   let lips=expression==='happy'?5:expression==='surprised'?6:0;
   if(blink)eyes=1;
   if(mouth>0)lips=mouth;
   if(eyes){const p=this.eyes[eyes];ctx.drawImage(p.canvas,p.box[0],p.box[1])}
   if(lips){const p=this.mouths[lips];ctx.drawImage(p.canvas,p.box[0],p.box[1])}
   ctx.restore();ctx.restore();
 }
}
