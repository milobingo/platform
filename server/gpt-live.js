import {characterLiveInstructions,liveVoice} from './characters.js';
import {dutchNumber} from '../public/bingo-speech.js';

export const LIVE_MODEL='gpt-live-1';
export class LiveServiceError extends Error{
 constructor(status,diagnostic){super([502,503,504].includes(status)?'De spraakdienst kan nu geen nieuwe testverbinding openen ('+status+'). Probeer het later opnieuw.':status===429?'OpenAI meldt een gebruikslimiet. Controleer je API-tegoed.':'GPT-Live accepteert de verbinding niet. Controleer de modeltoegang van de centrale sleutel.');this.status=[502,503,504].includes(status)?503:status===429?429:502;this.code=this.status===503?'live_unavailable':'live_rejected';this.diagnostic=diagnostic;}
}
export class ScriptSpeechError extends Error{
 constructor(status,code,message,{retryAfter,phase}={}){super(message);this.status=status;this.code=code;if(Number.isSafeInteger(retryAfter)&&retryAfter>0&&retryAfter<=86400)this.retryAfter=retryAfter;if(['handshake','session_start','transcript','audio','silence','close'].includes(phase))this.phase=phase;}
}
export function validLiveSessionId(id){return typeof id==='string'&&id.length>0&&id.length<=512&&!/[\s\p{Cc}]/u.test(id);}
export function liveSession(settings,{instructions,input=[]}={}){
 return {model:LIVE_MODEL,instructions:instructions||characterLiveInstructions(settings),audio:{output:{voice:liveVoice(settings)}},input,store:false};
}
export async function createLivePeer(key,sdp,session,fetcher=fetch,{requestId}={}){
 if(requestId!==undefined&&(typeof requestId!=='string'||!/^[a-f0-9-]{36}$/.test(requestId)))throw Error('Ongeldige correlatie voor de stemreservering.');
 const r=await fetcher('https://api.openai.com/v1/live/sessions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',...(requestId?{'X-Client-Request-Id':requestId}:{})},body:JSON.stringify({session,transport:{type:'webrtc',sdp}}),signal:AbortSignal.timeout(25000)});
 if(!r.ok){const diagnostic=await liveFailureDiagnostic(r,[key]);console.warn('gpt_live_start_failed',diagnostic);throw new LiveServiceError(r.status,diagnostic);}
 const data=await r.json();
 if(!validLiveSessionId(data?.session?.id)||typeof data?.transport?.sdp!=='string'||!data.transport.sdp.startsWith('v=0')){if(validLiveSessionId(data?.session?.id))await hangupLive(key,data.session.id,fetcher);throw Error('GPT-Live gaf geen bevestigde sessie en SDP terug.');}
 return {sdp:data.transport.sdp,realtimeId:data.session.id,speechEngine:'gpt-live',model:LIVE_MODEL};
}
export async function hangupLive(key,id,fetcher=fetch,{onFailure=()=>{}}={}){
 if(id===undefined||id===null||id==='')return true;
 let restStatus=null,attachStatus=null,rest=null,attach=null;
 const unconfirmed=reason=>{const diagnostic={restStatus,attachStatus,reason,rest,attach};console.warn('gpt_live_close_unconfirmed',diagnostic);onFailure(diagnostic);return false;};
 if(!validLiveSessionId(id))return unconfirmed('invalid_session_id');
 const base='https://api.openai.com/v1/live/sessions/'+encodeURIComponent(id);
 try{const r=await fetcher(base+'/hangup',{method:'POST',headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(5000)});restStatus=r.status;if(r.ok){await r.body?.cancel();return true;}rest=await liveFailureDiagnostic(r,[key,id]);}catch{}
 // A sideband controls the existing WebRTC session. It never starts another one.
 try{
  const r=await fetcher(base+'/attach',{headers:{Upgrade:'websocket',Authorization:'Bearer '+key},signal:AbortSignal.timeout(5000)});attachStatus=r.status;
  if(!r.webSocket){if(r.status===404){await r.body?.cancel();return true;}attach=await liveFailureDiagnostic(r,[key,id]);return unconfirmed('attach_rejected');}
  const reason=await closeAttachedSession(r.webSocket);if(reason==='closed')return true;
  return unconfirmed(reason);
 }catch{return unconfirmed('attach_failed');}
}
async function liveFailureDiagnostic(response,secrets){
 const token=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(value)&&!secrets.some(s=>s&&value.includes(s))&&!/^(sk-|voice_|sess_|live_)/i.test(value)?value:null;
 const type=(response.headers?.get('content-type')||'').split(';')[0].trim().toLowerCase(),requestId=token(response.headers?.get('x-request-id')),retry=Number(response.headers?.get('retry-after'));
 const diagnostic={status:response.status,responseType:['application/json','text/html','text/plain','application/problem+json'].includes(type)?type:'other',requestId,errorCode:null,errorType:null,retryAfter:Number.isFinite(retry)&&retry>0&&retry<=86400?retry:null,policyBlocked:!!response.headers?.get('x-mitmproxy-blocked-reason')};
 // Never retain raw upstream bodies, session IDs, API keys or conversation text.
 const reader=response.body?.getReader();if(!reader)return diagnostic;
 let text='',size=0;
 try{const decoder=new TextDecoder();while(size<4096){const chunk=await reader.read();if(chunk.done)break;const bytes=chunk.value.slice(0,4096-size);size+=bytes.length;text+=decoder.decode(bytes,{stream:true});}if(size>=4096)await reader.cancel();const data=JSON.parse(text);diagnostic.errorCode=token(data.error?.code);diagnostic.errorType=token(data.error?.type);}catch{}finally{reader.releaseLock();}
 return diagnostic;
}
function closeAttachedSession(socket){
 return new Promise(resolve=>{
  let settled=false,timer;
  const finish=reason=>{if(settled)return;settled=true;clearTimeout(timer);socket.removeEventListener('message',message);socket.removeEventListener('close',closed);socket.removeEventListener('error',failed);try{socket.close(1000);}catch{}resolve(reason);};
  const message=event=>{let data;try{data=JSON.parse(event.data);}catch{return;}if(data.type==='session.closed')finish('closed');else if(data.type==='error')finish('close_rejected');};
  const closed=()=>finish('transport_closed'),failed=()=>finish('transport_failed');
  socket.addEventListener('message',message);socket.addEventListener('close',closed);socket.addEventListener('error',failed);
  timer=setTimeout(()=>finish('close_timeout'),6000);
  try{socket.accept();socket.send(JSON.stringify({type:'session.close'}));}catch{finish('close_send_failed');}
 });
}
const words=Array.from({length:76},(_,n)=>[dutchNumber(n).normalize('NFD').replace(/\p{M}/gu,''),String(n)]).sort((a,b)=>b[0].length-a[0].length);
export function normalizedScript(text){let s=String(text).toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').replace(/[-’']/g,'').replace(/\bhe+[ey]*\b/g,'he').replace(/\bbingo\s+show\b/g,'bingoshow');for(const [word,n] of words)s=s.replace(new RegExp('\\b'+word+'\\b','g'),n);return s.replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
export function pcmWave(chunks){
 const size=chunks.reduce((n,c)=>n+c.length,0),out=new Uint8Array(44+size),view=new DataView(out.buffer),ascii=(offset,s)=>{for(let i=0;i<s.length;i++)out[offset+i]=s.charCodeAt(i);};
 ascii(0,'RIFF');view.setUint32(4,36+size,true);ascii(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,24000,true);view.setUint32(28,48000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,size,true);
 let offset=44;for(const c of chunks){out.set(c,offset);offset+=c.length;}return out;
}
// Prepared script clips use the same GPT-Live model and voice ID as live calls.
// Live's continuous audio has no response.done; finish only after the complete
// expected transcript and 900 ms of actual PCM silence. Never cache partial speech.
export async function synthesizeLiveScript(key,settings,text,request,fetcher=fetch,{scriptTimeoutMs=45000,closeTimeoutMs=6000}={}){
 let r;try{r=await fetcher('https://api.openai.com/v1/live/sessions',{headers:{Upgrade:'websocket',Authorization:'Bearer '+key},signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])});}catch(error){const timedOut=error?.name==='TimeoutError'||request.signal.reason?.name==='TimeoutError',cancelled=request.signal.aborted&&!timedOut;throw new ScriptSpeechError(timedOut?504:cancelled?408:503,timedOut?'timeout':cancelled?'cancelled':'connection',timedOut?'GPT-Live opende de stemverbinding niet op tijd.':cancelled?'De stemvoorbereiding is geannuleerd.':'De GPT-Live-stemverbinding is tijdelijk onderbroken.',{phase:'handshake'});}
 const socket=r.webSocket;
 if(!socket){const diagnostic=await liveFailureDiagnostic(r,[key]);
  if(r.status===401||r.status===403)throw new ScriptSpeechError(502,'key_rejected','OpenAI accepteert de opgeslagen sleutel of deze stemtoegang niet. Controleer de API-instellingen.');
  if(r.status===429){const limited=['rate_limit_exceeded','rate_limit_error'].includes(diagnostic.errorCode)||!diagnostic.errorCode&&diagnostic.errorType==='rate_limit_error';throw new ScriptSpeechError(429,limited?'openai_rate_limit':'openai_limit',limited?'De spraakdienst is tijdelijk druk. De opgeslagen fragmenten blijven behouden.':'OpenAI meldt een gebruiks- of tegoedlimiet. Controleer je API-tegoed.',limited?{retryAfter:Number.isSafeInteger(diagnostic.retryAfter)?diagnostic.retryAfter:5}:{});}
  if([400,404,422].includes(r.status))throw new ScriptSpeechError(502,'live_rejected','GPT-Live accepteert deze stemvoorbereiding niet. Controleer het opgeslagen personage en de modeltoegang.');
  throw new ScriptSpeechError(503,'connection','De spraakdienst kon dit fragment tijdelijk niet voorbereiden.',{retryAfter:diagnostic.retryAfter||3});
 }
 socket.accept();
 const expected=normalizedScript(text),session=liveSession(settings,{instructions:characterLiveInstructions(settings,{scripted:true}),input:[{type:'message',role:'developer',content:[{type:'input_text',text:'Lees nu exact deze scripttekst eenmaal voor en blijf daarna stil:\n'+text}]}]});
 session.audio.format={type:'audio/pcm',rate:24000};
 return new Promise((resolve,reject)=>{
  let finished=false,closing=false,transcript='',size=0,samples=0,lastVoiced=0,started=false,closeTimer,timer,feed;
  const chunks=[];
  const send=e=>socket.send(JSON.stringify(e));
  const clean=()=>{clearTimeout(timer);clearTimeout(closeTimer);clearInterval(feed);request.signal.removeEventListener('abort',abort);};
  const phase=()=>closing?'close':!started?'session_start':!transcript||normalizedScript(transcript)!==expected?'transcript':!size?'audio':'silence';
  const fail=(message,status=503,code='connection')=>{if(finished)return;finished=true;clean();try{send({type:'session.close'});}catch{}try{socket.close(1000);}catch{}reject(new ScriptSpeechError(status,code,message,{phase:phase()}));};
  const complete=()=>{if(finished)return;finished=true;clean();try{socket.close(1000);}catch{}if(!size||normalizedScript(transcript)!==expected)return reject(new ScriptSpeechError(409,'speech_script_mismatch','De stemproef kwam niet overeen met het script. Het fragment is niet opgeslagen.'));resolve(pcmWave(chunks));};
  const abort=()=>fail(request.signal.reason?.name==='TimeoutError'?'De stemvoorbereiding duurde te lang. Opgeslagen fragmenten blijven behouden.':'De stemvoorbereiding is geannuleerd.',request.signal.reason?.name==='TimeoutError'?504:408,request.signal.reason?.name==='TimeoutError'?'timeout':'cancelled');
  request.signal.addEventListener('abort',abort,{once:true});
  if(request.signal.aborted){abort();return;}
  timer=setTimeout(()=>transcript&&normalizedScript(transcript)!==expected?fail('De uitgesproken tekst wijkt af van het script. Het fragment is niet opgeslagen; controleer deze tekst.',409,'speech_script_mismatch'):fail('GPT-Live rondde dit fragment niet op tijd af. Opgeslagen fragmenten blijven behouden.',504,'timeout'),scriptTimeoutMs);
  socket.addEventListener('message',event=>{try{
   const e=JSON.parse(event.data);
   if(e.type==='session.started'){
    started=true;const silent=btoa(String.fromCharCode(...new Uint8Array(4800)));feed=setInterval(()=>{if(!finished&&!closing)try{send({type:'session.input_audio.append',audio:silent});}catch{fail('De GPT-Live-verbinding is onderbroken.');}},100);
   }
   if(e.type==='session.output_transcript.delta')transcript+=e.delta||'';
   if(e.type==='session.output_audio.delta'&&!closing){
    const bytes=Uint8Array.from(atob(e.delta),c=>c.charCodeAt(0));if(bytes.length%2)throw Error('pcm');size+=bytes.length;if(size>6*1024*1024)throw Error('size');chunks.push(bytes);
    const pcm=new DataView(bytes.buffer);for(let i=0;i<bytes.length;i+=2){samples++;if(Math.abs(pcm.getInt16(i,true))>200)lastVoiced=samples;}
    if(lastVoiced&&samples-lastVoiced>21600&&normalizedScript(transcript)===expected){closing=true;clearInterval(feed);send({type:'session.close'});closeTimer=setTimeout(()=>fail('GPT-Live heeft het einde van dit fragment niet op tijd bevestigd.',504,'timeout'),closeTimeoutMs);}
   }
   if(e.type==='session.closed'){if(closing)complete();else fail('De stemvoorbereiding is voortijdig gesloten en kwam niet volledig overeen met het script.',409,'speech_script_mismatch');}
   if(e.type==='error'||e.type==='session.delegation.created')fail('GPT-Live kon dit script niet als een volledige uitspraak voorbereiden.',502,'live_rejected');
  }catch{fail('Het GPT-Live-stemfragment kon niet worden gecontroleerd.',502,'invalid_audio');}});
  socket.addEventListener('error',()=>fail('De GPT-Live-verbinding is onderbroken.'));
  socket.addEventListener('close',()=>{if(!finished)fail(started?'GPT-Live sloot voordat het script bevestigd was.':'GPT-Live kon niet starten.');});
  try{send({type:'session.start',session});}catch{fail('GPT-Live kon niet starten.');}
 });
}
