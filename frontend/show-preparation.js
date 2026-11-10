// Serialize preparation writes without replacing edits made while a request is
// in flight. The server compares preparationRevision independently of heartbeats.
export const preparationFields=game=>({title:game.title,date:game.date,timeZone:game.timeZone||'Europe/Amsterdam',plan:structuredClone(game.plan),settings:structuredClone(game.settings)});
export const preparationFingerprint=game=>JSON.stringify(preparationFields(game));

export class PreparationAutosave{
 constructor({read,persist,apply,onChange=()=>{},delay=650,schedule=(callback,ms)=>setTimeout(callback,ms),cancel=timer=>clearTimeout(timer)}){
  Object.assign(this,{read,persist,apply,onChange,delay,schedule,cancel});this.epoch=0;this.sequence=0;this.saved=0;this.revision=0;this.status='saved';this.error=null;this.conflict=false;
 }
 get state(){return {status:this.status,error:this.error?.message||'',conflict:this.conflict,dirty:this.sequence!==this.saved};}
 reset(revision=0){this.cancel(this.timer);this.timer=null;this.epoch++;this.sequence=0;this.saved=0;this.revision=Number(revision)||0;this.status='saved';this.error=null;this.conflict=false;this.inflight=null;}
 mark({schedule=true}={}){this.sequence++;this.error=null;this.conflict=false;this.status='saving';this.cancel(this.timer);this.timer=schedule?this.schedule(()=>{this.timer=null;void this.flush().catch(()=>{});},this.delay):null;this.onChange();}
 async flush(){
  this.cancel(this.timer);this.timer=null;
  if(this.inflight){await this.inflight;if(this.sequence!==this.saved)return this.flush();return;}
  if(this.sequence===this.saved)return;
  const epoch=this.epoch,sequence=this.sequence,value=structuredClone(this.read()),revision=this.revision;
  this.status='saving';this.error=null;this.conflict=false;this.onChange();
  const operation=(async()=>{
   try{
    const result=await this.persist(value,revision);
    if(this.epoch!==epoch)return;
    this.revision=Number(result?.game?.preparationRevision??revision+1);this.saved=sequence;
    this.apply(result,{current:this.sequence===sequence,value,revision:this.revision});
    this.status=this.sequence===this.saved?'saved':'saving';this.error=null;this.conflict=false;
   }catch(error){
    if(this.epoch===epoch){this.status='error';this.error=error;this.conflict=['preparation_conflict','preparation_locked'].includes(error?.code);}
    throw error;
   }finally{if(this.epoch===epoch){this.inflight=null;this.onChange();}}
  })();
  this.inflight=operation;await operation;
  if(this.epoch===epoch&&this.sequence!==this.saved)return this.flush();
 }
 dispose(){this.cancel(this.timer);this.timer=null;this.epoch++;}
}

// A display of the authoritative clock. Local holds get a fresh interval when
// released; an overdue clock can request one ball, never a catch-up batch.
export function drawClockStatus(game,{now=Date.now(),blocked=false,localNextAt=0}={}){
 const nextAt=Math.max(Number(game.state?.drawClock?.nextAt)||0,localNextAt||0),intervalMs=15000;
 return {intervalMs,nextAt:nextAt||null,remainingMs:blocked?intervalMs:nextAt?Math.max(0,nextAt-now):intervalMs,blocked,due:!blocked&&!!nextAt&&now>=nextAt};
}
