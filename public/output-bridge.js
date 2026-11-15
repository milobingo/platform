import {isObsSource,obsFetch} from './obs-access.js';
// Authenticated network relay plus a low-latency local channel. One audio output.
export class OutputBridge{
 constructor({isOutput=false,getId,getGame=()=>null,getSnapshot=()=>null,getShow=()=>null,receive=()=>{},showAudio,onLost=()=>{},onNotice=()=>{}}){Object.assign(this,{isOutput,getId,getGame,getSnapshot,getShow,receive,showAudio,onLost,onNotice});this.offset=0;this.id=crypto.randomUUID();this.generation=null;this.seq=0;this.events=[];this.seen=new Set();this.enabled=isOutput;this.routing=false;this.mixer={voice:100,music:25,effects:50};this.command=null;this.ack=null;this.latest=null;this.lastPoll=0;this.lastPublish=0;this.obs=isOutput&&isObsSource();this.accessEpoch=0;this.targetGameId=isOutput?new URLSearchParams(globalThis.location?.search||'').get('show')||null:null;try{this.channel=this.obs?null:new BroadcastChannel('vlampie-output-v1');}catch{this.channel=null;}if(this.channel)this.channel.onmessage=({data})=>{if(data.kind==='packet'&&isOutput&&this.latest?.producer?.id===data.clientId&&data.state?.producer?.generation===this.latest.producer.generation&&data.state?.producer?.instanceId===this.latest.producer.instanceId)this.consume(data.state);if(data.kind==='ack'&&!isOutput&&this.latest?.output?.id===data.clientId)this.acceptAck(data.ack);};if(isOutput)this.mount();this.timer=setInterval(()=>this.tick(),500);}
 get clientId(){return this.isOutput?this.id:this.getId?.()||this.id;}
 get preparationStatus(){if(this.isCancelled())return {gameId:this.latest.cancelledGameId,connected:false,audioActivated:false,testPlayed:false,testId:null,testPlayedAt:null};const output=this.latest?.output,producer=this.latest?.producer,gameId=this.getGame?.()?.id||producer?.gameId||null,current=!!output&&output.until>Date.now()+this.offset&&producer?.gameId===gameId&&output.generation===producer?.generation&&output.seq>0;return {gameId,connected:!!producer&&producer.until>Date.now()+this.offset&&!!this.latest?.publishedAt&&Date.now()+this.offset-this.latest.publishedAt<=8000&&this.latest?.snapshot?.gameId===gameId,audioActivated:current&&!!output.audioReady&&!!output.audioPlayedAt,testPlayed:current&&!!output.audioReady&&output.testAck?.status==='played',testId:output?.testAck?.id||null,testPlayedAt:output?.testAck?.status==='played'?output.testAck.at:null};}
 get connected(){const s=this.latest;if(this.isCancelled())return false;return !!s?.output?.audioReady&&s.output.until>Date.now()+this.offset&&(!s.producer?.generation||s.output.generation===s.producer.generation&&s.output.seq>0);}
 async ensurePreparedAudio(fingerprint,{timeoutMs=120000}={}){
  if(this.isOutput||!this.routing)return;
  const gameId=this.getGame()?.id,deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
   if(this.disposed||this.isCancelled()||gameId!==this.getGame()?.id)throw Error('De gekozen uitzending is gewijzigd.');
   const audio=this.latest?.output?.audioPreparation;
   const state=this.latest,now=Date.now()+(this.offset||0),fresh=this.connected&&state?.producer?.gameId===gameId&&state?.snapshot?.gameId===gameId&&state.producer.until>now&&state.publishedAt&&now-state.publishedAt<=8000&&state.output.generation===state.producer.generation&&state.output.seq>0;
   if(fresh&&audio?.fingerprint===fingerprint&&audio.total>0&&audio.ready===audio.total&&!audio.error)return;
   if(audio?.fingerprint===fingerprint&&audio.error)throw Error(audio.error);
   await this.publish();await new Promise(resolve=>setTimeout(resolve,300));
  }
  throw Error('De vaste audio in het uitzendvenster is nog niet volledig ingeladen. Houd dit venster open en probeer opnieuw.');
 }
 cancelPreparedAudio(){this.preloadAbort?.abort();this.preloadToken=Symbol();this.preloadPending=null;this.preloadFingerprint=null;this.preloadKeys=null;this.preloadRetryAt=0;this.preloadedClips?.clear();this.outputAudioPreparation=null;}
 preparedVoiceAvailable(command){
  const fingerprint=command?.preparedFingerprint,current=this.lastSnapshot?.audioPreparation,prepared=this.outputAudioPreparation;
  return !!fingerprint&&current?.complete&&current.fingerprint===fingerprint&&prepared?.fingerprint===fingerprint&&!prepared.error&&prepared.total>0&&prepared.ready===prepared.total&&this.preloadKeys?.has(command.clip)&&this.preloadedClips?.has(command.clip);
 }
 preloadOutputAudio(state){
  const preparation=state.snapshot?.audioPreparation;
  if(!this.isOutput||!preparation?.complete||!preparation.fingerprint||this.isCancelled())return;
  const fingerprint=preparation.fingerprint,gameId=state.snapshot.gameId;
  if(this.preloadPending&&this.preloadFingerprint===fingerprint||this.outputAudioPreparation?.fingerprint===fingerprint&&this.outputAudioPreparation.ready===this.outputAudioPreparation.total&&!this.outputAudioPreparation.error)return;
  if(this.preloadFingerprint===fingerprint&&this.preloadRetryAt>Date.now())return;
  this.preloadAbort?.abort();const token=this.preloadToken=Symbol(),accessEpoch=this.accessEpoch||0;
  this.preloadedClips??=new Map();const controller=this.preloadAbort=new AbortController();this.preloadFingerprint=fingerprint;this.preloadKeys=null;
  this.outputAudioPreparation={fingerprint,total:preparation.total,ready:0};
  const bound=()=>!this.disposed&&!this.isCancelled()&&this.preloadToken===token&&(this.accessEpoch||0)===accessEpoch&&this.targetGameId===gameId&&this.lastSnapshot?.audioPreparation?.fingerprint===fingerprint;
  const valid=()=>bound()&&!controller.signal.aborted;
  const operation=(async()=>{
   try{
    const response=await obsFetch('/api/openai/show-audio',this.obs?{signal:controller.signal}:{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId}),signal:controller.signal});
    const manifest=await response.json();if(!valid())return;
    if(!response.ok||manifest.fingerprint!==fingerprint||!Array.isArray(manifest.items)||manifest.items.length>3000||manifest.items.length!==preparation.total||manifest.total!==manifest.items.length||manifest.ready!==manifest.total||!manifest.complete||manifest.items.some(item=>!/^[a-f0-9]{64}$/.test(item.clip||item.key||'')||item.ready!==true))throw Error('De vaste uitzendaudio is nog niet volledig beschikbaar.');
    const keys=new Set(manifest.items.map(item=>item.clip||item.key));if(keys.size!==manifest.items.length)throw Error('De lijst met uitzendfragmenten is ongeldig.');this.preloadKeys=keys;
    for(const key of this.preloadedClips.keys())if(!keys.has(key))this.preloadedClips.delete(key);
    this.outputAudioPreparation={fingerprint,total:manifest.items.length,ready:this.preloadedClips.size};let index=0,bytes=[...this.preloadedClips.values()].reduce((total,b)=>total+b.byteLength,0);
    const worker=async()=>{while(index<manifest.items.length&&valid()){
     const item=manifest.items[index++],clip=item.clip||item.key;if(this.preloadedClips.has(clip))continue;
     const result=await obsFetch('/api/openai/clips/'+clip,{credentials:'same-origin',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});if(!result.ok)throw Error('Een vast uitzendfragment kon niet vooraf worden geladen.');
     const data=await result.arrayBuffer();if(!valid())return;if(!data.byteLength||data.byteLength>8*1024*1024||bytes+data.byteLength>256*1024*1024)throw Error('De uitzendbron heeft onvoldoende ruimte voor alle showaudio. Verdeel het draaiboek over kortere shows.');
     bytes+=data.byteLength;this.preloadedClips.set(clip,data);this.outputAudioPreparation.ready=this.preloadedClips.size;
    }};
    await Promise.all([worker(),worker()]);if(valid())this.preloadRetryAt=0;
   }catch(error){if(bound()&&!controller.signal.aborted){controller.abort();this.outputAudioPreparation.error='Audio vooraf laden is onderbroken. '+(error.message||'Controleer de verbinding.');this.preloadRetryAt=Date.now()+5000;}}
   finally{if(this.preloadToken===token)this.preloadPending=null;}
  })();this.preloadPending=operation;
 }
 async api(body){const epoch=this.accessEpoch||0,r=await obsFetch('/api/output',{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json','X-Vlampie-Output':'1'}:{},body:body?JSON.stringify({...body,clientId:this.clientId}):undefined,signal:AbortSignal.timeout(7000)});const data=await r.json();if(!r.ok){if(data.code==='show_cancelled'&&data.state){this.latest=data.state;this.stopForCancellation(data.state);}throw Object.assign(new Error(typeof data.error==='string'?data.error:data.error?.message||'Uitzendverbinding niet beschikbaar.'),{status:r.status});}if(this.obs&&epoch!==(this.accessEpoch||0))throw Object.assign(new Error('De uitzendverbinding wordt automatisch hersteld.'),{status:409});this.offset=(data.serverTime||Date.now())-Date.now();if((this.latest?.producer?.generation||0)>(data.state?.producer?.generation||0))return this.latest;this.latest=data.state;return data.state;}
 mount(){const panel=document.createElement('div');panel.className='output-unlock'+(this.obs?' output-unlock--obs':'');panel.innerHTML='<strong>Uitzendvenster · 16:9</strong><p>Activeer beeld en geluid. Een kort testgeluid controleert de uitzendmix.</p><button type="button" data-output-activate>Beeld & geluid activeren</button><button type="button" data-output-reconnect hidden>Opnieuw verbinden</button><small role="status">Open dit venster vanuit Uitzending testen bij de juiste show.</small>';document.body.append(panel);this.panel=panel;panel.querySelector('[data-output-activate]').onclick=()=>void this.activate().catch(()=>{});panel.querySelector('[data-output-reconnect]').onclick=()=>void this.reconnect().catch(()=>{});if(this.obs){panel.querySelector('strong').textContent='Uitzending verbinden…';panel.querySelector('p').textContent='Beeld en geluid starten automatisch.';panel.querySelector('small').textContent='Houd de regie van deze show open.';for(const button of panel.querySelectorAll('button'))button.hidden=true;this.accessLost=()=>this.loseOutput('Uitzendverbinding onderbroken. Automatisch opnieuw verbinden…');globalThis.window?.addEventListener?.('milo-obs-access-lost',this.accessLost);}}
 async activate({automatic=false}={}){
  if(this.isCancelled())throw Error('Deze show is geannuleerd. Open het uitzendvenster bij een nieuwe show.');if(this.activating)return;const attempt=this.activating=Symbol(),epoch=this.accessEpoch||0;let timer;
  try{
   this.context??=new AudioContext();
   if(!this.audioGraphReady){this.gain??=this.context.createGain();this.programDestination??=this.context.createMediaStreamDestination();this.analyser??=this.context.createAnalyser();this.analyser.fftSize=256;this.gain.connect(this.analyser);this.analyser.connect(this.context.destination);this.analyser.connect(this.programDestination);this.audioGraphReady=true;}
   const readiness=await Promise.race([Promise.all([this.context.resume(),this.showAudio.unlock()]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Geluid is nog geblokkeerd. Open Interactie in OBS en kies Beeld & geluid activeren.')),automatic?1500:7000);})]);
   if(this.activating!==attempt)return;if(this.context.state!=='running'||readiness[1]===false)throw Error('Geluid is nog geblokkeerd. Open Interactie in OBS en kies Beeld & geluid activeren.');
   if(epoch!==(this.accessEpoch||0))throw Error('De OBS-verbinding is gewijzigd. Kies Opnieuw verbinden.');
   await this.playProgramTest();
   if(this.activating!==attempt||epoch!==(this.accessEpoch||0))throw Error('De OBS-verbinding is gewijzigd. Kies Opnieuw verbinden.');
   this.automaticAudioBlocked=false;this.audioReady=true;await this.heartbeat();if(this.isCancelled()){this.stopForCancellation(this.latest);throw Error('Deze show is geannuleerd.');}if(this.activating!==attempt)return;
   if(epoch!==(this.accessEpoch||0))throw Error('De OBS-verbinding is gewijzigd. Kies Opnieuw verbinden.');
   this.panel.querySelector('small').textContent='Geluid afgespeeld. Controleer de OBS-mixer en maak een korte proefopname.';this.panel.hidden=true;this.active=true;this.reconnectNeeded=false;this.connectionError='';this.automaticFailures=0;this.nextAutomaticAt=0;
  }catch(error){if(this.activating!==attempt)throw error;if(automatic){this.automaticAudioBlocked=this.context?.state!=='running';this.automaticFailures=(this.automaticFailures||0)+1;this.nextAutomaticAt=Date.now()+Math.min(10000,1000*2**Math.min(this.automaticFailures-1,4));}this.audioReady=false;this.active=false;this.cancelOutputVoice();this.showAudio?.setMuted?.(true);this.showAudio?.stop?.();if(this.panel){this.panel.hidden=false;if(this.obs&&this.automaticAudioBlocked){this.panel.classList?.add('output-unlock--needs-gesture');const activate=this.panel.querySelector('[data-output-activate]');if(activate)activate.hidden=false;}this.panel.querySelector('small').textContent=this.obs&&this.automaticAudioBlocked?'Geluid is nog geblokkeerd. OBS → Bronnen → rechtsklik → Interactie → Beeld & geluid activeren. Beeld blijft zichtbaar.':error.message;}throw error;}
  finally{clearTimeout(timer);if(this.activating===attempt)this.activating=null;}
 }
 async playProgramTest({id=crypto.randomUUID()}={}){
  if(this.isCancelled())throw Error('Deze show is geannuleerd.');
  if(this.context?.state!=='running'||!this.gain||!this.analyser)throw Error('Geluid is nog geblokkeerd. Kies Beeld & geluid activeren.');
  if(this.liveCallActive||this.source)throw Error('Wacht tot de uitspraak of het livegesprek klaar is om het testgeluid af te spelen.');
  if((this.mixer?.voice??100)<=0)throw Error('Het presentatorvolume staat uit. Verhoog het volume en speel het testgeluid opnieuw.');
  this.testPlayback?.abort();const epoch=this.accessEpoch||0,context=this.context,duration=.64,buffer=context.createBuffer(1,Math.ceil(context.sampleRate*duration),context.sampleRate),samples=buffer.getChannelData(0);
  // This source shares the presenter's programme gain, analyser and destination.
  // No microphone or backstage track is read or connected during preparation.
  for(let i=0;i<samples.length;i++){const t=i/context.sampleRate,segment=Math.floor(t/.21),local=t% .21,fade=Math.min(1,local/.015,Math.max(0,(.18-local)/.035));samples[i]=Math.sin(2*Math.PI*[523.25,659.25,783.99][Math.min(2,segment)]*t)*.16*Math.max(0,fade);}
  const source=context.createBufferSource();source.buffer=buffer;source.connect(this.gain);this.gain.gain.value=(this.mixer?.voice??100)/100;
  const started=context.currentTime;let peak=0,poll,timer,settled=false;
  return new Promise((resolve,reject)=>{
   const finish=error=>{if(settled)return;settled=true;clearInterval(poll);clearTimeout(timer);source.onended=null;try{source.stop();}catch{}source.disconnect();if(this.testPlayback?.source===source)this.testPlayback=null;if(this.gain)this.gain.gain.value=this.latest?.routing?(this.mixer?.voice??100)/100:0;
    if(error){this.testAck={id,status:'error',at:Date.now(),error:error.message};reject(error);}else{this.audioPlayedAt=Date.now();this.testAck={id,status:'played',at:this.audioPlayedAt,error:''};resolve(this.testAck);}};
   this.testPlayback={source,abort:()=>finish(Error('Het testgeluid is onderbroken. Speel het opnieuw.'))};
   poll=setInterval(()=>{if(epoch!==(this.accessEpoch||0)||context.state!=='running'){finish(Error('De audioverbinding is onderbroken. Kies Opnieuw verbinden.'));return;}peak=Math.max(peak,this.meter());},20);
   timer=setTimeout(()=>finish(Error('Geen afgespeeld testgeluid bevestigd. Activeer geluid en probeer opnieuw.')),2500);
   source.onended=()=>{if(epoch!==(this.accessEpoch||0)||context.state!=='running'||context.currentTime-started<duration*.75||peak<.003)finish(Error('Geen hoorbaar testsignaal bevestigd in de uitzendmix. Activeer geluid en probeer opnieuw.'));else finish();};
   try{source.start();}catch(error){finish(error);}
  });
 }
 async reconnect(){
  if(this.reconnecting)return this.reconnecting;
  const pending=(async()=>{this.loseOutput('Uitzendvenster opnieuw verbinden…');const epoch=this.accessEpoch;this.reconnectNeeded=true;const state=await this.api();if(epoch!==this.accessEpoch)throw Error('De verbinding is opnieuw gewijzigd. Probeer opnieuw.');
   if(state?.cancelledAt){this.stopForCancellation(state);throw Error('Deze show is geannuleerd. Open het uitzendvenster bij een nieuwe show.');}const gameId=state?.snapshot?.gameId||state?.producer?.gameId;if(!gameId||this.targetGameId&&gameId!==this.targetGameId||!state?.producer||state.producer.until<=Date.now()+this.offset||!state.publishedAt||Date.now()+this.offset-state.publishedAt>8000)throw Error('De regie van deze show is nog niet verbonden. Open Uitzending testen bij deze show en probeer opnieuw.');
   this.targetGameId??=gameId;this.lastKey=null;this.consume(state);await this.activate();return state;
  })().catch(error=>{if(this.panel){this.panel.hidden=false;this.panel.querySelector('small').textContent=error.message;}throw error;}).finally(()=>{if(this.reconnecting===pending)this.reconnecting=null;});this.reconnecting=pending;return pending;
 }
 async testSound(){
  if(this.isOutput)throw Error('Speel het testgeluid vanuit de regie.');if(this.testPending)throw Error('Het testgeluid wordt al gecontroleerd.');
  if(this.isVoiceBusy?.()||this.pending||this.latest?.snapshot?.liveCall)throw Error('Wacht tot de uitspraak of het livegesprek klaar is.');
  await this.route(true);const id=crypto.randomUUID();this.testRequestId=id;this.events.push({id,kind:'test-sound',at:Date.now()});this.events=this.events.slice(-30);
  const promise=new Promise((resolve,reject)=>{this.testPending={id,resolve,reject};this.testTimeout=setTimeout(()=>{if(this.testPending?.id===id){this.testPending=null;reject(Error('Het uitzendvenster bevestigt nog geen afgespeeld geluid. Activeer beeld en geluid in dat venster en probeer opnieuw.'));}},12000);});
  try{await this.publish();}catch(error){clearTimeout(this.testTimeout);const pending=this.testPending;this.testPending=null;pending?.reject(error);}return promise;
 }
 acceptTestAck(ack){if(!ack||ack.id!==this.testPending?.id)return;if(!['played','error'].includes(ack.status))return;clearTimeout(this.testTimeout);const pending=this.testPending;this.testPending=null;if(ack.status==='played')pending.resolve(ack);else pending.reject(Error(ack.error||'Het testgeluid kon niet worden afgespeeld.'));}

 connect(){this.enabled=true;return this.publish();}
 async route(enabled){if(this.isVoiceBusy?.()||this.pending)throw new Error('Wacht tot de uitspraak klaar is of stop eerst de stem voordat je de geluidsroute wisselt.');if(enabled){await this.connect();if(!this.connected)throw new Error('Open eerst het uitzendvenster en activeer daar beeld & geluid.');}this.routing=!!enabled;this.showAudio?.setMuted?.(this.routing);await this.publish();}
 cue(cue){if(!this.enabled)return;this.events.push({id:crypto.randomUUID(),kind:'cue',cue,at:Date.now()});this.events=this.events.filter(e=>e.at>Date.now()-10000).slice(-30);this.sendLocal();}
 controls(kind){if(!this.enabled)return;this.events.push({id:crypto.randomUUID(),kind,at:Date.now()});this.events=this.events.slice(-30);this.sendLocal();}
 state(){const {show:unused,...snapshot}=this.getSnapshot()||{};const show=this.getShow();if(show?.gameStage?.result){const r=show.gameStage.result,entry=e=>({bookId:e.bookId,name:e.name,ticket:e.ticket});show.gameStage={...show.gameStage,result:{...r,winner:entry(r.winner),entrants:r.entrants.map(entry)}};}return {producer:{id:this.clientId,instanceId:this.id,generation:this.generation},generation:this.generation,instanceId:this.id,seq:++this.seq,publishedAt:Date.now(),snapshot,show,events:this.events,voice:this.command,mixer:this.mixer,routing:this.routing};}
 sendLocal(){if(!this.enabled||this.isOutput)return;void this.publish().catch(error=>{this.error=error.message;});}
 async publish(){if(this.publishing||!this.enabled||this.isOutput)return;this.publishing=true;try{const gameId=this.getGame()?.id||null;if(this.claimedGame!==gameId){this.generation=null;this.claimedGame=gameId;}if(this.generation===null){const prior=await this.api();const claimed=await this.api({action:'producer-claim',expectedGeneration:prior?.generation||0,instanceId:this.id,gameId});this.generation=claimed.producer.generation;this.seq=0;}const s=this.state();await this.api({action:'publish',...s,gameId});if(this.latest?.producer?.generation!==this.generation||this.latest?.seq!==s.seq)throw Error('Het uitzendbeeld is nog niet bevestigd.');this.lastPublish=Date.now();this.channel?.postMessage({kind:'packet',clientId:this.clientId,state:this.latest});this.acceptAck(this.latest?.output?.voiceAck);this.acceptTestAck(this.latest?.output?.testAck);}finally{this.publishing=false;}}
 async heartbeat(){const s=await this.api({action:'output-heartbeat',audioReady:!!this.audioReady,audioPlayedAt:this.audioPlayedAt||null,testAck:this.testAck||null,generation:this.renderedGeneration,seq:this.renderedSeq||0,voiceAck:this.ack?{...this.ack,elapsed:this.voiceElapsed}:null,audioPreparation:this.outputAudioPreparation||null,meters:{voice:this.meter(),...this.showAudio?.meters}});this.lastHeartbeat=Date.now();if(this.ack)this.channel?.postMessage({kind:'ack',clientId:this.id,ack:{...this.ack,elapsed:this.voiceElapsed}});return s;}
 async tick(){if(!this.enabled||this.busy)return;this.busy=true;try{if(this.isOutput){if(this.active&&this.context?.state!=='running'){this.loseOutput('Het uitzendgeluid is onderbroken. Kies Opnieuw verbinden om het opnieuw te activeren.');return;}const s=this.active?await this.heartbeat():await this.api();this.consume(s);if(!s?.cancelledAt&&!this.isCancelled()&&s?.publishedAt&&Date.now()+this.offset-s.publishedAt>8000){this.loseOutput('Verbinding met de regie verloren. Kies Opnieuw verbinden voor deze show.');}}else{await this.publish();if(this.routing&&!this.connected){this.fail('Het uitzendgeluid is niet meer verbonden.');this.onLost('Uitzendverbinding verloren. De show is gepauzeerd.');}}this.lastPoll=Date.now();}catch(e){this.error=e.message;if(this.isOutput&&(this.obs||this.active&&(e.status===409||Date.now()-(this.lastHeartbeat||0)>6500))){this.loseOutput(e.message);}if(this.routing&&Date.now()-this.lastPublish>7000){this.fail(e.message);this.onLost('Uitzendverbinding onderbroken. Controleer beeld & geluid.');}}finally{this.busy=false;}}
 loseOutput(message){if(this.isCancelled()){this.stopForCancellation(this.latest);return;}const newOutage=this.active||this.audioReady||!this.reconnectNeeded;if(newOutage){this.cancelPreparedAudio();this.accessEpoch=(this.accessEpoch||0)+1;this.activating=null;this.nextAutomaticAt=Date.now()+500;}this.testPlayback?.abort();this.reconnectNeeded=true;this.connectionError=message;this.active=false;this.audioReady=false;this.showAudio.setMuted(true);this.showAudio.stop();this.onCallStop?.();this.waitForProducer(message);this.receive({kind:'stop',payload:{},sentAt:Date.now()});if(this.panel){this.panel.hidden=false;this.panel.querySelector('small').textContent=message;const button=this.panel.querySelector('[data-output-reconnect]');if(button)button.hidden=!!this.obs;}}
 consume(s){if(!s)return;const bound=s.cancelledGameId||s.snapshot?.gameId||s.producer?.gameId;if(s.cancelledAt&&(!this.targetGameId||bound===this.targetGameId)){this.stopForCancellation(s);return;}if(this.cancelledGames?.has(bound))return;if(this.active&&s.output&&s.output.id!==this.id){this.loseOutput('Een ander venster verzorgt nu het uitzendgeluid.');return;}const gameId=s.snapshot?.gameId||s.producer?.gameId;if(this.targetGameId&&gameId&&gameId!==this.targetGameId){this.loseOutput('Dit venster hoort bij een andere show. Open het juiste uitzendvenster vanuit Uitzending testen.');return;}if(gameId)this.targetGameId??=gameId;const generation=s.producer?.generation;if(!Number.isSafeInteger(generation)||!s.snapshot||!s.publishedAt){this.waitForProducer('Uitzending wacht op bevestigd beeld van de regie.');return;}if(this.receivedGeneration!==undefined&&generation<this.receivedGeneration)return;const key=`${s.producer?.id}:${generation}:${s.seq}`;if(this.lastKey===key){this.scheduleAutomaticActivation(s);this.preloadOutputAudio(s);return;}if(this.producer===s.producer?.id&&generation===this.receivedGeneration&&s.seq<(this.receivedSeq||0))return;this.producer=s.producer?.id;this.receivedGeneration=generation;this.receivedSeq=s.seq;this.lastKey=key;this.scheduleAutomaticActivation(s);this.mixer=s.mixer||this.mixer;this.showAudio.setLevels(this.mixer);this.showAudio.setMuted(!s.routing||!this.audioReady||this.liveCallActive);if(this.gain&&!this.testPlayback)this.gain.gain.value=s.routing?this.mixer.voice/100:0;
  this.lastSnapshot=s.snapshot;if(this.voicePreparedCommand&&!this.preparedVoiceAvailable(this.voicePreparedCommand))this.cancelOutputVoice('De vaste showaudio is gewijzigd en wordt opnieuw ingeladen.');this.preloadOutputAudio(s);const sentAt=s.publishedAt||Date.now();if(s.snapshot)this.receive({kind:'snapshot',payload:{...s.snapshot,outputVersion:{generation,seq:s.seq}},sentAt});if(s.show)this.receive({kind:'show',payload:s.show,sentAt});
  for(const e of s.events||[]){if(this.seen.has(e.id))continue;this.seen.add(e.id);if(this.seen.size>200)this.seen.delete(this.seen.values().next().value);if(e.kind==='call-stop')this.onCallStop?.();if(e.kind==='test-sound'&&this.audioReady&&Date.now()+this.offset-e.at<=10000){void this.playProgramTest({id:e.id}).then(()=>this.heartbeat()).catch(error=>{this.error=error.message;void this.heartbeat().catch(()=>{});});continue;}if(!s.routing||!this.audioReady||Date.now()+this.offset-e.at>1500)continue;if(e.kind==='cue')this.showAudio.cue(e.cue);if(e.kind==='pause'){this.testPlayback?.abort();this.showAudio.pause();}if(e.kind==='resume')this.showAudio.resume();if(e.kind==='stop'){this.testPlayback?.abort();this.showAudio.stop();}}
  if(s.routing&&this.audioReady&&!this.liveCallActive)this.applyVoice(s.voice);else this.cancelOutputVoice();
 }
 waitForProducer(message){if(this.isCancelled())return;if(this.waitMessage===message)return;this.waitMessage=message;this.cancelOutputVoice();this.showAudio?.enableBackground?.(false);this.showAudio?.setMuted?.(true);this.receive({kind:'snapshot',payload:{...(this.obs?{}:this.lastSnapshot||{}),paused:true,speaking:false,caption:message,outputWaiting:true},sentAt:Date.now()});}
 scheduleAutomaticActivation(state=this.latest){
  if(!this.obs||!this.isOutput||this.active||this.activating||this.automaticQueued||this.isCancelled()||Date.now()<(this.nextAutomaticAt||0))return false;
  const eligible=()=>{const now=Date.now()+(this.offset||0),gameId=state?.snapshot?.gameId||state?.producer?.gameId;return !!state?.producer&&!!state.snapshot&&!!state.publishedAt&&now-state.publishedAt<=8000&&(state.producer.until===undefined||state.producer.until>now)&&(!this.targetGameId||gameId===this.targetGameId)&&(!state.output||state.output.id===this.id||state.output.until<=now)&&(!state.producer.gameId||state.producer.gameId===state.snapshot.gameId)&&(this.receivedGeneration===undefined||state.producer.generation>=this.receivedGeneration);};
  if(!eligible())return false;
  const epoch=this.accessEpoch||0;this.automaticQueued=true;queueMicrotask(()=>{this.automaticQueued=false;if(epoch===(this.accessEpoch||0)&&eligible()&&Date.now()>=(this.nextAutomaticAt||0)&&!this.active&&!this.activating&&!this.isCancelled())void this.activate({automatic:true}).catch(()=>{});});return true;
 }
 isCancelled(){const id=this.targetGameId||this.getGame?.()?.id||this.latest?.cancelledGameId;return !!this.latest?.cancelledAt||!!id&&!!this.cancelledGames?.has(id);}
 stopForCancellation(value){
  const gameId=value?.cancelledGameId||value?.id||value?.snapshot?.gameId||this.targetGameId;if(!gameId)return;
  this.cancelledGames??=new Set();this.cancelledGames.add(gameId);if(this.isOutput)this.targetGameId??=gameId;
  const state=value?.cancelledGameId?value:{...this.latest,cancelledGameId:gameId,cancelledAt:value.cancelledAt,snapshot:{...(this.latest?.snapshot||this.lastSnapshot||{}),gameId}};
  this.latest={...state,cancelledGameId:gameId,cancelledAt:state.cancelledAt||Date.now(),voice:null,events:[],routing:false};
  this.cancelPreparedAudio();this.activating=null;this.active=false;this.audioReady=false;this.routing=false;this.reconnectNeeded=false;this.connectionError='';if(!this.isOutput)this.enabled=false;
  this.testPlayback?.abort();clearTimeout(this.testTimeout);this.testPending?.reject(Object.assign(Error('Deze show is geannuleerd.'),{name:'AbortError'}));this.testPending=null;
  clearTimeout(this.timeout);this.pending?.reject(Object.assign(Error('Deze show is geannuleerd.'),{name:'AbortError'}));this.pending=null;this.command=null;
  this.cancelOutputVoice();this.showAudio?.setMuted?.(true);this.showAudio?.stop?.();if(this.gain)this.gain.gain.value=0;this.onCallStop?.();
  const snapshot={...this.latest.snapshot,gameId,cancelledAt:this.latest.cancelledAt,paused:true,speaking:false,speechActive:false,mouth:0,caption:'Deze show is geannuleerd.',liveCall:null,showCue:null,movement:null,magic:null,outputWaiting:false};
  this.lastSnapshot=snapshot;this.receive({kind:'snapshot',payload:snapshot,sentAt:Date.now()});if(state.show)this.receive({kind:'show',payload:{...state.show,paused:true,liveCall:null,externalHold:true,drawBlocked:true,gameStage:null,flow:'cancelled',kind:'cancelled',title:'Show geannuleerd'},sentAt:Date.now()});
  this.receive({kind:'stop',payload:{},sentAt:Date.now()});
  if(this.panel){this.panel.hidden=false;this.panel.querySelector('strong').textContent='Show geannuleerd';this.panel.querySelector('p').textContent='De uitzending en het geluid van deze show zijn gestopt.';this.panel.querySelector('small').textContent='De gespeelde gegevens blijven bewaard. Open een nieuwe show vanuit de regie.';for(const button of this.panel.querySelectorAll('button')){button.hidden=true;button.disabled=true;}}
 }
 markRendered(version){if(!this.isOutput||!version||version.generation!==this.receivedGeneration||!Number.isSafeInteger(version.seq)||version.seq<=0||version.seq>this.receivedSeq)return false;if(this.renderedGeneration===version.generation&&version.seq<(this.renderedSeq||0))return false;this.renderedGeneration=version.generation;this.renderedSeq=version.seq;this.waitMessage=null;return true;}
 voiceCurrent(id,token){return !this.isCancelled()&&(!this.voicePreparedCommand||this.preparedVoiceAvailable(this.voicePreparedCommand))&&this.voiceId===id&&this.loadToken===token&&!this.liveCallActive&&this.active!==false&&this.audioReady!==false;}
 setLiveCallActive(active){this.liveCallActive=!!active;if(active){this.testPlayback?.abort();this.cancelOutputVoice('Het stemfragment is gestopt voor het livegesprek.');}}
 cancelOutputVoice(message=''){
  const id=this.voiceId;this.voicePreparedCommand=null;this.loadToken=null;this.voiceAbort?.abort();this.voiceAbort=null;this.buffer=null;this.started=undefined;this.playbackOffset=0;this.stopSource();
  if(message&&id&&this.ack?.id===id&&!['ended','error'].includes(this.ack.status))this.setAck(id,'error',message);
 }
 async applyVoice(command){
  this.voiceRequestedPhase=command?.phase;
  if(this.testPlayback)return;
  if(this.liveCallActive){this.cancelOutputVoice();return;}
  if(!command||command.phase==='stop'){this.cancelOutputVoice();return;}
  if(this.voiceId!==command.id){
   this.cancelOutputVoice();this.voicePreparedCommand=command.preparedOnly?command:null;this.voiceId=command.id;const token=this.loadToken=command.id;const controller=this.voiceAbort=new AbortController();this.setAck(command.id,'loading');
   try{
    const cached=this.preloadedClips?.get(command.clip);if(command.preparedOnly&&!this.preparedVoiceAvailable(command)){this.setAck(command.id,'error','De vaste uitzendaudio is nog niet vooraf geladen. Wacht op de audiovoorbereiding.');this.voicePreparedCommand=null;return;}
    const r=cached?null:await obsFetch('/api/openai/clips/'+command.clip,{credentials:'same-origin',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])});
    if(r&&!r.ok)throw new Error('Het stemfragment kan niet worden geladen.');
    const bytes=cached?cached.slice(0):await r.arrayBuffer();if(!this.voiceCurrent(command.id,token))return;
    const b=await this.context.decodeAudioData(bytes);if(!this.voiceCurrent(command.id,token))return;
    if(!Number.isFinite(b.duration)||b.duration>120)throw new Error('Ongeldig stemfragment.');
    this.buffer=b;this.voiceText=command.text;this.setAck(command.id,'ready');
   }catch(e){if(this.voiceCurrent(command.id,token)){this.setAck(command.id,'error',e.message);if(this.obs)this.loseOutput('Het uitzendgeluid is onderbroken. Controleer de OBS-link en de verbinding.');}}finally{if(this.voiceAbort===controller)this.voiceAbort=null;}
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
 play(clip,text,duration,onStart,{canPlay=()=>true,onBlocked=()=>{},preparedOnly=false,preparedFingerprint=null}={}){this.cancelVoice();if(!this.connected)return Promise.reject(new Error('Het uitzendvenster heeft nog geen geluid geactiveerd.'));if(!/^[a-f0-9]{64}$/.test(clip||''))return Promise.reject(new Error('Dit fragment kan niet naar de uitzending worden gestuurd.'));this.remoteElapsed=0;this.remotePlaying=false;this.command={id:crypto.randomUUID(),clip,text,duration,preparedOnly,preparedFingerprint,phase:'prepare'};this.sendLocal();return new Promise((resolve,reject)=>{this.pending={id:this.command.id,resolve,reject,onStart,canPlay,onBlocked};this.armTimeout(duration+25000);});}
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
 dispose(){this.disposed=true;this.preloadAbort?.abort();this.preloadedClips?.clear();this.testPlayback?.abort();clearTimeout(this.testTimeout);if(this.testPending){this.testPending.reject(Object.assign(Error('Uitzendvenster gesloten.'),{name:'AbortError'}));this.testPending=null;}globalThis.window?.removeEventListener?.('milo-obs-access-lost',this.accessLost);clearInterval(this.timer);this.cancelVoice();this.cancelOutputVoice();for(const track of this.programDestination?.stream?.getTracks?.()||[])track.stop();this.channel?.close();}
}
