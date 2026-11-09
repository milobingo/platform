import {createCutoutRig,clamp,mix,smooth} from './mf-rig.js';
import {createMiloPuppet} from './milo-puppet.js';
import {miloBlinkAt,miloAttentionAt} from './milo-life.js';
import {GameMotionClock} from './bingo-motion.js';
import {drawShowEffects,drawShowCueWand,motionEnvelope} from './mf-show-effects.js';
import {drawShowGraphics} from './show-graphics.js';
import {brandedContext} from './brand-canvas.js';
import {ARENA_LAYOUT,STUDIO_ART,drawBroadcastSet,drawBroadcastDesk} from './mf-broadcast-set.js';
import {CAMERA_PRESETS,CameraRig,resolveCameraShot,boundCamera} from './mf-camera.js';
import {studioTourAt} from './milo-studio-tour.js';
import {MAGIC_CUES} from './magic-cues.js';
import {drawExtraMagic,EXTRA_MAGIC_IDS} from './milo-magic-effects.js';
export {CAMERA_PRESETS} from './mf-camera.js';

const W=1920,H=1080,TAU=Math.PI*2;
const ASSETS='/assets/milo-friends/characters/';
const LABELS={milo:'Milo Magico',stella:'Stella Sterrenstof',otto:'Otto Octa',pip:'Pip Popcorn',lola:'Lola Lumière',bella:'Bella Bellissimo',piko:'Professor Piko',bruno:'Bruno Bonbon',nino:'Nino Nonsens',benny:'Benny Bubbels',kora:'Kapitein Kora',coco:'Coco Calypso'};
const cache=new Map();
let productionAssets;
function loadProductionAssets(){return productionAssets??=Promise.all(['race-environments.png','show-environments.png','game-sprites.png','horse-gallop-atlas.png','gift-components-atlas.png','hosts/milo-games.webp'].map(name=>loadImage('/assets/'+name).catch(()=>null))).then(([races,shows,sprites,gallop,giftParts,brandBackground])=>({races,shows,sprites,gallop,giftParts,brandBackground,brandId:'milo'}));}
export const MAGIC_MOMENTS=MAGIC_CUES;

function loadImage(src){
  if(!cache.has(src))cache.set(src,new Promise((resolve,reject)=>{const i=new Image();i.decoding='async';i.onload=()=>resolve(i);i.onerror=()=>{cache.delete(src);reject(new Error('Afbeelding niet beschikbaar: '+src));};i.src=src;}));
  return cache.get(src);
}
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
const fillText=(ctx,text,x,y,size,color='#fff1ce',weight=600,align='center')=>{ctx.font=`${weight} ${size}px "Trebuchet MS",system-ui,sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(String(text),x,y);};
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
function star(ctx,x,y,r,rotation=0,inner=.46){ctx.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5+rotation,rr=i%2?r*inner:r;if(i===0)ctx.moveTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);else ctx.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);}ctx.closePath();}
function glow(ctx,x,y,r,color,alpha=.7){ctx.save();ctx.globalAlpha*=alpha;const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'rgba(255,200,100,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();ctx.restore();}
function goldStar(ctx,x,y,r,rotation=0){
  ctx.save();ctx.shadowColor='rgba(255,185,54,.75)';ctx.shadowBlur=r*.5;star(ctx,x,y,r,rotation);const g=ctx.createLinearGradient(x-r,y-r,x+r,y+r);g.addColorStop(0,'#fff9c8');g.addColorStop(.25,'#fff0a1');g.addColorStop(.5,'#e7a03b');g.addColorStop(.73,'#ffe6a2');g.addColorStop(1,'#a9581e');ctx.fillStyle=g;ctx.fill();ctx.shadowBlur=0;ctx.lineWidth=Math.max(1.5,r*.035);ctx.strokeStyle='#fff7c6';ctx.stroke();
  for(let i=0;i<5;i++){const a=-Math.PI/2+i*TAU/5+rotation,b=a+Math.PI/5;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r);ctx.lineTo(x+Math.cos(b)*r*.46,y+Math.sin(b)*r*.46);ctx.closePath();ctx.fillStyle=i%2?'rgba(112,53,4,.18)':'rgba(255,255,236,.31)';ctx.fill();}ctx.restore();
}
function ball(ctx,x,y,r,value,color='#7544ac',emphasis=false){
  ctx.save();ctx.shadowColor='rgba(21,8,37,.4)';ctx.shadowBlur=12;ctx.shadowOffsetY=7;
  const g=ctx.createRadialGradient(x-r*.35,y-r*.4,r*.05,x+r*.2,y+r*.25,r*1.2);g.addColorStop(0,'#f2dcff');g.addColorStop(.21,color);g.addColorStop(.72,color);g.addColorStop(1,'#1e143c');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  const inner=ctx.createRadialGradient(x-r*.13,y-r*.19,0,x,y,r*.69);inner.addColorStop(0,'#fffef2');inner.addColorStop(1,'#d9d7df');ctx.fillStyle=inner;ctx.beginPath();ctx.arc(x,y,r*.64,0,TAU);ctx.fill();ctx.lineWidth=emphasis?3:1.2;ctx.strokeStyle=emphasis?'#fff0b6':'rgba(255,255,255,.65)';ctx.stroke();
  if(value!==null&&value!==undefined&&value!=='')fillText(ctx,value,x,y+r*.025,r*.83,'#28173f',800);
  else goldStar(ctx,x,y,r*.31);
  ctx.beginPath();ctx.ellipse(x-r*.28,y-r*.48,r*.24,r*.11,-.6,0,TAU);ctx.fillStyle='rgba(255,255,255,.45)';ctx.fill();ctx.restore();
}

/**
 * Standalone 16:9 2.5D output. The caller owns audio and official game state.
 * update() only draws supplied numbers and never creates/commits a bingo draw.
 */
export function mountStudio(container,options={}){
  if(!container?.appendChild)throw new TypeError('mountStudio needs a DOM container.');
  const root=document.createElement('div');root.className='mf-studio';
  const cv=canvas(1280,720);cv.setAttribute('role','img');cv.setAttribute('aria-label','Milo & Friends BingoShow in het Sterrenplein');
  const status=document.createElement('span');status.className='mf-studio__sr';status.setAttribute('aria-live','polite');
  const loading=document.createElement('div');loading.className='mf-studio__loading';loading.textContent='Het Sterrenplein wordt klaargezet…';
  root.append(cv,status,loading);container.append(root);
  const ctx=cv.getContext('2d',{alpha:false,desynchronized:true});
  const motionPreference=window.matchMedia?.('(prefers-reduced-motion: reduce)');let prefersReduced=!!motionPreference?.matches;const motionPreferenceChanged=e=>{prefersReduced=!!e.matches;};motionPreference?.addEventListener?.('change',motionPreferenceChanged);
  if(!ctx){loading.textContent='Dit apparaat kan het studiobeeld niet tekenen.';return {update(){},destroy(){root.remove();}};}
  const cueClocks={showCue:null,movement:null};
  let showAgeAt=0,showKey='',transition=null,overlayLogo=null,overlayAssets={},prizeImage=null,prizeUrl='';
  loadImage('/assets/milo-friends/logo.png').then(v=>overlayLogo=v).catch(()=>{});
  let state={production:'milo',hostId:'milo',cohostId:null,guestId:null,camera:'wide',movingCamera:true,motion:'idle',speaking:false,speakerId:null,caption:'',lastNumber:null,drawn:[],roundTitle:'Welkom bij Milo & Friends',pattern:null,paused:false,showCaptions:true,showBrandBug:false,...options.state};
  const gameMotionClock=new GameMotionClock();
  let gameAge=null;
  let numberReactionAt=-Infinity;
  let disposed=false,sceneTime=0,performerTime=0,renderDelta=0,lastFrame=0,lastTick=0,raf=0,resolution=1280,magic=null,guestEnteredAt=0,leavingGuest=null,lastExternalMagicKey=null,speechStartedAt=0;
  const scenery={room:null,desk:null};let scenicError=null,scenicReady=false,magicProps=null;
  const magicPropsLoaded=loadImage(STUDIO_ART.magic).then(image=>{if(!disposed)magicProps=image;}).catch(()=>{});
  const sceneryLoaded=Promise.all([loadImage(STUDIO_ART.room),loadImage(STUDIO_ART.desk)]).then(([room,desk])=>{
    if(disposed)return;scenery.room=room;scenery.desk=desk;scenicReady=true;loading.hidden=true;options.onReady?.();
  }).catch(error=>{if(disposed)return;scenicError=error.message;loading.textContent='Het decor kon niet worden geladen. Vernieuw om het opnieuw te proberen.';options.onAssetError?.('sterrenplein-decor',error);});
  const cameraRig=new CameraRig({shot:state.camera,moving:state.movingCamera,reducedMotion:prefersReduced||!!state.show?.reducedMotion});let cam={...CAMERA_PRESETS[state.camera]||CAMERA_PRESETS.wide};
  const actors=new Map(),pending=new Map(),actorErrors=new Set();
  let manifest={};
  const particles=Array.from({length:72},(_,i)=>({x:(Math.sin(i*129.9)*43758.5%1+1)%1*W,y:(Math.sin(i*79.1+5)*9132.5%1+1)%1*680,r:1.4+(i%5)*.5,speed:.7+(i%9)*.17,phase:i*1.83}));
  let oldCaption='';
  let boardScreen={top:ARENA_LAYOUT.board.y,bottom:ARENA_LAYOUT.board.y+ARENA_LAYOUT.board.height},captionScreen=null;

  function loadActor(id){
    if(!id||actors.has(id))return Promise.resolve();
    if(pending.has(id))return pending.get(id);
    const loading=(async()=>{try{
      await actorManifestLoaded;
      const img=await loadImage(ASSETS+id+'.png');
      let talk=null;try{talk=await loadImage(ASSETS+id+'-talk.png');}catch{}
      if(disposed)return;
      const rig=(id==='milo'?createMiloPuppet:createCutoutRig)(img,{id,talkImage:talk,profile:manifest[id]?.rig||manifest[id]||{}});
      actors.set(id,{rig,image:img,talk,phase:Object.keys(LABELS).indexOf(id)*1.37});actorErrors.delete(id);
      options.onAssetReady?.(id,{talking:!!talk,stats:rig.stats});
    }catch(error){
      if(id==='milo')try{const [img,talk]=await Promise.all([loadImage('/assets/hosts/milo-mascot.png'),loadImage('/assets/hosts/milo-talking.png')]);if(!disposed)actors.set(id,{rig:createCutoutRig(img,{id,talkImage:talk}),image:img,talk,phase:0});}catch{actorErrors.add(id);}
      else actorErrors.add(id);
      options.onAssetError?.(id,error);
    }finally{pending.delete(id);}})();
    pending.set(id,loading);return loading;
  }
  const needed=()=>[state.hostId,state.cohostId,state.guestId,magic?'milo':null].filter(Boolean);
  function ensureActors(){needed().forEach(loadActor);}
  const actorManifestLoaded=Promise.all(['rigs-a.json','profiles-b.json'].map(name=>fetch(ASSETS+name).then(r=>r.ok?r.json():{}).catch(()=>({})))).then(list=>{if(disposed)return;manifest=Object.assign({},...list.map(data=>data.characters||data.profiles||data));for(const id of actors.keys()){actors.get(id).rig.dispose();actors.delete(id);}ensureActors();}).catch(()=>{});

  function resize(){
    const rect=root.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,1.5);
    const next=clamp(Math.round((rect.width||1280)*dpr),640,1920);
    if(next===resolution&&cv.width===next)return;resolution=next;cv.width=next;cv.height=Math.round(next*9/16);
  }
  const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(resize):null;observer?.observe(root);window.addEventListener('resize',resize);resize();

  function update(partial={}){
    syncCueClock('showCue',partial);syncCueClock('movement',partial);
    const oldGuest=state.guestId,wasSpeaking=state.speaking,oldSpeech=state.caption,oldNumber=state.lastNumber;
    if(partial.show){const key=partial.show.scene+':'+partial.show.sceneRevision;if(showKey&&key!==showKey&&!partial.show.reducedMotion&&!prefersReduced&&partial.show.transition!=='cut'&&cv.width){const image=canvas(cv.width,cv.height);image.getContext('2d').drawImage(cv,0,0);transition={image,start:performance.now(),duration:partial.show.transitionMs||650,kind:partial.show.transition};}showKey=key;showAgeAt=sceneTime;
      if(partial.show.scene==='minigame')loadProductionAssets().then(v=>{if(!disposed)overlayAssets=v;});
      if(partial.show.prizeImage!==prizeUrl){prizeUrl=partial.show.prizeImage||'';prizeImage=null;if(prizeUrl){const requested=prizeUrl;loadImage(requested).then(v=>{if(!disposed&&requested===prizeUrl)prizeImage=v;}).catch(()=>{});}}
    }
    state={...state,...partial};
    if(state.speaking&&(!wasSpeaking||state.caption!==oldSpeech))speechStartedAt=sceneTime;
    state.drawn=(Array.isArray(state.drawn)?state.drawn:[]).map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=75);
    state.lastNumber=state.lastNumber===null||state.lastNumber===undefined||state.lastNumber===''?null:Number(state.lastNumber);
    if(!Number.isInteger(state.lastNumber)||state.lastNumber<1||state.lastNumber>75)state.lastNumber=null;
    if(state.lastNumber!==oldNumber&&state.drawn.includes(state.lastNumber))numberReactionAt=performerTime;
    if(!LABELS[state.hostId])state.hostId='milo';
    if(state.guestId===state.hostId||state.guestId===state.cohostId)state.guestId=null;
    if(partial.camera||Object.hasOwn(partial,'cameraTransition')||Object.hasOwn(partial,'cameraDuration'))setCamera(state.camera,{moving:state.movingCamera,transition:state.cameraTransition,duration:state.cameraDuration});
    if(state.guestId!==oldGuest){if(oldGuest)leavingGuest={id:oldGuest,start:sceneTime};guestEnteredAt=sceneTime;}
    if(Object.hasOwn(partial,'magic')){
      const m=partial.magic;
      if(!m||m.playing===false){magic=null;lastExternalMagicKey=null;}
      else if(lastExternalMagicKey!==String(m.id)+':'+String(m.startedAt)){
        lastExternalMagicKey=String(m.id)+':'+String(m.startedAt);const elapsed=Number.isFinite(m.elapsed)?Math.max(0,m.elapsed/1000):m.startedAt?Math.max(0,(Date.now()-m.startedAt)/1000):0;playMagic(m.id,{externalKey:lastExternalMagicKey,elapsed,duration:m.duration});
      }else if(magic&&Number.isFinite(m.elapsed)&&m.elapsed!==magic.externalElapsed){
        const elapsed=Math.max(0,m.elapsed/1000);magic.externalElapsed=m.elapsed;if(String(m.startedAt).startsWith('preview-')||Math.abs(sceneTime-magic.start-elapsed)>.35)magic.start=sceneTime-elapsed;
      }
    }
    ensureActors();
    const label=state.caption||state.roundTitle||'';if(label!==oldCaption){status.textContent=label;oldCaption=label;}
    return api;
  }
  function setCamera(id,{moving=state.movingCamera,transition=state.cameraTransition||'smooth',duration=state.cameraDuration||1400}={}){
    id=resolveCameraShot(id);state.camera=id;state.movingCamera=moving;cameraRig.setShot(id,{moving,transition:state.paused?'cut':transition,duration,reducedMotion:prefersReduced||!!state.show?.reducedMotion});return api;
  }
  function playMagic(id='star-hat',opts={}){
    const aliases={hat:'star-hat',stars:'silk-stars',ribbon:'silk-stars','floating-hat':'star-hat','ribbon-butterfly':'silk-stars'};id=aliases[id]||id;
    const m=MAGIC_MOMENTS.find(x=>x.id===id)||MAGIC_MOMENTS[0];
    const previous=magic;magic={...m,duration:Number.isFinite(opts.duration)?clamp(opts.duration,2,180):m.duration,start:sceneTime-(opts.elapsed||0),externalKey:opts.externalKey||null,externalElapsed:opts.externalKey?(opts.elapsed||0)*1000:null,oldCamera:previous?.oldCamera||state.camera,oldMoving:previous?.oldMoving??state.movingCamera};setCamera(m.camera||'magic',{moving:state.movingCamera});loadActor('milo');
    options.onEvent?.({type:'magic-start',id:m.id,duration:magic.duration});return api;
  }
  function setSpeaking(speaking,extra={}){return update({speaking:!!speaking,...extra});}

  const reducedMotion=()=>prefersReduced||!!state.show?.reducedMotion;
  function clockElapsed(clock){return clock?Math.min(clock.duration,clock.elapsed+(clock.paused?0:Math.max(0,sceneTime-clock.anchor))):0;}
  function syncCueClock(name,partial){
    const incoming=Object.hasOwn(partial,name)?partial[name]:state[name];
    if(!incoming){cueClocks[name]=null;return;}
    const key=String(incoming.id)+':'+String(incoming.instanceId??incoming.startedAt??''),elapsed=Math.max(0,Number(incoming.elapsed)||0),duration=Math.max(.1,Number(incoming.duration)||8),paused=!!(partial.paused??state.paused)||!!incoming.paused;
    const clock=cueClocks[name];
    if(!clock||clock.key!==key){cueClocks[name]={key,sourceElapsed:elapsed,elapsed,anchor:sceneTime,duration,paused};return;}
    const current=clockElapsed(clock),fresh=elapsed!==clock.sourceElapsed;
    // React/output snapshots can repeat the same remote packet several times.
    // Re-anchor only to new source time or a pause edge, never to stale packets.
    if(fresh){clock.elapsed=incoming.source==='preview'||(paused&&clock.paused)||Math.abs(elapsed-current)>.35?elapsed:Math.max(current,elapsed);clock.anchor=sceneTime;clock.sourceElapsed=elapsed;}
    if(clock.paused!==paused){if(!fresh)clock.elapsed=current;clock.anchor=sceneTime;clock.paused=paused;}
    clock.duration=duration;
  }
  const activeShowCue=()=>state.showCue?{...state.showCue,elapsed:clockElapsed(cueClocks.showCue)}:null;
  const activeMovement=()=>state.movement?{...state.movement,elapsed:clockElapsed(cueClocks.movement)}:null;
  function backdrop(){drawBroadcastSet(ctx,{state:{...state,reducedMotion:reducedMotion()},time:sceneTime,camera:cam,assets:scenery});}

  function shadow(x,y,w=140){ctx.save();const g=ctx.createRadialGradient(x,y,0,x,y,w);g.addColorStop(0,'rgba(29,9,44,.47)');g.addColorStop(1,'rgba(29,9,44,0)');ctx.scale(1,.24);ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y/.24,w,0,TAU);ctx.fill();ctx.restore();}
  function actorSettings(id){
    const source=state.characterSettings;
    if(Array.isArray(source))return source.find(c=>c.id===id)||{};
    if(source&&typeof source==='object')return source.id?source.id===id?source:{}:source[id]||{};
    return {};
  }
  function actor(id,{x,y,height,clipDesk=false,enter=1,motion=state.motion||'idle',magicProgress=-1,walking=null}={}){
    const a=actors.get(id);if(!a){
      if(actorErrors.has(id)){ctx.save();ctx.globalAlpha=.9;roundRect(ctx,x-112,600,224,46,23);ctx.fillStyle='#2d1b4e';ctx.fill();fillText(ctx,LABELS[id]||'Presentator',x,623,18,'#ffe4ac');ctx.restore();}return null;
    }
    const settings=actorSettings(id),speaking=state.speaking&&(state.speakerId?state.speakerId===id:state.hostId===id),liveTime=performerTime+a.phase;
    if(speaking&&motion==='idle')motion='speak';
    const cue=activeShowCue(),movement=id===state.hostId?activeMovement():null;
    const cueTime=cue&&id===state.hostId?cue.elapsed:undefined;
    const actingTime=movement?.elapsed??cueTime??liveTime;
    const t=reducedMotion()||((state.idleMotion===false||settings.idleMotion===false)&&motion==='idle')?0:actingTime;
    const motionBlend=walking?walking.blend:movement?motionEnvelope(movement.elapsed,movement.duration):cue&&id===state.hostId?motionEnvelope(cue.elapsed,cue.duration):1;
    const energy=Number.isFinite(settings.gestureEnergy)?clamp(settings.gestureEnergy,0,100)/70:Number.isFinite(state.gestureEnergy)?(state.gestureEnergy>2?clamp(state.gestureEnergy,0,100)/70:state.gestureEnergy):1;
    const mouth=state.lipSync===false||settings.lipSync===false?0:typeof state.mouth==='number'?state.mouth:speaking?clamp(.15+Math.sin(liveTime*15.5)*.31+Math.sin(liveTime*24.2)*.24,.03,1):0;
    const blinkPhase=(liveTime+1.3)%5.1,blink=id==='milo'?miloBlinkAt(liveTime):blinkPhase>.08&&blinkPhase<.28?Math.sin((blinkPhase-.08)/.20*Math.PI)**1.1:0;
    const speakerSide=state.speaking&&!speaking?(state.speakerId===state.cohostId?1:state.cohostId&&id===state.cohostId?-1:state.speakerId===state.guestId?1:0):0;
    const attention=id==='milo'&&!((state.idleMotion===false||settings.idleMotion===false)&&motion==='idle')?miloAttentionAt({speaking,listening:motion==='listen'||!!state.liveCall,speakerSide,guestSide:state.guestId&&id!==state.guestId?1:0,numberAge:performerTime-numberReactionAt}):{};
    ctx.save();if(clipDesk){ctx.beginPath();ctx.rect(0,0,W,ARENA_LAYOUT.desk.occlusionY);ctx.clip();}
    const result=a.rig.draw(ctx,{...attention,x,y,height,time:t,idleTime:(state.idleMotion===false||settings.idleMotion===false)&&motion==='idle'?0:liveTime,deltaTime:renderDelta,paused:!!state.paused&&!(speaking&&state.speechActive===true),immediate:state.showCue?.source==='preview'&&!!state.showCue?.paused||state.movement?.source==='preview'&&!!state.movement?.paused,reducedMotion:reducedMotion(),magicId:magic?.id,motion,energy:reducedMotion()?0:energy,speaking,mouth,blink:state.blink===false||reducedMotion()?0:blink,magicProgress,alpha:smooth(enter),motionBlend,...(walking?{walkPhase:walking.bodyDistance*(a.rig.bounds?.h||874)/(100/.62),walkDirection:walking.direction,walkStride:1}:{})});ctx.restore();return result;
  }
  function deskFront(){drawBroadcastDesk(ctx,{state,time:sceneTime,assets:scenery});}

  function cast(){
    const isMagic=!!magic;
    const hostX=state.cohostId?805:ARENA_LAYOUT.host.x,coX=ARENA_LAYOUT.cohost.x;
    const tour=!isMagic&&state.hostId==='milo'?studioTourAt(activeShowCue(),{homeX:hostX,reducedMotion:reducedMotion()}):null;
    const tourActor=()=>{ctx.save();ctx.globalAlpha*=tour.alpha;shadow(tour.x,tour.y+5,105*tour.height/440);ctx.restore();actor('milo',{...tour,walking:tour,enter:tour.alpha});};
    if(tour?.layer==='behind')tourActor();
    if(!tour&&!(isMagic&&state.hostId==='milo')){const hostRig=actor(state.hostId,{x:hostX,y:ARENA_LAYOUT.host.y,height:ARENA_LAYOUT.host.height,clipDesk:true});if(!state.cohostId)drawShowCueWand(ctx,{cue:activeShowCue(),wrist:hostRig?.grip||hostRig?.wrist,reducedMotion:reducedMotion()});}
    if(state.cohostId&&state.cohostId!==state.hostId&&!(isMagic&&state.cohostId==='milo'))actor(state.cohostId,{x:coX,y:ARENA_LAYOUT.cohost.y,height:ARENA_LAYOUT.cohost.height,clipDesk:true,motion:state.speakerId===state.cohostId?state.motion:'listen'});
    if(state.guestId&&!(isMagic&&state.guestId==='milo')){
      const p=reducedMotion()?1:smooth((sceneTime-guestEnteredAt)/3.6),x=mix(ARENA_LAYOUT.guest.entryX,ARENA_LAYOUT.guest.x,p),h=mix(245,ARENA_LAYOUT.guest.height,p),y=mix(ARENA_LAYOUT.guest.entryY,ARENA_LAYOUT.guest.y,p);shadow(x,y+8,95);actor(state.guestId,{x,y,height:h,enter:p,motion:p<1?'walk':'wave'});
    }
    if(leavingGuest){const p=reducedMotion()?1:smooth((sceneTime-leavingGuest.start)/3.1);if(p>=1)leavingGuest=null;else{const x=mix(ARENA_LAYOUT.guest.x,ARENA_LAYOUT.guest.entryX,p),y=mix(ARENA_LAYOUT.guest.y,ARENA_LAYOUT.guest.entryY,p),height=mix(ARENA_LAYOUT.guest.height,245,p);shadow(x,y+8,90);actor(leavingGuest.id,{x,y,height,enter:1-p,motion:'walk'});}}
    deskFront();
    if(tour?.layer==='front')tourActor();
    if(isMagic){const elapsed=sceneTime-magic.start,p=elapsed/magic.duration,stageIn=reducedMotion()?1:smooth(elapsed/1.8),stageOut=smooth((magic.duration-elapsed)/1.5),entrance=Math.min(stageIn,stageOut);const x=mix(ARENA_LAYOUT.host.x,ARENA_LAYOUT.magic.x,stageIn),y=mix(ARENA_LAYOUT.host.y,ARENA_LAYOUT.magic.y,stageIn),height=mix(ARENA_LAYOUT.host.height,ARENA_LAYOUT.magic.height,stageIn);shadow(x,y-4,120);const rig=actor('milo',{x,y,height,motion:'magic',magicProgress:p,enter:entrance});const hand=EXTRA_MAGIC_IDS.includes(magic.id)?rig?.hands?.left:null;magicEffects(elapsed,hand||rig?.grip||rig?.wrist||{x:1190,y:575});}
  }

  function floatingHat(x,y,size,time){
    if(magicProps){
      const cell=magicProps.width/2,w=size*1.45,h=w*magicProps.height/cell;
      ctx.save();ctx.translate(x,y);ctx.rotate(Math.sin(time*.7)*.035);ctx.drawImage(magicProps,0,0,cell,magicProps.height,-w/2,-h*.89,w,h);ctx.restore();return;
    }
    ctx.save();ctx.translate(x,y);ctx.rotate(Math.sin(time*.7)*.04);ctx.shadowColor='rgba(15,0,30,.45)';ctx.shadowBlur=20;ctx.shadowOffsetY=14;
    const grad=ctx.createLinearGradient(-size/2,-size,size/2,0);grad.addColorStop(0,'#602c84');grad.addColorStop(.3,'#32104e');grad.addColorStop(.6,'#702787');grad.addColorStop(1,'#260a42');ctx.fillStyle=grad;
    ctx.beginPath();ctx.moveTo(-size*.34,-size*.83);ctx.bezierCurveTo(-size*.4,-size*.92,size*.4,-size*.92,size*.34,-size*.83);ctx.lineTo(size*.28,-size*.06);ctx.lineTo(-size*.28,-size*.06);ctx.closePath();ctx.fill();ctx.shadowBlur=0;ctx.shadowOffsetY=0;ctx.strokeStyle='#d7a45e';ctx.lineWidth=2.5;ctx.stroke();ctx.fillStyle='#6c2b91';ctx.beginPath();ctx.ellipse(0,-size*.835,size*.34,size*.065,0,0,TAU);ctx.fill();ctx.strokeStyle='#e7bc79';ctx.stroke();
    ctx.fillStyle='#d9a340';ctx.fillRect(-size*.29,-size*.25,size*.58,size*.14);ctx.strokeStyle='#ffeab4';ctx.lineWidth=2;ctx.strokeRect(-size*.29,-size*.25,size*.58,size*.14);
    const rim=ctx.createLinearGradient(0,-size*.13,0,size*.10);rim.addColorStop(0,'#b476c6');rim.addColorStop(.45,'#441162');rim.addColorStop(1,'#b88732');ctx.fillStyle=rim;ctx.beginPath();ctx.ellipse(0,0,size*.62,size*.145,0,0,TAU);ctx.fill();ctx.strokeStyle='#ffe3a2';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle='#170c2d';ctx.beginPath();ctx.ellipse(0,-size*.02,size*.31,size*.075,0,0,TAU);ctx.fill();goldStar(ctx,0,-size*.5,size*.10);ctx.restore();
  }
  function magicEffects(elapsed,wrist){
    const originalElapsed=elapsed,extra=EXTRA_MAGIC_IDS.includes(magic.id),p=clamp(elapsed/magic.duration,0,1),fade=smooth(elapsed/.8)*smooth((magic.duration-elapsed)/1.3);
    // Accessibility keeps a still mid-trick tableau; the director's real cue
    // clock still controls its fade and completion.
    if(reducedMotion())elapsed=extra?magic.duration*.68:magic.id==='star-hat'?7.4:8.6;
    ctx.save();ctx.globalAlpha=fade;
    const baseAngle=extra?Math.atan2(615-wrist.y,1200-wrist.x):-.88,wandAngle=baseAngle+Math.sin(elapsed*1.7)*.11,tip={x:wrist.x+Math.cos(wandAngle)*156,y:wrist.y+Math.sin(wandAngle)*156};
    if(magic.id!=='wand-multiplication'){ctx.save();ctx.translate(wrist.x,wrist.y);ctx.rotate(wandAngle);ctx.shadowColor='#c7f8ed';ctx.shadowBlur=12;ctx.fillStyle='#301b47';roundRect(ctx,0,-5,158,10,5);ctx.fill();ctx.fillStyle='#fff5d3';roundRect(ctx,130,-5,28,10,4);ctx.fill();ctx.restore();glow(ctx,tip.x,tip.y,38,'rgba(255,228,143,.85)');goldStar(ctx,tip.x,tip.y,10,elapsed);}
    if(!reducedMotion())for(let i=1;i<=18;i++){const age=i/18,angle=baseAngle+Math.sin((elapsed-age*.85)*1.7)*.11,x=wrist.x+Math.cos(angle)*156-age*30,y=wrist.y+Math.sin(angle)*156+age*18;ctx.save();ctx.globalAlpha*=Math.pow(1-age,2)*.7;glow(ctx,x,y,4+(1-age)*6,'rgba(182,255,235,.8)');ctx.restore();}
    if(extra){
      // The visible ribbon begins at the actual puppet grip, linking the
      // performer's wand to the scenic prop rather than an arbitrary emitter.
      if(magic.id!=='wand-multiplication'){
        const reach=smooth((p-.08)/.16)*smooth((.80-p)/.18);
        ctx.save();ctx.globalAlpha*=reach*.38;ctx.lineCap='round';ctx.lineWidth=2.5;ctx.shadowColor='#93e8dc';ctx.shadowBlur=12;
        const beam=ctx.createLinearGradient(tip.x,tip.y,1200,615);beam.addColorStop(0,'#c9fff0');beam.addColorStop(1,'#f8d790');ctx.strokeStyle=beam;ctx.beginPath();ctx.moveTo(tip.x,tip.y);
        for(let i=1;i<=38;i++){const q=i/38;ctx.lineTo(mix(tip.x,1200,q),mix(tip.y,615,q)-Math.sin(q*Math.PI)*60+Math.sin(q*TAU*1.2+elapsed*.6)*7*Math.sin(q*Math.PI));}ctx.stroke();ctx.restore();
      }
      ctx.restore();drawExtraMagic(ctx,{id:magic.id,elapsed:originalElapsed,duration:magic.duration,reducedMotion:reducedMotion(),wrist});return;
    }
    if(magic.id==='star-hat'){
      const hx=1240,hy=695-Math.sin(clamp((elapsed-2)/7,0,1)*Math.PI)*145;
      glow(ctx,hx,hy-75,220,'rgba(143,77,240,.33)',.8);floatingHat(hx,hy,182,elapsed);
      for(let i=0;i<34;i++){const life=(elapsed*.34+i*.057)%1,angle=life*TAU*1.8+i*.7,rr=150*(1-life),x=mix(tip.x,hx,life)+Math.cos(angle)*rr*.6,y=mix(tip.y,hy-25,life)+Math.sin(angle)*rr*.35-life*50;ctx.save();ctx.globalAlpha*=Math.sin(life*Math.PI);goldStar(ctx,x,y,3+(i%4)*1.5,angle);ctx.restore();}
      const reveal=smooth((elapsed-5)/1.6)*smooth((12.4-elapsed)/1.7);
      if(reveal>0){const x=hx+Math.sin(elapsed*.65)*12,y=hy-150-reveal*40;glow(ctx,x,y,185,'rgba(255,221,120,.55)',reveal);goldStar(ctx,x,y,85*reveal,Math.sin(elapsed*.5)*.12);for(let i=0;i<9;i++){const a=i*TAU/9+elapsed*.15;goldStar(ctx,x+Math.cos(a)*150,y+Math.sin(a)*105,8*reveal,a);}}
    }else{
      const center={x:1250,y:615};
      const colors=['#eb7bb2','#72e5de','#eac166'];
      for(let k=0;k<3;k++){
        const growth=smooth((elapsed-.7-k*.18)/2);ctx.save();ctx.globalAlpha*=1-smooth((elapsed-5.5)/2.3)*.92;ctx.lineCap='round';ctx.shadowColor=colors[k];ctx.shadowBlur=14;ctx.strokeStyle=colors[k];ctx.lineWidth=10-k*1.4;ctx.beginPath();ctx.moveTo(tip.x,tip.y);
        for(let i=0;i<=70;i++){const q=i/70*growth,a=q*TAU*1.5+elapsed*.5+k*.5,r=40+q*150;const x=mix(tip.x,center.x,q)+Math.cos(a)*r*q,y=mix(tip.y,center.y,q)-Math.sin(Math.PI*q)*220+Math.sin(a)*r*.18*q;ctx.lineTo(x,y);}ctx.stroke();ctx.restore();
      }
      const become=smooth((elapsed-5)/2.5)*smooth((14-elapsed)/1.5);
      if(become>0){const x=center.x+Math.sin(elapsed*.6)*70,y=center.y-(elapsed-5)*18;glow(ctx,x,y,200,'rgba(107,239,226,.32)',become);ctx.save();ctx.translate(x,y);ctx.scale(become,become);const flap=.58+Math.sin(elapsed*5)*.25;
        if(magicProps){const cell=magicProps.width/2,size=302,h=size*magicProps.height/cell;ctx.save();ctx.scale(.76+flap*.27,1);ctx.drawImage(magicProps,cell,0,cell,magicProps.height,-size/2,-h/2,size,h);ctx.restore();ctx.save();ctx.beginPath();ctx.rect(-9,-h/2,18,h);ctx.clip();ctx.drawImage(magicProps,cell,0,cell,magicProps.height,-size/2,-h/2,size,h);ctx.restore();}
        else{for(const side of [-1,1]){ctx.save();ctx.scale(side*flap,1);const g=ctx.createLinearGradient(0,-80,100,70);g.addColorStop(0,'#fff0ba');g.addColorStop(.4,side<0?'#f3a3d4':'#78e9e0');g.addColorStop(1,'#9b64d2');ctx.fillStyle=g;ctx.shadowColor='rgba(255,225,150,.75)';ctx.shadowBlur=15;ctx.beginPath();ctx.moveTo(0,5);ctx.bezierCurveTo(20,-118,144,-100,105,-9);ctx.bezierCurveTo(153,78,52,95,0,5);ctx.fill();ctx.strokeStyle='#ffe8b4';ctx.lineWidth=3;ctx.stroke();ctx.restore();}goldStar(ctx,0,0,24,elapsed*.1);}
        ctx.restore();
        for(let i=0;i<18;i++){const a=i*2.4+elapsed*.5,r=100+(i%4)*29;goldStar(ctx,x+Math.cos(a)*r,y+Math.sin(a)*r*.6,3+(i%3)*2,a);}
      }
    }
    ctx.restore();
  }

  function hud(){
    captionScreen=null;
    if(state.roundTitle&&state.showRoundTitle!==false&&!['minigame','still','lobby','rules','patterns','question','prize','pause','finale'].includes(state.show?.scene)){
      ctx.save();ctx.font='600 21px "Trebuchet MS",system-ui';let label=String(state.roundTitle)+(state.pattern?.title?' · '+state.pattern.title:'');while(label.length>1&&ctx.measureText(label).width>500)label=label.slice(0,-2)+'…';const tw=Math.min(570,ctx.measureText(label).width+66);roundRect(ctx,40,37,tw,48,24);ctx.fillStyle='rgba(25,12,45,.78)';ctx.fill();ctx.lineWidth=1;ctx.strokeStyle='rgba(255,224,166,.5)';ctx.stroke();ctx.fillStyle='#eac781';star(ctx,65,61,7);ctx.fill();fillText(ctx,label,85,62,21,'#fff0cc',600,'left');ctx.restore();
    }
    if(state.speaking&&state.showCaptions!==false&&state.caption&&!['winner','checking','round','card','minigame','greeting','question','rules','patterns','pause','finale','prize'].includes(state.show?.scene)){
      ctx.save();const words=String(state.caption).slice(0,500).split(/\s+/),lines=[];let line='';
      // Captions use only the free space beneath the physical number panel.
      // Tight host shots use a single paged line, keeping all five rows clear.
      const boardVisible=boardScreen.top>=0&&boardScreen.top<H;
      const free=boardVisible?H-boardScreen.bottom-28:200;
      const maxLines=boardVisible?Math.max(1,Math.min(3,Math.floor((free-24)/36))):3;
      const fontSize=maxLines===1?23:28,lineHeight=maxLines===1?26:38,padding=maxLines===1?18:24;
      ctx.font=`500 ${fontSize}px "Trebuchet MS",system-ui`;
      for(const word of words){const next=line?line+' '+word:word;if(ctx.measureText(next).width>1510&&line){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);
      const elapsed=Number(state.speechElapsed)||sceneTime-speechStartedAt,estimatedDuration=Math.max(4,words.length/2.7),pages=Math.max(1,Math.ceil(lines.length/maxLines)),page=Math.min(pages-1,Math.floor(Math.max(0,elapsed)/estimatedDuration*pages)),shown=lines.slice(page*maxLines,page*maxLines+maxLines),height=shown.length*lineHeight+padding;
      let y=H-height-14;if(boardVisible&&y<boardScreen.bottom+8)y=Math.max(96,boardScreen.top-height-12);captionScreen={top:y,bottom:y+height,lines:shown.length};
      roundRect(ctx,175,y,1570,height,15);ctx.fillStyle='rgba(15,8,29,.88)';ctx.fill();ctx.strokeStyle='rgba(255,228,173,.3)';ctx.lineWidth=1;ctx.stroke();shown.forEach((s,i)=>fillText(ctx,s,960,y+padding/2+lineHeight/2+i*lineHeight,fontSize,'#fff9e9',500));ctx.restore();
    }
    if(state.showBrandBug){ctx.save();ctx.globalAlpha=.7;fillText(ctx,'Milo & Friends',W-45,56,23,'#fff1cb',700,'right');fillText(ctx,'BingoShow',W-45,80,16,'#9ce3e1',700,'right');ctx.restore();}
  }

  function frame(now){
    if(disposed)return;raf=requestAnimationFrame(frame);if(lastFrame&&now-lastFrame<(reducedMotion()?31:15))return;
    const dt=lastFrame?Math.min(.08,(now-lastFrame)/1000):1/30;lastFrame=now;
    renderDelta=dt;
    if(!state.paused)sceneTime+=dt;
    if(!state.paused||state.speaking&&state.speechActive===true)performerTime+=dt;
    if(magic&&sceneTime-magic.start>=magic.duration){const done=magic;magic=null;setCamera(done.oldCamera||'host',{moving:done.oldMoving});options.onEvent?.({type:'magic-end',id:done.id});root.dispatchEvent(new CustomEvent('mf:magic-end',{bubbles:true,detail:{id:done.id}}));}
    if(now-lastTick>1000){lastTick=now;ensureActors();}
    cam=cameraRig.update(dt,{paused:!!state.paused,reducedMotion:prefersReduced||!!state.show?.reducedMotion,moving:!!state.movingCamera});
    const touring=state.hostId==='milo'&&!magic?studioTourAt(activeShowCue(),{homeX:state.cohostId?805:ARENA_LAYOUT.host.x,reducedMotion:reducedMotion()}):null;
    if(touring){const w=state.movingCamera?touring.cameraWeight:0,target=boundCamera({scale:1+.035*w,x:960+(touring.cameraX-960)*.025*w,y:540+12*w}),pose=boundCamera({scale:mix(cam.scale,target.scale,w),x:mix(cam.x,target.x,w),y:mix(cam.y,target.y,w)});cam={...cam,...pose,parallaxX:(pose.x-960)/960,parallaxY:(pose.y-540)/540};}
    const {scale,x:cx,y:cy}=cam;
    boardScreen={top:H/2+(ARENA_LAYOUT.board.y-cy)*scale,bottom:H/2+(ARENA_LAYOUT.board.y+ARENA_LAYOUT.board.height-cy)*scale};
    ctx.setTransform(cv.width/W,0,0,cv.height/H,0,0);ctx.fillStyle='#160c28';ctx.fillRect(0,0,W,H);ctx.save();ctx.translate(W/2,H/2);ctx.scale(scale,scale);ctx.translate(-cx,-cy);backdrop();drawShowEffects(ctx,{cue:activeShowCue(),reducedMotion:reducedMotion(),layer:'back'});cast();drawShowEffects(ctx,{cue:activeShowCue(),reducedMotion:reducedMotion(),layer:'front'});ctx.restore();
    // A very restrained lens vignette keeps attention on the stage without
    // dimming the children's characters or changing the art's colour grade.
    const vignette=ctx.createRadialGradient(W/2,H*.48,H*.32,W/2,H*.48,W*.65);vignette.addColorStop(0,'rgba(14,4,28,0)');vignette.addColorStop(1,'rgba(14,4,28,.23)');ctx.fillStyle=vignette;ctx.fillRect(0,0,W,H);
    if(state.show){const source={...state.show,brandId:'milo',paused:!!state.paused||!!state.show.paused};const show=source.scene==='minigame'?gameMotionClock.read(source,now):gameMotionClock.read({...source,age:Math.max(0,Number(source.age)||0)+(state.paused?0:Math.max(0,sceneTime-showAgeAt))},now);gameAge=show.scene==='minigame'?show.age:null;drawShowGraphics(brandedContext(ctx,'milo'),{show},{logo:overlayLogo,prize:prizeImage,gameAssets:overlayAssets});}
    hud();
    if(transition){const t=Math.min(1,(now-transition.start)/transition.duration);if(t>=1)transition=null;else{ctx.save();ctx.globalAlpha=transition.kind==='slide'?1:1-t;ctx.drawImage(transition.image,transition.kind==='slide'?-W*smooth(t):0,0,W,H);ctx.restore();if(transition.kind==='logo'&&overlayLogo){ctx.save();ctx.globalAlpha=Math.sin(t*Math.PI)*.9;const width=620,height=width*overlayLogo.height/overlayLogo.width;ctx.drawImage(overlayLogo,(W-width)/2,(H-height)/2,width,height);ctx.restore();}}}
    if(scenicReady&&!scenicError&&needed().every(id=>actors.has(id)&&!actorErrors.has(id)))options.onFrameRendered?.(state);
  }
  function snapshot(){return {state:{...state},time:sceneTime,showCue:activeShowCue(),movement:activeMovement(),tour:state.hostId==='milo'?studioTourAt(activeShowCue(),{homeX:state.cohostId?805:ARENA_LAYOUT.host.x,reducedMotion:reducedMotion()}):null,magic:magic?{id:magic.id,elapsed:sceneTime-magic.start,duration:magic.duration}:null,ready:scenicReady,assetError:scenicError,studio:'sterrenplein-grand',presenterLayout:{...ARENA_LAYOUT.host},characters:[...actors.keys()],characterRigs:Object.fromEntries([...actors].map(([id,a])=>[id,a.rig.stats])),performerTime,gameAge,camera:{...cam},deskBoard:{...boardScreen},caption:captionScreen,width:cv.width,height:cv.height};}
  function destroy(){if(disposed)return;disposed=true;cancelAnimationFrame(raf);observer?.disconnect();motionPreference?.removeEventListener?.('change',motionPreferenceChanged);window.removeEventListener('resize',resize);for(const a of actors.values())a.rig.dispose();actors.clear();root.remove();}
  const api={update,setCamera,playMagic,setSpeaking,snapshot,destroy,canvas:cv,element:root,preload:(ids=Object.keys(LABELS))=>Promise.all([sceneryLoaded,magicPropsLoaded,...ids.map(loadActor)])};
  update(options.state||{});raf=requestAnimationFrame(frame);return api;
}
