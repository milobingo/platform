import {BingoStore} from './bingo-store.js';
import {projectedGameRules} from './game-rules.js';
import {automaticRules,patternRequirement} from './standard-show.js';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function patternOverview(contract){
 if(!contract?.rounds)return '';
 return '<section aria-label="Rondes, patronen en prijzen"><h2>Jullie patronen en prijzen</h2>'+contract.rounds.map(round=>'<h3>'+escape(round.title)+'</h3>'+round.goals.map(goal=>{
  const pattern=goal.pattern;if(!pattern)return '';
  const explanation=patternRequirement(pattern);
  const selected=new Set(pattern.cells);
  const cells=Array.from({length:25},(_,index)=>'<span class="'+(selected.has(index)?'required ':'')+(index===12?'free':'')+'" aria-label="'+(index===12?'Vrij middenvak':'Rij '+(Math.floor(index/5)+1)+', kolom '+(index%5+1)+(selected.has(index)?', vereist':', niet vereist'))+'">'+(index===12?'★':selected.has(index)?'●':'·')+'</span>').join('');
  return '<article class="rule-goal"><h4>'+escape(pattern.title)+' → '+escape(goal.prize?.title||'')+'</h4><p>'+explanation+' Het middenvak is altijd vrij.</p><div class="rule-card" role="group" aria-label="'+escape(pattern.title)+'">'+cells+'</div>'+(goal.prize?.description?'<p>'+escape(goal.prize.description)+'</p>':'')+'</article>';
 }).join('')).join('')+'</section>';
}
export async function handlePublicRules(request,env){
 const url=new URL(request.url),html=url.pathname==='/spelregels';
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
 if(!['GET','HEAD'].includes(request.method))return Response.json({error:{code:'method',message:'Alleen lezen is toegestaan.'}},{status:405,headers});
 const id=url.searchParams.get('game')||url.searchParams.get('spel')||'';
 let data,status=200;
 try{
  if(!/^[a-f0-9-]{36}$/.test(id))throw Object.assign(new Error('Kies eerst een show in de familieplek.'),{status:400});
  const row=await new BingoStore(env.DB).game(id);
  if(!row?.data||!row.data.rulesPublication&&!automaticRules(row.data))throw Object.assign(new Error('Voor deze show zijn nog geen bindende regels gepubliceerd.'),{status:404});
  const rules=projectedGameRules(row.data);
  data={gameId:id,title:row.data.title,brandId:row.data.brandId,...rules};
 }catch(error){status=error.status||503;data={error:{code:'rules_unavailable',message:error.status?error.message:'De spelregels zijn tijdelijk niet beschikbaar.'}};}
 if(!html)return new Response(request.method==='HEAD'?null:JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}});
 const body=data.error?`<h1>Spelregels</h1><p>${escape(data.error.message)}</p>`:`<h1>${escape(data.title)}</h1><p>${data.published?`Bindende spelregels · versie ${data.version} · gepubliceerd ${escape(new Intl.DateTimeFormat('nl-NL',{dateStyle:'long',timeStyle:'short',timeZone:'Europe/Amsterdam'}).format(data.publishedAt))} (Europe/Amsterdam)`:'Spelregels vooraf · de server legt deze afspraken automatisch vast vóór deelname en bij de start.'}</p>${data.current||data.provisional?'':'<p role="alert">De voorbereiding is gewijzigd. Nieuwe deelname wacht op gecontroleerde publicatie van de actuele regels.</p>'}${data.rules.map(r=>`<article><h2>${escape(r.title)}</h2><p>${escape(r.text)}</p></article>`).join('')}${patternOverview(data.contract)}`;
 const page=`<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bindende spelregels · BingoShow</title><style>body{font:17px/1.7 system-ui;margin:0;background:#f9f5ef;color:#2c1841}main{max-width:780px;margin:auto;padding:32px 22px}h1{line-height:1.2}h2{font-size:1.2em}article{border-top:1px solid #cdbfd4;margin-top:24px}a{color:#59337c}.rule-card{display:grid;grid-template-columns:repeat(5,32px);gap:4px;margin:16px 0}.rule-card span{display:grid;place-items:center;min-height:32px;border:1px solid #cdbfd4;border-radius:4px}.rule-card .required{background:#59337c;color:white}.rule-card .free{background:#f8df88;color:#2c1841}.rule-goal h4{font-size:1.1em;margin-bottom:0}</style><main>${body}<p><a href="/spelen${id?'?spel='+encodeURIComponent(id):''}">Naar de familieplek</a></p></main></html>`;
 return new Response(request.method==='HEAD'?null:page,{status,headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"}});
}
