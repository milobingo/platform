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
   this.guestGain=c.createGain();this.guestInputGain=c.createGain();this.presenterGain=c.createGain();this.presenterReturnGain=c.createGain();this.preparedGain=c.createGain();this.preparedReturnGain=c.createGain();
   this.guestGain.connect(this.programBus);this.guestGain.connect(this.monitorBus);
   this.guestInputGain.connect(this.aiInputDestination);
   this.presenterGain.connect(this.programBus);this.presenterGain.connect(this.monitorBus);this.presenterReturnGain.connect(this.presenterDestination);
   this.preparedGain.connect(this.programBus);this.preparedGain.connect(this.monitorBus);this.preparedReturnGain.connect(this.presenterDestination);
   this.presenterAnalyser=c.createAnalyser();this.presenterAnalyser.fftSize=256;
   this.guestAnalyser=c.createAnalyser();this.guestAnalyser.fftSize=256;
   this.gate();
  }
  await c.resume();
  if(c.state!=='running')throw Error('Activeer eerst het geluid in het uitzendvenster.');
  return this;
 }
 setSession(call,{enabled=true,voice=1}={}){
  if(this.callId!==call?.id){this.clearGuest();this.clearPresenter();this.stopPrepared();this.listening=false;}
  this.callId=call?.id||null;this.phase=call?.phase||null;this.expectedGuest=call?.guestIdentity||call?.participantIdentity||null;
  this.enabled=enabled&&this.phase==='live'&&call?.transport==='livekit'&&call?.simulated!==true;
  this.muted=!!call?.muted;this.aiMuted=!!call?.aiMuted;this.prepared=call?.mode==='prepared';this.voice=Math.max(0,Math.min(1,Number(voice)||0));this.gate();
  if(this.preparedTask){if(this.aiMuted)this.pausePrepared();else if(this.enabled)this.resumePrepared();}
 }
 setListening(value){this.listening=!!value;this.gate();}
 gate(){
  const on=this.enabled&&!this.disposed;
  if(this.guestGain)this.guestGain.gain.value=on&&!this.muted ? .95 : 0;
  if(this.guestInputGain)this.guestInputGain.gain.value=on&&!this.prepared&&!this.muted&&!this.aiMuted&&this.listening?1:0;
  if(this.presenterGain)this.presenterGain.gain.value=on&&!this.aiMuted?(this.voice??1):0;
  if(this.presenterReturnGain)this.presenterReturnGain.gain.value=on&&!this.aiMuted?1:0;
  if(this.preparedGain)this.preparedGain.gain.value=on&&!this.aiMuted?(this.voice??1):0;
  if(this.preparedReturnGain)this.preparedReturnGain.gain.value=on&&!this.aiMuted?1:0;
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
 async playPrepared(bytes,{isCurrent=()=>true,onStart=()=>{}}={}){
  const id=this.callId;if(!this.enabled||!this.prepared||!isCurrent())throw Error('Het voorbereide belgeluid is niet actief.');
  const data=bytes instanceof ArrayBuffer?bytes.slice(0):bytes?.buffer?.slice(bytes.byteOffset||0,(bytes.byteOffset||0)+bytes.byteLength);
  if(!data)throw Error('Het voorbereide stemfragment ontbreekt.');
  const buffer=await this.context.decodeAudioData(data);if(!this.enabled||this.callId!==id||!isCurrent())throw Error('Het belmoment is inmiddels gesloten.');
  return this.playPreparedBuffer(buffer,{isCurrent,onStart});
 }
 playPreparedBuffer(buffer,{isCurrent=()=>true,onStart=()=>{}}={}){
  if(!this.enabled||!this.prepared||this.context?.state!=='running'||!isCurrent())return Promise.reject(Error('Het voorbereide belgeluid kan nu niet afspelen.'));
  this.stopPrepared();return new Promise((resolve,reject)=>{this.preparedTask={buffer,offset:0,resolve,reject,isCurrent,onStart,started:false,source:null};this.resumePrepared();});
 }
 playMagicEffect(choice,{isCurrent=()=>true,onStart=()=>{}}={}){
  if(!['stars','bubbles'].includes(choice))return Promise.reject(Error('Kies sterren of bubbels.'));
  // Original fixed chime, constructed locally: available without a provider,
  // and sent through exactly the same public programme/presenter return buses.
  const rate=this.context.sampleRate||48000,duration=choice==='stars'?1.3:1.05,buffer=this.context.createBuffer(1,Math.ceil(rate*duration),rate),data=buffer.getChannelData(0),notes=choice==='stars'?[523.25,659.25,783.99,1046.5]:[392,587.33,440,698.46];
  for(let n=0;n<data.length;n++){const t=n/rate;let value=0;for(let i=0;i<notes.length;i++){const age=t-i*.16;if(age>=0&&age<.55)value+=Math.sin(2*Math.PI*notes[i]*age)*(Math.min(1,age/.018))*Math.exp(-age*8)*.13;}data[n]=value;}
  return this.playPreparedBuffer(buffer,{isCurrent,onStart});
 }
 pausePrepared(){const task=this.preparedTask,source=task?.source;if(!source)return;task.offset+=Math.max(0,this.context.currentTime-task.startedAt);task.source=null;this.preparedSource=null;source.onended=null;try{source.stop();source.disconnect();}catch{}}
 resumePrepared(){const task=this.preparedTask;if(!task||task.source||this.aiMuted||!this.enabled)return;if(!task.isCurrent()){this.stopPrepared();return;}if(task.offset>=task.buffer.duration){this.preparedTask=null;task.resolve();return;}const source=this.context.createBufferSource();source.buffer=task.buffer;source.connect(this.preparedGain);source.connect(this.preparedReturnGain);source.connect(this.presenterAnalyser);task.source=source;task.startedAt=this.context.currentTime;this.preparedSource=source;source.onended=()=>{if(this.preparedTask!==task||task.source!==source)return;this.preparedSource=null;this.preparedTask=null;try{source.disconnect();}catch{}task.resolve();};try{source.start(0,task.offset);if(!task.started){task.started=true;task.onStart();}}catch(e){this.preparedTask=null;this.preparedSource=null;try{source.disconnect();}catch{}task.reject(e);}}
 stopPrepared(){const task=this.preparedTask,source=this.preparedSource;this.preparedTask=null;this.preparedSource=null;if(source){source.onended=null;try{source.stop();source.disconnect();}catch{}}task?.reject(Object.assign(Error('Het belgeluid is gestopt.'),{code:'call_audio_stopped'}));}
 stopSession(){this.enabled=false;this.listening=false;this.gate();this.stopPrepared();this.clearGuest();this.clearPresenter();this.callId=null;this.phase=null;this.expectedGuest=null;}
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
  for(const key of ['guestGain','guestInputGain','presenterGain','presenterReturnGain','preparedGain','preparedReturnGain','programBus','monitorBus','presenterAnalyser','guestAnalyser'])try{this[key]?.disconnect();}catch{}
  for(const bus of [this.programDestination,this.presenterDestination,this.aiInputDestination])for(const track of bus?.stream?.getTracks?.()||[])track.stop();
  if(this.ownsContext)await this.context?.close?.();
 }
}
