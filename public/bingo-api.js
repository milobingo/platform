export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function bingoApi(path,{method='GET',body}={}){
 const write=method!=='GET',data=write?{...body,requestId:body?.requestId||crypto.randomUUID()}:null;
 for(let attempt=0;attempt<3;attempt++){
  let response,result;
  try{response=await fetch('/api/bingo'+path,{method,credentials:'same-origin',cache:'no-store',headers:{...(write?{'Content-Type':'application/json','X-Vlampie-Bingo':'1'}:{}),...(globalThis.document?.body?.classList.contains('player-body')?{'X-Vlampie-Player':'1'}:{})},...(write?{body:JSON.stringify(data)}:{})});result=await response.json();}
  catch(error){if(write&&attempt<2){await new Promise(resolve=>setTimeout(resolve,200+attempt*300));continue;}throw new Error('De verbinding is onderbroken. Probeer opnieuw.');}
  if(response.ok)return result;
  if(write&&attempt<2&&(result.error?.code==='conflict'||response.status===503)){await new Promise(resolve=>setTimeout(resolve,150+crypto.getRandomValues(new Uint32Array(1))[0]%350));continue;}
  const error=new Error(result.error?.message||'Deze aanvraag is niet bevestigd. Probeer opnieuw.');error.code=result.error?.code;error.status=response.status;throw error;
 }
 throw new Error('De aanvraag kon nog niet bevestigd worden. Probeer opnieuw.');
}
export function patternHtml(pattern){const cells=new Set(pattern?.cells||[]);return `<span class="pattern-mini">${Array.from({length:25},(_,i)=>`<i class="${cells.has(i)?'marked':''} ${i===12?'free':''}"></i>`).join('')}</span>`;}
