import {LiveCallConnection,requestLiveCall,liveCallActive} from './live-call-api.js';
import {LiveKitMedia} from './livekit-media.js';
import {LiveCallOutput} from './live-call-output.js';
import {makeLiveCall,transitionLiveCall,returnLiveCall,callContext} from '../server/live-call-model.js';
import {CHARACTERS} from '../server/characters.js';

const noop=()=>{};
const currentEntries=game=>(game?.participation||[]).filter(e=>e.callConsentAt&&!['none','withdrawn','declined','done'].includes(e.callStatus));
/** Persistent operator/output controller. Media exists only for selected calls. */
export class LiveCallRuntime{
 constructor(engine,{Connection=LiveCallConnection,Media=LiveKitMedia,Output=LiveCallOutput,request=requestLiveCall,timers=true}={}){
  Object.assign(this,{engine,Media,Output,request});this.listeners=new Set();this.busy=false;this.error='';this.settings=null;this.disposed=false;this.generation=0;this.lastGame=this.demo?'demo:'+engine.game.id:this.gameId;this.mediaState={phase:'disconnected',connected:false,micReady:false};
  this.connection=new Connection({role:engine.isOutput?'output':'host',getGameId:()=>this.gameId,getClientId:()=>engine.isOutput?engine.bridge.id:engine.clientId,onChange:c=>this.onCall(c)});
  this._snapshot=this.state();this.pagehide=()=>{if(!this.demo)this.connection.leave();void this.media?.disconnect();this.output?.stop();};globalThis.window?.addEventListener?.('pagehide',this.pagehide);
  if(timers){this.timer=setInterval(()=>void this.tick(),1200);this.timer?.unref?.();}
 }
 get demo(){return !this.engine.isOutput&&this.engine.demo;}
 get gameId(){return this.engine.isOutput?this.engine.remoteStage?.gameId||'':this.engine.demo?'':this.engine.game.id;}
 get call(){return this.demo?this.demoCall||null:this.connection.call;}
 get active(){return liveCallActive(this.call);}
 get matchesGame(){return !this.call||this.call.gameId===this.gameId||this.demo;}
 get onAir(){return this.matchesGame&&this.call?.phase==='live';}
 get held(){return this.onAir;}
 get drawHeld(){return !!this.engine.game?.state.drawHold||!!this.call?.drawHeld;}
 subscribe=fn=>{this.listeners.add(fn);return()=>this.listeners.delete(fn);};
 getSnapshot=()=>this._snapshot;
 state(){return {call:this.call,queue:this.queue(),busy:this.busy,error:this.error,settings:this.settings,media:this.mediaState,output:this.output?.state?.()||null,mode:this.demo?'demo':'real',mismatchedGame:!this.matchesGame,drawHeld:this.drawHeld,held:this.onAir,now:Date.now()};}
 queue(){if(!this.demo)return currentEntries(this.engine.game);return (this.engine.game.books||[]).filter(b=>b.profileId).filter((b,i,a)=>a.findIndex(x=>x.profileId===b.profileId)===i).map(b=>({id:'demo-entry-'+b.profileId,profileId:b.profileId,accountId:b.accountId,name:b.name,familyName:b.accountId==='demo-0'?'Oefengezin 1':'Oefengezin 2',child:true,parentConsent:true,callConsentAt:1,micChecked:true,connectionChecked:true,headphones:true,callStatus:'accepted'}));}
 emit(){if(this.disposed)return;this._snapshot=this.state();for(const fn of this.listeners)fn();this.engine.emit();if(!this.engine.isOutput)this.engine.bridge?.sendLocal();}
 acceptResponse(data){if(data?.game&&!this.engine.isOutput){const g=data.game;if(this.engine.dirty){this.engine.game={...this.engine.game,state:g.state,participation:g.participation,production:g.production,revision:g.revision};}else this.engine.acceptGame(g);this.engine.syncGame();}this.emit();return data;}
 async perform(fn){if(this.busy)throw Error('Wacht tot de huidige belstap is bevestigd.');this.busy=true;this.error='';this.emit();try{return await fn();}catch(e){this.error=e.message;this.engine.fail(e.message);throw e;}finally{this.busy=false;this.emit();}}
 ensureMedia(){if(this.media)return this.media;this.media=new this.Media({role:this.engine.isOutput?'output':'host',api:this.connection,getCall:()=>this.call,getGameId:()=>this.gameId,onState:s=>{this.mediaState=s;this.emit();},onFailure:e=>this.mediaFailed(e)});return this.media;}
 async mediaFailed(error){if(this.disposed||!this.active||['returning','returned'].includes(this.call.phase))return;
  // Backend room revocation can arrive just before the staged -> live poll.
  if(this.call.phase==='staged'&&error.target==='backstage'){try{await this.connection.poll();if(this.call?.phase==='live'||this.call?.switchingLive)return;}catch{}}
  this.error=error.message;this.emit();if(!this.demo)try{this.acceptResponse(await this.connection.action('fail',{reason:error.message}));}catch{this.engine.fail('De belverbinding is weggevallen. De trekking blijft geblokkeerd.');}
 }
 async tick(){if(this.disposed||this.ticking)return;this.ticking=true;try{
  const gameKey=this.demo?'demo:'+this.engine.game.id:this.gameId;
  if(gameKey!==this.lastGame){this.lastGame=gameKey;this.generation++;await this.media?.disconnect();if(!this.demo&&this.connection.call?.gameId!==this.gameId){this.connection.epoch++;this.connection.call=null;}this.restore=null;}
  if(!this.demo&&this.gameId){await this.connection.poll();if(this.active&&this.matchesGame&&Date.now()-(this.lastHeartbeat||0)>4500){this.lastHeartbeat=Date.now();const s=this.media?.getState?.()||{};this.acceptResponse(await this.connection.heartbeat({connected:!!s.connected,micReady:!!s.micReady,audioReady:this.engine.isOutput?!!this.engine.bridge.audioReady&&!!s.audioReady:!!s.audioReady,target:s.target||null,voiceLevel:this.output?.meter?.()||0}));}}
  if(this.engine.isOutput&&this.output){void this.output.sync(this.matchesGame?this.call:null).catch(e=>this.mediaFailed(e));this.output.tick();}
  if(this.matchesGame&&!this.engine.isOutput&&this.media?.state?.target==='backstage'&&this.call?.phase==='live'&&!this.connectingLive)await this.connectLiveMonitor();
  this.emit();
 }catch(e){this.error=e.message;if(this.onAir&&Date.now()-this.connection.lastOK>6500){void this.output?.stop();await this.media?.disconnect();this.engine.director.drawBlocked=true;}this.emit();}finally{this.ticking=false;}}
 capture(){const e=this.engine;if(this.restore||e.showCues?.active||e.showCues?.holding)return;const d=e.director;this.restore={gameId:e.game.id,epoch:e.game.state.epoch,scene:d.scene,sceneAge:d.sceneAge,camera:e.camera,speakerId:e.speakerId,paused:d.paused};}
 onCall(c){if(this.disposed)return;const e=this.engine,previous=this.previousPhase,id=c?.id;
  if(!e.isOutput&&!this.matchesGame){e.director.drawBlocked=true;this.error='Er staat nog een belmoment open in een andere show. Open die show om de terugkeer af te ronden.';this.emit();return;}
  if(!e.isOutput){e.director.drawBlocked=this.drawHeld;if(c?.phase==='live'&&(previous!=='live'||this.previousCall!==id)){if(e.showCues?.active||e.showCues?.holding){e.showCues.reset?.();e.audio.stop?.();}this.capture();e.stopSpeech();e.magic=null;e.director.callHold=true;e.director.configure({liveCall:true});e.director.setScene('call',undefined,true);e.camera='host';e.speakerId=c.characterId||e.hostId;}
   else if(previous==='live'&&c?.phase!=='live'){e.director.callHold=false;e.director.configure({liveCall:false});const old=this.restore;if(old?.gameId===e.game.id&&old.epoch===e.game.state.epoch){e.director.setScene(old.scene,undefined,true);e.director.sceneAge=old.sceneAge;e.camera=old.camera;e.speakerId=old.speakerId;e.director.paused=old.paused;}else e.director.pause();this.restore=null;}
  }
  this.previousPhase=c?.phase;this.previousCall=id;
  if(!c||['returning','returned','completed'].includes(c.phase)){void this.media?.disconnect();void this.output?.sync(c);}
  else if(e.isOutput&&this.output)void this.output.sync(this.matchesGame?c:null);
  this.emit();
 }
 async invite(entryId){if(this.demo)return;return this.perform(async()=>{await this.engine.post('call-status',{entryId,status:'invited'});this.emit();});}
 async prepare(entryId,context={},maxSeconds=90,characterId=this.engine.hostId){const generation=this.generation;return this.perform(async()=>{
  const e=this.engine;if(this.drawHeld||this.active)throw Error('Rond eerst het bestaande belmoment en de terugkeer af.');if(e.game.state.pending||e.director.pending||e.director.flow?.kind==='draw'||e.game.state.window?.status==='open'||e.game.state.resultId)throw Error('Rond eerst de lopende trekking, het meldvenster en de uitslag af.');
  this.capture();e.runner.autoDraw=false;e.runner.age=0;
  if(this.demo){const entry=this.queue().find(q=>q.id===entryId);if(!entry)throw Error('Kies eerst een oefenkind.');const character=CHARACTERS[characterId]||CHARACTERS.milo;this.demoCall={...makeLiveCall(e.game,entry,{clientId:e.clientId,outputId:'demo-output',character:{...character,realtimeVoice:character.voice},presenter:character,context,maxSeconds:Number(maxSeconds)}),simulated:true};e.game.state.drawHold={id:this.demoCall.id,callId:this.demoCall.id,checkpoint:this.demoCall.checkpoint,reason:'Simulatie belmoment'};this.onCall(this.demoCall);return;}
  await e.bridge.connect();if(generation!==this.generation)throw Error('De belvoorbereiding is geannuleerd.');if(!e.bridge.connected||!e.bridge.routing)throw Error('Open het uitzendvenster, activeer beeld en geluid en kies geluid via uitzendvenster.');
  this.acceptResponse(await this.connection.action('prepare',{entryId,context,maxSeconds:Number(maxSeconds),characterId}));if(generation!==this.generation){if(this.active)this.acceptResponse(await this.connection.action('cancel'));throw Error('De belvoorbereiding is geannuleerd. De trekking blijft geblokkeerd tot de terugkeer is gecontroleerd.');}await this.refreshGame();
 });}
 async action(action,extra={}){return this.perform(async()=>{
  if(!this.matchesGame)throw Error('Open eerst de show die bij dit belmoment hoort.');if(!this.active)throw Error('Bereid eerst een belmoment voor.');
  if(action==='go-live'){
   if(this.engine.voicePhase!=='idle'||this.engine.magic||this.engine.showCues?.active||this.engine.showCues?.holding)throw Error('Laat het entertainmentmoment eerst afronden, of stop de huidige uitspraak of cue voordat je live gaat.');
   if(this.engine.showRuntime?.manual)this.engine.showRuntime.returnToShow();
  }
  if(this.demo){this.demoAction(action,extra);return;}
  this.acceptResponse(await this.connection.action(action,extra));
  if(action==='go-live')await this.connectLiveMonitor();
  if(action==='resume-draw'){await this.refreshGame();this.engine.runner.autoDraw=false;this.engine.runner.age=0;if(this.engine.game.state.paused)await this.engine.pause(false);this.engine.notify('Terugkeer bevestigd. De trekking is vrijgegeven; kies de volgende bal of zet automatisch trekken bewust aan.');}
 });}
 demoAction(action,extra){const c=this.demoCall;if(!c)throw Error('Bereid eerst een oefenbelmoment voor.');const now=Date.now();
  if(action==='simulate'){
   const outcome=extra.outcome;
   if(outcome==='answer'){transitionLiveCall(c,'answer','player',{clientId:'demo-player',checkpointId:c.checkpoint.id,heardLastNumber:c.checkpoint.lastNumber,cardsUpdated:true,youtubeMuted:true},now);c.media.host={connected:true,micReady:true};c.media.player={connected:true,micReady:true};this.mediaState={phase:'simulated',target:'backstage',connected:true,micReady:true,simulated:true};}
   else if(outcome==='returned'){c.returnState.cue.publishedAt=now;transitionLiveCall(c,'player-returned','player',{checkpointId:c.checkpoint.id,confirmed:true,playbackInfo:{ready:true,audible:true,source:'current-cue-and-parent-confirmation',normalShowConfirmed:true,heardCurrentCue:true,cueId:c.returnState.cue.id,cueLastNumber:c.returnState.cue.lastNumber}},now);}
   else returnLiveCall(c,['declined','missed'].includes(outcome)?outcome:'failed',outcome==='mic-denied'?'Simulatie: microfoontoestemming ontbreekt.':'Simulatie: '+outcome,now);
  }else if(action==='context'){if(!['preparing','ringing','backstage','staged'].includes(c.phase))throw Error('De gastkaart staat vast zodra het live gesprek begint.');const entry=this.queue().find(e=>e.id===c.entryId);c.context=callContext(extra.context,entry,this.engine.game);if(c.phase==='staged')c.phase='backstage';c.checks.soundChecked=false;c.checks.explanationGiven=false;}
  else transitionLiveCall(c,action,'host',extra,now);
  c.version=(c.version||0)+1;
  if(c.phase==='completed'){if(this.engine.game.state.drawHold?.callId===c.id)this.engine.game.state.drawHold=null;this.engine.runner.autoDraw=false;this.engine.runner.age=0;this.engine.director.drawBlocked=false;}
  this.onCall(c);
 }
 async openActiveShow(){const id=this.call?.gameId;if(this.demo||!this.active||!id||this.engine.isOutput)throw Error('Er staat geen andere actieve belshow klaar.');return this.perform(async()=>{await this.engine.recoverCallGame(id);this.lastGame=id;this.error='';this.onCall(this.call);});}
 async refreshGame(){if(this.demo||this.engine.isOutput)return;const id=this.gameId,data=await this.engine.fetchLiveCallGame?.(id);if(data)this.acceptResponse(data);else{const {bingoApi}=await import('../public/bingo-api.js');this.acceptResponse(await bingoApi('/games/'+id));}}
 async connectLiveMonitor(){if(!this.matchesGame)throw Error('Open eerst de show die bij dit belmoment hoort.');if(this.connectingLive)return this.connectingLive;this.connectingLive=(async()=>{await this.media?.disconnect();await this.ensureMedia().connect('live');})().finally(()=>{this.connectingLive=null;});return this.connectingLive;}
 async startAudio(){if(!this.matchesGame)throw Error('Open eerst de show die bij dit belmoment hoort.');await this.ensureMedia().startAudio();}
 async publishReturnCue(){const cue=this.call?.returnState?.cue;if(!this.matchesGame||!cue||!['returning','returned'].includes(this.call?.phase)||!this.call.resourcesClosed)throw Error('Sluit eerst de gespreksaudio af.');if(this.demo)throw Error('Een simulatie levert geen publicatiebewijs.');await this.engine.speak(cue.text,this.engine.hostId);const voiceId=this.engine.bridge.command?.id;if(!voiceId)throw Error('Kies eerst de echte uitzendroute.');return this.action('return-cue-published',{cueId:cue.id,voiceId});}
 async connectPrivate(){if(!this.matchesGame)throw Error('Open eerst de show die bij dit belmoment hoort.');return this.perform(async()=>{if(this.demo){this.mediaState={phase:'simulated',target:'backstage',connected:true,micReady:true,simulated:true};if(this.call)this.call.media.host={connected:true,micReady:true};this.emit();return;}await this.ensureMedia().connect('backstage');await this.media.setPrivateMic(true);});}
 async privateMic(enabled){if(!this.matchesGame)throw Error('Open eerst de show die bij dit belmoment hoort.');if(this.demo){this.mediaState={...this.mediaState,micMuted:!enabled,simulated:true};this.emit();return;}await this.ensureMedia().setPrivateMic(enabled);this.emit();}
 async stop(){this.generation++;if(!this.active||['returning','returned'].includes(this.call.phase))return;void this.media?.disconnect();void this.output?.stop();if(this.demo){this.demoAction('cancel',{});return;}try{this.acceptResponse(await this.connection.action('cancel'));}catch(e){this.error=e.message;this.emit();throw e;}}
 cancel(){return this.stop();}
 async loadSettings(){this.settings=await this.request('/api/livekit/settings');this.emit();return this.settings;}
 mountOutput(root){if(!this.engine.isOutput)return noop;this.outputRoot=root;if(!this.output)this.output=new this.Output({engine:this.engine,media:this.ensureMedia(),api:this.connection,onChange:()=>this.emit()});this.output.mount(root);void this.output.sync(this.call);return()=>{};}
 stagePatch(base){if(!this.onAir)return base;const liveBase={...base,showCue:null,movement:null,magic:null};if(this.output)return this.output.stagePatch(liveBase);const c=this.call,level=this.demo?0:Math.max(0,Math.min(1,Number(c.voiceLevel)||0)),speaking=level>.035;return {...liveBase,hostId:c.characterId,speakerId:c.characterId,camera:'host',speaking,mouth:Math.min(.95,level*1.25),motion:speaking?'speak':'listen',paused:false,caption:this.demo?'SIMULATIE · Hoi '+c.context.callName+'!':'',liveCall:{name:c.context.callName,phase:c.phase,simulated:this.demo},show:{...base.show,scene:'call',liveCall:true,paused:false}};}
 dispose(){if(this.disposed)return;this.disposed=true;clearInterval(this.timer);globalThis.window?.removeEventListener?.('pagehide',this.pagehide);this.connection.dispose();this.media?.dispose();this.output?.dispose();this.listeners.clear();}
}
export const createLiveCallRuntime=(engine,options)=>new LiveCallRuntime(engine,options);
