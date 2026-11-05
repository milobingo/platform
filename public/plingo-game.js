import {hash,gameGroups,smooth} from './bingo-motion.js?v=36';
import {drawStar,paintParticles,settledMagicTime} from './milo-minigame-art.js';

const clamp=v=>Math.max(0,Math.min(1,v)),mix=(a,b,t)=>a+(b-a)*t,TAU=Math.PI*2;
export const PLINGO_BOARD=Object.freeze({left:135,right:1785,top:193,bottom:831,pinLeft:160,pinRight:1760,pinTop:260,pinStepX:160,pinStepY:46,rows:10,slotY:787,chipY:863});
const plans=new WeakMap();
/** A reveal path, never a draw. Every endpoint comes from the stored server winner.
 * Group membership and start position do not depend on which entrant won.
 */
export function plingoPlan(result,groups=gameGroups(result)){
 if(plans.has(result))return plans.get(result);
 const count=groups.length;if(!count)throw new TypeError('Plingo heeft minstens één deelnemer nodig.');
 const winnerIndex=groups.findIndex(g=>g.members.some(e=>e.bookId===result.winner.bookId));
 if(winnerIndex<0)throw new TypeError('De bevestigde winnaar ontbreekt in de deelnemerslijst.');
 const width=(PLINGO_BOARD.right-PLINGO_BOARD.left)/count;
 const slots=groups.map((group,index)=>({group,index,x:PLINGO_BOARD.left+(index+.5)*width,width}));
 const target=slots[winnerIndex],start={x:960,y:213,at:0},points=[start],impacts=[];
 // The upper lattice is a seeded bridge, not a physics-based winner picker.
 // Each row gives a real rebound arc. Timed impacts speed up through the upper
 // field and slow at the last pegs, so it does not drift at one fixed speed.
 const rights=Math.max(0,Math.min(PLINGO_BOARD.rows,Math.round(((target.x-start.x)/80+PLINGO_BOARD.rows)/2)));
 const directions=Array.from({length:PLINGO_BOARD.rows},(_,i)=>i<rights?1:-1);
 for(let i=directions.length-1;i>0;i--){const j=hash(result.id+':plingo-order:'+i)%(i+1);[directions[i],directions[j]]=[directions[j],directions[i]];}
 const times=[.035,.087,.140,.194,.250,.310,.377,.453,.548,.665];
 let pinX=start.x;
 for(let row=0;row<PLINGO_BOARD.rows;row++){
  const pinY=PLINGO_BOARD.pinTop+row*PLINGO_BOARD.pinStepY;
  const point={x:pinX,y:pinY-31,pinX,pinY,impact:true,at:times[row]};
  points.push(point);impacts.push({at:point.at,row,x:pinX,y:pinY,kind:'bump'});
  pinX+=directions[row]*80;
 }
 // A final left/right catch on the receiver lips hides the outcome until the
 // last beat. It is a reveal of the stored slot, never a fresh selection.
 const seedSide=hash(result.id+':plingo-last-catch')%2?1:-1;
 const nearMissIndex=count===1?winnerIndex:winnerIndex===0?1:winnerIndex===count-1?count-2:winnerIndex+seedSide;
 const nearMiss=slots[nearMissIndex],side=count===1?seedSide:Math.sign(nearMiss.x-target.x);
 const reach=Math.min(100,target.width*.44),safe=x=>Math.max(170,Math.min(1750,x));
 // The first catch belongs to an adjacent candidate, not the eventual winner.
 // Even with only two large cups the final choice remains visually open.
 const catchX=count===1?target.x+side*reach:nearMiss.x-side*Math.min(100,nearMiss.width*.44);
 points.push({x:safe(catchX),y:705,at:.775,impact:true,lip:true});
 points.push({x:safe(target.x-side*reach*.58),y:736,at:.885,impact:true,lip:true});
 points.push({x:target.x+side*Math.min(18,target.width*.08),y:766,at:.958,impact:true,lip:true});
 points.push({x:target.x,y:PLINGO_BOARD.slotY,at:1,impact:false});
 const plan={slots,points,impacts,winnerIndex,nearMissIndex,targetBookId:result.winner.bookId};plans.set(result,plan);return plan;
}
export function plingoPhase(progress){
 const p=clamp(Number(progress)||0);
 return p<.035?'release':p<.453?'upper':p<.775?'lower':p<.958?'last-bounce':p<1?'settling':'landed';
}
export function plingoBallPose(result,progress,groups){
 const plan=plingoPlan(result,groups),p=clamp(Number(progress)||0);let index=0;
 while(index<plan.points.length-2&&p>plan.points[index+1].at)index++;
 const a=plan.points[index],b=plan.points[index+1],t=p===1?1:clamp((p-a.at)/(b.at-a.at)),phase=plingoPhase(p);
 let x,y;
 if(index===0){x=a.x;y=mix(a.y,b.y,t*t);}
 else if(index===plan.points.length-2){
  const settle=1-(1-t)**3;x=mix(a.x,b.x,settle);y=mix(a.y,b.y,settle);
 }else{
  const final=index>=PLINGO_BOARD.rows,arc=final?(index===PLINGO_BOARD.rows?38:index===PLINGO_BOARD.rows+1?32:19):24+(hash(result.id+':arc:'+index)%12);
  x=mix(a.x,b.x,t);y=mix(a.y,b.y,t)-4*t*(1-t)*arc;
 }
 const nearImpact=Math.exp(-(((t)/.16)**2))*(a.impact?1:0)+Math.exp(-(((1-t)/.12)**2))*(b.impact?1:0);
 return {x,y,angle:p*18,impact:Math.min(1,nearImpact),segment:index,progress:p,phase,finished:p===1};
}
export function plingoChipPose(frame,group){const plan=plingoPlan(frame.result,frame.groups),slot=plan.slots[group.index];return {x:slot.x,y:PLINGO_BOARD.slotY,size:0,angle:0,chipX:slot.x,chipY:PLINGO_BOARD.chipY,width:Math.min(258,slot.width-12),height:54,progress:frame.progress};}
function box(c,x,y,w,h,r,fill,stroke){c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1.5;c.stroke();}}
function sphere(c,x,y,r,color,light='#fff8d7'){
 c.save();c.shadowColor='#0009';c.shadowBlur=14;c.shadowOffsetY=8;const g=c.createRadialGradient(x-r*.36,y-r*.42,r*.08,x+r*.18,y+r*.3,r*1.22);g.addColorStop(0,light);g.addColorStop(.27,color);g.addColorStop(.7,color);g.addColorStop(1,'#172e48');c.fillStyle=g;c.beginPath();c.arc(x,y,r,0,TAU);c.fill();c.shadowBlur=0;c.shadowOffsetY=0;c.strokeStyle='#fff8df80';c.lineWidth=1.1;c.stroke();c.fillStyle='#ffffff8a';c.beginPath();c.ellipse(x-r*.28,y-r*.47,r*.27,r*.12,-.5,0,TAU);c.fill();c.restore();
}
function star(c,x,y,r,fill,rotation=0){c.save();c.translate(x,y);c.rotate(rotation);c.beginPath();for(let j=0;j<10;j++){const a=-Math.PI/2+j*Math.PI/5,v=j%2?r*.43:r;j?c.lineTo(Math.cos(a)*v,Math.sin(a)*v):c.moveTo(Math.cos(a)*v,Math.sin(a)*v);}c.closePath();c.fillStyle=fill;c.fill();c.restore();}
export function drawPlingo(c,frame,assets,ui){
 const plan=plingoPlan(frame.result,frame.groups),b=PLINGO_BOARD,p=clamp(frame.progress),pose=plingoBallPose(frame.result,p,frame.groups),reveal=frame.reveal||0,milo=assets?.brandId==='milo',renderTime=settledMagicTime(frame);
 c.save();
 // Sculpted surround, a real inset playing surface and a lower receiving shelf.
 c.shadowColor='#000a';c.shadowBlur=34;c.shadowOffsetY=18;const rim=c.createLinearGradient(90,170,1830,865);rim.addColorStop(0,'#fff2c2');rim.addColorStop(.18,'#bd9761');rim.addColorStop(.5,milo?'#734179':'#564d61');rim.addColorStop(.78,'#d6b17b');rim.addColorStop(1,'#7f6648');box(c,108,183,1704,655,39,rim);c.shadowBlur=0;c.shadowOffsetY=0;
 const glass=c.createLinearGradient(0,198,0,824);glass.addColorStop(0,milo?'#39204e':'#172b45');glass.addColorStop(.46,milo?'#231239':'#102337');glass.addColorStop(1,milo?'#180e2b':'#081728');box(c,121,196,1678,626,29,glass,'#f8e7bc44');
 const hue=c.createRadialGradient(960,485,10,960,485,740);hue.addColorStop(0,'#8568be24');hue.addColorStop(.6,'#41ada215');hue.addColorStop(1,'#11243700');c.fillStyle=hue;c.fillRect(130,199,1660,617);
 if(milo){
  paintParticles(c,frame,{seed:frame.result.id+':plingo-sky',count:26,x:178,y:245,width:1564,height:466,strength:.35});
  for(const side of [-1,1]){
   const x=960+side*738,y=484,age=renderTime;
   ui.glow(c,x,y,65,.18,'#99e7dd');c.save();c.translate(x,y);c.rotate(side*.14);c.strokeStyle='#d2b6e14d';c.lineWidth=2;c.beginPath();c.ellipse(0,0,15,74,0,0,TAU);c.stroke();
   for(let i=0;i<5;i++){const a=i*TAU/5+age*.13;drawStar(c,Math.cos(a)*18,Math.sin(a)*67,3,'#ead1a9',a);}c.restore();
  }
 }
 // The faceted side panels give the board a shallow showcase perspective.
 for(const side of [-1,1]){const x=side<0?123:1797;c.fillStyle='#b2dbdf15';c.beginPath();c.moveTo(x,220);c.lineTo(x+side*20,247);c.lineTo(x+side*20,788);c.lineTo(x,817);c.closePath();c.fill();c.strokeStyle='#91dbd877';c.lineWidth=2;c.beginPath();c.moveTo(x,230);c.lineTo(x,789);c.stroke();}
 // Soft LED horizon and moving light washes, no busy striping.
 c.strokeStyle='#79e4d67a';c.lineWidth=2;c.beginPath();c.moveTo(166,219);c.bezierCurveTo(650,192,1270,192,1754,219);c.stroke();
 for(let row=0;row<b.rows;row++)for(let col=0;col<20;col++){
  const x=b.pinLeft+col*b.pinStepX+row%2*80,y=b.pinTop+row*b.pinStepY;if(x>b.pinRight)continue;
  const d=Math.hypot(x-pose.x,y-pose.y),lit=smooth(Math.max(0,1-d/105));
  if(lit>.001)ui.glow(c,x,y,36,lit*.32,'#ead69c');
  c.save();c.shadowColor='#0008';c.shadowBlur=5;c.shadowOffsetY=5;const peg=c.createLinearGradient(x-7,y-8,x+7,y+9);peg.addColorStop(0,'#d1e8e9');peg.addColorStop(.5,'#80b6bd');peg.addColorStop(1,'#2d5668');c.fillStyle=peg;c.beginPath();c.arc(x,y,8.2,0,TAU);c.fill();c.shadowBlur=0;c.shadowOffsetY=0;c.globalAlpha*=lit*.62;c.fillStyle='#fff0b0';c.fill();c.restore();
 }
 // Receiving cups keep their fixed group order; no winning slot is marked early.
 for(const slot of plan.slots){const win=slot.index===plan.winnerIndex?smooth(reveal):0,color=ui.palettes[slot.index%ui.palettes.length],w=slot.width-12;
  const cup=c.createLinearGradient(0,740,0,814);cup.addColorStop(0,'#36516c66');cup.addColorStop(1,'#071423');box(c,slot.x-w/2,744,w,70,14,cup,color+'66');
  if(win>0){c.save();c.globalAlpha=win;box(c,slot.x-w/2,744,w,70,14,'#d9ad4250','#ffe6a4');c.restore();}
  // Identical rounded catch lips on every receiver make the last ricochets
  // readable, without marking the winning cup before the reveal.
  const lip=Math.min(100,slot.width*.44);
  for(const side of [-1,1]){sphere(c,slot.x+side*lip,744,8,'#9e839d','#eee6db');sphere(c,slot.x+side*lip*.58,775,6,'#8b758b','#e4dacf');}
  c.strokeStyle=color+'66';c.lineWidth=2.3;c.beginPath();c.moveTo(slot.x-w/2,747);c.lineTo(slot.x-w/2,796);c.quadraticCurveTo(slot.x-w/2,814,slot.x-w/2+18,814);c.lineTo(slot.x+w/2-18,814);c.quadraticCurveTo(slot.x+w/2,814,slot.x+w/2,796);c.lineTo(slot.x+w/2,747);c.stroke();
  if(win>0){ui.glow(c,slot.x,783,Math.min(105,w*.7),win*.65,'#f8dc92');c.save();c.globalAlpha*=win;for(let n=0;n<5;n++)star(c,slot.x+(n-2)*Math.min(24,w/7),750-Math.sin(n+renderTime*1.7)*9,3+reveal*2,'#fff0ac',renderTime*.1);c.restore();}
 }
 // The ball is the focal point. A small translucent tail is enough; several
 // luminous ghost balls and orbiting stars made tracking needlessly noisy.
 if(p>0&&p<1)for(let i=3;i>0;i--){const old=plingoBallPose(frame.result,Math.max(0,p-i*.0025),frame.groups);c.save();c.globalAlpha=(1-i/4)*.10;sphere(c,old.x,old.y,27-i,'#e9c579');c.restore();}
 ui.glow(c,pose.x,pose.y,64,.22+reveal*.22,'#f8d28a');sphere(c,pose.x,pose.y,31,'#eac06e');star(c,pose.x,pose.y,11,'#fff7d5',pose.angle);
 if(p>=1)ui.winnerHalo(c,pose.x,pose.y,42,reveal,frame.age);
 // The release mechanism sits in a small metal bridge over the board.
 box(c,882,192,156,38,12,'#152940','#caaf7b99');ui.label(c,p===0?'PLINGO':pose.phase==='last-bounce'?'DE LAATSTE STUITER…':pose.phase==='settling'?'WAAR LANDT HIJ?':'VOLG DE GOUDEN BAL',960,211,p===0?18:11,'#ffe9b4',142);
 c.restore();
 return pose;
}
