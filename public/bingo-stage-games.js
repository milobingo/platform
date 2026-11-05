import {objectPose,wheelRotation} from './bingo-choreography.js?v=36';
import {drawPlingo} from './plingo-game.js?v=36';
import {drawRibbonGame} from './milo-ribbon-game.js';
import {drawMirrorGame,drawPotionGame,drawButterflyGame} from './milo-magic-games.js';
import {smooth} from './bingo-motion.js?v=36';
const mix=(a,b,t)=>a+(b-a)*t,clamp=v=>Math.max(0,Math.min(1,v)),tau=Math.PI*2;
function line(c,x,y,X,Y,color,width=2){c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(x,y);c.lineTo(X,Y);c.stroke();}
function ring(c,x,y,r,color,width=2){c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.arc(x,y,r,0,tau);c.stroke();}
function burst(c,x,y,p,color,count=18,radius=80){if(p<0||p>1)return;c.save();c.globalAlpha=(1-p)**2;c.fillStyle=color;for(let i=0;i<count;i++){const a=i*2.399,dist=(.3+(i%7)/10)*radius*p;c.beginPath();c.arc(x+Math.cos(a)*dist,y+Math.sin(a)*dist+p*p*45,2+i%3,0,tau);c.fill();}ring(c,x,y,radius*p,color,1.5);c.restore();}
function ribbon(c,points,color,width=3){c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
function beam(c,x,y,color,width=190){c.save();c.globalCompositeOperation='screen';const g=c.createLinearGradient(x,175,x,y);g.addColorStop(0,color+'00');g.addColorStop(1,color+'44');c.fillStyle=g;c.beginPath();c.moveTo(x-12,175);c.lineTo(x+12,175);c.lineTo(x+width/2,y);c.lineTo(x-width/2,y);c.fill();c.restore();}
function finish(c,y1,y2,x=1500){line(c,x,y1,x,y2,'#f4d99e',3);for(let y=y1;y<y2;y+=16)for(let col=0;col<2;col++){c.fillStyle=(Math.floor((y-y1)/16)+col)%2?'#f6dba4cc':'#102139b0';c.fillRect(x+col*13,y,13,16);}}
function tracks(c,f,u,water=false){const h=600/f.groups.length;for(let i=0;i<f.groups.length;i++){const y=235+i*h;c.fillStyle=i%2?'#07132530':'#07132555';u.roundBox(c,95,y,1730,h-4,10);c.fill();line(c,100,y+h-3,1820,y+h-3,water?'#afdcf340':'#ead09838',1);if(!water){c.fillStyle='#ffedc92b';for(let j=0;j<13;j++){const x=125+((j*148-f.progress*300)%1700+1700)%1700;c.fillRect(x,y+h-8,22,2);}}}finish(c,235,835);}
function gallop(c,assets,p,f,u){if(!assets.gallop){u.sprite(c,assets.sprites,0,p.x,p.y,p.size,p.angle);return;}const phase=f.progress===0||f.progress===1?0:Math.floor(f.age*11+p.group.seed*4)%4,col=phase%2,row=Math.floor(phase/2),w=phase===0?800:768,k=p.size/800;c.save();c.translate(p.x,p.y);c.rotate(p.angle);c.drawImage(assets.gallop,col*768,row*512,w,512,-384*k,-256*k,w*k,512*k);c.restore();}
function horses(c,f,a,u,poses){
 tracks(c,f,u);const h=600/poses.length;for(const p of poses){const color=u.palettes[p.group.index],ground=235+(p.group.index+.5)*h;
  for(const t of [.32+p.group.seed*.02,.64+p.group.seed*.025]){const x=195+1360*t*.88;line(c,x,ground-14,x,ground+17,'#dbc69491',2);line(c,x-18,ground-12,x+18,ground-12,'#f1d49b',3);}
  if(f.progress>0&&f.progress<1){const pts=Array.from({length:12},(_,i)=>[p.x-25-i*12,p.y+19+Math.sin(i*2+f.age*10+p.group.seed)*8]);ribbon(c,pts,color+'45',3);for(let i=0;i<8;i++){c.fillStyle='#dfc29b44';c.beginPath();c.arc(p.x-25-i*8,ground+25+Math.sin(f.age*11+i)*4,2+i%3,0,tau);c.fill();}}
  u.shadow(c,p.x,ground+27,p.size*.38,.38);if(p.group.winning)u.winnerHalo(c,p.x,p.y,p.size*.6,f.reveal,f.age);gallop(c,a,p,f,u);
 }
}
function cookies(c,f,a,u,poses){
 tracks(c,f,u);const h=600/poses.length;for(const p of poses){const ground=235+(p.group.index+.5)*h;for(const t of [.25,.48,.72]){const x=195+t*1360;c.fillStyle='#dfbb7755';c.beginPath();c.moveTo(x-25,ground+20);c.lineTo(x+13,ground-12);c.lineTo(x+32,ground+20);c.closePath();c.fill();line(c,x-25,ground+20,x+13,ground-12,'#f2d89999',2);}
  if(f.progress>0&&f.progress<1)for(let i=0;i<11;i++){c.fillStyle=i%2?'#e4ad6988':'#a8744188';c.beginPath();c.arc(p.x-25-i*9,p.y+23+Math.sin(f.age*7+i)*9,2+i%3,0,tau);c.fill();}
  ring(c,1635,ground,Math.min(28,h*.28),'#f1d48d',3);ring(c,1635,ground,Math.min(20,h*.2),'#b3844c',2);u.shadow(c,p.x,ground+25,p.size*.32);if(p.group.winning)u.winnerHalo(c,p.x,p.y,p.size*.6,f.reveal,f.age);u.sprite(c,a.sprites,1,p.x,p.y,p.size,p.angle);
 }
}
function boats(c,f,a,u,poses){
 tracks(c,f,u,true);for(const p of poses){const ground=235+(p.group.index+.5)*600/poses.length,color=u.palettes[p.group.index];
  for(let j=0;j<7;j++){const x=160+(j*237+f.age*21)%1640,y=ground+Math.sin(j+f.age*.9)*15;line(c,x,y,x+55,y,'#9bd6e326',1);}
  for(const gate of [.35,.65]){const gx=195+gate*1360;ring(c,gx,ground,22,'#b4dfe474',2);line(c,gx-23,ground+20,gx+23,ground+20,'#f3d5987a',3);}
  if(f.progress>0){const wake=Array.from({length:20},(_,i)=>[p.x-25-i*7,p.y+17+Math.sin(i*.8+f.age*4)*8]);ribbon(c,wake,'#b5e7f274',2.5);ribbon(c,wake.map(([x,y])=>[x,y+11]),'#77c9db44',2);}
  c.save();c.translate(p.x,p.y);c.scale(1,-.2);c.globalAlpha=.13;u.sprite(c,a.sprites,3,0,-110,p.size,p.angle);c.restore();if(p.group.winning)u.winnerHalo(c,p.x,p.y,p.size*.65,f.reveal,f.age);u.sprite(c,a.sprites,3,p.x,p.y,p.size,p.angle);line(c,p.x-9,p.y+p.size*.27,p.x+12,p.y+p.size*.28,color+'99',2);
 }
}
function rockets(c,f,a,u,poses){
 c.save();c.globalAlpha=.5;for(let i=0;i<65;i++){const x=110+(i*211)%1700,y=190+(i*137+f.age*(20+i%4*9)*Math.sin(f.progress*Math.PI))%680;line(c,x,y,x,y+5+f.progress*20,'#b9ddf466',1);}c.restore();
 for(const p of poses){const color=u.palettes[p.group.index];for(const y of [410,620]){c.save();c.globalAlpha=.45;ring(c,p.x,y,29,color,2);c.restore();}
  const running=f.progress>0&&f.progress<.99;if(running){for(let j=0;j<15;j++){const t=j/15;c.fillStyle=j<6?'#f2cf8670':'#7ab9ea30';c.beginPath();c.ellipse(p.x+Math.sin(f.age*18+j)*6,p.y+p.size*.22+t*(120+Math.sin(f.age*5)*20),10*(1-t)+1,13*(1-t)+2,0,0,tau);c.fill();}}
  c.save();c.strokeStyle='#d3e5f644';c.lineWidth=2;c.beginPath();c.ellipse(p.x,259,55,17,0,0,tau);c.stroke();c.restore();if(p.group.winning)u.winnerHalo(c,p.x,p.y,p.size*.6,f.reveal,f.age);u.sprite(c,a.sprites,2,p.x,p.y,p.size,p.angle);
 }
}
function chimneys(c,f,a,u,poses){
 for(const p of poses){const center=135+(p.group.index+.5)*1650/poses.length,color=u.palettes[p.group.index];const path=Array.from({length:55},(_,j)=>{const t=j/54;return [center+Math.sin(t*Math.PI*6+p.group.seed*5)*Math.min(32,1650/poses.length*.075),247+t*518];});ribbon(c,path,color+'5c',2.5);
  for(let j=1;j<=3;j++){const y=247+j*129,x=center+Math.sin(j/4*Math.PI*6+p.group.seed*5)*22;line(c,x-44,y,x-19,y,color+'aa',5);line(c,x+19,y,x+44,y,color+'aa',5);ring(c,x,y,20,f.progress>j/4?'#f2d89d99':color+'99',2);}
  c.fillStyle='#18334f99';u.roundBox(c,center-50,816,100,25,8);c.fill();line(c,center-42,816,center+42,816,'#e7c588b0',3);const local=((f.progress*4)%1);burst(c,p.x,p.y-12,local<.16?local/.16:-1,color,10,35);u.shadow(c,p.x,p.y+42,p.size*.32);if(p.group.winning)u.winnerHalo(c,p.x,p.y,p.size*.6,f.reveal,f.age);u.sprite(c,a.sprites,4,p.x,p.y,p.size,p.angle);
 }
}
function pinball(c,f,a,u,poses){
 for(const p of poses){const center=135+(p.group.index+.5)*1650/poses.length,w=1650/poses.length,color=u.palettes[p.group.index];line(c,center-w*.43,245,center-w*.43,837,color+'48',2);line(c,center+w*.43,245,center+w*.43,837,color+'48',2);
  for(let j=0;j<3;j++){const y=350+j*137,x=center+(j%2?1:-1)*w*.15,lit=Math.max(0,1-Math.abs(p.y-y)/72);u.glow(c,x,y,48,lit,color);ring(c,x,y,20,color+'aa',3);ring(c,x,y,12,'#efce9c88',2);}
  const pivot=835,tilt=Math.sin(f.age*5+p.group.seed*4)*.28*(1-f.reveal);for(const side of [-1,1])line(c,center+side*w*.3,pivot,center+side*6,pivot-20-tilt*side*45,'#d7b888',7);
  c.save();c.globalAlpha=.35;ribbon(c,Array.from({length:9},(_,j)=>[p.x+Math.sin(f.age*7+j*.4)*8,p.y+18+j*6]),color,5);c.restore();burst(c,p.x,p.y,p.impact>.5?(1-p.impact)*2:-1,color,10,44);if(p.group.winning)u.winnerHalo(c,p.x,p.y,p.size*.7,f.reveal,f.age);u.sprite(c,a.sprites,6,p.x,p.y,p.size,p.angle);
  ring(c,center,809,38,p.group.winning&&f.progress>.94?'#ffe1a2':color+'80',3);
 }
}
function giftSprite(c,a,p,f,u){
 const atlas=a.giftParts;if(!atlas){u.sprite(c,a.sprites,4,p.x,p.y,p.size,p.angle);if(p.open>0)u.sprite(c,a.sprites,7,p.x,p.y-70-p.open*38,p.size*.45,0);return;}
 function part(index,x,y,size,angle=0){c.save();c.translate(x,y);c.rotate(angle);const k=size/600;c.drawImage(atlas,index%2*768,Math.floor(index/2)*512,768,512,-384*k,-256*k,768*k,512*k);c.restore();}
 if(p.open<=0)part(0,p.x,p.y,p.size,p.angle);
 else{const blend=smooth(p.open/.15);c.save();c.globalAlpha=1-blend;part(0,p.x,p.y,p.size,p.angle);c.restore();c.save();c.globalAlpha=blend;part(1,p.x,p.y+22,p.size);part(2,p.x+p.open*37,p.y-35-p.open*75,p.size*.97,-p.open*.23);c.globalAlpha*=p.open;u.sprite(c,a.sprites,7,p.x,p.y-18-p.open*31,p.size*.48,f.age*.08);c.restore();}
}
function gifts(c,f,a,u,poses){
 for(const p of poses){const color=u.palettes[p.group.index];c.fillStyle='#10223a6e';u.roundBox(c,p.x-p.width*.48,p.y-92,p.width*.96,195,21);c.fill();if(p.spotlight){beam(c,p.x,p.y+82,color,p.width);u.glow(c,p.x,p.y,145,.75,color);}u.shadow(c,p.x,p.y+65,p.size*.37);if(p.group.winning)u.winnerHalo(c,p.x,p.y,p.size*.6,f.reveal,f.age);giftSprite(c,a,p,f,u);if(p.open>0)burst(c,p.x,p.y-50,p.open*.75,'#ffe0a0',22,120);}
}
function gold(c,f,a,u,poses){
 c.save();c.strokeStyle='#d3c09a50';c.lineWidth=2;c.beginPath();c.ellipse(960,537,690,184,0,0,tau);c.stroke();c.setLineDash([4,18]);c.beginPath();c.ellipse(960,537,698,192,0,0,tau);c.stroke();c.restore();
 const sweep=f.progress*28;c.save();c.globalCompositeOperation='screen';const sx=960+Math.cos(sweep)*670,sy=537+Math.sin(sweep)*175;line(c,960,537,sx,sy,'#f1cf9b66',3);u.glow(c,sx,sy,80,.65);c.restore();
 const sorted=[...poses].sort((a,b)=>a.depth-b.depth);for(const p of sorted){const color=u.palettes[p.group.index];u.shadow(c,p.x,p.y+70,p.size*.38,.25);u.glow(c,p.x,p.y,p.size,p.scan*.45+p.gold*.6,color);c.save();if(p.gold<1)c.filter=`hue-rotate(${p.group.index*47+100}deg) saturate(.8)`;u.sprite(c,a.sprites,6,p.x,p.y,p.size,p.angle);c.restore();if(p.gold>0){c.save();c.globalAlpha=p.gold;u.sprite(c,a.sprites,6,p.x,p.y,p.size,p.angle);c.restore();}if(p.group.winning)u.winnerHalo(c,p.x,p.y,p.size*.6,f.reveal,f.age);}
}
function balloons(c,f,a,u,poses){
 for(const p of poses){const color=u.palettes[p.group.index];const foot=845;const pts=Array.from({length:16},(_,j)=>{const t=j/15;return [p.x+Math.sin(t*9+f.age*1.6+p.group.seed)*8*t,p.y+45+(foot-p.y-45)*t];});ribbon(c,pts,color+'60',1.5);
  if(p.out){burst(c,p.x,p.y,p.burst,color,23,90);c.save();c.globalAlpha=.4;u.sprite(c,a.sprites,5,p.x,p.y+18,p.size*.34,.28);c.restore();}
  else{u.glow(c,p.x,p.y,90,.15+(p.group.winning?f.reveal*.6:0),color);c.save();if(p.group.winning&&f.reveal>0)c.filter='hue-rotate(48deg) saturate(1.2)';u.sprite(c,a.sprites,5,p.x,p.y,p.size,Math.sin(f.age*1.4+p.group.seed)*.045);c.restore();if(p.group.winning)u.winnerHalo(c,p.x,p.y,p.size*.52,f.reveal,f.age);}
 }
}
function disco(c,f,a,u,poses){
 for(const p of poses){const color=u.palettes[p.group.index],win=p.group.winning?f.reveal:0,light=p.out?.1:p.spotlight?.8:.27+p.beat*.23,w=p.width*.9;
  const gradient=c.createLinearGradient(p.x,p.y-78,p.x,p.y+74);gradient.addColorStop(0,win>.3?'#f0d49e':color);gradient.addColorStop(1,'#102b49');c.save();c.globalAlpha=light+win*.4;c.fillStyle=gradient;c.beginPath();c.moveTo(p.x-w/2,p.y-71);c.lineTo(p.x+w/2,p.y-71);c.lineTo(p.x+w*.57,p.y+74);c.lineTo(p.x-w*.57,p.y+74);c.closePath();c.fill();c.strokeStyle=color;c.lineWidth=3;c.stroke();c.restore();
  for(let j=0;j<5;j++)line(c,p.x-w*.35+j*w*.17,p.y-45,p.x-w*.4+j*w*.2,p.y+51,color+(p.out?'1a':'55'),1);
  if(p.spotlight&&!p.out)beam(c,p.x,p.y+71,color,p.width);u.glow(c,p.x,p.y,90,p.out?.03:p.beat*.2+win*.6,color);c.save();c.globalAlpha=p.out?.46:1;u.sprite(c,a.sprites,7,p.x,p.y-15-(p.out?0:p.beat*18),p.size*(p.out?.55:.76),p.out?0:Math.sin(f.age*3)*.06);c.restore();if(p.group.winning)u.winnerHalo(c,p.x,p.y,p.size*.62,f.reveal,f.age);
 }
}
function wheel(c,f,a,u,poses){
 const cx=960,cy=548,r=318,n=poses.length,rotation=wheelRotation(f);u.shadow(c,cx,cy+r+20,375,.6);u.glow(c,cx,cy,420,.65);
 const rim=c.createRadialGradient(cx-50,cy-70,120,cx,cy,390);rim.addColorStop(0,'#fff0bf');rim.addColorStop(.7,'#866538');rim.addColorStop(.9,'#e9c987');rim.addColorStop(1,'#775834');c.fillStyle=rim;c.beginPath();c.arc(cx,cy,r+20,0,tau);c.fill();
 for(const p of poses){const a=rotation+p.group.index*tau/n,b=a+tau/n,color=u.palettes[p.group.index];c.beginPath();c.moveTo(cx,cy);c.arc(cx,cy,r,a,b);c.closePath();c.fillStyle='#172b43';c.fill();c.save();c.globalAlpha=.2+(p.group.winning?f.reveal*.55:0);c.fillStyle=color;c.fill();c.restore();c.strokeStyle='#edd0998c';c.lineWidth=1.5;c.stroke();}
 for(let i=0;i<48;i++){const angle=i*tau/48,lit=Math.sin(f.age*6-i*.48)>0;c.fillStyle=lit?'#ffe7a9':'#8f723f';c.beginPath();c.arc(cx+Math.cos(angle)*(r+12),cy+Math.sin(angle)*(r+12),lit?3.5:2.7,0,tau);c.fill();}
 c.fillStyle='#0a172b';c.beginPath();c.arc(cx,cy,69,0,tau);c.fill();ring(c,cx,cy,69,'#e7c487',3);if(a.brandId==='milo'){c.save();c.textAlign='center';c.textBaseline='middle';c.font='bold 77px Georgia';const gold=c.createLinearGradient(cx-30,cy-40,cx+30,cy+40);gold.addColorStop(0,'#fff1be');gold.addColorStop(.5,'#f1c36b');gold.addColorStop(1,'#a36421');c.fillStyle=gold;c.shadowColor='#e4b45880';c.shadowBlur=17;c.fillText('M',cx,cy+5);c.restore();}else u.sprite(c,a.sprites,7,cx,cy,105,0);
 const fraction=(rotation*n/tau)%1,tilt=f.progress>0&&f.progress<1?Math.sin(fraction*tau)*.15:0;c.save();c.translate(cx,cy-r-39);c.rotate(tilt);c.shadowColor='#ffdea1';c.shadowBlur=14;c.fillStyle='#ffe4af';c.beginPath();c.moveTo(-20,0);c.lineTo(20,0);c.lineTo(0,34);c.closePath();c.fill();c.restore();
}
const renderers={ribbons:drawRibbonGame,mirrors:drawMirrorGame,potion:drawPotionGame,butterfly:drawButterflyGame,plingo:drawPlingo,horses,cookies,boats,rockets,chimneys,pinball,gifts,gold,balloons,disco,wheel};
export function drawDynamicGame(c,frame,assets,ui){
 const poses=frame.groups.map(group=>({group,...objectPose(frame,group)}));c.save();c.beginPath();c.rect(65,177,1790,720);c.clip();(renderers[frame.game]||wheel)(c,frame,assets,ui,poses);c.restore();
 // Labels are the last layer: particles, props, depth sorting and elimination
 // never cover or remove a participant's identity.
 for(const p of poses){ui.chip(c,p.group,p.chipX,p.chipY,p.width,p.height,frame.reveal);if(p.out){ui.label(c,'AFGEVALLEN',p.chipX,p.chipY+p.height/2+16,18,'#bbc6d6',p.width);}}
 return poses;
}
