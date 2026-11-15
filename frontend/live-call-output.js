import {LiveCallAudio} from './live-call-audio.js';
import {liveCallLine} from '../public/live-call-script.js';

const benignErrors=new Set(['response_cancel_not_active','input_audio_buffer_commit_empty','conversation_already_has_active_response']);
const noop=()=>{};
const live=call=>call?.transport==='livekit'&&call.phase==='live'&&call.simulated!==true;

/** One presenter session for the selected live caller, in the output window.
 * No viewer, waiting caller or backstage room constructs an OpenAI peer.
 */
export class LiveCallOutput {
 constructor({engine,media,api,onChange=noop,Audio=LiveCallAudio,Peer=globalThis.RTCPeerConnection,Stream=globalThis.MediaStream,now=()=>Date.now()}={}){
  if(!engine||!media||!api)throw Error('De live-uitvoer mist de studioverbinding.');
  Object.assign(this,{engine,media,api,onChange,Audio,Peer,Stream,now});this.call=null;this.sessionCall=null;this.epoch=0;this.level=0;this.status='inactive';this.error='';this.transcript='';this.disposed=false;this.playing=false;this.generating=false;
  if(engine.bridge){this.oldGetLiveCall=engine.bridge.getLiveCall;this.getLiveCall=()=>this.call;engine.bridge.getLiveCall=this.getLiveCall;}
  const oldTrack=media.onRemoteTrack,oldState=media.onState,oldFailure=media.onFailure;
  this.trackHandler=(track,meta)=>{oldTrack?.(track,meta);this.remoteTrack(track,meta);};
  this.stateHandler=state=>{oldState?.(state);if(this.sessionCall&&!state.connected&&['failed','disconnected','reconnecting'].includes(state.phase))void this.fail(Error('De live-verbinding is onderbroken. De nummertrekking blijft geblokkeerd.'));this.emit();};
  this.failureHandler=error=>{oldFailure?.(error);if(this.sessionCall)void this.fail(error);};
  media.onRemoteTrack=this.trackHandler;media.onState=this.stateHandler;media.onFailure=this.failureHandler;
  this.previousHandlers={oldTrack,oldState,oldFailure};
 }
 get speaking(){return this.playing||this.level>.035;}
 meter(){return this.audio?.meter()||0;}
 get programAudioStream(){return this.audio?.programAudioStream||null;}
 state(){const audible=this.audio?.context?.state==='running';return {phase:this.status,error:this.error,connected:this.status==='live'&&audible&&!!this.sessionReady,sessionStarted:!!this.realtimeId,callId:this.sessionCall?.id||null,voiceLevel:this.level,micLevel:this.audio?.meter('guest')||0,programAudioReady:!!this.programAudioStream&&audible,programStreamReady:!!this.programMediaStream&&audible,simulated:false};}
 getState(){return this.state();}
 emit(){if(!this.disposed)this.onChange(this.state());}
 mount(root){
  this.root=root;if(!root||this.overlay)return this;
  const overlay=document.createElement('div');overlay.className='mf-live-call-output';overlay.hidden=true;
  overlay.style.cssText='position:absolute;left:2.1%;top:10%;max-width:34%;padding:12px 18px;border:1px solid #e8c47c66;border-radius:13px;background:#25143cea;box-shadow:0 5px 20px #10072255;color:#fff0cf;font:600 16px/1.45 system-ui;pointer-events:none;z-index:12';
  const label=document.createElement('small'),name=document.createElement('strong');label.style.cssText='display:block;font-size:10px;letter-spacing:1.6px;color:#9ce5d8';name.style.cssText='display:block;font-size:clamp(15px,1.5vw,28px)';overlay.append(label,name);root.append(overlay);this.overlay=overlay;this.overlayLabel=label;this.overlayName=name;
  void this.ensureAudio().catch(()=>{});return this;
 }
 outputReady(){const b=this.engine.bridge;return !!this.engine.isOutput&&!!b?.active&&!!b.audioReady&&b.context?.state==='running'&&!!(b.latest?.routing??b.routing);}
 async ensureAudio(){
  const bridge=this.engine.bridge;if(!bridge?.audioReady||!bridge.context)return null;
  if(!this.audio){this.audio=new this.Audio({context:bridge.context,Stream:this.Stream});await this.audio.unlock();}
  const voice=bridge.programVoiceStream,show=(bridge.showAudio||this.engine.audio)?.programStream;
  if(voice)this.audio.addShowStream(voice,{id:'scripted-presenter',monitor:false});
  if(show)this.audio.addShowStream(show,{id:'show-music-effects',monitor:false});
  if(!this.programMediaStream&&this.root?.querySelector)this.programMediaStream=this.audio.composeProgramStream(this.root.querySelector('canvas'));
  return this.audio;
 }
 composeProgramStream(canvas){if(!this.audio)return null;return this.audio.composeProgramStream(canvas);}
 sync(call){
  if(this.disposed)return Promise.resolve();
  this.call=call||null;
  if(!live(call)||this.engine.demo){
   if(this.sessionCall||this.starting)void this.stop({block:false});
   this.status=call?.simulated?'demonstration':'inactive';this.render();this.emit();return Promise.resolve();
  }
  if(this.blockedId===call.id)return Promise.resolve();
  if(this.sessionCall&&this.sessionCall.id!==call.id){void this.stop({block:false});return Promise.resolve();}
  if(this.stopping)return this.stopping;
  if(!this.outputReady()){
   if(this.sessionCall)void this.fail(Error('Het uitzendgeluid is niet meer actief. De trekking blijft geblokkeerd.'));
   else{this.status='waiting-audio';this.render();this.emit();}return Promise.resolve();
  }
  if(this.sessionCall?.id===call.id){this.audio?.setSession(call,{enabled:true,voice:(this.engine.bridge.mixer?.voice??100)/100});this.setVAD(call.mode!=='prepared'&&!call.aiMuted);this.checkGuestReady();this.maybePrepared();this.render();return this.starting||Promise.resolve();}
  if(this.starting)return this.starting;
  const token=++this.epoch;this.sessionCall={...call,context:call.context?{...call.context}:null};this.status='connecting';this.error='';this.transcript='';this.level=0;
  const promise=this.start(call,token).catch(error=>{if(this.current(call.id,token))return this.fail(error);}).finally(()=>{if(this.starting===promise)this.starting=null;});
  this.starting=promise;this.render();this.emit();return promise;
 }
 current(id,token){return !this.disposed&&this.epoch===token&&this.sessionCall?.id===id&&this.call?.id===id&&live(this.call);}
 async start(call,token){
  const bridge=this.engine.bridge;if(bridge.setLiveCallActive)bridge.setLiveCallActive(true);else{bridge.liveCallActive=true;bridge.loadToken=null;bridge.stopSource?.();}bridge.showAudio?.setMuted?.(true);
  const audio=await this.ensureAudio();if(!audio)throw Error('Activeer eerst beeld en geluid in het uitzendvenster.');
  if(!this.current(call.id,token))return;
  audio.setSession(call,{enabled:true,voice:(bridge.mixer?.voice??100)/100});audio.setListening(false);
  await this.media.connect('live');if(!this.current(call.id,token))return;
  // Publish the presenter's silent return bus before generating the greeting,
  // so the first syllable can reach the caller as well as the programme mix.
  await this.media.publishPresenterTrack(audio.presenterStream.getAudioTracks()[0]);if(!this.current(call.id,token))return;
  // Two browsers join the live room independently. A successful output join is
  // not proof that the child can hear. Wait for their real published track and
  // the player's confirmed LiveKit playback readiness before billing an AI call.
  await this.waitForGuest(call,token);if(!this.current(call.id,token))return;
  if(!this.guestReady())throw Error('De deelnemer is nog niet hoorbaar verbonden. Controleer de verbinding; de trekking blijft geblokkeerd.');
  if(call.mode==='prepared'){
   this.sessionReady=true;this.status='live';this.render();this.emit();this.maybePrepared();return;
  }
  if(!this.Peer)throw Error('Deze browser ondersteunt de benodigde stemverbinding niet.');
  const peer=this.peer=new this.Peer();peer.addTrack(audio.aiInputStream.getAudioTracks()[0],audio.aiInputStream);
  peer.ontrack=event=>{if(!this.current(call.id,token)||this.peer!==peer)return;audio.attachPresenter(event.track);this.emit();};
  peer.onconnectionstatechange=()=>{
   if(!this.current(call.id,token)||this.peer!==peer)return;
   if(['failed','disconnected','closed'].includes(peer.connectionState))void this.fail(Error('De presentator is niet meer verbonden. De trekking blijft geblokkeerd.'));
   else if(peer.connectionState==='connected'){this.status='live';this.render();this.emit();}
  };
  const channel=this.channel=peer.createDataChannel('oai-events');
  channel.onmessage=event=>{if(!this.current(call.id,token)||this.channel!==channel)return;try{this.event(JSON.parse(event.data));}catch{}};
  channel.onopen=()=>{if(!this.current(call.id,token)||this.channel!==channel)return;if(this.sessionReady)this.greet();};
  channel.onclose=()=>{if(this.current(call.id,token)&&this.channel===channel)void this.fail(Error('De stemverbinding is gesloten. De trekking blijft geblokkeerd.'));};
  await peer.setLocalDescription(await peer.createOffer());
  if(peer.iceGatheringState&&peer.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{const done=()=>{if(peer.iceGatheringState==='complete'){clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',done);resolve();}},timer=setTimeout(()=>{peer.removeEventListener('icegatheringstatechange',done);reject(Error('De netwerkverbinding met GPT-Live kon niet worden voorbereid.'));},10000);peer.addEventListener('icegatheringstatechange',done);done();});
  if(!this.current(call.id,token))return;
  const result=await this.request('/api/live-calls/realtime',{sdp:peer.localDescription.sdp},call);
  if(!this.current(call.id,token)){await this.stopRemote(call).catch(noop);return;}
  this.realtimeId=result.realtimeId||null;
  await peer.setRemoteDescription({type:'answer',sdp:result.sdp});
  if(this.current(call.id,token)&&peer.connectionState==='connected'){this.status='live';this.render();this.emit();}
 }
 request(path,body={},call=this.call){
  const scoped={gameId:call?.gameId,callId:call?.id,...body};
  if(this.api.request)return this.api.request(path,scoped);
  if(typeof this.api==='function')return this.api(path,scoped);
  throw Error('De beveiligde bel-API is niet beschikbaar.');
 }
 stopRemote(call){return this.request('/api/live-calls/realtime-stop',{},call);}
 callAction(action,body={},call=this.call){return this.api.action?this.api.action(action,body):this.request('/api/live-calls',{action,...body},call);}
 async playPreparedLine(key,call,token){
  if(!this.current(call.id,token))return;
  while(this.current(call.id,token)&&this.call.aiMuted)await new Promise(resolve=>setTimeout(resolve,100));
  if(!this.current(call.id,token))return;
  const clip=await this.engine.bridge.preparedCallClip?.(key,call.characterId,call.id);
  if(!this.current(call.id,token))return;
  if(!clip?.bytes||clip.text!==(call.preparedLines?.[key]||liveCallLine(key)))throw Error('Het vaste belletje is nog niet vooraf geladen. Sluit het gesprek veilig af en laad de showaudio bij de voorbereiding.');
  this.transcript=clip.text;this.emit();
  await this.audio.playPrepared(clip.bytes,{isCurrent:()=>this.current(call.id,token),onStart:()=>{this.playing=true;this.emit();}});
  if(this.current(call.id,token)){this.playing=false;this.emit();}
 }
 maybePrepared(){
  const call=this.call;if(call?.mode!=='prepared'||!this.sessionReady||!this.sessionCall||this.preparedTask||!live(call)||call.aiMuted)return;
  const token=this.epoch,id=call.id;
  const task=(async()=>{
   if(!call.magicReadyAt&&!this.preparedGreetingDone){if(call.source==='winner'){try{const clip=await this.callAction('winner-greeting',{},call);if(!this.current(id,token))return;this.transcript=clip.text;await this.audio.playPrepared(Uint8Array.from(clip.bytes),{isCurrent:()=>this.current(id,token),onStart:()=>{this.playing=true;this.emit();}});this.playing=false;}catch(error){if(!this.current(id,token))return;this.error='De exacte winnaarbegroeting is niet beschikbaar. De voorbereide felicitatie wordt gebruikt.';this.emit();await this.playPreparedLine('winnerGreeting',call,token);}}else{await this.playPreparedLine('greeting',call,token);await this.playPreparedLine('choice',call,token);}if(!this.current(id,token))return;await this.callAction('magic-ready',{},call);this.preparedGreetingDone=true;}
   if(!this.current(id,token))return;
   const latest=this.call;
   if(latest.outroRequestedAt&&!this.preparedOutroDone){await this.playPreparedLine(latest.source==='winner'?'winnerThank':'thank',latest,token);if(!this.current(id,token))return;this.preparedOutroDone=true;await this.callAction('finish',{},latest);return;}
   const magic=latest.magic;
   if(magic&&!magic.playedAt&&this.preparedMagicId!==magic.id){
    this.preparedMagicId=magic.id;
    await this.playPreparedLine(magic.choice,latest,token);await this.playPreparedLine('countdown',latest,token);if(!this.current(id,token))return;
    const receipt=await this.callAction('magic-claim',{magicId:magic.id,effectId:magic.effectId},latest);if(!this.current(id,token)||receipt?.effectGranted!==true)return;
    let playedReceipt;const sound=this.audio.playMagicEffect(magic.choice,{isCurrent:()=>this.current(id,token),onStart:()=>{this.effect={id:magic.choice==='stars'?'star-shower':'wonder',instanceId:magic.id,startedAt:this.now(),duration:magic.choice==='stars'?9:6};this.emit();playedReceipt=this.callAction('magic-played',{magicId:magic.id,effectId:magic.effectId},latest);void playedReceipt.catch(noop);}});
    await sound;if(playedReceipt)await playedReceipt;
    if(this.current(id,token))this.transcript='Wat een mooie '+(magic.choice==='stars'?'sterren':'bubbels')+'!';
   }
  })().catch(error=>{if(this.current(id,token))return this.fail(error);}).finally(()=>{if(this.preparedTask===task)this.preparedTask=null;});
  this.preparedTask=task;
 }
 guestReady(){return !!this.audio?.guestTrack&&this.call?.media?.player?.connected===true&&this.call?.media?.player?.audioReady===true;}
 waitForGuest(call,token){
  if(this.guestReady())return Promise.resolve();
  return new Promise((resolve,reject)=>{this.guestWait={id:call.id,token,resolve,reject};this.guestWaitTimer=setTimeout(()=>{const wait=this.guestWait;if(wait?.id===call.id&&wait.token===token){this.guestWait=null;reject(Error('De deelnemer hoort het live-geluid nog niet. Controleer de verbinding; de trekking blijft geblokkeerd.'));}},15000);});
 }
 checkGuestReady(){const wait=this.guestWait;if(wait&&this.current(wait.id,wait.token)&&this.guestReady()){clearTimeout(this.guestWaitTimer);this.guestWait=null;wait.resolve();}if(this.channel?.readyState==='open'&&!this.greetingStarted&&this.guestReady())this.greet();}
 remoteTrack(track,meta={}){
  if(!this.sessionCall||!live(this.call)||this.sessionCall.id!==this.call.id)return false;
  const accepted=this.audio?.attachGuest(track,{...meta,identity:meta.identity,target:meta.target})||false;this.checkGuestReady();return accepted;
 }
 send(event){if(this.channel?.readyState==='open')this.channel.send(JSON.stringify(event));}
 setVAD(enabled){
  this.audio?.setListening(enabled);
  if(this.sessionReady&&this.call?.mode!=='prepared')this.send({type:enabled?'session.input_audio.unmute':'session.input_audio.mute'});
 }
 greet(){
  if(this.greetingStarted||!this.sessionReady||!live(this.call)||!this.guestReady())return;
  // GPT-Live starts from the server's greeting context, with no response.create.
  this.greetingStarted=true;this.generating=false;this.setVAD(true);
 }
 async usePreparedFallback(){
  if(this.fallingBack||!live(this.call)||this.call.mode!=='ai')return;this.fallingBack=true;
  this.audio?.setListening(false);this.audio?.setSession({...this.call,aiMuted:true},{enabled:true});this.audio?.clearPresenter();this.playing=false;this.generating=false;
  const peer=this.peer,channel=this.channel;if(peer){peer.ontrack=null;peer.onconnectionstatechange=null;}if(channel){channel.onmessage=null;channel.onclose=null;channel.onopen=null;}channel?.close?.();peer?.close?.();this.peer=null;this.channel=null;
  try{const response=await this.callAction('prepared-fallback');if(!response?.fallback||!live(response.call))throw Error('De veilige spraakovergang is niet bevestigd.');this.call=response.call;this.sessionCall={...response.call};this.sessionReady=true;this.preparedGreetingDone=false;this.error='De spontane stem week af van het Nederlands. De voorbereide Nederlandse dialoog neemt over.';this.audio.setSession(this.call,{enabled:true,voice:(this.engine.bridge.mixer?.voice??100)/100});this.maybePrepared();this.emit();}
  catch(error){await this.fail(error);}finally{this.fallingBack=false;}
 }
 event(event){
  if(event.type==='session.started'){this.sessionReady=true;this.greet();}
  if(event.type==='session.output_transcript.delta'){this.transcript=(this.transcript+String(event.delta||'')).slice(-700);if(/\b(?:hello there|how are you|congratulations|you have won|are you happy|what do you|tell me about|let us count|thank you for)\b/iu.test(this.transcript)){void this.usePreparedFallback();return;}if(/\b(?:je|jij|jullie)\b.{0,35}\b(?:bingo|gewonnen|winnaar|wint|winnen)\b|\b(?:prijs|bingo)\b.{0,30}\b(?:gewonnen|winnaar|voor jou|voor jullie)\b/iu.test(this.transcript)){if(this.call?.source==='winner'){void this.usePreparedFallback();return;}void this.fail(Error('De vrije AI-reactie bevat een onbevestigde speluitspraak. Alleen de vaste spelserveraankondiging mag een prijs of bingo bevestigen.'));return;}}
  if(event.type==='session.closed'){if(this.sessionCall)void this.fail(Error('GPT-Live heeft het gesprek beëindigd. Controleer de terugkeer naar de show.'));return;}
  if(event.type==='session.delegation.created'){
   this.send({type:'session.thinking.append',delegation_id:event.delegation_id||event.id||null,content:'Er zijn tijdens dit belmoment geen spelacties of opzoekfuncties beschikbaar. Verwijs een spelvraag kort naar de regie en hervat het vriendelijke gesprek.'});
  }
  if(event.type==='error'){void this.fail(Error('GPT-Live heeft een opdracht afgewezen. De trekking blijft geblokkeerd.'));return;}
  this.render();this.emit();
 }
 tick(){
  if(this.disposed)return;
  if(this.engine.bridge?.audioReady)void this.ensureAudio().catch(noop);
  if(this.sessionCall){
   if(!this.outputReady()){void this.fail(Error('De uitvoer is onderbroken. De trekking blijft geblokkeerd.'));return;}
   if(this.call?.liveUntil&&this.now()>=this.call.liveUntil){void this.fail(Error('De afgesproken gesprekstijd is verstreken. Controleer de terugkeer naar YouTube.'));return;}
   if(this.api.lastOK&&this.now()-this.api.lastOK>7500){void this.fail(Error('De belstatus kan niet meer worden gecontroleerd. De trekking blijft geblokkeerd.'));return;}
   if(this.greetingPending&&this.now()>this.greetingDeadline){void this.fail(Error('De begroeting kon niet hoorbaar worden afgerond. Controleer het uitzendgeluid.'));return;}
  }
  this.level=this.meter();return this.state();
 }
 render(){
  if(!this.overlay)return;const active=live(this.call)&&!!this.sessionCall&&!this.error;
  this.overlay.hidden=!active;
  if(active){this.overlayLabel.textContent=this.status==='live'?'LIVE GESPREK':'GESPREK VERBINDEN';this.overlayName.textContent=(this.call.context?.callName||this.call.name||'Deelnemer')+' × '+(this.call.characterName||'Presentator');}
 }
 stagePatch(base={}){
  if(!live(this.call)||!this.sessionCall||this.error)return base;
  // Read the local analyser for every rendered studio snapshot. Server polling
  // and heartbeats are deliberately slower and must not determine mouth motion.
  this.level=this.meter();const speaking=this.speaking&&!this.call.aiMuted,name=this.call.context?.callName||this.call.name||'Deelnemer',effect=this.effect,elapsed=effect?(this.now()-effect.startedAt)/1000:0,showCue=effect&&elapsed<effect.duration?{...effect,elapsed,hostId:this.call.characterId,source:'live-call',paused:!!this.call.aiMuted}:null;
  return {...base,hostId:this.call.characterId||base.hostId,speakerId:this.call.characterId||base.speakerId,camera:showCue?.id==='star-shower'?'wide':'host',speaking,mouth:speaking?Math.min(.95,this.level*1.25):0,motion:speaking?'speak':'listen',paused:false,caption:this.transcript,roundTitle:'In gesprek met '+name,pattern:null,showCue,liveCall:{id:this.call.id,gameId:this.call.gameId,name,phase:this.call.phase,mode:this.call.mode,characterId:this.call.characterId},show:{...base.show,scene:'call',liveCall:true,paused:false}};
 }
 async fail(error){
  if(this.failing||!this.sessionCall)return;this.failing=true;const call=this.sessionCall;this.error=error?.message||'De live-verbinding is onderbroken.';this.status='failed';
  await this.stop({block:true});this.status='failed';this.render();this.emit();
  try{if(this.api.action)await this.api.action('fail',{reason:this.error,gameId:call.gameId,callId:call.id});else await this.request('/api/live-calls',{action:'fail',reason:this.error},call);}catch{}finally{this.failing=false;}
 }
 async stop({block=true}={}){
  const call=this.sessionCall;this.epoch++;if(block&&call)this.blockedId=call.id;
  clearTimeout(this.guestWaitTimer);const wait=this.guestWait;this.guestWait=null;wait?.resolve();
  const hadRealtime=!!this.realtimeId||!!this.peer;
  this.audio?.stopSession();this.sessionCall=null;this.level=0;this.playing=false;this.generating=false;this.greetingStarted=false;this.greetingPending=false;this.greetingGenerated=false;this.greetingPlaybackEnded=false;this.transcript='';this.realtimeId=null;this.sessionReady=false;this.preparedTask=null;this.preparedGreetingDone=false;this.preparedOutroDone=false;this.preparedMagicId=null;this.effect=null;
  const peer=this.peer,channel=this.channel;this.peer=null;this.channel=null;
  if(channel){try{if(channel.readyState==='open')channel.send(JSON.stringify({type:'session.close'}));}catch{}channel.onmessage=null;channel.onopen=null;channel.onclose=null;try{channel.close();}catch{}}
  if(peer){peer.ontrack=null;peer.onconnectionstatechange=null;try{peer.close();}catch{}}
  const bridge=this.engine.bridge;if(bridge){if(bridge.setLiveCallActive)bridge.setLiveCallActive(false);else bridge.liveCallActive=false;bridge.stopSource?.();bridge.showAudio?.setMuted?.(!(bridge.audioReady&&(bridge.latest?.routing??bridge.routing)));}
  if(this.overlay)this.overlay.hidden=true;if(this.status!=='failed')this.status='inactive';this.emit();
  const closing=Promise.allSettled([this.media.disconnect(),...(call&&hadRealtime?[this.stopRemote(call)]:[])]);this.stopping=closing;
  await closing;if(this.stopping===closing)this.stopping=null;
 }
 async dispose(){
  if(this.disposed)return;await this.stop();this.disposed=true;
  const {oldTrack,oldState,oldFailure}=this.previousHandlers;
  if(this.media.onRemoteTrack===this.trackHandler)this.media.onRemoteTrack=oldTrack;
  if(this.media.onState===this.stateHandler)this.media.onState=oldState;
  if(this.media.onFailure===this.failureHandler)this.media.onFailure=oldFailure;
  if(this.engine.bridge?.getLiveCall===this.getLiveCall)this.engine.bridge.getLiveCall=this.oldGetLiveCall;
  for(const track of this.programMediaStream?.getTracks?.()||[])track.stop();this.programMediaStream=null;
  await this.audio?.dispose();this.overlay?.remove();this.overlay=null;
 }
}
