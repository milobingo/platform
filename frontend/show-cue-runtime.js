import {getShowCue,MOTION_CUES} from '../server/show-cues.js';
import {getMagicCue} from '../server/magic-cues.js';

/** A presentation clock only. It never reserves, commits or acknowledges game state. */
export class ShowCueRuntime {
 constructor(engine){this.engine=engine;this.active=null;this.generation=0;}
 get holding(){return !!this.active&&this.active.source==='manual';}
 get paused(){const e=this.engine,a=this.active;return !!a&&(!!a.paused||!!e.director.externalHold||!!e.calls?.held||!!e.liveCalls?.onAir||!!e.liveCalls?.switchingLive||!!e.director.callHold||(a.source==='rundown'&&!!e.director.paused));}
 assertManual({miloOnly=false}={}){
  const e=this.engine,d=e.director,s=e.game.state;
  if(miloOnly&&e.production!=='milo')throw Error('Deze showelementen horen bij Milo & Friends. Vlampie behoudt zijn eigen studio.');
  if(this.active||e.magic)throw Error('Rond eerst het actieve bewegings- of magiemoment af.');
  if(e.calls?.held||e.liveCalls?.onAir||e.liveCalls?.switchingLive||d.callHold||s.callId)throw Error('Rond eerst het belmoment af.');
  if(s.window?.status==='open')throw Error('Wacht tot het meldvenster is afgehandeld.');
  if(s.resultId||d.scene==='checking')throw Error('Rond eerst de bingocontrole of uitslag af.');
  if(s.pending||d.pending!==null&&d.pending!==undefined||d.flow?.kind==='draw')throw Error('Laat eerst de lopende trekking afronden.');
  if(e.voicePhase!=='idle'||d.narrationHold)throw Error('Laat eerst de presentator uitspreken.');
  if(e.showRuntime?.holding)throw Error('Zet eerst de presentator terug live.');
  if(d.flow&&!d.paused||['sync','sync-error','round-intro','round-prize'].includes(e.runner.phase))throw Error('Pauzeer eerst het lopende draaiboekmoment.');
 }
 begin(kind,id,{source='manual',duration,hostId,instanceId}={}){
  const e=this.engine,cue=kind==='show'?getShowCue(id):kind==='motion'?MOTION_CUES.find(c=>c.id===id):kind==='magic'?getMagicCue(id):null;
  if(!cue)throw Error('Kies een beschikbaar showelement, gebaar of magiemoment.');
  this.reset();
  this.active={kind,id,instanceId:instanceId||`show-${++this.generation}-${crypto.randomUUID()}`,duration:duration??cue.duration,elapsed:0,source,hostId:cue?.hostId||hostId||e.hostId,paused:false,restore:{camera:e.camera,motion:e.motion},cameraIndex:-1};
  if(kind==='magic'){e.magic={id,startedAt:Date.now(),playing:true,elapsed:0,manual:true,duration:this.active.duration};e.motion='magic';e.camera='magic';}
  else {e.motion=cue.motion||id;this.camera();}
  e.emit();e.bridge?.sendLocal();return this.active;
 }
 async play(id){
  const cue=getShowCue(id);if(!cue)throw Error('Kies een beschikbaar showelement.');this.assertManual({miloOnly:true});
  if(cue.hostId&&this.engine.hostId!==cue.hostId)throw Error('Kies Milo als presentator voor zijn studiorondje.');
  const revision=this.generation;await this.engine.audio.unlock();if(revision!==this.generation)return false;this.assertManual({miloOnly:true});
  this.begin('show',id);this.sound(cue.sound);return true;
 }
 motion(id){
  if(id==='idle'){this.stop();this.engine.motion='idle';this.engine.emit();this.engine.bridge?.sendLocal();return;}
  if(!MOTION_CUES.some(c=>c.id===id))throw Error('Kies een beschikbaar gebaar.');
  this.assertManual();this.begin('motion',id);
 }
 async magic(id){
  const cue=getMagicCue(id);if(!cue)throw Error('Kies een bestaand magiemoment.');
  this.assertManual({miloOnly:true});if(this.engine.hostId!=='milo')throw Error('Kies Milo als presentator voor zijn goochelmomenten.');
  const revision=this.generation;await this.engine.audio.unlock();if(revision!==this.generation)return false;this.assertManual({miloOnly:true});if(this.engine.hostId!=='milo')throw Error('Kies Milo als presentator voor zijn goochelmomenten.');
  this.begin('magic',id,{duration:cue.duration,hostId:'milo'});this.sound(cue.sound);return true;
 }
 startRundown({id,instanceId,hostId}){
  if(this.engine.production!=='milo')throw Error('Dit showelement hoort bij Milo & Friends.');
  this.begin('show',id,{source:'rundown',instanceId,hostId});
 }
 sound(id){if(!id)return;this.engine.audio.cue(id);this.engine.bridge?.cue(id);}
 camera(){const a=this.active;if(a?.kind!=='show')return;const cue=getShowCue(a.id),shots=cue.shots||[{at:0,camera:cue.camera}];let index=0;for(let i=0;i<shots.length;i++)if(a.elapsed>=shots[i].at)index=i;if(index!==a.cameraIndex){a.cameraIndex=index;this.engine.camera=shots[index].camera;}}
 pause(value){if(!this.active)return false;this.active.paused=!!value;this.engine.emit();this.engine.bridge?.sendLocal();return true;}
 tick(dt){const a=this.active;if(!a||this.paused||!Number.isFinite(dt)||dt<=0)return;a.elapsed=Math.min(a.duration,a.elapsed+dt);if(a.kind==='magic'&&this.engine.magic)this.engine.magic.elapsed=a.elapsed;this.camera();if(a.elapsed>=a.duration&&a.source==='manual')this.reset();}
 visual(){const a=this.active;if(!a)return {showCue:null,movement:null};const timing={id:a.id,instanceId:a.instanceId,elapsed:a.elapsed,duration:a.duration,paused:this.paused,source:a.source,hostId:a.hostId,...(a.returnAt!==undefined?{returnAt:a.returnAt}:{})};return {showCue:a.kind==='show'?timing:null,movement:a.kind==='motion'?timing:null};}
 stop(){
  const a=this.active;this.generation++;
  if(a?.source==='rundown'){this.engine.director.pause();this.engine.director.flow=null;}
  if(a?.kind==='show'&&a.id==='studio-tour'){
   if(a.returnAt===undefined){a.source='manual';a.returnAt=a.elapsed;a.duration=a.elapsed+2.4;a.paused=false;this.engine.audio.stop();this.engine.emit();this.engine.bridge?.sendLocal();}
   return;
  }
  this.reset();this.engine.audio.stop();this.engine.bridge?.controls('stop');this.engine.emit();this.engine.bridge?.sendLocal();
 }
 reset(){
  this.generation++;const a=this.active;this.active=null;
  if(a){this.engine.camera=a.restore.camera;this.engine.motion=a.kind==='motion'?'idle':a.restore.motion;if(a.kind==='magic')this.engine.magic=null;}
 }
}
