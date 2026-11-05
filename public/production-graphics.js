import {brandText,showBrand} from './show-brands.js?v=36';
import {bt} from './brand-ui.js?v=37';
import {wrapPresentation} from './presentation-graphics.js?v=36';
const gold='#efd194',white='#fff7e7';
function label(c,t,x,y,size,color=white,width=1500){while(size>20){c.font=`700 ${size}px Arial`;if(c.measureText(String(t)).width<=width)break;size--;}c.textAlign='left';c.textBaseline='top';c.fillStyle=color;c.fillText(String(t),x,y);}
function paragraph(c,t,x,y,w,h,size=38){let lines;do{c.font=`500 ${size}px Arial`;lines=wrapPresentation(c,t,w);if(lines.length*size*1.4<=h)break;size--;}while(size>22);lines.forEach((line,i)=>label(c,line,x,y+i*size*1.4,size,'#bfd0e9',w));}
function panel(c,x,y,w,h){c.fillStyle='#0b1a35';c.beginPath();c.roundRect(x,y,w,h,30);c.fill();c.strokeStyle='#ad894e';c.lineWidth=2;c.stroke();}
export function drawProductionGraphics(c,s,{logo}={}){
 const bt=t=>brandText(t,s);
 if(s.scene!=='lobby'||s.gameStage?.type!=='lobby')return false;const p=s.gameStage,age=s.age||0,index=Math.floor(age/(p.rotateSeconds||12)),slide=index%4;c.save();const bg=c.createLinearGradient(0,0,1920,1080);bg.addColorStop(0,'#051127');bg.addColorStop(1,'#17315b');c.fillStyle=bg;c.fillRect(0,0,1920,1080);
 for(let i=0;i<18;i++){const x=80+i*110;c.fillStyle=`rgba(238,198,116,${.08+.06*Math.sin(i+age*.6)})`;c.beginPath();c.arc(x,90+(i%4)*200,3+(i%3)*2,0,Math.PI*2);c.fill();}
 label(c,'DE SHOW BEGINT ZO',100,76,27,gold);label(c,s.title||bt('Vlampie’s Bingo'),100,125,52,white,1680);
 panel(c,100,230,780,530);if(logo){const h=Math.min(480,720*logo.height/logo.width),w=h*logo.width/logo.height;c.drawImage(logo,490-w/2,480-h/2,w,h);}else label(c,bt('VLAMPIE’S BINGO'),160,460,50,gold,660);
 panel(c,920,230,900,730);const x=976,y=290;label(c,['PAK JE BOEKJES ERBIJ','VANDAAG TE WINNEN','ZO SPELEN WE SAMEN','WELKOM IN ONZE STUDIO'][slide],x,y,25,gold,784);
 if(slide===0){label(c,'Een avond vol bingo.',x,y+70,54,white,784);paragraph(c,p.message,x,y+165,775,360,41);}
 if(slide===1){const prizes=p.prizes||[],prize=prizes[Math.floor(index/4)%Math.max(1,prizes.length)];label(c,prize?.title||'De prijzen staan klaar',x,y+76,51,white,784);paragraph(c,prize?.description||'Speel mee voor de prijzen van deze show.',x,y+185,775,330,40);label(c,`Prijs ${prizes.length?Math.floor(index/4)%prizes.length+1:0} / ${prizes.length}`,x,877,25,gold);}
 if(slide===2){const rules=p.rules||[],r=rules[Math.floor(index/4)%Math.max(1,rules.length)];label(c,r?.title||'Kijk naar het patroon',x,y+75,47,white,784);paragraph(c,r?.text||'Speel de patronen op volgorde. Bij BINGO bevestig je JA en kies je jouw boekje.',x,y+170,775,380,35);}
 if(slide===3){const names=p.greetings||[],start=(Math.floor(index/4)*6)%Math.max(names.length,1);if(names.length){label(c,'Wat leuk dat je erbij bent!',x,y+65,45,white,784);names.slice(start,start+6).forEach((name,i)=>{const py=y+165+i*63;c.fillStyle='#1c3456';c.beginPath();c.roundRect(x,py,784,53,16);c.fill();label(c,`✦  ${name}`,x+23,py+10,30,gold,740);});}else{label(c,'Welkom allemaal!',x,y+85,60,white,784);paragraph(c,'Speel samen met je gezin, vrienden en familie. Zet jouw begroeting klaar in de spelersapp.',x,y+200,775,330,40);}}
 const seconds=Math.max(0,Math.ceil((Date.parse(p.startsAt)-Date.now())/1000)),clock=Number.isFinite(seconds)?`${Math.floor(seconds/3600)?String(Math.floor(seconds/3600)).padStart(2,'0')+':':''}${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`:'—';label(c,'WE TELLEN AF',100,810,25,gold);label(c,seconds>0?clock:'We beginnen zo',100,855,82,white,780);label(c,'Samen spelen. Samen genieten.',100,993,25,'#b8c8de');for(let i=0;i<4;i++){c.fillStyle=i===slide?gold:'#405373';c.beginPath();c.roundRect(1640+i*46,1010,30,5,3);c.fill();}c.restore();return true;
}
