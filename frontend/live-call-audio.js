// Explicit programme mix. A backstage microphone is never a valid source.
// The AI input contains only the selected live guest (mix-minus); the LiveKit
// return contains only the presenter, so the guest never hears their own voice.
export class LiveCallAudio {
 constructor({context,Context=globalThis.AudioContext||globalThis.webkitAudioContext,Stream=globalThis.MediaStream,monitor=true}={}){
  this.context=context||null;this.Context=Context;this.Stream=Stream;this.monitor=monitor;this.ownsContext=!context;this.showSources=new Map();this.callId=null;this.phase=null;this.enabled=false;this.listening=false;this.disposed=false;
 }
 async unlock(){
  if(this.disposed)throw Error('De programmamixer is gesloten.');
  this.context??=new this.Context();
  const c=this.context;
  if(!this.programBus){
   this.programBus=c.createGain();this.programBus.gain.value=1;
   this.programDestination=c.createMediaStreamDestination();this.programBus.connect(this.programDestination);
   this.monitorBus=c.createGain();if(this.monitor)this.monitorBus.connect(c.destination);
   this.aiInputDestination=c.createMediaStreamDestination();this.presenterDestination=c.createMediaStreamDestination();
   this.guestGain=c.createGain();this.guestInputGain=c.createGain();this.presenterGain=c.createGain();this.presenterReturnGain=c.createGain();
   this.guestGain.connect(this.programBus);this.guestGain.connect(this.monitorBus);
   this.guestInputGain.connect(this.aiInputDestination);
   this.presenterGain.connect(this.programBus);this.presenterGain.connect(this.monitorBus);this.presenterReturnGain.connect(this.presenterDestination);
   this.presenterAnalyser=c.createAnalyser();this.presenterAnalyser.fftSize=256;
   this.guestAnalyser=c.createAnalyser();this.guestAnalyser.fftSize=256;
   this.gate();
  }
  await c.resume();
  if(c.state!=='running')throw Error('Activeer eerst het geluid in het uitzendvenster.');
  return this;
 }
 setSession(call,{enabled=true,voice=1}={}){
  if(this.callId!==call?.id){this.clearGuest();this.clearPresenter();this.listening=false;}
  this.callId=call?.id||null;this.phase=call?.phase||null;this.expectedGuest=call?.guestIdentity||call?.participantIdentity||null;
  this.enabled=enabled&&this.phase==='live'&&call?.transport==='livekit'&&call?.simulated!==true;
  this.muted=!!call?.muted;this.voice=Math.max(0,Math.min(1,Number(voice)||0));this.gate();
 }
 setListening(value){this.listening=!!value;this.gate();}
 gate(){
  const on=this.enabled&&!this.disposed;
  if(this.guestGain)this.guestGain.gain.value=on&&!this.muted ? .95 : 0;
  if(this.guestInputGain)this.guestInputGain.gain.value=on&&!this.muted&&this.listening?1:0;
  if(this.presenterGain)this.presenterGain.gain.value=on?(this.voice??1):0;
  if(this.presenterReturnGain)this.presenterReturnGain.gain.value=on?1:0;
 }
 attachGuest(track,{identity,target='live',removed=false}={}){
  if(removed){if(this.guestTrack===track)this.clearGuest();return false;}
  if(!this.programBus||!this.enabled||target!=='live'||!this.expectedGuest||identity!==this.expectedGuest||track?.kind!=='audio'||track.readyState==='ended')return false;
  if(this.guestTrack===track)return true;
  this.clearGuest();this.guestTrack=track;this.guestSource=this.context.createMediaStreamSource(new this.Stream([track]));
  this.guestSource.connect(this.guestGain);this.guestSource.connect(this.guestInputGain);this.guestSource.connect(this.guestAnalyser);return true;
 }
 attachPresenter(track){
  if(!this.programBus||!this.enabled||track?.kind!=='audio'||track.readyState==='ended')return false;
  if(this.presenterTrack===track)return true;
  this.clearPresenter();this.presenterTrack=track;this.presenterSource=this.context.createMediaStreamSource(new this.Stream([track]));
  this.presenterSource.connect(this.presenterGain);this.presenterSource.connect(this.presenterReturnGain);this.presenterSource.connect(this.presenterAnalyser);return true;
 }
 // Existing TTS, music and effects already monitor in the output window. Their
 // export streams enter only the programme recording, avoiding doubled audio.
 addShowStream(stream,{id=stream?.id,monitor=false}={}){
  if(!this.programBus||!stream?.getAudioTracks?.().length||!id)return false;
  const old=this.showSources.get(id);if(old?.stream===stream)return true;
  if(old){old.source.disconnect();this.showSources.delete(id);}
  const source=this.context.createMediaStreamSource(stream);source.connect(this.programBus);if(monitor)source.connect(this.monitorBus);
  this.showSources.set(id,{stream,source});return true;
 }
 clearGuest(){try{this.guestSource?.disconnect();}catch{}this.guestSource=null;this.guestTrack=null;}
 clearPresenter(){try{this.presenterSource?.disconnect();}catch{}this.presenterSource=null;this.presenterTrack=null;}
 stopSession(){this.enabled=false;this.listening=false;this.gate();this.clearGuest();this.clearPresenter();this.callId=null;this.phase=null;this.expectedGuest=null;}
 meter(kind='presenter'){
  if(!this.enabled||this.context?.state!=='running')return 0;
  const analyser=kind==='guest'?this.guestAnalyser:this.presenterAnalyser;if(!analyser||kind==='guest'&&this.muted)return 0;
  const bytes=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(bytes);
  return Math.min(1,Math.sqrt(bytes.reduce((n,value)=>n+((value-128)/128)**2,0)/bytes.length)*3);
 }
 get aiInputStream(){return this.aiInputDestination?.stream||null;}
 get presenterStream(){return this.presenterDestination?.stream||null;}
 get programAudioStream(){return this.programDestination?.stream||null;}
 composeProgramStream(canvas,{frameRate=30}={}){
  if(!canvas?.captureStream||!this.programAudioStream)return null;
  const video=canvas.captureStream(frameRate),audio=this.programAudioStream.getAudioTracks().map(track=>track.clone());
  return new this.Stream([...video.getVideoTracks(),...audio]);
 }
 async dispose(){
  if(this.disposed)return;this.stopSession();this.disposed=true;
  for(const {source} of this.showSources.values())try{source.disconnect();}catch{}this.showSources.clear();
  for(const key of ['guestGain','guestInputGain','presenterGain','presenterReturnGain','programBus','monitorBus','presenterAnalyser','guestAnalyser'])try{this[key]?.disconnect();}catch{}
  for(const bus of [this.programDestination,this.presenterDestination,this.aiInputDestination])for(const track of bus?.stream?.getTracks?.()||[])track.stop();
  if(this.ownsContext)await this.context?.close?.();
 }
}
