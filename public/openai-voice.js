export async function apiJSON(path,body,signal){
  const response=await fetch('/api/openai/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json',...(path==='settings'?{'X-Vlampie-Settings':'1'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal});
  let data;try{data=await response.json();}catch{throw new Error('De serverkoppeling is nog niet beschikbaar. Ververs de studio en probeer opnieuw.');}
  if(!response.ok)throw new Error(data.error?.message||'De OpenAI-aanvraag is mislukt.');
  return data;
}

// One audio owner: this controller is created only by the regie window.
// Decoding the complete short utterance gives exact timing and avoids stream stalls.
export function createOpenAIVoice({onState=()=>{},onStart=()=>{},onEnd=()=>{},onError=()=>{},fetcher=fetch,Context=globalThis.AudioContext||globalThis.webkitAudioContext,getRemote=()=>null}={}){
  let gain,analyser,volume=1,remote=null;
  let context,source,buffer,controller,generation=0,phase='idle',text='',started=0,pauseRequested=false;
  const setPhase=value=>{phase=value;onState(value);};
  const current=token=>token===generation;
  function clearSource(){if(source){source.onended=null;try{source.stop();}catch{}source.disconnect();source=null;}}
  function stop(){generation++;remote?.stop();remote=null;controller?.abort();controller=null;clearSource();buffer=null;pauseRequested=false;setPhase('idle');}
  function play(token){
    if(!current(token)||!buffer)return;
    if(pauseRequested||context.state!=='running'){setPhase('ready');return;}
    clearSource();source=context.createBufferSource();source.buffer=buffer;source.connect(gain||context.destination);
    source.onended=()=>{if(!current(token))return;clearSource();buffer=null;pauseRequested=false;setPhase('idle');onEnd();};
    started=context.currentTime;source.start();setPhase('playing');onStart(text,buffer.duration*1000);
  }
  async function speak(input,speed=1,presentation={}){
    stop();const token=generation;text=input;controller=new AbortController();const signal=controller.signal;
    setPhase('loading');
    try{
      if(!Context)throw new Error('Deze browser ondersteunt de OpenAI-audioweergave niet. Kies de browserstem.');
      context??=new Context();if(!gain&&context.createGain){gain=context.createGain();gain.gain.value=volume;if(context.createAnalyser){analyser=context.createAnalyser();analyser.fftSize=256;gain.connect(analyser);analyser.connect(context.destination);}else gain.connect(context.destination);}
      context.onstatechange=()=>{if(source&&['playing','paused'].includes(phase))setPhase(context.state==='running'?'playing':'paused');};
      // Start resume within the user's gesture, before the network request.
      context.resume().catch(()=>{});
      const response=await fetcher('/api/openai/speech',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...presentation,text:input,speed}),signal});
      if(!current(token))return;
      if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error?.message||'De OpenAI-stem kon niet worden opgehaald.');}
      if(!(response.headers.get('content-type')||'').startsWith('audio/'))throw new Error('Er kwam geen audio terug. Ververs de studio en probeer opnieuw.');
      const bytes=await response.arrayBuffer();if(!current(token))return;
      const decoded=await context.decodeAudioData(bytes);if(!current(token))return;
      if(!Number.isFinite(decoded.duration)||decoded.duration<=0||decoded.duration>120)throw new Error('De ontvangen audio heeft geen geldige lengte.');
      buffer=decoded;controller=null;remote=getRemote();if(remote){const playback=remote.play(response.headers.get('x-vlampie-clip'),input,decoded.duration*1000,()=>{if(current(token)){onStart(input,decoded.duration*1000);setPhase(pauseRequested?'paused':'playing');}});if(pauseRequested)remote.pause();await playback;if(current(token)){remote=null;buffer=null;setPhase('idle');onEnd();}}else play(token);
    }catch(error){if(!current(token))return;stop();if(error.name!=='AbortError')onError(error.message||'De stem kon niet worden afgespeeld.');}
  }
  async function resume(){
    const token=generation;pauseRequested=false;if(remote){remote.resume();setPhase('playing');return;}if(!buffer)return;
    const continuing=!!source;
    try{await context.resume();if(current(token)){if(continuing)setPhase(context.state==='running'?'playing':'paused');else play(token);}}catch{if(current(token))onError('Tik opnieuw op Stem afspelen om het geluid toe te staan.');}
  }
  async function pause(){pauseRequested=true;if(remote){remote.pause();setPhase('paused');return;}if(source&&context){try{await context.suspend();if(source)setPhase('paused');}catch{}}}
  return {speak,stop,resume,pause,setVolume(v){volume=Math.max(0,Math.min(1,v));if(gain)gain.gain.value=volume;},get meter(){if(!analyser)return 0;const a=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(a);return Math.min(1,Math.sqrt(a.reduce((n,v)=>n+((v-128)/128)**2,0)/a.length)*3);},get phase(){return phase;},get elapsed(){if(remote)return remote.getElapsed();return ['playing','paused'].includes(phase)?Math.max(0,(context.currentTime-started)*1000):0;},get running(){return phase==='playing'&&(remote||context.state==='running');}};
}
