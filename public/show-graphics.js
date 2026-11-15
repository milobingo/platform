import {brandText,showBrand} from './show-brands.js?v=36';
import {bt} from './brand-ui.js?v=37';
import {drawProductionGraphics} from './production-graphics.js?v=36';
import {drawPresentationGraphics} from './presentation-graphics.js?v=36';
import {drawBingoStage} from './bingo-scenes.js?v=36';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function box(c,x,y,w,h,r=24){c.beginPath();c.roundRect(x,y,w,h,r);}
function panel(c,x,y,w,h){c.save();const g=c.createLinearGradient(x,y,x+w,y+h);g.addColorStop(0,'rgba(8,18,39,.96)');g.addColorStop(1,'rgba(14,23,43,.88)');c.fillStyle=g;box(c,x,y,w,h);c.fill();c.strokeStyle='rgba(243,201,121,.65)';c.lineWidth=2;c.stroke();c.restore();}
function text(c,value,x,y,size=42,color='#fff6df',align='left',maxWidth=1500){c.textAlign=align;c.textBaseline='middle';c.fillStyle=color;let n=size;c.font=`800 ${n}px Arial`;while(c.measureText(String(value)).width>maxWidth&&n>18){n-=2;c.font=`800 ${n}px Arial`;}c.fillText(String(value),x,y);}
function tag(c,value,x,y,align='left'){text(c,String(value).toUpperCase(),x,y,24,'#e6bc6f',align);}
function dim(c,strength=.35){const g=c.createLinearGradient(0,0,0,1080);g.addColorStop(0,`rgba(2,6,18,${strength*.65})`);g.addColorStop(1,`rgba(2,6,18,${strength})`);c.fillStyle=g;c.fillRect(0,0,1920,1080);}
function patternGrid(c,s,x,y,size=215){
 const selected=new Set(s.patternCells),gap=6,cell=(size-gap*4)/5;
 c.save();for(let i=0;i<25;i++){const free=i===12&&s.patternFreeCenter!==false,lit=selected.has(i),px=x+(i%5)*(cell+gap),py=y+Math.floor(i/5)*(cell+gap);
  c.fillStyle=free?'#344a68':lit?'#eac785':'#172a45';box(c,px,py,cell,cell,5);c.fill();c.strokeStyle=free?'#7892b5':lit?'#ffdfaa':'#3d5575';c.lineWidth=1.5;c.stroke();
  if(free)text(c,'★',px+cell/2,py+cell/2,25,'#e8effa','center',cell-5);
 }c.restore();
}
function description(c,value,x,y,width=920){
 c.font='500 27px Arial';const words=String(value||'').split(/\s+/),lines=[];let line='';
 for(const word of words){const next=line?`${line} ${word}`:word;if(line&&c.measureText(next).width>width){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);
 for(let i=0;i<Math.min(lines.length,3);i++)text(c,lines[i],x,y+i*30,27,'#c6d5ed','center',width);
}
function confetti(c,age,reduced){
 if(reduced||age>13)return;const fade=Math.min(1,age*.8)*clamp((13-age)/3,0,1);c.save();c.globalAlpha=fade;
 for(let i=0;i<100;i++){const x=(i*353.71)%1920+Math.sin(age*1.3+i)*35,y=((i*127.3+age*(70+i%5*22))%1400)-220;c.fillStyle=['#ffe3a1','#b98c42','#fff5d4','#7da9ee'][i%4];c.save();c.translate(x,y);c.rotate(age*(.5+i%3*.23)+i);c.fillRect(-3,-7,6+Math.sin(age+i)*2,14);c.restore();}c.restore();
}
export function drawShowGraphics(c,state,props={}){
 const s=state.show;if(!s)return;const bt=t=>brandText(t,s);const age=Math.max(0,s.age||0),scene=s.scene;
 if(drawProductionGraphics(c,s,props)||drawPresentationGraphics(c,s,props)||drawBingoStage(c,s,props.gameAssets))return;
 c.save();
 if(scene==='opening'){
  dim(c,.25);panel(c,800,255,970,530);tag(c,'WE GAAN BEGINNEN',1285,312,'center');text(c,s.title,1285,390,70,'#fff6df','center',880);
  const remaining=Math.max(1,Math.ceil((s.countdown||5)-age)),clock=remaining>=60?`${Math.floor(remaining/60)}:${(remaining%60).toString().padStart(2,'0')}`:remaining;c.strokeStyle='#f2c77b';c.lineWidth=5;c.beginPath();c.arc(1285,565,96,-Math.PI/2,-Math.PI/2+Math.PI*2*clamp(1-(age%(s.countdown||5))/(s.countdown||5),0,1));c.stroke();text(c,clock,1285,563,remaining>=60?72:113,'#ffe2a0','center',180);text(c,'Pak je bingokaart erbij',1285,727,34,'#c2cfe4','center');
 }else if(scene==='round'){
  dim(c,.22);
  if(Array.isArray(s.patternCells)){
   panel(c,760,290,1050,490);tag(c,`STAP ${(s.goalIndex||0)+1} VAN ${s.roundPatterns?.length||1} · ${s.planKind==='explanation'?'UITLEG VAN HET PATROON':'WE SPELEN VOOR'}`,1285,344,'center');text(c,s.round,1285,414,70,'#ffe1a1','center',930);patternGrid(c,s,822,471,215);text(c,s.pattern,1410,529,48,'#fff8e8','center',675);text(c,s.patternVariant==='doubleRows'?'Twee complete horizontale rijen':s.patternVariant==='rows'?'Een complete horizontale rij':'Alle gemarkeerde vakjes',1410,596,29,'#bdcde6','center',650);text(c,s.prize,1410,680,31,'#edd0a0','center',665);
  }else{panel(c,760,355,1050,335);tag(c,'WE SPELEN VOOR',1285,411,'center');text(c,s.round,1285,482,86,'#ffe1a1','center',930);text(c,s.pattern,1285,592,46,'#fff8e8','center',930);}
 }else if(scene==='prize'){
  dim(c,.24);panel(c,775,200,1040,675);tag(c,'DE PRIJS VAN DEZE RONDE',1295,253,'center');
  if(props.prize){const image=props.prize,scale=Math.min(650/image.width,410/image.height),w=image.width*scale,h=image.height*scale,progress=s.reducedMotion?1:clamp(age/1.25,0,1);c.save();c.globalAlpha=progress;c.drawImage(image,1295-w/2,510-h/2+(1-progress)*25,w,h);c.restore();}
  else if(props.gift){const crop=props.giftCrop||[35,75,1410,910],w=630,progress=s.reducedMotion?1:clamp(age/1.25,0,1),h=w*crop[3]/crop[2];c.save();c.globalAlpha=progress;c.translate(1295,535+(1-progress)*40);c.drawImage(props.gift,...crop,-w/2,-h/2,w,h);c.restore();}
  else if(props.logo){const w=650,h=w*props.logo.height/props.logo.width;c.drawImage(props.logo,1295-w/2,510-h/2,w,h);}
  text(c,s.prize,1295,748,44,'#fff0ce','center',950);if(s.prizeDescription)description(c,s.prizeDescription,1295,795);else text(c,s.round,1295,829,27,'#bac9e0','center');
 }else if(scene==='pause'){
  dim(c,.48);panel(c,510,300,900,470);tag(c,'EVEN EEN PAUZE',960,358,'center');text(c,'Zo weer terug!',960,454,83,'#ffe1a1','center');const remaining=Math.max(0,Math.ceil((s.pauseMinutes||5)*60-age)),time=`${Math.floor(remaining/60).toString().padStart(2,'0')}:${(remaining%60).toString().padStart(2,'0')}`;text(c,time,960,577,110,'#fff7e9','center');text(c,'Bewaar je kaart. We spelen straks verder.',960,705,32,'#b9c9e2','center');
 }else if(scene==='reveal'){
  dim(c,.48);const p=s.reducedMotion?1:clamp(age/.65,0,1),scale=.85+.15*(1-(1-p)**3);c.save();c.translate(960,520);c.scale(scale,scale);c.save();c.shadowColor='#e8ba61';c.shadowBlur=48;const g=c.createRadialGradient(-60,-90,0,0,0,187);g.addColorStop(0,'#fffefa');g.addColorStop(.52,'#ffe5a2');g.addColorStop(1,'#bd8127');c.fillStyle=g;c.beginPath();c.arc(0,0,187,0,Math.PI*2);c.fill();c.restore();c.strokeStyle='#fff6d2';c.lineWidth=5;c.stroke();text(c,s.number??'…',0,5,176,'#102242','center');tag(c,'DE GETROKKEN BAL',0,-276,'center');text(c,`${s.drawnCount} VAN 75 GETROKKEN`,0,287,30,'#fff1d1','center');c.restore();
 }else if(scene==='call'&&!s.liveCall){
  dim(c,.38);panel(c,780,300,1050,470);tag(c,'BELRONDE',1305,359,'center');text(c,s.planTitle||bt('Een moment met Vlampie'),1305,454,68,'#ffe1a1','center',930);const remaining=Math.max(0,Math.ceil((s.callSeconds||120)-age));text(c,`${Math.floor(remaining/60).toString().padStart(2,'0')}:${(remaining%60).toString().padStart(2,'0')}`,1305,578,100,'#fff7e9','center');text(c,remaining?'Even tijd voor een gesprek':'De regie gaat zo verder',1305,708,32,'#bfcee5','center',950);
 }else if(scene==='checking'||scene==='rejected'||scene==='winner'){
  if(scene==='winner')confetti(c,age,s.reducedMotion);
  panel(c,250,813,1420,208);tag(c,scene==='winner'?'BINGO BEVESTIGD':scene==='checking'?'BINGO GEMELD — EVEN CONTROLEREN':'WE SPELEN GEZELLIG VERDER',960,857,'center');text(c,scene==='winner'?(s.winner?`Gefeliciteerd, ${s.winner}!`:'Gefeliciteerd!'):scene==='checking'?s.claim?.name||'Een deelnemer':'Nog even doorzoeken op je kaart',960,921,scene==='winner'?63:52,'#fff2cf','center',1300);
  if(scene==='checking')text(c,s.claim?.card?`De regie controleert kaart ${s.claim.card}`:'De regie controleert de bingokaart',960,982,27,'#becde3','center');
 }else if(scene==='finale'){
  confetti(c,age,s.reducedMotion);panel(c,780,350,1050,310);tag(c,'BEDANKT VOOR HET MEESPELEN',1305,403,'center');text(c,'Wat een avond!',1305,489,79,'#ffe1a1','center',950);text(c,s.winner?`Applaus voor ${s.winner} en iedereen thuis!`:'Een groot applaus voor jullie allemaal!',1305,589,34,'#f7eddc','center',950);
 }else if(scene==='host'&&s.round&&s.brandId!=='milo'){
  panel(c,55,943,660,88);tag(c,s.round,84,969);text(c,s.pattern,84,1006,30,'#f5eddb','left',580);
 }
 if(s.paused&&scene!=='pause'){panel(c,1445,40,425,66);text(c,'SHOW GEPAUZEERD',1657,73,23,'#ffe3a4','center');}
 c.restore();
}
