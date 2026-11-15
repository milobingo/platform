import {splitSpeechText} from './speech-text.js';
export async function apiJSON(path,body,signal){
  const response=await fetch('/api/openai/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json',...(path==='settings'?{'X-Vlampie-Settings':'1'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal});
  let data;try{data=await response.json();}catch{throw new Error('De serverkoppeling is nog niet beschikbaar. Ververs de studio en probeer opnieuw.');}
  if(!response.ok)throw new Error(data.error?.message||'De OpenAI-aanvraag is mislukt.');
  return data;
}

// One audio owner, one bounded clip at a time. The script can be long while
// decoding, caching and the OBS acknowledgement keep their existing limits.
export function createOpenAIVoice({onState=()=>{},onStart=()=>{},onEnd=()=>{},onError=()=>{},fetcher=fetch,Context=globalThis.AudioContext||globalThis.webkitAudioContext,getRemote=()=>null,getPrepared=()=>null,canPlay=()=>true}={}){
  let gain,analyser,volume=1,remote=null;
  let context,source,buffer,controller,generation=0,phase='idle',text='',started=0,pauseRequested=false,remoteStart=null;
  let chunks=[],chunkIndex=0,completedMs=0,speed=1,presentation={};
  const setPhase=value=>{phase=value;onState(value);};
  const current=token=>token===generation;
  function clearSource(){if(source){source.onended=null;try{source.stop();}catch{}source.disconnect();source=null;}}
  function stop(){generation++;remote?.stop();remote=null;remoteStart=null;controller?.abort();controller=null;clearSource();buffer=null;chunks=[];chunkIndex=0;completedMs=0;pauseRequested=false;setPhase('idle');}
  async function finishChunk(token){
    if(!current(token))return;
    completedMs+=(buffer?.duration||0)*1000;clearSource();buffer=null;remote=null;remoteStart=null;chunkIndex++;
    if(chunkIndex>=chunks.length){pauseRequested=false;setPhase('idle');onEnd();return;}
    setPhase('loading');await loadChunk(token);
  }
  function play(token){
    if(!current(token)||!buffer)return;
    if(pauseRequested||!canPlay()||context.state!=='running'){setPhase('ready');return;}
    clearSource();source=context.createBufferSource();source.buffer=buffer;source.connect(gain||context.destination);
    source.onended=()=>{if(current(token))void finishChunk(token);};
    started=context.currentTime;source.start();setPhase('playing');onStart(text,buffer.duration*1000);
  }
  async function loadChunk(token){
    if(!current(token))return;
    text=chunks[chunkIndex];controller=new AbortController();const signal=controller.signal;
    try{
      const prepared=getPrepared(text,speed,presentation);
      if(presentation.preparedOnly&&!prepared)throw new Error('De vaste showaudio is nog niet ingeladen. Wacht op de audiovoorbereiding en hervat daarna.');
      const response=prepared?null:await fetcher('/api/openai/speech',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...presentation,text,speed}),signal});
      if(!current(token))return;
      if(response&&!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error?.message||'De OpenAI-stem kon niet worden opgehaald.');}
      if(response&&!(response.headers.get('content-type')||'').startsWith('audio/'))throw new Error('Er kwam geen audio terug. Ververs de studio en probeer opnieuw.');
      const bytes=prepared?prepared.bytes.slice(0):await response.arrayBuffer();if(!current(token))return;
      const decoded=await context.decodeAudioData(bytes);if(!current(token))return;
      if(!Number.isFinite(decoded.duration)||decoded.duration<=0||decoded.duration>120)throw new Error('De ontvangen audio heeft geen geldige lengte.');
      buffer=decoded;controller=null;remote=getRemote();if(remote){
       const start=async()=>{
        if(!current(token))return;remoteStart=null;
        try{const playback=remote.play(prepared?.clip||response.headers.get('x-vlampie-clip'),text,decoded.duration*1000,()=>{if(current(token)){if(!canPlay()){remote.pause();setPhase('paused');return;}onStart(text,decoded.duration*1000);setPhase(pauseRequested?'paused':'playing');}},{canPlay,preparedOnly:!!prepared,preparedFingerprint:prepared?.fingerprint||null,onBlocked:()=>{if(current(token))setPhase('ready');}});if(pauseRequested)remote.pause();await playback;if(current(token))await finishChunk(token);}
        catch(error){if(!current(token))return;stop();if(error.name!=='AbortError')onError(error.message||'De stem kon niet worden afgespeeld.');}
       };
       if(pauseRequested||!canPlay()){remoteStart=start;setPhase('ready');}else await start();
      }else play(token);
    }catch(error){if(!current(token))return;stop();if(error.name!=='AbortError')onError(error.message||'De stem kon niet worden afgespeeld.');}
  }
  async function speak(input,rate=1,selection={}){
    stop();const token=generation;
    try{
      chunks=splitSpeechText(input).filter(part=>part.trim());speed=rate;presentation={...selection};setPhase('loading');
      if(!Context)throw new Error('Deze browser ondersteunt de OpenAI-audioweergave niet. Kies de browserstem.');
      context??=new Context();if(!gain&&context.createGain){gain=context.createGain();gain.gain.value=volume;if(context.createAnalyser){analyser=context.createAnalyser();analyser.fftSize=256;gain.connect(analyser);analyser.connect(context.destination);}else gain.connect(context.destination);}
      context.onstatechange=()=>{if(source&&['playing','paused'].includes(phase))setPhase(context.state==='running'?'playing':'paused');};
      // Resume within the user gesture, before the first network request.
      context.resume().catch(()=>{});await loadChunk(token);
    }catch(error){if(!current(token))return;stop();if(error.name!=='AbortError')onError(error.message||'De stem kon niet worden afgespeeld.');}
  }
  async function resume(){
    const token=generation;if(!canPlay()){setPhase('ready');return;}pauseRequested=false;if(remote){if(remoteStart){void remoteStart();return;}remote.resume();setPhase('playing');return;}if(!buffer)return;
    const continuing=!!source;
    try{await context.resume();if(current(token)){if(!canPlay()){pauseRequested=true;await context.suspend();setPhase('ready');return;}if(continuing)setPhase(context.state==='running'?'playing':'paused');else play(token);}}catch{if(current(token))onError('Tik opnieuw op Stem afspelen om het geluid toe te staan.');}
  }
  async function pause(){pauseRequested=true;if(remote){remote.pause();setPhase('paused');return;}if(source&&context){try{await context.suspend();if(source)setPhase('paused');}catch{}}}
  return {speak,stop,resume,pause,setVolume(v){volume=Math.max(0,Math.min(1,v));if(gain)gain.gain.value=volume;},get meter(){if(!analyser)return 0;const a=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(a);return Math.min(1,Math.sqrt(a.reduce((n,v)=>n+((v-128)/128)**2,0)/a.length)*3);},get phase(){return phase;},get elapsed(){if(remote)return remote.getElapsed();return ['playing','paused'].includes(phase)?Math.max(0,(context.currentTime-started)*1000):0;},get totalElapsed(){return completedMs+(remote?remote.getElapsed():['playing','paused'].includes(phase)?Math.max(0,(context.currentTime-started)*1000):0);},get running(){return phase==='playing'&&(remote||context.state==='running');}};
}
