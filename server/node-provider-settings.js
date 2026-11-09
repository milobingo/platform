// Native provider operations and credential changes share one lock. The local
// FIFO is acquired BEFORE PostgreSQL's advisory lock: waiting requests must not
// occupy every pool connection while the current owner still needs that pool.
import {readPrivateSetting,writePrivateSetting,assertProviderSettingsLease} from './secrets.js';
const locks=new WeakMap();
const PREVIEWS='native-provider-preview-resources';
const error=(message,status=409,code='provider_settings_busy')=>Object.assign(new Error(message),{status,code});
export async function withProviderSettingsLock(env,operation){
 if(!env.NATIVE_PROVIDER_SETTINGS||env.PROVIDER_SETTINGS_LOCKED)return operation(env);
 const key=env.DB||env.SETTINGS;if(!key)throw error('De beveiligde instellingenopslag is niet beschikbaar.',503,'settings_unavailable');
 let state=locks.get(key);if(!state){state={tail:Promise.resolve(),pending:0};locks.set(key,state);}
 if(state.pending>=64)throw error('De providerbediening is bezig. Probeer straks opnieuw.',503);
 state.pending++;
 const preceding=state.tail;let release;const turn=new Promise(resolve=>{release=resolve;});state.tail=preceding.then(()=>turn);
 let timer;
 try{
  await Promise.race([preceding,new Promise((_,reject)=>{timer=setTimeout(()=>reject(error('De providerbediening is nog bezig. Probeer straks opnieuw.',503)),30000);})]);
  clearTimeout(timer);
  const run=lease=>operation({...env,PROVIDER_SETTINGS_LOCKED:true,PROVIDER_SETTINGS_SIGNAL:lease?.signal,PROVIDER_SETTINGS_DEADLINE:Math.min(lease?.deadline||Infinity,Date.now()+120000)});
  return await (env.DB?.withObjectLock?env.DB.withObjectLock('native-provider-credentials-v1',run,{idleTimeoutMs:180000}):run());
 }finally{clearTimeout(timer);state.pending--;release();if(!state.pending&&locks.get(key)===state)locks.delete(key);}
}

async function previewLedger(env){
 const saved=await readPrivateSetting(env,PREVIEWS);
 if(saved.revision!==null&&(!saved.value||saved.value.version!==1||!Array.isArray(saved.value.entries)||saved.value.entries.some(entry=>!entry||typeof entry.id!=='string'||typeof entry.ownerId!=='string')))throw error('De afsluiting van microfoontests kan niet veilig worden gecontroleerd.',503,'settings_unavailable');
 return {revision:saved.revision,value:saved.value||{version:1,entries:[]}};
}
async function changePreviewLedger(env,change){
 for(let attempt=0;attempt<8;attempt++){
  const saved=await previewLedger(env),value=structuredClone(saved.value);change(value.entries);
  if(await writePrivateSetting(env,PREVIEWS,value,saved.revision))return;
 }
 throw error('De microfoontestregistratie wordt tegelijk gewijzigd. Probeer opnieuw.',409,'settings_conflict');
}
export async function reserveNativePreview(env,ownerId,fingerprint){
 if(!env.NATIVE_PROVIDER_SETTINGS)return null;
 const id=crypto.randomUUID();await changePreviewLedger(env,entries=>{if(entries.length>=200)throw error('Sluit eerst eerdere microfoontests af.',409,'call_cleanup_required');entries.push({id,ownerId,fingerprint,state:'starting',createdAt:Date.now()});});return id;
}
export async function bindNativePreview(env,id,sessionId){
 if(!id)return false;let cancelled=false;
 await changePreviewLedger(env,entries=>{const entry=entries.find(row=>row.id===id);if(!entry)throw error('De microfoontestreservering is gewijzigd.',409,'settings_conflict');entry.sessionId=sessionId;entry.state='open';cancelled=entry.cancelRequested===true;});return cancelled;
}
export async function cancelNativePreview(env,id,ownerId){await changePreviewLedger(env,entries=>{const entry=entries.find(row=>row.id===id&&row.ownerId===ownerId);if(!entry)throw error('De microfoontestreservering is gewijzigd.',409,'settings_conflict');entry.cancelRequested=true;});}
export async function closeNativePreview(env,{reservationId,sessionId}={}){
 if(!env.NATIVE_PROVIDER_SETTINGS)return;
 await changePreviewLedger(env,entries=>{for(let index=entries.length-1;index>=0;index--)if(reservationId&&entries[index].id===reservationId||sessionId&&entries[index].sessionId===sessionId)entries.splice(index,1);});
}
export async function ownedNativePreview(env,ownerId,{sessionId,latest=false}={}){
 if(!env.NATIVE_PROVIDER_SETTINGS)return null;
 const entries=(await previewLedger(env)).value.entries.filter(entry=>entry.ownerId===ownerId);
 return latest?entries.sort((a,b)=>b.createdAt-a.createdAt)[0]||null:entries.find(entry=>entry.sessionId===sessionId)||null;
}

// Credentials are shared by every organizer. Checking only the actor's call
// would strand another organizer's provider resources after a rotation.
export async function assertProviderRotationAllowed(env){
 assertProviderSettingsLease(env);
 if(!env.DB)throw error('De belstatus kan niet veilig worden gecontroleerd.',503,'settings_unavailable');
 const rows=(await env.DB.prepare('SELECT document FROM studio_calls').all()).results;
 for(const row of rows){
  const call=JSON.parse(row.document);if(!call)continue;
  const active=call.transport==='livekit'?call.phase!=='completed':!['ended','declined','missed','failed'].includes(call.phase);
  const unfinished=call.resourcesClosed===false||(call.realtimeId||call.realtimeStarted)&&!call.realtimeStopped;
  if(active||unfinished)throw error('Rond eerst alle belmomenten en de audio-opruiming af voordat je providersleutels wijzigt.',409,'call_cleanup_required');
 }
 const held=await env.DB.prepare("SELECT id FROM bingo_games WHERE json_extract(document,'$.state.drawHold') IS NOT NULL OR json_extract(document,'$.state.callId') IS NOT NULL LIMIT 1").first();
 if(held)throw error('Rond eerst de geblokkeerde belterugkeer en hervatting af voordat je providersleutels wijzigt.',409,'call_cleanup_required');
 if((await previewLedger(env)).value.entries.length)throw error('Sluit eerst alle microfoontests en onbevestigde starts af voordat je providersleutels wijzigt.',409,'call_cleanup_required');
 const owners=new Set([env.AUTH_IDENTITY?.user]);
 // Also inspect pre-ledger native tests of organizers who have since lost
 // their role. New sessions are discoverable through the durable ledger even
 // if their account and every role row is later removed.
 for(const row of (await env.DB.prepare('SELECT user_id FROM app_user_roles').all()).results)owners.add(row.user_id);
 for(const table of ['bingo_games','studio_calls','show_character_settings'])for(const row of (await env.DB.prepare('SELECT DISTINCT owner_id FROM '+table).all()).results)owners.add(row.owner_id);
 for(const owner of owners){
  assertProviderSettingsLease(env);
  if(!owner)continue;
  const base='private/live-preview/'+encodeURIComponent(owner)+'/',latest=await env.SETTINGS?.get(base+'latest.json');
  if(!latest)continue;
  let record=await latest.json();const seen=new Set();
  for(let depth=0;record;depth++){
   assertProviderSettingsLease(env);
   if(depth>=100||typeof record.id!=='string'||seen.has(record.id))throw error('Een eerdere microfoontest kan niet veilig worden gecontroleerd.',409,'call_cleanup_required');
   seen.add(record.id);
   const owned=await env.SETTINGS.get(base+encodeURIComponent(record.id)+'.json');if(owned)record=await owned.json();
   if(!record.closedAt)throw error('Sluit eerst alle microfoontests en bevestig de afsluiting voordat je providersleutels wijzigt.',409,'call_cleanup_required');
   if(!record.replacesSessionId)break;
   const previous=await env.SETTINGS.get(base+encodeURIComponent(record.replacesSessionId)+'.json');
   if(!previous)throw error('De afsluiting van een eerdere microfoontest is niet bevestigd.',409,'call_cleanup_required');
   record=await previous.json();
  }
 }
 assertProviderSettingsLease(env);
}
