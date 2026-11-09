import {LiveCallAudio} from './live-call-audio.js';

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
  if(this.sessionCall?.id===call.id){this.audio?.setSession(call,{enabled:true,voice:(this.engine.bridge.mixer?.voice??100)/100});this.setVAD(!call.aiMuted);this.checkGuestReady();this.render();return this.starting||Promise.resolve();}
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
  if(this.sessionReady)this.send({type:enabled?'session.input_audio.unmute':'session.input_audio.mute'});
 }
 greet(){
  if(this.greetingStarted||!this.sessionReady||!live(this.call)||!this.guestReady())return;
  // GPT-Live starts from the server's greeting context, with no response.create.
  this.greetingStarted=true;this.generating=false;this.setVAD(true);
 }
 event(event){
  if(event.type==='session.started'){this.sessionReady=true;this.greet();}
  if(event.type==='session.output_transcript.delta'){this.transcript=(this.transcript+String(event.delta||'')).slice(-700);if(/\b(?:je|jij|jullie)\b.{0,35}\b(?:bingo|gewonnen|winnaar|wint|winnen)\b|\b(?:prijs|bingo)\b.{0,30}\b(?:gewonnen|winnaar|voor jou|voor jullie)\b/iu.test(this.transcript)){void this.fail(Error('De vrije AI-reactie bevat een onbevestigde speluitspraak. Alleen de vaste spelserveraankondiging mag een prijs of bingo bevestigen.'));return;}}
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
  this.level=this.meter();const speaking=this.speaking,name=this.call.context?.callName||this.call.name||'Deelnemer';
  return {...base,hostId:this.call.characterId||base.hostId,speakerId:this.call.characterId||base.speakerId,camera:'host',speaking,mouth:Math.min(.95,this.level*1.25),motion:speaking?'speak':'listen',paused:false,caption:this.transcript,roundTitle:'In gesprek met '+name,pattern:null,liveCall:{name,phase:this.call.phase},show:{...base.show,scene:'call',liveCall:true,paused:false}};
 }
 async fail(error){
  if(this.failing||!this.sessionCall)return;this.failing=true;const call=this.sessionCall;this.error=error?.message||'De live-verbinding is onderbroken.';this.status='failed';
  await this.stop({block:true});this.status='failed';this.render();this.emit();
  try{if(this.api.action)await this.api.action('fail',{reason:this.error,gameId:call.gameId,callId:call.id});else await this.request('/api/live-calls',{action:'fail',reason:this.error},call);}catch{}finally{this.failing=false;}
 }
 async stop({block=true}={}){
  const call=this.sessionCall;this.epoch++;if(block&&call)this.blockedId=call.id;
  clearTimeout(this.guestWaitTimer);const wait=this.guestWait;this.guestWait=null;wait?.resolve();
  this.audio?.stopSession();this.sessionCall=null;this.level=0;this.playing=false;this.generating=false;this.greetingStarted=false;this.greetingPending=false;this.greetingGenerated=false;this.greetingPlaybackEnded=false;this.transcript='';this.realtimeId=null;this.sessionReady=false;
  const peer=this.peer,channel=this.channel;this.peer=null;this.channel=null;
  if(channel){try{if(channel.readyState==='open')channel.send(JSON.stringify({type:'session.close'}));}catch{}channel.onmessage=null;channel.onopen=null;channel.onclose=null;try{channel.close();}catch{}}
  if(peer){peer.ontrack=null;peer.onconnectionstatechange=null;try{peer.close();}catch{}}
  const bridge=this.engine.bridge;if(bridge){if(bridge.setLiveCallActive)bridge.setLiveCallActive(false);else bridge.liveCallActive=false;bridge.stopSource?.();bridge.showAudio?.setMuted?.(!(bridge.audioReady&&(bridge.latest?.routing??bridge.routing)));}
  if(this.overlay)this.overlay.hidden=true;if(this.status!=='failed')this.status='inactive';this.emit();
  const closing=Promise.allSettled([this.media.disconnect(),...(call?[this.stopRemote(call)]:[])]);this.stopping=closing;
  await closing;if(this.stopping===closing)this.stopping=null;
 }
 async dispose(){
  if(this.disposed)return;await this.stop();this.disposed=true;
  const {oldTrack,oldState,oldFailure}=this.previousHandlers;
  if(this.media.onRemoteTrack===this.trackHandler)this.media.onRemoteTrack=oldTrack;
  if(this.media.onState===this.stateHandler)this.media.onState=oldState;
  if(this.media.onFailure===this.failureHandler)this.media.onFailure=oldFailure;
  for(const track of this.programMediaStream?.getTracks?.()||[])track.stop();this.programMediaStream=null;
  await this.audio?.dispose();this.overlay?.remove();this.overlay=null;
 }
}
