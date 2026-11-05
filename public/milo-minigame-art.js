import {hash} from './bingo-motion.js?v=36';

export const TAU=Math.PI*2;
export const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export const mix=(a,b,t)=>a+(b-a)*t;
export const ease=v=>{const t=clamp(v);return t*t*t*(t*(t*6-15)+10);};
export const seededUnit=value=>hash(value)/4294967295;

// Secondary effects slow into the result instead of fluttering behind its name.
// Sampling this clock remains pure: pause, seeking and replay use identical art.
export function settledMagicTime(frame){
 if(frame.reduced)return 0;
 const time=Math.max(0,Number(frame.age)||0),finish=Math.max(0,(Number(frame.duration)||20)-1.2),brake=Math.min(2.4,finish*.14),start=finish-brake;
 if(time<=start||brake===0)return Math.min(time,finish);
 const u=clamp((time-start)/brake);return start+brake*(u-u*u*.5);
}
export function magicParticleAt(frame,index,{x=200,y=220,width=1520,height=550,seed='milo',strength=.6}={}){
 const time=settledMagicTime(frame),k=seededUnit(seed+':'+index),phase=((seededUnit(seed+':y'+index)-time*(7+k*7)/height)%1+1)%1;
 // A wrapped particle is fully transparent on both sides of its reset.
 const visible=ease(phase/.10)*ease((1-phase)/.10);
 return {x:x+seededUnit(seed+':x'+index)*width+Math.sin(time*.23+k*9)*5,y:y+phase*height,alpha:clamp(strength)*(.34+k*.20)*visible,radius:1.5+k*1.7,rotation:time*.025+k*TAU};
}

export function roundBox(c,x,y,w,h,r=20,fill='#25113e',stroke=null,lineWidth=2){
 c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=lineWidth;c.stroke();}
}
export function drawStar(c,x,y,r,fill='#ffe3a1',rotation=0,outline=null){
 c.save();c.translate(x,y);c.rotate(rotation);c.beginPath();
 for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,q=i%2?r*.43:r;i?c.lineTo(Math.cos(a)*q,Math.sin(a)*q):c.moveTo(Math.cos(a)*q,Math.sin(a)*q);}
 c.closePath();c.fillStyle=fill;c.fill();if(outline){c.strokeStyle=outline;c.lineWidth=Math.max(1,r*.035);c.stroke();}c.restore();
}
export function glow(c,x,y,r,strength=.5,color='#f4d28f'){
 if(strength<=0||r<=0)return;c.save();c.globalAlpha*=clamp(strength);
 const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color+'88');g.addColorStop(.42,color+'35');g.addColorStop(1,color+'00');c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);c.restore();
}
export function orb(c,x,y,r,color='#d5a7f0',light='#fff8e7'){
 c.save();c.shadowColor='#08031488';c.shadowBlur=r*.45;c.shadowOffsetY=r*.25;
 const g=c.createRadialGradient(x-r*.34,y-r*.42,r*.04,x+r*.16,y+r*.18,r*1.15);g.addColorStop(0,light);g.addColorStop(.25,color);g.addColorStop(.7,color);g.addColorStop(1,'#201230');c.fillStyle=g;c.beginPath();c.arc(x,y,r,0,TAU);c.fill();c.shadowBlur=0;c.shadowOffsetY=0;c.strokeStyle='#fff7df77';c.lineWidth=1.4;c.stroke();
 c.fillStyle='#ffffff70';c.beginPath();c.ellipse(x-r*.28,y-r*.43,r*.24,r*.105,-.5,0,TAU);c.fill();c.restore();
}
export function silkStroke(c,points,color='#8ee8dc',width=9){
 if(points.length<2)return;
 const path=()=>{c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x??p[0],p.y??p[1]):c.moveTo(p.x??p[0],p.y??p[1]));};
 c.save();c.lineJoin='round';c.lineCap='round';path();c.strokeStyle='#09051690';c.lineWidth=width+5;c.stroke();
 path();c.strokeStyle=color;c.lineWidth=width;c.stroke();c.translate(0,-width*.17);path();c.strokeStyle='#fff5e070';c.lineWidth=Math.max(1,width*.2);c.stroke();c.restore();
}
export function stagePlinth(c,{x=960,y=762,width=1430,depth=45,color='#57306d',accent='#e8c388'}={}){
 c.save();c.fillStyle='#08031077';c.beginPath();c.ellipse(x,y+depth*.75,width*.52,depth*1.3,0,0,TAU);c.fill();
 const face=c.createLinearGradient(0,y,0,y+depth);face.addColorStop(0,color);face.addColorStop(.5,'#241332');face.addColorStop(1,'#110b1e');roundBox(c,x-width/2,y,width,depth,16,face,accent+'77',2);
 const top=c.createLinearGradient(x-width/2,y-20,x+width/2,y+8);top.addColorStop(0,'#bc8bca');top.addColorStop(.24,color);top.addColorStop(.7,'#351c50');top.addColorStop(1,'#a078b6');
 c.fillStyle=top;c.beginPath();c.ellipse(x,y,width/2,depth*.43,0,0,TAU);c.fill();c.strokeStyle=accent+'aa';c.lineWidth=2;c.stroke();c.restore();
}
export function paintParticles(c,frame,{count=25,color='#eed69e',...options}={}){
 c.save();for(let i=0;i<count;i++){
  const particle=magicParticleAt(frame,i,options);if(particle.alpha<=.001)continue;
  c.save();c.globalAlpha*=particle.alpha;drawStar(c,particle.x,particle.y,particle.radius,color,particle.rotation);c.restore();
 }c.restore();
}
