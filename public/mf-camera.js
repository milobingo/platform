/**
 * Camera blocking for the 1920 × 1080 Sterrenplein broadcast set.
 * A shot is a composed frame; the moving shots follow one slow, repeatable
 * studio move. This module owns no clock, DOM, sound or official game state.
 */
const WIDTH=1920,HEIGHT=1080,TAU=Math.PI*2;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
const lerp=(from,to,t)=>from+(to-from)*t;
const shotSeconds=(value,fallback=1.4)=>clamp(finite(value,fallback)>10?value/1000:finite(value,fallback),.15,4);
export const cameraEase=t=>{t=clamp(finite(t,0),0,1);return t*t*t*(t*(t*6-15)+10);};
const preset=(id,label,detail,scale,x,y,movement='hold')=>Object.freeze({id,label,detail,scale,x,y,movement});
export const CAMERA_PRESETS=Object.freeze({
 establish:preset('establish','Sterrenplein panorama','De sterrenkoepel, gouden boog en het hele showpodium.',1,960,540),
 wide:preset('wide','Showdesk totaal','Milo, de gouden sterrenboog en de volledige showdesk.',1.08,960,580,'breathing'),
 host:preset('host','Presentator & desk','Een rustig middenshot met ruimte boven de hoed.',1.46,960,620,'push'),
 portrait:preset('portrait','Presentator close-up','Gezicht, gebaren en bovenlichaam met de desk op de voorgrond.',1.85,960,615,'push'),
 duo:preset('duo','Twee presentatoren','Een evenwichtig tweeshot achter de brede desk.',1.36,960,620,'lateral'),
 board:preset('board','Nummerbord op de desk','Alle vijf rijen blijven rustig en leesbaar in beeld.',2.3,960,810),
 guest:preset('guest','Gastenpoort','De verlichte gouden entree en de opkomst van een vriend.',1.55,1300,625,'guest'),
 magic:preset('magic','Magie op de speelvloer','Milo naast de desk, met ruimte voor zijn volledige act.',1.12,1050,592,'breathing'),
 dolly:preset('dolly','Dolly langs de desk','Een langzame zijwaartse camerarit met subtiele diepte.',1.17,960,605,'dolly'),
 crane:preset('crane','Crane over het podium','Een brede beweging van sterrenkoepel naar showdesk.',1.12,960,590,'crane'),
 orbit:preset('orbit','Boog langs het podium','Een rustige gebogen beweging met diepte tussen decor en desk.',1.2,960,605,'orbit'),
});
const ALIASES=Object.freeze({master:'wide',presenter:'host',front:'host',desk:'host',close:'portrait',entrance:'guest',bingo:'board',machine:'board',led:'board',opening:'crane',prize:'duo',tour:'dolly',audience:'establish'});
export const resolveCameraShot=id=>CAMERA_PRESETS[ALIASES[id]||id]?ALIASES[id]||id:'wide';
/** Restrict the visible camera rectangle to the painted set, even at 1×. */
export function boundCamera(pose){
 const scale=clamp(finite(pose?.scale,1),1,3),halfWidth=WIDTH/(2*scale),halfHeight=HEIGHT/(2*scale);
 return {scale,x:clamp(finite(pose?.x,WIDTH/2),halfWidth,WIDTH-halfWidth),y:clamp(finite(pose?.y,HEIGHT/2),halfHeight,HEIGHT-halfHeight)};
}
function motionOffset(shot,time,intensity){
 const phase=TAU*time/(shot.movement==='orbit'?48:shot.movement==='crane'?40:44),rise=(1-Math.cos(phase))/2;
 let x=0,y=0,scale=0;
 switch(shot.movement){
  case 'dolly':x=-104*Math.sin(phase);y=8*rise;scale=.075*rise;break;
  case 'crane':x=25*Math.sin(phase);y=-55*rise;scale=.075*rise;break;
  case 'orbit':x=92*Math.sin(phase);y=14*Math.sin(phase*2);scale=.045*rise;break;
  case 'lateral':x=22*Math.sin(phase);y=2*rise;scale=.012*rise;break;
  case 'guest':x=14*Math.sin(phase);y=3*rise;scale=.018*rise;break;
  case 'push':x=(shot.id==='portrait'?6:10)*Math.sin(phase);y=3*rise;scale=(shot.id==='portrait'?.014:.024)*rise;break;
  case 'breathing':x=18*Math.sin(phase);y=2*rise;scale=.016*rise;break;
 }
 return {x:x*intensity,y:y*intensity,scale:scale*intensity};
}

export class CameraRig{
 constructor(options={}){
  if(typeof options==='string')options={shot:options};
  this.shot=resolveCameraShot(options.shot||options.id||'wide');
  this.moving=options.moving!==false;this.reducedMotion=options.reducedMotion===true;
  this.duration=shotSeconds(options.duration); // accepts seconds or UI milliseconds
  this.motionIntensity=clamp(finite(options.motionIntensity,1),0,1);
  this.pathTime=0;this.motionWeight=0;this.transition=null;this.pose=boundCamera(CAMERA_PRESETS[this.shot]);
 }
 setShot(id,options={}){
  const shot=resolveCameraShot(id),changed=shot!==this.shot;
  if(options.moving!==undefined)this.moving=!!options.moving;
  if(options.reducedMotion!==undefined)this.reducedMotion=!!options.reducedMotion;
  if(options.motionIntensity!==undefined)this.motionIntensity=clamp(finite(options.motionIntensity,1),0,1);
  // Studio snapshots arrive continuously. An unchanged shot must never restart
  // its transition or dolly path merely because a fresh snapshot arrived.
  if(!changed&&!options.reframe){
   if(this.reducedMotion)this.cutToBase();
   return this.snapshot();
  }
  const from={...this.pose};this.shot=shot;this.pathTime=0;this.motionWeight=0;
  const duration=shotSeconds(options.duration,this.duration);
  if(this.reducedMotion||options.transition==='cut'||options.animate===false)this.cutToBase();
  else this.transition={from,age:0,duration};
  return this.snapshot();
 }
 cutToBase(){this.pose=boundCamera(CAMERA_PRESETS[this.shot]);this.pathTime=0;this.motionWeight=0;this.transition=null;}
 update(delta,options={}){
  if(options.moving!==undefined)this.moving=!!options.moving;
  if(options.reducedMotion!==undefined)this.reducedMotion=!!options.reducedMotion;
  if(options.motionIntensity!==undefined)this.motionIntensity=clamp(finite(options.motionIntensity,this.motionIntensity),0,1);
  // Reduced motion removes both travel and decorative motion immediately.
  if(this.reducedMotion){this.cutToBase();return this.snapshot();}
  if(options.paused)return this.snapshot();
  const dt=clamp(finite(delta,0),0,.25);if(dt===0)return this.snapshot();
  const shot=CAMERA_PRESETS[this.shot];
  if(this.moving)this.pathTime+=dt;
  this.motionWeight=clamp(this.motionWeight+(this.moving?dt/.9:-dt/.65),0,1);
  const offset=motionOffset(shot,this.pathTime,this.motionIntensity*cameraEase(this.motionWeight));
  const target=boundCamera({scale:shot.scale+offset.scale,x:shot.x+offset.x,y:shot.y+offset.y});
  if(this.transition){
   this.transition.age=Math.min(this.transition.duration,this.transition.age+dt);
   const t=cameraEase(this.transition.age/this.transition.duration),from=this.transition.from;
   this.pose=boundCamera({scale:lerp(from.scale,target.scale,t),x:lerp(from.x,target.x,t),y:lerp(from.y,target.y,t)});
   if(this.transition.age>=this.transition.duration)this.transition=null;
  }else this.pose=target;
  return this.snapshot();
 }
 snapshot(){
  const shot=CAMERA_PRESETS[this.shot],pose={...this.pose};
  return {id:this.shot,label:shot.label,...pose,movement:shot.movement,moving:this.moving&&!this.reducedMotion&&shot.movement!=='hold'&&this.motionIntensity>0,reducedMotion:this.reducedMotion,transitioning:!!this.transition,transitionProgress:this.transition?this.transition.age/this.transition.duration:1,pathTime:this.pathTime,motionIntensity:this.motionIntensity,
   // Normalized camera travel lets scenic layers use restrained parallax while
   // the desk, rig and number board remain in the same world-space transform.
   parallaxX:(pose.x-WIDTH/2)/(WIDTH/2),parallaxY:(pose.y-HEIGHT/2)/(HEIGHT/2)};
 }
}
