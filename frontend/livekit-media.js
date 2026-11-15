// Real, lazy LiveKit media. Private conversation has a different room and
// never exposes a track to the program/AI callback.
const loadClient=()=>import('livekit-client');
const noop=()=>{};
const BACKSTAGE_HOST=new Set(['preparing','ringing','backstage','staged']);
const BACKSTAGE_PLAYER=new Set(['backstage','staged']);
const mediaError=(message,code='livekit_media')=>Object.assign(new Error(message),{code});
const callId=call=>call?.id||'';
const stopTrack=track=>{try{track?.stop?.();}catch{}};
const rawTrack=track=>track?.mediaStreamTrack||track;

export class LiveKitMedia{
 constructor({role,api,getCall=()=>api?.call,getGameId,onRemoteTrack=noop,onState=noop,onFailure=noop,loadSDK=loadClient,audioParent,heartbeatMs=3000,setInterval:interval=globalThis.setInterval,clearInterval:clear=globalThis.clearInterval}={}){
  if(!['host','player','output'].includes(role))throw mediaError('Ongeldige rol voor de audioverbinding.');
  Object.assign(this,{role,api,getCall,getGameId,onRemoteTrack,onState,onFailure,loadSDK,audioParent,heartbeatMs,interval,clear});this.epoch=0;this.disposed=false;this.room=null;this.sdk=null;this.session=null;this.remoteTracks=new Map();this.localMic=null;this.presenter=null;this.handlers=[];this.elements=new Set();this.listeners=new Set();this.state=Object.freeze({phase:'disconnected',target:null,connected:false,micReady:false,micPublished:false,micMuted:true,remoteCount:0,audioReady:false,error:'',simulated:false});
 }
 subscribe=listener=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
 getState=()=>this.state;
 getSnapshot=()=>this.state;
 emit(patch={}){this.state=Object.freeze({...this.state,...patch,remoteCount:this.remoteTracks.size,simulated:false});if(this.disposed)return this.state;try{this.onState(this.state);}catch{}for(const listener of this.listeners)try{listener(this.state);}catch{}return this.state;}
 allowedPhase(target,call=this.getCall()){
  if(!call||call.transport&&call.transport!=='livekit')return false;
  return target==='live'?call.phase==='live':target==='backstage'&&(this.role==='host'?BACKSTAGE_HOST:BACKSTAGE_PLAYER).has(call.phase)&&this.role!=='output';
 }
 assertTarget(target,call=this.getCall()){
  if(this.disposed)throw mediaError('De audioverbinding is gesloten.');
  if(!['backstage','live'].includes(target)||!this.allowedPhase(target,call))throw mediaError(target==='backstage'&&this.role==='output'?'Privéaudio is niet toegankelijk voor het uitzendvenster.':'Deze audioruimte kan in de huidige belstap niet worden geopend.','livekit_scope');
 }
 current(epoch,room=this.room){return !this.disposed&&epoch===this.epoch&&room===this.room;}
 sessionValid(){return !!this.session&&callId(this.getCall())===this.session.callId&&this.allowedPhase(this.session.target);}
 roleIdentities(credentials,target){
  const participant=credentials.participantIdentity||credentials.guestIdentity;
  const expected=target==='backstage'?[this.role==='host'?participant:credentials.hostIdentity]:this.role==='output'?[participant]:this.role==='player'?[credentials.outputIdentity]:[participant,credentials.outputIdentity];
  const allowed=new Set((credentials.allowedRemoteIdentities||[]).filter(v=>typeof v==='string'&&v));
  // Require server-issued allowlists rather than trusting participant metadata.
  return new Set(expected.filter(v=>typeof v==='string'&&v&&allowed.has(v)&&v!==credentials.identity));
 }
 permitted(track,publication,participant){
  if(!this.sessionValid()||!this.state.connected||!this.session.allowed.has(participant?.identity))return false;
  const kind=track?.kind||publication?.kind,source=publication?.source||track?.source;
  const audio=this.sdk?.Track?.Kind?.Audio||'audio',microphone=this.sdk?.Track?.Source?.Microphone||'microphone';
  return kind===audio&&source===microphone;
 }
 eventName(key,fallback){return this.sdk.RoomEvent?.[key]||fallback;}
 bind(room,key,fallback,fn){const event=this.eventName(key,fallback);room.on(event,fn);this.handlers.push([room,event,fn]);}
 playbackReady(){
  const allowed=this.state.connected&&!!this.room&&this.room.canPlaybackAudio!==false&&this.room.canPlayAudio!==false;
  // The first greeting must wait for the actual return audio subscription,
  // not merely a room whose autoplay permission happens to be granted.
  return !!allowed&&(this.role!=='player'||this.session?.target!=='live'||[...this.remoteTracks.values()].some(entry=>entry.kind==='presenter'&&entry.playbackReady));
 }
 async connect(target){
  const call=this.getCall();this.assertTarget(target,call);
  if(this.room&&this.state.connected&&this.session?.callId===call.id&&this.session.target===target)return this.state;
  const epoch=++this.epoch;await this.closeRoom();if(this.disposed||epoch!==this.epoch)throw mediaError('De belverbinding is intussen gesloten.','livekit_stale');
  this.emit({phase:'connecting',target,connected:false,error:'',audioReady:false});
  let room;
  try{
   const credentials=await this.api.token(target);
   if(this.disposed||epoch!==this.epoch||callId(this.getCall())!==call.id||!this.allowedPhase(target))throw mediaError('Deze oproep is intussen gewijzigd.','livekit_stale');
   if(!credentials?.token||!/^wss:\/\//.test(credentials.url||'')||credentials.role&&credentials.role!==this.role||credentials.target&&credentials.target!==target)throw mediaError('De server heeft geen passende audioverbinding verstrekt.','livekit_credentials');
   const allowed=this.roleIdentities(credentials,target);if(!allowed.size)throw mediaError('De toegestane gesprekspartner kon niet worden vastgesteld.','livekit_permissions');
   this.sdk=await this.loadSDK();if(this.disposed||epoch!==this.epoch)throw mediaError('De belverbinding is intussen gesloten.','livekit_stale');
   room=new this.sdk.Room({adaptiveStream:false,dynacast:true,webAudioMix:false,stopLocalTrackOnUnpublish:true,disconnectOnPageLeave:true});this.room=room;this.session={callId:call.id,target,identity:credentials.identity,room:credentials.room,allowed,participantIdentity:credentials.participantIdentity||credentials.guestIdentity,outputIdentity:credentials.outputIdentity,hostIdentity:credentials.hostIdentity};
   const failed=reason=>{if(!this.current(epoch,room))return;this.fail(mediaError(reason,'livekit_disconnected'),epoch);};
   this.bind(room,'TrackPublished','trackPublished',(publication,participant)=>{if(!this.current(epoch,room))return;publication.setSubscribed?.(this.permitted(publication.track,publication,participant));});
   this.bind(room,'TrackSubscribed','trackSubscribed',(track,publication,participant)=>{if(!this.current(epoch,room))return;this.addRemote(track,publication,participant);});
   this.bind(room,'TrackUnsubscribed','trackUnsubscribed',(track,publication)=>this.removeRemote(publication?.trackSid||track?.sid||rawTrack(track)?.id));
   this.bind(room,'ParticipantDisconnected','participantDisconnected',participant=>{if(this.current(epoch,room)&&this.session?.allowed.has(participant?.identity))failed('De verbinding met de gesprekspartner is weggevallen. De trekking blijft geblokkeerd.');});
   this.bind(room,'Reconnecting','reconnecting',()=>failed('De gespreksverbinding is onderbroken. Controleer de verbinding voordat je verdergaat.'));
   this.bind(room,'SignalReconnecting','signalReconnecting',()=>failed('De verbinding met de belserver is onderbroken. De trekking blijft geblokkeerd.'));
   this.bind(room,'Disconnected','disconnected',()=>failed('De audioverbinding is gesloten. De trekking blijft geblokkeerd.'));
   this.bind(room,'MediaDevicesError','mediaDevicesError',()=>failed('De microfoon is niet meer beschikbaar. Controleer de toestemming en het apparaat.'));
   this.bind(room,'TrackSubscriptionFailed','trackSubscriptionFailed',()=>failed('Het geluid van de gesprekspartner kon niet worden ontvangen.'));
   this.bind(room,'AudioPlaybackStatusChanged','audioPlaybackChanged',()=>{if(this.current(epoch,room)&&this.role!=='output')this.emit({audioReady:this.playbackReady()});});
   this.bind(room,'LocalTrackUnpublished','localTrackUnpublished',publication=>{if(this.current(epoch,room)&&publication?.track===this.localMic)this.emit({micPublished:false,micMuted:true,micReady:rawTrack(this.localMic)?.readyState!=='ended'});});
   await room.connect(credentials.url,credentials.token,{autoSubscribe:false,maxRetries:0});
   if(!this.current(epoch,room)||!this.sessionValid())throw mediaError('Deze oproep is intussen gewijzigd.','livekit_stale');
   this.emit({phase:'connected',connected:true,target,audioReady:false});
   // Subscriptions that existed before connect do not emit TrackPublished.
   for(const participant of room.remoteParticipants?.values?.()||[])for(const publication of participant.trackPublications?.values?.()||[]){const accepted=this.permitted(publication.track,publication,participant);publication.setSubscribed?.(accepted);if(accepted&&publication.track)this.addRemote(publication.track,publication,participant);}
   if(this.role==='player'||this.role==='host'&&target==='backstage')await this.openMicrophone(epoch,room,{muted:this.role==='host'||!!this.getCall()?.muted});
   if(!this.current(epoch,room))throw mediaError('De audioverbinding is intussen gesloten.','livekit_stale');
   if(this.role!=='output')try{await this.startAudio();}catch{this.emit({audioReady:false,error:'Activeer het gespreksgeluid met de knop in dit venster.'});}
   this.startHeartbeat(epoch,room);void this.heartbeat().catch(error=>{if(this.current(epoch,room))this.fail(error,epoch);});
   return this.state;
  }catch(error){if(epoch===this.epoch&&!this.disposed){await this.closeRoom();this.emit({phase:'failed',connected:false,micReady:false,micPublished:false,audioReady:false,error:this.safeError(error)});this.notifyFailure(error,target);}else if(room&&room!==this.room)await room.disconnect?.(true).catch(noop);throw error;}
 }
 safeError(error){if(error?.name==='NotAllowedError'||error?.name==='PermissionDeniedError')return 'Microfoontoestemming ontbreekt. Geef toestemming in je browser en probeer opnieuw.';return error?.message||'De audioverbinding kon niet worden geopend.';}
 notifyFailure(error,target=this.session?.target||this.state.target){try{const result=this.onFailure(Object.assign(error instanceof Error?error:new Error(this.safeError(error)),{target}));result?.catch?.(noop);}catch{}}
 fail(error,epoch=this.epoch){if(epoch!==this.epoch||this.disposed)return;this.epoch++;const target=this.session?.target||this.state.target;this.clearRemote();void this.closeRoom();this.emit({phase:'failed',target,connected:false,micReady:false,micPublished:false,audioReady:false,error:this.safeError(error)});this.notifyFailure(error,target);}
 async openMicrophone(epoch,room,{muted=false}={}){
  if(this.role==='output'||this.role==='host'&&this.session?.target!=='backstage')throw mediaError('Dit venster mag geen eigen microfoon naar de uitzending sturen.','livekit_permissions');
  const track=await this.sdk.createLocalAudioTrack({echoCancellation:true,noiseSuppression:true,autoGainControl:true});
  if(!this.current(epoch,room)||!this.sessionValid()){stopTrack(track);throw mediaError('De microfoonaanvraag hoort bij een eerdere oproep.','livekit_stale');}
  this.localMic=track;if(muted)await track.mute();
  const publication=await room.localParticipant.publishTrack(track,{source:this.sdk.Track?.Source?.Microphone||'microphone',name:this.role==='host'?'private-director':'selected-participant',audioPreset:{maxBitrate:32000},dtx:true,red:true});
  if(!this.current(epoch,room)||!this.sessionValid()){await room.localParticipant.unpublishTrack(track,true).catch(noop);stopTrack(track);throw mediaError('De microfoonaanvraag is geannuleerd.','livekit_stale');}
  this.micPublication=publication;this.emit({micReady:rawTrack(track)?.readyState!=='ended',micPublished:true,micMuted:!!muted});
  const raw=rawTrack(track);this.micEnded=()=>{if(this.current(epoch,room))this.fail(mediaError('De microfoon is gestopt. Controleer je apparaat voordat je het belmoment hervat.','microphone_ended'),epoch);};raw?.addEventListener?.('ended',this.micEnded,{once:true});
 }
 addRemote(track,publication,participant){
  if(!this.permitted(track,publication,participant)){publication?.setSubscribed?.(false);try{track.detach?.();}catch{}return;}
  const raw=rawTrack(track),key=publication?.trackSid||track.sid||raw?.id;if(!raw||!key||this.remoteTracks.has(key))return;
  const target=this.session.target,identity=participant.identity,meta={track:raw,sdkTrack:track,publication,identity,target,kind:identity===this.session.outputIdentity?'presenter':'participant',removed:false,elements:[]};
  this.remoteTracks.set(key,meta);
  if(this.role==='output'&&target==='live')try{this.onRemoteTrack(raw,meta);}catch(error){this.fail(error);return;}
  else{
   const element=track.attach?.();if(element){element.autoplay=true;element.playsInline=true;element.dataset&&(element.dataset.livekitAudio=target);element.setAttribute?.('aria-label',target==='backstage'?'Privégesprek met de regie':'Rechtstreeks studiogeluid');const parent=this.audioParent||globalThis.document?.body;parent?.appendChild?.(element);meta.elements.push(element);this.elements.add(element);void Promise.resolve(element.play?.()).then(()=>{if(this.remoteTracks.get(key)!==meta||!this.sessionValid())return;meta.playbackReady=true;this.emit({audioReady:this.playbackReady()});void this.heartbeat().catch(noop);}).catch(()=>{if(this.remoteTracks.get(key)===meta){meta.playbackReady=false;this.emit({audioReady:false});}});}
  }
  this.emit();
 }
 removeRemote(key){const entry=this.remoteTracks.get(key);if(!entry)return;this.remoteTracks.delete(key);if(this.role==='output'&&entry.target==='live')try{this.onRemoteTrack(entry.track,{...entry,removed:true});}catch{}for(const element of entry.elements){try{element.pause?.();element.srcObject=null;element.remove?.();}catch{}this.elements.delete(element);}try{entry.sdkTrack.detach?.();}catch{}this.emit(this.role==='output'?{}:{audioReady:this.playbackReady()});}
 clearRemote(){for(const key of [...this.remoteTracks.keys()])this.removeRemote(key);}
 async setMuted(muted){
  if(this.role==='output')throw mediaError('De regie dempt de deelnemer via de server. Het uitzendvenster heeft geen eigen microfoon.');
  if(!this.room||!this.state.connected||!this.sessionValid())throw mediaError('Open eerst de geldige audioverbinding.');
  if(this.role==='host'&&this.session.target!=='backstage')throw mediaError('De regiemicrofoon blijft buiten de live-uitzending.','livekit_permissions');
  const epoch=this.epoch,room=this.room;
  if(!this.localMic){if(muted)return this.emit({micMuted:true});await this.openMicrophone(epoch,room,{muted:false});}
  else if(muted)await this.localMic.mute();else{
   const publications=room.localParticipant.audioTrackPublications;
   const published=publications?.values?Array.from(publications.values()).some(p=>p.track===this.localMic):true;
   if(rawTrack(this.localMic)?.readyState==='ended'){stopTrack(this.localMic);this.localMic=null;await this.openMicrophone(epoch,room,{muted:false});}
   else{if(!published)await room.localParticipant.publishTrack(this.localMic,{source:this.sdk.Track?.Source?.Microphone||'microphone',name:'selected-participant',dtx:true});await this.localMic.unmute();}
  }
  if(this.current(epoch,room))this.emit({micMuted:!!muted,micReady:rawTrack(this.localMic)?.readyState!=='ended',micPublished:true});return this.state;
 }
 setPrivateMic(enabled){if(this.role!=='host'||this.session?.target!=='backstage')return Promise.reject(mediaError('Privé spreken kan alleen in de besloten regieruimte.','livekit_scope'));return this.setMuted(!enabled);}
 async startAudio(){
  if(this.role==='output')throw mediaError('Programmageluid wordt uitsluitend in de studio-audiomixer geactiveerd.','livekit_scope');
  if(!this.room||!this.state.connected||!this.sessionValid())throw mediaError('Open eerst de geldige gespreksverbinding.');
  const room=this.room,epoch=this.epoch;
  try{await room.startAudio?.();for(const entry of this.remoteTracks.values()){for(const element of entry.elements)await element.play?.();entry.playbackReady=entry.elements.length>0;}}catch{if(this.current(epoch,room))this.emit({audioReady:false});throw mediaError('De browser houdt het gespreksgeluid nog tegen. Druk opnieuw op Gespreksgeluid activeren.','livekit_autoplay');}
  if(!this.current(epoch,room)||!this.sessionValid())throw mediaError('De geluidsaanvraag hoort bij een eerdere oproep.','livekit_stale');
  const allowed=room.canPlaybackAudio!==false&&room.canPlayAudio!==false;this.emit({audioReady:this.playbackReady(),...(allowed?{error:''}:{})});
  if(!allowed)throw mediaError('Het gespreksgeluid is nog niet vrijgegeven. Controleer het geluid van dit venster.','livekit_autoplay');
  await this.heartbeat();return this.state;
 }
 async publishPresenterTrack(track){
  if(this.role!=='output'||this.session?.target!=='live'||!this.state.connected||!this.sessionValid())throw mediaError('De presentator kan alleen in het actieve livegesprek worden gekoppeld.','livekit_scope');
  if(!track||track.kind!=='audio'||track.readyState==='ended'||typeof track.clone!=='function')throw mediaError('Er is geen geldige presentatorstem om door te geven.');
  if(this.presenter?.original===track)return this.presenter.publication;
  const epoch=this.epoch,room=this.room;if(this.presenter){await room.localParticipant.unpublishTrack(this.presenter.local,true).catch(noop);stopTrack(this.presenter.clone);this.presenter=null;}
  const clone=track.clone(),local=new this.sdk.LocalAudioTrack(clone,{},true);this.presenter={original:track,clone,local};
  try{const publication=await room.localParticipant.publishTrack(local,{source:this.sdk.Track?.Source?.Microphone||'microphone',name:'presenter-audio',dtx:true,red:true,audioPreset:{maxBitrate:48000}});if(!this.current(epoch,room)||!this.sessionValid()){await room.localParticipant.unpublishTrack(local,true).catch(noop);stopTrack(clone);throw mediaError('De presentatorkoppeling hoort bij een eerdere oproep.','livekit_stale');}this.presenter.publication=publication;this.emit({audioReady:true});return publication;}catch(error){stopTrack(clone);if(this.presenter?.clone===clone)this.presenter=null;throw error;}
 }
 setAudioReady(ready){return this.emit({audioReady:!!ready&&this.state.connected});}
 async heartbeat(){if(!this.state.connected||!this.sessionValid())return;const extra={connected:true,target:this.session.target,micReady:this.role==='output'?true:this.role==='host'&&this.session.target==='live'?true:this.state.micReady,audioReady:this.state.audioReady,...(this.role==='host'&&this.session.target==='backstage'&&this.getCall()?.brandId==='milo'?{playerTrackReceived:this.remoteTracks.size>0}:{})};return this.api.heartbeat?this.api.heartbeat(extra):this.api.action?.('heartbeat',extra);}
 startHeartbeat(epoch,room){if(!this.heartbeatMs||!this.interval)return;this.heartbeatTimer=this.interval(()=>{if(!this.current(epoch,room))return;if(!this.sessionValid()){void this.disconnect();return;}void this.heartbeat().catch(error=>{if(this.current(epoch,room))this.fail(error,epoch);});},this.heartbeatMs);this.heartbeatTimer?.unref?.();}
 async closeRoom(){
  if(this.heartbeatTimer){this.clear?.(this.heartbeatTimer);this.heartbeatTimer=null;}
  const room=this.room;this.room=null;for(const [source,event,fn] of this.handlers)source.off?.(event,fn);this.handlers=[];this.clearRemote();
  const mic=this.localMic,presenter=this.presenter;rawTrack(mic)?.removeEventListener?.('ended',this.micEnded);this.micEnded=null;this.localMic=null;this.micPublication=null;this.presenter=null;
  stopTrack(mic);stopTrack(presenter?.local);stopTrack(presenter?.clone);
  for(const element of this.elements){try{element.pause?.();element.srcObject=null;element.remove?.();}catch{}}this.elements.clear();
  this.session=null;if(room)try{await room.disconnect(true);}catch{}
 }
 async disconnect(){this.epoch++;await this.closeRoom();if(!this.disposed)this.emit({phase:'disconnected',target:null,connected:false,micReady:false,micPublished:false,micMuted:true,audioReady:false,error:''});}
 async dispose(){if(this.disposed)return;this.disposed=true;this.epoch++;await this.closeRoom();this.state=Object.freeze({...this.state,phase:'disconnected',target:null,connected:false,micReady:false,micPublished:false,micMuted:true,remoteCount:0,audioReady:false,error:'',simulated:false});this.listeners.clear();this.onState=noop;this.onRemoteTrack=noop;this.onFailure=noop;}
}

export async function runLiveKitPreflight({api,gameId,profileId,technicalContext,onStatus=noop,onLevel=noop,signal,loadSDK=loadClient,mediaDevices=globalThis.navigator?.mediaDevices,AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext,sampleMs=1500,timeoutMs=12000}={}){
 if(!mediaDevices?.getUserMedia)throw mediaError('Deze browser kan geen microfoon openen. Gebruik een recente browser via HTTPS.','microphone_unavailable');
 if(signal?.aborted)throw mediaError('De verbindingstest is geannuleerd.','livekit_stale');
 let stream,context,source,analyser,room,sampleTimer,deadline,aborted=false,timedOut=false,peak=0;
 const check=()=>{if(aborted||signal?.aborted)throw mediaError('De verbindingstest is geannuleerd.','livekit_stale');};
 const abort=()=>{aborted=true;for(const t of stream?.getTracks?.()||[])stopTrack(t);void room?.disconnect?.(true);};signal?.addEventListener?.('abort',abort,{once:true});
 try{
  onStatus('Geef microfoontoestemming en zeg een paar woorden. Er wordt niets opgenomen of verstuurd.');
  // The raw microphone is measured locally, never attached/published to LiveKit.
  const opening=mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  opening.then(value=>{if(aborted||signal?.aborted)for(const track of value.getTracks())stopTrack(track);},noop);
  stream=await opening;check();if(!stream.getAudioTracks().some(t=>t.readyState!=='ended'))throw mediaError('Er is geen actieve microfoon gevonden.');
  if(!AudioContext)throw mediaError('Deze browser kan de microfoon niet meten. Probeer een andere browser.');
  context=new AudioContext();await context.resume();source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();analyser.fftSize=512;source.connect(analyser);
  await new Promise((resolve,reject)=>{const start=Date.now(),values=new Float32Array(analyser.fftSize);const sample=()=>{try{check();analyser.getFloatTimeDomainData(values);const rms=Math.sqrt(values.reduce((sum,n)=>sum+n*n,0)/values.length);peak=Math.max(peak,rms);onLevel(Math.min(1,rms*5));if(Date.now()-start>=sampleMs){resolve();return;}sampleTimer=setTimeout(sample,45);}catch(error){reject(error);}};sample();});
  if(peak<.003)throw mediaError('Er is nog geen duidelijk microfoongeluid gehoord. Controleer je microfoon en probeer opnieuw.','microphone_silent');
  for(const track of stream.getTracks())stopTrack(track);source.disconnect();source=null;await context.close();context=null;
  check();onStatus('Microfoon werkt. De beveiligde internetverbinding wordt nu kort getest…');
  const data=api?.preflight?await api.preflight(profileId,technicalContext):await requestPreflight(api,{gameId,profileId,technicalContext});check();
  if(!data?.token||!/^wss:\/\//.test(data.url||''))throw mediaError('De LiveKit-koppeling is nog niet klaar voor een echte verbindingstest.');
  const sdk=await loadSDK();check();room=new sdk.Room({adaptiveStream:false,dynacast:true,webAudioMix:false,disconnectOnPageLeave:true});
  const openingRoom=room,connecting=room.connect(data.url,data.token,{autoSubscribe:false,maxRetries:0});connecting.then(()=>{if(aborted||timedOut||signal?.aborted)void openingRoom.disconnect(true);},noop);
  await Promise.race([connecting,new Promise((_,reject)=>{deadline=setTimeout(()=>{timedOut=true;reject(mediaError('De LiveKit-verbindingstest duurde te lang. Controleer je netwerk.','livekit_timeout'));},timeoutMs);})]);
  check();await room.disconnect(true);room=null;onLevel(0);onStatus('Microfoon en LiveKit-verbinding zijn echt gecontroleerd. Houd de app geopend om een oproep te ontvangen.');
  return {microphone:true,connection:true,micChecked:true,connectionChecked:true,peakLevel:peak,checkedAt:Date.now(),simulated:false};
 }catch(error){if(error?.name==='NotAllowedError'||error?.name==='PermissionDeniedError')throw mediaError('Microfoontoestemming ontbreekt. Geef toestemming in de browser en test opnieuw.','microphone_permission');throw error;}
 finally{clearTimeout(sampleTimer);clearTimeout(deadline);signal?.removeEventListener?.('abort',abort);for(const track of stream?.getTracks?.()||[])stopTrack(track);try{source?.disconnect();}catch{}try{await context?.close?.();}catch{}try{await room?.disconnect?.(true);}catch{}onLevel(0);}
}
async function requestPreflight(api,body){if(api?.request)return api.request('/api/livekit/preflight',body);throw mediaError('Open de spelersapp opnieuw om de verbinding te testen.');}
