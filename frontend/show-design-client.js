export const DESIGN_API='/api/show-design';
export const DESIGN_STATUS={waiting:'In de wachtrij',writing:'Draaiboek schrijven…',validating:'Spelopzet controleren…',ready:'Klaar om te bekijken',failed:'Niet voltooid',cancelled:'Gestopt'};
export const designPending=candidate=>['waiting','writing','validating'].includes(candidate?.status);
export function designFailure(payload){return typeof payload?.error==='string'?payload.error:payload?.error?.message||payload?.message||'Het ontwerp kon niet worden opgehaald. Je eerdere voorstellen blijven bewaard.';}
export async function designRequest(payload,{signal}={}){
 const timeout=AbortSignal.timeout(20000);signal=signal?AbortSignal.any([signal,timeout]):timeout;
 const response=await fetch(DESIGN_API+(typeof payload==='string'?payload:''),typeof payload==='string'?{credentials:'same-origin',cache:'no-store',signal}:{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-milo-show-design':'1'},body:JSON.stringify(payload),signal});
 let value;try{value=await response.json();}catch{throw Error('De studio gaf geen geldig antwoord. Probeer opnieuw; je invoer blijft staan.');}
 if(!response.ok)throw Object.assign(Error(designFailure(value)),{status:response.status,code:value?.error?.code});return value;
}
export function candidateSummary(candidate){const p=candidate.proposal;if(!p)return null;return {rounds:p.plan?.blocks?.filter(b=>b.type==='round').length||0,magic:p.scenes.filter(s=>s.role==='magic').length,interactions:p.scenes.filter(s=>s.role==='random-call').length,characters:[...new Set(p.scenes.flatMap(s=>s.speakerTurns.map(t=>t.speakerId)))],fixedMinutes:Math.ceil((p.duration?.fixedSeconds||0)/60)};}
export function editedDesignScene(original,changes){return {...original,...changes,id:original.id,slotId:original.slotId,role:original.role,...(original.condition?{condition:original.condition}:{})};}
