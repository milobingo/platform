import {orderById} from './bingo-order-model.js';
import {showBrand} from './show-brands.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const euro=cents=>new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR'}).format(cents/100);
export function orderMailPayload(game,order,kind,origin){
 const brand=showBrand(game),accountUrl=new URL('/spelen',origin);accountUrl.searchParams.set('spel',game.id);accountUrl.searchParams.set('bestelling',order.id);
 const ready=kind==='ready',subject=ready?`Je bingobladen voor ${order.show.title} staan klaar`:`Voltooi je bestelling voor ${order.show.title}`;
 const intro=ready?'De organisatie heeft je betaling gecontroleerd en je unieke bingobladen klaargezet.':'De organisatie heeft een betaallink klaargezet voor jouw bestelling.';
 const details=`Bestelling ${order.number} · ${order.quantity} bingoblad${order.quantity===1?'':'en'}\nShow: ${order.show.title}\nDatum: ${order.show.date}${ready?'':`\nTe betalen: ${euro(order.amountCents)}`}`;
 const text=`Hallo ${order.customerName},\n\n${intro}\n\n${details}\n\n${ready?'Download kleur of zwart-wit en koppel de bladen aan je gezinsleden in je account.':`Betaal veilig via: ${order.paymentUrl}\nNa controle door de organisatie worden de bingobladen vrijgegeven.`}${order.note?`\n\n${order.note}`:''}\n\nBekijk je bestelling: ${accountUrl.href}\n\n${brand.title}`;
 const ctaUrl=ready?accountUrl.href:order.paymentUrl,cta=ready?'Open mijn bingobladen':'Open de betaallink';
 const html=`<div style="background:#21122f;padding:32px 16px;font-family:Arial,sans-serif;color:#fff4de"><div style="max-width:560px;margin:auto;border:1px solid #a47b3c;border-radius:24px;overflow:hidden;background:#2b173c"><div style="padding:28px 30px;background:linear-gradient(120deg,#4a2362,#241331)"><p style="margin:0;color:#efcf92;letter-spacing:2px;font-size:11px">${escape(brand.title.toUpperCase())}</p><h1 style="font-size:27px;line-height:1.2;margin:15px 0 0">${ready?'Je magische boekjes staan klaar.':'Jullie plek in de show wacht.'}</h1></div><div style="padding:28px 30px"><p>Hallo ${escape(order.customerName)},</p><p style="line-height:1.7">${escape(intro)}</p><div style="padding:18px;background:#ffffff09;border:1px solid #efcf9226;border-radius:14px;line-height:1.8"><strong>${escape(order.show.title)}</strong><br>Datum: ${escape(order.show.date)}<br>${order.quantity} bingoblad${order.quantity===1?'':'en'} · ${escape(order.number)}${ready?'':`<br><strong>Te betalen: ${escape(euro(order.amountCents))}</strong>`}</div>${order.note?`<p style="line-height:1.7">${escape(order.note)}</p>`:''}<p style="margin:26px 0"><a href="${escape(ctaUrl)}" style="display:inline-block;padding:15px 22px;border-radius:12px;background:#edca81;color:#291637;font-weight:bold;text-decoration:none">${cta}</a></p><p style="font-size:13px;line-height:1.8;color:#d6c4e2">${ready?'Je kunt dezelfde unieke bladen downloaden in kleur en zwart-wit. Koppelen aan gezinsleden doe je veilig in je account.':'Na je betaling controleert de organisatie het bedrag. Alleen na goedkeuring komen de bingobladen in je account beschikbaar.'}</p><p><a href="${escape(accountUrl.href)}" style="color:#efcf92">Bekijk je bestelling in de familie-app</a></p></div></div></div>`;
 return {to:[order.email],subject,text,html};
}
function eligible(order,kind){return kind==='payment'?['payment_pending','payment_reported'].includes(order.status)&&!!order.paymentUrl:order.status==='fulfilled';}
/** A server-owned adapter chooses its approved sender and transport. A successful
 * receipt means gateway acceptance, not inbox delivery. Never expose its config.
 * ORDER_MAIL_DELIVERY = {id, idempotencyWindowMs, send({message, context,
 * idempotencyKey, signal}) -> {accepted:true,messageId} | {accepted:false,uncertain}}
 */
function deliveryAdapter(env){
 const adapter=env.ORDER_MAIL_DELIVERY;
 if(!adapter||typeof adapter.send!=='function'||typeof adapter.id!=='string'||!/^[a-zA-Z0-9._:-]{1,120}$/.test(adapter.id))return null;
 const window=adapter.idempotencyWindowMs??0;
 if(!Number.isSafeInteger(window)||window<0)return null;
 return {id:adapter.id,window,send:adapter.send.bind(adapter)};
}
/** Persist before sending: a short lease prevents concurrent sends, and the
 * frozen payload/key is reusable only within the adapter's declared guarantee.
 */
export async function dispatchOrderMail({store,gameId,orderId,kind,env,origin,now=Date.now()}){
 const field=kind==='payment'?'paymentMail':'readyMail',row=await store.game(gameId),existing=orderById(row.data,orderId);
 if(!eligible(existing,kind)||existing[field]?.status==='sent')return;
 const adapter=deliveryAdapter(env);
 if(!adapter){
  await store.mutate(gameId,{},game=>{
   const order=orderById(game,orderId),mail=order[field];
   if(kind==='payment'&&order.paymentVersion!==existing.paymentVersion)return;
   if(!eligible(order,kind)||mail?.status==='sent'||mail?.status==='sending'&&mail.leaseUntil>now)return;
   order[field]={...mail,...(mail?.status==='sending'?{uncertain:true}:{}),status:'failed',error:'De e-mailkoppeling is nog niet ingesteld. De bestelling blijft bewaard.'};
  });return;
 }
 const generated=orderMailPayload(row.data,existing,kind,origin),attemptId=crypto.randomUUID();
 const claim=await store.mutate(gameId,{},game=>{
  const order=orderById(game,orderId),mail=order[field];
  if(kind==='payment'&&order.paymentVersion!==existing.paymentVersion)return null;
  if(!eligible(order,kind)||mail?.status==='sent'||mail?.status==='sending'&&mail.leaseUntil>now)return null;
  // A crash between acceptance and its saved receipt leaves an uncertain send.
  if(mail?.status==='sending')mail.uncertain=true;
  if(mail?.uncertain){
   const window=Math.min(mail.idempotencyWindowMs??0,adapter.window);
   if(mail.adapterId!==adapter.id||!window||!mail.firstAttemptAt||now-mail.firstAttemptAt>=window){
    mail.status='failed';mail.leaseUntil=0;mail.error='De vorige verzendpoging is onzeker. Veilig automatisch opnieuw aanbieden kan niet worden bevestigd. Controleer eerst de e-mailstatus bij de organisatie.';return null;
   }
  }
  const payload=mail?.payload||generated,version=kind==='payment'?order.paymentVersion:1;
  order[field]={...mail,payload,version,adapterId:adapter.id,idempotencyWindowMs:mail?.uncertain?Math.min(mail.idempotencyWindowMs,adapter.window):adapter.window,status:'sending',attemptId,attempts:(mail?.attempts||0)+1,firstAttemptAt:mail?.firstAttemptAt||now,leaseUntil:now+30000,error:null};
  return {payload,version};
 });
 if(!claim.result)return;
 let accepted=false,providerId=null,uncertain=true;
 const error='De mailgateway heeft de verzending niet bevestigd. De bestelling blijft bewaard.',signal=AbortSignal.timeout(12000);
 let onAbort;
 try{
  const timeout=new Promise(resolve=>{onAbort=()=>resolve({accepted:false,uncertain:true});signal.addEventListener('abort',onAbort,{once:true});});
  const receipt=await Promise.race([adapter.send({message:structuredClone(claim.result.payload),context:{brandId:showBrand(row.data).id,gameId,orderId,kind},idempotencyKey:`milo-order/${orderId}/${kind}/${claim.result.version}`,signal}),timeout]);
  accepted=receipt?.accepted===true&&typeof receipt.messageId==='string'&&receipt.messageId.trim().length>0&&receipt.messageId.length<=200&&!/[\x00-\x1f\x7f]/.test(receipt.messageId);
  if(accepted){providerId=receipt.messageId;uncertain=false;}
  else uncertain=receipt?.accepted!==false||receipt.uncertain!==false;
 }catch{uncertain=true;}
 finally{signal.removeEventListener('abort',onAbort);}
 await store.mutate(gameId,{},game=>{
  const order=orderById(game,orderId),mail=order[field];if(mail?.attemptId!==attemptId)return;
  Object.assign(mail,{status:accepted?'sent':'failed',sentAt:accepted?Date.now():null,providerId,acceptedByProvider:accepted,error:accepted?null:error,uncertain,leaseUntil:0});
 });
}
