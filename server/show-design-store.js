import {readPrivateSetting,writePrivateSetting,settingsReady} from './secrets.js';
import {designError} from './show-design-model.js';
const MAX_BYTES=4*1024*1024;
export class ShowDesignStore{
 constructor(env,owner){this.env=env;this.owner=owner;this.name=`show-design-${encodeURIComponent(owner)}`;}
 async read(){if(!settingsReady(this.env))throw designError('storage_unavailable','De beveiligde ontwerpopslag is niet beschikbaar.',503);const current=await readPrivateSetting(this.env,this.name);if(current.value&&current.value.version!==1)throw designError('storage_unavailable','De opgeslagen ontwerpen kunnen niet veilig worden gelezen.',503);return {revision:current.revision,data:current.value||{version:1,batches:[],usage:{day:'',requests:0}}};}
 async edit(operation){for(let attempt=0;attempt<12;attempt++){const current=await this.read(),data=structuredClone(current.data),result=await operation(data);if(result?.noWrite)return result.value;if(new TextEncoder().encode(JSON.stringify(data)).length>MAX_BYTES)throw designError('history_limit','De ontwerphistorie is vol. Bewaar een gekozen concept en verwijder een oude reeks voordat je verder ontwerpt.',409);const saved=await writePrivateSetting(this.env,this.name,data,current.revision);if(saved)return result;}throw designError('design_conflict','Een ander venster wijzigt deze ontwerpen. Je invoer blijft staan; laad de huidige versie en vergelijk opnieuw.',409);}
}
export function ownedBatch(data,id){const batch=data.batches.find(b=>b.id===id);if(!batch)throw designError('not_found','Deze ontwerpreeks bestaat niet voor jouw account.',404);return batch;}
export function designCandidate(batch,id){const candidate=batch.candidates.find(c=>c.id===id);if(!candidate)throw designError('not_found','Dit voorstel bestaat niet in deze reeks.',404);return candidate;}
export function touchBatch(batch){batch.revision++;batch.updatedAt=Date.now();batch.status=batch.cancelledAt?'cancelled':batch.candidates.some(c=>['waiting','writing','validating'].includes(c.status))?'working':batch.candidates.every(c=>c.status==='ready')?'ready':'partial';}
// A failed rewrite never turns an already complete proposal into a failed
// proposal. Keep the old, explicitly validated revision available for import.
export function abandonDesignRewrite(candidate){candidate.lease=null;candidate.source=null;candidate.rewriteSlotId=null;candidate.sceneSuggestion=null;candidate.repairCode=null;candidate.baseRevision=null;candidate.rewriteRequestId=null;if(candidate.proposal)candidate.status='ready';}
