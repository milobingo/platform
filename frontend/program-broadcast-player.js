import {programBroadcastRequest} from './program-broadcast-api.js';
import {ProgramCast,castReceiverMayBeActive} from './program-cast.js';

const loadClient=()=>import('livekit-client');
const idle=()=>({source:'livekit',phase:'waiting',ready:false,playing:false,muted:true,volume:100,currentTime:null,duration:null,framePresent:false,suspended:false,autoplayBlocked:false,error:'',castActive:false,castMayBeActive:castReceiverMayBeActive(),castRestoring:castReceiverMayBeActive(),castAvailable:null,castPhase:castReceiverMayBeActive()?'restoring':'idle',castError:'',airplayAvailable:false,airplayPrepared:false,airplayActive:false,airplayPhase:'idle',airplayError:'',simulated:false});

/** Receive only the two server-approved programme tracks; never request a mic. */
export class ProgramBroadcastController{
 constructor({request=programBroadcastRequest,loadSDK=loadClient,Cast=ProgramCast,document=globalThis.document}={}){
  Object.assign(this,{request,loadSDK,Cast,document});this.listeners=new Set();this.state=idle();this.generation=0;this.tracks=new Map();this.roomHandlers=[];this.mediaHandlers=[];this.requestedAudio=false;
 }
 subscribe=listener=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
 getSnapshot=()=>this.state;
 update(patch){this.state={...this.state,...patch};for(const listener of this.listeners)listener();return this.state;}
 getInfo(){return {...this.state,observedAt:Date.now()};}
 get remoteActive(){return this.state.castActive||this.state.airplayActive;}
 setCaptionPreference(){}
 applyCaptionPreference(){return false;}
 current(generation,room=this.room){return generation===this.generation&&room===this.room&&!!this.container;}
 mount(container,{gameId,title='Milo & Friends live-uitzending',config={}}={}){
  this.unmount();this.container=container;this.gameId=gameId;this.title=title;this.config=config;this.update({...idle(),framePresent:true,phase:config.state==='ended'?'ended':'waiting'});
  const video=this.document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;video.setAttribute('aria-label',title);video.className='fam-program-video';this.video=video;container.append(video);
  const airplay=this.document.createElement('video');airplay.playsInline=true;airplay.preload='none';airplay.muted=true;airplay.setAttribute('x-webkit-airplay','allow');airplay.setAttribute('aria-hidden','true');airplay.className='fam-program-airplay-media';this.airplay=airplay;container.append(airplay);
  const bind=(target,name,fn)=>{target.addEventListener(name,fn);this.mediaHandlers.push(()=>target.removeEventListener(name,fn));};
  bind(video,'playing',()=>this.update({playing:true,ready:true,phase:this.state.suspended?'suspended':'live',error:''}));
  bind(video,'waiting',()=>{if(this.state.playing)this.update({phase:'reconnecting'});});
  bind(airplay,'webkitplaybacktargetavailabilitychanged',event=>this.update({airplayAvailable:event.availability==='available'}));
  bind(airplay,'webkitcurrentplaybacktargetiswirelesschanged',()=>void this.onAirPlayChange());
  bind(airplay,'error',()=>{if(this.state.airplayPrepared)this.update({airplayPhase:'error',airplayError:'De tv-uitzending kon niet worden afgespeeld. Kies opnieuw AirPlay of stop de verbinding.'});});
  this.cast=new this.Cast({gameId,getAccess:()=>this.castAccess(),onChange:patch=>{
   const wasRemote=this.remoteActive;this.update(patch);this.syncMute();if(wasRemote&&!this.remoteActive&&!this.state.suspended)void this.restore({play:this.requestedAudio});
  }});
  if(config.hls?.available||this.state.castMayBeActive)this.discoverCast();
  if(config.state!=='ended')void this.connect();
  return()=>this.unmount();
 }
 configure(config){
  this.config=config;
  if((config.hls?.available||this.state.castMayBeActive)&&this.cast&&!this.cast.sdk&&!this.cast.initializing)this.discoverCast();
  if(config.state==='ended'){this.generation++;this.connecting=false;void this.closeRoom();this.update({phase:'ended',playing:false,ready:false});}
  else if(this.state.phase==='ended'&&this.container)void this.connect();
 }
 discoverCast(){void this.cast.initialize().catch(()=>{if(this.state.castMayBeActive)this.update({castError:'De vorige tv-verbinding kon nog niet worden hersteld. Verbind de tv opnieuw en stop Cast voordat je een gesprek opneemt.'});});}
 permitted(publication,participant){
  if(participant?.identity!==this.credentials?.publisherIdentity)return false;
  const names=this.credentials?.programTrackNames||{},kind=publication?.kind||publication?.track?.kind,name=publication?.trackName||publication?.name;
  return (kind==='video'&&name===names.video)||(kind==='audio'&&name===names.audio);
 }
 async connect(){
  if(!this.container||this.connecting)return;
  const generation=++this.generation;this.connecting=true;await this.closeRoom();this.update({phase:'connecting',error:'',ready:false,playing:false});
  try{
   const credentials=await this.request(this.gameId,'token',{body:{}});if(generation!==this.generation||!this.container)return;
   if(!credentials?.token||!/^wss:\/\//.test(credentials.url||'')||!credentials.publisherIdentity||!credentials.programTrackNames?.audio||!credentials.programTrackNames?.video)throw Error('De server heeft geen veilige uitzendverbinding verstrekt.');
   this.credentials=credentials;this.sdk=await this.loadSDK();if(generation!==this.generation||!this.container)return;
   const room=new this.sdk.Room({adaptiveStream:false,dynacast:false,disconnectOnPageLeave:true});this.room=room;
   const bind=(key,fallback,fn)=>{const name=this.sdk.RoomEvent?.[key]||fallback;room.on(name,fn);this.roomHandlers.push(()=>room.off(name,fn));};
   bind('TrackPublished','trackPublished',(publication,participant)=>{if(this.current(generation,room))publication.setSubscribed?.(this.permitted(publication,participant));});
   bind('TrackSubscribed','trackSubscribed',(track,publication,participant)=>{if(this.current(generation,room))this.attach(track,publication,participant);});
   bind('TrackUnsubscribed','trackUnsubscribed',(track,publication)=>{if(this.current(generation,room))this.detach(publication?.trackSid||track.sid);});
   bind('Reconnecting','reconnecting',()=>{if(this.current(generation,room))this.update({phase:'reconnecting',error:'Verbinding wordt hersteld. Je spelstand blijft bewaard.'});});
   bind('SignalReconnecting','signalReconnecting',()=>{if(this.current(generation,room))this.update({phase:'reconnecting'});});
   bind('Reconnected','reconnected',()=>{if(this.current(generation,room))this.update({phase:this.tracks.size?'live':'waiting',error:''});});
   bind('Disconnected','disconnected',()=>{if(this.current(generation,room))this.update({phase:'disconnected',ready:false,playing:false,error:'De uitzendverbinding is onderbroken. Verbind opnieuw om verder te kijken.'});});
   bind('AudioPlaybackStatusChanged','audioPlaybackChanged',()=>{if(this.current(generation,room)&&room.canPlaybackAudio===false&&!this.remoteActive)this.update({autoplayBlocked:true,muted:true});});
   bind('ParticipantDisconnected','participantDisconnected',participant=>{if(this.current(generation,room)&&participant.identity===credentials.publisherIdentity)this.update({phase:'waiting',playing:false,error:''});});
   await room.connect(credentials.url,credentials.token,{autoSubscribe:false});if(!this.current(generation,room)){await room.disconnect();return;}
   for(const participant of room.remoteParticipants.values())for(const publication of participant.trackPublications.values())publication.setSubscribed?.(this.permitted(publication,participant));
   this.update({phase:this.state.playing?'live':'waiting'});
  }catch(error){if(generation===this.generation&&this.container)this.update({phase:'disconnected',error:error.message||'De uitzending kon niet verbinden.',ready:false});}
  finally{if(generation===this.generation)this.connecting=false;}
 }
 attach(track,publication,participant){
  if(!this.permitted(publication,participant)){publication.setSubscribed?.(false);return;}
  const sid=publication.trackSid||track.sid;if(this.tracks.has(sid))return;
  // One named programme video and one named mix, no extra participant tracks.
  for(const [id,entry]of this.tracks)if(entry.track.kind===track.kind)this.detach(id);
  const element=track.kind==='video'?this.video:this.document.createElement('audio');element.autoplay=true;element.muted=true;
  if(track.kind==='audio'){element.setAttribute('aria-hidden','true');this.container.append(element);}
  track.attach(element);this.tracks.set(sid,{track,element});this.syncMute();
  if(track.kind==='video')void Promise.resolve(element.play()).catch(()=>this.update({autoplayBlocked:true}));
  else if(this.requestedAudio&&!this.remoteActive&&!this.state.suspended)void this.activateAudio().catch(()=>{});
 }
 detach(sid){const entry=this.tracks.get(sid);if(!entry)return;this.tracks.delete(sid);try{entry.track.detach(entry.element);}catch{}if(entry.element!==this.video)entry.element.remove();else{this.video.srcObject=null;this.update({phase:'waiting',playing:false});}}
 syncMute(){
  const mute=this.state.suspended||this.remoteActive||this.state.castRestoring||!this.requestedAudio;
  for(const {track,element}of this.tracks.values())if(track.kind==='audio')element.muted=mute;
  this.update({muted:mute});
 }
 mute(){this.requestedAudio=false;this.syncMute();}
 async activateAudio(){
  this.requestedAudio=true;if(this.remoteActive||this.state.castRestoring||this.state.suspended){this.syncMute();return this.getInfo();}
  try{
   await this.room?.startAudio?.();this.syncMute();
   const audio=[...this.tracks.values()].filter(entry=>entry.track.kind==='audio');
   if(!audio.length)throw Error('Het uitzendgeluid is nog niet binnen. Probeer opnieuw zodra de show begint.');
   await Promise.all(audio.map(({element})=>element.play()));
   if(this.room?.canPlaybackAudio===false)throw Error('Je browser blokkeert het geluid. Tik opnieuw op Geluid aanzetten.');
   this.update({autoplayBlocked:false,muted:false,error:''});return this.getInfo();
  }catch(error){this.update({autoplayBlocked:true,muted:true,error:error.message||'Tik op Geluid aanzetten om mee te luisteren.'});for(const {track,element}of this.tracks.values())if(track.kind==='audio')element.muted=true;throw error;}
 }
 async castAccess(){
  const access=await this.request(this.gameId,'cast',{body:{}});
  const url=new URL(access?.url||'',globalThis.location?.origin||'https://invalid.local');
  if(url.protocol!=='https:'||!access.expiresAt||new Date(access.expiresAt).getTime()<=Date.now())throw Error('De tv-uitzending is nog niet beschikbaar. Laat de regie de tv-feed starten.');
  return {...access,url:url.href};
 }
 async startCast(){if(this.state.suspended)throw Error('Rond eerst je belmoment af.');if(this.state.airplayActive)throw Error('Stop eerst AirPlay voordat je Cast start.');return this.cast.start();}
 async stopCast(){try{return await this.cast.stop();}catch(error){this.update({castError:error.message,castPhase:'error'});throw error;}}
 async prepareAirPlay(){
  if(this.state.suspended||this.state.castActive)throw Error('Stop eerst je belmoment of Cast-verbinding.');
  if(typeof this.airplay?.webkitShowPlaybackTargetPicker!=='function'||!this.airplay.canPlayType('application/vnd.apple.mpegurl'))throw Error('AirPlay-video is op dit apparaat niet beschikbaar. Gebruik scherm spiegelen.');
  this.update({airplayPhase:'preparing',airplayError:''});
  try{const access=await this.castAccess();if(!this.airplay)return;this.airplay.src=access.url;this.airplay.preload='metadata';this.airplay.load();this.update({airplayPrepared:true,airplayPhase:'ready'});}
  catch(error){this.update({airplayPhase:'error',airplayError:error.message});throw error;}
 }
 showAirPlayPicker(){
  if(!this.state.airplayPrepared||this.state.suspended)throw Error('Bereid eerst de tv-weergave voor.');
  this.airplay.webkitShowPlaybackTargetPicker();this.update({airplayPhase:this.state.airplayActive?'playing':'connecting'});
 }
 async onAirPlayChange(){
  const active=this.airplay?.webkitCurrentPlaybackTargetIsWireless===true;
  if(active){
   this.update({airplayActive:true,airplayPhase:'connecting'});this.syncMute();
   if(this.state.suspended){this.airplay.pause();return;}
   try{this.airplay.muted=false;await this.airplay.play();this.update({airplayPhase:'playing',airplayError:''});}
   catch{this.update({airplayPhase:'error',airplayError:'AirPlay is verbonden, maar afspelen is nog niet bevestigd. Kies de video in de AirPlay-bediening.'});}
  }else{
   this.airplay?.pause();if(this.airplay)this.airplay.muted=true;this.update({airplayActive:false,airplayPhase:'idle'});this.syncMute();if(!this.state.suspended)await this.restore({play:this.requestedAudio});
  }
 }
 stopAirPlay(){if(!this.airplay)return;this.airplay.webkitShowPlaybackTargetPicker();this.update({airplayPhase:'stopping'});}
 async suspend(){
  this.update({suspended:true,phase:'suspended'});this.syncMute();
  // Even a non-playing/error Cast session may have an issued load whose
  // response was lost. The Cast controller owns the receiver-end proof.
  if(this.cast)await this.stopCast();
  this.airplay?.pause();
  if(this.state.airplayActive){this.stopAirPlay();throw Error('Kies deze iPhone/iPad in de AirPlay-bediening om de tv-verbinding te stoppen. Neem daarna opnieuw op; je microfoon is nog niet geopend.');}
  return {silenced:true,method:'programme-player-and-remote-stop',simulated:false};
 }
 async restore({play=false}={}){
  this.update({suspended:false,phase:this.state.playing?'live':'waiting'});this.syncMute();
  if(!this.room&&!this.connecting&&this.container)await this.connect();
  if(play&&!this.remoteActive)await this.activateAudio().catch(()=>{});return this.getInfo();
 }
 async resume(){return this.restore({play:true});}
 async closeRoom(){
  const room=this.room;this.room=null;for(const remove of this.roomHandlers)remove();this.roomHandlers=[];
  for(const id of [...this.tracks.keys()])this.detach(id);
  if(room)try{await room.disconnect();}catch{}
 }
 unmount(){
  this.generation++;this.connecting=false;this.cast?.dispose();this.cast=null;for(const remove of this.mediaHandlers)remove();this.mediaHandlers=[];
  void this.closeRoom();this.airplay?.pause();this.airplay?.remove();this.airplay=null;this.video?.remove();this.video=null;this.container=null;this.credentials=null;
 }
 dispose(){this.unmount();this.listeners.clear();}
}
