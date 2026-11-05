import {drawDeskNumberBoard,DESK_BOARD} from './mf-desk-board.js';

// Studio 01 / Sterrenplein. Room, desk, performers and live displays are separate
// compositing layers. Scenic artwork never supplies a game result or a number.
export const STUDIO_ART=Object.freeze({
 room:'/assets/milo-friends/studio/sterrenplein-grand-room.webp',
 desk:'/assets/milo-friends/studio/sterrenplein-grand-desk.webp',
 magic:'/assets/milo-friends/studio/sterrenplein-magic-props.webp',
 deskSource:Object.freeze({x:40,y:380,width:1595,height:390}),
});
export const ARENA_LAYOUT=Object.freeze({
 width:1920,height:1080,
 desk:Object.freeze({x:480,y:705,width:960,height:235,occlusionY:714}),
 host:Object.freeze({x:960,y:822,height:370}),
 cohost:Object.freeze({x:1115,y:822,height:366}),
 guest:Object.freeze({entryX:1710,entryY:724,x:1510,y:894,height:405}),
 magic:Object.freeze({x:1490,y:974,height:470}),
 board:Object.freeze({x:645,y:749,width:630,height:126}),
 brand:Object.freeze({x:960,y:385,bottom:438}),
});
const W=1920,H=1080,TAU=Math.PI*2;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const validImage=image=>image&&(image.naturalWidth||image.width)>0;
function gradient(ctx,x,y,x2,y2,stops){const g=ctx.createLinearGradient(x,y,x2,y2);for(const [p,c]of stops)g.addColorStop(p,c);return g;}
function text(ctx,value,x,y,size,color='#fff3cc',weight=700,align='center'){
 ctx.font=`${weight} ${size}px "Trebuchet MS",system-ui,sans-serif`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(String(value),x,y);
}
function glow(ctx,x,y,rx,ry,color){
 ctx.save();ctx.translate(x,y);ctx.scale(1,ry/rx);const g=ctx.createRadialGradient(0,0,0,0,0,rx);g.addColorStop(0,color);g.addColorStop(1,'#00000000');ctx.fillStyle=g;ctx.fillRect(-rx,-rx,rx*2,rx*2);ctx.restore();
}
function star(ctx,x,y,r,color,rotation=0){
 ctx.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5+rotation,d=i%2?r*.4:r;if(i)ctx.lineTo(x+Math.cos(a)*d,y+Math.sin(a)*d);else ctx.moveTo(x+Math.cos(a)*d,y+Math.sin(a)*d);}ctx.closePath();ctx.fillStyle=color;ctx.fill();
}

// The overscan is only 3%; the depth offset is deliberately small. The room
// carries its own embedded round display, so that display shares this transform.
export function roomTransform(camera={}){
 return {scale:1.03,x:clamp(((camera.x||960)-960)*.085,-30,30),y:clamp(((camera.y||540)-540)*.035,-10,10)};
}
function lastNumberDisplay(ctx,state){
 const confirmed=new Set((state.drawn||[]).filter(n=>Number.isInteger(n)&&n>=1&&n<=75));
 const last=confirmed.has(state.lastNumber)?state.lastNumber:null;
 // Coordinates measured against the actual rendered circular screen, not a
 // new flat panel placed over its golden frame.
 const x=286,y=424;
 ctx.save();ctx.beginPath();ctx.ellipse(x,y,80,79,0,0,TAU);ctx.clip();
 ctx.fillStyle=gradient(ctx,x-80,y-80,x+70,y+80,[[0,'#402365'],[.5,'#281749'],[1,'#43266d']]);ctx.fillRect(x-82,y-81,164,162);
 text(ctx,'LAATSTE NUMMER',x,y-51,10,'#e9d8f9',700);
 if(last!==null){ctx.shadowColor='#ffdc8a66';ctx.shadowBlur=14;text(ctx,last,x,y+1,76,gradient(ctx,0,y-40,0,y+40,[[0,'#fffce4'],[.5,'#ffe69c'],[1,'#efb64c']]),800);ctx.shadowBlur=0;}
 else{star(ctx,x,y+1,25,'#ffe5a2');}
 text(ctx,`${confirmed.size} / 75`,x,y+53,13,'#c9f9ed',700);ctx.restore();
}
function setLights(ctx,time,state){
 // Sparse highlights animate the existing stars. They do not redraw the room
 // or drift across a speaker's face. The supplied time freezes with the show.
 const reduced=!!state.show?.reducedMotion||state.reducedMotion;
 for(const [i,p]of [[214,236],[444,126],[1395,139],[1734,234],[960,236]].entries()){
  const a=reduced?.14:.12+(Math.sin(time*.55+i*1.9)+1)*.065;
  glow(ctx,p[0],p[1],i===4?58:22,i===4?48:20,`rgba(255,229,149,${a})`);
 }
 if(state.guestId||state.liveCall?.phase==='live'){
  const a=reduced?.1:.07+(Math.sin(time*.7)+1)*.035;
  glow(ctx,1690,616,102,176,`rgba(255,219,116,${a})`);
 }
}
function roundPlaque(ctx,state){
 const live=state.liveCall?.phase==='live';if(!live)return;
 const value=state.liveCall?.name||'Deelnemer';
 ctx.save();ctx.beginPath();ctx.roundRect(1535,746,290,52,17);ctx.fillStyle='#301548e8';ctx.fill();ctx.strokeStyle='#f5cf7e99';ctx.lineWidth=1.5;ctx.stroke();
 text(ctx,live?'TE GAST':'DEZE RONDE',1680,760,9,'#e6c68c');
 let display=String(value);ctx.font='700 17px "Trebuchet MS",system-ui,sans-serif';while(display.length>2&&ctx.measureText(display).width>250)display=display.slice(0,-2)+'…';
 text(ctx,display,1680,780,17,'#fff2d2');ctx.restore();
}
export function drawBroadcastSet(ctx,{state={},time=0,camera={},assets={}}={}){
 ctx.save();ctx.fillStyle='#211035';ctx.fillRect(0,0,W,H);
 const depth=roomTransform(camera);ctx.translate(W/2+depth.x,H/2+depth.y);ctx.scale(depth.scale,depth.scale);ctx.translate(-W/2,-H/2);
 if(validImage(assets.room))ctx.drawImage(assets.room,0,0,W,H);
 else{ctx.fillStyle=gradient(ctx,0,0,W,H,[[0,'#26123c'],[.6,'#493065'],[1,'#221238']]);ctx.fillRect(0,0,W,H);}
 lastNumberDisplay(ctx,state);setLights(ctx,time,state);roundPlaque(ctx,state);ctx.restore();
}
export function drawBroadcastDesk(ctx,{state={},assets={}}={}){
 const d=ARENA_LAYOUT.desk,s=STUDIO_ART.deskSource;
 ctx.save();
 // Ground the separate desk in the polished floor. The reflected object is
 // deliberately quiet and bounded rather than a duplicated, floating desk.
 if(validImage(assets.desk)){
  ctx.save();ctx.beginPath();ctx.rect(d.x-50,d.y+d.height-3,d.width+100,67);ctx.clip();ctx.globalAlpha=.13;
  ctx.translate(0,2*(d.y+d.height));ctx.scale(1,-1);ctx.drawImage(assets.desk,s.x,s.y,s.width,s.height,d.x,d.y,d.width,d.height);ctx.restore();
  glow(ctx,960,d.y+d.height-5,514,28,'#19082470');
  ctx.drawImage(assets.desk,s.x,s.y,s.width,s.height,d.x,d.y,d.width,d.height);
 }
 // Live grid is inset in the real blank screen of the rendered desk. Its
 // five rows and fifteen columns remain server-supplied and deterministic.
 const b=ARENA_LAYOUT.board,sx=b.width/DESK_BOARD.width,sy=b.height/DESK_BOARD.height;
 ctx.save();ctx.translate(b.x-DESK_BOARD.x*sx,b.y-DESK_BOARD.y*sy);ctx.scale(sx,sy);drawDeskNumberBoard(ctx,state.drawn||[],state.lastNumber,{integrated:true});ctx.restore();ctx.restore();
}
