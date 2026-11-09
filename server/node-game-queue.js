import {AsyncLocalStorage} from 'node:async_hooks';

// This schedules local contenders only. Database revisions and atomic batches
// remain the authority for other processes, call preparation and family writes.
const executing=new AsyncLocalStorage();
const unavailable=code=>Object.assign(new Error('De spelserver is bezig. Probeer dezelfde handeling opnieuw; er is nog geen wijziging door deze aanvraag bevestigd.'),{status:503,code});

export function createGameMutationQueue({maxPendingPerGame=128,maxPending=1024,maxWaitMs=30000}={}){
 if(!Number.isSafeInteger(maxPendingPerGame)||maxPendingPerGame<1||maxPendingPerGame>128||!Number.isSafeInteger(maxPending)||maxPending<maxPendingPerGame||maxPending>1024||!Number.isSafeInteger(maxWaitMs)||maxWaitMs<1||maxWaitMs>30000)throw new TypeError('Ongeldige begrenzing voor de lokale spelwachtrij.');
 const keys=new Map(),metrics={pending:0,active:0,enqueued:0,started:0,completed:0,failed:0,rejected:0,expired:0,maxDepth:0,totalWaitMs:0,maxWaitMs:0};
 let closed=false,closing,resolveClosed;
 const snapshot=()=>({enabled:true,...metrics,keys:keys.size,totalWaitMs:Math.round(metrics.totalWaitMs),maxWaitMs:Math.round(metrics.maxWaitMs)});
 const drained=()=>{if(closed&&!metrics.pending)resolveClosed?.();};
 const remove=(key,state)=>{state.count--;metrics.pending--;if(!state.count&&keys.get(key)===state)keys.delete(key);drained();};
 const refused=(entry,key,state,code)=>{clearTimeout(entry.timer);entry.done=true;metrics.rejected++;if(code==='game_queue_timeout')metrics.expired++;remove(key,state);entry.reject(unavailable(code));};
 const next=(key,state)=>{
  if(state.running)return;
  const entry=state.waiting.shift();if(!entry)return;
  if(closed){refused(entry,key,state,'game_queue_closed');return next(key,state);}
  const waited=performance.now()-entry.enqueuedAt;
  // Recheck at admission too: a busy event loop may delay the timeout callback.
  if(waited>=maxWaitMs){refused(entry,key,state,'game_queue_timeout');return next(key,state);}
  clearTimeout(entry.timer);entry.done=true;state.running=true;metrics.active++;metrics.started++;metrics.totalWaitMs+=waited;metrics.maxWaitMs=Math.max(metrics.maxWaitMs,waited);
  const frame={active:true};
  const finish=(succeeded,value)=>{
   frame.active=false;state.running=false;metrics.active--;remove(key,state);
   if(succeeded){metrics.completed++;entry.resolve(value);}else{metrics.failed++;entry.reject(value);}
   next(key,state);
  };
  Promise.resolve().then(()=>executing.run(frame,entry.operation)).then(value=>finish(true,value),error=>finish(false,error));
 };
 const run=(key,operation)=>{
  // Reject all nested keys, including another adapter, to avoid A→B/B→A cycles.
  // Once an outer operation completes, detached async work is no longer nested.
  if(executing.getStore()?.active){metrics.rejected++;return Promise.reject(unavailable('game_queue_nested'));}
  if(typeof key!=='string'||!key||key.length>100||typeof operation!=='function')return Promise.reject(new TypeError('Ongeldige lokale spelmutatie.'));
  if(closed){metrics.rejected++;return Promise.reject(unavailable('game_queue_closed'));}
  let state=keys.get(key);
  if(metrics.pending>=maxPending||(state?.count||0)>=maxPendingPerGame){metrics.rejected++;return Promise.reject(unavailable('game_queue_full'));}
  if(!state){state={running:false,waiting:[],count:0};keys.set(key,state);}
  return new Promise((resolve,reject)=>{
   const entry={operation,resolve,reject,enqueuedAt:performance.now(),done:false,timer:null};
   state.count++;metrics.pending++;metrics.enqueued++;metrics.maxDepth=Math.max(metrics.maxDepth,state.count);state.waiting.push(entry);
   entry.timer=setTimeout(()=>{if(entry.done)return;const index=state.waiting.indexOf(entry);if(index>=0)state.waiting.splice(index,1);refused(entry,key,state,'game_queue_timeout');},maxWaitMs);
   next(key,state);
  });
 };
 const close=()=>{
  if(closing)return closing;
  closed=true;closing=new Promise(resolve=>{resolveClosed=resolve;});
  for(const [key,state] of keys)for(const entry of state.waiting.splice(0))refused(entry,key,state,'game_queue_closed');
  drained();return closing;
 };
 return {run,snapshot,close};
}
