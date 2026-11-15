import {readSecret} from './secrets.js';
import {ShowDesignStore,ownedBatch,designCandidate,touchBatch,abandonDesignRewrite} from './show-design-store.js';
import {designCatalog,designError,validateDesignProposal,compileDesignProposal,assertDistinctProposal} from './show-design-model.js';
import {generateDesignProposal,DESIGN_REQUEST_TIMEOUT_MS,DESIGN_OUTPUT_TOKENS} from './show-design-provider.js';
const flights=new WeakMap();
const recoverable=new Set(['truncated','invalid_schema','incomplete_proposal','invalid_slot','invalid_content','invalid_speaker','invalid_guest','invalid_asset','invalid_duration','similar_proposal']);
const activeControllers=new WeakMap();
const publicError=error=>({code:error?.code||'generation_failed',message:error?.code?error.message:'Het voorstel kon niet veilig worden geschreven. Probeer alleen dit voorstel opnieuw.'});
export function cancelDesignJobs(env,owner,batchId){const jobs=activeControllers.get(env.SETTINGS);for(const [id,entry] of jobs||[])if(entry.owner===owner&&entry.batchId===batchId){entry.controller.abort();jobs.delete(id);}}
async function roleValid(env,owner){const role=await env.DB?.prepare('SELECT role FROM app_user_roles WHERE user_id=?').bind(owner).first();return role?.role==='regie';}
export async function runDesignJobs(env,owner,{fetcher=fetch,maxJobs=3}={}){
 const store=new ShowDesignStore(env,owner);let count=0;
 while(count++<maxJobs){
  const job=await store.edit(data=>{
   const now=Date.now();let changed=false;
   for(const batch of data.batches)for(const candidate of batch.candidates)if(['writing','validating'].includes(candidate.status)&&candidate.lease?.until<=now){candidate.status='failed';candidate.error={code:'interrupted',message:'Het schrijven werd onderbroken. Een eventueel laat antwoord wordt genegeerd. Probeer alleen dit voorstel opnieuw.'};candidate.lease=null;if(candidate.proposal)abandonDesignRewrite(candidate);touchBatch(batch);changed=true;}
   if(data.batches.some(b=>b.candidates.some(c=>['writing','validating'].includes(c.status)&&c.lease?.until>now)))return changed?null:{noWrite:true,value:null};
   const batch=data.batches.find(b=>!b.cancelledAt&&b.candidates.some(c=>c.status==='waiting'));
   if(!batch)return changed?null:{noWrite:true,value:null};const candidate=batch.candidates.find(c=>c.status==='waiting');
   if(candidate.attempt>=4){candidate.status='failed';candidate.error={code:'attempt_limit',message:'Dit voorstel heeft het maximum van vier schrijfpogingen bereikt. Bewaar de bestaande versie of maak later een nieuwe reeks.'};if(candidate.proposal)abandonDesignRewrite(candidate);touchBatch(batch);return null;}
   const day=new Date().toISOString().slice(0,10);if(data.usage.day!==day)data.usage={day,requests:0};
   if(data.usage.requests>=24||batch.reservedOutputTokens+DESIGN_OUTPUT_TOKENS>96000){candidate.status='failed';candidate.error={code:'cost_limit',message:'De begrensde schrijfruimte is bereikt. Eerdere voorstellen blijven beschikbaar; probeer op een volgende dag een nieuwe reeks.'};if(candidate.proposal)abandonDesignRewrite(candidate);touchBatch(batch);return null;}
   data.usage.requests++;batch.reservedOutputTokens+=DESIGN_OUTPUT_TOKENS;candidate.attempt++;candidate.status='writing';candidate.error=null;candidate.lease={id:crypto.randomUUID(),until:now+DESIGN_REQUEST_TIMEOUT_MS+20000};touchBatch(batch);return {batch:structuredClone(batch),candidate:structuredClone(candidate)};
  });
  if(!job)break;
  const {batch,candidate}=job,controller=new AbortController();let controllers=activeControllers.get(env.SETTINGS);if(!controllers){controllers=new Map();activeControllers.set(env.SETTINGS,controllers);}controllers.set(candidate.lease.id,{controller,owner,batchId:batch.id});
  try{
   if(!await roleValid(env,owner))throw designError('owner_only','Je hebt geen regietoegang meer. Het ontwerpen is gestopt.',403);
   const catalog=designCatalog();if(catalog.version!==batch.catalogVersion)throw designError('catalog_changed','De studiocatalogus is gewijzigd. Maak met dezelfde briefing een nieuwe reeks.',409);
   const secret=await readSecret(env);if(!secret.key)throw designError('not_configured','Stel de OpenAI-koppeling in om te ontwerpen.',503);
   const result=await generateDesignProposal({briefing:batch.briefing,options:batch.options,catalog,direction:candidate.direction,feedback:candidate.feedback||'',source:candidate.source||null,slotId:candidate.rewriteSlotId||null,repairCode:candidate.repairCode||null,key:secret.key,signal:controller.signal,fetcher});
   if(controller.signal.aborted)throw designError('cancelled','Het ontwerpen is gestopt.',409);
   if(!await roleValid(env,owner))throw designError('owner_only','Je regietoegang is gewijzigd. Het late voorstel wordt niet opgeslagen.',403);
   const credential=await readSecret(env);if(credential.key!==secret.key||credential.revision!==secret.revision)throw designError('provider_settings_changed','De OpenAI-koppeling is gewijzigd. Probeer dit voorstel opnieuw.',409);
   await store.edit(data=>{const b=ownedBatch(data,batch.id),c=designCandidate(b,candidate.id);if(b.cancelledAt||c.lease?.id!==candidate.lease.id||c.lease.until<=Date.now())return {noWrite:true,value:null};c.status='validating';touchBatch(b);return null;});
   const validated=validateDesignProposal(result.proposal,batch.options,{onlySlot:candidate.rewriteSlotId||null,idPrefix:candidate.id});
   await store.edit(data=>{const b=ownedBatch(data,batch.id),c=designCandidate(b,candidate.id);if(b.cancelledAt||c.lease?.id!==candidate.lease.id||c.lease.until<=Date.now())return {noWrite:true,value:null};
    if(c.rewriteSlotId){c.sceneSuggestion={id:crypto.randomUUID(),baseRevision:c.baseRevision,slotId:c.rewriteSlotId,scene:validated.scenes[0],createdAt:Date.now()};c.status='ready';}
    else{assertDistinctProposal(validated,b.candidates.filter(other=>other.id!==c.id&&other.proposal).map(other=>other.proposal));if(c.proposal)c.history.push({revision:c.revision,proposal:c.proposal,at:Date.now()});c.proposal=compileDesignProposal(validated,b.options);c.revision++;c.status='ready';}
    c.usage=result.usage;c.error=null;c.lease=null;c.source=null;c.repairCode=null;touchBatch(b);return null;
   });
  }catch(error){
   await store.edit(data=>{const b=ownedBatch(data,batch.id),c=designCandidate(b,candidate.id);if(b.cancelledAt||c.lease?.id!==candidate.lease.id||c.lease.until<=Date.now())return {noWrite:true,value:null};c.lease=null;c.error=publicError(error);if(recoverable.has(error?.code)&&c.automaticRetries<1&&!c.rewriteSlotId){c.automaticRetries++;c.repairCode=error.code;c.status='waiting';}else{c.status=error?.code==='cancelled'?'cancelled':'failed';if(c.proposal)abandonDesignRewrite(c);}touchBatch(b);return null;});
  }finally{controllers.delete(candidate.lease.id);}
 }
}
export function wakeDesignJobs(env,owner,{fetcher=fetch}={}){
 let owners=flights.get(env.SETTINGS);if(!owners){owners=new Map();flights.set(env.SETTINGS,owners);}if(owners.has(owner))return owners.get(owner);
 const pending=runDesignJobs(env,owner,{fetcher,maxJobs:6}).catch(()=>{}).finally(()=>owners.delete(owner));owners.set(owner,pending);return pending;
}
