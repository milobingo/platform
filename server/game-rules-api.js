import {BingoStore} from './bingo-store.js';
import {projectedGameRules} from './game-rules.js';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function handlePublicRules(request,env){
 const url=new URL(request.url),html=url.pathname==='/spelregels';
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
 if(!['GET','HEAD'].includes(request.method))return Response.json({error:{code:'method',message:'Alleen lezen is toegestaan.'}},{status:405,headers});
 const id=url.searchParams.get('game')||url.searchParams.get('spel')||'';
 let data,status=200;
 try{
  if(!/^[a-f0-9-]{36}$/.test(id))throw Object.assign(new Error('Kies eerst een show in de familieplek.'),{status:400});
  const row=await new BingoStore(env.DB).game(id);
  if(!row?.data.rulesPublication)throw Object.assign(new Error('Voor deze show zijn nog geen bindende regels gepubliceerd.'),{status:404});
  const rules=projectedGameRules(row.data);
  data={gameId:id,title:row.data.title,brandId:row.data.brandId,...rules};
 }catch(error){status=error.status||503;data={error:{code:'rules_unavailable',message:error.status?error.message:'De spelregels zijn tijdelijk niet beschikbaar.'}};}
 if(!html)return new Response(request.method==='HEAD'?null:JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}});
 const body=data.error?`<h1>Spelregels</h1><p>${escape(data.error.message)}</p>`:`<h1>${escape(data.title)}</h1><p>Bindende spelregels · versie ${data.version} · gepubliceerd ${escape(new Intl.DateTimeFormat('nl-NL',{dateStyle:'long',timeStyle:'short',timeZone:'Europe/Amsterdam'}).format(data.publishedAt))} (Europe/Amsterdam)</p>${data.current?'':'<p role="alert">De voorbereiding is gewijzigd. Nieuwe deelname wacht op gecontroleerde publicatie van de actuele regels.</p>'}${data.rules.map(r=>`<article><h2>${escape(r.title)}</h2><p>${escape(r.text)}</p></article>`).join('')}`;
 const page=`<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bindende spelregels · BingoShow</title><style>body{font:17px/1.7 system-ui;margin:0;background:#f9f5ef;color:#2c1841}main{max-width:780px;margin:auto;padding:32px 22px}h1{line-height:1.2}h2{font-size:1.2em}article{border-top:1px solid #cdbfd4;margin-top:24px}a{color:#59337c}</style><main>${body}<p><a href="/spelen${id?'?spel='+encodeURIComponent(id):''}">Naar de familieplek</a></p></main></html>`;
 return new Response(request.method==='HEAD'?null:page,{status,headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"}});
}
