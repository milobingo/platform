import {isFamilyDemo,requestFamilyDemo} from './family-demo.js';
const uuid=()=>globalThis.crypto.randomUUID();
async function request(base,path,{method='GET',body,signal}={}){
 if(isFamilyDemo())return requestFamilyDemo(base,path,{method,body,signal});
 const write=method!=='GET',payload=write?{...body,...(base==='/api/bingo'?{requestId:body?.requestId||uuid()}:{})}:undefined;
 const attempts=write&&base==='/api/bingo'?3:1;
 for(let i=0;i<attempts;i++){
  let response,data;
  try{
   response=await fetch(base+path,{method,credentials:'same-origin',cache:'no-store',signal:signal||AbortSignal.timeout(12000),headers:{'X-Vlampie-Player':'1',...(write?{'Content-Type':'application/json','X-Vlampie-Bingo':'1'}:{})},...(write?{body:JSON.stringify(payload)}:{})});
   data=await response.json();
  }catch(error){
   if(signal?.aborted||error.name==='AbortError')throw error;
   if(i<attempts-1){await new Promise(r=>setTimeout(r,300*(i+1)));continue;}
   throw new Error('De verbinding is onderbroken. Je aanvraag is nog niet bevestigd. Probeer opnieuw.');
  }
  if(response.ok)return data;
  const error=Object.assign(new Error(data.error?.message||data.error||'Deze aanvraag is niet bevestigd.'),{status:response.status,code:data.error?.code});
  if(i<attempts-1&&(response.status===503||response.status===502||error.code==='conflict')){await new Promise(r=>setTimeout(r,300*(i+1)));continue;}
  throw error;
 }
}
export const playerApi=(path,opts)=>request('/api/bingo',path,opts);
export const authApi=(path,body)=>request('/api/player',path,body===undefined?{}:{method:'POST',body});
export const dateLabel=value=>{const d=new Date(value);return Number.isFinite(+d)?d.toLocaleDateString('nl-NL',{day:'numeric',month:'long',year:'numeric'}):'Datum volgt';};
export const showStatus=value=>({running:'De show is bezig',draft:'Binnenkort in de studio',finished:'Deze show is afgelopen'}[value]||'Welkom in de show');
