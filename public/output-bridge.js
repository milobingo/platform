// Authenticated network relay plus a low-latency local channel. One audio output.
export class OutputBridge{
 constructor({isOutput=false,getId,getGame=()=>null,getSnapshot=()=>null,getShow=()=>null,receive=()=>{},showAudio,onLost=()=>{},onNotice=()=>{}}){Object.assign(this,{isOutput,getId,getGame,getSnapshot,getShow,receive,showAudio,onLost,onNotice});this.offset=0;this.id=crypto.randomUUID();this.seq=0;this.events=[];this.seen=new Set();this.enabled=isOutput;this.routing=false;this.mixer={voice:100,music:25,effects:50};this.command=null;this.ack=null;this.latest=null;this.lastPoll=0;this.lastPublish=0;try{this.channel=new BroadcastChannel('vlampie-output-v1');}catch{this.channel=null;}if(this.channel)this.channel.onmessage=({data})=>{if(data.kind==='packet'&&isOutput&&this.latest?.producer?.id===data.clientId)this.consume(data.state);if(data.kind==='ack'&&!isOutput&&this.latest?.output?.id===data.clientId)this.acceptAck(data.ack);};if(isOutput)this.mount();this.timer=setInterval(()=>this.tick(),500);}
 get clientId(){return this.isOutput?this.id:this.getId?.()||this.id;}
 get connected(){return !!this.latest?.output?.audioReady&&this.latest.output.until>Date.now()+this.offset;}
 async api(body){const r=await fetch('/api/output',{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json','X-Vlampie-Output':'1'}:{},body:body?JSON.stringify({...body,clientId:this.clientId}):undefined,signal:AbortSignal.timeout(7000)});const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error||'Uitzendverbinding niet beschikbaar.'),{status:r.status});this.offset=(data.serverTime||Date.now())-Date.now();this.latest=data.state;return data.state;}
 mount(){const panel=document.createElement('div');panel.className='output-unlock';panel.innerHTML='<strong>Uitzendvenster · 16:9</strong><p>Activeer geluid vóór je dit venster in OBS vastlegt.</p><button type="button">Beeld & geluid activeren</button><small role="status">Alleen toegankelijk voor de host.</small>';document.body.append(panel);this.panel=panel;panel.querySelector('button').onclick=async()=>{try{this.context??=new AudioContext();this.gain??=this.context.createGain();this.programDestination??=this.context.createMediaStreamDestination();this.analyser??=this.context.createAnalyser();this.analyser.fftSize=256;this.gain.connect(this.analyser);this.analyser.connect(this.context.destination);this.analyser.connect(this.programDestination);await this.context.resume();await this.showAudio.unlock();this.audioReady=this.context.state==='running';await this.heartbeat();panel.hidden=true;this.active=true;}catch(e){this.audioReady=false;panel.querySelector('small').textContent=e.message;}};}
 connect(){this.enabled=true;return this.publish();}
 async route(enabled){if(this.isVoiceBusy?.()||this.pending)throw new Error('Wacht tot de uitspraak klaar is of stop eerst de stem voordat je de geluidsroute wisselt.');if(enabled){await this.connect();if(!this.connected)throw new Error('Open eerst het uitzendvenster en activeer daar beeld & geluid.');}this.routing=!!enabled;this.showAudio?.setMuted?.(this.routing);await this.publish();}
 cue(cue){if(!this.enabled)return;this.events.push({id:crypto.randomUUID(),kind:'cue',cue,at:Date.now()});this.events=this.events.filter(e=>e.at>Date.now()-10000).slice(-30);this.sendLocal();}
 controls(kind){if(!this.enabled)return;this.events.push({id:crypto.randomUUID(),kind,at:Date.now()});this.events=this.events.slice(-30);this.sendLocal();}
 state(){const {show:unused,...snapshot}=this.getSnapshot()||{};const show=this.getShow();if(show?.gameStage?.result){const r=show.gameStage.result,entry=e=>({bookId:e.bookId,name:e.name,ticket:e.ticket});show.gameStage={...show.gameStage,result:{...r,winner:entry(r.winner),entrants:r.entrants.map(entry)}};}return {producer:{id:this.clientId},seq:++this.seq,publishedAt:Date.now(),snapshot,show,events:this.events,voice:this.command,mixer:this.mixer,routing:this.routing};}
 sendLocal(){if(!this.enabled||this.isOutput)return;this.channel?.postMessage({kind:'packet',clientId:this.clientId,state:this.state()});}
 async publish(){if(this.publishing||!this.enabled||this.isOutput)return;this.publishing=true;try{const s=this.state();await this.api({action:'publish',...s,gameId:this.getGame()?.id});this.lastPublish=Date.now();this.acceptAck(this.latest?.output?.voiceAck);}finally{this.publishing=false;}}
 async heartbeat(){const s=await this.api({action:'output-heartbeat',audioReady:!!this.audioReady,seq:this.receivedSeq||0,voiceAck:this.ack?{...this.ack,elapsed:this.voiceElapsed}:null,meters:{voice:this.meter(),...this.showAudio?.meters}});this.lastHeartbeat=Date.now();if(this.ack)this.channel?.postMessage({kind:'ack',clientId:this.id,ack:{...this.ack,elapsed:this.voiceElapsed}});return s;}
 async tick(){if(!this.enabled||this.busy)return;this.busy=true;try{if(this.isOutput){const s=this.active?await this.heartbeat():await this.api();this.consume(s);if(s?.publishedAt&&Date.now()+this.offset-s.publishedAt>8000){this.loseOutput('Verbinding met de regie verloren. Hervat eerst vanuit het hersteloverzicht.');}}else{await this.publish();if(this.routing&&!this.connected){this.fail('Het uitzendgeluid is niet meer verbonden.');this.onLost('Uitzendverbinding verloren. De show is gepauzeerd.');}}this.lastPoll=Date.now();}catch(e){this.error=e.message;if(this.isOutput&&this.active&&(e.status===409||Date.now()-(this.lastHeartbeat||0)>6500)){this.loseOutput(e.message);}if(this.routing&&Date.now()-this.lastPublish>7000){this.fail(e.message);this.onLost('Uitzendverbinding onderbroken. Controleer beeld & geluid.');}}finally{this.busy=false;}}
 loseOutput(message){this.active=false;this.audioReady=false;this.cancelOutputVoice();this.showAudio.setMuted(true);this.showAudio.stop();this.receive({kind:'stop',payload:{},sentAt:Date.now()});if(this.panel){this.panel.hidden=false;this.panel.querySelector('small').textContent=message;}}
 consume(s){if(!s)return;if(this.active&&s.output&&s.output.id!==this.id){this.loseOutput('Een ander venster verzorgt nu het uitzendgeluid.');return;}const key=`${s.producer?.id}:${s.seq}`;if(this.lastKey===key)return;if(this.producer===s.producer?.id&&s.seq<(this.receivedSeq||0))return;this.producer=s.producer?.id;this.receivedSeq=s.seq;this.lastKey=key;this.mixer=s.mixer||this.mixer;this.showAudio.setLevels(this.mixer);this.showAudio.setMuted(!s.routing||!this.audioReady||this.liveCallActive);if(this.gain)this.gain.gain.value=s.routing?this.mixer.voice/100:0;
  const sentAt=s.publishedAt||Date.now();if(s.snapshot)this.receive({kind:'snapshot',payload:s.snapshot,sentAt});if(s.show)this.receive({kind:'show',payload:s.show,sentAt});
  for(const e of s.events||[]){if(this.seen.has(e.id))continue;this.seen.add(e.id);if(e.kind==='call-stop')this.onCallStop?.();if(this.seen.size>200)this.seen.delete(this.seen.values().next().value);if(!s.routing||!this.audioReady||Date.now()+this.offset-e.at>1500)continue;if(e.kind==='cue')this.showAudio.cue(e.cue);if(e.kind==='pause')this.showAudio.pause();if(e.kind==='resume')this.showAudio.resume();if(e.kind==='stop')this.showAudio.stop();}
  if(s.routing&&this.audioReady&&!this.liveCallActive)this.applyVoice(s.voice);else this.cancelOutputVoice();
 }
 voiceCurrent(id,token){return this.voiceId===id&&this.loadToken===token&&!this.liveCallActive&&this.active!==false&&this.audioReady!==false;}
 setLiveCallActive(active){this.liveCallActive=!!active;if(active)this.cancelOutputVoice('Het stemfragment is gestopt voor het livegesprek.');}
 cancelOutputVoice(message=''){
  const id=this.voiceId;this.loadToken=null;this.voiceAbort?.abort();this.voiceAbort=null;this.buffer=null;this.started=undefined;this.playbackOffset=0;this.stopSource();
  if(message&&id&&this.ack?.id===id&&!['ended','error'].includes(this.ack.status))this.setAck(id,'error',message);
 }
 async applyVoice(command){
  this.voiceRequestedPhase=command?.phase;
  if(this.liveCallActive){this.cancelOutputVoice();return;}
  if(!command||command.phase==='stop'){this.cancelOutputVoice();return;}
  if(this.voiceId!==command.id){
   this.cancelOutputVoice();this.voiceId=command.id;const token=this.loadToken=command.id;const controller=this.voiceAbort=new AbortController();this.setAck(command.id,'loading');
   try{
    const r=await fetch('/api/openai/clips/'+command.clip,{credentials:'same-origin',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])});
    if(!r.ok)throw new Error('Het stemfragment kan niet worden geladen.');
    const bytes=await r.arrayBuffer();if(!this.voiceCurrent(command.id,token))return;
    const b=await this.context.decodeAudioData(bytes);if(!this.voiceCurrent(command.id,token))return;
    if(!Number.isFinite(b.duration)||b.duration>120)throw new Error('Ongeldig stemfragment.');
    this.buffer=b;this.voiceText=command.text;this.setAck(command.id,'ready');
   }catch(e){if(this.voiceCurrent(command.id,token))this.setAck(command.id,'error',e.message);}finally{if(this.voiceAbort===controller)this.voiceAbort=null;}
   return;
  }
  const token=this.loadToken;if(!this.buffer||!this.voiceCurrent(command.id,token))return;
  if(command.phase==='pause'&&this.ack?.status==='playing'){
   this.playbackOffset=this.voiceElapsed/1000;this.started=undefined;this.stopSource();this.setAck(command.id,'paused');return;
  }
  if(command.phase==='play'&&['ready','paused'].includes(this.ack?.status)){
   this.ack.status='starting';
   try{await this.context.resume();if(!this.voiceCurrent(command.id,token))return;if(this.context.state!=='running')throw new Error('Klik in het uitzendvenster om geluid toe te staan.');}
   catch(e){if(this.voiceCurrent(command.id,token))this.setAck(command.id,'error',e.message);return;}
   // A cancelled decode/resume must never resurrect scripted speech over a live
   // guest. Pausing also stops only this source, never the shared audio context.
   if(!this.voiceCurrent(command.id,token))return;
   if(this.voiceRequestedPhase!=='play'){this.setAck(command.id,'paused');return;}
   this.stopSource();const source=this.source=this.context.createBufferSource();source.buffer=this.buffer;source.connect(this.gain);this.started=this.context.currentTime;
   source.onended=()=>{if(this.source!==source||!this.voiceCurrent(command.id,token))return;this.playbackOffset=this.buffer.duration;this.started=undefined;this.setAck(command.id,'ended');source.disconnect();this.source=null;};
   source.start(0,this.playbackOffset||0);this.setAck(command.id,'playing');this.receive({kind:'speech-start',payload:{text:command.text,duration:this.buffer.duration*1000},sentAt:Date.now()});
  }
 }

 setAck(id,status,error=''){this.ack={id,status,error,elapsed:this.voiceElapsed};this.channel?.postMessage({kind:'ack',clientId:this.id,ack:this.ack});}
 get programVoiceStream(){return this.programDestination?.stream||null;}
 get voiceElapsed(){return Math.max(0,((this.playbackOffset||0)+(this.context&&this.started!==undefined?this.context.currentTime-this.started:0))*1000);}
 stopSource(){if(this.source){this.source.onended=null;try{this.source.stop();}catch{}this.source.disconnect();this.source=null;}}
 meter(){if(!this.analyser)return 0;const a=new Uint8Array(this.analyser.fftSize);this.analyser.getByteTimeDomainData(a);return Math.min(1,Math.sqrt(a.reduce((n,v)=>n+((v-128)/128)**2,0)/a.length)*3);}
 get remote(){if(!this.routing)return null;return {play:(...args)=>this.play(...args),pause:()=>{clearTimeout(this.timeout);if(this.command)this.command.phase='pause';this.remotePlaying=false;this.sendLocal();},resume:()=>this.resumeVoice(),stop:()=>this.cancelVoice(),getElapsed:()=>Math.min(this.command?.duration||120000,(this.remoteElapsed||0)+(this.remotePlaying?Date.now()-(this.ackReceivedAt||Date.now()):0))};}
 play(clip,text,duration,onStart,{canPlay=()=>true,onBlocked=()=>{}}={}){this.cancelVoice();if(!this.connected)return Promise.reject(new Error('Het uitzendvenster heeft nog geen geluid geactiveerd.'));if(!/^[a-f0-9]{64}$/.test(clip||''))return Promise.reject(new Error('Dit fragment kan niet naar de uitzending worden gestuurd.'));this.remoteElapsed=0;this.remotePlaying=false;this.command={id:crypto.randomUUID(),clip,text,duration,phase:'prepare'};this.sendLocal();return new Promise((resolve,reject)=>{this.pending={id:this.command.id,resolve,reject,onStart,canPlay,onBlocked};this.armTimeout(duration+25000);});}
 resumeVoice(){
  if(!this.command||!this.pending)return false;
  let allowed=false;try{allowed=this.pending.canPlay?.()!==false;}catch{}
  if(!allowed){clearTimeout(this.timeout);this.command.phase='pause';this.remotePlaying=false;this.sendLocal();this.pending?.onBlocked?.();return false;}
  this.command.phase='play';this.armTimeout(Math.max(0,(this.command.duration||0)-(this.remoteElapsed||0))+25000);this.sendLocal();return true;
 }
 armTimeout(ms){clearTimeout(this.timeout);this.timeout=setTimeout(()=>this.fail('Het uitzendvenster bevestigt de stem niet. Controleer het geluid.'),ms);}
 acceptAck(ack){if(!ack||ack.id!==this.pending?.id)return;this.remoteElapsed=ack.elapsed||0;this.ackReceivedAt=Date.now();this.remotePlaying=ack.status==='playing';if(ack.status==='ready'&&this.command.phase==='prepare')this.resumeVoice();if(ack.status==='playing'&&!this.pending.started){this.pending.started=true;this.pending.onStart();}if(ack.status==='ended'){clearTimeout(this.timeout);const p=this.pending;this.pending=null;p.resolve();}if(ack.status==='error')this.fail(ack.error||'Uitzendgeluid kon niet starten.');}
 cancelVoice(){clearTimeout(this.timeout);if(this.command)this.command.phase='stop';const p=this.pending;this.pending=null;p?.reject(Object.assign(new Error('Geannuleerd'),{name:'AbortError'}));this.sendLocal();}
 fail(message){clearTimeout(this.timeout);const p=this.pending;this.pending=null;if(this.command)this.command.phase='stop';p?.reject(new Error(message));this.sendLocal();}
 dispose(){clearInterval(this.timer);this.cancelVoice();this.cancelOutputVoice();for(const track of this.programDestination?.stream?.getTracks?.()||[])track.stop();this.channel?.close();}
}
