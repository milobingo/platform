import {readOrderDemo,mutateOrderDemo,makeOrderDemoBooks} from './order-demo-store.js';
const error=message=>Object.assign(new Error(message),{simulated:true});
const money=(value,max=100000000)=>{if(!Number.isInteger(value)||value<0||value>max)throw error('Vul een geldig bedrag in centen in.');return value;};
const https=value=>{let url;try{url=new URL(String(value||''));}catch{throw error('Vul een volledige HTTPS-betaallink in.');}if(url.protocol!=='https:'||url.username||url.password)throw error('Gebruik een HTTPS-betaallink zonder inloggegevens.');return url.href;};
function response(state,gameId,orderId){const show=state.shows.find(s=>s.id===gameId);return {orders:state.orders.filter(o=>!gameId||o.show.id===gameId),shows:state.shows,order:state.orders.find(o=>o.id===orderId),config:show?.config,available:!!show?.available,serverTime:Date.now(),simulated:true};}
export async function orderAdminDemoRequest(path,{method='GET',body={}}={}){
 if(method==='GET'&&path==='/orders')return response(readOrderDemo());
 const match=path.match(/^\/games\/([^/]+)\/orders(?:\/([^/]+))?(?:\/([^/]+))?$/);if(!match)throw error('Deze voorbeeldactie is niet beschikbaar.');
 const [,gameId,target,action]=match;
 if(method==='GET')return response(readOrderDemo(),gameId);
 if(method!=='POST')throw error('Deze voorbeeldactie is niet beschikbaar.');
 const state=mutateOrderDemo(state=>{
  const show=state.shows.find(s=>s.id===gameId);if(!show)throw error('Deze voorbeeldshow is niet gevonden.');
  if(target==='config'){
   if(show.status!=='draft')throw error('Open bestellingen vóór de show begint.');
   if(!Number.isInteger(body.maxQuantity)||body.maxQuantity<1||body.maxQuantity>30)throw error('Kies maximaal 1 tot 30 bladen per bestelling.');
   show.config={enabled:body.enabled===true,unitPriceCents:body.unitPriceCents===null?null:money(body.unitPriceCents,1000000),maxQuantity:body.maxQuantity,description:String(body.description||'').slice(0,300)};show.ordering={...show.config};show.available=show.config.enabled;return;
  }
  const order=state.orders.find(o=>o.id===target&&o.show.id===gameId);if(!order)throw error('Deze voorbeeldbestelling is niet gevonden.');
  if(action==='payment-link'){
   if(show.status!=='draft')throw error('De voorbeeldshow is al gestart.');
   if(!['requested','payment_pending'].includes(order.status))throw error('Een gecontroleerde of afgehandelde bestelling krijgt hier geen nieuwe betaallink.');
   order.paymentUrl=https(body.paymentUrl);order.amountCents=money(body.amountCents);order.note=String(body.note||'').slice(0,300);order.status='payment_pending';order.paymentMail={status:'simulated',sentAt:Date.now()};
  }else if(action==='approve'){
   if(order.status==='fulfilled')return;
   if(body.paymentVerified!==true||!['payment_pending','payment_reported'].includes(order.status))throw error('Controleer eerst de betaling en bevestig de controle.');
   if(show.status!=='draft')throw error('De voorbeeldshow is al gestart.');
   const number=2041+Object.values(state.booksByOrder).reduce((sum,books)=>sum+books.length,0),books=makeOrderDemoBooks(order,number);
   state.booksByOrder[order.id]=books;order.books=books.map(({cards,token,code,...book})=>book);order.bookIds=books.map(b=>b.id);order.status='fulfilled';order.approvedAt=Date.now();order.readyMail={status:'simulated',sentAt:Date.now()};
  }else if(action==='reject'){
   if(['fulfilled','cancelled','rejected'].includes(order.status))throw error('Deze bestelling is al afgehandeld.');
   if(!String(body.reason||'').trim())throw error('Geef een korte reden op.');order.status='rejected';order.rejectionReason=String(body.reason).slice(0,300);
  }else if(action==='mail'){
   const field=body.kind==='ready'?'readyMail':'paymentMail';if(field==='readyMail'&&order.status!=='fulfilled')throw error('De bladen staan nog niet klaar.');if(field==='paymentMail'&&!order.paymentUrl)throw error('Voeg eerst een betaallink toe.');order[field]={status:'simulated',sentAt:Date.now()};
  }else throw error('Deze voorbeeldactie is niet beschikbaar.');
 });
 return response(state,gameId,target);
}
