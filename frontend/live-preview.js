// Owner-only microphone rehearsal. No recording or cross-session transcript storage.
import {ALL_CHARACTER_IDS} from '../server/characters.js';
export class LiveVoicePreview {
 constructor({onState=()=>{},onTranscript=()=>{},onNotice=()=>{},fetcher=fetch,Peer=globalThis.RTCPeerConnection,media=globalThis.navigator?.mediaDevices,AudioElement=globalThis.Audio,Stream=globalThis.MediaStream}={}){Object.assign(this,{onState,onTranscript,onNotice,fetcher,Peer,media,AudioElement,Stream});this.epoch=0;}
 async api(path,body){
  // Window.fetch must be called as a function, never with this preview as its receiver.
  const {fetcher}=this;
  try{const r=await fetcher('/api/openai/'+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Milo-Characters':'1'},body:JSON.stringify(body),signal:AbortSignal.timeout(path==='live-preview'?50000:30000)}),d=await r.json();if(!r.ok)throw Object.assign(Error(d.error?.message||'De gesprekstest kon niet worden bevestigd.'),{code:d.error?.code,status:r.status});return d;}
  catch(error){if(error.name==='TimeoutError')throw Error('De gesprekstest kon niet op tijd verbinden. Controleer je verbinding en probeer opnieuw.');throw error;}
 }
 async start(characterId){
  if(!ALL_CHARACTER_IDS.includes(characterId)){this.onState('error','Open eerst een geldig personage via Personages.');return;}
  const replacePrevious=await this.stop()===false;
  if(replacePrevious){this.pendingCloseId=null;this.observedClosedId=null;}
  const token=++this.epoch;this.onNotice('');this.onState('connecting');
  try{
   if(!this.Peer||!this.media?.getUserMedia)throw Error('Open de studio via HTTPS in een browser met microfoontoegang.');
   const stream=await this.media.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});if(token!==this.epoch){stream.getTracks().forEach(t=>t.stop());return;}
   this.stream=stream;const peer=this.peer=new this.Peer();for(const track of stream.getTracks())peer.addTrack(track,stream);
   const audio=this.audio=new this.AudioElement();audio.autoplay=true;peer.ontrack=e=>{if(token!==this.epoch)return;audio.srcObject=e.streams[0]||new this.Stream([e.track]);void audio.play().catch(()=>{if(token===this.epoch)void this.fail('Klik opnieuw om het gespreksgeluid toe te staan.');});};
   peer.onconnectionstatechange=()=>{if(token===this.epoch&&['failed','disconnected'].includes(peer.connectionState))void this.fail('De GPT-Live-verbinding is onderbroken.');};
   const channel=this.channel=peer.createDataChannel('oai-events');channel.onmessage=e=>{if(token!==this.epoch)return;try{const data=JSON.parse(e.data);if(data.type==='session.started'){channel.send(JSON.stringify({type:'session.input_audio.unmute'}));this.onState('connected');}if(data.type==='session.input_transcript.delta')this.onTranscript('Jij',data.delta||'');if(data.type==='session.output_transcript.delta')this.onTranscript('Presentator',data.delta||'');if(data.type==='error')void this.fail('GPT-Live heeft de test niet kunnen voortzetten.');if(data.type==='session.closed'){this.observedClosedId=this.sessionId;void this.stop();}}catch{}};
   await peer.setLocalDescription(await peer.createOffer());
   if(peer.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{const done=()=>{if(peer.iceGatheringState==='complete'){clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',done);resolve();}},timer=setTimeout(()=>{peer.removeEventListener('icegatheringstatechange',done);reject(Error('De netwerkverbinding kon niet worden voorbereid.'));},10000);peer.addEventListener('icegatheringstatechange',done);done();});
   if(token!==this.epoch)return;
   const result=await this.api('live-preview',{characterId,sdp:peer.localDescription.sdp,...(replacePrevious?{replacePrevious:true}:{})});
   if(token!==this.epoch){await this.api('live-preview-stop',{sessionId:result.realtimeId}).catch(()=>{this.pendingCloseId=result.realtimeId;});return;}
   if(result.replacedPrevious)this.onNotice('Je gebruikt een nieuwe testverbinding. De afsluiting van de vorige test bij de spraakdienst is nog onbevestigd.');
   this.sessionId=result.realtimeId;await peer.setRemoteDescription({type:'answer',sdp:result.sdp});if(token!==this.epoch)return;
   this.timeout=setTimeout(()=>void this.stop(),120000);
  }catch(error){if(token===this.epoch)await this.fail(error.message);}
 }
 async fail(message){const token=this.epoch+1;await this.stop();if(token===this.epoch)this.onState('error',message);}
 async recover(){
  if(await this.stop()===false)return false;const token=++this.epoch;this.onState('closing');
  try{await this.api('live-preview-stop',{latest:true});if(token===this.epoch)this.onState('idle');return true;}
  catch(error){if(token===this.epoch)this.onState('error',error.message);return false;}
 }
 stop(){
  if(this.closingTask)return this.closingTask;
  const token=++this.epoch;clearTimeout(this.timeout);this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;
  const channel=this.channel,peer=this.peer,id=this.sessionId||this.pendingCloseId;this.channel=null;this.peer=null;this.sessionId=null;
  if(id)this.pendingCloseId=id;
  if(peer){peer.onconnectionstatechange=null;peer.ontrack=null;}
  if(this.audio){this.audio.muted=true;this.audio.pause();this.audio.srcObject=null;this.audio=null;}
  if(id)this.onState('closing');
  const cleanup=()=>{if(channel){channel.onmessage=null;channel.onclose=null;channel.onerror=null;try{channel.close();}catch{}}if(peer)try{peer.close();}catch{}};
  const task=(async()=>{
   // Local sound stops immediately. Keep only the transport alive briefly so the
   // actual terminal event can arrive before closing the WebRTC connection.
   const closed=this.observedClosedId===id&&!!id||await this.waitForTerminal(channel,!!id);
   if(closed&&id)this.observedClosedId=id;
   cleanup();let closeError='';
   if(id)try{await this.api('live-preview-stop',{sessionId:id,...(closed?{closed:true}:{})});if(this.pendingCloseId===id)this.pendingCloseId=null;if(this.observedClosedId===id)this.observedClosedId=null;}catch(error){closeError=error.message;}
   if(token===this.epoch)this.onState(closeError?'error':'idle',closeError);
   return !closeError;
  })();
  const pending=task.finally(()=>{if(this.closingTask===pending)this.closingTask=null;});this.closingTask=pending;return pending;
 }
 waitForTerminal(channel,hasSession){
  if(!hasSession||channel?.readyState!=='open'){if(channel)channel.onmessage=null;return Promise.resolve(false);}
  return new Promise(resolve=>{
   let settled=false,timer;
   const finish=closed=>{if(settled)return;settled=true;clearTimeout(timer);channel.onmessage=null;channel.onclose=null;channel.onerror=null;resolve(closed);};
   channel.onmessage=event=>{try{if(JSON.parse(event.data).type==='session.closed')finish(true);}catch{}};
   channel.onclose=()=>finish(false);channel.onerror=()=>finish(false);
   timer=setTimeout(()=>finish(false),2000);
   try{channel.send(JSON.stringify({type:'session.input_audio.mute'}));channel.send(JSON.stringify({type:'session.close'}));}catch{finish(false);}
  });
 }
}
