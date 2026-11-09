import {obsFetch} from '../public/obs-access.js';
// Call control remains server-owned. This client never releases a draw hold
// because of a timer, a dropped connection, or a locally completed demo.
export const LIVE_CALL_PHASES=Object.freeze(['preparing','ringing','backstage','staged','live','returning','returned','completed']);
export const liveCallActive=call=>!!call&&call.phase!=='completed';
export async function requestLiveCall(path,body,{fetcher=globalThis.fetch,signal}={}){
 const player=body?.role==='player'||body===undefined&&new URL(path,globalThis.location?.origin||'https://studio.invalid').searchParams.get('role')==='player';
 const response=await obsFetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{...(body===undefined?{}:{'Content-Type':'application/json','X-Vlampie-Call':'1'}),...(player?{'X-Vlampie-Player':'1'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal||AbortSignal.timeout(path.endsWith('/realtime')?30000:20000)},{fetcher});
 let result;try{result=await response.json();}catch{throw new Error('De belbediening is tijdelijk niet bereikbaar. Er is geen trekking vrijgegeven.');}
 if(!response.ok)throw Object.assign(new Error(typeof result.error==='string'?result.error:result.error?.message||'De belactie kon niet worden bevestigd.'),{status:response.status,code:result.code||result.error?.code});
 return result;
}

export class LiveCallConnection{
 constructor({role,getGame,getGameId,getClientId,onChange=()=>{},onError=()=>{},request=requestLiveCall,now=()=>Date.now()}={}){
  if(!['host','player','output'].includes(role))throw new Error('Kies een geldige rol voor de belverbinding.');
  Object.assign(this,{role,getGame,getGameId,getClientId,onChange,onError,requester:request,clock:now});this.call=null;this.lastOK=0;this.offset=0;this.listeners=new Set();this.disposed=false;this.epoch=0;this.commands=0;this.inFlightPoll=null;
 }
 get clientId(){return this.getClientId?.();}
 get gameId(){return this.getGameId?.()||this.getGame?.()?.id||this.getGame?.()||this.call?.gameId||'';}
 get now(){return this.clock()+this.offset;}
 subscribe=listener=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
 getSnapshot=()=>this.call;
 emit(){if(this.disposed)return;this.onChange(this.call);for(const listener of this.listeners)listener(this.call);}
 accept(data){
  if(this.disposed)return data;this.lastOK=this.clock();this.offset=(data.serverTime||this.lastOK)-this.lastOK;
  if(data.call!==undefined){
   const next=data.call,current=this.call;
   if(current&&next&&current.id===next.id&&(next.version||0)<(current.version||0))return data;
   if(current&&next&&current.id!==next.id&&(next.createdAt||0)<(current.createdAt||0))return data;
   this.call=next;this.emit();
  }
  return data;
 }
 bound(body={}){return {...body,role:this.role,clientId:this.clientId,gameId:this.gameId,...(body.callId===undefined&&this.call?.id?{callId:this.call.id}:{})};}
 async request(path,body={}){if(this.disposed)throw new Error('De belbediening is gesloten.');return this.requester(path,this.bound(body));}
 async poll(){
  if(this.disposed||!this.gameId)return null;if(this.inFlightPoll)return this.inFlightPoll;
  const epoch=this.epoch,command=this.commands,gameId=this.gameId,query=new URLSearchParams({role:this.role,clientId:this.clientId,gameId});
  const task=this.requester('/api/live-calls?'+query).then(data=>epoch===this.epoch&&command===this.commands&&gameId===this.gameId?this.accept(data):data).catch(error=>{if(epoch===this.epoch)this.onError(error);throw error;});
  this.inFlightPoll=task;try{return await task;}finally{if(this.inFlightPoll===task)this.inFlightPoll=null;}
 }
 async action(action,extra={}){
  const epoch=this.epoch,gameId=this.gameId;this.commands++;const data=await this.request('/api/live-calls',{...extra,action,requestId:extra.requestId||crypto.randomUUID()});
  return epoch===this.epoch&&gameId===this.gameId?this.accept(data):data;
 }
 token(target){return this.request('/api/live-calls/token',{target});}
 preflight(profileId){return this.request('/api/livekit/preflight',{profileId});}
 realtime(sdp){return this.request('/api/live-calls/realtime',{sdp});}
 stopRealtime(){return this.request('/api/live-calls/realtime-stop',{});}
 heartbeat(extra={}){return this.action('heartbeat',extra);}
 leave(){
  this.epoch++;this.commands++;
  // A best-effort close intentionally retains the persistent server draw hold.
  if(!liveCallActive(this.call)||this.role==='player'&&this.call.canControl===false)return;
  const body=this.bound({action:'fail',reason:'Dit belvenster is gesloten.'});
  void obsFetch('/api/live-calls',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json','X-Vlampie-Call':'1',...(this.role==='player'?{'X-Vlampie-Player':'1'}:{})},body:JSON.stringify(body)}).catch(()=>{});
 }
 dispose(){this.disposed=true;this.epoch++;this.commands++;this.listeners.clear();this.onChange=()=>{};this.onError=()=>{};}
}
