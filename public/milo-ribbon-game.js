import {clamp,mix,ease,TAU,roundBox,drawStar,glow,orb,silkStroke,stagePlinth,paintParticles,seededUnit,settledMagicTime} from './milo-minigame-art.js';

const colors=['#a47fe3','#77ddd1','#f4bd77','#e693ba','#90aee8','#a5d49a','#cf91de','#79c6e0','#e9c78d','#c8a9e7'];
const entryX=(f,g)=>160+(g.index+.5)*1600/f.groups.length;
const lerpPoint=(a,b,t)=>({x:mix(a[0],b[0],t),y:mix(a[1],b[1],t)});

/** Silk is a clock-sampled reveal, never a simulation or a choice of winner.
 * Every strand follows the same schedule. Its source ID only varies the weave.
 */
export function ribbonPathAt(frame,group,t){
 t=clamp(t);const seed=seededUnit(frame.result.id+':silk:'+group.id),x=entryX(frame,group),side=group.index%2?1:-1,open=ease((frame.progress-.72)/.28);
 const knots=[[x,763],[x+side*30,660],[960+side*(480+seed*45),615],[960+side*(430+seed*35),310],[960-side*(135+seed*75),360],[960-side*(210+seed*65),565],[960+side*(190+seed*30),570],[960+side*(130+seed*45),385],[x-side*25,680],[x,763]];
 // Catmull-Rom passes through the weave landmarks with continuous tangents.
 const n=knots.length-1,u=t*n,i=Math.min(n-1,Math.floor(u)),q=t===1?1:u-i;
 const a=knots[Math.max(0,i-1)],b=knots[i],c=knots[i+1],d=knots[Math.min(n,i+2)];
 const sample=k=>.5*((2*b[k])+(-a[k]+c[k])*q+(2*a[k]-5*b[k]+4*c[k]-d[k])*q*q+(-a[k]+3*b[k]-3*c[k]+d[k])*q*q*q);
 const wave=Math.sin(t*Math.PI*8+seed*TAU)*Math.sin(t*Math.PI)*6;
 let px=sample(0)+wave,py=sample(1);
 // In the final act every strand unknots together; winner remains hidden.
 const straight={x:mix(x,960+side*35,Math.sin(t*Math.PI)),y:763-Math.sin(t*Math.PI)*(310+seed*60)};
 px=mix(px,straight.x,open*.58);py=mix(py,straight.y,open*.58);
 return {x:px,y:py};
}
function trimPath(frame,group,p){const count=Math.max(1,Math.ceil(p*155));return Array.from({length:count+1},(_,i)=>ribbonPathAt(frame,group,Math.min(p,i/155)));}
function wall(c,points){
 c.save();c.lineCap='round';c.lineJoin='round';c.shadowColor='#060111';c.shadowBlur=8;c.shadowOffsetY=7;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle='#7b4e83';c.lineWidth=19;c.stroke();c.shadowBlur=0;c.shadowOffsetY=0;c.strokeStyle='#d0a67d';c.lineWidth=11;c.stroke();c.translate(0,-3);c.strokeStyle='#fff1c27a';c.lineWidth=2;c.stroke();c.restore();
}
export function drawRibbonGame(c,frame,assets,ui,poses){
 const p=clamp(frame.progress),r=clamp(frame.reveal||0),time=settledMagicTime(frame),open=ease((p-.72)/.28),palette=ui.palettes?.length?ui.palettes:colors;
 c.save();
 const surround=c.createLinearGradient(180,212,1730,791);surround.addColorStop(0,'#c89ad5');surround.addColorStop(.13,'#6a367f');surround.addColorStop(.5,'#341747');surround.addColorStop(.85,'#7e4a91');surround.addColorStop(1,'#c8a3d0');
 c.shadowColor='#080210aa';c.shadowBlur=30;c.shadowOffsetY=17;roundBox(c,154,219,1612,573,35,surround,'#e5c594',3);c.shadowBlur=0;c.shadowOffsetY=0;
 const inset=c.createLinearGradient(0,234,0,776);inset.addColorStop(0,'#32204e');inset.addColorStop(.5,'#1a1132');inset.addColorStop(1,'#251337');roundBox(c,173,237,1574,536,25,inset,'#f1d3a133',1.5);
 glow(c,960,473,540,.38,'#a875dd');glow(c,960,662,370,.16,'#6ce6da');
 paintParticles(c,frame,{seed:frame.result.id+':ribbons',count:32,x:210,y:257,width:1500,height:455,strength:.42});
 const walls=[[[390,330],[650,330],[650,280],[835,280]],[[1085,280],[1280,280],[1280,330],[1530,330]],[[335,415],[540,415],[540,550],[410,550]],[[1585,415],[1380,415],[1380,550],[1510,550]],[[545,657],[710,657],[710,605]],[[1375,657],[1210,657],[1210,605]],[[805,335],[805,402]],[[1115,335],[1115,402]],[[850,640],[1070,640]]];
 for(const path of walls)wall(c,path);
 // Dim complete paths aid tracking without marking any finalist as a favourite.
 for(const g of frame.groups){const color=palette[g.index%palette.length],pts=trimPath(frame,g,1);c.save();c.globalAlpha=.10;silkStroke(c,pts,color,7);c.restore();}
 for(const g of frame.groups){
  const color=palette[g.index%palette.length],pts=trimPath(frame,g,p),tip=ribbonPathAt(frame,g,p),seed=seededUnit(frame.result.id+':spark:'+g.id);
  silkStroke(c,pts,color,9);glow(c,tip.x,tip.y,24,.52,color);orb(c,tip.x,tip.y,5,color,'#fff8e5');
  if(p>0&&p<1){c.save();c.globalAlpha=.42*ease(p/.05)*ease((1-p)/.05);drawStar(c,tip.x+12,tip.y-14,3.2,'#fff1c1',time*.08+seed*TAU);c.restore();}
 }
 // Raised braided knot: satin loops, soft contact shadows, luminous knot centre.
 for(let j=0;j<6;j++){
  const color=palette[j%palette.length],a=j*TAU/6+time*.045*(1-open),spread=open*95;
  const pts=Array.from({length:55},(_,i)=>{const t=i/54*TAU,rr=70+Math.sin(t*2+j)*11;return {x:960+Math.cos(a)*spread+Math.cos(t+a)*rr,y:465+Math.sin(a)*spread*.48+Math.sin(t+a)*rr*.56};});
  c.save();c.globalAlpha=1-open*.7;silkStroke(c,pts,color,15);c.restore();
 }
 glow(c,960,464,130,.4*(1-open),'#fff0b6');orb(c,960,463,18*(1-open)+5,'#e6be7c');
 stagePlinth(c,{x:960,y:779,width:1640,depth:25,color:'#563361'});
 for(const g of frame.groups){
  const x=entryX(frame,g),color=palette[g.index%palette.length],win=g.winning&&r>0;
  c.save();c.fillStyle='#0b071d88';c.beginPath();c.ellipse(x,785,27,6,0,0,TAU);c.fill();orb(c,x,765,12,color);
  c.strokeStyle=color+'77';c.lineWidth=2;c.beginPath();c.moveTo(x,785);c.lineTo(x,809);c.stroke();
  if(win){glow(c,x,733,100,r*.8,'#f5d28a');const grad=c.createLinearGradient(x-35,690,x+35,758);grad.addColorStop(0,'#fff9dc');grad.addColorStop(.4,'#ffdf91');grad.addColorStop(1,'#ad681e');c.globalAlpha=r;drawStar(c,x,723,39*r,grad,Math.sin(time*.65)*.06,'#fff1bf');ui.winnerHalo?.(c,x,727,52,r,time);}
  c.restore();
 }
 c.restore();return poses;
}
