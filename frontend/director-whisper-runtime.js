const ACTIVE=new Set(['preparing','queued','speaking']);
const PRECALL=new Set(['preparing','ringing','backstage','staged']);
const copy=value=>value==null?value:structuredClone(value);
const issue=(message,code='whisper_invalid')=>Object.assign(new Error(message),{code});
const normalizedHint=text=>String(text).normalize('NFKC').toLocaleLowerCase('nl-NL').normalize('NFD').replace(/\p{M}/gu,'').replace(/[-’']/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();

async function requestPrepared(body,{signal}={}){
 const response=await fetch('/api/openai/director-whisper',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Milo-Director':'1'},body:JSON.stringify(body),signal});
 let data;try{data=await response.json();}catch{throw issue('De ontvangst is nog niet bevestigd. Controleer dezelfde aanvraag opnieuw.','whisper_network');}
 if(!response.ok)throw Object.assign(new Error(data.error?.message||'De regieaanwijzing is niet bevestigd.'),{status:response.status,code:data.error?.code||data.code,uncertain:data.uncertain??data.error?.uncertain,retryable:data.retryable??data.error?.retryable});
 return data;
}
// The live route distinguishes a rejected append from an unconfirmed append.
// Preserve those flags locally; neither case may automatically be replayed.
async function requestLiveWhisper(body,{signal}={}){
 const response=await fetch('/api/live-calls/whisper',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Vlampie-Call':'1'},body:JSON.stringify(body),signal});
 let data;try{data=await response.json();}catch{throw issue('De live sessie heeft de ontvangst niet bevestigd. Controleer het gesprek voordat je opnieuw verstuurt.','whisper_uncertain');}
 if(!response.ok)throw Object.assign(new Error(typeof data.error==='string'?data.error:data.error?.message||'De live sessie heeft de aanwijzing niet bevestigd.'),{status:response.status,code:data.code||data.error?.code,uncertain:data.uncertain??data.error?.uncertain,retryable:data.retryable??data.error?.retryable});
 return data;
}
const fingerprint=target=>JSON.stringify([target.identityGameId,target.production,target.characterId,target.primaryHostId,target.characterRevision,target.epoch,target.roundIndex,target.goalIndex,target.callId,target.live,target.guestKey]);
const publicTarget=target=>target?{gameId:target.gameId,production:target.production,characterId:target.characterId,name:target.name,callId:target.callId,callName:target.live?target.callName:'',live:target.live}:null;
const initial=()=>({phase:'idle',instruction:'',reply:'',target:null,requestId:null,simulated:false,message:'Een privéaanwijzing voor de actieve presentator.',error:'',waitReason:'',canRetry:false,acceptedAt:null});

/** Private operator memory only. Never pass this snapshot to stage/output/chat. */
export class DirectorWhisperRuntime{
 constructor(engine,{prepare=requestPrepared,live=requestLiveWhisper,uuid=()=>crypto.randomUUID(),now=()=>Date.now()}={}){
  Object.assign(this,{engine,prepare,live,uuid,now});this.state=initial();this.item=null;this.generation=0;this.disposed=false;this.playback=null;
 }
 snapshot(){
  const e=this.engine;
  let target=this.state.target;try{target??=publicTarget(this.target());}catch{}
  return {...this.state,target:copy(target),busy:ACTIVE.has(this.state.phase),canApply:this.state.phase==='prepared'&&this.matches(),canResume:!!this.playback&&['ready','paused'].includes(e.voicePhase)&&this.playbackAllowed()};
 }
 emit(){if(!this.disposed)this.engine.emit?.();}
 target(){
  const e=this.engine;if(e.isOutput)throw issue('Fluisteren kan alleen vanuit de regie.');
  const call=e.liveCalls?.call,active=!!call&&call.phase!=='completed';
  if(active&&!e.demo&&call.gameId!==e.game.id)throw issue('Open eerst de show die bij het actieve belmoment hoort.');
  if(active&&!PRECALL.has(call.phase)&&call.phase!=='live')throw issue('Rond eerst de terugkeer van het belmoment af.');
  if(active&&(call.switchingLive||call.realtimeStatus==='starting'))throw issue('Wacht totdat de overgang naar live is bevestigd.');
  const live=active&&call.phase==='live';
  const characterId=live?call.characterId:e.showCues?.active?.hostId||e.hostId;
  const character=e.characters?.find(c=>c.id===characterId);
  if(!character)throw issue('Kies eerst een bestaande actieve presentator.');
  if(e.production==='vlampie'?characterId!=='vlampie':characterId==='vlampie')throw issue('Deze presentator hoort bij zijn eigen productie.');
  return {gameId:e.demo?null:e.game.id,identityGameId:e.game.id,production:e.production,characterId,name:character.name||characterId,primaryHostId:e.hostId,characterRevision:e.characterRevision||0,epoch:e.game.state.epoch||'',roundIndex:e.game.state.roundIndex??-1,goalIndex:e.game.state.goalIndex??-1,callId:active?call.id:null,live,callName:live?call.context?.callName||'':'',guestKey:active?JSON.stringify([call.entryId,call.profileId,call.accountId,call.context?.callName,call.context?.pronunciation]):''};
 }
 matches(item=this.item){try{return !!item&&item.fingerprint===fingerprint(this.target());}catch{return false;}}
 validateContext({notify=false}={}){
  if(this.disposed||!this.item||this.matches())return true;
  this.cancel('De show, presentator of gast is gewijzigd. Het regieveld is gewist.',{notify,contextChanged:true});return false;
 }
 waitReason({ownedSpeech=false}={}){
  const e=this.engine,d=e.director||{},s=e.game.state,call=e.liveCalls?.call;
  if(e.liveCalls?.busy)return 'Wacht totdat de lopende belactie is bevestigd.';
  if(!ownedSpeech&&(e.voicePhase!=='idle'||e.currentSpeech))return 'Wacht tot de huidige uitspraak is afgerond.';
  if(s.pending||d.pending!=null||d.flow?.kind==='draw')return 'Wacht tot de lopende nummertrekking is afgerond.';
  if(s.window?.status==='open')return 'Wacht tot het meldvenster is afgehandeld.';
  if(s.resultId||d.scene==='checking')return 'Wacht tot de bingocontrole en uitslag zijn afgehandeld.';
  if(e.liveCalls?.onAir||d.callHold||call?.switchingLive)return 'De presentator voert nu het live gesprek.';
  if(e.showCues?.active||e.showCues?.holding||e.magic)return 'Wacht tot het bewegings- of magiemoment is afgerond.';
  if(e.showRuntime?.holding||e.calls?.held)return 'Zet de presentator eerst terug in de show.';
  if(['sync','sync-error'].includes(e.runner?.phase))return 'Wacht tot de showstand is bevestigd.';
  if(!ownedSpeech&&d.narrationHold)return 'Wacht tot de huidige presentatie is afgerond.';
  // A private pre-call holds drawing, not entertainment. Never release that hold.
  if((s.drawHold||e.liveCalls?.drawHeld)&&!(call&&PRECALL.has(call.phase)&&!call.switchingLive))return 'Wacht op de gecontroleerde terugkeer van het belmoment.';
  if(d.paused||s.paused)return 'Wacht totdat de show bewust wordt hervat.';
  return '';
 }
 playbackAllowed(){
  return !this.disposed&&!!this.playback&&this.matches()&&(this.playback.token===null||this.playback.token===this.engine.speechToken)&&!this.waitReason({ownedSpeech:true});
 }
 async send(instruction){
  if(this.disposed)throw issue('Deze regiebediening is gesloten.');
  if(ACTIVE.has(this.state.phase))throw issue('Laat de huidige aanwijzing afronden of annuleer haar eerst.');
  const text=typeof instruction==='string'?instruction.trim():'';
  if(!text||[...text].length>500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))throw issue('Gebruik 1 tot 500 tekens voor de regieaanwijzing.');
  if(this.state.phase==='uncertain'&&this.item?.target.live&&text===this.item.instruction)throw issue('De ontvangst is onzeker. Controleer eerst het gesprek en wis de oude aanwijzing voordat je bewust opnieuw verstuurt.','whisper_uncertain');
  const target=this.target();
  const item={instruction:text,requestId:this.uuid(),target,fingerprint:fingerprint(target)};
  return this.perform(item);
 }
 async retry(){
  if(!this.item||!this.state.canRetry||ACTIVE.has(this.state.phase))throw issue('Deze aanwijzing kan niet veilig opnieuw worden aangeboden. Controleer eerst de status.');
  if(!this.matches())throw issue('De show, presentator of gast is gewijzigd. Maak een nieuwe aanwijzing.');
  return this.perform(this.item);
 }
 async perform(item){
  this.controller?.abort();const controller=this.controller=new AbortController(),generation=++this.generation,e=this.engine;
  this.item=item;this.state={...initial(),phase:'preparing',instruction:item.instruction,requestId:item.requestId,target:publicTarget(item.target),simulated:!!e.demo,message:item.target.live?'Aanwijzing wordt aan de actieve sessie aangeboden.':'De presentator bereidt een passende reactie voor.'};this.emit();
  try{
   let result;
   if(e.demo){
    await Promise.resolve();
    result=item.target.live?{status:'accepted',requestId:item.requestId,characterId:item.target.characterId,gameId:null,callId:item.target.callId,acceptedAt:this.now(),simulated:true}:{status:'prepared',requestId:item.requestId,characterId:item.target.characterId,gameId:null,contextCallId:item.target.callId,reply:demoReply(item.instruction),simulated:true};
   }else{
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(item.target.live?20000:45000)]);
    result=item.target.live?await this.live({role:'host',clientId:e.clientId,gameId:item.target.gameId,callId:item.target.callId,characterId:item.target.characterId,instruction:item.instruction,requestId:item.requestId},{signal}):await this.prepare({gameId:item.target.gameId,characterId:item.target.characterId,instruction:item.instruction,requestId:item.requestId},{signal});
   }
   if(this.disposed||generation!==this.generation)return this.snapshot();
   if(!this.validateContext())return this.snapshot();
   if(result?.requestId!==item.requestId||result.characterId!==item.target.characterId||result.gameId!==item.target.gameId||!!result.simulated!==!!e.demo)throw issue('De ontvangst hoort niet bij deze presentator of show. Er wordt niets uitgesproken.','whisper_mismatch');
   if(item.target.live){
    if(result.status!=='accepted'||result.callId!==item.target.callId||!Number.isFinite(result.acceptedAt))throw issue('De live sessie heeft deze aanwijzing niet bevestigd.','whisper_uncertain');
    this.state={...this.state,phase:'accepted',acceptedAt:result.acceptedAt,message:e.demo?'Simulatie: ontvangst in de voorbeeldsessie. Geen verbinding of audio gestart.':'Ontvangen in de actieve sessie. Dit bevestigt nog niet dat de presentator de aanwijzing heeft opgevolgd.'};
   }else{
    const reply=typeof result.reply==='string'?result.reply.trim():'';
    if(result.status!=='prepared'||result.contextCallId!==item.target.callId||!reply||[...reply].length>500)throw issue('Er kwam geen complete, passende reactie terug. Er wordt niets uitgesproken.','whisper_reply_invalid');
    const spoken=normalizedHint(reply),hint=normalizedHint(item.instruction);
    if(hint&&(spoken===hint||hint.length>=20&&spoken.includes(hint)))throw issue('De reactie herhaalde de privéaanwijzing en is tegengehouden.','whisper_instruction_echo');
    item.reply=reply;this.state={...this.state,phase:'prepared',reply,message:e.demo?'Simulatie: voorbeeldreactie ter controle. Er is niets uitgesproken.':'Reactievoorstel ter controle. Alleen na jouw expliciete keuze wordt dit uitgesproken.',waitReason:''};
   }
   this.emit();return this.snapshot();
  }catch(error){
   if(this.disposed||generation!==this.generation)return this.snapshot();
   if(!this.validateContext())return this.snapshot();
   const uncertain=error.uncertain===true||error.code==='whisper_uncertain'||item.target.live&&error.uncertain!==false&&!['whisper_rejected','whisper_invalid','whisper_mismatch'].includes(error.code);
   this.state={...this.state,phase:uncertain?'uncertain':'failed',error:error.message||'De aanwijzing is niet bevestigd.',message:uncertain?'Ontvangst is onzeker; de aanwijzing wordt niet automatisch opnieuw verstuurd.':'De aanwijzing is niet toegepast.',waitReason:'',canRetry:!item.target.live&&error.retryable!==false&&!error.status&&(error.code==='whisper_network'||error.name==='TypeError'||error.name==='TimeoutError')};
   this.emit();throw error;
  }finally{if(this.controller===controller)this.controller=null;}
 }
 apply(){
  if(this.disposed||this.state.phase!=='prepared'||!this.item?.reply)throw issue('Bereid eerst een reactie voor en controleer het voorstel.');
  if(!this.validateContext())throw issue('De show, presentator of gast is gewijzigd. Bereid een nieuw voorstel voor.');
  this.state={...this.state,phase:'queued',message:this.state.simulated?'Simulatie: voorbeeldreactie wordt bij een veilig moment afgerond, zonder audio.':'Reactie goedgekeurd. Wacht op een veilig moment na de huidige uitspraak.',waitReason:this.waitReason()};this.emit();return this.snapshot();
 }
 tick(){
  if(this.disposed||!this.validateContext()||!this.item)return;
  const e=this.engine;
  if(this.playback){
   if(this.playback.token!==null&&e.speechToken!==this.playback.token){this.cancel('Een andere uitspraak heeft de reactie vervangen.');return;}
   const priority=this.waitReason({ownedSpeech:true});
   if(priority){
    if(!this.playback.priorityPaused){this.playback.priorityPaused=true;Promise.resolve(e.voice.pause?.()).catch(()=>{});}
    if(this.state.phase!=='queued'||this.state.waitReason!==priority){this.state={...this.state,phase:'queued',waitReason:priority,message:'De goedgekeurde reactie wacht op een veilig moment.'};this.emit();}
    return;
   }
   this.playback.priorityPaused=false;
   const phase=e.voicePhase==='playing'?'speaking':'queued',waitReason=e.voicePhase==='ready'?'De stem wacht op audiotoestemming.':e.voicePhase==='paused'?'De uitspraak is gepauzeerd.':'De eigen personagestem wordt voorbereid.';
   if(this.state.phase!==phase||this.state.waitReason!==waitReason){this.state={...this.state,phase,waitReason:phase==='speaking'?'':waitReason,message:phase==='speaking'?'De presentator reageert nu.':'De reactie wordt klaargezet voor de stem.'};this.emit();}
   return;
  }
  if(this.state.phase!=='queued')return;
  const reason=this.waitReason();
  if(reason){if(this.state.waitReason!==reason){this.state={...this.state,waitReason:reason};this.emit();}return;}
  if(this.state.simulated){this.state={...this.state,phase:'completed',waitReason:'',message:'Simulatie afgerond. Alleen de voorbeeldreactie in de regie is getoond; geen audio, caption of uitzending gestart.'};this.emit();return;}
  this.playback={token:null};this.starting=true;this.state={...this.state,waitReason:'De eigen personagestem wordt voorbereid.',message:'De reactie wordt klaargezet voor de stem.'};
  try{e.speak(this.item.reply,this.item.target.characterId,'ai',false);if(this.playback)this.playback.token=e.speechToken;}
  catch(error){this.speechFailed(error.message);}
  finally{this.starting=false;}
  this.emit();
 }
 speechStopped({replacement=false}={}){
  if(this.starting||this.disposed)return;
  if(this.playback||!replacement&&(ACTIVE.has(this.state.phase)||this.state.phase==='prepared'))this.cancel('De aanwijzing is gestopt vanuit de regie.',{notify:false,stopPlayback:false});
 }
 speechEnded(){
  if(!this.playback||this.disposed)return;
  if(this.playback.token!==null&&this.playback.token!==this.engine.speechToken)return;
  this.playback=null;this.state={...this.state,phase:'completed',message:'De uitspraak is afgerond.',waitReason:'',error:'',canRetry:false};
 }
 speechFailed(message){
  if(!this.playback||this.disposed)return false;
  this.playback=null;this.state={...this.state,phase:'failed',message:'De reactie is niet volledig uitgesproken.',error:message||'De stem kon niet worden afgespeeld.',waitReason:'',canRetry:false};
  return true;
 }
 async resume(){
  if(!this.validateContext())throw issue('De show, presentator of gast is gewijzigd. Bereid een nieuw voorstel voor.');
  const reason=this.playback?this.waitReason({ownedSpeech:true}):'';
  if(reason){this.tick();throw issue(reason);}
  if(!this.snapshot().canResume)throw issue('Er staat geen stem klaar die op toestemming wacht.');
  await this.engine.voice.resume();this.tick();return this.snapshot();
 }
 cancel(message='De aanwijzing is geannuleerd.',{notify=true,contextChanged=false,stopPlayback=true}={}){
  if(this.disposed)return this.snapshot();
  const wasLiveSending=this.item?.target.live&&this.state.phase==='preparing',wasAccepted=this.state.phase==='accepted',ownsPlayback=!!this.playback&&(this.playback.token===null||this.playback.token===this.engine.speechToken);
  this.generation++;this.controller?.abort();this.controller=null;this.playback=null;
  this.state={...this.state,phase:wasLiveSending&&!contextChanged?'uncertain':'cancelled',instruction:'',reply:'',target:null,message:wasLiveSending&&!contextChanged?'Verzending gestopt. Ontvangst bij de live sessie is niet bevestigd en kan niet worden teruggehaald.':wasAccepted&&!contextChanged?'Regieveld gewist. De ontvangen aanwijzing kan niet uit de live sessie worden teruggehaald.':message,error:'',waitReason:'',canRetry:false};
  if(contextChanged||!wasLiveSending)this.item=null;
  if(ownsPlayback&&stopPlayback)this.engine.stopSpeech({whisperInternal:true,silent:true});
  if(notify)this.emit();return this.snapshot();
 }
 dispose(){if(this.disposed)return;this.cancel('Regie gesloten.',{notify:false});this.disposed=true;this.controller?.abort();this.item=null;this.state=initial();}
}

function demoReply(instruction){
 if(/rust|langzaam|tempo/i.test(instruction))return 'We nemen rustig de tijd. Kijk nog maar even goed naar jullie boekjes.';
 if(/afron|afscheid|zwaai|stop/i.test(instruction))return 'Wat was dit gezellig! Nog één grote zwaai naar iedereen die meedoet.';
 if(/vraag|kleur/i.test(instruction))return 'Welke kleur vinden jullie het allermooist? Ik ben heel benieuwd!';
 if(/spanning|spannend/i.test(instruction))return 'Oeh, ik voel dat er iets bijzonders aankomt. Zitten jullie er klaar voor?';
 return 'Wat fijn dat jullie allemaal meedoen. We maken er samen een magisch moment van!';
}
