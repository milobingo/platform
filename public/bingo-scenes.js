import {brandGameName,showBrand} from './show-brands.js?v=36';
import {bt} from './brand-ui.js?v=37';
import {MINIGAMES} from './bingo-model.js?v=36';
import {gameFrame,gamePhase} from './bingo-choreography.js?v=36';
import {drawDynamicGame} from './bingo-stage-games.js?v=36';
const clamp=v=>Math.max(0,Math.min(1,v));
const colors=['#efd29a','#9ed5e4','#eca7bb','#c4b1ed','#a5d2aa','#f1b48b'];
const crops=[[0,0,500,444],[500,0,387,444],[887,0,413,456],[1300,0,474,444],[0,444,500,443],[500,440,387,447],[887,460,413,427],[1300,444,474,443]];
function label(c,value,x,y,size=32,color='#fff1d2',width=1700){c.fillStyle=color;c.textAlign='center';c.textBaseline='middle';let n=size;do{c.font=`700 ${n}px Arial`;if(c.measureText(String(value)).width<=width)break;n-=2;}while(n>16);let fitted=String(value);while(c.measureText(fitted).width>width&&fitted.length>1)fitted=fitted.slice(0,-2)+'…';c.fillText(fitted,x,y);}
function panel(c,x,y,w,h){c.fillStyle='rgba(6,15,33,.91)';c.strokeStyle='#dfb97c';c.lineWidth=2;c.beginPath();c.roundRect(x,y,w,h,25);c.fill();c.stroke();}
function sprite(c,atlas,index,x,y,size,angle=0){if(!atlas){c.fillStyle=colors[index%6];c.beginPath();c.arc(x,y,size*.35,0,Math.PI*2);c.fill();return;}const crop=crops[index];c.save();c.translate(x,y);c.rotate(angle);const scale=Math.min(size/crop[2],size/crop[3]);c.drawImage(atlas,...crop,-crop[2]*scale/2,-crop[3]*scale/2,crop[2]*scale,crop[3]*scale);c.restore();}
function background(c,atlas,index){if(!atlas){c.fillStyle='#0c1930';c.fillRect(0,0,1920,1080);return;}c.drawImage(atlas,(index%2)*768,Math.floor(index/2)*512,768,512,0,0,1920,1080);c.fillStyle='rgba(3,10,25,.22)';c.fillRect(0,0,1920,1080);}
export function drawBingoStage(c,show,assets={}){
 const stage=show.gameStage;if(!stage)return false;
 if(show.scene==='card'&&stage.type==='card'){
  panel(c,790,90,1050,945);label(c,`${stage.name} · boekje ${stage.ticket}`,1315,155,48);label(c,stage.round||'Bingocontrole',1315,215,28,'#a9bfdf');
  const drawn=new Set(stage.drawn);let cells=stage.pattern?.cells||[];if(['rows','doubleRows'].includes(stage.pattern?.variant)){const positions=new Map(stage.drawn.map((n,i)=>[n,i+1])),rows=Array.from({length:5},(_,r)=>Array.from({length:5},(_,i)=>r*5+i)).filter(row=>row.every(i=>stage.card[i]===0||drawn.has(stage.card[i]))).sort((a,b)=>Math.max(...a.map(i=>positions.get(stage.card[i])||0))-Math.max(...b.map(i=>positions.get(stage.card[i])||0))),count=stage.pattern.variant==='doubleRows'?2:1;if(rows.length>=count)cells=rows.slice(0,count).flat();}const pattern=new Set(cells),size=112,gap=7,left=1020,top=275;
  for(let i=0;i<25;i++){const n=stage.card[i],x=left+(i%5)*(size+gap),y=top+Math.floor(i/5)*(size+gap),lit=n===0||drawn.has(n);c.fillStyle=lit?'#dfc08b':'#162b48';c.strokeStyle=pattern.has(i)?'#fff0bd':'#546c8f';c.lineWidth=pattern.has(i)?4:1.5;c.beginPath();c.roundRect(x,y,size,size,12);c.fill();c.stroke();label(c,n===0?'VRIJ':n,x+size/2,y+size/2,n===0?25:48,lit?'#13233b':'#dce7fb',100);}
  label(c,stage.pattern?.title||'Speelpatroon',1315,925,34);label(c,stage.status==='valid'?`Kaart compleet vanaf trekking ${stage.completeAt}`:stage.status==='late'?'Kaart compleet, melding buiten de terugkijkmarge':stage.status==='false'?'Deze kaart is nog niet compleet':'De regie controleert dit boekje',1315,980,27,stage.status==='false'?'#f3b9c2':'#b9cee8',970);return true;
 }
 if(show.scene!=='minigame'||stage.type!=='minigame')return false;
 drawMinigame(c,show,stage,assets);return true;
}
const palettes=['#e9c587','#8fc6df','#d5a3b6','#b9afe5','#9abdaa','#dda984','#91adce','#d7c093','#a6c4cb','#c0abc9'];
const atlasMap={ribbons:['shows',1],mirrors:['shows',1],potion:['shows',1],butterfly:['shows',1],plingo:['shows',2,6],horses:['races',0,0],cookies:['races',1,1],rockets:['races',2,2],boats:['races',3,3],chimneys:['shows',0,4],balloons:['shows',1,5],pinball:['shows',2,6],disco:['shows',3,7],gifts:['shows',1,4],gold:['shows',1,6],wheel:['shows',1,7]};
function roundBox(c,x,y,w,h,r=18){c.beginPath();c.roundRect(x,y,w,h,r);}
function glass(c,x,y,w,h,accent='#c9a775',radius=24){
 const g=c.createLinearGradient(x,y,x+w,y+h);g.addColorStop(0,'#101c32f5');g.addColorStop(1,'#070f20ee');c.fillStyle=g;roundBox(c,x,y,w,h,radius);c.fill();c.strokeStyle=accent+'8c';c.lineWidth=1.5;c.stroke();
 c.strokeStyle='#ffffff10';c.beginPath();c.moveTo(x+radius,y+2);c.lineTo(x+w-radius,y+2);c.stroke();
}
function chip(c,group,x,y,width=228,height=58,reveal=0,numbered=false){
 const color=palettes[group.index%palettes.length],winning=group.winning&&reveal>.5,entry=winning?group.members.find(e=>e.bookId===group.resultWinner):group.entry;
 const shown=entry||group.entry;const primary=winning?shown.name:group.members.length>1?`${shown.name} + ${group.members.length-1}`:shown.name;
 c.save();c.shadowColor='#0009';c.shadowBlur=12;c.shadowOffsetY=5;
 glass(c,x-width/2,y-height/2,width,height,winning?'#ffdfa0':color,Math.min(16,height/3));c.shadowBlur=0;c.shadowOffsetY=0;
 c.fillStyle=winning?'#f1d79d':color;roundBox(c,x-width/2+9,y-height/2+10,4,height-20,2);c.fill();
 const size=height>=55?25:height>=45?22:19;
 label(c,(numbered?`${group.index+1} · `:'')+primary,x+4,y-(height>=55?9:7),size,winning?'#fff1c6':'#f0f3fc',width-30);
 label(c,group.members.length>1&&!winning?`${group.members.length} boekjes`:`BOEKJE ${shown.ticket}`,x+3,y+(height>=55?17:13),height>=55?16:13,'#adbed7',width-30);
 c.restore();
}
function glow(c,x,y,size,strength,color='#f9d895'){
 if(strength<=0)return;const gradient=c.createRadialGradient(x,y,0,x,y,size);gradient.addColorStop(0,color+'66');gradient.addColorStop(.45,color+'20');gradient.addColorStop(1,color+'00');c.save();c.globalAlpha=strength;c.fillStyle=gradient;c.fillRect(x-size,y-size,size*2,size*2);c.restore();
}
function shadow(c,x,y,w,alpha=.4){c.save();c.fillStyle=`rgba(2,8,20,${alpha})`;c.beginPath();c.ellipse(x,y,w,w*.16,0,0,Math.PI*2);c.fill();c.restore();}
function winnerHalo(c,x,y,size,reveal,age){
 if(reveal<=0)return;glow(c,x,y,size*1.15,reveal);c.save();c.globalAlpha=reveal;c.strokeStyle='#ffe1a0';c.lineWidth=2.5;c.beginPath();c.ellipse(x,y,size,size*.8,0,0,Math.PI*2);c.stroke();c.setLineDash([9,16]);c.strokeStyle='#fff3cb';c.lineWidth=1.5;c.beginPath();c.ellipse(x,y,size+9,size*.8+7,0,0,Math.PI*2);c.stroke();c.restore();
}
function celebration(c,age,reveal){
 if(reveal<=0)return;c.save();c.globalAlpha=reveal*.75;
 for(let i=0;i<34;i++){const x=(i*233.37)%1860+30,travel=((i*137.9+age*46)%695)/695,y=175+travel*695;c.globalAlpha=reveal*.65*Math.sin(travel*Math.PI)**2;c.fillStyle=i%3?'#f0cf8b':'#afc6e9';c.save();c.translate(x,y);c.rotate(i+age*.6);c.fillRect(-2,-5,4,10);c.restore();}c.restore();
}
function drawMinigame(c,show,stage,assets){
 const result=stage.result,game=MINIGAMES.find(m=>m.id===result.minigame)||MINIGAMES[0],frame=gameFrame(stage,show.age,show.reducedMotion),[atlas,tile]=atlasMap[game.id];frame.groups.forEach(g=>g.resultWinner=result.winner.bookId);
 c.save();c.translate(960,540);c.scale(1.024,1.024);c.translate(-960+Math.sin(frame.age*.22)*7,-540);background(c,assets.brandBackground||assets[atlas],assets.brandBackground?({horses:0,cookies:0,rockets:2,boats:3}[game.id]??1):tile);c.restore();
 const shade=c.createLinearGradient(0,0,0,1080);shade.addColorStop(0,'#040b1a55');shade.addColorStop(.5,'#040b1a1a');shade.addColorStop(1,'#040b1a70');c.fillStyle=shade;c.fillRect(0,0,1920,1080);
 glass(c,265,25,1390,143,'#dfc38d',26);label(c,showBrand(show).title.toUpperCase()+(show.preview?' · OEFENSPEL':' · BESLISSPEL'),960,52,17,'#d8b982');label(c,brandGameName(game,show),960,98,47,'#fff1d2',1280);label(c,`${result.entrants.length} boekjes · ${result.prize.title}`,960,141,23,'#c7d3e7',1280);
 const numbered=['ribbons','mirrors','potion','butterfly'].includes(frame.game);
 if(numbered){
  // A quiet, recessed magical stage keeps translucent props readable against
  // the scenic illustration. Participant labels remain the foreground layer.
  c.save();c.shadowColor='#0c031ac0';c.shadowBlur=28;c.shadowOffsetY=12;
  const floor=c.createLinearGradient(0,184,0,893);floor.addColorStop(0,'#241335d9');floor.addColorStop(.6,'#1a102bdc');floor.addColorStop(1,'#120d22ed');
  c.fillStyle=floor;roundBox(c,99,184,1722,709,28);c.fill();c.shadowBlur=0;c.shadowOffsetY=0;c.strokeStyle='#e0bc795c';c.lineWidth=1.5;c.stroke();
  c.strokeStyle='#8eddd51f';c.beginPath();c.ellipse(960,776,735,68,0,0,Math.PI*2);c.stroke();c.restore();
 }
 const poses=drawDynamicGame(c,frame,assets,{label,glass,roundBox,sprite,shadow,glow,winnerHalo,chip:(...args)=>chip(...args,numbered),palettes});
 if(!show.reducedMotion)celebration(c,frame.age,frame.reveal);
 if(frame.age<frame.intro&&!show.reducedMotion){const n=Math.max(1,Math.ceil((1-frame.age/frame.intro)*3));glow(c,960,505,120,.75);glass(c,883,425,154,155,'#f2d494',35);label(c,n,960,496,94,'#fff0bd',130);label(c,'KLAAR?',960,551,18,'#b9c9e1',130);}
 glass(c,365,919,1190,127,'#dfc38d',25);
 const reveal=frame.reveal;if(reveal<1){c.save();c.globalAlpha=1-reveal;label(c,gamePhase(frame),960,958,34,'#f2e4c9',1090);
 let detail=result.entrants.length>frame.groups.length?`${result.entrants.length} boekjes in ${frame.groups.length} vaste groepjes · iedereen doet mee`:'Volg je naam tijdens het spel';
 if(['horses','cookies','boats','rockets'].includes(frame.game)&&frame.progress>.1){const leader=[...poses].sort((a,b)=>b.progress-a.progress)[0];detail=`Aan kop: ${leader.group.entry.name}${leader.group.members.length>1?' en groep':''} · de finish beslist`;}
 if(['disco','balloons'].includes(frame.game)&&frame.progress>.3)detail=`${poses.filter(p=>!p.out).length} ${frame.game==='balloons'?'ballonnen':'tegels'} over · de spanning loopt op`;
 label(c,detail,960,1002,24,'#aebfd9',1090);c.restore();}
 if(reveal>0){c.save();c.globalAlpha=reveal;label(c,`Gefeliciteerd ${result.winner.name}!`,960,958,46,'#fff0bf',1090);label(c,`Boekje ${result.winner.ticket} · ${result.prize.title}`,960,1008,27,'#cbd8ec',1090);c.restore();}
 c.fillStyle='#ffffff0c';roundBox(c,397,1035,1126,3,1.5);c.fill();if(frame.progress>0){const gradient=c.createLinearGradient(397,0,1523,0);gradient.addColorStop(0,'#af8750');gradient.addColorStop(1,'#f6dca0');c.fillStyle=gradient;roundBox(c,397,1035,1126*frame.progress,3,1.5);c.fill();}
 if(show.paused){glass(c,1470,185,385,62);label(c,'SHOW GEPAUZEERD',1662,216,24,'#ffe3a4',350);}
}
