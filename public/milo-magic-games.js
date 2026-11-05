import {clamp,mix,ease,TAU,roundBox,drawStar,glow,orb,stagePlinth,seededUnit,paintParticles,silkStroke,settledMagicTime} from './milo-minigame-art.js';

// These are reveal performances, not games of chance. Only the persisted
// result identifies the winner; all trajectories sample the supplied clock.
const palette=(u,i)=>u.palettes[i%u.palettes.length];
const clock=settledMagicTime;
function gold(c,x,y,h=180){const g=c.createLinearGradient(x,y,x+h*.3,y+h);g.addColorStop(0,'#fff5c6');g.addColorStop(.24,'#dfb15e');g.addColorStop(.52,'#fff0b2');g.addColorStop(.78,'#ac672b');g.addColorStop(1,'#f4d18d');return g;}
function marker(c,u,g,x,y,r=24){orb(c,x,y,r,palette(u,g.index));u.label(c,g.index+1,x,y,Math.max(15,r*.9),'#221030',r*1.5);}
function shadow(c,x,y,w){c.save();c.fillStyle='#09031388';c.beginPath();c.ellipse(x,y,w,w*.13,0,0,TAU);c.fill();c.restore();}
function mirrorPath(c,w,h){c.beginPath();c.moveTo(-w/2,h/2);c.lineTo(-w/2,-h*.15);c.bezierCurveTo(-w/2,-h*.65,w/2,-h*.65,w/2,-h*.15);c.lineTo(w/2,h/2);c.closePath();}

export function drawMirrorGame(c,f,a,u,poses){
 const t=clock(f),p=f.progress,reveal=f.reveal;
 paintParticles(c,f,{seed:f.result.id+':mirrors',count:34,color:'#c6adf3',strength:.5});
 stagePlinth(c,{y:790,width:1550,depth:32,color:'#351849'});
 for(const pose of poses){
  const g=pose.group,color=palette(u,g.index),seed=seededUnit(f.result.id+':mirror:'+g.index),w=Math.min(poses.length<=5?280:190,pose.size||170),h=w*1.43;
  const sway=Math.sin(p*Math.PI*4+seed*TAU)*Math.sin(p*Math.PI),x=pose.x+sway*18,y=pose.y+Math.cos(p*TAU+seed)*Math.sin(p*Math.PI)*9;
  const winner=g.winning?reveal:0;
  shadow(c,x,y+h*.6,w*.63);c.save();c.globalAlpha=1-(g.winning?0:reveal*.49);c.translate(x,y);c.rotate(sway*.035);
  c.save();c.shadowColor='#03000fc9';c.shadowBlur=24;c.shadowOffsetY=14;mirrorPath(c,w+20,h+18);c.fillStyle=gold(c,-w/2,-h/2,h);c.fill();c.restore();
  mirrorPath(c,w,h);const glass=c.createLinearGradient(-w/2,-h/2,w/2,h/2);glass.addColorStop(0,'#9bd9ef');glass.addColorStop(.23,'#29234f');glass.addColorStop(.65,'#4b2570');glass.addColorStop(1,'#84b2ca');c.fillStyle=glass;c.fill();
  c.save();mirrorPath(c,w-8,h-8);c.clip();
  const reflection=c.createLinearGradient(-w,-h/2,w,h/2);reflection.addColorStop(0,'#fff9e900');reflection.addColorStop(.40,'#e1fbff00');reflection.addColorStop(.48,'#e1fbff55');reflection.addColorStop(.54,'#e1fbff11');reflection.addColorStop(1,'#e1fbff00');c.fillStyle=reflection;c.fillRect(-w/2,-h/2,w,h);
  for(let j=0;j<4;j++){
   const copies=1-ease((p-.66-j*.035)/.23),angle=p*5+seed*TAU+j*TAU/4,rr=w*(.12+.14*Math.sin(p*Math.PI));
   c.save();c.globalAlpha=copies*.48;drawStar(c,Math.cos(angle)*rr,Math.sin(angle)*rr*.8,w*.17,color,-angle);c.restore();
  }
  const pulse=.88+Math.sin(p*TAU+seed*6)*.025;glow(c,0,0,w*.43,.35,color);drawStar(c,0,0,w*.28*pulse,color,p*.35,'#fff5d0');u.label(c,g.index+1,0,1,Math.max(17,w*.15),'#2c183b',w*.3);
  c.restore();
  c.strokeStyle='#fff4d699';c.lineWidth=1.6;mirrorPath(c,w-5,h-5);c.stroke();
  for(const side of [-1,1]){roundBox(c,side*w*.34-9,h*.49,18,31,6,gold(c,0,h/2,32));drawStar(c,side*w*.46,-h*.12,5,color);}
  drawStar(c,0,-h*.51,17,gold(c,0,-h*.6,40),p*.2,'#fff1bd');
  c.restore();
  if(winner>0){
   const emerge=ease(winner),yy=y-h*.14-emerge*28;glow(c,x,yy,w*.8,winner*.8);c.save();c.globalAlpha=winner;c.translate(x,yy);c.scale(1+emerge*.32,1+emerge*.32);drawStar(c,0,0,w*.37,gold(c,-40,-40,100),-.08,'#fff8d0');u.label(c,g.index+1,0,0,w*.19,'#603518',w*.5);c.restore();u.winnerHalo(c,x,yy,w*.55,winner,t);
  }
 }
}

function bottlePath(c,w,h){
 c.beginPath();c.moveTo(-w*.16,-h*.5);c.lineTo(w*.16,-h*.5);c.lineTo(w*.17,-h*.24);c.bezierCurveTo(w*.19,-h*.15,w*.48,-h*.12,w*.49,h*.19);c.bezierCurveTo(w*.5,h*.49,w*.3,h*.5,0,h*.5);c.bezierCurveTo(-w*.3,h*.5,-w*.5,h*.49,-w*.49,h*.19);c.bezierCurveTo(-w*.48,-h*.12,-w*.19,-h*.15,-w*.17,-h*.24);c.closePath();
}
function ingredient(c,x,y,p,color){
 const u=clamp(p),fade=Math.sin(u*Math.PI);c.save();c.globalAlpha=fade;glow(c,x,y,28,.5,color);drawStar(c,x,y,9,color,u*4,'#fff8dd');c.restore();
}
export function drawPotionGame(c,f,a,u,poses){
 const t=clock(f),p=f.progress,reveal=f.reveal;
 paintParticles(c,f,{seed:f.result.id+':potion',count:28,color:'#8ce5dc',strength:.45});
 stagePlinth(c,{y:790,width:1550,depth:38,color:'#38204d'});
 for(const pose of poses){
  const g=pose.group,color=palette(u,g.index),seed=seededUnit(f.result.id+':bottle:'+g.index),w=Math.min(poses.length<=5?250:185,pose.size||160),h=w*1.34,x=pose.x,y=pose.y,winner=g.winning?reveal:0;
  shadow(c,x,y+h*.56,w*.59);c.save();c.translate(x,y);c.globalAlpha=1-(g.winning?0:reveal*.36);
  bottlePath(c,w,h);const glass=c.createLinearGradient(-w*.5,0,w*.5,0);glass.addColorStop(0,'#e9fff752');glass.addColorStop(.15,'#77ded614');glass.addColorStop(.7,'#b1ecff0b');glass.addColorStop(1,'#d8fff65a');c.fillStyle=glass;c.fill();
  c.save();bottlePath(c,w-8,h-8);c.clip();
  const phase=p*3,ingredientPhase=Math.floor(phase)+ease(((phase%1)-.15)/.5),level=h*(.27-p*.30),hue=(g.index*57+seed*110+ingredientPhase*61)%360;
  const liquid=c.createLinearGradient(0,level,0,h*.5);liquid.addColorStop(0,`hsl(${hue},76%,69%)`);liquid.addColorStop(.25,`hsl(${hue+12},65%,44%)`);liquid.addColorStop(1,`hsl(${hue+25},65%,21%)`);c.fillStyle=liquid;c.fillRect(-w*.5,level,w,h);
  c.fillStyle=`hsla(${hue},80%,82%,.65)`;c.beginPath();c.ellipse(0,level,w*.46,h*.038,0,0,TAU);c.fill();
  if(winner>0){c.save();c.globalAlpha=winner;const elixir=c.createLinearGradient(0,level,0,h*.5);elixir.addColorStop(0,'#fff5ad');elixir.addColorStop(.4,'#d6a33b');elixir.addColorStop(1,'#724018');c.fillStyle=elixir;c.fillRect(-w*.5,level,w,h);c.restore();}
  for(let j=0;j<11;j++){
   const rise=(p*(2.3+seed)+j*.173+seed)%1,bx=Math.sin(j*9.3+seed*TAU)*w*.31,by=mix(h*.49,level,rise);
   c.save();c.globalAlpha=Math.sin(rise*Math.PI)**2*.45;c.strokeStyle='#f0fff6bb';c.lineWidth=1.5;c.beginPath();c.arc(bx,by,2.5+j%4*1.4,0,TAU);c.stroke();c.restore();
  }
  c.restore();bottlePath(c,w,h);c.strokeStyle='#d5fcf7b8';c.lineWidth=2.2;c.stroke();
  c.strokeStyle='#ffffff88';c.lineWidth=3;c.beginPath();c.moveTo(-w*.10,-h*.42);c.lineTo(-w*.11,-h*.24);c.bezierCurveTo(-w*.35,-h*.09,-w*.37,h*.08,-w*.34,h*.31);c.stroke();
  roundBox(c,-w*.20,-h*.55,w*.4,h*.09,5,gold(c,-15,-h*.55,h*.1),'#fff1bd');
  roundBox(c,-w*.23,h*.16,w*.46,h*.22,8,'#3a1d4ac9',color);u.label(c,g.index+1,0,h*.27,Math.max(17,w*.18),'#fff3c7',w*.3);
  c.restore();
  for(let k=0;k<3;k++){
   const local=clamp((p-(.11+k*.22))/.16);if(local>0&&local<1){const ix=x+Math.sin(local*Math.PI)*58*(k%2?1:-1),iy=mix(y-h*.65-98,y-h*.5,local);ingredient(c,ix,iy,local,['#f2d485','#87e9da','#edb4e4'][k]);}
  }
  if(winner>0){
   const fountain=ease(winner);glow(c,x,y-h*.35,w*.9,winner*.65);c.save();c.globalAlpha=winner;
   for(let j=0;j<18;j++){const cycle=(j*.137+t*.18)%1,spread=Math.sin(j*7.3)*w*.72,xx=x+spread*cycle,yy=y-h*.51-Math.sin(cycle*Math.PI)*Math.min(175,h*.85)*fountain;c.save();c.globalAlpha*=Math.sin(cycle*Math.PI)**2*.72;drawStar(c,xx,yy,2.5+(j%3),'#ffe6a1',cycle*2);c.restore();}
   drawStar(c,x,y-h*.53-55*fountain,28,gold(c,x,y-100,100),-.05,'#fff7c7');c.restore();u.winnerHalo(c,x,y,w*.67,winner,t);
  }
 }
}

function floralTarget(c,u,g,x,y,size,highlight=0){
 const color=palette(u,g.index);shadow(c,x,y+size*.5,size*.7);c.save();c.translate(x,y);
 for(let j=0;j<5;j++){const angle=j*TAU/5-Math.PI/2;c.save();c.rotate(angle);const petal=c.createLinearGradient(0,-size*.7,0,0);petal.addColorStop(0,color);petal.addColorStop(1,'#3a2059');c.fillStyle=petal;c.beginPath();c.ellipse(0,-size*.28,size*.19,size*.40,0,0,TAU);c.fill();if(highlight>0){c.save();c.globalAlpha*=ease(highlight)*.7;c.fillStyle='#ffe5a2';c.fill();c.restore();}c.strokeStyle='#ffedbd66';c.lineWidth=1.5;c.stroke();c.restore();}
 marker(c,u,g,0,0,size*.24);c.restore();
}
export function butterflyRevealPose(f,poses,progress=f.progress){
 const p=clamp(progress),seed=seededUnit(f.result.id+':butterfly-flight'),winner=poses.find(v=>v.group.winning);
 if(!winner)throw new TypeError('De bevestigde winnaar ontbreekt in de deelnemerslijst.');
 if(p<.24)return {x:960+Math.sin(p*TAU*3)*35*Math.sin(p/.24*Math.PI)**2,y:440,scale:ease(p/.24),landing:0};
 const route=poses.map((v,i)=>({v,key:seededUnit(f.result.id+':visit:'+i)})).sort((a,b)=>a.key-b.key).map(q=>q.v);
 const travel=clamp((p-.24)/.61),at=travel*route.length,index=Math.min(route.length-1,Math.floor(at)),local=at-index,start=index===0?{x:960,y:440}:route[index-1],end=route[index];
 const q=ease(local),wave=Math.sin(local*Math.PI)**2,clearance=Math.max(0,Math.min(start.y,end.y)-345),x=mix(start.x,end.x,q),y=mix(start.y,end.y,q)-wave*Math.min(90+seed*40,clearance);
 if(p<.85)return {x,y,scale:1,landing:0};
 const last=route.at(-1),land=ease((p-.85)/.15),landingArc=Math.min(75,Math.max(0,Math.min(last.y,winner.y-20)-325));
 return {x:mix(last.x,winner.x,land),y:mix(last.y,winner.y-20,land)-Math.sin(land*Math.PI)**2*landingArc,scale:mix(1,.78,land),landing:land};
}
function butterfly(c,x,y,size,t,formation){
 c.save();c.translate(x,y);c.scale(formation,formation);const flap=.65+Math.sin(t*4.4)*.16;
 for(const side of [-1,1]){
  c.save();c.scale(side*flap,1);const wing=c.createLinearGradient(0,-size*.5,size*.65,size*.4);wing.addColorStop(0,'#fff6bc');wing.addColorStop(.27,side<0?'#c493ed':'#7fe6db');wing.addColorStop(.62,side<0?'#8248ac':'#2eaaae');wing.addColorStop(1,'#d9ac59');c.fillStyle=wing;c.shadowColor=side<0?'#bd83ec88':'#7ddfd588';c.shadowBlur=17;
  c.beginPath();c.moveTo(0,0);c.bezierCurveTo(size*.08,-size*.65,size*.87,-size*.68,size*.63,-size*.09);c.bezierCurveTo(size*.96,size*.51,size*.32,size*.56,0,0);c.fill();c.shadowBlur=0;c.strokeStyle='#ffedb7';c.lineWidth=2.5;c.stroke();
  for(let k=0;k<4;k++){c.beginPath();c.moveTo(0,0);c.quadraticCurveTo(size*(.1+k*.07),size*(-.12+k*.10),size*(.40+k*.05),size*(-.33+k*.19));c.strokeStyle='#fff3c377';c.lineWidth=1;c.stroke();}
  drawStar(c,size*.38,-size*.25,size*.07,'#fff2bd',.1);c.restore();
 }
 c.strokeStyle='#fff2b9';c.lineCap='round';c.lineWidth=9;c.beginPath();c.moveTo(0,-size*.21);c.lineTo(0,size*.23);c.stroke();orb(c,0,-size*.25,8,'#e7bd68');for(const side of [-1,1]){c.beginPath();c.moveTo(0,-size*.26);c.quadraticCurveTo(side*8,-size*.44,side*19,-size*.39);c.lineWidth=1.8;c.stroke();}c.restore();
}
export function drawButterflyGame(c,f,a,u,poses){
 const t=clock(f),p=f.progress,pose=butterflyRevealPose(f,poses),winner=poses.find(v=>v.group.winning);
 if(!winner)throw new TypeError('De bevestigde winnaar ontbreekt in de deelnemerslijst.');
 paintParticles(c,f,{seed:f.result.id+':butterfly',count:35,color:'#a7e9dd',strength:.6});
 stagePlinth(c,{y:790,width:1550,depth:30,color:'#3f2655'});
 for(const target of poses){const r=Math.min(poses.length<=5?95:65,(target.size||170)*.6),win=target.group.winning?f.reveal:0;floralTarget(c,u,target.group,target.x,target.y,r,win);if(win>0){glow(c,target.x,target.y,110,win*.75);u.winnerHalo(c,target.x,target.y,r*1.12,win,t);}}
 if(p<.31){
  const silk=1-ease((p-.20)/.11);for(let k=0;k<3;k++){const pts=[];for(let j=0;j<75;j++){const q=j/74,angle=q*TAU*2+p*7+k*TAU/3,r=(1-q)*210;pts.push({x:960+Math.cos(angle)*r,y:440+Math.sin(angle)*r*.5});}c.save();c.globalAlpha=silk;silkStroke(c,pts,['#b999e9','#86e6d7','#efd090'][k],8-k);c.restore();}
 }
 if(p>.18&&p<1)for(let j=7;j>0;j--){const old=butterflyRevealPose(f,poses,Math.max(.18,p-j*.0045));c.save();c.globalAlpha=(1-j/8)*.24*ease((p-.18)/.06)*ease((1-p)/.08);drawStar(c,old.x+Math.sin(j*5)*11,old.y+j*2,2+j%3,'#ffedb9',t*.2+j);c.restore();}
 glow(c,pose.x,pose.y,150,.38,'#dce9c2');butterfly(c,pose.x,pose.y,235*pose.scale,t,pose.scale===0?0:1);
 if(p>.85){
  const arrival=ease((p-.85)/.15);c.save();c.globalAlpha=arrival;const ex=pose.x,ey=pose.y+63;
  roundBox(c,ex-35,ey-20,70,43,6,gold(c,ex-30,ey-20,60),'#fff2be');c.strokeStyle='#916030';c.lineWidth=1.5;c.beginPath();c.moveTo(ex-34,ey-19);c.lineTo(ex,ey+5);c.lineTo(ex+34,ey-19);c.stroke();drawStar(c,ex,ey+3,8,'#bd8037');c.restore();
 }
 if(f.reveal>0){const q=ease(f.reveal);glow(c,winner.x,winner.y-56,120,f.reveal*.8);drawStar(c,winner.x,winner.y-48-q*25,38*q,gold(c,winner.x,winner.y-100,90),-.08,'#fff5c9');}
}
