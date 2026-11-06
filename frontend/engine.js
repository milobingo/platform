import {CHARACTERS,ALL_CHARACTER_IDS} from '../server/characters.js';
import {makeGame,generateBooks,activateBlock,reserveBall,commitBall,activeGoal,settleWindow,beginBingo,claimBook,familyDefault} from '../server/bingo-model.js';
import {normalizePlan,planIssues,createBlock} from '../server/plan-model.js';
import {ShowDirector} from '../public/show-director.js';
import {ShowRunner} from '../public/show-runner.js';
import {bingoApi} from '../public/bingo-api.js';
import {createShowAudio} from '../public/show-audio.js';
import {GameMotionClock} from '../public/bingo-motion.js';
import {createOpenAIVoice,apiJSON} from '../public/openai-voice.js';
import {OutputBridge} from '../public/output-bridge.js';
import {createCallRuntime} from './call-runtime.js';
import {createLiveCallRuntime} from './live-call-runtime.js';
import {getShowRuntime} from './show-runtime.js';
import {ShowCueRuntime} from './show-cue-runtime.js';
import {getShowCue} from '../server/show-cues.js';
import {getMagicCue} from '../server/magic-cues.js';
import {showPresentation} from '../server/presentation-model.js';
import {DirectorWhisperRuntime} from './director-whisper-runtime.js';

export const cameraMap={establish:'establish',front:'host',desk:'host',portrait:'portrait',machine:'board',led:'board',tour:'dolly',audience:'wide',entrance:'guest',orbit:'orbit',crane:'crane',duo:'duo',magic:'magic',wide:'wide'};
export const productionName=p=>p==='vlampie'?'Vlampie':'Milo & Friends';
export const formatDate=value=>new Intl.DateTimeFormat('nl-NL',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Amsterdam'}).format(new Date(value));
export async function jsonFetch(url,body,method='POST',headers={}, {timeoutMs=15000,timeoutMessage='De aanvraag duurde te lang. Controleer de verbinding en probeer opnieuw.'}={}){
 try{
  const r=await fetch(url,{method:body===undefined?'GET':method,credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});const d=await r.json();if(!r.ok)throw Object.assign(new Error(d.error?.message||d.error||'De aanvraag is niet bevestigd.'),{status:r.status,code:d.error?.code});return d;
 }catch(error){if(error?.name==='TimeoutError')throw Object.assign(new Error(timeoutMessage),{code:'timeout'});throw error;}
}
function preparation(game){
 const plan=normalizePlan(game.plan),issues=planIssues(plan);if(issues.length)throw Error(issues[0]);
 const roundCount=plan.blocks.filter(b=>b.type==='round').length;
 const valid=makeGame({title:game.title,date:game.date,brandId:game.brandId,plan,settings:game.settings,roundCount},'rehearsal',location.origin);
 return {title:valid.title,date:valid.date,plan:valid.plan,settings:valid.settings,roundCount};
}
function rehearsal(brand='milo'){
 const defaults={brandId:brand,title:brand==='vlampie'?'Vlampies feestelijke familieshow':'Milo’s Magische Première',date:'2026-11-01T14:00',roundCount:4};let g;
 try{const saved=JSON.parse(localStorage.getItem('mf-rehearsal-plan-'+brand)||'null');if(saved){const plan=normalizePlan(saved.plan||saved),input=saved.plan?{title:saved.title||defaults.title,date:saved.date||defaults.date,settings:saved.settings}:{};g=makeGame({...defaults,...input,plan,roundCount:plan.blocks.filter(b=>b.type==='round').length},'rehearsal',location.origin);}}catch{}
 g??=makeGame(defaults,'rehearsal',location.origin);
 generateBooks(g,12,'milo-premiere-rehearsal');g.books.slice(0,4).forEach((b,i)=>Object.assign(b,{accountId:'demo-'+Math.floor(i/2),profileId:'demo-person-'+i,name:['Noor','Sam','Mila','Daan'][i],age:7+i}));return g;
}
export class StudioEngine{
 constructor(){
  this.listeners=new Set();this.production=localStorage.getItem('mf-production')==='vlampie'?'vlampie':'milo';this.isOutput=location.pathname==='/uitzending';this.clientId=(()=>{try{const key='mf-regie-client-id',saved=sessionStorage.getItem(key);if(saved)return saved;const id=crypto.randomUUID();sessionStorage.setItem(key,id);return id;}catch{return crypto.randomUUID();}})();this.game=rehearsal(this.production);this.demo=true;this.games=[];this.characters=ALL_CHARACTER_IDS.map(id=>({...CHARACTERS[id]}));this.characterRevision=0;this.settingsReady=false;this.apiStatus=null;this.voiceMode='browser';this.voicePhase='idle';this.notice='';this.error='';this.loading=true;this.working=false;this.selectedCharacter=this.game.plan.leadId||(this.production==='vlampie'?'vlampie':'milo');this.cohostId=this.game.plan.cohostId||null;this.selectedCue=0;this.theme='showtime';this.motion='idle';this.hostId=this.selectedCharacter;this.speakerId=this.hostId;this.guestId=null;this.camera='wide';this.previewCamera='host';this.movingCamera=true;this.cameraTransition='smooth';this.cameraDuration=1400;this.magic=null;this.caption='';this.voiceText='Hallo allemaal! Welkom op het Sterrenplein. Mijn hoge hoed staat klaar. Jullie ook?';this.outputEnabled=false;this.outputRouting=false;this.lastPublish=0;this.dirty=false;this.log=[];
  this.audio=createShowAudio();
  this.director=new ShowDirector({config:{title:this.game.title,brandId:this.production,voice:true,autoCamera:true},onEvent:e=>this.event(e)});this.director.brandId=this.production;this.director.theme=this.production==='vlampie'?this.theme:'magico';
  this.runner=new ShowRunner(this.director,{onChange:()=>this.emit(),onNotice:m=>this.notify(m)});this.runner.autoDraw=false;this.showCues=new ShowCueRuntime(this);
  this.runner.beforeBlock=async(index,goal)=>{if(index>=this.game.plan.blocks.length)return;if(this.demo)activateBlock(this.game,index,goal);else await this.post('activate',{blockIndex:index,goalIndex:goal});this.syncGame();};
  this.runner.beforeGoal=(index,goal)=>this.runner.beforeBlock(index,goal);
  this.runner.afterRound=()=>this.syncGame();
  this.director.requestPick=async()=>{if(this.demo){if(this.game.status!=='running'){this.game.status='running';activateBlock(this.game,this.game.plan.blocks.findIndex(b=>b.type==='round'));}return reserveBall(this.game);}const r=await this.post('reserve');return r.pending;};
  this.director.requestCommit=async token=>{if(this.demo){const commit=commitBall(this.game,token);this.syncGame();return commit;}const r=await this.post('commit',{token});this.syncGame();return r.commit;};
  this.voice=createOpenAIVoice({onState:phase=>{this.voicePhase=phase;this.emit();},onStart:(text,duration)=>{this.caption=text;this.speechDuration=duration;this.audio.duck(true);this.emit();},onEnd:()=>this.speechEnded(),onError:m=>this.speechFailed(m),getRemote:()=>this.bridge?.remote,canPlay:()=>!this.whispers?.playback||this.whispers.playbackAllowed()});
  this.bridge=new OutputBridge({isOutput:this.isOutput,getId:()=>this.clientId,getGame:()=>this.demo?null:this.game,getSnapshot:()=>this.stage(),getShow:()=>this.stage().show||null,showAudio:this.audio,receive:e=>this.receive(e),onLost:m=>{this.pause(true);this.fail(m);},onNotice:m=>this.notify(m)});
  if(!this.isOutput)this.whispers=new DirectorWhisperRuntime(this);
  this.gameAudioClock=new GameMotionClock();this._snapshot=this.snapshot();this.lastFrame=performance.now();this.timer=setInterval(()=>this.tick(),100);this.refreshTimer=setInterval(()=>this.refresh(),3500);if(!this.isOutput)this.load();
 }
 subscribe=fn=>{this.listeners.add(fn);return()=>this.listeners.delete(fn);};
 getSnapshot=()=>this._snapshot;
 snapshot(){return {whisper:this.whispers?.snapshot()||null,production:this.production,hostId:this.hostId,game:this.game,demo:this.demo,games:this.games,characters:this.characters,characterRevision:this.characterRevision,selectedCharacter:this.selectedCharacter,loading:this.loading,working:this.working,notice:this.notice,error:this.error,dirty:this.dirty,apiStatus:this.apiStatus,voiceMode:this.voiceMode,voicePhase:this.voicePhase,voiceText:this.voiceText,stage:this.stage(),runner:this.runner?.visual?.()||{},selectedCue:this.selectedCue,previewCamera:this.previewCamera,previewSceneId:this.previewSceneId||null,showRuntime:this.showRuntime?.status||null,outputConnected:!!this.bridge?.connected,outputRouting:this.outputRouting,autoDraw:this.runner?.autoDraw||false,log:this.log,now:Date.now(),settingsReady:this.settingsReady,drawHeld:!!this.game.state.drawHold||!!this.liveCalls?.drawHeld};}
 stage(){
  if(this.isOutput&&this.remoteStage){const remote={...this.remoteStage,...(this.remoteStage.voiceMode==='ai'&&this.remoteStage.outputRouting?{mouth:this.bridge?.meter()||0}:{})};return this.liveCalls?.stagePatch(this.calls?.stagePatch(remote)||remote)||remote;}
  const raw=this.director?.visual?.()||{},liveShow=this.showRuntime?.visual(raw)||raw,show=this.showCues?.holding?{...liveShow,scene:'host',age:this.showCues.active.elapsed,paused:this.showCues.paused}:liveShow;
  const base={production:this.production,gameId:this.demo?null:this.game.id,gameTitle:this.game.title,hostId:this.showCues?.active?.hostId||this.hostId,guestId:this.guestId,cohostId:this.cohostId&&this.cohostId!==(this.showCues?.active?.hostId||this.hostId)?this.cohostId:null,speakerId:this.showCues?.active?.hostId||this.speakerId,camera:this.camera,movingCamera:this.movingCamera,cameraTransition:this.cameraTransition,cameraDuration:this.cameraDuration,motion:this.motion,speaking:['playing','paused'].includes(this.voicePhase),speechActive:this.voicePhase==='playing'&&(this.voiceMode!=='browser'||!globalThis.speechSynthesis?.paused),voiceMode:this.voiceMode,outputRouting:this.outputRouting,mouth:this.voiceMode==='ai'&&!this.outputRouting?this.voice?.meter||0:undefined,caption:this.caption,lastNumber:this.game.state.lastCommit?.number??null,drawn:this.game.state.drawn,roundTitle:activeGoal(this.game)?.round?.title||'Welkom op het Sterrenplein',pattern:activeGoal(this.game)?.pattern,paused:this.showCues?.holding?this.showCues.paused:this.showRuntime?.holding?!!show.paused:!!this.director?.paused||!!this.director?.externalHold,magic:this.magic?{...this.magic,elapsed:(this.magic.elapsed||0)*1000}:null,theme:this.theme,show,characterSettings:this.characters,scene:show.scene,...(this.showCues?.visual()||{})};
  return this.liveCalls?.stagePatch(this.calls?.stagePatch(base)||base)||base;
 }
 enableWorkspace(){if(this.workspaceEnabled)return;this.workspaceEnabled=true;this.showRuntime=getShowRuntime(this);this.liveCalls??=createLiveCallRuntime(this);this.calls??=createCallRuntime(this,{legacyCalls:false});this.bridge.isVoiceBusy=()=>this.calls?.held||this.voicePhase!=='idle';this.emit();}
 previewScene(id){this.previewSceneId=id;getShowRuntime(this).previewScene(id);this.emit();}
 previewStage(){const base=this.stage();return {...base,camera:this.previewCamera||base.camera,movingCamera:false,cameraTransition:'cut',magic:null,showCue:null,movement:null,...(this.previewSceneId?{show:getShowRuntime(this).previewVisual(this.previewSceneId),scene:this.previewSceneId,paused:false,speaking:false,speechActive:false,caption:''}:{})};}
 async takeScene(id=this.previewSceneId){const camera=this.previewCamera;if(id)await getShowRuntime(this).scene(id);this.setCamera(camera);this.emit();this.bridge.sendLocal();}
 assertGameSwitchAvailable(){if(this.liveCalls?.active||this.liveCalls?.drawHeld||this.game.state.drawHold)throw Error('Rond eerst het belmoment af, bevestig de terugkeer en hervat de trekking voordat je van show of productie wisselt.');}
 assertTimelineAvailable(){if(this.showCues?.active)throw Error('Rond eerst het actieve showelement of gebaar af.');if(this.calls?.held||this.game.state.callId)throw Error('Rond eerst het belmoment af.');if(this.showRuntime?.holding)throw Error('Zet eerst de presentator terug live om het draaiboek of een trekking te bedienen.');}
 setMix(key,value){const levels={...this.bridge.mixer,[key]:Number(value)};getShowRuntime(this).mix(levels);this.emit();}

 emit(){this.whispers?.validateContext();this._snapshot=this.snapshot();for(const fn of this.listeners)fn();}
 notify(text){this.notice=text;this.error='';this.emit();}
 fail(text){this.error=text||'Dit lukte niet.';this.emit();}
 async task(fn,success){if(this.working)return;this.working=true;this.error='';this.emit();try{const r=await fn();if(success)this.notice=success;return r;}catch(e){this.fail(e.message);throw e;}finally{this.working=false;this.emit();}}
 async load(){const r=await Promise.allSettled([bingoApi('/games'),jsonFetch('/api/characters'),apiJSON('status')]);
  if(r[0].status==='fulfilled'){this.games=r[0].value.games;const found=this.games.filter(g=>(g.brandId||'vlampie')===this.production).sort((a,b)=>(a.status==='running'?-1:0)-(b.status==='running'?-1:0))[0];if(found){try{await this.selectGame(found.id);}catch(e){this.error=e.message;}}}
  else this.error=r[0].reason.message;
  if(r[1].status==='fulfilled'){this.characters=r[1].value.characters;this.characterRevision=r[1].value.revision;this.settingsReady=true;}else this.settingsError=r[1].reason.message;
  if(r[2].status==='fulfilled'){this.apiStatus=r[2].value;if(this.apiStatus.configured)this.voiceMode='ai';}this.loading=false;this.emit();
 }
 async refresh(){if(this.isOutput||this.demo||this.working||this.dirty||this.refreshing)return;this.refreshing=true;const id=this.game.id;try{const r=await bingoApi('/games/'+id);if(id!==this.game.id||!this.acceptGame(r.game))return;this.syncGame();if(this.game.state.window?.status==='open'){this.director.externalHold=true;this.camera='host';}else this.director.externalHold=false;this.emit();}catch(e){this.fail(e.message);}finally{this.refreshing=false;}}
 async recoverCallGame(id){if(this.liveCalls?.call?.gameId!==id||!this.liveCalls.active)throw Error('Deze show hoort niet bij het actieve belmoment.');if(this.dirty)throw Error('Sla eerst je wijzigingen op voordat je de belshow opent.');const r=await bingoApi('/games/'+id);if(this.liveCalls?.call?.gameId!==id)throw Error('Het belmoment is intussen gewijzigd.');this.stopSpeech();this.runner.stop();this.director.cancel();this.showRuntime?.returnToShow();this.acceptGame(r.game,true);this.demo=false;this.production=this.game.brandId==='vlampie'?'vlampie':'milo';this.hostId=this.game.plan.leadId||(this.production==='vlampie'?'vlampie':'milo');this.speakerId=this.hostId;this.syncGame();this.emit();}
 async selectGame(id){this.assertGameSwitchAvailable();if(this.dirty)throw Error('Sla eerst het draaiboek op.');const token=this.selectionToken=(this.selectionToken||0)+1;if(await this.stop()===false)throw Error('De huidige show kon niet veilig worden gepauzeerd.');const r=await bingoApi('/games/'+id);if(token!==this.selectionToken)return;this.acceptGame(r.game,true);this.demo=false;this.production=this.game.brandId==='vlampie'?'vlampie':'milo';this.hostId=this.game.plan.leadId||(this.production==='vlampie'?'vlampie':'milo');this.speakerId=this.hostId;this.selectedCharacter=this.hostId;this.syncGame();this.emit();}
 async openRehearsal(){this.assertGameSwitchAvailable();if(this.dirty)throw Error('Sla eerst je wijzigingen op voordat je de oefenstudio opent.');if(!this.demo&&this.game.status==='running'&&!this.game.state.paused)throw Error('Pauzeer eerst de opgeslagen show voordat je de oefenstudio opent.');await this.stop();this.demo=true;this.voiceMode='browser';this.game=rehearsal(this.production);this.hostId=this.game.plan.leadId||(this.production==='vlampie'?'vlampie':'milo');this.speakerId=this.hostId;this.guestId=null;this.magic=null;this.camera='wide';this.syncGame();this.notify('Oefenstudio geopend. Bellen en foutgevallen zijn hier een simulatie zonder providerverbinding.');}
 async productionSwitch(id){this.assertGameSwitchAvailable();if(this.dirty)throw Error('Sla eerst het draaiboek op.');if(await this.stop()===false)throw Error('De huidige show kon niet veilig worden gepauzeerd.');this.production=id;localStorage.setItem('mf-production',id);this.hostId=id==='vlampie'?'vlampie':'milo';this.speakerId=this.hostId;this.selectedCharacter=this.hostId;this.guestId=null;this.cohostId=null;this.magic=null;this.camera='wide';const found=this.games.find(g=>(g.brandId||'vlampie')===id);if(found)await this.selectGame(found.id);else {this.demo=true;this.game=rehearsal(id);this.hostId=this.game.plan.leadId||(id==='vlampie'?'vlampie':'milo');this.speakerId=this.hostId;this.selectedCharacter=this.hostId;this.syncGame();this.emit();}}
 acceptGame(game,select=false){if(!game)return false;if(!select&&(game.id!==this.game.id||Number(game.revision||0)<Number(this.game.revision||0)))return false;this.game=game;return true;}
 syncGame(){if(!this.director)return;this.director.drawBlocked=!!this.game.state.drawHold||!!this.liveCalls?.drawHeld;if(globalThis.document?.body)document.body.dataset.brand=this.production;const presentation=showPresentation(this.game);this.director.configure({rules:presentation.rules,transition:presentation.profile.transition,transitionMs:presentation.profile.transitionMs});this.cohostId=this.game.plan.cohostId||null;this.director.brandId=this.production;this.director.theme=this.production==='vlampie'?this.theme:'magico';this.director.drawn=[...this.game.state.drawn];this.director.number=this.game.state.lastCommit?.number??null;this.director.configure({title:this.game.title,brandId:this.production,speakerId:this.speakerId});}
 async post(action,body={}){const id=this.game.id,r=await bingoApi('/games/'+id+(action?'/'+action:''),{method:'POST',body:{...body,regieId:this.clientId}});if(r.game&&id===this.game.id)this.acceptGame(r.game);return r;}
 async createShow(title,date,brand=this.production,source=null){this.assertGameSwitchAvailable();const prepared=source?preparation({...source,title,date,brandId:brand}):null;return this.task(async()=>{if(await this.stop()===false)throw Error('De huidige show kon niet veilig worden gepauzeerd.');const roundCount=prepared?.roundCount||4,r=await bingoApi('/games',{method:'POST',body:{title,date,brandId:brand,roundCount,...(prepared||{})}});let game=r.game;if(prepared){const {plan,settings}=prepared;game=(await bingoApi('/games/'+game.id,{method:'PUT',body:{title,date,plan,settings}})).game;}this.acceptGame(game,true);this.demo=false;this.production=brand;this.dirty=false;this.games=[{...game,bookCount:0,roundCount},...this.games];this.hostId=game.plan.leadId||(brand==='vlampie'?'vlampie':'milo');this.speakerId=this.hostId;this.syncGame();},'Je nieuwe show is opgeslagen.');}
 async savePremiere(){return this.createShow(this.game.title,this.game.date,this.production,{plan:structuredClone(this.game.plan),settings:structuredClone(this.game.settings)});}
 async savePlan(){const issues=planIssues(normalizePlan(this.game.plan));if(issues.length)throw Error(issues[0]);if(this.demo){const saved=preparation(this.game);localStorage.setItem('mf-rehearsal-plan-'+this.production,JSON.stringify(saved));this.game.plan=saved.plan;this.game.settings=saved.settings;this.dirty=false;this.notify('Oefendraaiboek op dit apparaat opgeslagen.');return;}return this.task(async()=>{const r=await bingoApi('/games/'+this.game.id,{method:'PUT',body:{plan:this.game.plan,title:this.game.title,date:this.game.date,settings:this.game.settings}});this.game=r.game;this.dirty=false;},'Draaiboek opgeslagen.');}
 editPlan(mutator){if(this.game.status!=='draft'&&!this.demo)throw Error('De show is gestart; gebruik de live regie.');if(this.runner.active)throw Error('Stop eerst de repetitie voordat je het draaiboek bewerkt.');this.game=structuredClone(this.game);mutator(this.game.plan);this.dirty=true;this.emit();}
 addBlock(type){if(type==='show'&&this.production!=='milo')throw Error('Deze showelementen horen bij Milo & Friends.');this.editPlan(plan=>{const b=createBlock(type,{...plan,leadId:this.hostId},this.production);b.speakerId=type==='magic'?'milo':this.hostId;if(type==='magic')b.magicId='star-hat';plan.blocks.splice(Math.max(0,plan.blocks.length-1),0,b);this.selectedCue=plan.blocks.indexOf(b);});}
 async generate(count,mode='color'){return this.task(async()=>{if(this.demo){generateBooks(this.game,count,crypto.randomUUID(),Date.now(),{mode});return;}const r=await this.post('generate',{count,printMode:mode});this.game=r.game;},this.demo?'Unieke oefenboekjes gegenereerd.':'Unieke boekjes en printbatch aangemaakt.');}
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
 async start(options={}){
  this.assertTimelineAvailable();
  if(this.dirty)throw Error('Sla eerst je draaiboek op.');if(this.runner.active)return;
  if(!this.demo&&(this.voiceMode!=='ai'||!this.apiStatus?.configured))throw Error('Stel eerst de globale OpenAI-koppeling in en kies de eigen personagestem. De browserstem is alleen voor repetities.');
  if(!this.demo&&this.game.status==='finished')throw Error('Deze show is afgelopen. Maak een nieuwe show om opnieuw te spelen.');
  if(this.game.state.window?.status==='open'||this.game.state.resultId)throw Error('Rond eerst het meldvenster of de uitslag af voordat je het draaiboek hervat.');
  this.error='';if(await this.stopRequest===false)throw Error('De vorige stop is nog niet bevestigd. Controleer de verbinding.');await this.audio.unlock();const resume=this.game.status==='running';
  if(this.demo){this.game.status='running';this.game.state.paused=false;}else {if(this.game.status==='draft')await this.post('start');if(this.game.state.paused)await this.post('pause',{paused:false});}
  let index=Number.isInteger(options.blockIndex)?options.blockIndex:resume?Math.max(0,this.game.state.blockIndex):0,goal=Number.isInteger(options.goalIndex)?options.goalIndex:resume?this.game.state.goalIndex||0:0;
  if(resume&&!Number.isInteger(options.blockIndex)&&this.game.state.goalWon){const block=this.game.plan.blocks[index];if(block?.type==='round'&&goal+1<block.goals.length)goal++;else {index++;goal=0;}}
  this.hostId=this.game.plan.leadId||(this.production==='vlampie'?'vlampie':'milo');this.speakerId=this.hostId;this.cohostId=this.game.plan.cohostId||null;this.guestId=null;this.magic=null;this.runner.start(this.game.plan,{blockIndex:index,goalIndex:goal});this.log.unshift({at:Date.now(),text:(resume?'Draaiboek hervat: ':'Draaiboek gestart: ')+this.game.title});this.emit();
 }
 async cue(index){this.assertTimelineAvailable();if(this.game.state.window?.status==='open'||this.game.state.resultId)throw Error('Rond eerst het meldvenster of de uitslag af.');if(this.director.busy&&this.director.flow?.kind==='draw')throw Error('Rond eerst de lopende trekking af.');if(!this.runner.active){await this.start({blockIndex:index,goalIndex:0});return;}this.stopSpeech();this.runner.enter(index);this.emit();}
 nextCue(){this.assertTimelineAvailable();if(!this.runner.active)throw Error('Start eerst het draaiboek.');if(this.game.state.window?.status==='open'||this.game.state.resultId)throw Error('Rond eerst het meldvenster of de uitslag af.');this.stopSpeech();this.runner.next();this.emit();}
 async draw(){if(this.game.state.drawHold||this.liveCalls?.drawHeld)throw Error('De trekking is geblokkeerd voor een belmoment. Bevestig de terugkeer en hervat vanuit Publiek & bellen.');this.assertTimelineAvailable();if(this.game.state.window?.status==='open'||this.game.state.resultId)throw Error('Rond eerst het meldvenster of de uitslag af.');if(!activeGoal(this.game)||this.game.state.phase!=='running'||this.game.state.paused||this.game.state.goalWon||this.runner.block?.type!=='round'||this.runner.phase!=='drawing')throw Error('Zet eerst een bingoronde live vanuit het draaiboek.');if(!this.director.draw())throw Error('De regie wacht nog op de vorige cue of uitspraak.');this.emit();}
 async pause(value=!this.stage().paused){
  if(this.calls?.held){this.fail('Rond eerst het belmoment af voordat je het draaiboek hervat of pauzeert.');return false;}
  if(this.showCues?.holding){this.showCues.pause(value);if(value){this.audio.pause();this.bridge.controls('pause');}else{this.audio.resume();this.bridge.controls('resume');}this.emit();this.bridge.sendLocal();return true;}
  if(this.showRuntime?.holding){this.showRuntime.manual.paused=!!value;if(value){this.voice.pause();this.audio.pause();globalThis.speechSynthesis?.pause();}else{this.voice.resume();this.audio.resume();globalThis.speechSynthesis?.resume();}this.emit();this.bridge.sendLocal();return true;}

  if(value){this.director.pause();this.voice.pause();globalThis.speechSynthesis?.pause();this.audio.pause();if(this.demo)this.game.state.paused=true;}
  else if(this.game.state.window?.status==='open'||this.game.state.resultId||this.director.externalHold){this.fail('Het meldvenster of de uitslag houdt de show nog stil.');return false;}
  const prior=this.pauseRequest;
  const operation=(async()=>{try{await prior;if(!this.demo&&this.game.status==='running')await this.post('pause',{paused:value});if(!value){if(this.demo)this.game.state.paused=false;if(this.runner.voiceFailed&&this.failedSpeech){const failed=this.failedSpeech;this.failedSpeech=null;this.runner.voiceFailed=false;if(this.director.flow)this.director.flow.age=0;this.speak(failed.text,failed.id,failed.mode,failed.planned);if(this.failedSpeech)return false;}this.director.resume();this.voice.resume();globalThis.speechSynthesis?.resume();this.audio.resume();}this.emit();return true;}catch(e){this.director.pause();this.fail(e.message);return false;}})();
  this.pauseRequest=operation;this.emit();return operation;
 }
 stopSpeech({replacement=false,whisperInternal=false,silent=false}={}){if(!whisperInternal)this.whispers?.speechStopped({replacement});this.speechToken=(this.speechToken||0)+1;this.voice.stop();globalThis.speechSynthesis?.cancel();this.voicePhase='idle';this.caption='';this.currentSpeech=null;this.failedSpeech=null;this.director.narrationHold=false;this.audio.duck(false);if(!silent)this.emit();}
 speechEnded(){this.voicePhase='idle';this.caption='';this.currentSpeech=null;this.director.narrationHold=false;this.audio.duck(false);this.whispers?.speechEnded();this.emit();}
 speechFailed(message){const failed=this.currentSpeech,privateReaction=this.whispers?.speechFailed(message);this.speechEnded();this.failedSpeech=privateReaction?null:failed;this.runner.voiceFailed=!privateReaction&&!!failed;this.director.pause();this.fail(message);}
 speak(text,id=this.speakerId,mode=this.voiceMode,planned=false){
  if(this.liveCalls?.onAir)throw Error('De live presentator voert nu het gesprek. Rond dit eerst af.');if(!text?.trim())return;this.stopSpeech({replacement:true});this.speakerId=id;this.caption=text;this.voicePhase='loading';this.currentSpeech={text,id,mode,planned};const token=this.speechToken;
  // Manual announcements hold the timeline, including a spin that has no own speech.
  this.director.narrationHold=!planned;this.emit();const c=this.characters.find(c=>c.id===id)||CHARACTERS[id]||CHARACTERS.milo;
  if(!this.demo&&this.game.status==='running'&&mode!=='ai'){this.speechFailed('De browserstem is alleen voor repetities. Kies de eigen personagestem voor de echte show.');return;}
  if(mode==='ai'){if(!this.apiStatus?.configured){this.speechFailed('Stel eerst de globale OpenAI-koppeling in. Met de oefenstem kun je lokaal repeteren.');return;}this.voice.speak(text,c.speed,{characterId:id,...(!this.demo?{gameId:this.game.id}:{brandId:this.production})});}
  else {
   if(!globalThis.speechSynthesis){this.speechFailed('Deze browser heeft geen oefenstem. Stel de globale OpenAI-koppeling in.');return;}
   const u=new SpeechSynthesisUtterance(text);u.lang='nl-NL';u.rate=c.speed;u.pitch=['stella','pip','bella'].includes(id)?1.12:['bruno','lola','piko'].includes(id)?.88:1;u.voice=globalThis.speechSynthesis.getVoices().find(v=>v.lang.startsWith('nl'))||null;
   u.onpause=()=>{if(token===this.speechToken){this.voicePhase='paused';this.emit();}};u.onresume=()=>{if(token===this.speechToken){this.voicePhase='playing';this.emit();}};u.onstart=()=>{if(token!==this.speechToken)return;this.voicePhase='playing';this.audio.duck(true);this.emit();};u.onend=()=>{if(token===this.speechToken)this.speechEnded();};u.onerror=e=>{if(token!==this.speechToken)return;if(e.error!=='canceled'&&e.error!=='interrupted')this.speechFailed('De oefenstem kon niet starten. Hervat probeert dezelfde uitspraak opnieuw.');};globalThis.speechSynthesis.speak(u);
  }
 }
 magicMoment(id){return this.showCues.magic(id);}
 async demoBingo(){if(!this.demo)throw Error('Echte spelers melden via de familie-app.');const b=this.game.books.find(b=>b.accountId);const f=this.demoFamily??=familyDefault();f.profiles=[{name:b.name}];beginBingo(this.game,f,b.accountId,crypto.randomUUID());claimBook(this.game,f,b.accountId,b.id);this.director.externalHold=true;this.notify('Oefenmelding ontvangen; de serverregels bepalen of de kaart compleet is.');}
 async resultNext(){
  if(this.resultBusy||!this.game.state.resultId)return;const gameId=this.game.id,stopRevision=this.stopRevision||0,r=this.game.results.find(r=>r.id===this.game.state.resultId);if(!r)return;this.resultBusy=true;
  try{
   let applied=!r.acknowledged;
   if(this.demo){r.acknowledged=true;this.game.state.resultId=null;this.game.state.phase=r.type==='bingo'?'running':r.returnPhase||'interlude';}
   else {const result=await this.post('finish-result',{resultId:r.id});applied=result.applied!==false;}
   if(gameId!==this.game.id||stopRevision!==(this.stopRevision||0))return;
   // A valid bingo invalidates the unfinished visual draw, not its authoritative committed history.
   this.director.cancel(false);this.director.externalHold=false;this.syncGame();if(applied&&r.type==='bingo')this.director.approvals++;
   if(applied){this.speak('Bingo bevestigd! Gefeliciteerd '+r.winner.name+'! Een groot applaus voor jou.');this.motion='cheer';this.audio.cue('win');}this.emit();
  }finally{this.resultBusy=false;}
 }
 async routeOutput(enabled){await this.bridge.route(enabled);this.outputRouting=enabled;this.emit();}
 stop(){
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
 tick(){const now=performance.now(),dt=Math.min(.35,(now-this.lastFrame)/1000);this.lastFrame=now;if(this.isOutput){this.audio?.tickGame?.(this.gameAudioClock.read(this.stage().show,now));this.emit();return;}this.showRuntime?.tick(dt);this.audio?.tickGame?.(this.gameAudioClock.read(this.stage().show,now));if(this.demo&&this.game.state.window?.status==='open'&&Date.now()>=this.game.state.window.endsAt){settleWindow(this.game);this.director.externalHold=!!this.game.state.resultId;}
  this.director.drawBlocked=!!this.game.state.drawHold||!!this.liveCalls?.drawHeld;const hold=this.game.state.window?.status==='open'||!!this.game.state.resultId;this.director.externalHold=hold;this.whispers?.tick();const cueWasHolding=this.showCues?.holding;this.showCues?.tick(dt);if(!hold&&!this.showRuntime?.holding&&!this.calls?.held&&!cueWasHolding){this.director.tick(dt,{voiceBusy:this.voicePhase!=='idle'});this.runner.tick(dt);}if(this.magic&&!this.magic.manual&&!this.director.paused&&!hold){this.magic.elapsed=(this.magic.elapsed||0)+dt;}if(now-(this.lastEmit||0)>240){this.lastEmit=now;this.emit();}if(!this.demo&&this.game.status==='running'&&now-(this.lastHeartbeat||0)>5000){this.lastHeartbeat=now;this.post('heartbeat').catch(e=>{this.director.pause();this.fail(e.message);});}
 }
 dispose(){this.whispers?.dispose();this.showCues?.reset();this.liveCalls?.dispose();this.calls?.dispose();this.showRuntime?.dispose();clearInterval(this.timer);clearInterval(this.refreshTimer);this.voice.stop();this.bridge.dispose();this.audio.dispose();}
}
