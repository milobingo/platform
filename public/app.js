import {initStudioWorkspace} from './studio-workspace.js?v=37';
import {createBrandReserve} from './brand-reserve.js?v=36';
import {applyBrand,captureStaticBranding,mountBrandSwitch,currentBrand} from './brand-ui.js?v=37';
import {showBrand,brandProfile,brandId,brandDefaults} from './show-brands.js?v=36';
import {bt} from './brand-ui.js?v=37';
import {CallHost} from './call-host.js?v=36';
import {CallOutput} from './call-output.js?v=36';
import {ON_AIR} from './call-common.js?v=36';
import {OutputBridge} from './output-bridge.js?v=36';
import {productionSettings} from './production-model.js?v=36';
import {PresentationStudio} from './presentation-studio.js?v=36';
import {PresentationQueue} from './presentation-queue.js?v=36';
import {defaultPresentation,showPresentation,fillRule} from './presentation-model.js?v=36';
import {GameMotionClock} from './bingo-motion.js?v=36';
import {VlampieRig,MOTIONS,EXPRESSIONS,durations,poseAt} from './rig.js?v=36';
import {createOpenAIVoice,apiJSON} from './openai-voice.js?v=36';
import {splitCaptions,captionAt} from './speech-captions.js';
import {speechMouthAt} from './speech-mouth.js?v=36';
import {createMouthTexture} from './mouth-texture.js?v=36';
import {createBlinkTexture,blinkAt} from './blink-texture.js?v=36';
import {ShowDirector,SCENES,SCENE_NAMES,DEFAULT_SHOW} from './show-director.js?v=36';
import {createShowAudio} from './show-audio.js?v=36';
import {initDashboard,setConsoleView} from './dashboard.js?v=37';
import {createNumberGrid} from './number-grid.js?v=36';
import {ShowPlanner} from './show-planner.js?v=37';
import {BingoHost} from './bingo-host.js?v=37';
import {LiveChat} from './live-chat.js?v=36';
import {ShowRunner} from './show-runner.js?v=36';
import {planIssues} from './plan-model.js?v=36';
const $=q=>document.querySelector(q),$$=q=>[...document.querySelectorAll(q)];
captureStaticBranding();
const query=new URLSearchParams(location.search),isShow=['show','overlay'].includes(query.get('view')),isOverlay=query.get('view')==='overlay';
document.body.classList.toggle('show-mode',isShow);document.body.classList.toggle('overlay-mode',isOverlay);
if(isShow)document.title=isOverlay?bt('Vlampie — Transparante animatie'):bt('Vlampie — Showweergave');
const labels={idle:'Rustig',wave:'Zwaaien',welcome:'Welkom',cheer:'Juichen',think:'Nadenken',bow:'Bedanken',look:'Naar de molen kijken',point:'Aanwijzen'};
const actionLabels={idle:bt('Vlampie staat klaar'),wave:'Een groet aan het publiek',welcome:'Welkom bij de show',cheer:'Dat vieren we samen',think:bt('Vlampie denkt even na'),bow:'Een buiging voor het publiek',look:'Welke bal komt eraan?',point:'Kijk naar het bingobord'};
const lines={intro:bt('Hallo allemaal! Ik ben Vlampie. Zijn jullie klaar voor een gezellige bingoavond?'),bingo:'Bingo! Wat spannend! We pauzeren even, zodat de regie de kaart kan controleren.',sint:'Hallo lieve allemaal! Welkom op onze gezellige pakjesavond! Kijk eens naar al die cadeautjes. En wie heeft er stiekem kruidnoten gestrooid? Pak je bingokaart erbij, we gaan beginnen!',thanks:'Bedankt voor het meedoen! Jullie hebben er een fantastische avond van gemaakt.'};
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let prefs={};try{prefs=JSON.parse(localStorage.getItem('vlampie-preferences')||'{}')}catch{}
const state={motion:'idle',motionStart:performance.now(),energy:Number.isFinite(prefs.energy)?Math.max(0,Math.min(100,prefs.energy)):65,idle:typeof prefs.idle==='boolean'?prefs.idle:!reduced,expression:'neutral',background:prefs.sceneVersion===6&&['studio','blue','transparent'].includes(prefs.background)?prefs.background:'studio',speed:Number.isFinite(prefs.speed)?Math.max(.7,Math.min(1.3,prefs.speed)):1,speaking:false,speechStart:0,speechDuration:0,speechText:'',word:'',lastBoundary:0};
let voiceProvider=prefs.voiceProvider==='browser'?'browser':'openai',voicePhase='idle',openaiConfigured=false,openaiChecking=false,settingsRevision=null,settingsBusy=false,settingsCanManage=false,chatController=null,chatToken=0,lastSpeechClock=0;
let outputBridge=null,lobbyKey='',callHost=null,callOutput=null,callRestore=null;
let hostChat=null,presentationStudio=null,narration=null,speechCompletion=null,speechKind='critical';
function currentProfile(){const g=bingoHost?.game,doc=presentationStudio?.document||defaultPresentation();return brandProfile(g&&g.status!=='draft'?showPresentation(g).profile:doc.profiles.find(p=>p.id===g?.presentationSelection?.profileId)||presentationStudio?.profile||doc.profiles[0],g||{brandId:state.brandId});}
function applyPresentation(){if(!director)return;const g=bingoHost?.game,p=currentProfile(),doc=presentationStudio?.document||defaultPresentation(),ids=g?.presentationSelection?.ruleIds;const rules=g&&g.status!=='draft'?showPresentation(g).rules:doc.rules.filter(r=>ids?ids.includes(r.id):r.selected).map(r=>({...r,text:fillRule(r.text,g?.settings)}));director.brandId=p.brandId;director.configure({brandId:p.brandId,rules,transition:p.transition,transitionMs:p.transitionMs,comments:p.mode!=='off'&&p.showEvents});state.speed=p.speed;state.energy=p.enthusiasm;if(!worldBusy&&(state.brandId!==p.brandId||state.theme!==p.theme))void chooseWorld(p.brandId,{persist:false,theme:p.theme});narration?.render();}

let showPlanner=null,showRunner=null,bingoHost=null,startingPrepared=false,preparedStartToken=0;
let dashboard=null,numberGrid=null,director=null,previewStudio=null,previewReady=false,previewChosenAt=performance.now(),lastPreviewFrame=0,showReceivedAt=performance.now(),showTimer=null,lastShowTick=performance.now(),lastShowBroadcast=0,showStartedAt=0,pausedMotionAt=0,pausedSpeechElapsed=0,activeSpeechProvider='browser';
const showAudio=createShowAudio();
let rig3D=null,threeError=false,themeLoading=false,themeChoice=0;
const reserveWorlds=new Map();
async function prepareReserve(identity){const b=showBrand(identity);if(b.id==='vlampie')return;if(!reserveWorlds.has(b.id)){const promise=createBrandReserve(b.id,{loadImage,canvasFactory:makeCanvas}).catch(e=>{reserveWorlds.delete(b.id);throw e;});reserveWorlds.set(b.id,promise);}const result=await reserveWorlds.get(b.id);reserveWorlds.set(b.id,result);return result;}
let rig=null,ready=false,animationFrame=0,lastTime=performance.now(),elapsedClock=0,blinkUntil=0,nextBlink=2.6,speechToken=0,speechWatchdog=null,demoTimers=[],demoRunning=false,captionTimer,toastTimer,voices=[],stopped=false;
Object.assign(state,{brandId:brandId(prefs.brandId||'rocco'),theme:prefs.brandId==='vlampie'?(prefs.festiveVersion===13&&prefs.theme==='showtime'?'showtime':'sinterklaas'):showBrand(prefs.brandId||'rocco').theme,mode:'3d',clip:'',camera:'wide',appearance:prefs.appearance==='studio'?'studio':'original',presenter:'illustrated',hostSpot:'front',effects:prefs.effects!==false,lightShow:typeof prefs.lightShow==='boolean'?prefs.lightShow:!reduced,bingoNumber:null,bingoPending:null,bingoElapsed:1000,bingoDrawn:[]});
applyBrand(state.brandId);
state.show={scene:'standby',age:0,paused:false,...DEFAULT_SHOW};
state.lookAt='camera';
const canvas=$('#puppet'),ctx=canvas.getContext('2d',{alpha:true});
let cw=600,ch=600,dpr=1;
const makeCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
let channel=null;try{channel=new BroadcastChannel('vlampie-studio-v1')}catch{}
const savePrefs=()=>{if(isShow)return;try{localStorage.setItem('vlampie-preferences',JSON.stringify({brandId:state.brandId,theme:state.theme,festiveVersion:13,voiceProvider,energy:state.energy,idle:state.idle,background:state.background,speed:state.speed,mode:state.mode,appearance:state.appearance,modelVersion:4,sceneVersion:6,effects:state.effects,lightShow:state.lightShow,show:director?{...director.config,volume:Number($('#show-volume').value)}:prefs.show}))}catch{}};
const emit=(kind,payload)=>{if(!isShow)channel?.postMessage({kind,payload,sentAt:Date.now()})};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const openaiVoice=isShow?null:createOpenAIVoice({getRemote:()=>outputBridge?.remote,
 onState:phase=>{voicePhase=phase;if(state.speaking&&['playing','paused'].includes(phase)){state.speechPaused=phase==='paused';emit('speech-clock',{elapsed:openaiVoice.elapsed,paused:state.speechPaused});}updateUI();if(phase==='loading')$('#speech-feedback').textContent='Ballad maakt de uitspraak…';if(phase==='ready')$('#speech-feedback').textContent='De stem is klaar. Tik op Stem afspelen om geluid toe te staan.';if(phase==='paused')$('#speech-feedback').textContent='Het geluid is onderbroken. Tik op Stem hervatten om verder te gaan.';},
 onStart:(text,duration)=>{startVisualSpeech(text,duration);$('#speech-feedback').textContent='Ballad spreekt. De mond volgt de tekst en de afspeelduur.';},
 onEnd:()=>{stopSpeech(true,true);$('#speech-feedback').textContent='Klaar. Ballad staat weer voor je klaar.';},
 onError:message=>{const critical=speechKind!=='optional';stopSpeech();$('#speech-feedback').textContent=message;if(critical&&showRunner?.active&&director.scene!=='checking'){showRunner.voiceFailed=true;director.pause();toast(message+' De show is gepauzeerd. Hervat probeert deze uitspraak opnieuw.');}else toast(message);}
});
function speechHint(){return voiceProvider==='openai'?'Ballad spreekt enthousiast Nederlands. De mond volgt de tekst en de afspeelduur.':'Je browser verzorgt de stem; de mondbeweging volgt de tekst.';}
async function checkOpenAI(test=false){
 if(isShow||openaiChecking||settingsBusy)return;openaiChecking=true;$('#openai-test').disabled=true;$('#api-key-save').disabled=true;$('#api-key-remove').disabled=true;$('#openai-status').textContent=test?'OpenAI testen…':'Verbinding controleren…';
 try{
  const status=await apiJSON('status',undefined,AbortSignal.timeout(12000));openaiConfigured=status.configured===true;settingsRevision=status.revision??null;settingsCanManage=status.canManage===true;$('#api-key-remove').hidden=!openaiConfigured;
  $('.openai-status-row').dataset.connected='false';
  if(!openaiConfigured){$('#openai-status').textContent='API-sleutel nog niet ingesteld';$('#openai-help').textContent='Voer je sleutel in bij API-instellingen en kies Opslaan en testen.';$('#api-settings').open=true;return;}
  $('#openai-help').textContent='Ballad · enthousiast Nederlands. De sleutel is veilig op de server ingesteld.';
  if(test){await apiJSON('test',{},AbortSignal.timeout(20000));$('#openai-status').textContent='OpenAI bereikbaar';$('.openai-status-row').dataset.connected='true';toast('Verbinding gelukt. Probeer nu een korte uitspraak met Ballad.');}
  else $('#openai-status').textContent='Sleutel ingesteld · Ballad staat klaar';
 }catch(error){$('#openai-status').textContent='Verbinding niet gelukt';$('#openai-help').textContent=error.message;}
 finally{openaiChecking=false;updateShowUI();$('#openai-test').disabled=false;$('#api-key-save').disabled=!settingsCanManage;$('#api-key-remove').disabled=false;}
}
async function saveAPIKey(event){
 event.preventDefault();if(isShow||settingsBusy||openaiChecking||!settingsCanManage)return;
 const key=$('#api-key').value.trim();if(!key)return;await changeAPIKey('save',key);
}
async function changeAPIKey(action,key=''){
 if(isShow||settingsBusy||openaiChecking||!settingsCanManage)return;
 if(action==='remove')stopAll();
 settingsBusy=true;$('#openai-test').disabled=true;$('#api-key-save').disabled=true;$('#api-key-remove').disabled=true;$('#api-key-form').setAttribute('aria-busy','true');$('#api-key-feedback').textContent=action==='save'?'Sleutel testen en veilig opslaan…':'Koppeling verwijderen…';
 try{
  const data=await apiJSON('settings',{action,...(action==='save'?{key}:{}),revision:settingsRevision},AbortSignal.timeout(55000));
  $('#api-key').value='';settingsRevision=data.revision;openaiConfigured=data.configured===true;$('#api-key-remove').hidden=!openaiConfigured;$('#api-key-feedback').textContent=data.message;
  $('#openai-status').textContent=openaiConfigured?'Sleutel getest en opgeslagen':'API-sleutel nog niet ingesteld';$('.openai-status-row').dataset.connected=String(openaiConfigured);
  $('#openai-help').textContent=openaiConfigured?'Ballad · enthousiast Nederlands. Je sleutel is versleuteld op de server bewaard.':'Voer je sleutel in bij API-instellingen en kies Opslaan en testen.';
  if(openaiConfigured){voiceProvider='openai';savePrefs();updateUI();toast('De koppeling staat aan. Probeer nu Ballad.');}
 }catch(error){$('#api-key-feedback').textContent=error.message;}
 finally{settingsBusy=false;$('#openai-test').disabled=false;$('#api-key-save').disabled=!settingsCanManage;$('#api-key-remove').disabled=false;$('#api-key-form').setAttribute('aria-busy','false');}
}

function mountLiveChat(page){
 if(isShow)return;
 const chat=$('#regie-live-chat'),destination=page==='chat'?$('#chat-page-live'):$('.regie-broadcast');
 if(chat&&destination&&chat.parentElement!==destination){destination.prepend(chat);requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));}
}
function prepareLiveChatReply(message){
 if(isShow||!message?.text||message.deleted)return;
 setConsoleView('vlampie');location.hash='regie';void narration.prepare({messageId:message.id}).catch(e=>toast(e.message));
}

function cancelChat(){chatToken++;chatController?.abort();chatController=null;$('#ai-chat-submit').disabled=false;$('#ai-chat-submit').textContent='Maak een reactie';}
async function generateChatReply(event){
 event.preventDefault();if(isShow)return;
 const message=$('#ai-chat-message').value.trim(),name=$('#ai-chat-name').value.trim();if(!message)return;
 cancelChat();const token=chatToken;chatController=new AbortController();$('#ai-chat-submit').disabled=true;$('#ai-chat-submit').textContent=bt('Vlampie denkt na…');$('#ai-chat-status').textContent='Reactie wordt gemaakt…';
 try{
  await narration.prepare({message,name});if(token!==chatToken)return;$('#ai-chat-status').textContent=bt('De reactie staat klaar bij Vlampie in de regiekamer. Keur hem goed om uit te zenden.');setConsoleView('vlampie');location.hash='regie';
 }catch(error){if(token===chatToken&&error.name!=='AbortError')$('#ai-chat-status').textContent=error.message;}
 finally{if(token===chatToken){chatController=null;$('#ai-chat-submit').disabled=false;$('#ai-chat-submit').textContent='Maak een reactie';}}
}

function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3500)}
function caption(text,kicker=bt('VLAMPIE'),duration=4500){clearTimeout(captionTimer);$('#caption-text').textContent=text;$('#caption-kicker').textContent=kicker;$('#stage-caption').classList.add('visible');if(duration>0)captionTimer=setTimeout(()=>$('#stage-caption').classList.remove('visible'),duration)}
function hideCaption(){clearTimeout(captionTimer);$('#stage-caption').classList.remove('visible')}
function updateUI(){
 $$('.theme-picker button').forEach(b=>{const active=b.dataset.theme===state.theme;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));b.disabled=!rig3D?.character;});
 $('#theme-status').textContent=themeLoading?'Decor wordt klaargezet…':state.theme==='sinterklaas'?'Pakjesavond in de studio':showBrand(state.brandId).studio;
 $('#theme-picker').setAttribute('aria-busy',String(themeLoading));
 $('#speech-preview').disabled=!rig3D?.character||threeError;
 if(rig3D?.effectsAvailable===false)state.effects=false;
 ready=state.mode==='3d'?!!rig3D?.character&&!rig3D.contextLost&&!rig3D.failed:!!rig;
 document.body.dataset.renderer=state.mode;
 $('#stage').dataset.renderer=state.mode;$('#stage').dataset.camera=state.camera;$('#stage').dataset.showScene=state.show?.scene||'standby';
 $('#puppet').hidden=state.mode!=='2d';$('#puppet-3d').hidden=state.mode!=='3d';
 $('#loading').hidden=ready;
 $$('.mode-picker button').forEach(b=>{const a=b.dataset.presenter?state.mode==='3d'&&state.presenter===b.dataset.presenter:b.dataset.renderer===state.mode;b.classList.toggle('active',a);b.setAttribute('aria-pressed',String(a));if(b.dataset.presenter)b.disabled=threeError||!rig3D?.illustrated;});
 $('#model-info').textContent=state.mode==='3d'?(state.presenter==='illustrated'?'Premium studio · 2,5D':'Meshy-model · 3D-presentator'):bt('Reservebeeld van Vlampie');
 $('#theme-toolbar').hidden=state.mode!=='3d'||state.brandId!=='vlampie';$('#camera-toolbar').hidden=state.mode!=='3d';$('#studio-controls').hidden=state.mode!=='3d';$('#appearance-toolbar').hidden=state.mode!=='3d'||state.presenter==='illustrated';$('#imported-actions').hidden=state.mode!=='3d'||state.presenter==='illustrated';
 $('#face-note').hidden=false;$('#face-note').textContent=state.mode==='2d'?'Reservebeeld met een rustige beweging.':state.presenter==='illustrated'?(rig3D?.mouthAvailable?bt(state.brandId==='vlampie'?'Vlampie knippert, kijkt, wijst en beweegt zijn mond mee tijdens het spreken.':'Vlampie beweegt zijn mond tijdens het spreken en maakt vloeiende gebaren.'):'De spreekmond kon niet laden. Ververs de pagina om het opnieuw te proberen.'):'Dit model beweegt met zijn lichaam, armen en hoofd. Mond en ogen zijn nog niet apart geanimeerd.';$('.expression-picker').hidden=true;
 $('#idle-help').textContent=state.mode==='3d'?'Ademhalen en zacht meebewegen':'Ademhalen en zacht meebewegen';
 $$('[data-clip]').forEach(b=>{const a=b.dataset.clip===state.clip;b.classList.toggle('active',a);b.setAttribute('aria-pressed',String(a));b.disabled=!ready||!!b.dataset.clip&&!rig3D?.character?.actions[b.dataset.clip];});
 $('#clip-status').textContent=state.clip?(stopped?'Gepauzeerd: ': 'Speelt: ')+(state.clip==='Walking'?'lopen':'rennen')+' · op de plaats':'Lopen en rennen spelen op de plaats.';
 $$('[data-camera]').forEach(b=>{const a=b.dataset.camera===state.camera;b.classList.toggle('active',a);b.setAttribute('aria-pressed',String(a));});
 rig3D?.setBackground(isOverlay?'transparent':state.background);
 rig3D?.setAppearance(state.appearance);rig3D?.setEffects(state.effects);rig3D?.setHostSpot(state.hostSpot);updateStudioUI();
 $$('[data-appearance]').forEach(b=>{const a=b.dataset.appearance===state.appearance;b.classList.toggle('active',a);b.setAttribute('aria-pressed',String(a));});

 $$('[data-motion]').forEach(b=>{const a=b.dataset.motion===state.motion;b.classList.toggle('active',a);b.setAttribute('aria-pressed',String(a))});
 $$('.expression').forEach(b=>{const a=b.dataset.expression===state.expression;b.classList.toggle('active',a);b.setAttribute('aria-pressed',String(a))});
 $$('.background-chip').forEach(b=>{const a=b.dataset.bg===state.background;b.classList.toggle('active',a);b.setAttribute('aria-pressed',String(a))});
 $('#stage').dataset.background=isOverlay?'transparent':state.background;
 $('#energy').value=state.energy;$('#energy-value').textContent=`${state.energy}%`;$('#energy').style.setProperty('--fill',`${state.energy}%`);
 $('#speed').value=state.speed;$('#speed-value').textContent=`${Number(state.speed.toFixed(2)).toLocaleString('nl-NL')}×`;$('#speed').style.setProperty('--fill',`${(state.speed-.7)/.6*100}%`);
 $('#idle-toggle').checked=state.idle;
 $('#status-label').textContent=!ready?'Even klaarmaken':stopped?'Gepauzeerd':state.speaking?'Aan het woord':state.clip?(state.clip==='Walking'?'Aan het lopen':'Aan het rennen'):state.motion==='idle'?'Klaar voor de show':labels[state.motion];
 $('#stage-action').replaceChildren(Object.assign(document.createElement('span'),{className:'tiny-star',textContent:'✦'}),document.createTextNode(' '+(stopped?bt('Vlampie is gepauzeerd'):state.speaking?bt('Vlampie is aan het woord'):state.clip?(state.clip==='Walking'?bt('Vlampie loopt'):bt('Vlampie rent')):bt(actionLabels[state.motion]))));
 const speechBusy=state.speaking||voicePhase!=='idle';
 $('#speak').classList.toggle('speaking',speechBusy);$('#speak').querySelector('span').textContent=speechBusy?(voicePhase==='loading'?'Aanvraag stoppen':'Spraak stoppen'):bt('Laat Vlampie spreken');
 $('#openai-play').hidden=!['ready','paused'].includes(voicePhase);$('#openai-play').textContent=voicePhase==='paused'?'Stem hervatten':'Stem afspelen';$('#speech-provider').value=voiceProvider;$('#browser-voice-setting').hidden=voiceProvider!=='browser';$('#speech-provider-label').textContent=voiceProvider==='openai'?'OpenAI · Ballad · AI-stem':'Browserstem · spraakproef';
 $('#demo').classList.toggle('running',demoRunning);$('#demo span').textContent=demoRunning?'Stop voorvertoning':'Bekijk alle scènes';
 $('#character-count').textContent=`${$('#speech-text').value.length} / 500`;updateShowUI();showAudio?.duck(state.speaking&&!state.speechPaused);
}
function updateStudioUI(){
 const drawing=state.bingoPending!==null;
 const board=numberGrid?.update(state),count=board?.drawn.length??state.bingoDrawn.length,latest=board?board.latest:state.bingoNumber;
 $('#bingo-number').textContent=latest??'–';$('#bingo-number').setAttribute('aria-label',latest===null?'Nog geen bal getrokken':`Laatste getrokken bal, nummer ${latest}`);
 $('.ballboard-card').dataset.drawState=drawing?'drawing':count?'drawn':'empty';
 $('#draw-help').textContent=count===0?'Klaar voor de eerste trekking':count===75?'Alle 75 nummers zijn getrokken':`Nog ${75-count} ${count===74?'bal':'ballen'} in de molen`;
 $('#ballboard-total').replaceChildren(document.createTextNode(String(count)),Object.assign(document.createElement('span'),{textContent:'/75'}));$('#draw-progress').value=count;
 $('#draw-label').textContent=drawing?(stopped?'Trekking gepauzeerd':'De molen draait…'):'Laatste bal';
 $('#draw-ball').disabled=director?.externalHold||!rig3D?.character||state.bingoDrawn.length>=75||!!showRunner?.active&&(showRunner.block?.type!=='round'||showRunner.phase!=='drawing')||!!director?.busy&&!(director.paused&&director.flow?.kind==='draw');
 $('#draw-ball span').textContent=director?.paused&&director.flow?.kind==='draw'?'Hervat trekking':director?.flow?.kind==='draw'?'Trekking bezig…':'Volgende bal';
 $('#draw-count').textContent=state.bingoDrawn.length?`${state.bingoDrawn.length} van 75 nummers getrokken`:'Nog geen nummers getrokken';
 $('#draw-history').replaceChildren(...state.bingoDrawn.slice(-7).map(n=>Object.assign(document.createElement('span'),{textContent:String(n)})));
 $('#stage-lights').checked=state.lightShow;$('#stage-effects').checked=state.effects;$('#stage-effects').disabled=rig3D?.effectsAvailable===false;
}
function studioSnapshot(){return {brandId:state.brandId,theme:state.theme,presenter:state.presenter,hostSpot:state.hostSpot,effects:state.effects,lightShow:state.lightShow,bingoNumber:state.bingoNumber,bingoPending:state.bingoPending,bingoElapsed:state.bingoElapsed,bingoDrawn:[...state.bingoDrawn],stopped,show:state.show,motion:state.motion,motionElapsed:Math.max(0,(stopped&&pausedMotionAt?pausedMotionAt:performance.now())-state.motionStart)};}
function receiveStudio(p,transit=0){
 if(p.brandId&&brandId(p.brandId)!==state.brandId)void chooseWorld(p.brandId,{persist:false,theme:p.theme,broadcast:false});else if(['showtime','sinterklaas','royale','magico'].includes(p.theme)&&p.theme!==state.theme)void chooseTheme(p.theme,false);
 if(['front','desk'].includes(p.hostSpot))state.hostSpot=p.hostSpot;
 if(['illustrated','model'].includes(p.presenter)&&p.presenter!==state.presenter)choosePresenter(p.presenter,false);
 if(typeof p.effects==='boolean')state.effects=p.effects;
 if(typeof p.lightShow==='boolean')state.lightShow=p.lightShow;
 if(p.bingoNumber===null||Number.isInteger(p.bingoNumber)&&p.bingoNumber>=1&&p.bingoNumber<=75)state.bingoNumber=p.bingoNumber;
 if(p.bingoPending===null||Number.isInteger(p.bingoPending)&&p.bingoPending>=1&&p.bingoPending<=75)state.bingoPending=p.bingoPending;
 if(Number.isFinite(p.bingoElapsed))state.bingoElapsed=clamp(p.bingoElapsed,0,1000);
 if(Array.isArray(p.bingoDrawn))state.bingoDrawn=[...new Set(p.bingoDrawn.filter(n=>Number.isInteger(n)&&n>=1&&n<=75))];
 if(typeof p.stopped==='boolean')stopped=p.stopped;
 if(MOTIONS.includes(p.motion)&&Number.isFinite(p.motionElapsed)){state.motion=p.motion;state.motionStart=performance.now()-p.motionElapsed;}
 if(p.show)receiveShow(p.show,transit);updateUI();
}
function drawBingo(){if(isShow||!rig3D?.character)return;runShowAction(()=>showRunner?.active?showRunner.drawNow():director.draw(),{keepPlan:!!showRunner?.active});}
function advanceBingo(delta){
 // Show windows animate a pending cage but cannot commit a draw. The director's
 // timer in the regie owns every phase and the only completed-number event.
 if(isShow&&state.bingoPending!==null)state.bingoElapsed=Math.min(4.3,state.bingoElapsed+delta);
}
$('#draw-ball').addEventListener('click',drawBingo);
$('#reset-draw').addEventListener('click',()=>{if(bingoHost?.game?.status==='running'){toast('De echte trekking kan niet worden gewist. Gebruik Spellen om de show af te sluiten.');return;}if(director.busy){toast('Rond eerst het showmoment af of zet een andere scène live.');return;}if(state.bingoDrawn.length&&!confirm('Wis alle getrokken nummers en begin met een leeg bingobord?'))return;showRunner?.stop();director.reset();});
$('#stage-lights').addEventListener('change',e=>{state.lightShow=e.target.checked;savePrefs();emit('studio',studioSnapshot());updateUI();});
$('#stage-effects').addEventListener('change',e=>{state.effects=e.target.checked;savePrefs();emit('studio',studioSnapshot());updateUI();});

function clearDemo(){demoTimers.forEach(clearTimeout);demoTimers=[];demoRunning=false;updateUI()}
function setMotion(motion,{broadcast=true,keepDemo=false}={}){
 if(!MOTIONS.includes(motion))throw new Error('Onbekend gebaar.');
 if(!keepDemo){clearDemo();if(director?.paused)director.resume();}stopped=false;pausedMotionAt=0;state.clip='';state.motion=motion;state.motionStart=performance.now();
 if(broadcast)emit('motion',{motion});updateUI();
}
async function choosePresenter(presenter,broadcast=true){
 if(presenter!=='illustrated'||threeError)return;
 state.presenter=presenter;state.clip='';setMode('3d',broadcast);updateUI();
 try{await rig3D?.setPresenter(presenter);if(state.presenter!==presenter)return;if(broadcast)emit('studio',studioSnapshot());savePrefs();updateUI();}
 catch(error){console.warn(error);state.presenter='illustrated';await rig3D?.setPresenter('illustrated');updateUI();toast('Het 3D-model kon niet laden. De 2D-presentator blijft klaarstaan.');}
}
async function chooseTheme(theme,broadcast=true){
 if(!['showtime','sinterklaas','royale','magico'].includes(theme))return;if(state.brandId!=='vlampie')theme=showBrand(state.brandId).theme;
 const choice=++themeChoice;state.theme=theme;if(director)director.theme=theme;themeLoading=true;updateUI();
 if(broadcast){setBackground('studio');emit('studio',studioSnapshot());}
 try{
  if(rig3D?.character){await rig3D.setBrand(state.brandId,false);await rig3D.setTheme(theme,!reduced);}
  if(choice!==themeChoice)return;savePrefs();if(previewStudio?.character){await previewStudio.setBrand(state.brandId,false);await previewStudio.setTheme(theme,false);}
 }catch(error){
  if(choice!==themeChoice)return;state.theme=rig3D?.theme||'showtime';if(director)director.theme=state.theme;savePrefs();
  if(broadcast)emit('studio',studioSnapshot());toast('Dit decor kon niet laden. De huidige studio blijft zichtbaar; probeer het opnieuw.');
 }finally{if(choice===themeChoice){themeLoading=false;updateUI();}}
}
let worldRequest=0,worldBusy=false;
async function chooseWorld(identity,{persist=true,theme,broadcast=true}={}){
 const b=showBrand(identity),previous=state.brandId;
 if(persist&&bingoHost?.production?.generating){toast('Wacht tot het voorbereiden van de stemmen klaar is.');applyBrand(previous);return;}
 if(persist&&(worldBusy||themeLoading)){toast('De showwereld wordt nog geladen.');applyBrand(previous);return;}
 if(persist&&(callHost?.held||callHost?.api.call&&!['ended','declined','missed','failed'].includes(callHost.api.call.phase))){toast('Rond eerst het belmoment af voordat je de showhost wisselt.');applyBrand(previous);return;}
 const request=++worldRequest,targetGameId=bingoHost?.game?.id;worldBusy=true;
 try{
  await Promise.all([rig3D?.prepareWorld(b.id),previewStudio?.prepareWorld(b.id),prepareReserve(b.id)]);if(request!==worldRequest||targetGameId!==bingoHost?.game?.id)return;
  if(persist){stopSpeech();narration?.cancel(true);if(bingoHost?.game){await bingoHost.post('brand',{brandId:b.id});}}
  if(request!==worldRequest)return;state.brandId=b.id;state.theme=b.id==='vlampie'?(theme==='sinterklaas'?'sinterklaas':'showtime'):b.theme;
  applyBrand(b);if(director){director.brandId=b.id;director.config.brandId=b.id;if(!bingoHost?.game)director.config.title=b.title;}
  if(rig3D?.character)await rig3D.setBrand(b.id,!reduced);
  if(request!==worldRequest)return;await chooseTheme(state.theme,false);
  if(request!==worldRequest)return;
  if(state.brandId!=='vlampie')state.mode=threeError?'2d':'3d';savePrefs();if(broadcast&&!isShow){emit('snapshot',snapshot());broadcastShow();}
  const feedback=$('#host-switch-feedback');if(feedback)feedback.textContent=b.name+' presenteert vanuit '+b.studio+'. Alle scènes en spelersschermen volgen deze keuze.';
  if(persist&&bingoHost?.game){applyPresentation();if(showRunner?.active)showRunner.plan=structuredClone(bingoHost.game.plan);director.config.title=bingoHost.game.title;bingoHost.editor();await bingoHost.list();}
  if(persist)toast(b.title+' staat klaar.');updateUI();
 }catch(error){if(request===worldRequest){state.brandId=previous;applyBrand(previous);toast(error.message||'De showwereld kon niet worden geladen. Probeer opnieuw.');}}
 finally{if(request===worldRequest){worldBusy=false;const latest=bingoHost?.game;if(latest&&(latest.id!==targetGameId||brandId(latest)!==b.id))applyPresentation();}}
}
function setMode(mode,broadcast=true){
 if(state.brandId!=='vlampie'&&mode==='2d'&&rig3D?.character){mode='3d';rig3D.setBackground('transparent');}
 if(!['2d','3d'].includes(mode)||mode==='3d'&&threeError)return;
 state.mode=mode;state.clip='';stopped=false;savePrefs();if(broadcast)emit('mode',{mode});
 if(!state.speaking&&voicePhase==='idle')$('#speech-feedback').textContent=speechHint();
 updateUI();requestAnimationFrame(()=>{resize();rig3D?.resize();});
}
function setClip(clip,broadcast=true){
 if(clip)return;
 clearDemo();state.clip=clip;state.motion='idle';state.motionStart=performance.now();stopped=false;
 if(broadcast)emit('clip',{clip});updateUI();
}
function setCamera(camera,broadcast=true){
 if(!['wide','establish','desk','front','portrait','machine','audience','led','tour','side','back'].includes(camera))return;
 if(camera==='desk')state.hostSpot='desk';else if(['wide','establish','front','tour'].includes(camera))state.hostSpot='front';
 state.camera=camera;rig3D?.setCamera(camera,!reduced);if(broadcast)emit('camera',{camera,hostSpot:state.hostSpot});updateUI();
}
function setAppearance(appearance,broadcast=true){if(!['original','studio'].includes(appearance))return;state.appearance=appearance;savePrefs();if(broadcast)emit('appearance',{appearance});updateUI()}
function setExpression(expression,broadcast=true){if(!EXPRESSIONS.includes(expression))throw new Error('Onbekende gezichtsuitdrukking.');state.expression=expression;if(broadcast)emit('expression',{expression});updateUI()}
function setBackground(background,broadcast=true){if(!['studio','blue','transparent'].includes(background))throw new Error('Onbekende achtergrond.');state.background=background;savePrefs();if(broadcast)emit('background',{background});updateUI()}
function stopSpeech(broadcast=true,completed=false){const pending=speechCompletion;speechCompletion=null;pending?.({completed});speechToken++;openaiVoice?.stop();clearTimeout(speechWatchdog);speechWatchdog=null;if(!isShow&&'speechSynthesis'in window)speechSynthesis.cancel();state.speaking=false;state.speechLive=false;state.word='';if(broadcast)emit('speech-stop',{});hideCaption();updateUI()}
function stopAll({broadcast=true}={}){if(callHost?.api.call&&!['ended','declined','missed','failed'].includes(callHost.api.call.phase)){outputBridge?.controls('call-stop');void callHost.api.action('stop').catch(()=>{});}callOutput?.emergencyStop();narration?.cancel(true);bingoHost?.pause(true).catch(error=>toast(error.message));preparedStartToken++;if(showRunner?.active&&director.step?.speech&&(state.speaking||voicePhase!=='idle'))showRunner.voiceFailed=true;if(director&&!director.paused)director.pause();showAudio?.pause();cancelChat();clearDemo();stopSpeech(false);state.motion='idle';state.motionStart=performance.now();stopped=true;hideCaption();if(broadcast)emit('stop',{});updateUI()}
function spokenDuration(text){return Math.max(1500,Math.max(text.trim().split(/\s+/).length*410,text.length*58)/state.speed)}
const speechTimeout=(duration,live)=>live?Math.max(20000,duration*3+8000):duration+1000;
function startVisualSpeech(text,duration,broadcast=true,live=false){state.speaking=true;state.speechPaused=false;state.speechLive=live;state.speechStart=performance.now();state.speechText=text;state.speechDuration=duration;state.word='';state.lastBoundary=0;state.speechChar=-1;state.speechChunks=splitCaptions(text);state.visibleChunk=state.speechChunks[0]?.start;stopped=director?.paused||false;caption(state.speechChunks[0]?.text||text,bt('VLAMPIE'),0);if(broadcast)emit('speech-start',{text,duration,live});updateUI()}
function updateSpeechCaption(now){
 if(!state.speaking||state.speechPaused)return;
 const elapsed=now-state.speechStart;
 if(isShow&&elapsed>speechTimeout(state.speechDuration,state.speechLive)){stopSpeech(false);return;}
 const index=state.speechChar>=0&&now-state.lastBoundary<1500?state.speechChar:Math.floor(clamp(elapsed/state.speechDuration,0,1)*state.speechText.length);
 const chunk=captionAt(state.speechChunks||[],index);
 if(chunk&&chunk.start!==state.visibleChunk){$('#caption-text').textContent=chunk.text;state.visibleChunk=chunk.start;}
}
function speak(text,{keepDemo=false,provider=voiceProvider,kind='critical',context={}}={}){
 if(director?.callHold)throw new Error(bt('Vlampie is in gesprek. Rond het belmoment eerst af.'));if(isShow)return {mode:'visual-only'};if(outputBridge?.routing&&provider!=='openai')throw new Error('Kies de OpenAI-stem voor geluid via het uitzendvenster.');
 if(typeof text!=='string'||!text.trim())throw new Error('Vul eerst een tekst in.');text=Array.from(text.trim()).slice(0,500).join('');
 if(!keepDemo)clearDemo();stopSpeech();const token=++speechToken;const done=new Promise(resolve=>speechCompletion=resolve);speechKind=kind;
 activeSpeechProvider=provider;if(provider==='openai'){openaiVoice.speak(text,state.speed,{brandId:state.brandId,...(bingoHost?.game?{gameId:bingoHost.game.id}:{profileId:currentProfile().id,brandId:state.brandId}),...context});return {mode:'openai-speech',done};}
 if(!('speechSynthesis'in window)||!('SpeechSynthesisUtterance'in window)){
   const duration=spokenDuration(text);startVisualSpeech(text,duration);$('#speech-feedback').textContent='Deze browser biedt geen spraak aan. De tekst verschijnt als ondertitel.';speechWatchdog=setTimeout(()=>{if(token===speechToken)stopSpeech(true,true)},duration);return {mode:'animation-only',done};
 }
 const utterance=new SpeechSynthesisUtterance(text);utterance.lang='nl-NL';utterance.rate=state.speed;utterance.pitch=1.1;
 const selected=voices.find(v=>v.voiceURI===$('#voice-select').value);if(selected)utterance.voice=selected;
 let began=false;
 utterance.onstart=()=>{if(token!==speechToken)return;began=true;clearTimeout(speechWatchdog);startVisualSpeech(text,spokenDuration(text),true,true);$('#speech-feedback').textContent=state.mode==='3d'?bt('Vlampie spreekt met de browserstem. Zijn mond beweegt mee op basis van de tekst.'):bt('Vlampie spreekt met de stem van je browser.');speechWatchdog=setTimeout(()=>{if(token===speechToken){stopSpeech();$('#speech-feedback').textContent='De spraak is gestopt omdat de browser geen eindmelding gaf.'}},speechTimeout(spokenDuration(text),true));};
 utterance.onboundary=e=>{if(token!==speechToken||e.name!=='word')return;state.word=text.slice(e.charIndex).split(/\s/)[0];state.speechChar=e.charIndex;state.lastBoundary=performance.now();emit('word',{word:state.word,index:e.charIndex})};
 utterance.onend=()=>{if(token!==speechToken)return;stopSpeech(true,true);$('#speech-feedback').textContent='Klaar. Pas de tekst aan of probeer een ander gebaar.'};
 utterance.onerror=e=>{if(token!==speechToken)return;stopSpeech();if(!['canceled','interrupted'].includes(e.error)){$('#speech-feedback').textContent='De browser kon de stem niet afspelen. Kies een andere stem of probeer Chrome of Edge.';toast('Spraak kon niet starten. De bewegingen blijven beschikbaar.')}};
 speechSynthesis.speak(utterance);
 speechWatchdog=setTimeout(()=>{if(token===speechToken&&!began){stopSpeech();$('#speech-feedback').textContent='De stem start niet. Kies een andere stem en probeer opnieuw.'}},7000);
 return {mode:'browser-speech',done};
}
function voiceList(){
 if(!('speechSynthesis'in window)){updateUI();return;}
 const previous=$('#voice-select').value;voices=speechSynthesis.getVoices();
 voices.sort((a,b)=>(b.lang.toLowerCase().startsWith('nl')?1:0)-(a.lang.toLowerCase().startsWith('nl')?1:0)||a.name.localeCompare(b.name));
 const select=$('#voice-select');select.replaceChildren();
 const def=document.createElement('option');def.value='';def.textContent=voices.some(v=>v.lang.toLowerCase().startsWith('nl'))?'Standaard Nederlands':'Standaardstem van je apparaat';select.append(def);
 for(const voice of voices){const o=document.createElement('option');o.value=voice.voiceURI;o.textContent=`${voice.name} (${voice.lang})`;select.append(o)}
 const preferred=voices.find(v=>v.voiceURI===previous)||voices.find(v=>v.lang.toLowerCase().startsWith('nl'));if(preferred)select.value=preferred.voiceURI;
}
function playDemo(){
 if(isShow)return;if(demoRunning){clearDemo();return;}clearDemo();demoRunning=true;updateUI();
 SCENES.forEach((scene,i)=>demoTimers.push(setTimeout(()=>{director.select(scene.id);previewChosenAt=performance.now();updateShowUI();},i*3200)));
 demoTimers.push(setTimeout(()=>{demoRunning=false;updateUI();},SCENES.length*3200));
}
function reactToChat(kind){
 clearDemo();
 if(kind==='greeting'){setExpression('happy');setMotion('wave');speak('Hoi Sanne! Wat leuk dat je erbij bent. Pak je bingokaart maar vast!')}
 else if(kind==='win'){director.reportBingo('Jeroen');openBingoDialog();}
}
function mouthAt(now){if(callOutput?.bridge.liveCallActive)return callOutput.mouth;if(callHost?.held)return callHost.mouth;if(state.speechPaused)return {open:0,round:0};return speechMouthAt({...state,stopped},now);}
function resize(){const rect=canvas.getBoundingClientRect();cw=Math.max(1,rect.width);ch=Math.max(1,rect.height);dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(cw*dpr);canvas.height=Math.round(ch*dpr);ctx.setTransform(dpr,0,0,dpr,0,0)}
const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvas);
function draw(now){
 animationFrame=requestAnimationFrame(draw);
 const delta=Math.min((now-lastTime)/1000,.05);lastTime=now;if(!stopped){elapsedClock+=delta;advanceBingo(delta);}
 if(isShow&&outputBridge?.active&&outputBridge.ack&&['playing','paused'].includes(outputBridge.ack.status)&&state.speaking){state.speechStart=now-outputBridge.voiceElapsed;state.speechPaused=outputBridge.ack.status==='paused';}
 if(!isShow&&['playing','paused'].includes(openaiVoice?.phase)&&state.speaking){state.speechStart=now-openaiVoice.elapsed;state.speechPaused=!openaiVoice.running;if(now-lastSpeechClock>300){lastSpeechClock=now;emit('speech-clock',{elapsed:openaiVoice.elapsed,paused:state.speechPaused});}}
 updateSpeechCaption(now);
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,cw,ch);
 if(rig&&state.mode==='2d'){
  if(state.idle&&!stopped&&elapsedClock>=nextBlink){blinkUntil=elapsedClock+.14;nextBlink=elapsedClock+2.4+Math.random()*3;}
  const age=now-state.motionStart;
  if(state.motion!=='idle'&&age>durations[state.motion]){state.motion='idle';updateUI()}
  let expression=state.expression;if(state.motion==='think')expression='thinking';if(state.motion==='cheer'&&expression==='neutral')expression='happy';
  rig.draw(ctx,cw,ch,{motion:state.motion,motionElapsed:age,energy:state.energy,idle:state.idle&&!stopped,time:elapsedClock,expression,mouth:mouthAt(now),speaking:state.speaking||!!callOutput?.speaking||!!callHost?.speaking,stopped:stopped&&!callOutput?.bridge.liveCallActive&&!callHost?.held,delta,blink:state.idle&&!stopped&&elapsedClock<blinkUntil,overlay:isOverlay||state.background==='transparent'});
  if(state.motion==='cheer'&&!reduced)confetti(now-state.motionStart);
 }
 if(state.mode==='3d'&&rig3D?.character&&(isShow||dashboard?.page==='regie')){
  const age=now-state.motionStart;
  if(!stopped&&state.motion!=='idle'&&age>durations[state.motion]){state.motion='idle';updateUI();}
  rig3D.render(delta,{clip:state.clip,motion:state.motion,age,energy:state.energy,idle:state.idle,time:elapsedClock,speaking:state.speaking||!!callOutput?.speaking||!!callHost?.speaking,mouth:mouthAt(now),stopped:stopped&&!callOutput?.bridge.liveCallActive&&!callHost?.held,effects:state.effects,lightShow:state.lightShow,bingoNumber:state.bingoNumber,bingoPending:state.bingoPending,bingoElapsed:state.bingoElapsed,bingoDrawn:state.bingoDrawn,show:currentShowVisual(now),lookAt:state.lookAt});
  renderScenePreview(now,delta);
 }
}
function confetti(age){const strength=poseAt('cheer',age,state.energy,false,0).cheer;if(strength<.01)return;ctx.save();ctx.globalAlpha=strength*.9;const colors=['#ffd068','#7799ff','#ff8d52','#cfe9ff'];for(let i=0;i<36;i++){const seed=(i*137.5)%100;const x=cw*(.07+seed/116)+Math.sin(age*.002+i)*12;const y=((age*.10+(i*83)%ch)%(ch*.85));ctx.fillStyle=colors[i%4];ctx.save();ctx.translate(x,y);ctx.rotate(age*.001+i);ctx.fillRect(-2,-5,4,8);ctx.restore()}ctx.restore()}
async function loadImage(path){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error(`Kan afbeelding niet laden: ${path}`));img.src=path})}
async function init(){
 updateUI();voiceList();checkOpenAI();if('speechSynthesis'in window)speechSynthesis.addEventListener('voiceschanged',voiceList);
 animationFrame=requestAnimationFrame(draw);
 const twoD=loadImage('assets/vlampie-illustrated-v10.png').then(async portrait=>{const mouthImage=await loadImage('assets/vlampie-mouth-open-v12.png').catch(()=>null),blinkImage=await loadImage('assets/vlampie-blink-v18.png').catch(()=>null),mouthTexture=mouthImage?createMouthTexture(portrait,mouthImage,makeCanvas):null,blinkTexture=blinkImage?createBlinkTexture(portrait,blinkImage,makeCanvas):null;rig={draw(c,w,h,s){if(state.brandId!=='vlampie'){const reserve=reserveWorlds.get(state.brandId);if(reserve?.draw)reserve.draw(c,w,h,s);else{c.fillStyle=showBrand(state.brandId).palette.base;c.fillRect(0,0,w,h);void prepareReserve(state.brandId).catch(()=>{});}return;}mouthTexture?.update(s.mouth,s.delta,s.speaking&&!s.stopped);if(!s.stopped)blinkTexture?.update(blinkAt(s.time,s.idle));const scale=Math.min(w*.83/portrait.width,h*.92/portrait.height),height=portrait.height*scale,width=portrait.width*scale,breathe=s.idle?Math.sin(s.time*1.65)*.004:0;c.save();c.translate(w/2,h*.96);c.scale(1+breathe*.25,1+breathe);c.drawImage(portrait,-width/2,-height,width,height);if(mouthTexture){c.save();c.translate(-width/2,-height);c.scale(scale,scale);mouthTexture.draw(c);blinkTexture?.draw(c);c.restore();}c.restore();}};resize();updateUI();}).catch(error=>{console.error(error);if(state.mode==='2d')$('#loading').textContent=bt('Vlampie kon niet laden. Ververs de pagina.');});
 const threeD=import('./studio-25d.js?v=36').then(async({VlampieStudio25D})=>{
  rig3D=new VlampieStudio25D($('#puppet-3d'),{onCameraChange:camera=>{state.camera=camera;$$('[data-camera]').forEach(b=>{const a=b.dataset.camera===camera;b.classList.toggle('active',a);b.setAttribute('aria-pressed',String(a));});},onContextState:lost=>{if(lost)$('#loading').textContent='De studioweergave wordt hersteld…';updateUI();},onRenderFailure:()=>{threeError=true;state.mode='2d';updateUI();toast('De studio is onderbroken. Het reservebeeld blijft zichtbaar; ververs de pagina om de studio opnieuw te openen.');}});
  await rig3D.load(p=>{if(state.mode==='3d')$('#loading').textContent=`${bt("Vlampie")} wordt geladen… ${p}%`;});
  await prepareReserve(state.brandId);await chooseTheme(state.theme,false);await rig3D.setPresenter(state.presenter);rig3D.setHostSpot(state.hostSpot);rig3D.setBackground(isOverlay?'transparent':state.background);rig3D.setCamera(state.camera==='free'?'wide':state.camera,false);updateUI();
  if(!isShow){previewStudio=new VlampieStudio25D($('#scene-preview'),{onRenderFailure:()=>{previewReady=false;$('#preview-loading').hidden=false;$('#preview-loading').textContent='De voorvertoning kon niet laden. De uitzending blijft beschikbaar.';}});await previewStudio.load();await previewStudio.setBrand(state.brandId,false);await previewStudio.setTheme(state.theme,false);previewReady=true;$('#preview-loading').hidden=true;previewChosenAt=performance.now();updateShowUI();}
 }).catch(error=>{console.error(error);threeError=true;rig3D?.dispose();rig3D=null;state.mode='2d';updateUI();toast('De studio kon niet worden geopend. Het reservebeeld blijft beschikbaar.');$('#speech-feedback').textContent=speechHint();});
 await Promise.allSettled([twoD,threeD]);updateUI();
 if(ready&&!isShow)caption('Welkom! Zet je openingsscène klaar en start de show.','KLAAR VOOR DE SHOW',3800);
 if(isShow)channel?.postMessage({kind:'get-state'});
 registerTools();
}
$$('[data-theme]').forEach(b=>b.addEventListener('click',()=>chooseTheme(b.dataset.theme)));
$$('[data-presenter]').forEach(b=>b.addEventListener('click',()=>choosePresenter(b.dataset.presenter)));
$$('[data-renderer]').filter(b=>b.tagName==='BUTTON').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.renderer)));
$$('[data-clip]').forEach(b=>b.addEventListener('click',()=>setClip(b.dataset.clip)));
$$('[data-camera]').forEach(b=>b.addEventListener('click',()=>setCamera(b.dataset.camera)));
$$('[data-appearance]').forEach(b=>b.addEventListener('click',()=>setAppearance(b.dataset.appearance)));
$$('[data-motion]').forEach(b=>b.addEventListener('click',()=>setMotion(b.dataset.motion)));
$$('[data-expression]').forEach(b=>b.addEventListener('click',()=>setExpression(b.dataset.expression)));
$$('[data-bg]').forEach(b=>b.addEventListener('click',()=>setBackground(b.dataset.bg)));
$$('[data-line]').forEach(b=>b.addEventListener('click',()=>{$('#speech-text').value=b.dataset.line==='intro'?showBrand(state.brandId).intro:b.dataset.line==='sint'&&state.brandId!=='vlampie'?showBrand(state.brandId).intro:bt(lines[b.dataset.line]);updateUI()}));
$$('[data-chat]').forEach(b=>b.addEventListener('click',()=>reactToChat(b.dataset.chat)));
$('#energy').addEventListener('input',e=>{state.energy=Number(e.target.value);savePrefs();emit('settings',{energy:state.energy,idle:state.idle,speed:state.speed});updateUI()});
$('#speed').addEventListener('input',e=>{state.speed=Number(e.target.value);savePrefs();emit('settings',{energy:state.energy,idle:state.idle,speed:state.speed});updateUI()});
$('#idle-toggle').addEventListener('change',e=>{state.idle=e.target.checked;stopped=false;savePrefs();emit('settings',{energy:state.energy,idle:state.idle,speed:state.speed});updateUI()});
$('#speech-text').addEventListener('input',updateUI);
$('#speech-preview').addEventListener('click',()=>{setMode('3d');setBackground('studio');setCamera('portrait');setMotion('idle');try{if(!$('#speech-text').value.trim())throw new Error('Vul eerst een tekst in.');narration.add({kind:'speech',text:$('#speech-text').value,approved:true});toast('Uitspraak klaargezet voor het volgende rustige moment.');}catch(error){toast(error.message);$('#speech-text').focus();}});
$('#speak').addEventListener('click',()=>{if(state.speaking||voicePhase!=='idle'){stopSpeech();return}try{if(!$('#speech-text').value.trim())throw new Error('Vul eerst een tekst in.');narration.add({kind:'speech',text:$('#speech-text').value,approved:true});toast('Uitspraak klaargezet voor het volgende rustige moment.');}catch(e){toast(e.message);$('#speech-text').focus()}});
$('#speech-provider').addEventListener('change',event=>{stopSpeech();voiceProvider=event.target.value==='browser'?'browser':'openai';savePrefs();$('#speech-feedback').textContent=speechHint();updateUI();});
$('#openai-play').addEventListener('click',()=>openaiVoice?.resume());
$('#openai-test').addEventListener('click',()=>checkOpenAI(true));
$('#api-key-form').addEventListener('submit',saveAPIKey);
$('#api-key-remove').addEventListener('click',()=>changeAPIKey('remove'));
$('#ai-chat-form').addEventListener('submit',generateChatReply);
$('#demo').addEventListener('click',playDemo);$('#stop-all').addEventListener('click',()=>stopAll());
$('#reset').addEventListener('click',()=>{if(bingoHost?.game?.status==='running'){toast('Sluit eerst het echte spel af voordat je de studio reset.');return;}stopAll();showRunner?.stop();director?.reset();Object.assign(state,{energy:65,idle:!reduced,speed:1,expression:'neutral',background:'studio',clip:'',camera:'wide',presenter:'illustrated',hostSpot:'front',appearance:'original',effects:true,lightShow:!reduced,bingoNumber:null,bingoPending:null,bingoElapsed:1000,bingoDrawn:[]});stopped=false;rig3D?.setPresenter('illustrated');rig3D?.setCamera('wide',!reduced);$('#speech-text').value=showBrand(state.brandId).intro;savePrefs();emit('snapshot',snapshot());updateUI();toast(bt('Vlampie staat weer klaar voor de show.'))});
$('#fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if($('#stage').requestFullscreen)await $('#stage').requestFullscreen();else window.open('?view=show','_blank','noopener')}catch{toast('Volledig scherm is niet beschikbaar. Gebruik de showweergave.')}});
document.addEventListener('fullscreenchange',()=>{requestAnimationFrame(()=>{rig3D?.resize();if(rig3D)rig3D.setCamera(state.camera==='free'?'wide':state.camera,false);});});
window.addEventListener('keydown',e=>{if(isShow||e.defaultPrevented||document.querySelector('dialog[open]'))return;if(e.key==='Escape'){if(document.activeElement?.closest('.live-chat'))return;if(document.body.classList.contains('tuning-open')||document.body.classList.contains('sidebar-open')||document.body.classList.contains('number-grid-open'))return;stopAll();return;}if(dashboard?.page!=='regie'||document.body.classList.contains('tuning-open')||document.body.classList.contains('sidebar-open')||document.body.classList.contains('number-grid-open'))return;if(['INPUT','TEXTAREA','SELECT','BUTTON','A'].includes(document.activeElement?.tagName)||e.ctrlKey||e.metaKey||e.altKey||e.repeat)return;const scene=SCENES.find(s=>s.key===e.key);if(scene){e.preventDefault();clearDemo();director.select(scene.id);previewChosenAt=performance.now();}else if(e.key==='Enter'){e.preventDefault();takeSelectedScene();}else if(e.code==='Space'){e.preventDefault();toggleShowPause();}else if(e.key.toLowerCase()==='n'){e.preventDefault();drawBingo();}else if(e.key.toLowerCase()==='b'){e.preventDefault();openBingoDialog();}});
function snapshot(){const audioActive=['playing','paused'].includes(openaiVoice?.phase);return {brandId:state.brandId,theme:state.theme,presenter:state.presenter,hostSpot:state.hostSpot,mode:state.mode,clip:state.clip,camera:state.camera,appearance:state.appearance,effects:state.effects,lightShow:state.lightShow,bingoNumber:state.bingoNumber,bingoPending:state.bingoPending,bingoElapsed:state.bingoElapsed,bingoDrawn:state.bingoDrawn,motion:state.motion,motionElapsed:performance.now()-state.motionStart,energy:state.energy,idle:state.idle,expression:state.expression,background:state.background,speed:state.speed,stopped,speaking:state.speaking,speechLive:state.speechLive,speechText:state.speechText,speechDuration:state.speechDuration,speechElapsed:audioActive?openaiVoice.elapsed:performance.now()-state.speechStart,speechPaused:audioActive?!openaiVoice.running:!!state.speechPaused,speechChar:state.speechChar,word:state.word,boundaryAge:state.lastBoundary?performance.now()-state.lastBoundary:null,show:state.show}}
function receiveOutputMessage(data){
 if(!data||typeof data.kind!=='string')return;
 if(data.kind==='get-state'&&!isShow){emit('snapshot',snapshot());return}if(!isShow)return;const p=data.payload??{},transit=Number.isFinite(data.sentAt)?clamp(Date.now()-data.sentAt,0,120000):0;
 try{
  if(data.kind==='mode')setMode(p.mode,false);
  if(data.kind==='clip')setClip(p.clip,false);
  if(data.kind==='camera'){if(['front','desk'].includes(p.hostSpot))state.hostSpot=p.hostSpot;setCamera(p.camera,false);}
  if(data.kind==='appearance')setAppearance(p.appearance,false);
  if(data.kind==='studio')receiveStudio(p,transit);
  if(data.kind==='show'){receiveStudio(p.studio||{},transit);receiveShow(p,transit);updateUI();}
  if(data.kind==='motion')setMotion(p.motion,{broadcast:false});
  if(data.kind==='expression')setExpression(p.expression,false);
  if(data.kind==='background')setBackground(p.background,false);
  if(data.kind==='settings'){if(Number.isFinite(p.energy))state.energy=clamp(p.energy,0,100);if(typeof p.idle==='boolean')state.idle=p.idle;if(Number.isFinite(p.speed))state.speed=clamp(p.speed,.7,1.3);stopped=false;updateUI()}
  if(data.kind==='speech-start'&&typeof p.text==='string'){startVisualSpeech(p.text.slice(0,500),clamp(Number(p.duration)||5000,1000,120000),false,!!p.live);state.speechStart-=transit;}
  if(data.kind==='speech-clock'&&state.speaking&&Number.isFinite(p.elapsed)){state.speechStart=performance.now()-clamp(p.elapsed+(p.paused?0:transit),0,120000);state.speechPaused=!!p.paused;}
  if(data.kind==='word'&&typeof p.word==='string'){state.word=p.word.slice(0,80);if(Number.isFinite(p.index))state.speechChar=clamp(p.index,0,state.speechText.length);state.lastBoundary=performance.now()-transit}
  if(data.kind==='speech-stop')stopSpeech(false);
  if(data.kind==='stop')stopAll({broadcast:false});
  if(data.kind==='snapshot'){
   if(['2d','3d'].includes(p.mode))setMode(p.mode,false);
   if(['','Walking','Running'].includes(p.clip))state.clip=p.clip;
   if(['wide','establish','desk','front','portrait','machine','audience','led','tour','side','back'].includes(p.camera))setCamera(p.camera,false);
   if(['original','studio'].includes(p.appearance))setAppearance(p.appearance,false);
   receiveStudio(p,transit);

   if(MOTIONS.includes(p.motion)){state.motion=p.motion;state.motionStart=performance.now()-clamp(Number(p.motionElapsed)||0,0,10000)}
   if(EXPRESSIONS.includes(p.expression))state.expression=p.expression;
   if(['studio','blue','transparent'].includes(p.background))state.background=p.background;
   state.energy=clamp(Number(p.energy)||0,0,100);state.idle=!!p.idle;state.speed=clamp(Number(p.speed)||1,.7,1.3);stopped=!!p.stopped;
   if(p.speaking&&typeof p.speechText==='string'){startVisualSpeech(p.speechText.slice(0,500),Number(p.speechDuration)||5000,false,!!p.speechLive);state.speechPaused=!!p.speechPaused;state.speechStart=performance.now()-(Number(p.speechElapsed)||0)-(state.speechPaused?0:transit);if(Number.isFinite(p.speechChar)&&p.speechChar>=0)state.speechChar=clamp(p.speechChar,0,state.speechText.length);if(typeof p.word==='string')state.word=p.word.slice(0,80);if(Number.isFinite(p.boundaryAge))state.lastBoundary=performance.now()-clamp(p.boundaryAge+transit,0,120000)}else stopSpeech(false);updateUI();
  }
 }catch(error){console.warn('Bericht genegeerd:',error.message)}
};
if(channel)channel.onmessage=({data})=>{if(!isShow)receiveOutputMessage(data);};
function readShowForm(){
 return {title:$('#show-title').value.trim().slice(0,60)||showBrand(state.brandId).title,round:$('#round-name').value.trim().slice(0,45)||DEFAULT_SHOW.round,pattern:$('#round-pattern').value,prize:$('#prize-name').value.trim().slice(0,90)||DEFAULT_SHOW.prize,pauseMinutes:Number($('#pause-length').value)||5,countdown:Number($('#opening-countdown').value)||5};
}
function initShowControl(){
 const saved=prefs.show||{},config={...DEFAULT_SHOW,reducedMotion:reduced};
 for(const key of ['title','round','prize'])if(typeof saved[key]==='string'&&saved[key].trim())config[key]=saved[key].trim().slice(0,key==='prize'?90:60);
 if(['Volle kaart','Eén rij','Twee rijen','Vier hoeken'].includes(saved.pattern))config.pattern=saved.pattern;
 for(const key of ['autoCamera','voice','sound','comments','audience'])if(typeof saved[key]==='boolean')config[key]=saved[key];
 if([3,5,10,15].includes(saved.pauseMinutes))config.pauseMinutes=saved.pauseMinutes;
 if([5,10,15].includes(saved.countdown))config.countdown=saved.countdown;
 $('#show-title').value=config.title;$('#round-name').value=config.round;$('#round-pattern').value=config.pattern;$('#prize-name').value=config.prize;$('#pause-length').value=String(config.pauseMinutes);$('#opening-countdown').value=String(config.countdown);
 $('#auto-camera').checked=config.autoCamera;$('#auto-voice').checked=config.voice;$('#show-sound').checked=config.sound;$('#host-comments').checked=config.comments;$('#audience-reactions').checked=config.audience;$('#show-volume').value=Number.isFinite(saved.volume)?clamp(saved.volume,0,100):32;
 if(isShow)return;
 director=new ShowDirector({config,onEvent:handleDirectorEvent});director.theme=state.theme;state.show=director.visual();
 showRunner=new ShowRunner(director,{onChange:()=>{syncDirector();broadcastShow();updateShowUI();},onNotice:toast});
 for(const scene of SCENES){const b=document.createElement('button');b.type='button';b.className='scene-key';b.dataset.scene=scene.id;b.setAttribute('aria-label',`${bt(scene.name)} klaarzetten`);b.innerHTML=`<span class="scene-thumb"><span class="scene-index">${scene.key.padStart(2,'0')}</span><span class="scene-marker" hidden>LIVE</span></span><span class="scene-name">${({host:bt('Vlampie'),board:'Bord',round:'Ronde',prize:'Prijs',card:'Bingokaart'})[scene.id]||scene.short}</span>`;b.addEventListener('click',()=>{clearDemo();director.select(scene.id);previewChosenAt=performance.now();});$('#scene-rack').append(b);}
 showAudio.setEnabled(config.sound);showAudio.setVolume(Number($('#show-volume').value)/100);
 $('#take-scene').addEventListener('click',()=>takeSelectedScene());
 $('#show-start').addEventListener('click',startPreparedShow);
 $('#timeline-next').addEventListener('click',()=>runShowAction(()=>showRunner.next(),{keepPlan:true}));
 $('#show-pause').addEventListener('click',toggleShowPause);
 $('#show-bingo').addEventListener('click',openBingoDialog);
 $('#show-finale').addEventListener('click',()=>runShowAction(()=>director.take('finale')));
 $('#live-camera').addEventListener('change',()=>setCamera($('#live-camera').value));
 $('#show-voice-play').addEventListener('click',()=>{if(director.paused)director.resume();openaiVoice?.resume();});
 const toggleMap={'auto-camera':'autoCamera','auto-voice':'voice','show-sound':'sound','host-comments':'comments','audience-reactions':'audience'};
 for(const [id,key] of Object.entries(toggleMap))$('#'+id).addEventListener('change',()=>{const value=$('#'+id).checked;if(key==='voice'&&!value)stopSpeech();if(key==='sound'){showAudio.setEnabled(value);if(value)showAudio.unlock();}director.configure({[key]:value});savePrefs();});
 $('#show-volume').addEventListener('input',()=>{showAudio.setVolume(Number($('#show-volume').value)/100);updateShowUI();savePrefs();});
 $('#show-copy-form').addEventListener('submit',e=>{e.preventDefault();previewChosenAt=performance.now();updateShowUI();toast('Teksten staan klaar. Zet de gewenste scène live.');});
 $('#show-copy-form').addEventListener('input',()=>{previewChosenAt=performance.now();});
 $('#bingo-close').addEventListener('click',()=>$('#bingo-dialog').close());
 $('#bingo-claim-form').addEventListener('submit',async e=>{e.preventDefault();if(!$('#bingo-name').value.trim()){return $('#bingo-name').focus();}await showAudio.unlock();director.reportBingo($('#bingo-name').value,$('#bingo-card').value);$('#bingo-checked').checked=false;updateShowUI();});
 $('#bingo-checked').addEventListener('change',updateShowUI);
 $('#bingo-approve').addEventListener('click',async()=>{await showAudio.unlock();if(director.resolveBingo(true,{checked:$('#bingo-checked').checked})){$('#bingo-dialog').close();toast('Bingo bevestigd. De winnaar krijgt het podium.');}});
 $('#bingo-reject').addEventListener('click',async()=>{await showAudio.unlock();if(director.resolveBingo(false)){$('#bingo-dialog').close();toast('De show gaat verder vanaf de onderbroken trekking.');}});
 lastShowTick=performance.now();showTimer=setInterval(()=>{
  const now=performance.now(),gap=now-lastShowTick,delta=Math.min(1,Math.max(0,gap/1000));lastShowTick=now;if(gap>5000&&bingoHost?.game?.status==='running'){director.pause();bingoHost.recoveryConfirmed=false;void bingoHost.pause(true).catch(()=>{});toast('De regie was onderbroken. Bekijk de opgeslagen spelstand om veilig te hervatten.');}refreshLobby();
  director.tick(delta,{voiceBusy:!!speechCompletion||state.speaking||voicePhase!=='idle'});narration?.tick();showRunner?.tick(delta);bingoHost?.tick();syncDirector();
  showAudio.duck(state.speaking&&!state.speechPaused);
  if(now-lastShowBroadcast>300){lastShowBroadcast=now;broadcastShow();updateShowUI();}
 },100);
 updateShowUI();
}
async function startPreparedShow(){
 if(bingoHost?.game){await bingoHost.action(()=>bingoHost.start());return;}
 if(isShow||startingPrepared||showRunner?.active||!showPlanner?.ready||!rig3D?.character)return;
 if(director.scene==='checking'){openBingoDialog();return;}
 const token=++preparedStartToken;startingPrepared=true;updateShowUI();
 try{await showAudio.unlock();const plan=brandDefaults(await showPlanner.flush(),state.brandId),issues=planIssues(plan);if(issues.length)throw new Error(issues[0]);if(token!==preparedStartToken)return;
  await runShowAction(()=>token===preparedStartToken&&showRunner.start(plan),{keepPlan:true});if(showRunner.active){showStartedAt=performance.now();location.hash='#regie';}
 }catch(error){toast(error.message);}
 finally{startingPrepared=false;updateShowUI();}
}
async function runShowAction(action,{keepPlan=false}={}){
 if(director?.callHold){toast('Rond eerst het belmoment af.');setConsoleView('calls');return false;}
 if(bingoHost?.game?.status==='running'&&!bingoHost.recoveryConfirmed){bingoHost.production.review();return false;}
 if(director?.externalHold){toast('Het meldvenster of de uitslag loopt. Gebruik Toon kaart of Toon uitslag.');return false;}
 if(isShow||!director||!rig3D?.character)return;if(director.scene==='checking'){toast('Rond eerst de bingocontrole af.');openBingoDialog();return;}
 clearDemo();await showAudio.unlock();if(director.scene==='checking')return false;if(bingoHost?.game?.status==='running')keepPlan=true;if(!keepPlan){preparedStartToken++;showRunner?.stop();}if(!keepPlan||!showRunner?.active)director.configure(readShowForm());savePrefs();if(!showStartedAt)showStartedAt=performance.now();setMode('3d');setBackground('studio');const ok=action();if(ok===false)toast(director.drawn.length===75?'Alle 75 ballen zijn getrokken.':'Dit showmoment loopt nog. Wacht of kies een andere scène.');updateUI();return ok;
}
function handleDirectorEvent(event){
 if(event.type==='external-error'){toast(event.error?.message||'De trekking wacht op een bevestigde spelstand.');bingoHost?.poll();}
 if(event.type==='camera')setCamera(event.camera);
 if(event.type==='motion'){state.lookAt=event.lookAt||'camera';setMotion(event.motion,{keepDemo:true});}
 if(event.type==='speech'){
  narration?.cancel();try{speak(event.text,{keepDemo:true,provider:voiceProvider==='openai'?'openai':'browser'});}catch(error){toast(error.message);}
 }
 if(event.type==='sound'){showAudio?.cue(event.cue);outputBridge?.cue(event.cue);}
 if(event.type==='cancel'){outputBridge?.controls('stop');narration?.cancel();stopSpeech();showAudio?.stop();}
 if(event.type==='pause'){outputBridge?.controls('pause');pausedMotionAt=performance.now();stopped=true;pauseSpeech();showAudio?.pause();}
 if(event.type==='resume'){outputBridge?.controls('resume');if(pausedMotionAt){state.motionStart+=performance.now()-pausedMotionAt;pausedMotionAt=0;}stopped=false;resumeSpeech();showAudio?.resume();}
 if(event.type==='change'||event.type==='commit'){syncDirector();broadcastShow();updateUI();}
}
function takeSelectedScene(){if(director?.callHold){toast('Rond eerst het belmoment af.');return;}if(['still','rules','patterns','question'].includes(director.preview)){narration.scene(director.preview);setConsoleView('vlampie');return;}narration?.cancel();return runShowAction(()=>director.take());}
function syncDirector(){
 if(!director)return;state.bingoNumber=director.number;state.bingoDrawn=[...director.drawn];state.bingoPending=director.pending;state.bingoElapsed=director.scene==='draw'?director.flow?.age||0:director.pending!==null?0:1000;state.show=director.visual();state.lookAt=director.lookAt;
}
function broadcastShow(){if(director){emit('show',{...director.visual(),studio:studioSnapshot()});outputBridge?.sendLocal();}}
function receiveShow(data,transit=0){
 if(!data||!Object.hasOwn(SCENE_NAMES,data.scene))return;
 state.show={...data,age:clamp(Number(data.age)||0,0,86400)+(data.paused?0:Math.min(transit,1500)/1000),title:String(data.title||showBrand(state.brandId).title).slice(0,60),round:String(data.round||'').slice(0,60),prize:String(data.prize||'').slice(0,90),winner:String(data.winner||'').slice(0,60)};
 state.lookAt=['camera','machine','board'].includes(data.lookAt)?data.lookAt:'camera';showReceivedAt=performance.now();
}
const gameMotionClock=new GameMotionClock();
function currentShowVisual(now){let visual=isShow?{...state.show,age:(state.show?.age||0)+(state.show?.paused||stopped?0:(now-showReceivedAt)/1000)}:director?.visual()||state.show;if(!isShow&&visual?.scene==='minigame'&&!visual.paused&&!stopped)visual={...visual,age:visual.age+Math.min(.2,Math.max(0,(now-lastShowTick)/1000))};const smoothed=gameMotionClock.read(stopped&&visual?.scene==='minigame'?{...visual,paused:true}:visual,now);showAudio?.tickGame(smoothed);showAudio?.duck(state.speaking&&!state.speechPaused);return smoothed;}
function renderScenePreview(now){
 if(isShow||dashboard?.page!=='regie'||!previewReady||!previewStudio||now-lastPreviewFrame<100)return;
 const delta=Math.min(.2,(now-lastPreviewFrame)/1000);lastPreviewFrame=now;
 const id=director.preview,scene=SCENES.find(s=>s.id===id);if(!scene)return;
 previewStudio.setCamera(scene.camera,false);previewStudio.setBackground('studio');previewStudio.setEffects(state.effects);
 const age=((now-previewChosenAt)/1000)%12,show={...director.visual(),...readShowForm(),scene:id,age:Math.min(age,id==='opening'?Math.max(0,Number($('#opening-countdown').value)-.7):age),paused:false,reducedMotion:reduced};
 previewStudio.render(delta,{...state,show,stopped:false,speaking:false,mouth:{open:0},idle:state.idle,time:now/1000,motion:['opening','round','prize'].includes(id)?'welcome':id==='finale'?'cheer':'idle',age:age*1000,bingoPending:id==='draw'?1:null,lightShow:state.lightShow});
}
function updateShowUI(){
 if(!director)return;
 const s=director.visual(),checking=s.scene==='checking',live=bt(SCENE_NAMES[s.scene])||'Klaar',selected=SCENES.find(item=>item.id===director.preview),run=showRunner?.visual();
 $('#preview-scene-label').textContent=bt(selected.name);$('#preview-hint').textContent=bt(selected.hint);$('#program-scene-label').textContent=live;
 $('#take-scene').disabled=!rig3D?.character||checking||!!director.callHold;$('#take-scene').title=checking?'Rond eerst de bingocontrole af':`${bt(selected.name)} in de uitzending zetten`;
 $('#show-start').disabled=!rig3D?.character||checking||startingPrepared||!!run?.active||(!bingoHost?.game&&(!showPlanner?.ready||!!(showPlanner?.document&&planIssues(showPlanner.document).length)));$('#show-finale').disabled=!rig3D?.character||checking;$('#show-pause').disabled=checking||!!director.callHold;$('#show-bingo').disabled=!rig3D?.character||!!run?.active&&run.kind!=='round';
 $('#show-pause span').textContent=director.paused?'Hervat':'Pauzeer';$('#show-bingo span').textContent=checking?'Bingo controleren':'Bingo gemeld';
 $('#show-pause').setAttribute('aria-pressed',String(director.paused));$('#show-state').dataset.phase=checking?'checking':director.paused?'paused':'ready';
 $('#show-state').textContent=checking?'Controle':director.paused?'Gepauzeerd':run?.active?(run.waiting?'Regie nodig':'Automatisch'):director.flow?'Bezig':s.scene==='finale'?'Afgesloten':'Klaar';
 $('#timeline-next').hidden=!run?.active;$('#timeline-next').disabled=checking||startingPrepared||!!director.callHold;
 if(showPlanner){$('#planner-start').disabled=!!run?.active||startingPrepared||!showPlanner.ready||!rig3D?.character;showPlanner.setRunState({...run,blockId:showRunner.block?.id});}
 $('#live-round-context').textContent=`${s.round} · ${(s.goalIndex||0)+1}/${s.roundPatterns?.length||1} · ${s.pattern}`;$('#live-round-context').title=`${s.round} · ${(s.goalIndex||0)+1}/${s.roundPatterns?.length||1} · ${s.pattern}`;$('#live-prize-context').textContent=s.prize;$('#live-prize-context').title=s.prize;$('#live-camera').value=state.camera;
 $('#show-step-status').textContent=checking?'Wachten op de regiecontrole':director.paused?'Gepauzeerd · hervat om verder te gaan':voicePhase==='loading'?'Ballad maakt de uitspraak…':voicePhase==='ready'?'Stem klaar · tik op Stem afspelen':director.flow?`${live} · ${s.drawnCount} ballen getrokken`:s.scene==='standby'?'Kies een scène en zet hem live.':`${live} · klaar voor de volgende scène`;
 if(run?.active){if(run.kind!=='round'){$('#live-round-context').textContent=run.title;$('#live-round-context').title=run.title;}$('#show-step-status').textContent=`${run.index+1}/${run.total} · ${run.title}${run.kind==='round'?` · combinatie ${run.goal}/${run.goals}`:''} · ${checking?'kaartcontrole':director.paused?'gepauzeerd':run.waiting?'kies Volgend blok om verder te gaan':voicePhase==='loading'?'stem voorbereiden':voicePhase==='ready'?'stem klaar · tik op Stem afspelen':'tijdlijn loopt'}`;}
 $('#show-voice-play').hidden=!['ready','paused'].includes(voicePhase);$('#show-voice-play').textContent=voicePhase==='paused'?'Stem hervatten':'Stem afspelen';
 const seconds=showStartedAt?Math.floor((performance.now()-showStartedAt)/1000):0;$('#show-clock').textContent=`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
 $$('[data-scene]').forEach(button=>{const id=button.dataset.scene;button.classList.toggle('selected',id===director.preview);button.setAttribute('aria-pressed',String(id===director.preview));const onAir=id===s.scene||(id==='draw'&&s.scene==='reveal');button.classList.toggle('on-air',onAir);button.querySelector('.scene-marker').hidden=!onAir;const plate=['draw'].includes(id)?'machine':['host','board'].includes(id)?'desk':'master';const file=state.brandId!=='vlampie'?`hosts/${state.brandId}-${plate}-v36.webp`:plate==='desk'?`${state.theme==='sinterklaas'?'sinterklaas':'studio'}-desk-v17.png`:plate==='machine'?(state.theme==='sinterklaas'?'sinterklaas-machine-v12.png':'studio-machine-v11.png'):`${state.theme==='sinterklaas'?'sinterklaas':'studio'}-master-v14.png`;const spec=SCENES.find(s=>s.id===id);button.setAttribute('aria-label',bt(spec.name)+' klaarzetten');button.querySelector('.scene-thumb').style.backgroundImage=`url("assets/${file}")`;});
 $$('[data-rundown]').forEach(step=>step.classList.toggle('active',step.dataset.rundown===(s.flow==='draw'||['draw','reveal','board','checking','winner','rejected'].includes(s.scene)?'draw':s.scene==='prize'?'round':s.scene)));
 $('#show-volume-value').textContent=$('#show-volume').value+'%';$('#show-volume').style.setProperty('--fill',$('#show-volume').value+'%');
 $('#show-audio-status').textContent=!director.config.voice?'Presentatorstem uit. Showgeluid speelt in dit regievenster.':voiceProvider==='openai'&&openaiConfigured?'Ballad presenteert. Muziek wordt zachter tijdens het spreken.':'De browserstem presenteert totdat Ballad is gekoppeld. Geluid speelt in dit regievenster.';
 $('#bingo-claim-form').hidden=checking;$('#bingo-review').hidden=!checking;$('#bingo-dialog-title').textContent=checking?'Controleer de bingomelding':'Wie meldt er bingo?';
 $('#bingo-pattern-preview').hidden=!checking||!Array.isArray(s.patternCells);if(checking&&Array.isArray(s.patternCells))$('#bingo-pattern-preview').innerHTML=`<div class="pattern-mini" aria-hidden="true">${Array.from({length:25},(_,i)=>`<i class="${s.patternCells.includes(i)?'marked':''} ${i===12&&s.patternFreeCenter?'free':''}"></i>`).join('')}</div><span></span>`;if(checking&&Array.isArray(s.patternCells))$('#bingo-pattern-preview span').textContent=s.patternVariant==='rows'?'Een complete horizontale rij':s.pattern;
 if(checking){$('#bingo-review-name').textContent=s.claim.name;$('#bingo-review-card').textContent=s.claim.card?`Kaart ${s.claim.card} · ${s.pattern}`:`${s.pattern} · ${s.drawnCount} getrokken nummers`;}
 $('#bingo-approve').disabled=!checking||!$('#bingo-checked').checked;
}
function openBingoDialog(){if(bingoHost?.game?.status==='running'){setConsoleView('bingo',{focus:true});if(matchMedia('(max-width:720px)').matches)document.querySelector('.live-console').scrollIntoView({behavior:reduced?'auto':'smooth',block:'start'});return;}if(!director)return;updateShowUI();if(!$('#bingo-dialog').open)$('#bingo-dialog').showModal();if(director.scene==='checking')$('#bingo-checked').focus();else $('#bingo-name').focus();}
async function toggleShowPause(){preparedStartToken++;if(!director)return;if(bingoHost?.game?.status==='running'&&!bingoHost.recoveryConfirmed){bingoHost.production.review();return;}if(director.externalHold){toast('Het meldvenster of de uitslag houdt de trekking stil.');return;}if(bingoHost?.game?.status==='running'){try{if(director.paused)await bingoHost.pause(false);else{director.pause();await bingoHost.pause(true);return;}}catch(error){toast(error.message);return;}}if(director.paused){if(showRunner?.voiceFailed&&director.step){showRunner.voiceFailed=false;director.flow.age=0;const text=typeof director.step.speech==='function'?director.step.speech():director.step.speech;if(text)director.event('speech',{text});}director.resume();}else director.pause();}
function pauseSpeech(){
 if(activeSpeechProvider==='openai'){openaiVoice?.pause();return;}
 if(state.speaking){pausedSpeechElapsed=performance.now()-state.speechStart;clearTimeout(speechWatchdog);state.speechPaused=true;try{speechSynthesis.pause();}catch{}emit('speech-clock',{elapsed:pausedSpeechElapsed,paused:true});}
}
function resumeSpeech(){
 if(activeSpeechProvider==='openai'){if(openaiVoice?.phase!=='idle')openaiVoice?.resume();return;}
 if(state.speaking&&state.speechPaused){state.speechStart=performance.now()-pausedSpeechElapsed;state.speechPaused=false;try{speechSynthesis.resume();}catch{}const token=speechToken;speechWatchdog=setTimeout(()=>{if(token===speechToken)stopSpeech();},speechTimeout(Math.max(1000,state.speechDuration-pausedSpeechElapsed),state.speechLive));emit('speech-clock',{elapsed:pausedSpeechElapsed,paused:false});}
}

let toolsLifecycle;
function registerTools(){const context=document.modelContext;if(!context?.registerTool||isShow)return;toolsLifecycle=new AbortController();
 const defs=[
 {name:'read_vlampie_state',title:bt('Vlampie bekijken'),description:'Lees de huidige beweging, gezichtsuitdrukking en spraakstatus.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:()=>({ready,...snapshot()})},
 {name:'set_vlampie_motion',title:'Gebaar uitvoeren',description:bt('Laat Vlampie een gekozen gebaar uitvoeren op het podium.'),inputSchema:{type:'object',properties:{motion:{type:'string',enum:MOTIONS}},required:['motion'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:input=>{if(!input||!MOTIONS.includes(input.motion))throw new Error('Ongeldig gebaar.');setMotion(input.motion);return {motion:state.motion}}},
 {name:'stop_vlampie',title:bt('Vlampie stoppen'),description:bt('Stop de spraak, showdemo en bewegingen van Vlampie.'),inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:()=>{stopAll();return {stopped:true}}}
 ];for(const tool of defs){try{Promise.resolve(context.registerTool(tool,{signal:toolsLifecycle.signal})).catch(()=>{})}catch{}}
}
window.addEventListener('pagehide',event=>{narration?.cancel(true);$('#api-key').value='';cancelChat();stopSpeech(!isShow);clearDemo();cancelAnimationFrame(animationFrame);animationFrame=0;if(event.persisted)return;bingoHost?.dispose();outputBridge?.dispose();clearInterval(showTimer);showAudio?.dispose();previewStudio?.dispose();dashboard?.dispose?.();resizeObserver.disconnect();rig3D?.dispose();channel?.close();toolsLifecycle?.abort();if('speechSynthesis'in window)speechSynthesis.removeEventListener('voiceschanged',voiceList)});
window.addEventListener('pageshow',event=>{if(isShow)channel?.postMessage({kind:'get-state'});if(!event.persisted)return;lastTime=performance.now();rig3D?.resize();if(!animationFrame)animationFrame=requestAnimationFrame(draw);updateUI();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&isShow)channel?.postMessage({kind:'get-state'});});
numberGrid=createNumberGrid($('#regie-number-grid'));
dashboard=initDashboard({isShow,onNavigate:mountLiveChat,onResize:()=>requestAnimationFrame(()=>{resize();rig3D?.resize();previewStudio?.resize();})});
initShowControl();
if(!isShow){mountBrandSwitch(id=>void chooseWorld(id));document.addEventListener('choose-show-brand',e=>void chooseWorld(e.detail));}
if(!isShow)showPlanner=new ShowPlanner({onChange:()=>updateShowUI(),onStart:startPreparedShow,onNotice:toast});
if(!isShow)hostChat=new LiveChat({root:$('#regie-live-chat'),hostView:true,onVlampie:prepareLiveChatReply});
if(!isShow)bingoHost=new BingoHost({director,runner:showRunner,getPlanner:()=>showPlanner,getPresentation:()=>presentationStudio?.document||defaultPresentation(),onNotice:toast,onGame:game=>{hostChat?.setGame(game.id);if(outputBridge&&outputBridge.productionKey!==`${game.id}:${brandId(game)}:${game.production?.revision||0}`){outputBridge.productionKey=`${game.id}:${brandId(game)}:${game.production?.revision||0}`;mixProduction(productionSettings(game.production).levels);}const key=`${game.id}:${brandId(game)}:${game.status}:${game.presentationSnapshot?.frozenAt||'draft'}`;if(narration?.gameKey!==key){narration?.gameChanged(game);applyPresentation();}else if(game.status==='draft'&&narration?.draftRevision!==game.revision){narration.draftRevision=game.revision;applyPresentation();}},onChange:()=>{syncDirector();broadcastShow();updateUI();},onStage:async()=>{if(!rig3D?.character)throw new Error('De studio wordt nog geladen. Probeer zo opnieuw.');await showAudio.unlock();setMode('3d');setBackground('studio');}});
if(!isShow){
 narration=new PresentationQueue({director,speak:(text,options)=>speak(text,{...options,keepDemo:true,provider:voiceProvider==='openai'?'openai':'browser'}),stopSpeech,isVoiceBusy:()=>!!speechCompletion||state.speaking||voicePhase!=='idle',getGame:()=>bingoHost,getProfile:currentProfile,getChat:()=>hostChat,onNotice:toast,onChange:()=>{syncDirector();broadcastShow();},onStage:()=>{setMode('3d');setBackground('studio');}});
 presentationStudio=new PresentationStudio({onNotice:toast,onScene:(scene,explain)=>{narration.scene(scene,explain);setConsoleView('vlampie');location.hash='regie';},onChange:()=>{if(bingoHost?.game?.status!=='running')applyPresentation();if(bingoHost?.game&&!bingoHost.dirty)bingoHost.editor();},onTest:async source=>{const job=await narration.prepare(source,{test:true});$('#presentation-test-feedback').textContent=job?bt('Lees de reactie na. Kies daarna of Vlampie hem mag uitspreken.'):'Deze vraag wordt overgeslagen.';$('#presentation-test-answer').hidden=!job;$('#presentation-test-answer').textContent=job?.text||'';$('#presentation-test-air').hidden=!job;$('#presentation-test-air').onclick=()=>{if(!job)return;narration.add({...job,approved:true});setConsoleView('vlampie');location.hash='regie';$('#presentation-test-air').hidden=true;};}});
 $('#console-vlampie [data-narration="resume-audio"]').addEventListener('click',()=>openaiVoice?.resume());
}

function mixProduction(levels){if(outputBridge)outputBridge.mixer={...levels};openaiVoice?.setVolume(levels.voice/100);showAudio.setLevels(levels);outputBridge?.sendLocal();}
function refreshLobby(){if(!director||director.scene!=='lobby'||!bingoHost?.game)return;const g=bingoHost.game,p=productionSettings(g.production),key=`${g.id}:${p.revision}:${JSON.stringify(g.participation)}`;if(lobbyKey===key)return;lobbyKey=key;const doc=showPresentation(g),rules=director.config.rules||doc.rules;director.configure({gameStage:{type:'lobby',startsAt:p.lobby.startAt||g.date,rotateSeconds:p.lobby.rotateSeconds,message:p.lobby.message,prizes:g.plan.prizes.map(x=>({title:x.title,description:x.description})),rules:rules.map(x=>({title:x.title,text:x.text})),greetings:(g.participation||[]).filter(x=>x.greeting&&x.greetingApproved).map(x=>x.name)}});}
outputBridge=new OutputBridge({isOutput:isShow,getId:()=>bingoHost?.regieId,getGame:()=>bingoHost?.game,getSnapshot:snapshot,getShow:()=>director?{...director.visual(),studio:studioSnapshot()}:null,receive:receiveOutputMessage,showAudio,onLost:message=>{if(director&&!director.paused){director.pause();if(bingoHost)bingoHost.recoveryConfirmed=false;void bingoHost?.pause(true).catch(()=>{});toast(message);}},onNotice:toast});
if(isShow){callOutput=new CallOutput({bridge:outputBridge,onNotice:toast});outputBridge.onCallStop=()=>callOutput.emergencyStop();}
else {callHost=new CallHost({host:bingoHost,bridge:outputBridge,onNotice:toast,onPhase:syncCallPhase,beforeRing:()=>{if(director.scene==='checking'||director.pending||bingoHost.presenting||bingoHost.game?.state.window?.status==='open')throw new Error('Rond eerst de trekking of bingocontrole af.');if(speechCompletion||state.speaking||voicePhase!=='idle'||director.flow?.kind==='draw')throw new Error(bt('Wacht even tot Vlampie zijn huidige zin heeft afgerond.'));captureCallRestore();director.callHold=true;narration.cancel(true);stopSpeech();director.pause();}});bingoHost.calls=callHost;}
outputBridge.isVoiceBusy=()=>!!callHost?.held||!!speechCompletion||voicePhase!=='idle';
if(!isShow)bingoHost.production.runtime={calls:callHost,bridge:outputBridge,profile:currentProfile,mix:mixProduction,meters:()=>({voice:openaiVoice?.meter||0,...showAudio.meters}),test:async()=>{if(bingoHost.game?.status==='running')throw new Error('Gebruik de test vóór de show.');await showAudio.unlock();director.configure({gameStage:null});director.setScene('host','desk',true);showAudio.cue('intro');outputBridge.cue('intro');speak(bt('Welkom bij Vlampie’s Bingo! Dit is de korte beeld- en geluidstest. Hoor je mij duidelijk?'),{provider:voiceProvider});location.hash='#regie';},lobby:async enabled=>{if(enabled&&bingoHost.game.status!=='draft')throw new Error('Start het voorprogramma vóór de show.');if(enabled&&!productionSettings(bingoHost.game.production).lobby.enabled)throw new Error('Schakel het voorprogramma eerst in.');await showAudio.unlock();narration.cancel();director.cancel(false);director.narrationHold=false;director.configure({gameStage:null});director.setScene(enabled?'lobby':'still','wide',true);lobbyKey='';refreshLobby();syncDirector();broadcastShow();}};

function captureCallRestore(){if(!callRestore)callRestore={scene:director.scene,camera:director.camera,sceneAge:director.sceneAge,paused:director.paused,gameId:bingoHost.game?.id,epoch:bingoHost.game?.state.epoch};}
function syncCallPhase(c){
 if(!director)return;const held=ON_AIR.includes(c?.phase);
 if(held){captureCallRestore();if(!director.callHold){narration.cancel(true);stopSpeech();director.pause();}director.callHold=true;if(director.scene!=='call'){director.setScene('call','portrait',true);director.configure({callText:'',callSeconds:0,liveCall:true});}syncDirector();broadcastShow();return;}
 if(!director.callHold&&!callRestore)return;director.callHold=false;director.configure({liveCall:false});const previous=callRestore;callRestore=null;
 if(previous&&previous.gameId===bingoHost.game?.id&&previous.epoch===bingoHost.game?.state.epoch&&director.scene==='call'&&bingoHost.game?.state.window?.status!=='open'&&bingoHost.game?.state.phase!=='result'){director.setScene(previous.scene,previous.camera,true);director.sceneAge=previous.sceneAge;}
 director.pause();syncDirector();broadcastShow();
 if(c&&['ended','missed','declined'].includes(c.phase)&&previous&&!previous.paused&&(c.reason==='Vlampie heeft afscheid genomen.'||['missed','declined'].includes(c.phase))){void bingoHost.pause(false).then(()=>{if(!director.callHold){director.resume();syncDirector();broadcastShow();}}).catch(e=>toast(e.message));}
}
init();

// Still export uses the exact scene compositor without changing the live canvas.
document.addEventListener('export-show-scene',async()=>{
 const button=document.querySelector('[data-export-scene]');if(!rig3D?.character||themeLoading||worldBusy){toast('Wacht tot de studio volledig geladen is.');return;}if(button.disabled)return;button.disabled=true;const label=button.textContent;button.textContent='8K-export wordt gemaakt…';
 try{await new Promise(resolve=>requestAnimationFrame(resolve));const image=await rig3D.export8K({...state,show:director.visual(),age:performance.now()-state.motionStart});const blob=await new Promise(resolve=>image.toBlob(resolve,'image/jpeg',.96));if(!blob)throw new Error('De export is niet gelukt.');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=showBrand(state.brandId).short+'-'+director.scene+'-7680x4320.jpg';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);image.width=1;toast('De huidige scène is geëxporteerd op 8K-formaat.');}catch(error){toast(error.message);}finally{button.disabled=false;button.textContent=label;}
});

const workspaceUI=!isShow?initStudioWorkspace({getContext:()=>({game:bingoHost?.game,brand:showBrand(state.brandId)})}):null;
window.addEventListener('pagehide',e=>{if(!e.persisted)workspaceUI?.dispose();});
