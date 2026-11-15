import {CHARACTERS,ALL_CHARACTER_IDS} from '../server/characters.js';
import {makeGame,generateBooks,activateBlock,reserveBall,commitBall,activeGoal,settleWindow,beginBingo,claimBook,familyDefault} from '../server/bingo-model.js';
import {normalizePlan,planIssues,createBlock} from '../server/plan-model.js';
import {ShowDirector} from '../public/show-director.js';
import {ShowRunner} from '../public/show-runner.js';
import {bingoApi} from '../public/bingo-api.js';
import {createShowAudio} from '../public/show-audio.js';
import {GameMotionClock} from '../public/bingo-motion.js';
import {createOpenAIVoice,apiJSON} from '../public/openai-voice.js';
import {assertSpeechText,splitSpeechText} from '../public/speech-text.js';
import {OutputBridge} from '../public/output-bridge.js';
import {createCallRuntime} from './call-runtime.js';
import {createLiveCallRuntime} from './live-call-runtime.js';
import {getShowRuntime} from './show-runtime.js';
import {ShowCueRuntime} from './show-cue-runtime.js';
import {getShowCue} from '../server/show-cues.js';
import {getMagicCue} from '../server/magic-cues.js';
import {showPresentation} from '../server/presentation-model.js';
import {DirectorWhisperRuntime} from './director-whisper-runtime.js';
import {PreparationAutosave,preparationFields,preparationFingerprint,drawClockStatus} from './show-preparation.js';
import {isStandardMiloGame,standardMiloDiffers,canLoadStandardMilo,loadStandardMiloPlan,STANDARD_MILO_PROFILE,STANDARD_DRAW_LEAD_MS} from '../server/standard-show.js';
import {PreparedShowAudio} from './prepared-show-audio.js';
import {premierePlan,PREMIERE_TITLE,PREMIERE_DATE} from '../server/premiere-plan.js';
import {manualCueAvailability,manualCuePlaybackHeld,resultSpeakingCues} from '../server/manual-cues.js';
import {addRound,roundBlocks,roundEditAccess} from './round-editor-model.js';
import {MILO_BANTER,NUMBER_NINE_AUDIENCE,FIXED_SHOW_SPEECH} from '../public/bingo-speech.js';
import {normalizeProduction} from '../server/production-model.js';
import {normalizeShowTime} from '../server/show-time.js';
import {ShowCallCues} from './show-call-cues.js';
import {ensureWinnerCallCue} from '../server/call-cues.js';

export const cameraMap={establish:'establish',front:'host',desk:'host',portrait:'portrait',machine:'board',led:'board',tour:'dolly',audience:'wide',entrance:'guest',orbit:'orbit',crane:'crane',duo:'duo',magic:'magic',wide:'wide'};
export const productionName=p=>p==='vlampie'?'Vlampie':'Milo & Friends';
export const formatDate=value=>new Intl.DateTimeFormat('nl-NL',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Amsterdam'}).format(new Date(value));
export async function jsonFetch(url,body,method='POST',headers={}, {timeoutMs=15000,timeoutMessage='De aanvraag duurde te lang. Controleer de verbinding en probeer opnieuw.'}={}){
 try{
  const r=await fetch(url,{method:body===undefined?'GET':method,credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});const d=await r.json();if(!r.ok)throw Object.assign(new Error(d.error?.message||d.error||'De aanvraag is niet bevestigd.'),{status:r.status,code:d.error?.code,broadcast:d.broadcast});return d;
 }catch(error){if(error?.name==='TimeoutError')throw Object.assign(new Error(timeoutMessage),{code:'timeout'});throw error;}
}
function preparation(game){
 const plan=normalizePlan(game.plan),issues=planIssues(plan);if(issues.length)throw Error(issues[0]);
 const roundCount=plan.blocks.filter(b=>b.type==='round').length;
 const valid=makeGame({timeZone:'Europe/Amsterdam',title:game.title,date:game.date,brandId:game.brandId,plan,settings:game.settings,roundCount},'rehearsal',location.origin);
 return {title:valid.title,date:valid.date,plan:valid.plan,settings:valid.settings,roundCount};
}
function rehearsal(brand='milo'){
 const defaults={timeZone:'Europe/Amsterdam',brandId:brand,title:brand==='vlampie'?'Vlampies feestelijke familieshow':'Milo’s Magische Première',date:'2026-11-01T14:00',roundCount:4};let g;
 try{const saved=JSON.parse(localStorage.getItem('mf-rehearsal-plan-'+brand)||'null');if(saved){const plan=normalizePlan(saved.plan||saved),input=saved.plan?{title:saved.title||defaults.title,date:saved.date||defaults.date,settings:saved.settings}:{};g=makeGame({timeZone:'Europe/Amsterdam',...defaults,...input,plan,roundCount:plan.blocks.filter(b=>b.type==='round').length},'rehearsal',location.origin);}}catch{}
 g??=makeGame(defaults,'rehearsal',location.origin);
 generateBooks(g,12,'milo-premiere-rehearsal');g.books.slice(0,4).forEach((b,i)=>Object.assign(b,{accountId:'demo-'+Math.floor(i/2),profileId:'demo-person-'+i,name:['Noor','Sam','Mila','Daan'][i],age:7+i}));return g;
}
export class StudioEngine{
 constructor(){
  this.listeners=new Set();this.production=localStorage.getItem('mf-production')==='vlampie'?'vlampie':'milo';this.isOutput=location.pathname==='/uitzending';this.clientId=crypto.randomUUID();this.game=rehearsal(this.production);this.demo=true;this.games=[];this.characters=ALL_CHARACTER_IDS.map(id=>({...CHARACTERS[id]}));this.characterRevision=0;this.settingsReady=false;this.apiStatus=null;this.voiceMode='browser';this.voicePhase='idle';this.notice='';this.error='';this.loading=true;this.working=false;this.selectedCharacter=this.game.plan.leadId||(this.production==='vlampie'?'vlampie':'milo');this.cohostId=this.game.plan.cohostId||null;this.selectedCue=0;this.theme='showtime';this.motion='idle';this.hostId=this.selectedCharacter;this.speakerId=this.hostId;this.guestId=null;this.camera='wide';this.previewCamera='host';this.movingCamera=true;this.cameraTransition='smooth';this.cameraDuration=1400;this.magic=null;this.caption='';this.voiceText='Hallo allemaal! Welkom op het Sterrenplein. Mijn hoge hoed staat klaar. Jullie ook?';this.outputEnabled=false;this.outputRouting=false;this.lastPublish=0;this.dirty=false;this.log=[];
  this.preparationAutosave=this.makePreparationAutosave();this._preparationFingerprint=preparationFingerprint(this.game);this.serverCheckedAt=0;this.serverStatusVerified=false;this.serverTimeOffset=0;this.localDrawNextAt=0;this.autoDrawBlocked=true;
  this.backgroundMusic=localStorage.getItem('mf-background-music')!=='off';
  if(!this.isOutput)this.preparedAudio=new PreparedShowAudio({read:()=>this.audioPreparationContext(),beforePrepare:()=>this.flushPreparation(),onChange:()=>this.emit()});
  this.audio=createShowAudio();
  this.director=new ShowDirector({config:{title:this.game.title,brandId:this.production,voice:true,autoCamera:true},onEvent:e=>this.event(e)});this.director.brandId=this.production;this.director.theme=this.production==='vlampie'?this.theme:'magico';
  this.runner=new ShowRunner(this.director,{onChange:()=>this.emit(),onNotice:m=>this.notify(m)});this.runner.autoDraw=false;this.showCues=new ShowCueRuntime(this);
  this.showCallCues=new ShowCallCues(this);
  this.runner.beforeAdvance=index=>this.showCallCues.beforeBlock(index);
  this.runner.beforeBlock=async(index,goal)=>{if(index>=this.game.plan.blocks.length)return;if(this.demo)activateBlock(this.game,index,goal);else await this.post('activate',{blockIndex:index,goalIndex:goal});await this.showCallCues.entered(this.game.plan.blocks[index]);this.syncGame();};
  this.runner.beforeGoal=(index,goal)=>this.runner.beforeBlock(index,goal);
  this.runner.afterRound=()=>this.syncGame();
  this.director.requestPick=async()=>{if(this.disposed)throw Error('Dit regievenster is gesloten.');if(this.demo){if(this.game.status!=='running'){this.game.status='running';activateBlock(this.game,this.game.plan.blocks.findIndex(b=>b.type==='round'));}return reserveBall(this.game);}const r=await this.post('reserve');return r.pending;};
  this.director.requestCommit=async token=>{const id=this.game.id,epoch=this.game.state.epoch,stopRevision=this.stopRevision||0,flow=this.director.flow;if(isStandardMiloGame(this.game)){const delay=Math.max(0,(this.game.state.drawClock?.nextAt||0)-this.serverNow());if(delay)await new Promise(resolve=>setTimeout(resolve,delay));if(this.disposed||stopRevision!==(this.stopRevision||0)||this.director.flow!==flow||id!==this.game.id||epoch!==this.game.state.epoch||this.director.externalHold||this.director.drawBlocked||this.showRuntime?.holding||this.showCues?.holding||this.director.paused||this.game.state.paused||this.game.state.drawHold||this.game.state.window?.status==='open'||this.game.state.resultId)throw Error('Deze trekking wacht op veilig hervatten.');}if(this.demo){const commit=commitBall(this.game,token);this.syncGame();return commit;}const r=await this.post('commit',{token});this.syncGame();return r.commit;};
  this.voice=createOpenAIVoice({onState:phase=>{this.voicePhase=phase;this.emit();},onStart:(text,duration)=>{this.caption=text;this.speechDuration=duration;this.audio.duck(true);this.emit();},onEnd:()=>this.speechEnded(),onError:m=>this.speechFailed(m),getRemote:()=>this.bridge?.remote,getPrepared:(...args)=>this.preparedAudio?.lookup(...args),canPlay:()=>!this.whispers?.playback||this.whispers.playbackAllowed()});
  this.bridge=new OutputBridge({isOutput:this.isOutput,getId:()=>this.clientId,getGame:()=>this.demo?null:this.game,getSnapshot:()=>this.stage(),getShow:()=>this.stage().show||null,showAudio:this.audio,receive:e=>this.receive(e),onLost:m=>{this.pause(true);this.fail(m);},onNotice:m=>this.notify(m)});
  if(!this.isOutput)this.whispers=new DirectorWhisperRuntime(this);
  this.gameAudioClock=new GameMotionClock();this._snapshot=this.snapshot();this.lastFrame=performance.now();this.timer=setInterval(()=>this.tick(),100);this.refreshTimer=setInterval(()=>this.refresh(),3500);if(!this.isOutput)this.load();
 }
 subscribe=fn=>{this.listeners.add(fn);return()=>this.listeners.delete(fn);};
 getSnapshot=()=>this._snapshot;
 get confirmedGameTitle(){return this.serverGameTitleId===this.game.id?this.serverGameTitle:this.game.title;}
 snapshot(){return {whisper:this.whispers?.snapshot()||null,production:this.production,hostId:this.hostId,game:this.game,serverGameTitle:this.confirmedGameTitle,demo:this.demo,games:this.games,characters:this.characters,characterRevision:this.characterRevision,selectedCharacter:this.selectedCharacter,loading:this.loading,working:this.working||!!this.starting||!!this.cancelling,cancelling:!!this.cancelling,notice:this.notice,error:this.error,dirty:this.dirty,preparation:this.preparationAutosave?.state||{status:'saved'},serverStatusVerified:this.serverStatusVerified,serverCheckedAt:this.serverCheckedAt,drawClock:this.drawClock(),standardRulesAvailable:canLoadStandardMilo(this.game)&&standardMiloDiffers(this.game),outputPreparation:this.bridge?.preparationStatus||null,audioPreparation:this.preparedAudio?.state||null,backgroundMusic:this.backgroundMusic,apiStatus:this.apiStatus,voiceMode:this.voiceMode,voicePhase:this.voicePhase,voiceText:this.voiceText,stage:this.stage(),runner:this.runner?.visual?.()||{},selectedCue:this.selectedCue,previewCamera:this.previewCamera,previewSceneId:this.previewSceneId||null,showRuntime:this.showRuntime?.status||null,outputConnected:!!this.bridge?.connected,outputRouting:this.outputRouting,autoDraw:isStandardMiloGame(this.game)||this.runner?.autoDraw||false,log:this.log,now:Date.now(),settingsReady:this.settingsReady,drawHeld:!!this.game.state.drawHold||!!this.liveCalls?.drawHeld};}
 stage(){
  if(this.isOutput&&this.remoteStage){const remote={...this.remoteStage,...(this.remoteStage.voiceMode==='ai'&&this.remoteStage.outputRouting?{mouth:this.bridge?.meter()||0}:{})};return this.liveCalls?.stagePatch(this.calls?.stagePatch(remote)||remote)||remote;}
  const raw=this.director?.visual?.()||{},liveShow=this.showRuntime?.visual(raw)||raw,show=this.showCues?.holding?{...liveShow,scene:'host',age:this.showCues.active.elapsed,paused:this.showCues.paused}:liveShow;
  const base={audioPreparation:this.preparedAudio?.state?{fingerprint:this.preparedAudio.state.fingerprint,total:this.preparedAudio.state.total,complete:this.preparedAudio.state.complete}:null,backgroundMusic:this.backgroundMusic,gameStatus:this.game.status,production:this.production,gameId:this.demo?null:this.game.id,gameTitle:this.game.title,cancelledAt:this.game.cancelledAt||null,hostId:this.showCues?.active?.hostId||this.hostId,guestId:this.guestId,cohostId:this.cohostId&&this.cohostId!==(this.showCues?.active?.hostId||this.hostId)?this.cohostId:null,speakerId:this.showCues?.active?.hostId||this.speakerId,camera:this.camera,movingCamera:this.movingCamera,cameraTransition:this.cameraTransition,cameraDuration:this.cameraDuration,motion:this.motion,speaking:['playing','paused'].includes(this.voicePhase),speechActive:this.voicePhase==='playing'&&(this.voiceMode!=='browser'||!globalThis.speechSynthesis?.paused),voiceMode:this.voiceMode,outputRouting:this.outputRouting,mouth:this.voiceMode==='ai'&&!this.outputRouting?this.voice?.meter||0:undefined,caption:this.caption,lastNumber:this.game.state.lastCommit?.number??null,drawn:this.game.state.drawn,roundTitle:activeGoal(this.game)?.round?.title||'Welkom op het Sterrenplein',pattern:activeGoal(this.game)?.pattern,paused:this.showCues?.holding?this.showCues.paused:this.showRuntime?.holding?!!show.paused:!!this.director?.paused||!!this.director?.externalHold,magic:this.magic?{...this.magic,elapsed:(this.magic.elapsed||0)*1000}:null,theme:this.theme,show,characterSettings:this.characters,scene:show.scene,...(this.showCues?.visual()||{})};
  return this.liveCalls?.stagePatch(this.calls?.stagePatch(base)||base)||base;
 }
 enableWorkspace(){if(this.workspaceEnabled)return;this.workspaceEnabled=true;this.showRuntime=getShowRuntime(this);this.liveCalls??=createLiveCallRuntime(this);this.calls??=createCallRuntime(this,{legacyCalls:false});this.bridge.isVoiceBusy=()=>this.calls?.held||this.liveCalls?.onAir||this.liveCalls?.held||this.voicePhase!=='idle';this.emit();}
 previewScene(id){this.previewSceneId=id;getShowRuntime(this).previewScene(id);this.emit();}
 previewStage(){const base=this.stage();return {...base,camera:this.previewCamera||base.camera,movingCamera:false,cameraTransition:'cut',magic:null,showCue:null,movement:null,...(this.previewSceneId?{show:getShowRuntime(this).previewVisual(this.previewSceneId),scene:this.previewSceneId,paused:false,speaking:false,speechActive:false,caption:''}:{})};}
 async takeScene(id=this.previewSceneId){const camera=this.previewCamera;if(id)await getShowRuntime(this).scene(id);this.setCamera(camera);this.emit();this.bridge.sendLocal();}
 assertGameSwitchAvailable(){if(this.game.cancelledAt)return;if(this.liveCalls?.active||this.liveCalls?.drawHeld||this.game.state.drawHold)throw Error('Rond eerst het belmoment af, bevestig de terugkeer en hervat de trekking voordat je van show of productie wisselt.');}
 assertTimelineAvailable(){if(this.game.cancelledAt)throw Error('Deze show is geannuleerd en kan niet worden hervat.');if(this.showCues?.active)throw Error('Rond eerst het actieve showelement of gebaar af.');if(this.calls?.held||this.game.state.callId)throw Error('Rond eerst het belmoment af.');if(this.showRuntime?.holding)throw Error('Zet eerst de presentator terug live om het draaiboek of een trekking te bedienen.');}
 setMix(key,value){const levels={...this.bridge.mixer,[key]:Number(value)};getShowRuntime(this).mix(levels);this.emit();}

 audioPreparationContext(){
  const plan=this.game.plan,planned=new Set([plan.leadId||'milo',plan.cohostId,...plan.blocks.flatMap(block=>[block.speakerId,...(block.dialogue||[]).map(turn=>turn.speakerId)]),...(plan.manualCues||[]).map(cue=>cue.speakerId)]);
  // An explicit new manual-call presenter needs their seven fixed lines.
  // Cue creation for an existing presenter, phase changes and closure do not
  // invalidate the bank or interrupt an already prepared show.
  const extraPresenters=this.production==='milo'?[...new Set((this.game.callCues||[]).map(cue=>cue.characterId).filter(id=>id!=='vlampie'&&CHARACTERS[id]&&!planned.has(id)))].sort():[];
  return {enabled:!this.disposed&&!this.isOutput&&!this.demo&&this.production==='milo'&&this.settingsReady&&!!this.apiStatus?.configured&&!this.game.cancelledAt&&this.game.status!=='finished',gameId:this.game.id,identity:JSON.stringify([this.game.id,this.game.preparationRevision||0,this.game.plan,this.characterRevision,this.characters.map(c=>[c.id,c.revision,c.speed,c.voice,c.customVoiceId]),extraPresenters])};
 }
 async prepareShowAudio(){const id=this.game.id;await this.flushPreparation();if(this.game.id!==id)throw Error('De gekozen show is gewijzigd. Open de voorbereiding van de juiste show.');const prepared=await this.preparedAudio?.prepare({retry:true});this.error='';this.emit();return prepared;}
 setBackgroundMusic(value){this.backgroundMusic=!!value;localStorage.setItem('mf-background-music',value?'on':'off');this.audio?.enableBackground?.(value&&this.game.status==='running'&&!this.game.cancelledAt);this.emit();this.bridge?.sendLocal();}
 updateBackgroundAudio(now){
  const stage=this.stage(),show=this.gameAudioClock.read(stage.show,now),outputReady=!this.isOutput||this.bridge?.active&&this.bridge?.audioReady&&!this.bridge?.liveCallActive&&!stage.outputWaiting;
  const running=this.isOutput?stage.gameStatus==='running':this.game.status==='running'&&this.runner?.active;
  this.audio?.enableBackground?.(stage.production==='milo'&&this.backgroundMusic!==false&&stage.backgroundMusic!==false&&running&&outputReady&&!stage.cancelledAt);
  if(this.isOutput)this.audio?.duck?.(!!stage.speechActive||!!this.bridge?.source);
  this.audio?.tickGame?.({...show,brandId:stage.production||this.production,paused:!!stage.paused||!!show?.paused,externalHold:!!show?.externalHold||!!this.director?.externalHold||!!this.showRuntime?.holding,drawBlocked:!!show?.drawBlocked||!!stage.cancelledAt||!!this.game.state.drawHold||!!this.liveCalls?.drawHeld,callHold:!!show?.callHold||!!stage.liveCall||!!this.bridge?.liveCallActive||!!this.calls?.held||!!this.liveCalls?.held||!!this.liveCalls?.onAir,cancelledAt:stage.cancelledAt,status:stage.gameStatus});
 }
 async saveBroadcast({gameId,youtubeId,expectedBroadcastRevision,requestId}){
  if(gameId!==this.game.id)throw Error('De geselecteerde show is gewijzigd.');
  if(this.game.cancelledAt||this.game.status==='finished')throw Error('Deze show is afgelopen. De uitzendinstellingen zijn alleen te bekijken.');
  if(this.demo){this.game={...this.game,settings:{...this.game.settings,youtubeId},broadcastRevision:(this.game.broadcastRevision||0)+1};const stored=JSON.parse(localStorage.getItem('mf-rehearsal-plan-'+this.production)||'null')||preparation(this.game);stored.settings={...stored.settings,youtubeId};localStorage.setItem('mf-rehearsal-plan-'+this.production,JSON.stringify(stored));this.emit();return {game:this.game,broadcast:{youtubeId,revision:this.game.broadcastRevision}};}
  const response=await jsonFetch('/api/bingo/games/'+encodeURIComponent(gameId)+'/broadcast',{youtubeId,expectedBroadcastRevision,requestId,regieId:this.clientId},'POST',{'X-Vlampie-Bingo':'1'});
  if(this.game.id===gameId){this.acceptGame(response.game);this.syncGame();this.emit();}return response;
 }

 async optionalNumberComment({number,count}){
  if(this.production!=='milo'||this.demo||this.optionalSpeech||this.optionalPending||this.game.cancelledAt||this.drawBlocked()||this.voicePhase!=='idle')return;
  const cue=number===9?NUMBER_NINE_AUDIENCE:count%5===0?MILO_BANTER[Math.floor(count/5-1)%MILO_BANTER.length]:null;if(!cue)return;
  const gameId=this.game.id,epoch=this.game.state.epoch,numberAt=this.game.state.lastCommit?.at,token=this.speechToken||0,c=this.characters.find(c=>c.id===this.speakerId)||CHARACTERS.milo;
  const entry=this.preparedAudio?.lookup(cue.text,c.speed,{characterId:c.id});if(!entry||!entry.durationMs)return;
  const fits=()=>gameId===this.game.id&&epoch===this.game.state.epoch&&numberAt===this.game.state.lastCommit?.at&&!this.game.cancelledAt&&!this.drawBlocked()&&this.voicePhase==='idle'&&(this.speechToken||0)===token&&this.serverNow()+entry.durationMs+800<Math.max(this.game.state.drawClock?.nextAt||0,this.localDrawNextAt||0)-STANDARD_DRAW_LEAD_MS;
  if(!fits())return;this.optionalPending=true;
  try{
   const response=await jsonFetch('/api/bingo/games/'+gameId+'/audio-cue',{cueId:cue.id,requestId:crypto.randomUUID(),regieId:this.clientId,expectedEpoch:epoch,expectedNumber:number},'POST',{'X-Vlampie-Bingo':'1'},{timeoutMs:1800});
   if(!response.claimed||!fits())return;
   if(response.game)this.acceptGame(response.game);
   this.speak(cue.text,c.id,'ai',true,{optional:{cueId:cue.id,deadline:Math.max(this.game.state.drawClock?.nextAt||0,this.localDrawNextAt||0)-STANDARD_DRAW_LEAD_MS-500}});
  }catch{/* Optional entertainment never pauses or delays the game. */}finally{this.optionalPending=false;}
 }

 makePreparationAutosave(){return new PreparationAutosave({
  read:()=>({id:this.game.id,demo:this.demo,brand:this.production,...preparationFields(this.game)}),
  persist:async(value,revision)=>{
   const issues=planIssues(normalizePlan(value.plan));if(issues.length)throw Error(issues[0]);
   if(value.demo){const saved=preparation({...this.game,...value,settings:{...this.game.settings,...value.settings}});localStorage.setItem('mf-rehearsal-plan-'+value.brand,JSON.stringify(saved));return {game:{...this.game,...saved,preparationRevision:revision+1}};}
   return bingoApi('/games/'+value.id,{method:'PUT',body:{...preparationFields(value),expectedPreparationRevision:revision,...(this.preparationSaveOptions||{})}});
  },
  apply:(result,{current,revision})=>{
   if(result.game?.id!==this.game.id)return;
   const input=preparationFields(current?result.game:this.game),latest=Number(result.game.revision||0)>=Number(this.game.revision||0)?result.game:this.game;
   this.game={...latest,...input,settings:{...latest.settings,...input.settings},preparationRevision:revision};this.dirty=!current;
   this._preparationFingerprint=preparationFingerprint(this.game);if(current)this.clearPreparationBackup();else this.storePreparationBackup();this.syncGame();
  },
  onChange:()=>{this.dirty=this.preparationAutosave?.state.dirty||this.dirty;if(this.preparationAutosave?.state.status==='error')this.storePreparationBackup();this.emit();}
 });}
 trackPreparationChange(){
  if(this.game.cancelledAt||!this.dirty||!this.preparationAutosave||this.production!=='milo')return;
  const fingerprint=preparationFingerprint(this.game);if(fingerprint===this._preparationFingerprint)return;
  this._preparationFingerprint=fingerprint;this.storePreparationBackup();this.preparationAutosave.mark();
 }
 preparationBackupKey(){return 'mf-unsaved-preparation-'+this.production+'-'+this.game.id;}
 storePreparationBackup(){if(this.demo)return;try{sessionStorage.setItem(this.preparationBackupKey(),JSON.stringify({revision:this.preparationAutosave?.revision??this.game.preparationRevision??0,...preparationFields(this.game)}));}catch{}}
 clearPreparationBackup(){try{sessionStorage.removeItem(this.preparationBackupKey());}catch{}}
 restorePreparationBackup(){
  if(this.demo||this.game.status!=='draft'||this.production!=='milo')return;
  try{const saved=JSON.parse(sessionStorage.getItem(this.preparationBackupKey())||'null');if(!saved)return;
   if(preparationFingerprint(saved)===preparationFingerprint(this.game)){this.clearPreparationBackup();return;}
   const input=preparationFields(saved);this.game={...this.game,...input,settings:{...this.game.settings,...input.settings}};this.dirty=true;this.preparationAutosave.revision=Number(saved.revision)||0;this._preparationFingerprint=preparationFingerprint(this.game);this.preparationAutosave.mark();
  }catch{}
 }
 async flushPreparation(){
  if(this.game.cancelledAt){if(this.dirty||this.preparationAutosave.state.dirty)this.storePreparationBackup();return;}
  this.trackPreparationChange();if(this.dirty&&!this.preparationAutosave.state.dirty){this._preparationFingerprint=preparationFingerprint(this.game);this.preparationAutosave.mark({schedule:false});}
  try{await this.preparationAutosave.flush();}catch(error){
   const conflict=error.code==='preparation_conflict',locked=error.code==='preparation_locked';throw Object.assign(new Error(locked?'Niet opgeslagen: de show is gestart. Je invoer blijft hier staan. Bekijk de opgeslagen versie en hervat daarna de regie.':conflict?'Niet opgeslagen: een ander regievenster heeft dit draaiboek gewijzigd. Je invoer blijft hier staan. Vergelijk de opgeslagen versie voordat je verdergaat.':'Niet opgeslagen — je invoer blijft bewaard. Controleer de verbinding en kies Opnieuw proberen.'),{code:error.code,cause:error});
  }
 }
 retryPreparation(){return this.task(()=>this.flushPreparation());}
 async loadSavedPreparation(){return this.task(async()=>{const id=this.game.id,r=await bingoApi('/games/'+id);if(id!==this.game.id)return;this.clearPreparationBackup();this.dirty=false;this.acceptGame(r.game,true);this.syncGame();this.emit();});}
 async loadStandardRules(){
  if(this.game.status!=='draft'||this.production!=='milo')throw Error('De standaardregels zijn alleen beschikbaar voor een Milo-conceptshow.');
  await this.flushPreparation();if(this.demo){this.game={...this.game,plan:loadStandardMiloPlan(this.game.plan),settings:{...this.game.settings,rulesProfile:STANDARD_MILO_PROFILE,mode:'auto'}};this.dirty=true;this._preparationFingerprint='';this.trackPreparationChange();await this.flushPreparation();}
  else {await this.post('load-standard',{expectedPreparationRevision:this.preparationAutosave.revision});this.dirty=false;this.preparationAutosave.reset(this.game.preparationRevision);this._preparationFingerprint=preparationFingerprint(this.game);}
  this.syncGame();this.notify('Standaardregels geladen: drie rondes met drie prijsstappen en een finaleronde met volle kaart.');
 }
 serverNow(){return Date.now()+(this.serverTimeOffset||0);}
 drawBlocked(){return !!this.showCallCues?.held||!this.runner?.active||this.runner.phase!=='drawing'||!!this.game.state.paused||!!this.director?.paused||!!this.director?.externalHold||!!this.game.state.drawHold||!!this.liveCalls?.drawHeld||!!this.calls?.held||!!this.game.state.callId||this.game.state.window?.status==='open'||!!this.game.state.resultId||!!this.game.state.goalWon||!!this.showRuntime?.holding||!!this.showCues?.holding;}
 drawClock(){return drawClockStatus(this.game,{now:this.serverNow(),blocked:this.drawBlocked(),localNextAt:this.localDrawNextAt});}
 autoDrawTick(){
  if(!isStandardMiloGame(this.game)||!this.runner?.active)return;
  if(this.optionalSpeech&&(this.drawBlocked()||this.serverNow()>=this.optionalSpeech.deadline))this.stopSpeech();
  if(!this.demo&&this.preparedAudio&&!this.preparedAudio.state.complete)return;
  const blocked=this.drawBlocked(),now=this.serverNow();
  if(blocked){this.autoDrawBlocked=true;return;}
  if(this.autoDrawBlocked){this.autoDrawBlocked=false;this.localDrawNextAt=now+15000;}
  const nextAt=Math.max(Number(this.game.state.drawClock?.nextAt)||0,this.localDrawNextAt||0);
  if(!this.director.flow&&!this.director.narrationHold&&this.voicePhase==='idle'&&nextAt&&now>=nextAt-STANDARD_DRAW_LEAD_MS&&this.game.state.drawn.length<75)this.director.draw();
 }

 emit(){this.trackPreparationChange();this.preparedAudio?.track();this.whispers?.validateContext();this._snapshot=this.snapshot();for(const fn of this.listeners)fn();}
 notify(text){this.notice=text;this.error='';this.emit();}
 fail(text){this.error=text||'Dit lukte niet.';this.emit();}
 async task(fn,success){if(this.working)return;this.working=true;this.error='';this.emit();try{const r=await fn();if(success)this.notice=success;return r;}catch(e){this.fail(e.message);throw e;}finally{this.working=false;this.emit();}}
 async load(){const r=await Promise.allSettled([bingoApi('/games'),jsonFetch('/api/characters'),apiJSON('status')]);
  if(r[0].status==='fulfilled'){this.games=r[0].value.games;const found=this.games.filter(g=>(g.brandId||'vlampie')===this.production).sort((a,b)=>(a.status==='running'?-1:0)-(b.status==='running'?-1:0))[0];if(found){try{await this.selectGame(found.id);}catch(e){this.error=e.message;}}}
  else this.error=r[0].reason.message;
  if(r[1].status==='fulfilled'){this.characters=r[1].value.characters;this.characterRevision=r[1].value.revision;this.settingsReady=true;}else this.settingsError=r[1].reason.message;
  if(r[2].status==='fulfilled'){this.apiStatus=r[2].value;if(this.apiStatus.configured)this.voiceMode='ai';}this.loading=false;this.emit();
 }
 async refresh(){if(this.isOutput||this.demo||this.working||this.refreshing)return;this.refreshing=true;const id=this.game.id;try{const r=await bingoApi('/games/'+id);if(id!==this.game.id||!this.acceptGame(r.game))return;this.syncGame();if(this.game.state.window?.status==='open'){this.director.externalHold=true;this.camera='host';}else this.director.externalHold=false;this.emit();}catch(e){this.fail(e.message);}finally{this.refreshing=false;}}
 async recoverCallGame(id){if(this.liveCalls?.call?.gameId!==id||!this.liveCalls.active)throw Error('Deze show hoort niet bij het actieve belmoment.');await this.flushPreparation();const r=await bingoApi('/games/'+id);if(this.liveCalls?.call?.gameId!==id)throw Error('Het belmoment is intussen gewijzigd.');this.stopSpeech();this.runner.stop();this.director.cancel();this.showRuntime?.returnToShow();this.acceptGame(r.game,true);this.demo=false;this.production=this.game.brandId==='vlampie'?'vlampie':'milo';this.hostId=this.game.plan.leadId||(this.production==='vlampie'?'vlampie':'milo');this.speakerId=this.hostId;this.syncGame();this.emit();}
 async selectGame(id){this.assertGameSwitchAvailable();await this.flushPreparation();this.serverStatusVerified=false;const token=this.selectionToken=(this.selectionToken||0)+1;if(await this.stop()===false)throw Error('De huidige show kon niet veilig worden gepauzeerd.');const r=await bingoApi('/games/'+id);if(token!==this.selectionToken)return;this.acceptGame(r.game,true);this.demo=false;this.production=this.game.brandId==='vlampie'?'vlampie':'milo';this.hostId=this.game.plan.leadId||(this.production==='vlampie'?'vlampie':'milo');this.speakerId=this.hostId;this.selectedCharacter=this.hostId;this.restorePreparationBackup();this.syncGame();this.emit();}
 async openRehearsal(){this.assertGameSwitchAvailable();await this.flushPreparation();if(!this.demo&&this.game.status==='running'&&!this.game.state.paused)throw Error('Pauzeer eerst de opgeslagen show voordat je de oefenstudio opent.');await this.stop();this.demo=true;this.voiceMode='browser';this.game=rehearsal(this.production);this.dirty=false;this.preparationAutosave.reset(this.game.preparationRevision);this._preparationFingerprint=preparationFingerprint(this.game);this.serverStatusVerified=false;this.hostId=this.game.plan.leadId||(this.production==='vlampie'?'vlampie':'milo');this.speakerId=this.hostId;this.guestId=null;this.magic=null;this.camera='wide';this.syncGame();this.notify('Oefenstudio geopend. Bellen en foutgevallen zijn hier een simulatie zonder providerverbinding.');}
 async productionSwitch(id){this.assertGameSwitchAvailable();await this.flushPreparation();if(await this.stop()===false)throw Error('De huidige show kon niet veilig worden gepauzeerd.');this.production=id;localStorage.setItem('mf-production',id);this.hostId=id==='vlampie'?'vlampie':'milo';this.speakerId=this.hostId;this.selectedCharacter=this.hostId;this.guestId=null;this.cohostId=null;this.magic=null;this.camera='wide';const found=this.games.find(g=>(g.brandId||'vlampie')===id);if(found)await this.selectGame(found.id);else {this.demo=true;this.game=rehearsal(id);this.dirty=false;this.preparationAutosave.reset(this.game.preparationRevision);this._preparationFingerprint=preparationFingerprint(this.game);this.serverStatusVerified=false;this.hostId=this.game.plan.leadId||(id==='vlampie'?'vlampie':'milo');this.speakerId=this.hostId;this.selectedCharacter=this.hostId;this.syncGame();this.emit();}}
 acceptGame(game,select=false){if(!game)return false;if(!select&&(game.id!==this.game.id||Number(game.revision||0)<Number(this.game.revision||0)))return false;this.serverGameTitle=game.title;this.serverGameTitleId=game.id;const local=!select&&this.dirty?preparationFields(this.game):null;this.game={...game,...(local||{}),settings:{...game.settings,...(local?.settings||{})}};if(!select&&!local&&this.preparationAutosave&&!this.preparationAutosave.state.dirty){this.preparationAutosave.revision=game.preparationRevision||0;this._preparationFingerprint=preparationFingerprint(this.game);}if(select){this.dirty=false;this.preparationAutosave?.reset(game.preparationRevision);this._preparationFingerprint=preparationFingerprint(this.game);this.localDrawNextAt=0;this.autoDrawBlocked=true;}this.serverTimeOffset=Number.isFinite(game.serverTime)?game.serverTime-Date.now():this.serverTimeOffset||0;this.serverCheckedAt=Date.now();this.serverStatusVerified=true;if(this.game.cancelledAt)this.haltCancelledGame();return true;}
 haltCancelledGame(){
  const key=this.game.id+':'+this.game.cancelledAt;if(!this.game.cancelledAt||this.cancelledGameKey===key)return;this.cancelledGameKey=key;
  if(this.dirty||this.preparationAutosave?.state.dirty)this.storePreparationBackup();this.preparationAutosave?.dispose();
  this.stopRevision=(this.stopRevision||0)+1;this.localDrawNextAt=0;this.autoDrawBlocked=true;this.bridge?.stopForCancellation?.(this.game);this.whispers?.cancel('Deze show is geannuleerd.');
  if(this.showRuntime){this.showRuntime.generation++;this.showRuntime.manual=null;this.showRuntime.restore=null;this.showRuntime.preview=null;}
  this.liveCalls?.haltCancelled?.();if(this.calls){this.calls.intentToken++;this.calls.reviewToken++;this.calls.review=null;this.calls.restore=null;this.calls.questionRestore=null;}
  this.showCues?.reset();this.runner?.stop();this.director?.cancel();if(this.director){this.director.paused=true;this.director.drawBlocked=true;this.director.callHold=false;}
  this.stopSpeech({silent:true});this.magic=null;this.guestId=null;this.motion='idle';this.audio?.stop();
 }
 forceCancel({gameId=this.game.id,expectedTitle,reason='',requestId}={}){
  if(this.cancelRequest)return this.cancelRequest;
  if(this.demo||gameId!==this.game.id||!requestId||typeof expectedTitle!=='string')return Promise.reject(Error('Open eerst de juiste opgeslagen show.'));
  if(this.game.status!=='running'&&!this.game.cancelledAt)return Promise.reject(Error('Alleen een lopende show kan geforceerd worden geannuleerd.'));
  this.cancelling=true;this.emit();
  const operation=(async()=>{
   const response=await jsonFetch('/api/bingo/games/'+encodeURIComponent(gameId)+'/force-cancel',{requestId,confirm:true,expectedTitle,reason,regieId:this.clientId},'POST',{'X-Vlampie-Bingo':'1'},{timeoutMessage:'De server heeft de annulering nog niet bevestigd. Je invoer blijft bewaard. Controleer de verbinding en probeer opnieuw.'});
   if(response.game?.id!==gameId||response.game.status!=='finished'||!response.game.cancelledAt)throw Error('De server heeft de annulering niet bevestigd. Controleer de showstatus en probeer opnieuw.');
   this.games=this.games.map(game=>game.id===gameId?{...game,status:'finished',cancelledAt:response.game.cancelledAt,cancellation:response.game.cancellation,finishedAt:response.game.finishedAt}:game);
   if(this.game.id===gameId){this.acceptGame(response.game);this.syncGame();this.notice=response.cleanup?.pending?'Show geannuleerd. Het afsluiten van de belverbinding vraagt nog aandacht.':'Show geannuleerd. De spelhistorie is bewaard.';this.error='';this.emit();}
   return response;
  })();this.cancelRequest=operation;
  operation.finally(()=>{if(this.cancelRequest===operation){this.cancelRequest=null;this.cancelling=false;this.emit();}}).catch(()=>{});return operation;
 }
 syncGame(){if(!this.director)return;this.director.callCueHold=!!this.showCallCues?.held;this.director.drawBlocked=!!this.game.cancelledAt||!!this.game.state.drawHold||!!this.liveCalls?.drawHeld||this.director.callCueHold;if(globalThis.document?.body)document.body.dataset.brand=this.production;const presentation=showPresentation(this.game);this.director.configure({drawCadence:isStandardMiloGame(this.game)?'official':undefined,rules:presentation.rules,transition:presentation.profile.transition,transitionMs:presentation.profile.transitionMs});this.cohostId=this.game.plan.cohostId||null;this.director.brandId=this.production;this.director.theme=this.production==='vlampie'?this.theme:'magico';this.director.drawn=[...this.game.state.drawn];this.director.number=this.game.state.lastCommit?.number??null;this.director.configure({title:this.game.title,brandId:this.production,speakerId:this.speakerId});}
 async post(action,body={}){const id=this.game.id,r=await bingoApi('/games/'+id+(action?'/'+action:''),{method:'POST',body:{...body,regieId:this.clientId}});if(r.game&&id===this.game.id)this.acceptGame(r.game);return r;}
 async createShow(title,date,brand=this.production,source=null){this.assertGameSwitchAvailable();await this.flushPreparation();const prepared=source?preparation({...source,title,date,brandId:brand}):null;return this.task(async()=>{if(await this.stop()===false)throw Error('De huidige show kon niet veilig worden gepauzeerd.');const roundCount=prepared?.roundCount||4,r=await bingoApi('/games',{method:'POST',body:{title,date,timeZone:'Europe/Amsterdam',brandId:brand,roundCount,...(prepared||{})}});const game=r.game;this.acceptGame(game,true);this.demo=false;this.production=brand;this.dirty=false;this.games=[{...game,bookCount:0,roundCount},...this.games];this.hostId=game.plan.leadId||(brand==='vlampie'?'vlampie':'milo');this.speakerId=this.hostId;this.syncGame();},'Je nieuwe show is opgeslagen.');}
 duplicateShow(sourceId,title,date,options={}){
  const current=sourceId===this.game.id,demo=current&&this.demo,source=current?this.game:this.games.find(game=>game.id===sourceId),timeZone=source?.timeZone||'Europe/Amsterdam';
  if(typeof sourceId!=='string'||!sourceId)return Promise.reject(Error('Kies eerst het draaiboek dat je wilt dupliceren.'));
  if(typeof title!=='string'||!title.trim()||typeof date!=='string'||!date.trim())return Promise.reject(Error('Vul een naam en datum voor de kopie in.'));
  const requestId=typeof options==='string'?options:options?.requestId;
  if(requestId!==undefined&&(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)))return Promise.reject(Error('Open de kopieeractie opnieuw; de aanvraag is niet meer geldig.'));
  const input={title:title.trim(),date:date.trim(),timeZone},key=JSON.stringify([sourceId,demo,input,requestId||null]);
  this.duplicateRequests??=new Map();let intent=this.duplicateRequests.get(key);
  if(intent?.pending)return intent.pending;
  if(intent?.game)return Promise.resolve(intent.game);
  if(!intent){intent={requestId:requestId||crypto.randomUUID()};this.duplicateRequests.set(key,intent);}
  const operation=(async()=>{
   // Duplicating a running show is read-only for its source. In particular it
   // must never use the create/select helpers that stop the current director.
   if(!intent.body){
    if(current&&(demo||this.game.status==='draft')){await this.flushPreparation();if(this.game.id!==sourceId||this.demo!==demo)throw Error('De geselecteerde bron is gewijzigd. Open de juiste kopieeractie opnieuw.');}
    if(demo){
     const prepared=preparation({...this.game,...input,brandId:this.production});
     prepared.plan.title=prepared.title;
     intent.path='/games';intent.body={...input,...prepared,brandId:this.production,requestId:intent.requestId,...(this.game.production?{production:normalizeProduction(this.game.production)}:{}),...(this.game.presentationSelection?{presentationSelection:structuredClone(this.game.presentationSelection)}:{}),...(this.game.ordering?{ordering:structuredClone(this.game.ordering)}:{})};
     const production=intent.body.production,ordering=intent.body.ordering;
     if(production?.lobby.startAt||ordering?.deadline){
      const delta=Date.parse(prepared.date)-Date.parse(normalizeShowTime(this.game.date,{timeZone}).date),shift=value=>new Date(Date.parse(normalizeShowTime(value,{timeZone}).date)+delta).toISOString();
      if(production?.lobby.startAt)production.lobby.startAt=shift(this.game.production.lobby.startAt);
      if(ordering?.deadline)ordering.deadline=shift(ordering.deadline);
     }
    }else{
     intent.path='/games/'+encodeURIComponent(sourceId)+'/duplicate';intent.body={...input,requestId:intent.requestId,...(current&&this.game.status==='draft'?{expectedPreparationRevision:this.preparationAutosave.revision}:{})};
    }
   }
   const response=await bingoApi(intent.path,{method:'POST',body:intent.body}),game=response.game;
   if(!game||game.id===sourceId||game.status!=='draft')throw Error('De server heeft de nieuwe conceptshow nog niet bevestigd. Je invoer blijft bewaard; probeer dezelfde kopie opnieuw.');
   intent.game=game;if(!requestId)this.duplicateRequests.delete(key);const roundCount=game.plan.blocks.filter(block=>block.type==='round').length;
   this.games=[{...game,bookCount:game.books?.length||0,roundCount},...this.games.filter(item=>item.id!==game.id)];this.emit();return game;
  })();intent.pending=operation;operation.finally(()=>{if(intent.pending===operation)intent.pending=null;}).catch(()=>{});return operation;
 }
 async savePremiere(){return this.createShow(this.game.title,this.game.date,this.production,{plan:structuredClone(this.game.plan),settings:structuredClone(this.game.settings)});}
 async createPremiereShow(){
  if(this.production!=='milo'||this.game.status==='running')throw Error('Open eerst een Milo-concept om een nieuw première-draaiboek te maken.');
  return this.createShow(PREMIERE_TITLE,PREMIERE_DATE,'milo',{plan:premierePlan(),settings:{rulesProfile:STANDARD_MILO_PROFILE,mode:'auto'}});
 }
 async savePlan(options={}){this.preparationSaveOptions=options;try{await this.flushPreparation();}finally{this.preparationSaveOptions=null;}}
 editPlan(mutator){if(this.starting)throw Error('De show wordt gestart. Wacht tot de start is bevestigd voordat je verder bewerkt.');if(this.game.status!=='draft'&&!this.demo)throw Error('De show is gestart; gebruik de live regie.');if(this.runner.active)throw Error('Stop eerst de repetitie voordat je het draaiboek bewerkt.');const next=structuredClone(this.game),access=roundEditAccess(this.game,{demo:this.demo});mutator(next.plan);if(next.plan.blocks.filter(b=>b.type==='random-call').length>2)throw Error('Een Milo-show heeft maximaal twee willekeurige belmomenten.');if(access.structureLocked&&JSON.stringify(roundBlocks(this.game.plan).map(b=>[b.id,b.title]))!==JSON.stringify(roundBlocks(next.plan).map(b=>[b.id,b.title])))throw Error(access.message);if(access.goalsLocked&&JSON.stringify([roundBlocks(this.game.plan).map(b=>[b.id,b.goals,b.interval,b.newBoard]),this.game.plan.patterns,this.game.plan.prizes])!==JSON.stringify([roundBlocks(next.plan).map(b=>[b.id,b.goals,b.interval,b.newBoard]),next.plan.patterns,next.plan.prizes]))throw Error(access.message);this.game=next;this.dirty=true;this.emit();}
 addBlock(type){if(type==='random-call'&&(this.production!=='milo'||this.game.plan.blocks.filter(block=>block.type==='random-call').length>=2))throw Error('Een Milo-show heeft precies twee willekeurige belmomenten. Verplaats of bewerk een bestaand moment.');if(type==='show'&&this.production!=='milo')throw Error('Deze showelementen horen bij Milo & Friends.');this.editPlan(plan=>{if(type==='round'){const round=addRound(plan,{production:this.production,speakerId:this.hostId});this.selectedCue=plan.blocks.indexOf(round);return;}const b=createBlock(type,{...plan,leadId:this.hostId},this.production);b.speakerId=type==='magic'?'milo':this.hostId;if(type==='magic')b.magicId='star-hat';plan.blocks.splice(Math.max(0,plan.blocks.length-1),0,b);this.selectedCue=plan.blocks.indexOf(b);});}
 async generate(count,mode='color'){return this.task(async()=>{await this.flushPreparation();if(this.demo){generateBooks(this.game,count,crypto.randomUUID(),Date.now(),{mode});return;}await this.post('generate',{count,printMode:mode});},this.demo?'Unieke oefenboekjes gegenereerd.':'Unieke boekjes en printbatch aangemaakt.');}
 async saveCharacter(id,settings){if(!ALL_CHARACTER_IDS.includes(id))throw Error('Open eerst een geldig personage via Personages.');return this.task(async()=>{const r=await jsonFetch('/api/characters/'+id,{settings,revision:this.characterRevision},'PUT',{'X-Milo-Characters':'1'});this.characters=r.characters;this.characterRevision=r.revision;this.settingsReady=true;},'Personage-instellingen opgeslagen.');}
 async designVoice(id){if(!ALL_CHARACTER_IDS.includes(id))throw Error('Open eerst een geldig personage via Personages.');return this.task(async()=>{
  const data=await jsonFetch('/api/openai/design-voice',{characterId:id,revision:this.characterRevision},'POST',{'X-Milo-Characters':'1'},{timeoutMs:195000,timeoutMessage:'Het stemontwerp is nog niet bevestigd. Herlaad eerst het profiel om te controleren of de stem al is opgeslagen. Er wordt niet automatisch opnieuw ontworpen.'});
  this.characters=data.characters;this.characterRevision=data.revision;this.settingsReady=true;
 },'Eigen GPT-Live-stem opgeslagen. Beluister de stemproef voordat je uitzendt.');}
 chooseCharacter(id){if(!ALL_CHARACTER_IDS.includes(id))return;this.selectedCharacter=id;this.emit();}
 setHost(id){if(this.production==='vlampie'&&id!=='vlampie')throw Error('Kies de Milo & Friends-productie voor deze presentator.');if(id==='vlampie'&&this.production!=='vlampie')throw Error('Vlampie staat in zijn eigen productie; gebruik een gastcue voor een bezoek.');this.whispers?.cancel('De presentator is gewijzigd.');this.showCues?.reset();this.hostId=id;this.speakerId=id;this.selectedCharacter=id;this.magic=null;this.emit();}
 setCamera(id,take=true){if(take){this.camera=id;this.emit();this.bridge.sendLocal();}else{this.previewCamera=id;this.emit();}}
 setMotion(id){return this.showCues.motion(id);}
 playShowCue(id){return this.showCues.play(id);}
 stopShowCue(){this.showCues.stop();}
 addShowCue(id){const cue=getShowCue(id);if(!cue)throw Error('Kies een beschikbaar showelement.');if(this.production!=='milo')throw Error('Deze showelementen horen bij Milo & Friends.');this.editPlan(plan=>{const block=createBlock('show',plan,this.production);Object.assign(block,{showCueId:cue.id,title:cue.title,duration:cue.duration});const finale=plan.blocks.findIndex(b=>b.type==='finale'),index=finale<0?plan.blocks.length:finale;plan.blocks.splice(index,0,block);this.selectedCue=index;});}
 setTheme(theme){if(!['showtime','sinterklaas'].includes(theme))return;this.theme=theme;this.emit();}
 start(options={}){
  if(this.startRequest)return this.startRequest;if(this.runner.active)return Promise.resolve();
  this.starting=true;this.emit();const operation=this.startPrepared(options);this.startRequest=operation;
  operation.finally(()=>{if(this.startRequest===operation){this.startRequest=null;this.starting=false;this.emit();}}).catch(()=>{});return operation;
 }
 async startPrepared(options={}){
  const id=this.game.id,stopRevision=this.stopRevision||0;
  const assertCurrent=()=>{if(this.game.cancelledAt)throw Error('Deze show is geannuleerd. Maak een nieuwe show om verder te gaan.');if(id!==this.game.id)throw Error('De geselecteerde show is gewijzigd.');if(stopRevision!==(this.stopRevision||0))throw Error('De start is gestopt. Controleer de showstatus voordat je opnieuw start.');};
  await this.flushPreparation();assertCurrent();
  if(!this.demo){const fresh=await bingoApi('/games/'+id);assertCurrent();this.acceptGame(fresh.game);this.syncGame();assertCurrent();}
  if(!this.demo&&this.game.status==='running')return this.restoreRegie();
  const rehearsalResume=this.demo&&this.game.status==='running';this.assertTimelineAvailable();
  if(!this.demo&&(this.voiceMode!=='ai'||!this.apiStatus?.configured))throw Error('Stel eerst de centrale personagestem in. De oefenstudio kan met een browserstem repeteren.');
  if(!this.demo&&this.game.status==='finished')throw Error('Deze show is afgelopen. Maak een nieuwe show om opnieuw te spelen.');
  if(this.game.state.window?.status==='open'||this.game.state.resultId)throw Error('Rond eerst de bestaande bingocontrole of uitslag af.');
  if(!this.demo&&this.production==='milo'){await this.preparedAudio?.ensure();assertCurrent();if(this.bridge?.routing)await this.bridge.ensurePreparedAudio(this.preparedAudio.state.fingerprint);assertCurrent();}
  this.error='';if(await this.stopRequest===false)throw Error('De vorige stop is nog niet bevestigd. Controleer de verbinding.');assertCurrent();await this.audio.unlock();assertCurrent();
  if(this.demo){this.game.status='running';this.game.state.paused=false;}
  else {await this.flushPreparation();assertCurrent();await this.post('start',{expectedPreparationRevision:this.preparationAutosave.revision});}
  assertCurrent();if(this.game.status!=='running')throw Error('De server heeft de start van deze show niet bevestigd. Controleer de showstatus.');
  const index=Number.isInteger(options.blockIndex)?options.blockIndex:rehearsalResume?Math.max(0,this.game.state.blockIndex):0,goal=Number.isInteger(options.goalIndex)?options.goalIndex:rehearsalResume?this.game.state.goalIndex||0:0;
  this.autoDrawBlocked=true;this.localDrawNextAt=0;
  this.hostId=this.game.plan.leadId||(this.production==='vlampie'?'vlampie':'milo');this.speakerId=this.hostId;this.cohostId=this.game.plan.cohostId||null;this.guestId=null;this.magic=null;
  this.runner.start(this.game.plan,{blockIndex:index,goalIndex:goal});
  this.log.unshift({at:Date.now(),text:'Show gestart: '+this.game.title});this.emit();
 }
 resumeRegie(){
  if(this.resumeRequest)return this.resumeRequest;
  const operation=(async()=>{await this.flushPreparation();const id=this.game.id,fresh=await bingoApi('/games/'+id);if(id!==this.game.id)throw Error('De geselecteerde show is gewijzigd.');this.acceptGame(fresh.game);return this.restoreRegie();})();
  this.resumeRequest=operation;operation.finally(()=>{if(this.resumeRequest===operation)this.resumeRequest=null;}).catch(()=>{});return operation;
 }
 async restoreRegie(){
  if(this.game.status!=='running')throw Error('De server meldt geen lopende show. Open de voorbereiding of maak een nieuwe show.');
  const id=this.game.id,stopRevision=this.stopRevision||0;
  await this.post('heartbeat');
  if(this.game.cancelledAt)throw Error('Deze show is geannuleerd. De regie blijft gestopt.');
  if(id!==this.game.id||stopRevision!==(this.stopRevision||0)||this.game.status!=='running')throw Error('Het hervatten van de regie is gestopt. Controleer de actuele showstatus.');
  if(this.runner.active){this.syncGame();this.emit();return;}
  const state=this.game.state,index=Math.max(0,state.blockIndex),block=this.game.plan.blocks[index],goal=activeGoal(this.game);
  this.stopSpeech();this.director.cancel(false);this.runner.plan=normalizePlan(structuredClone(this.game.plan));this.runner.active=true;this.runner.index=index;this.runner.goal=state.goalIndex||0;this.runner.age=0;this.runner.approvalBase=this.director.approvals||0;this.runner.phase=block?.type==='round'?(state.goalWon?'winner':'drawing'):'waiting';
  this.hostId=this.game.plan.leadId||(this.production==='vlampie'?'vlampie':'milo');this.speakerId=this.hostId;
  if(goal)this.director.configure({round:goal.round.title,pattern:goal.pattern.title,patternCells:[...goal.pattern.cells],patternFreeCenter:goal.pattern.freeCenter,patternVariant:goal.pattern.variant,prize:goal.prize.title,prizeImage:goal.prize.image,prizeDescription:goal.prize.description,roundPatterns:goal.round.goals.map(value=>this.game.plan.patterns.find(pattern=>pattern.id===value.patternId)),goalIndex:state.goalIndex});
  this.syncGame();this.director.externalHold=state.window?.status==='open'||!!state.resultId;this.director.drawBlocked=!!state.drawHold||!!this.liveCalls?.drawHeld;this.director.setScene?.(goal?'board':'host',goal?'led':'desk',true);this.director.pause();this.autoDrawBlocked=true;this.localDrawNextAt=0;
  this.log.unshift({at:Date.now(),text:'Regie hersteld: '+this.game.title});this.notify('Regie hersteld. Spelstand en blokkades zijn behouden. Kies bewust Hervat om de trekking vrij te geven.');
 }

 async cue(index){this.assertTimelineAvailable();if(this.game.state.window?.status==='open'||this.game.state.resultId)throw Error('Rond eerst het meldvenster of de uitslag af.');if(this.director.busy&&this.director.flow?.kind==='draw')throw Error('Rond eerst de lopende trekking af.');if(!this.runner.active){await this.start({blockIndex:index,goalIndex:0});return;}this.stopSpeech();this.runner.enter(index);this.emit();}
 nextCue(){this.assertTimelineAvailable();if(!this.runner.active)throw Error('Start eerst het draaiboek.');if(this.game.state.window?.status==='open'||this.game.state.resultId)throw Error('Rond eerst het meldvenster of de uitslag af.');this.stopSpeech();this.runner.next();this.emit();}
 async draw(){if(this.game.state.drawHold||this.liveCalls?.drawHeld)throw Error('De trekking is geblokkeerd voor een belmoment. Bevestig de terugkeer en hervat vanuit Publiek & bellen.');this.assertTimelineAvailable();if(this.game.state.window?.status==='open'||this.game.state.resultId)throw Error('Rond eerst het meldvenster of de uitslag af.');if(!activeGoal(this.game)||this.game.state.phase!=='running'||this.game.state.paused||this.game.state.goalWon||this.runner.block?.type!=='round'||this.runner.phase!=='drawing')throw Error('Zet eerst een bingoronde live vanuit het draaiboek.');if(!this.director.draw())throw Error('De regie wacht nog op de vorige cue of uitspraak.');this.emit();}
 async pause(value=!this.stage().paused){
  if(this.game.cancelledAt)return false;
  if(this.calls?.held){this.fail('Rond eerst het belmoment af voordat je het draaiboek hervat of pauzeert.');return false;}
  if(this.showCues?.holding){this.showCues.pause(value);if(value){this.audio.pause();this.bridge.controls('pause');}else{this.audio.resume();this.bridge.controls('resume');}this.emit();this.bridge.sendLocal();return true;}
  if(this.showRuntime?.holding){this.showRuntime.manual.paused=!!value;if(value){this.voice.pause();this.audio.pause();globalThis.speechSynthesis?.pause();}else{this.voice.resume();this.audio.resume();globalThis.speechSynthesis?.resume();}this.emit();this.bridge.sendLocal();return true;}

  if(value){this.director.pause();this.voice.pause();globalThis.speechSynthesis?.pause();this.audio.pause();if(this.demo)this.game.state.paused=true;}
  else if(this.game.state.window?.status==='open'||this.game.state.resultId||this.director.externalHold){this.fail('Het meldvenster of de uitslag houdt de show nog stil.');return false;}
  const prior=this.pauseRequest;
  if(value&&this.optionalSpeech)this.stopSpeech();
  const operation=(async()=>{try{await prior;if(this.game.cancelledAt)return false;if(!value&&!this.demo&&this.production==='milo'){await this.preparedAudio?.ensure();if(this.bridge?.routing)await this.bridge.ensurePreparedAudio(this.preparedAudio.state.fingerprint);}if(!this.demo&&this.game.status==='running')await this.post('pause',{paused:value,...(!value&&isStandardMiloGame(this.game)?{restartClock:true}:{})});if(this.game.cancelledAt)return false;if(!value){if(this.demo)this.game.state.paused=false;if(isStandardMiloGame(this.game)){this.autoDrawBlocked=true;if(this.director.flow?.kind==='draw')this.director.cancel(false);}if(this.runner.voiceFailed&&this.failedSpeech){const failed=this.failedSpeech;this.failedSpeech=null;this.runner.voiceFailed=false;if(this.director.flow)this.director.flow.age=0;this.speak(failed.text,failed.id,failed.mode,failed.planned);if(this.failedSpeech)return false;}this.director.resume();this.voice.resume();globalThis.speechSynthesis?.resume();this.audio.resume();}this.emit();return true;}catch(e){this.director.pause();this.fail(e.message);return false;}})();
  this.pauseRequest=operation;this.emit();return operation;
 }
 stopSpeech({replacement=false,whisperInternal=false,silent=false}={}){this.optionalSpeech=null;if(!whisperInternal)this.whispers?.speechStopped({replacement});this.speechToken=(this.speechToken||0)+1;this.voice.stop();globalThis.speechSynthesis?.cancel();this.voicePhase='idle';this.caption='';this.currentSpeech=null;this.failedSpeech=null;this.director.narrationHold=false;this.audio.duck(false);if(!silent)this.emit();}
 speechEnded(){this.optionalSpeech=null;this.voicePhase='idle';this.caption='';this.currentSpeech=null;this.director.narrationHold=false;this.audio.duck(false);this.whispers?.speechEnded();this.emit();}
 speechFailed(message){if(this.optionalSpeech){this.speechEnded();return;}const failed=this.currentSpeech,privateReaction=this.whispers?.speechFailed(message);this.speechEnded();this.failedSpeech=privateReaction?null:failed;this.runner.voiceFailed=!privateReaction&&!!failed;this.director.pause();this.fail(message);}
 speak(text,id=this.speakerId,mode=this.voiceMode,planned=false,options={}){
  if(this.game.cancelledAt)throw Error('Deze show is geannuleerd. De presentator blijft stil.');
  if(this.liveCalls?.onAir)throw Error('De live presentator voert nu het gesprek. Rond dit eerst af.');if(!text?.trim())return;assertSpeechText(text);this.stopSpeech({replacement:true});this.optionalSpeech=options.optional||null;this.speakerId=id;this.caption=text;this.voicePhase='loading';this.currentSpeech={text,id,mode,planned};const token=this.speechToken;
  // Manual announcements hold the timeline, including a spin that has no own speech.
  this.director.narrationHold=!planned;this.emit();const c=this.characters.find(c=>c.id===id)||CHARACTERS[id]||CHARACTERS.milo;
  if(!this.demo&&this.game.status==='running'&&mode!=='ai'){this.speechFailed('De browserstem is alleen voor repetities. Kies de eigen personagestem voor de echte show.');return;}
  if(mode==='ai'){if(!this.apiStatus?.configured){this.speechFailed('Stel eerst de globale OpenAI-koppeling in. Met de oefenstem kun je lokaal repeteren.');return;}this.voice.speak(text,c.speed,{characterId:id,preparedOnly:!!options.preparedOnly||!this.demo&&this.production==='milo'&&planned,...(!this.demo?{gameId:this.game.id}:{brandId:this.production})});}
  else {
   if(!globalThis.speechSynthesis){this.speechFailed('Deze browser heeft geen oefenstem. Stel de globale OpenAI-koppeling in.');return;}
   const parts=splitSpeechText(text).filter(part=>part.trim());let index=0;
   const playPart=()=>{if(token!==this.speechToken||this.game.cancelledAt)return;const u=new SpeechSynthesisUtterance(parts[index]);u.lang='nl-NL';u.rate=c.speed;u.pitch=['stella','pip','bella'].includes(id)?1.12:['bruno','lola','piko'].includes(id)?.88:1;u.voice=globalThis.speechSynthesis.getVoices().find(v=>v.lang.startsWith('nl'))||null;
    u.onpause=()=>{if(token===this.speechToken){this.voicePhase='paused';this.emit();}};u.onresume=()=>{if(token===this.speechToken){this.voicePhase='playing';this.emit();}};u.onstart=()=>{if(token!==this.speechToken)return;this.caption=parts[index];this.voicePhase='playing';this.audio.duck(true);this.emit();};u.onend=()=>{if(token!==this.speechToken)return;if(++index<parts.length)playPart();else this.speechEnded();};u.onerror=e=>{if(token!==this.speechToken)return;if(e.error!=='canceled'&&e.error!=='interrupted')this.speechFailed('De oefenstem kon niet starten. Hervat probeert dezelfde uitspraak opnieuw.');};globalThis.speechSynthesis.speak(u);};playPart();
  }
 }
 async playManualCue(id){
  if(this.manualCueRequest)return this.manualCueRequest;
  const gameId=this.game.id,stopRevision=this.stopRevision||0;
  const current=()=>{if(this.disposed||this.game.id!==gameId||this.game.cancelledAt||this.game.status==='finished'||(this.stopRevision||0)!==stopRevision)throw Error('Deze spreekkaart hoort niet meer bij de actieve show.');};
  const operation=(async()=>{
   await this.flushPreparation();current();
   if(!this.demo){const fresh=await bingoApi('/games/'+gameId);current();this.acceptGame(fresh.game);this.syncGame();}
   current();const cue=this.game.plan.manualCues?.find(item=>item.id===id),availability=manualCueAvailability(cue,this.game,this.serverNow());
   if(!availability.allowed)throw Error(availability.reason);
   if(!this.demo&&this.game.status!=='running')throw Error('Start eerst de show om deze spreekkaart in de uitzending af te spelen.');
   if(this.voicePhase!=='idle'||this.director.flow?.kind==='draw'||this.showCues?.holding||this.showRuntime?.holding)throw Error('Wacht tot de huidige uitspraak, trekking of animatie klaar is.');
   if(this.liveCalls?.onAir)throw Error('De presentator voert nu een gesprek. Rond dit eerst af.');
   if(!manualCuePlaybackHeld(this.game))throw Error('Pauzeer eerst de show. De spreekkaart geeft de trekking niet automatisch vrij.');
   if(!this.demo)await this.preparedAudio.ensure();current();
   const checked=manualCueAvailability(cue,this.game,this.serverNow());if(!checked.allowed)throw Error(checked.reason);
   await this.audio.unlock();current();
   const finalAvailability=manualCueAvailability(cue,this.game,this.serverNow());if(!finalAvailability.allowed)throw Error(finalAvailability.reason);
   if(!manualCuePlaybackHeld(this.game)||this.voicePhase!=='idle'||this.director.flow?.kind==='draw'||this.showCues?.holding||this.showRuntime?.holding||this.liveCalls?.onAir)throw Error('De showstand is gewijzigd. Pauzeer en controleer deze spreekkaart opnieuw.');
   this.speak(cue.text,cue.speakerId||this.game.plan.leadId||this.hostId,this.voiceMode,false,{preparedOnly:!this.demo});
   return true;
  })();this.manualCueRequest=operation;
  try{return await operation;}finally{if(this.manualCueRequest===operation)this.manualCueRequest=null;}
 }
 magicMoment(id){return this.showCues.magic(id);}
 async demoBingo(){if(!this.demo)throw Error('Echte spelers melden via de familie-app.');const b=this.game.books.find(b=>b.accountId);const f=this.demoFamily??=familyDefault();f.profiles=[{name:b.name}];beginBingo(this.game,f,b.accountId,crypto.randomUUID());claimBook(this.game,f,b.accountId,b.id);this.director.externalHold=true;this.notify('Oefenmelding ontvangen; de serverregels bepalen of de kaart compleet is.');}
 async resultNext({manual=false}={}){
  if(this.resultBusy||!this.game.state.resultId)return;const gameId=this.game.id,stopRevision=this.stopRevision||0,r=this.game.results.find(r=>r.id===this.game.state.resultId);if(!r)return;this.resultBusy=true;
  const current=()=>{if(this.disposed||gameId!==this.game.id||this.game.cancelledAt||this.game.status!=='running'||stopRevision!==(this.stopRevision||0))throw Error('De uitslag hoort niet meer bij deze actieve show.');};
  const quiet=()=>{if(this.voicePhase!=='idle'||this.showRuntime?.holding||this.showCues?.holding||this.liveCalls?.onAir)throw Error('Rond eerst de actieve uitspraak, het beslisspel, showmoment of gesprek af.');};
  try{
   if(manual){
    current();if(this.production!=='milo'||!resultSpeakingCues(this.game).length)throw Error('Er staat geen passende voorbereide spreekkaart voor deze uitslag klaar.');
    quiet();if(!this.demo)await this.preparedAudio.ensure();current();quiet();
    const paused=await this.pause(true);current();quiet();
    if(paused!==true||!this.game.state.paused)throw Error('De serverpauze is niet bevestigd. De uitslag blijft open; probeer opnieuw.');
    if(this.game.state.resultId!==r.id||!resultSpeakingCues(this.game).length)throw Error('De uitslag is intussen gewijzigd. Controleer de actuele bingocontrole.');
   }
   let applied=!r.acknowledged;
   if(this.demo){r.acknowledged=true;this.game.state.resultId=null;this.game.state.phase=r.type==='bingo'?'running':r.returnPhase||'interlude';ensureWinnerCallCue(this.game,r);}
   else {const result=await this.post('finish-result',{resultId:r.id});applied=result.applied!==false;}
   if(manual)current();
   if(gameId!==this.game.id||stopRevision!==(this.stopRevision||0))return;
   // A valid bingo invalidates the unfinished visual draw, not its authoritative committed history.
   this.director.cancel(false);this.director.externalHold=false;this.syncGame();if(applied&&r.type==='bingo')this.director.approvals++;
   if(manual){
    const official=this.game.results.find(item=>item.id===r.id),goal=activeGoal(this.game);
    this.director.pause();this.director.claim=null;this.director.lastWinner='';
    if(!official?.acknowledged||!this.game.state.paused)throw Error('De bevestigde uitslag staat niet veilig gepauzeerd. Controleer de serverstand voordat je verdergaat.');
    if(goal)this.director.configure({round:goal.round.title,pattern:goal.pattern.title,patternCells:[...goal.pattern.cells],patternFreeCenter:goal.pattern.freeCenter,patternVariant:goal.pattern.variant,prize:goal.prize.title,prizeImage:goal.prize.image,prizeDescription:goal.prize.description});
    this.director.setScene('winner','portrait',true);
    const cue=(this.game.plan.manualCues||[]).filter(item=>['confirmed-finale','round-complete','confirmed-bingo','confirmed-consolation'].includes(item.condition)&&manualCueAvailability(item,this.game,this.serverNow()).allowed).sort((a,b)=>['confirmed-finale','round-complete','confirmed-bingo','confirmed-consolation'].indexOf(a.condition)-['confirmed-finale','round-complete','confirmed-bingo','confirmed-consolation'].indexOf(b.condition))[0];
    this.notify('De officiële uitslag is bevestigd. Speel je voorbereide spreekkaart af en kies daarna bewust Hervat.');
    if(cue)globalThis.dispatchEvent?.(new CustomEvent('milo:select-manual-cue',{detail:{gameId,cueId:cue.id}}));
    return {manualCueId:cue?.id||null};
   }
   if(applied&&!this.showCallCues?.announce(this.game.results.find(item=>item.id===r.id)||r)){this.speak(this.production==='milo'?FIXED_SHOW_SPEECH.winner:'Bingo bevestigd! Gefeliciteerd '+r.winner.name+'! Een groot applaus voor jou.',this.hostId,this.voiceMode,false,{preparedOnly:!this.demo&&this.production==='milo'});this.motion='cheer';this.audio.cue('win');}this.emit();
  }finally{this.resultBusy=false;}
 }
 async routeOutput(enabled){await this.bridge.route(enabled);this.outputRouting=enabled;this.emit();}
 resumeAfterCall(target,call){return this.showCallCues.resume(target,call);}
 stop(){
  if(this.game.cancelledAt){this.haltCancelledGame();return Promise.resolve(true);}
  this.whispers?.cancel('De show is gestopt vanuit de regie.');
  this.stopRevision=(this.stopRevision||0)+1;
  if(this.liveCalls)this.liveCalls.stop().catch(e=>this.fail(e.message));if(this.calls)this.calls.stop().catch(e=>this.fail(e.message));if(this.showRuntime?.manual){this.showRuntime.generation++;this.showRuntime.manual=null;this.showRuntime.restore=null;}

  this.showCues?.reset();this.runner?.stop();this.director?.cancel();this.stopSpeech();if(this.director)this.director.paused=true;this.magic=null;this.guestId=null;this.motion='idle';this.audio?.stop();this.bridge?.controls('stop');this.emit();
  if(this.demo||this.game.status!=='running'||this.game.state.paused)return Promise.resolve(true);
  const prior=this.pauseRequest,sync=this.runner?.syncRequest;
  this.stopRequest=(async()=>{try{await prior;await sync;await this.post('pause',{paused:true});return true;}catch(e){this.fail(e.message);return false;}})();return this.stopRequest;
 }
 event(e){if(!this.director)return;
  if(e.type==='camera')this.camera=this.production==='vlampie'?e.camera:cameraMap[e.camera]||e.camera;
  if(e.type==='motion')this.motion=e.motion;
  if(e.type==='sound'){this.audio.cue(e.cue);this.bridge?.cue(e.cue);}
  if(e.type==='numberfinished')void this.optionalNumberComment(e);
  if(e.type==='speech'){this.director.narrationHold=false;this.speak(e.text,this.director.config.speakerId||this.hostId,this.voiceMode,true);}
  if(e.type==='show-cue'){if(e.action==='start')this.showCues.startRundown(e);else this.showCues.reset();}
  if(e.type==='cast-cue'){if(e.action==='start'){if(e.guestId)this.guestId=e.guestId;if(e.magicId){this.magic={id:e.magicId,startedAt:Date.now(),playing:true,elapsed:0,duration:e.duration};const sound=getMagicCue(e.magicId)?.sound||'prize';this.audio.cue(sound);this.bridge?.cue(sound);}}else {this.magic=null;this.guestId=null;this.speakerId=e.returnSpeakerId||this.hostId;}}
  if(e.type==='cast-speaker'){this.speakerId=e.characterId;this.motion=e.animation;}
  if(e.type==='external-error')this.fail(e.error?.message);
  if(e.type==='pause'){this.bridge?.controls('pause');this.voice?.pause();globalThis.speechSynthesis?.pause();this.audio?.pause();}
  if(e.type==='resume'){this.bridge?.controls('resume');this.voice?.resume();globalThis.speechSynthesis?.resume();this.audio?.resume();}
  if(e.type==='cancel'){this.whispers?.speechStopped({replacement:true});this.speechToken=(this.speechToken||0)+1;this.currentSpeech=null;this.failedSpeech=null;this.voice?.stop();globalThis.speechSynthesis?.cancel();this.voicePhase='idle';this.caption='';this.director.narrationHold=false;}
  this.emit();this.bridge?.sendLocal();
 }
 receive(e){if(e.kind==='snapshot'){this.remoteStage=e.payload;if(this.isOutput)this.demo=!e.payload.gameId;this.emit();}if(e.kind==='show'){this.remoteStage={...this.remoteStage,show:e.payload,scene:e.payload.scene};this.emit();}if(e.kind==='speech-start'){this.remoteStage={...this.remoteStage,speaking:true,caption:e.payload.text};this.emit();}if(e.kind==='stop'){this.remoteStage={...this.remoteStage,paused:true,speaking:false};this.emit();}}
 tick(){const now=performance.now(),dt=Math.min(.35,(now-this.lastFrame)/1000);this.lastFrame=now;if(this.isOutput){this.updateBackgroundAudio(now);this.emit();return;}if(this.game.cancelledAt){this.haltCancelledGame();return;}if(isStandardMiloGame(this.game))this.runner.autoDraw=false;this.showRuntime?.tick(dt);this.updateBackgroundAudio(now);if(this.demo&&this.game.state.window?.status==='open'&&Date.now()>=this.game.state.window.endsAt){settleWindow(this.game);this.director.externalHold=!!this.game.state.resultId;}
  this.director.callCueHold=!!this.showCallCues?.held;this.director.drawBlocked=!!this.game.state.drawHold||!!this.liveCalls?.drawHeld||this.director.callCueHold;const hold=this.game.state.window?.status==='open'||!!this.game.state.resultId;this.director.externalHold=hold;this.whispers?.tick();const cueWasHolding=this.showCues?.holding;this.showCues?.tick(dt);if(!hold&&!this.showRuntime?.holding&&!this.calls?.held&&!cueWasHolding){this.director.tick(dt,{voiceBusy:this.voicePhase!=='idle'});this.runner.tick(dt);}void this.showCallCues?.process();this.autoDrawTick();if(this.magic&&!this.magic.manual&&!this.director.paused&&!hold){this.magic.elapsed=(this.magic.elapsed||0)+dt;}if(now-(this.lastEmit||0)>240){this.lastEmit=now;this.emit();}if(!this.demo&&this.game.status==='running'&&this.runner.active&&now-(this.lastHeartbeat||0)>5000){this.lastHeartbeat=now;this.post('heartbeat').catch(e=>{this.director.pause();this.fail(e.message);});}
 }
 dispose(){this.disposed=true;this.preparedAudio?.dispose();this.whispers?.dispose();this.showCues?.reset();this.liveCalls?.dispose();this.calls?.dispose();this.showRuntime?.dispose();clearInterval(this.timer);clearInterval(this.refreshTimer);this.voice.stop();this.bridge.dispose();this.audio.dispose();this.preparationAutosave?.dispose();}
}
