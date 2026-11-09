import {orderById} from './bingo-order-model.js';
import {showBrand} from './show-brands.js';
import {showTimeParts} from './show-time.js';
import {readEffectiveMailTemplate} from './mail-service.js';
import {renderMailTemplate} from './mail-templates.js';
import {mailConfig} from './mail-config.js';

const euro=cents=>new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR'}).format(cents/100);
export function orderMailContext(game,order,origin){
 const accountUrl=new URL('/spelen',origin);accountUrl.searchParams.set('spel',game.id);accountUrl.searchParams.set('bestelling',order.id);
 const when=showTimeParts(order.show.date);
 return {gezinsnaam:order.customerName||'Jullie gezin',show_naam:order.show.title,show_datum:when.date,show_tijd:when.time,bestelnummer:order.number,aantal_bladen:String(order.quantity),bedrag:euro(order.amountCents),betaallink:order.paymentUrl||'',account_link:accountUrl.href,afwijsreden:order.rejectionReason||'',betaalnotitie:order.note||'',organisatie_link:new URL('/#/orders',origin).href};
}
export function orderMailPayload(game,order,kind,origin,template,assetBaseUrl,from='organisatie@voorbeeld.invalid'){
 return renderMailTemplate(kind==='ready'?'books-ready':'payment-link',{brandId:showBrand(game).id,template,context:orderMailContext(game,order,origin),origin,assetBaseUrl,from,to:order.email});
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
 const config=(await mailConfig(env)).value,adapter=config.contactReady?deliveryAdapter(env):null;
 if(!adapter){
  await store.mutate(gameId,{},game=>{
   const order=orderById(game,orderId),mail=order[field];
   if(kind==='payment'&&order.paymentVersion!==existing.paymentVersion)return;
   if(!eligible(order,kind)||mail?.status==='sent'||['claimed','offering','sending'].includes(mail?.status)&&mail.leaseUntil>now)return;
   order[field]={...mail,...(mail?.status==='sending'?{uncertain:true}:{}),status:'failed',error:'De e-mailkoppeling is nog niet ingesteld. De bestelling blijft bewaard.'};
  });return;
 }
 let generated;try{const template=await readEffectiveMailTemplate(env,showBrand(row.data).id,kind==='ready'?'books-ready':'payment-link');if(!template.enabled)return;generated=orderMailPayload(row.data,existing,kind,origin,template,env.MAIL_ASSET_BASE_URL,config.from);}catch{await store.mutate(gameId,{},game=>{const mail=orderById(game,orderId)[field];if(mail&&!['sent','sending','offering'].includes(mail.status)){mail.status='failed';mail.error='Het mailtemplate vraagt controle; de bestelling blijft bewaard.';}});return;}const attemptId=crypto.randomUUID();
 const claim=await store.mutate(gameId,{},game=>{
  const order=orderById(game,orderId),mail=order[field];
  if(kind==='payment'&&order.paymentVersion!==existing.paymentVersion)return null;
  if(!eligible(order,kind)||mail?.status==='sent'||['claimed','offering','sending'].includes(mail?.status)&&mail.leaseUntil>now)return null;
  // A crash between acceptance and its saved receipt leaves an uncertain send.
  if(['offering','sending'].includes(mail?.status))mail.uncertain=true;
  if(mail?.uncertain){
   const window=Math.min(mail.idempotencyWindowMs??0,adapter.window);
   if(mail.adapterId!==adapter.id||!window||!mail.firstAttemptAt||now-mail.firstAttemptAt>=window){
    mail.status='failed';mail.leaseUntil=0;mail.error='De vorige verzendpoging is onzeker. Veilig automatisch opnieuw aanbieden kan niet worden bevestigd. Controleer eerst de e-mailstatus bij de organisatie.';return null;
   }
  }
  const payload=mail?.payload||generated,version=kind==='payment'?order.paymentVersion:1;
  order[field]={...mail,payload,version,adapterId:adapter.id,idempotencyWindowMs:mail?.uncertain?Math.min(mail.idempotencyWindowMs,adapter.window):adapter.window,status:'claimed',attemptId,attempts:(mail?.attempts||0)+1,firstAttemptAt:mail?.firstAttemptAt||now,leaseUntil:now+30000,error:null};
  return {payload,version};
 });
 if(!claim.result)return;
 const template=await readEffectiveMailTemplate(env,showBrand(row.data).id,kind==='ready'?'books-ready':'payment-link');
 const offered=await store.mutate(gameId,{},game=>{const current=orderById(game,orderId),mail=current[field];if(mail?.attemptId!==attemptId||mail.status!=='claimed')return false;if(!eligible(current,kind)||kind==='payment'&&current.paymentVersion!==claim.result.version||template.enabled===false){mail.status='blocked';mail.leaseUntil=0;mail.error='De bestelling of mailinstelling is gewijzigd vóór aanbieding.';return false;}mail.status='offering';return true;});
 if(!offered.result)return;
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
