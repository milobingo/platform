import {apiJSON} from '../public/openai-voice.js';

const abortError=()=>Object.assign(Error('De audiovoorbereiding is gewijzigd.'),{name:'AbortError'});
const identityOf=(text,speed,characterId)=>JSON.stringify([characterId,Number(speed),text.trim()]);
const MAX_AUDIO_BYTES=256*1024*1024;
const permanentErrors=new Set(['not_configured','key_rejected','live_rejected','owner_only','sign_in','invalid_audio','speech_script_mismatch','show_audio_changed','speech_profile_changed','show_cancelled','speech_not_prepared','settings_unavailable']);

function retryAfter(response){
 const value=response.headers.get('retry-after');if(!value)return null;
 const seconds=Number(value),delay=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-Date.now();
 return Number.isFinite(delay)&&delay>=0?delay:null;
}

// Only the director's explicit preparation action may generate fixed scripts.
// Tracking edits and checking readiness must never start paid generation.
// Bytes stay in this tab. A running show may restore the durable server cache
// without turning a reload or resume into a new paid generation action.
export class PreparedShowAudio{
 constructor({read,beforePrepare=async()=>{},onChange=()=>{},manifest=body=>apiJSON('show-audio',body),fetcher=(...args)=>globalThis.fetch(...args),minimumGenerationGap=2200,retryLimit=2,retryDelayMs=1200}={}){
  Object.assign(this,{read,beforePrepare,onChange,manifest,fetcher,minimumGenerationGap,retryLimit,retryDelayMs});this.epoch=0;this.cache=new Map();this.entries=new Map();this.bytes=0;this.phase='idle';this.error='';this.ready=0;this.total=0;this.reusedTotal=0;this.retrying=0;this.fingerprint=null;this.controllers=new Set();this.nextGenerationAt=0;
 }
 get state(){return {gameId:this.gameId||null,phase:this.phase,restoring:this.phase==='loading'&&!!this.restoring,ready:this.ready,total:this.total,reusedTotal:this.reusedTotal,newTotal:this.total-this.reusedTotal,retrying:this.retrying,error:this.error,fingerprint:this.fingerprint,complete:this.phase==='ready'&&this.ready===this.total};}
 track(){
  const current=this.read();
  if(!current?.enabled){if(this.identity!==null&&this.identity!==undefined)this.reset(null);return;}
  if(current.identity===this.identity)return;
  const changed=this.gameId===current.gameId&&this.phase!=='idle';
  this.reset(current.identity);this.gameId=current.gameId;this.phase=changed?'stale':'idle';this.onChange();
 }
 reset(identity){
  this.epoch++;for(const controller of this.controllers)controller.abort();this.controllers.clear();this.identity=identity;this.pending=null;this.entries.clear();this.items=[];this.phase='idle';this.error='';this.ready=0;this.total=0;this.reusedTotal=0;this.retrying=0;this.fingerprint=null;
 }
 lookup(text,speed,selection={}){
  if(!this.identity||this.read()?.identity!==this.identity)return null;
  const item=this.entries.get(identityOf(text,speed,selection.characterId));return item&&this.cache.has(item.key)?{...item,fingerprint:this.fingerprint,bytes:this.cache.get(item.key)}:null;
 }
 knows(text,speed,characterId){return this.entries.has(identityOf(text,speed,characterId));}
 async prepare({retry=false,cacheOnly=false}={}){
  this.track();
  if(!this.identity)return;
  if(this.pending)return this.pending;
  if(this.phase==='ready'&&!retry)return this.state;
  const epoch=this.epoch,identity=this.identity;let stopped=false;
  const current=()=>{if(stopped||this.epoch!==epoch||this.read()?.identity!==identity)throw abortError();};
  this.phase='loading';this.restoring=cacheOnly;this.error='';this.onChange();
  const operation=(async()=>{
   try{
    if(!cacheOnly)await this.beforePrepare();current();
    const data=await this.manifest({gameId:this.gameId});current();
    if(!data||!Array.isArray(data.items)||data.items.length>3000||typeof data.fingerprint!=='string')throw Error('De lijst met showaudio kon niet worden bevestigd.');
    this.fingerprint=data.fingerprint;this.items=data.items;this.entries=new Map(data.items.map(item=>[identityOf(item.text,item.speed,item.characterId),item]));this.total=data.items.length;this.reusedTotal=data.items.filter(item=>item.ready).length;
    for(const item of data.items)if(!item.ready&&this.cache.has(item.key)){this.bytes-=this.cache.get(item.key).byteLength;this.cache.delete(item.key);}
    this.ready=data.items.filter(item=>this.cache.has(item.key)).length;this.onChange();
    // Retain current scripts first when a previous, larger show filled the tab.
    const needed=new Set(data.items.map(item=>item.key));for(const [key,bytes]of this.cache)if(!needed.has(key)){this.cache.delete(key);this.bytes-=bytes.byteLength;}
    // Existing clips never wait behind a slow generation or its pacing timer.
    // Keep the provider's two-request/30-per-minute ceiling for new speech.
    const available=data.items.filter(item=>item.ready),missing=data.items.filter(item=>!item.ready);
    const queue=cacheOnly?available:[...available,...missing];let index=0;
    const load=async item=>{for(let attempt=0;;attempt++){
     if(!item.ready){const start=Math.max(Date.now(),this.nextGenerationAt);this.nextGenerationAt=start+this.minimumGenerationGap;await this.wait(Math.max(0,start-Date.now()),epoch);current();}
     const controller=new AbortController();this.controllers.add(controller);
     try{
      const response=await this.fetcher('/api/openai/speech',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId:this.gameId,characterId:item.characterId,speed:item.speed,text:item.text,expectedKey:item.key,cacheOnly:cacheOnly||!!item.ready}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(75000)])});current();
      if(!response.ok){const data=await response.json().catch(()=>({}));throw Object.assign(Error(data.error?.message||'Een stemfragment kon niet worden voorbereid.'),{status:response.status,code:data.error?.code,retryAfterMs:retryAfter(response)});}
      if(!(response.headers.get('content-type')||'').startsWith('audio/')||response.headers.get('x-vlampie-clip')!==item.key)throw Error('Het ontvangen fragment hoort niet bij deze showvoorbereiding.');
      const bytes=await response.arrayBuffer();current();if(!bytes.byteLength||bytes.byteLength>8*1024*1024)throw Error('Een stemfragment heeft geen geldige audiolengte.');
      if(this.bytes+bytes.byteLength>MAX_AUDIO_BYTES)throw Error('Dit draaiboek bevat meer audio dan dit regievenster tegelijk kan inladen. Verdeel het over kortere shows.');
      const duration=Number(response.headers.get('x-milo-audio-duration-ms'));if(Number.isFinite(duration)&&duration>0)item.durationMs=duration;
      this.cache.set(item.key,bytes);this.bytes+=bytes.byteLength;item.ready=true;this.ready++;this.onChange();return;
     }catch(error){
      current();const delay=this.retryDelay(error,attempt);if(delay===null)throw error;
      this.controllers.delete(controller);this.retrying++;this.onChange();
      try{await this.wait(delay,epoch);current();}finally{if(this.epoch===epoch){this.retrying--;this.onChange();}}
     }finally{this.controllers.delete(controller);}
    }};
    const worker=async()=>{while(index<queue.length){current();const item=queue[index++];if(!this.cache.has(item.key))await load(item);}};
    await Promise.all([worker(),worker()]);current();
    if(cacheOnly&&missing.length)throw Error(`${missing.length} van de ${this.total} vaste stemfragmenten ontbreken voor de huidige show en stemmen. Je spelstand blijft behouden. Open Voorbereiden en klik op ‘Resterende audio voorbereiden’.`);
    this.phase='ready';this.onChange();return this.state;
   }catch(error){stopped=true;if(this.epoch===epoch&&error.name!=='AbortError'){for(const controller of this.controllers)controller.abort();if(cacheOnly&&error.code==='speech_not_prepared')error.message='Een opgeslagen stemfragment is niet meer beschikbaar. Je spelstand blijft behouden. Open Voorbereiden en klik op ‘Resterende audio voorbereiden’.';this.phase='error';this.error=error.message||'De showaudio kon niet worden voorbereid. Opgeslagen fragmenten blijven behouden.';this.onChange();}throw error;}
   finally{if(this.epoch===epoch)this.pending=null;}
  })();this.pending=operation;return operation;
 }
 retryDelay(error,attempt){
  if(attempt>=this.retryLimit||permanentErrors.has(error.code))return null;
  const limited=error.status===429&&['busy','openai_rate_limit'].includes(error.code)&&Number.isFinite(error.retryAfterMs)&&error.retryAfterMs>=0;
  const transient=[408,502,503,504].includes(error.status)||['TimeoutError','TypeError'].includes(error.name);
  if(!limited&&!transient)return null;
  const delay=Math.max(this.retryDelayMs*2**attempt,error.retryAfterMs||0);
  return delay<=65000?delay:null;
 }
 wait(ms,epoch){
  if(this.epoch!==epoch)return Promise.reject(abortError());if(ms<=0)return Promise.resolve();
  const controller=new AbortController();this.controllers.add(controller);
  return new Promise((resolve,reject)=>{
   const finish=error=>{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);this.controllers.delete(controller);error?reject(error):resolve();};
   const abort=()=>finish(abortError()),timer=setTimeout(()=>finish(this.epoch===epoch?null:abortError()),ms);
   controller.signal.addEventListener('abort',abort,{once:true});
  });
 }
 async ensure({restoreCached=false}={}){
  this.track();
  const epoch=this.epoch,identity=this.identity;
  // A start/resume may wait for an action already chosen by the director,
  // but it is never an alternative entry point for generation.
  if(this.pending)await this.pending;
  if(this.epoch!==epoch||identity&&this.read()?.identity!==identity)throw abortError();
  if(restoreCached&&this.identity&&this.phase!=='ready')await this.prepare({cacheOnly:true});
  if(this.phase!=='ready'||this.read()?.identity!==this.identity)throw Error(this.error||(this.phase==='stale'?'Het draaiboek of een stem is gewijzigd. Open Voorbereiden en klik op ‘Gewijzigde audio voorbereiden’.':'De vaste showaudio is nog niet voorbereid. Open Voorbereiden en klik op ‘Audio voorbereiden’.'));
  return this.state;
 }
 dispose(){this.reset(null);this.cache.clear();this.bytes=0;}
}
