import {CallConnection,active,ON_AIR,requestCall} from '../public/call-common.js';
import {CallOutput} from '../public/call-output.js';
import {apiJSON} from '../public/openai-voice.js';
import {LiveChat} from '../public/live-chat.js';
import {showPresentation} from '../server/presentation-model.js';
import {brandMention} from '../server/show-brands.js';
import {audienceChatStyle} from './audience-chat-style.js';

const queueEntries=game=>(game?.participation||[]).filter(e=>!['none','withdrawn','declined','done'].includes(e.callStatus));
const noop=()=>{};
class CharacterCallOutput extends CallOutput{update(call){super.update(call);const label=this.overlay.querySelector('strong small');if(label&&call?.characterName)label.textContent='× '+call.characterName;if(!this.transcript&&call?.characterName){const caption=this.overlay.querySelector('.call-caption');if(caption)caption.textContent='Een belmoment met '+call.characterName;}}}
/** One persistent host/output transport. React pages only observe it. */
export class AudienceRuntime{
 constructor(engine,{Connection=CallConnection,Output=CharacterCallOutput,api=apiJSON,request=requestCall,Chat=LiveChat,now=()=>Date.now(),timers=true,legacyCalls=true}={}){
  Object.assign(this,{engine,Output,api,request,Chat,now,legacyCalls});this.listeners=new Set();this.error='';this.busy=false;this.level=0;this.levelAt=0;this.review=null;this.reviewToken=0;this.settings=null;this.restore=null;this.lastCallId=null;this.disposed=false;this.intentToken=0;this.bootAt=now();this.lastReaction=0;this.lastScan=0;this.seen=new Set();this.cooldowns=new Map();
  this.connection=legacyCalls?new Connection({role:engine.isOutput?'output':'host',getGame:()=>engine.demo?null:engine.game,getClientId:()=>engine.isOutput?engine.bridge.id:engine.clientId,onChange:c=>this.onPhase(c)}):{call:null,now:now(),leave:noop};
  this.snapshot=this.state();this.pagehide=()=>{this.connection.leave();this.output?.emergencyStop();};globalThis.window?.addEventListener?.('pagehide',this.pagehide);
  if(legacyCalls&&!engine.isOutput){try{this.channel=new BroadcastChannel('vlampie-live-call');this.channel.onmessage=({data})=>{if(data.id===this.connection.call?.id){this.level=Number(data.level)||0;this.levelAt=Date.now();}};}catch{}}
  if(timers){this.timer=setInterval(()=>void this.tick(),1200);this.timer?.unref?.();}
 }
 subscribe=listener=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
 getSnapshot=()=>this.snapshot;
 get call(){return this.output?.api.call||this.connection.call;}
 get held(){return this.legacyCalls?ON_AIR.includes(this.call?.phase):!!this.engine.liveCalls?.onAir;}
 get active(){return this.legacyCalls?active(this.call):!!this.engine.liveCalls?.active;}
 state(){return {call:this.call?{...this.call}:null,queue:queueEntries(this.engine.game),busy:this.busy,error:this.error,settings:this.settings,review:this.review,held:this.held,now:this.connection.now||Date.now()};}
 emit(){if(this.disposed)return;this.snapshot=this.state();for(const listener of this.listeners)listener();}
 async tick(){if(this.disposed)return;if(!this.legacyCalls){if(!this.engine.isOutput){this.syncChat();void this.autoTick();}this.emit();return;}if(this.engine.isOutput){this.emit();return;}if(this.engine.demo){if(this.active){await this.stop().catch(noop);}this.emit();return;}this.syncChat();void this.autoTick();try{await this.connection.poll();this.error='';}catch(error){this.error=error.message;if(this.active&&Date.now()-this.connection.lastOK>6500){this.engine.director?.pause();this.engine.fail('Belverbinding onderbroken. De show staat stil.');}}this.emit();}
 async perform(task){if(this.busy)return;this.busy=true;this.error='';this.emit();try{return await task();}catch(error){this.error=error.message;this.engine.fail(error.message);throw error;}finally{this.busy=false;this.emit();}}
 realGame(){if(this.engine.demo)throw new Error('Sla eerst een echte show op om deelnemers te bellen.');if(this.engine.game.status==='finished')throw new Error('Deze show is afgelopen.');return this.engine.game;}
 async invite(entryId){return this.perform(async()=>{this.realGame();await this.engine.post('call-status',{entryId,status:'invited'});this.engine.emit();});}
 async prepare(entryId,maxSeconds=90,characterId=this.engine.hostId){const token=this.intentToken;return this.perform(async()=>{this.realGame();if(this.active)throw new Error('Rond eerst het huidige belmoment af.');await this.engine.bridge.connect();if(token!==this.intentToken)throw new Error('De belvoorbereiding is geannuleerd.');if(!this.engine.bridge.routing||!this.engine.bridge.connected)throw new Error('Open het uitzendvenster, activeer geluid en kies geluid via uitzendvenster.');await this.connection.action('prepare',{entryId,maxSeconds:Number(maxSeconds),characterId});if(token!==this.intentToken){if(this.active)await this.connection.action('stop');throw new Error('De belvoorbereiding is geannuleerd.');}});}
 async action(action,extra={}){return this.perform(async()=>{this.realGame();if(action==='ring'){
   const e=this.engine,d=e.director;
   if(e.showRuntime?.holding||e.showRuntime?.manual)throw new Error('Keer eerst terug naar de lopende show voordat je een deelnemer belt.');
   if(e.magic||e.showCues?.active||e.showCues?.holding)throw new Error('Wacht tot het magie-, bewegings- of showmoment is afgelopen voordat je een deelnemer belt.');
   if(e.game.status!=='running')throw new Error('Start eerst de show.');
   if(d.pending||d.flow?.kind==='draw'||e.game.state.window?.status==='open'||e.game.state.resultId)throw new Error('Rond eerst de trekking, bingocontrole of uitslag af.');
   if(e.voicePhase!=='idle')throw new Error('Wacht tot de presentator zijn zin heeft afgerond.');
   this.capture();if(await e.pause(true)===false)throw new Error('De show kon niet worden gepauzeerd. Controleer de verbinding.');e.stopSpeech();
  }
  try{await this.connection.action(action,extra);}catch(error){if(action==='ring'&&this.restore&&!this.held){this.restoreScene();this.engine.notify('De oproep is niet gestart. De show blijft gepauzeerd.');}throw error;}
 });}
 async stop(){if(!this.legacyCalls)return;this.intentToken++;this.engine.bridge.controls('call-stop');if(this.engine.isOutput){this.output?.emergencyStop();return;}if(!this.active)return;try{return await this.connection.action('stop');}catch(error){this.error=error.message;this.engine.fail(error.message);throw error;}finally{this.emit();}}
 async loadSettings(){try{this.settings=await this.request('/api/calls/settings');this.emit();return this.settings;}catch(error){this.error=error.message;this.emit();throw error;}}
 capture(){if(this.restore)return;const e=this.engine,d=e.director;this.restore={scene:d.scene,camera:e.camera,sceneAge:d.sceneAge,speakerId:e.speakerId,paused:d.paused,gameId:e.game.id,epoch:e.game.state.epoch};}
 restoreScene(){const e=this.engine,d=e.director,previous=this.restore;this.restore=null;d.callHold=false;d.configure({liveCall:false});if(previous&&previous.gameId===e.game.id&&previous.epoch===e.game.state.epoch&&d.scene==='call'&&e.game.state.window?.status!=='open'&&!e.game.state.resultId){d.setScene(previous.scene,undefined,true);d.sceneAge=previous.sceneAge;e.camera=previous.camera;e.speakerId=previous.speakerId||e.hostId;}d.pause();e.emit();e.bridge.sendLocal();}
 onPhase(call){const e=this.engine;if(e.isOutput){this.emit();return;}const held=ON_AIR.includes(call?.phase);
  if(held){if(e.showCues?.active||e.showCues?.holding){e.showCues.reset?.();e.audio.stop?.();}this.capture();if(!e.director.callHold){e.stopSpeech();e.director.pause();e.audio.pause();}e.director.callHold=true;e.director.configure({liveCall:true,callText:'',callSeconds:0});if(e.director.scene!=='call')e.director.setScene('call',undefined,true);e.camera='portrait';e.speakerId=call.characterId||e.hostId;e.emit();e.bridge.sendLocal();}
  else if(e.director.callHold||this.restore){this.restoreScene();if(call&&['ended','missed','declined'].includes(call.phase))e.notify('Belmoment afgerond. Hervat de show wanneer je klaar bent.');}
  this.emit();
 }
 mountOutput(root){if(!this.engine.isOutput||this.disposed)return noop;if(this.output){if(root&&this.output.overlay.parentNode!==root)root.append(this.output.overlay);return noop;}
  const target=root||document.querySelector('#stage');if(!target)throw new Error('Het uitzendbeeld is nog niet gemonteerd.');if(!document.querySelector('#stage'))target.id='stage';
  this.output=new this.Output({bridge:this.engine.bridge,onNotice:message=>this.engine.fail(message)});target.append(this.output.overlay);
  this.previousCallStop=this.engine.bridge.onCallStop;this.engine.bridge.onCallStop=()=>{this.previousCallStop?.();this.output?.emergencyStop();};this.emit();return noop;
 }
 stagePatch(base={}){if(!this.legacyCalls||!this.held)return base;const c=this.call,raw=this.engine.isOutput?this.output?.level||0:Date.now()-this.levelAt<400?this.level:Number(c.voiceLevel)||0,speaking=raw>.035;
  return {...base,showCue:null,movement:null,magic:null,hostId:c.characterId||base.hostId,speakerId:c.characterId||base.speakerId,camera:'portrait',speaking,mouth:Math.min(.95,raw*1.25),motion:speaking?'speak':'listen',paused:false,caption:this.output?.transcript||'',liveCall:{name:c.name,phase:c.phase},show:{...base.show,scene:'call',liveCall:true,paused:false}};
 }
 selectQuestion(message,{automatic=false}={}){this.reviewToken++;this.review=message?{automatic,expiresAt:automatic?this.now()+90000:null,source:{id:message.id,name:message.name,text:message.text,memberId:message.memberId},gameId:this.engine.game.id,characterId:this.engine.speakerId||this.engine.hostId,phase:'selected',approved:false,text:''}:null;this.emit();}
 async prepareQuestion(characterId,{automatic=false}={}){if(!this.review)throw new Error('Kies eerst een vraag uit de chat.');const review=this.review,token=++this.reviewToken;this.review={...review,characterId,phase:'preparing',approved:false,text:''};this.emit();
  try{if(!this.engine.apiStatus?.configured)throw new Error('Stel eerst de globale OpenAI-koppeling in.');const data=await this.api('present',{gameId:review.gameId,messageId:review.source.id,characterId,...(automatic?{automatic:true,regieId:this.engine.clientId}:{})});if(token!==this.reviewToken||review.gameId!==this.engine.game.id)return;if(data.action!=='reply'){this.review={...this.review,phase:'skipped',reason:data.reason||'Deze vraag wordt overgeslagen.'};return;}this.review={...this.review,phase:'review',text:data.text,name:data.name,question:data.question,messageId:data.messageId,memberId:data.memberId||review.source.memberId,characterId:data.characterId||characterId,approved:automatic};}
  catch(error){if(token===this.reviewToken)this.review={...this.review,phase:'error',reason:error.message};throw error;}finally{this.emit();}
 }
 approveQuestion(value){if(this.review?.phase==='review'){this.review={...this.review,approved:!!value};this.emit();}}
 assertQuestionQuiet(){
  const e=this.engine;
  if(e.showRuntime?.holding||e.showRuntime?.manual)throw new Error('Keer eerst terug naar de lopende show voordat je een kijkersvraag uitzendt.');
  if(e.magic||e.showCues?.active||e.showCues?.holding)throw new Error('Wacht tot het magie-, bewegings- of showmoment is afgelopen voordat je een kijkersvraag uitzendt.');
  if(this.held||e.director.pending||e.game.state.window?.status==='open'||e.game.state.resultId||e.voicePhase!=='idle')throw new Error('Wacht op een rustig showmoment.');
 }
 async airQuestion(){
  const review=this.review,e=this.engine;
  if(!review||review.phase!=='review'||!review.approved)throw new Error('Lees de reactie na en keur hem eerst goed.');
  if(review.gameId!==e.game.id)throw new Error('Deze reactie hoort bij een andere show.');
  this.assertQuestionQuiet();
  await this.api('validate',{gameId:review.gameId,messageId:review.messageId||review.source.id,...(review.automatic?{automatic:true,regieId:e.clientId}:{})});
  if(this.review!==review||review.gameId!==e.game.id)return;
  // Validation can cross a manual cue start. Never speak over that new moment.
  this.assertQuestionQuiet();
  this.questionRestore={scene:e.director.scene,camera:e.camera};
  e.director.configure({question:{name:review.name||review.source.name,text:review.question||review.source.text,phase:'answer'}});e.director.setScene('question',undefined,true);this.questionRevision=e.director.sceneRevision;e.camera='portrait';e.speak(review.text,review.characterId,'ai');this.review={...review,phase:'aired',approved:false};this.lastReaction=this.now();if(review.memberId)this.cooldowns.set(review.memberId,this.now());this.emit();e.bridge.sendLocal();
 }
 clearQuestion(){this.reviewToken++;this.review=null;const e=this.engine;if(this.questionRestore&&e.director.scene==='question'&&e.director.sceneRevision===this.questionRevision){e.director.configure({question:null});e.director.setScene(this.questionRestore.scene,undefined,true);e.camera=this.questionRestore.camera;e.emit();e.bridge.sendLocal();}this.questionRestore=null;this.emit();}
 ensureChat(){
  if(this.chat||this.engine.isOutput||typeof document==='undefined')return this.chat;
  this.chatSurface=document.createElement('div');this.chatParking=document.createDocumentFragment();this.chatParking.append(this.chatSurface);
  this.chat=new this.Chat({root:this.chatSurface,hostView:true,onVlampie:message=>this.selectQuestion(message)});
  const rename=()=>{for(const button of this.chatSurface.querySelectorAll('[data-action="vlampie"]'))if(button.textContent!=='Klaarzetten als kijkersvraag')button.textContent='Klaarzetten als kijkersvraag';};
  if(typeof MutationObserver!=='undefined'){this.chatObserver=new MutationObserver(rename);this.chatObserver.observe(this.chatSurface,{childList:true,subtree:true});}
  return this.chat;
 }
 syncChat(){
  const e=this.engine,chat=this.ensureChat();if(!chat)return;
  const id=e.demo?'':e.game.id;if(id!==this.chatGameId){this.chatGameId=id;this.clearQuestion();this.bootAt=this.now();this.lastReaction=0;this.lastScan=0;this.seen.clear();this.cooldowns.clear();void chat.setGame(id);}
 }
 mountChat(host,compact=false){
  if(!host)return noop;this.ensureChat();if(!this.chatSurface)return noop;
  const boundary=host.shadowRoot||(host.attachShadow?host.attachShadow({mode:'open'}):host);
  if(!boundary.querySelector('style[data-audience-chat]')){const style=document.createElement('style');style.dataset.audienceChat='';style.textContent=audienceChatStyle;boundary.append(style);}
  if(compact)host.setAttribute('data-compact','');else host.removeAttribute('data-compact');
  this.chatHost=host;boundary.append(this.chatSurface);this.syncChat();
  return ()=>{if(this.chatHost===host){this.chatHost=null;this.chatParking.append(this.chatSurface);}};
 }
 profile(){return showPresentation(this.engine.game).profile;}
 autoQuiet(){const e=this.engine,d=e.director,g=e.game;return !this.held&&!this.active&&!e.magic&&!e.showCues?.active&&!e.showCues?.holding&&!e.showRuntime?.holding&&!e.showRuntime?.manual&&!d.paused&&!d.externalHold&&!d.callHold&&!d.pending&&!d.flow&&e.voicePhase==='idle'&&g.state.window?.status!=='open'&&!g.state.resultId&&!g.state.callId;}
 async autoTick(){
  if(this.autoBusy||this.disposed||this.engine.isOutput)return;
  const e=this.engine,g=e.game,now=this.now();
  if(this.autoGameId!==g.id){this.autoGameId=g.id;this.bootAt=now;this.lastReaction=0;this.lastScan=0;this.seen.clear();this.cooldowns.clear();}
  const p=this.profile();
  // Guided/off never create background provider requests. Auto is effective only
  // after the operator starts a real, configured show under this controller lease.
  if(e.demo||g.status!=='running'||!g.startedAt||p.mode!=='auto'||!e.apiStatus?.configured||e.voiceMode!=='ai'||e.director.config.voice===false||g.state.control?.id!==e.clientId||g.state.control?.until<=now)return;
  if(this.review?.automatic&&this.review.phase==='aired'&&e.voicePhase==='idle'){this.clearQuestion();return;}
  if(this.review?.automatic&&this.review.expiresAt<=now){this.clearQuestion();return;}
  if(this.review){if(this.review.automatic&&this.review.phase==='review'&&this.review.approved&&this.autoQuiet()){this.autoBusy=true;try{await this.airQuestion();}catch(error){this.error=error.message;}finally{this.autoBusy=false;this.emit();}}return;}
  if(!this.autoQuiet()||now-this.lastReaction<p.intervalSeconds*1000||now-this.lastScan<5000)return;
  this.lastScan=now;const candidates=[...(this.chat?.messages.values()||[])].filter(m=>!m.deleted&&m.role!=='host'&&!this.seen.has(m.id)&&Number(m.createdAt||m.at)>Math.max(this.bootAt,now-60000)&&now-(this.cooldowns.get(m.memberId)||0)>p.accountCooldownSeconds*1000);
  const mentions=candidates.filter(m=>brandMention(m.text,g));const eligible=p.mentions&&mentions.length?mentions:p.spontaneous?candidates:[];if(!eligible.length)return;
  const source=eligible[0];this.seen.add(source.id);if(this.seen.size>500)this.seen=new Set([...this.seen].slice(-300));this.lastReaction=now;if(source.memberId)this.cooldowns.set(source.memberId,now);
  this.autoBusy=true;this.selectQuestion(source,{automatic:true});
  try{await this.prepareQuestion(e.hostId,{automatic:true});}catch(error){this.error=error.message;}finally{this.autoBusy=false;this.emit();}
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.reviewToken++;clearInterval(this.timer);this.chatObserver?.disconnect();this.chat?.dispose();this.chatSurface?.remove();this.connection.leave();this.connection.sessionEpoch=(this.connection.sessionEpoch||0)+1;this.channel?.close();globalThis.window?.removeEventListener?.('pagehide',this.pagehide);if(this.output){clearInterval(this.output.timer);clearInterval(this.output.visualTimer);this.output.close();this.output.local?.close();this.output.overlay.remove();}this.listeners.clear();}
}
export const createCallRuntime=(engine,options)=>new AudienceRuntime(engine,options);
