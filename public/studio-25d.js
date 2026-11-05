import {createBrandPresenter} from './brand-presenter.js?v=36';
import {showBrand} from './show-brands.js?v=36';
import {brandedContext} from './brand-canvas.js?v=36';
import {createCanvasPresenter} from './canvas-presenter.js?v=36';
import {BINGO_BOARD,bingoBoardState,bingoBoardKey,drawBingoBoard} from './bingo-board.js?v=36';

import {drawShowGraphics} from './show-graphics.js?v=36';

const W=1920,H=1080;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=t=>t*t*(3-2*t);
const browserCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const browserImage=src=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error(`Afbeelding kon niet laden: ${src}`));i.src=src;});

// All positions are in the same 1920×1080 art space. Each camera is an
// intentional composition, never an orbit around a flat illustration.
export const SHOTS={
 wide:{plate:'master',cx:960,cy:540,zoom:1,host:'front'},
 establish:{plate:'master',cx:960,cy:540,zoom:1,host:'front'},
 front:{plate:'master',cx:665,cy:530,zoom:1.25,host:'front'},
 desk:{plate:'desk',cx:960,cy:540,zoom:1,host:'desk'},
 portrait:{plate:'desk',cx:960,cy:310,zoom:1.9,host:'desk'},
 machine:{plate:'machine',cx:960,cy:540,zoom:1,host:null},
 audience:{plate:'master',cx:430,cy:480,zoom:2.4,host:null},
 led:{plate:'desk',cx:960,cy:715,zoom:1.7,host:null},
 tour:{plate:'master',cx:960,cy:540,zoom:1.04,host:'front'},
};

// Art-specific integration coordinates are defined alongside the asset names.
export const ART={
 "master": {
  "file": "studio-master-v14.png",
  "led": [
   [
    622,
    489
   ],
   [
    1294,
    489
   ],
   [
    1294,
    744
   ],
   [
    622,
    744
   ]
  ],
  "deskMask": [
   [
    533.76,
    592.9200000000001
   ],
   [
    612.48,
    586.44
   ],
   [
    1267.2,
    586.44
   ],
   [
    1332.48,
    594.0
   ],
   [
    1359.36,
    606.96
   ],
   [
    1357.4399999999998,
    749.52
   ],
   [
    1372.8,
    760.3199999999999
   ],
   [
    1370.8799999999999,
    799.2
   ],
   [
    1347.84,
    813.24
   ],
   [
    535.6800000000001,
    813.24
   ],
   [
    497.28000000000003,
    799.2
   ],
   [
    495.36,
    760.3199999999999
   ],
   [
    514.5600000000001,
    748.4399999999999
   ],
   [
    514.5600000000001,
    606.96
   ]
  ],
  "machine": {
   "globe": [
    1617.6000000000001,
    420.12,
    207.35999999999999,
    182.52
   ],
   "badge": [
    1617.6000000000001,
    422.28000000000003,
    49.68
   ],
   "badgeOuter": [
    65.28,
    64.8
   ]
  },
  "presenter": {
   "x": 405,
   "y": 940,
   "height": 760
  }
 },
 "desk": {
  "file": "studio-desk-v17.png",
  "led": [[435,622],[1486,622],[1486,822],[435,822]],
  "deskMask": [[272,554],[314,544],[574,538],[960,536],[1344,539],[1605,545],[1647,554],[1658,938],[264,938]],
  "presenter": {"x":960,"y":910,"height":820}
 },
 "machine": {
  "file": "studio-machine-v11.png",
  "machine": {
   "globe": [
    1192.32,
    383.4,
    343.68,
    292.68
   ],
   "badge": [
    1188.48,
    407.16,
    88.884
   ],
   "badgeOuter": [
    117.12,
    115.56
   ]
  }
 }
};

export const THEMES={
 showtime:ART,
 sinterklaas:{
  master:{...ART.master,file:'sinterklaas-master-v14.png',led:[[591,564],[1272,564],[1272,757],[591,757]]},
  desk:{...ART.desk,file:'sinterklaas-desk-v17.png',led:[[428,591],[1490,591],[1490,817],[428,817]],deskMask:[[273,535],[459,530],[960,528],[1435,530],[1647,536],[1658,935],[264,935]]},
  machine:{...ART.machine,file:'sinterklaas-machine-v12.png'},
 }
};

const HOST_ART={
 rocco:{
 master:{file:'hosts/rocco-master-v36.webp',led:[[940,335],[1325,335],[1325,434],[940,434]],presenter:{x:445,y:990,height:825}},
 desk:{file:'hosts/rocco-desk-v36.webp',led:[[514,681],[1402,681],[1402,849],[514,849]],deskMask:[[0,637],[286,637],[286,650],[465,650],[465,649],[1455,649],[1455,650],[1640,650],[1640,637],[1920,637],[1920,1080],[0,1080]],presenter:{x:962,y:1230,height:1130}},
 machine:{file:'hosts/rocco-machine-v36.webp',machine:{globe:[1227,359,284,240]}}
 },
 milo:{
 master:{file:'hosts/milo-master-v36.webp',led:[[943,398],[1324,398],[1324,493],[943,493]],presenter:{x:450,y:846,height:725}},
 desk:{file:'hosts/milo-desk-v36.webp',led:[[502,638],[1413,638],[1413,817],[502,817]],deskMask:[[0,601],[277,601],[277,608],[1645,608],[1645,601],[1920,601],[1920,1080],[0,1080]],presenter:{x:960,y:1200,height:1110}},
 machine:{file:'hosts/milo-machine-v36.webp',machine:{globe:[1275,337,309,272]}}
 }
};
THEMES.royale=HOST_ART.rocco;THEMES.magico=HOST_ART.milo;
const HOST_SHOTS={...SHOTS,front:{plate:'master',cx:850,cy:525,zoom:1.13,host:'front'},portrait:{plate:'desk',cx:960,cy:310,zoom:1.7,host:'desk'},audience:{plate:'desk',cx:960,cy:395,zoom:1.35,host:'desk'},led:{plate:'desk',cx:960,cy:750,zoom:1.68,host:null}};

// Generated props stay anchored in art space, so every camera crops them with
// the set. The crops remove transparent padding, not any visible objects.
const FESTIVE_PROPS={
 gifts:{file:'sinterklaas-presents-v13.png',crop:[35,75,1410,910]},
 biscuits:{file:'sinterklaas-kruidnoten-v13.png',crop:[25,170,2025,445]},
};
const FESTIVE_LAYOUT={
 master:[['gifts',675,970,245],['gifts',1460,806,170],['biscuits',945,946,580],['biscuits',1580,947,420],['biscuits',180,892,240]],
 desk:[['gifts',230,935,260],['gifts',1665,939,260],['biscuits',775,1018,600],['biscuits',1375,1050,500]],
 machine:[['gifts',350,925,375],['gifts',1700,901,270],['biscuits',615,1020,580],['biscuits',1620,1040,470]],
};

function polygon(ctx,points){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();}
function ellipse(ctx,x,y,rx,ry){ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);}

export class VlampieStudio25D {
 constructor(canvas,options={}){
  this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:true});
  if(!this.ctx)throw new Error('Canvas2D is niet beschikbaar.');
  this.options=options;this.makeCanvas=options.canvasFactory||browserCanvas;
  this.loadImage=options.loadImage||browserImage;
  this.brandId='vlampie';this.brandRequest=0;this.brandCache=new Map();this.camera='wide';this.background='studio';this.hostSpot='front';this.theme='showtime';this.themeRequest=0;this.themeCache=new Map();this.disposed=false;this.prizeSource='';this.prizePicture=null;
  this.effects=true;this.effectsAvailable=true;this.failed=false;this.contextLost=false;
  this.accumulator=0;this.transitionAge=1;this.time=0;this.frameCount=0;
  this.previous=this.makeCanvas(1,1);this.previousCtx=this.previous.getContext('2d');
  this.led=this.makeCanvas(BINGO_BOARD.width,BINGO_BOARD.height);this.ledCtx=this.led.getContext('2d');
  this.ledKey='';this.resizePending=true;
  this.observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>this.resize()):null;
  this.observer?.observe(canvas);
 }
 async load(progress=()=>{}){
  let count=0;const done=()=>progress(Math.round(++count/7*100));
  const [master,desk,machine,presenter,mouth,blink,gift,races,shows,sprites,gallop,giftParts,logo]=await Promise.all([
   ...Object.values(ART).map(a=>this.loadImage(`assets/${a.file}`).then(i=>{done();return i;})),
   this.loadImage('assets/vlampie-illustrated-v10.png').then(i=>{done();return i;}),
   this.loadImage('assets/vlampie-mouth-open-v12.png').then(i=>{done();return i;}).catch(()=>{done();return null;}),
   this.loadImage('assets/vlampie-blink-v18.png').then(i=>{done();return i;}).catch(()=>{done();return null;}),
   this.loadImage('assets/sinterklaas-presents-v13.png').then(i=>{done();return i;}).catch(()=>{done();return null;}),
   this.loadImage('assets/race-environments.png').catch(()=>null),
   this.loadImage('assets/show-environments.png').catch(()=>null),
   this.loadImage('assets/game-sprites.png').catch(()=>null),
   this.loadImage('assets/horse-gallop-atlas.png').catch(()=>null),
   this.loadImage('assets/gift-components-atlas.png').catch(()=>null),
   this.loadImage('assets/studio-logo.png'),
  ]);
  this.logo=logo;this.images={master,desk,machine};this.gameAssets={races,shows,sprites,gallop,giftParts};
  this.themeCache.set('showtime',Promise.resolve(this.images));
  this.illustrated=createCanvasPresenter(presenter,{canvasFactory:this.makeCanvas,mouthImage:mouth,blinkImage:blink});this.mouthAvailable=!!mouth;this.blinkAvailable=!!blink;this.giftImage=gift;
  this.brandCache.set('vlampie',Promise.resolve({presenter:this.illustrated,logo:this.logo}));this.character={actions:{}};this.resize();return this;
 }
 async prepareWorld(identity){
  const b=showBrand(identity);if(b.id==='vlampie'&&!this.brandCache.has(b.id))return;if(!this.brandCache.has(b.id)){
   const promise=Promise.all([this.loadImage(b.mascot),this.loadImage(`/assets/hosts/${b.id}-talking.png`),this.loadImage(b.logo),this.loadImage(`/assets/hosts/${b.id}-games.webp`)]).then(([image,mouth,logo,games])=>({presenter:createBrandPresenter(image,{brandId:b.id,mouthImage:mouth,canvasFactory:this.makeCanvas}),logo,games}));this.brandCache.set(b.id,promise);promise.catch(()=>{if(this.brandCache.get(b.id)===promise)this.brandCache.delete(b.id);});
  }
  if(!this.themeCache.has(b.theme)){const promise=Promise.all(Object.entries(THEMES[b.theme]).map(async([key,art])=>[key,await this.loadImage(`assets/${art.file}`)])).then(Object.fromEntries);this.themeCache.set(b.theme,promise);promise.catch(()=>{if(this.themeCache.get(b.theme)===promise)this.themeCache.delete(b.theme);});}
  await Promise.all([this.brandCache.get(b.id),this.themeCache.get(b.theme)]);
 }
 async setBrand(identity,animate=true){
  const b=showBrand(identity),request=++this.brandRequest;if(b.id===this.brandId)return true;
  await this.prepareWorld(b.id);
  const result=await this.brandCache.get(b.id);if(this.disposed||request!==this.brandRequest)return false;
  this.captureTransition(animate);await this.setTheme(b.theme,false);if(this.disposed||request!==this.brandRequest)return false;this.illustrated=result.presenter;this.logo=result.logo;this.brandId=b.id;this.mouthAvailable=true;this.gameAssets.brandBackground=result.games||null;this.gameAssets.brandId=b.id;this.ledKey='';return true;
 }
 async setTheme(theme,animate=true){
  if(!THEMES[theme])return false;
  const request=++this.themeRequest;
  if(!this.themeCache.has(theme)){
   const assets={...THEMES[theme],...(theme==='sinterklaas'?FESTIVE_PROPS:{})};
   const pending=Promise.all(Object.entries(assets).map(async([key,art])=>[key,await this.loadImage(`assets/${art.file}`)])).then(Object.fromEntries);
   this.themeCache.set(theme,pending);
   pending.catch(()=>{if(this.themeCache.get(theme)===pending)this.themeCache.delete(theme);});
  }
  const images=await this.themeCache.get(theme);
  if(this.disposed||request!==this.themeRequest)return false;
  if(this.theme!==theme){this.captureTransition(animate);this.images=images;this.theme=theme;this.ledKey='';}
  return true;
 }
 captureTransition(animate){
  if(animate&&this.frameCount){this.previous.width=this.canvas.width;this.previous.height=this.canvas.height;this.previousCtx.drawImage(this.canvas,0,0);this.transitionAge=0;}
  else this.transitionAge=1;
 }
 async setPresenter(){return this.illustrated;}
 setAppearance(){}
 setEffects(enabled){this.effects=!!enabled;}
 setHostSpot(spot){this.hostSpot=spot;}
 setBackground(background){if(this.background!==background){this.background=background;this.transitionAge=1;}}
 setCamera(name,animate=true){
  name=name==='side'?'audience':name==='back'?'wide':name;
  if(!SHOTS[name])return;
  if(name!==this.camera){
   this.captureTransition(animate);
   this.camera=name;this.options.onCameraChange?.(name);
  }
 }
 resize(){this.resizePending=true;}
 applyResize(){
  const rect=this.canvas.getBoundingClientRect?.()||{width:this.canvas.width,height:this.canvas.height};
  const ratio=Math.min(globalThis.devicePixelRatio||1,1.5);
  const bound=Math.min(1,1920/Math.max(rect.width*ratio,1),1080/Math.max(rect.height*ratio,1));
  const width=Math.max(1,Math.round(rect.width*ratio*bound)),height=Math.max(1,Math.round(rect.height*ratio*bound));
  if(width!==this.canvas.width||height!==this.canvas.height){this.canvas.width=width;this.canvas.height=height;this.transitionAge=1;}
  this.resizePending=false;
 }
 render(delta,state={}){
  if(!this.character||this.failed)return;
  const prize=typeof state.show?.prizeImage==='string'&&/^\/api\/planner\/images\/[a-f0-9-]{36}$/.test(state.show.prizeImage)?state.show.prizeImage:'';
  if(prize!==this.prizeSource){this.prizeSource=prize;this.prizePicture=null;if(prize)this.loadImage(prize).then(image=>{if(!this.disposed&&this.prizeSource===prize)this.prizePicture=image;}).catch(()=>{});}
  this.accumulator+=delta;
  const cadence=state.show?.scene==='minigame'?1/60:1/30;
  if(this.accumulator<cadence-.001&&!this.resizePending&&this.frameCount)return;
  const step=Math.min(this.accumulator,.1);this.accumulator=0;
  try{
   if(this.resizePending)this.applyResize();
   const sceneKey=`${state.show?.scene}:${state.show?.sceneRevision||0}`;if(this.sceneKey!==sceneKey){this.captureTransition(!state.show?.reducedMotion&&state.show?.transition!=='cut');this.sceneKey=sceneKey;}
   this.transitionAge+=step;
   if(!state.stopped)this.time=state.time??this.time+step;
   this.drawFrame(this.ctx,state,step);
   const duration=(state.show?.transitionMs||700)/1000,mode=state.show?.reducedMotion?'cut':state.show?.transition||'fade';
   if(mode!=='cut'&&this.transitionAge<duration&&this.previous.width>1){
    const c=this.ctx,w=this.canvas.width,h=this.canvas.height,p=smooth(clamp(this.transitionAge/duration,0,1));c.save();c.setTransform(1,0,0,1,0,0);
    if(mode==='slide'){this.currentFrame??=this.makeCanvas(w,h);if(this.currentFrame.width!==w||this.currentFrame.height!==h){this.currentFrame.width=w;this.currentFrame.height=h;}this.currentFrame.getContext('2d').drawImage(this.canvas,0,0);c.clearRect(0,0,w,h);const offset=Math.round(p*w);c.drawImage(this.previous,-offset,0,w,h);c.drawImage(this.currentFrame,w-offset,0,w,h);}
    else if(mode==='logo'){if(p<.5)c.drawImage(this.previous,0,0,w,h);c.globalAlpha=Math.sin(Math.PI*p);c.fillStyle='#030711';c.fillRect(0,0,w,h);if(this.logo){const lw=Math.min(w*.62,h*1.25),lh=lw*this.logo.height/this.logo.width;c.drawImage(this.logo,(w-lw)/2,(h-lh)/2,lw,lh);}}
    else{c.globalAlpha=1-p;c.drawImage(this.previous,0,0,w,h);}c.restore();
   }
   this.frameCount++;
  }catch(error){this.failed=true;console.error('Studio kon niet tekenen:',error);this.options.onRenderFailure?.(error);}
 }
 drawFrame(ctx,state,delta){
  const width=this.canvas.width,height=this.canvas.height;
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,width,height);
  const scale=Math.min(width/W,height/H),ox=(width-W*scale)/2,oy=(height-H*scale)/2;
  if(this.background!=='transparent'){ctx.fillStyle='#040a18';ctx.fillRect(0,0,width,height);}
  ctx.save();ctx.translate(ox,oy);ctx.scale(scale,scale);
  ctx.beginPath();ctx.rect(0,0,W,H);ctx.clip();
  if(this.background!=='studio'){
   if(this.background==='blue'){ctx.fillStyle='#16418e';ctx.fillRect(0,0,W,H);}
   this.illustrated.draw(ctx,{x:960,y:1040,height:1010},state,delta);ctx.restore();return;
  }
  if(state.show?.scene==='minigame'&&state.show.gameStage?.type==='minigame'){drawShowGraphics(brandedContext(ctx,this.brandId),{...state,show:{...state.show,brandId:this.brandId}},{gameAssets:this.gameAssets,logo:this.logo});ctx.restore();return;}
  state={...state,brandId:this.brandId,show:state.show?{...state.show,brandId:this.brandId}:state.show};
  const hideHost=['lobby','still','rules','patterns'].includes(state.show?.scene);if(state.show?.scene==='still'){state={...state,stopped:true,idle:false,lightShow:false,bingoPending:null,bingoNumber:null,bingoDrawn:[]};this.time=0;}
  const shots=this.brandId==='vlampie'?SHOTS:HOST_SHOTS,shot=shots[this.brandId!=='vlampie'&&state.show?.scene==='call'&&!state.show.liveCall?'front':this.camera]||shots.wide,art=THEMES[this.theme][shot.plate],image=this.images[shot.plate];
  let zoom=shot.zoom,cx=shot.cx,cy=shot.cy;
  if(this.camera==='tour'&&state.idle){zoom+=.025*Math.sin(this.time*.16);cx+=24*Math.sin(this.time*.12);}
  cx=clamp(cx,W/(2*zoom),W-W/(2*zoom));cy=clamp(cy,H/(2*zoom),H-H/(2*zoom));
  ctx.translate(W/2,H/2);ctx.scale(zoom,zoom);ctx.translate(-cx,-cy);
  ctx.drawImage(image,0,0,W,H);
  // Audience crops stay behind every presenter layer, including his hands.
  if(this.brandId==='vlampie'&&state.show?.audience&&['audience','winner','finale'].includes(state.show.scene))this.drawAudienceReaction(ctx,shot.plate,state,image);
  if(shot.host==='desk'&&!hideHost){
   ctx.save();ctx.beginPath();ctx.rect(0,0,W,this.brandId==='vlampie'?650:700);ctx.clip();
   this.illustrated.draw(ctx,art.presenter||{x:960,y:1140,height:910},state,delta);ctx.restore();
   if(art.deskMask){ctx.save();polygon(ctx,art.deskMask);ctx.clip();ctx.drawImage(image,0,0,W,H);ctx.restore();}
  }
  if(art.led){this.updateLED(state);this.drawLED(ctx,art.led);}
  if(art.machine)this.drawMachine(ctx,art.machine,state,image);
  if(this.theme==='sinterklaas')this.drawFestiveProps(ctx,shot.plate);
  if(shot.host==='front'&&!hideHost){
   const p=state.show?.scene==='card'?{x:this.brandId==='vlampie'?395:350,y:this.brandId==='milo'?870:980,height:this.brandId==='milo'?745:825}:art.presenter||{x:530,y:1000,height:850};
   ctx.save();ctx.globalAlpha=.24;ctx.fillStyle='#000818';ellipse(ctx,p.x,p.y-3,p.height*.18,p.height*.028);ctx.fill();ctx.restore();
   this.illustrated.draw(ctx,p,state,delta);
  }
  if(state.lightShow&&this.effects)this.drawLights(ctx,shot.plate,state);
  ctx.restore();
  // Graphics live in the same canvas as the show, after restoring camera framing.
  ctx.save();ctx.translate(ox,oy);ctx.scale(scale,scale);ctx.beginPath();ctx.rect(0,0,W,H);ctx.clip();drawShowGraphics(brandedContext(ctx,this.brandId),state,{gift:this.brandId==='vlampie'?(this.images.gifts||this.giftImage):null,giftCrop:FESTIVE_PROPS.gifts.crop,prize:this.prizePicture,gameAssets:this.gameAssets,logo:this.logo});ctx.restore();
 }
 drawFestiveProps(ctx,plate){
  for(const [key,x,bottom,width] of FESTIVE_LAYOUT[plate]||[]){
   const image=this.images[key];if(!image)continue;
   const crop=FESTIVE_PROPS[key].crop,height=width*crop[3]/crop[2];
   ctx.drawImage(image,...crop,x-width/2,bottom-height,width,height);
  }
 }
 updateLED(state){
  const board=bingoBoardState(state),key=bingoBoardKey(board,this.theme,showBrand(this.brandId).title);
  if(key===this.ledKey)return;this.ledKey=key;
  drawBingoBoard(brandedContext(this.ledCtx,this.brandId),board,this.theme,showBrand(this.brandId).title);
 }
 drawLED(ctx,quad){
  const [tl,tr,,bl]=quad,width=tr[0]-tl[0],height=bl[1]-tl[1];
  const scale=Math.min(width/BINGO_BOARD.width,height/BINGO_BOARD.height);
  const dw=BINGO_BOARD.width*scale,dh=BINGO_BOARD.height*scale;
  ctx.fillStyle='#040914';ctx.fillRect(tl[0],tl[1],width,height);
  ctx.drawImage(this.led,tl[0]+(width-dw)/2,tl[1]+(height-dh)/2,dw,dh);
 }
 drawMachine(ctx,m,state,image){
  const [x,y,rx,ry]=m.globe,t=this.time,pending=state.bingoPending!=null;
  ctx.save();ellipse(ctx,x,y,rx*.88,ry*.88);ctx.clip();
  const balls=[];
  for(let i=0;i<24;i++){
   const phase=i*2.399+t*(pending?2.8:.23),ring=.2+.68*((i*13%23)/23);
   const z=Math.sin(phase*.83+i),bx=x+Math.cos(phase)*rx*ring;
   const by=pending?y+Math.sin(phase*1.19)*ry*ring:y+ry*(.4+.19*Math.sin(phase+i))-(i%3)*ry*.14;
   balls.push({x:bx,y:by,r:rx*(.075+.013*(z+1)),z,i});
  }
  balls.sort((a,b)=>a.z-b.z);
  const colors=['#4c8deb','#db7734','#f0c64f','#8464cb','#3faba2'];
  for(const b of balls){
   const g=ctx.createRadialGradient(b.x-b.r*.3,b.y-b.r*.4,0,b.x,b.y,b.r);
   g.addColorStop(0,'#f4faff');g.addColorStop(.22,colors[b.i%5]);g.addColorStop(1,'#132753');ctx.fillStyle=g;ellipse(ctx,b.x,b.y,b.r,b.r);ctx.fill();
   ctx.fillStyle='#fff8e2';ellipse(ctx,b.x,b.y,b.r*.55,b.r*.55);ctx.fill();ctx.fillStyle='#17253a';ctx.font=`800 ${Math.max(7,b.r*.8)}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String((b.i*17+4)%75+1),b.x,b.y+1);
  }
  // Rotating meridians keep the empty glass housing readable as a bingo cage.
  const phase=t*(pending?2.4:.18);
  ctx.lineWidth=Math.max(1.2,rx*.008);
  for(let i=0;i<5;i++){
   const a=phase+i*Math.PI/5,w=Math.abs(Math.cos(a))*rx*.86;
   ctx.strokeStyle=`rgba(246,208,126,${.17+.24*(Math.sin(a)+1)/2})`;ellipse(ctx,x,y,Math.max(1,w),ry*.88);ctx.stroke();
  }
  ctx.restore();
  if(m.badge){const [bx,by,r]=m.badge;ctx.save();ellipse(ctx,bx,by,...m.badgeOuter);ctx.clip();ctx.drawImage(image,0,0,W,H);ctx.restore();ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#102448';ctx.font=`800 ${r*1.08}px Arial`;ctx.fillText(pending?'…':String(state.bingoNumber??'–'),bx,by+r*.05);ctx.restore();}
 }
 drawAudienceReaction(ctx,plate,state,image){
  if(plate==='machine'||state.show.reducedMotion)return;
  ctx.save();
  // Tiny movement of the existing side-stand artwork plus applause lighting.
  const lift=Math.sin(this.time*7)*1.6;
  for(const side of [0,1]){ctx.save();ellipse(ctx,side?1815:105,575,135,130);ctx.clip();ctx.drawImage(image,0,lift*(side?-1:1),W,H);ctx.restore();}
  ctx.globalCompositeOperation='screen';ctx.fillStyle=`rgba(249,206,119,${.04+.03*(1+Math.sin(this.time*6))/2})`;
  for(const side of [0,1]){ellipse(ctx,side?1815:105,575,145,145);ctx.fill();}ctx.restore();
 }
 drawLights(ctx,plate,state){
  if(plate==='machine')return;
  ctx.save();ctx.globalCompositeOperation='screen';
  const calm=state.speaking||['reveal','board','checking'].includes(state.show?.scene);
  const drift=Math.sin(this.time*(calm?.16:.35))*(calm?70:180);
  for(const [origin,target] of [[350,780+drift],[1580,1100-drift]]){
   const gradient=ctx.createLinearGradient(origin,0,target,850);gradient.addColorStop(0,'rgba(137,188,255,.065)');gradient.addColorStop(1,'rgba(137,188,255,0)');
   ctx.fillStyle=gradient;polygon(ctx,[[origin-8,0],[origin+8,0],[target+160,850],[target-160,850]]);ctx.fill();
  }
  ctx.restore();
 }
 async export8K(state={}){
  const target=this.makeCanvas(7680,4320),original=this.canvas;this.canvas=target;
  try{this.drawFrame(target.getContext('2d'),{...state,stopped:true},0);}finally{this.canvas=original;}
  return target;
 }
 dispose(){this.disposed=true;this.themeRequest++;this.brandRequest++;for(const value of this.brandCache.values())value.then(v=>v.presenter.dispose?.());this.brandCache.clear();this.observer?.disconnect();this.illustrated?.dispose();this.character=null;this.themeCache.clear();}
}
