/** Deterministic stage effects, in 1920 × 1080 studio coordinates.
 * No timers, audio, random draws, or game state mutations live in this module.
 * The director owns elapsed time; rendering it twice produces the same frame.
 */
const TAU=Math.PI*2;
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const smooth=n=>{n=clamp(n);return n*n*(3-2*n);};
const mix=(a,b,t)=>a+(b-a)*t;
const PALETTE=['#ffdf93','#b5fff2','#d9b8ff','#fff3c7','#eaa4d5'];
export const SHOW_EFFECT_IDS=Object.freeze(['welcome-wave','applause','dance','wonder','star-shower','magic-orbit','curtain-call','portal-arrival']);
export function motionEnvelope(elapsed,duration){
 const t=Math.max(0,Number(elapsed)||0),end=Math.max(.1,Number(duration)||.1);
 return smooth(t/.55)*smooth((end-t)/.8);
}
export function cueVisualState(cue,{reducedMotion=false}={}){
 if(!cue||!SHOW_EFFECT_IDS.includes(cue.id))return null;
 const duration=Math.max(.1,Number(cue.duration)||8),elapsed=clamp(Number(cue.elapsed)||0,0,duration);
 return {id:cue.id,elapsed,duration,progress:elapsed/duration,alpha:motionEnvelope(elapsed,duration),time:reducedMotion?duration*.48:elapsed,reducedMotion};
}
const seed=(i,salt=0)=>{const n=Math.sin((i+1)*127.1+salt*311.7)*43758.5453;return n-Math.floor(n);};
function starPath(ctx,x,y,r,rotation=0){ctx.beginPath();for(let n=0;n<10;n++){const a=-Math.PI/2+rotation+n*Math.PI/5,rr=n%2?r*.43:r;n?ctx.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr):ctx.moveTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);}ctx.closePath();}
function halo(ctx,x,y,r,color,alpha=1){ctx.save();ctx.globalAlpha*=alpha;const gradient=ctx.createRadialGradient(x,y,0,x,y,r);gradient.addColorStop(0,color);gradient.addColorStop(1,'rgba(104,52,184,0)');ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();ctx.restore();}
function jewelStar(ctx,x,y,r,angle=0,color='#ffdf93'){
 ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.shadowColor=color;ctx.shadowBlur=r*.5;starPath(ctx,0,0,r);
 const g=ctx.createLinearGradient(-r,-r,r,r);g.addColorStop(0,'#fffdf1');g.addColorStop(.32,color);g.addColorStop(.6,'#bd8346');g.addColorStop(.8,color);g.addColorStop(1,'#fff6d4');ctx.fillStyle=g;ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='rgba(255,251,221,.85)';ctx.lineWidth=Math.max(.7,r*.045);ctx.stroke();
 ctx.beginPath();ctx.moveTo(0,-r);ctx.lineTo(0,0);ctx.lineTo(r*.59,r*.81);ctx.strokeStyle='rgba(255,255,255,.5)';ctx.lineWidth=Math.max(.6,r*.05);ctx.stroke();ctx.restore();
}
function thinRibbon(ctx,points,color,width=2,alpha=1){
 if(points.length<2)return;ctx.save();ctx.globalAlpha*=alpha;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowColor=color;ctx.shadowBlur=width*3;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();ctx.shadowBlur=0;ctx.strokeStyle='#fff9df';ctx.lineWidth=Math.max(.45,width*.22);ctx.stroke();ctx.restore();
}
function floorLight(ctx,x,y,width,color,alpha=.22){ctx.save();ctx.globalAlpha*=alpha;ctx.translate(x,y);ctx.scale(1,.13);halo(ctx,0,0,width,color);ctx.restore();}
function musicalNote(ctx,x,y,size,angle,color){ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.shadowColor=color;ctx.shadowBlur=12;const g=ctx.createLinearGradient(-size,-size,size,size);g.addColorStop(0,'#fff9d7');g.addColorStop(.5,color);g.addColorStop(1,'#9362b0');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(-size*.2,size*.45,size*.3,size*.21,-.3,0,TAU);ctx.fill();ctx.fillRect(size*.02,-size*.75,size*.1,size*1.2);ctx.beginPath();ctx.moveTo(size*.1,-size*.75);ctx.bezierCurveTo(size*.6,-size*.56,size*.58,-size*.12,size*.1,-size*.2);ctx.closePath();ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='rgba(255,255,255,.8)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(size*.08,-size*.65);ctx.lineTo(size*.08,size*.38);ctx.stroke();ctx.restore();}
function bubble(ctx,x,y,r,phase){
 ctx.save();const g=ctx.createRadialGradient(x-r*.3,y-r*.4,r*.08,x,y,r);g.addColorStop(0,'rgba(255,247,224,.05)');g.addColorStop(.7,'rgba(149,217,250,.03)');g.addColorStop(.91,'rgba(204,159,244,.21)');g.addColorStop(1,'rgba(140,243,225,.68)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();ctx.strokeStyle='rgba(241,211,255,.76)';ctx.lineWidth=1.3;ctx.stroke();ctx.lineWidth=Math.max(1.4,r*.07);ctx.strokeStyle='rgba(255,250,217,.92)';ctx.beginPath();ctx.arc(x,y,r*.81,Math.PI*1.12,Math.PI*1.57);ctx.stroke();ctx.strokeStyle='rgba(112,252,226,.8)';ctx.beginPath();ctx.arc(x,y,r*.9,.1,.86);ctx.stroke();halo(ctx,x-r*.42,y-r*.54,r*.17,'rgba(255,255,247,.85)');ctx.restore();
}
/** Particle descriptors are exported for composition and determinism checks. */
export function showEffectParticles(cue,options={}){
 const s=cueVisualState(cue,options);if(!s)return [];
 const rows=[],t=s.time;
 if(['applause','curtain-call'].includes(s.id)){
  for(let i=0;i<76;i++){
   const side=i%2?-1:1,delay=seed(i,2)*Math.max(1.3,s.duration-2.7),u=Math.max(0,t-delay),flight=3.2+seed(i,9)*1.2,life=clamp(u/flight);
   const speed=side*(85+seed(i,3)*95),origin=side<0?1570:350;
   rows.push({kind:'confetti',x:origin+speed*u,y:920-(300+seed(i,4)*120)*u+92*u*u,size:5+seed(i,5)*8,angle:i*.7+t*(1+seed(i,6)*2),alpha:u>0?Math.sin(Math.PI*life)**.35:0,color:PALETTE[i%PALETTE.length],depth:.65+seed(i,7)*.35});
  }
 }else if(s.id==='wonder'){
  for(let i=0;i<22;i++){const p=(t*.072+seed(i,1))%1,side=i%2?-1:1;rows.push({kind:'bubble',x:960+side*(215+seed(i,2)*410)+Math.sin(t*.6+i)*24,y:900-p*480,size:13+seed(i,3)*29,alpha:Math.sin(p*Math.PI)*.85,angle:i});}
 }else if(s.id==='dance'){
  for(let i=0;i<14;i++){const p=(t*.11+seed(i,1))%1,side=i%2?-1:1;rows.push({kind:'note',x:960+side*(230+seed(i,3)*280)+Math.sin(t+i)*25,y:900-p*420,size:17+seed(i,2)*18,angle:Math.sin(t*.7+i)*.2,color:PALETTE[i%3],alpha:Math.sin(p*Math.PI)*.85});}
 }else if(['star-shower','welcome-wave'].includes(s.id)){
  const count=s.id==='welcome-wave'?28:48;
  for(let i=0;i<count;i++){const side=i%2?-1:1,p=(t*(s.id==='welcome-wave'?.065:.1)+seed(i,2))%1;rows.push({kind:'star',x:960+side*(245+seed(i,4)*500)+Math.sin(p*Math.PI*2+i)*30,y:320+p*600,size:4+seed(i,3)*11,angle:t*.2+i,alpha:Math.sin(p*Math.PI)*.8,color:PALETTE[i%3],depth:.5+seed(i,7)*.5});}
 }
 return rows;
}
function orbit(ctx,s,front=false){
 const x=1330,y=569,t=s.time,open=smooth(s.elapsed/1.4),r=142;
 if(!front){halo(ctx,x,y,225,'rgba(170,124,255,.23)');floorLight(ctx,x,934,190,'rgba(128,235,218,.65)');}
 for(let ring=0;ring<3;ring++){
  const points=[];
  for(let i=0;i<=80;i++){const a=i/80*TAU+t*(ring%2?-.55:.45)+ring*1.3,depth=Math.sin(a);if(front?depth<0:depth>=0){if(points.length>1)thinRibbon(ctx,points,PALETTE[ring],3.4-ring*.5,.75);points.length=0;continue;}points.push([x+Math.cos(a)*(r+ring*14)*open,y+Math.sin(a)*42+Math.cos(a+ring)*38]);}
  thinRibbon(ctx,points,PALETTE[ring],3.4-ring*.5,.75);
  const a=t*(ring%2?-.55:.45)+ring*2.1;if((Math.sin(a)>=0)===front)jewelStar(ctx,x+Math.cos(a)*(r+ring*14)*open,y+Math.sin(a)*42+Math.cos(a+ring)*38,10+ring*2,a,PALETTE[ring]);
 }
 if(!front){ctx.save();ctx.translate(x,y);ctx.scale(.94+Math.sin(t*.55)*.04,1);jewelStar(ctx,0,Math.sin(t*.7)*7,57*open,Math.sin(t*.45)*.1);ctx.restore();halo(ctx,x-12,y-24,33,'rgba(255,246,195,.35)');}
}
function portal(ctx,s){
 const x=1510,y=635,phase=s.reducedMotion?1:smooth(s.elapsed/1.4),time=s.time;
 halo(ctx,x,y,240,'rgba(149,110,244,.23)');floorLight(ctx,x,916,230,'rgba(255,210,128,.65)',.25);
 for(let k=0;k<3;k++){
  const radius=92+k*18,points=[];
  for(let i=0;i<=100;i++){const a=i/100*TAU;points.push([x+Math.cos(a)*radius*phase,y+Math.sin(a)*(167+k*18)*phase]);}
  thinRibbon(ctx,points,k===1?'#bbfff1':'#ffe9a5',k===1?1.4:2.4,.32+k*.12);
 }
 for(let i=0;i<15;i++){const a=i/15*TAU+time*.16;ctx.save();ctx.globalAlpha*=.5+seed(i,3)*.4;jewelStar(ctx,x+Math.cos(a)*140,y+Math.sin(a)*218,4+seed(i,2)*5,a);ctx.restore();}
}
/** Back layer stays behind the host and desk; the foreground is restricted to
 * the floor. This keeps faces, captions and all 75 official numbers readable. */
export function drawShowEffects(ctx,{cue,reducedMotion=false,layer='back'}={}){
 const s=cueVisualState(cue,{reducedMotion});if(!s||s.alpha<=0)return;
 ctx.save();ctx.globalAlpha*=s.alpha;
 if(layer==='front'){
  ctx.beginPath();ctx.rect(0,944,1920,136);ctx.clip();
  const shade=s.id==='wonder'?'rgba(137,241,232,.7)':'rgba(251,205,131,.7)';
  floorLight(ctx,400,972,210,shade,.2);floorLight(ctx,1520,972,210,shade,.2);
  ctx.restore();return;
 }
 if(reducedMotion){
  // A still jewel and low, steady floor light replace moving particles.
  floorLight(ctx,500,941,240,'rgba(201,158,255,.55)',.23);floorLight(ctx,1450,941,240,'rgba(145,248,229,.55)',.23);
  if(s.id==='portal-arrival')portal(ctx,s);else if(s.id==='magic-orbit')orbit(ctx,s);else{halo(ctx,1365,585,110,'rgba(233,196,255,.18)');jewelStar(ctx,1365,585,24,0);}
  ctx.restore();return;
 }
 if(s.id==='magic-orbit'){orbit(ctx,s);orbit(ctx,s,true);ctx.restore();return;}
 if(s.id==='portal-arrival'){portal(ctx,s);ctx.restore();return;}
 if(['welcome-wave','star-shower'].includes(s.id)){
  for(const side of [-1,1]){const points=[];for(let j=0;j<=60;j++){const q=j/60,a=q*Math.PI;points.push([960+side*(250+q*500),915-Math.sin(a)*280+Math.sin(q*5+s.time*.7)*16]);}thinRibbon(ctx,points,side<0?'#ffe9a5':'#a3fff1',1.7,.28);}
 }
 const particles=showEffectParticles(cue,{reducedMotion});
 for(const p of particles){
  // Preserve the dimensional logo and unobstructed central presenter zone.
  if(p.x>700&&p.x<1210&&p.y>290&&p.y<720)continue;
  ctx.save();ctx.globalAlpha*=p.alpha;
  if(p.kind==='star')jewelStar(ctx,p.x,p.y,p.size,p.angle,p.color);
  else if(p.kind==='bubble')bubble(ctx,p.x,p.y,p.size,p.angle);
  else if(p.kind==='note')musicalNote(ctx,p.x,p.y,p.size,p.angle,p.color);
  else{ctx.translate(p.x,p.y);ctx.rotate(p.angle);ctx.scale(Math.max(.18,Math.abs(Math.cos(p.angle))),1);ctx.fillStyle=p.color;ctx.shadowColor=p.color;ctx.shadowBlur=3;ctx.fillRect(-p.size/2,-p.size*.32,p.size,p.size*.64);ctx.shadowBlur=0;ctx.fillStyle='rgba(255,255,255,.65)';ctx.fillRect(-p.size/2,-p.size*.32,p.size,.9);}
  ctx.restore();
 }
 floorLight(ctx,430,936,200,'rgba(248,218,152,.58)',.2);floorLight(ctx,1490,936,200,'rgba(147,247,229,.55)',.2);
 ctx.restore();
}

/** The visible wand is attached to the rig's real wrist, never a screen-space
 * sticker. A short curved trail makes the off-desk orbit read as a spell. */
export function drawShowCueWand(ctx,{cue,wrist,reducedMotion=false}={}){
 const s=cueVisualState(cue,{reducedMotion});if(!s||s.id!=='magic-orbit'||!wrist||s.alpha<=0)return;
 const angle=-.64+Math.sin(s.time*.8)*.06,length=106,tip={x:wrist.x+Math.cos(angle)*length,y:wrist.y+Math.sin(angle)*length};
 ctx.save();ctx.globalAlpha*=s.alpha;ctx.save();ctx.translate(wrist.x,wrist.y);ctx.rotate(angle);
 const g=ctx.createLinearGradient(0,-4,0,4);g.addColorStop(0,'#b599c9');g.addColorStop(.28,'#493557');g.addColorStop(.7,'#281735');g.addColorStop(1,'#8b6d9e');ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(-7,-4,length+7,8,4);ctx.fill();
 ctx.fillStyle='#fff2b8';ctx.beginPath();ctx.roundRect(length-19,-4,19,8,3);ctx.fill();ctx.fillStyle='#cfa756';ctx.fillRect(length-24,-4,5,8);ctx.restore();
 halo(ctx,tip.x,tip.y,28,'rgba(255,231,149,.6)');jewelStar(ctx,tip.x,tip.y,6,s.time*.15);
 if(!reducedMotion){const points=[];for(let i=0;i<=36;i++){const q=i/36;points.push([tip.x+q*110,tip.y-q*48-Math.sin(q*Math.PI)*24+Math.sin(s.time*1.5-q*5)*q*5]);}thinRibbon(ctx,points,'#b9fff0',1.5,.45);for(let i=0;i<9;i++){const q=(s.time*.22+i*.113)%1;ctx.save();ctx.globalAlpha*=Math.sin(q*Math.PI);jewelStar(ctx,tip.x+q*110,tip.y-q*48-Math.sin(q*Math.PI)*24,2.3+seed(i,4)*2,s.time*.3);ctx.restore();}}
 ctx.restore();
}
