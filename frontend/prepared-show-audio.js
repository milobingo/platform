import {apiJSON} from '../public/openai-voice.js';

const abortError=()=>Object.assign(Error('De audiovoorbereiding is gewijzigd.'),{name:'AbortError'});
const identityOf=(text,speed,characterId)=>JSON.stringify([characterId,Number(speed),text.trim()]);
const MAX_AUDIO_BYTES=256*1024*1024;

// All fixed scripts are fetched before the show, without playing or unlocking
// sound. Bytes stay in this tab; only the current utterance is decoded by the
// voice player. The durable server cache is shared by later shows and reloads.
export class PreparedShowAudio{
 constructor({read,beforePrepare=async()=>{},onChange=()=>{},manifest=body=>apiJSON('show-audio',body),fetcher=(...args)=>globalThis.fetch(...args),delay=800,minimumGenerationGap=2200}={}){
  Object.assign(this,{read,beforePrepare,onChange,manifest,fetcher,delay,minimumGenerationGap});this.epoch=0;this.cache=new Map();this.entries=new Map();this.bytes=0;this.phase='idle';this.error='';this.ready=0;this.total=0;this.fingerprint=null;this.controllers=new Set();this.nextGenerationAt=0;
 }
 get state(){return {gameId:this.gameId||null,phase:this.phase,ready:this.ready,total:this.total,error:this.error,fingerprint:this.fingerprint,complete:this.phase==='ready'&&this.ready===this.total};}
 track(){
  const current=this.read();
  if(!current?.enabled){if(this.identity!==null&&this.identity!==undefined)this.reset(null);return;}
  if(current.identity===this.identity)return;
  this.reset(current.identity);this.gameId=current.gameId;this.phase='loading';this.error='';this.onChange();
  this.timer=setTimeout(()=>{this.timer=null;void this.prepare().catch(()=>{});},this.delay);
 }
 reset(identity){
  clearTimeout(this.timer);this.timer=null;this.epoch++;for(const controller of this.controllers)controller.abort();this.controllers.clear();this.identity=identity;this.pending=null;this.entries.clear();this.items=[];this.phase='idle';this.error='';this.ready=0;this.total=0;this.fingerprint=null;
 }
 lookup(text,speed,selection={}){
  if(!this.identity||this.read()?.identity!==this.identity)return null;
  const item=this.entries.get(identityOf(text,speed,selection.characterId));return item&&this.cache.has(item.key)?{...item,fingerprint:this.fingerprint,bytes:this.cache.get(item.key)}:null;
 }
 knows(text,speed,characterId){return this.entries.has(identityOf(text,speed,characterId));}
 async prepare({retry=false}={}){
  clearTimeout(this.timer);this.timer=null;this.track();clearTimeout(this.timer);this.timer=null;
  if(!this.identity)return;
  if(this.pending)return this.pending;
  if(this.phase==='ready'&&!retry)return this.state;
  const epoch=this.epoch,identity=this.identity;let stopped=false;
  const current=()=>{if(stopped||this.epoch!==epoch||this.read()?.identity!==identity)throw abortError();};
  this.phase='loading';this.error='';this.onChange();
  const operation=(async()=>{
   try{
    await this.beforePrepare();current();
    const data=await this.manifest({gameId:this.gameId});current();
    if(!data||!Array.isArray(data.items)||data.items.length>3000||typeof data.fingerprint!=='string')throw Error('De lijst met showaudio kon niet worden bevestigd.');
    this.fingerprint=data.fingerprint;this.items=data.items;this.entries=new Map(data.items.map(item=>[identityOf(item.text,item.speed,item.characterId),item]));this.total=data.items.length;
    for(const item of data.items)if(!item.ready&&this.cache.has(item.key)){this.bytes-=this.cache.get(item.key).byteLength;this.cache.delete(item.key);}
    this.ready=data.items.filter(item=>this.cache.has(item.key)).length;this.onChange();
    // Retain current scripts first when a previous, larger show filled the tab.
    const needed=new Set(data.items.map(item=>item.key));for(const [key,bytes]of this.cache)if(!needed.has(key)){this.cache.delete(key);this.bytes-=bytes.byteLength;}
    let index=0;
    const worker=async()=>{while(index<data.items.length){current();const item=data.items[index++];if(this.cache.has(item.key))continue;
     if(!item.ready){const start=Math.max(Date.now(),this.nextGenerationAt);this.nextGenerationAt=start+this.minimumGenerationGap;await this.wait(Math.max(0,start-Date.now()),epoch);current();}
     const controller=new AbortController();this.controllers.add(controller);
     try{
      const response=await this.fetcher('/api/openai/speech',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({gameId:this.gameId,characterId:item.characterId,speed:item.speed,text:item.text,expectedKey:item.key,cacheOnly:!!item.ready}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(75000)])});current();
      if(!response.ok){const data=await response.json().catch(()=>({}));throw Object.assign(Error(data.error?.message||'Een stemfragment kon niet worden voorbereid.'),{status:response.status});}
      if(!(response.headers.get('content-type')||'').startsWith('audio/')||response.headers.get('x-vlampie-clip')!==item.key)throw Error('Het ontvangen fragment hoort niet bij deze showvoorbereiding.');
      const bytes=await response.arrayBuffer();current();if(!bytes.byteLength||bytes.byteLength>8*1024*1024)throw Error('Een stemfragment heeft geen geldige audiolengte.');
      if(this.bytes+bytes.byteLength>MAX_AUDIO_BYTES)throw Error('Dit draaiboek bevat meer audio dan dit regievenster tegelijk kan inladen. Verdeel het over kortere shows.');
      const duration=Number(response.headers.get('x-milo-audio-duration-ms'));if(Number.isFinite(duration)&&duration>0)item.durationMs=duration;
      this.cache.set(item.key,bytes);this.bytes+=bytes.byteLength;item.ready=true;this.ready++;this.onChange();
     }finally{this.controllers.delete(controller);}
    }};
    await Promise.all([worker(),worker()]);current();this.phase='ready';this.onChange();return this.state;
   }catch(error){stopped=true;if(this.epoch===epoch&&error.name!=='AbortError'){for(const controller of this.controllers)controller.abort();this.phase='error';this.error=error.message||'De showaudio kon niet worden voorbereid. Opgeslagen fragmenten blijven behouden.';this.onChange();}throw error;}
   finally{if(this.epoch===epoch)this.pending=null;}
  })();this.pending=operation;return operation;
 }
 wait(ms,epoch){return new Promise((resolve,reject)=>{setTimeout(()=>this.epoch===epoch?resolve():reject(abortError()),ms);});}
 async ensure(){await this.prepare();if(this.phase!=='ready'||this.read()?.identity!==this.identity)throw Error(this.error||'De showaudio is nog niet volledig ingeladen. Wacht op de voorbereiding en probeer opnieuw.');return this.state;}
 dispose(){this.reset(null);this.cache.clear();this.bytes=0;}
}
