import {BingoError,integer,cleanText,generateBooks} from './bingo-model.js';
import {brandId} from './show-brands.js';
import {birthAge} from './player-identity.js';

const text=(value,max,label)=>value==null||value===''?'':cleanText(value,max,label);
const MAX_PAYMENT_VERSIONS=20;
export const ORDER_STATES=Object.freeze(['requested','payment_pending','payment_reported','fulfilled','cancelled','rejected']);
export function orderingConfig(input={}){
 input=input&&typeof input==='object'?input:{};
 return {enabled:input.enabled===true,unitPriceCents:input.unitPriceCents==null||input.unitPriceCents===''?null:integer(input.unitPriceCents,0,1000000,'Prijs per bingoblad in centen'),maxQuantity:integer(input.maxQuantity??30,1,30,'Maximum aantal bingobladen'),description:text(input.description,300,'besteluitleg')};
}
export function orderingAvailable(game,now=Date.now()){
 const starts=Date.parse(game.date);
 return orderingConfig(game.ordering).enabled&&game.status==='draft'&&Number.isFinite(starts)&&starts>now;
}
export function orderShow(game,now=Date.now()){
 const config=orderingConfig(game.ordering);
 return {id:game.id,title:game.title,date:game.date,status:game.status,brandId:brandId(game),roundCount:game.plan.blocks.filter(b=>b.type==='round').length,ordering:config,config,available:orderingAvailable(game,now)};
}
export function activeOrders(game){return (game.orders||[]).some(o=>!['cancelled','rejected'].includes(o.status));}
export function orderById(game,id){const order=(game.orders||[]).find(o=>o.id===id);if(!order)throw new BingoError('Deze bestelling bestaat niet.',404,'order_missing');return order;}
function editableOrder(order){if(['fulfilled','cancelled','rejected'].includes(order.status))throw new BingoError('Deze bestelling is al afgerond.',409,'order_closed');}
function draft(game){if(game.status!=='draft')throw new BingoError('Deze show is gestart of afgelopen. Nieuwe boekjes kunnen niet meer worden uitgegeven of gekoppeld.',409,'order_show_closed');}
function profileIdsFor(family,values,quantity){
 if(values!==undefined&&(!Array.isArray(values)||values.length!==quantity))throw new BingoError('Kies voor ieder blad een gezinslid of laat het nog vrij.');
 return Array.from({length:quantity},(_,i)=>{const id=values?.[i]||null;if(id&&!family.profiles.some(p=>p.id===id))throw new BingoError('Een gekozen speler hoort niet bij jouw gezin.',403,'order_profile');return id;});
}
export function createOrder(game,family,{accountId,email,requestId,quantity,profileIds},now=Date.now()){
 const prior=(game.orders||[]).find(o=>o.accountId===accountId&&o.createRequestId===requestId);if(prior)return prior;
 if(!orderingAvailable(game,now))throw new BingoError('Bestellen voor deze show is nog niet geopend of inmiddels gesloten.',409,'ordering_closed');
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email||''))throw new BingoError('Je account heeft nog geen bevestigd e-mailadres.',409,'order_email');
 const config=orderingConfig(game.ordering),count=integer(quantity,1,config.maxQuantity,'Aantal bingobladen');
 game.orders??=[];if(game.orders.length>=100)throw new BingoError('Deze show heeft het maximum aantal bestellingen bereikt.',409);
 const own=game.orders.filter(o=>o.accountId===accountId&&!['cancelled','rejected'].includes(o.status));
 if(own.filter(o=>o.status!=='fulfilled').length>=10||own.reduce((sum,o)=>sum+o.quantity,0)+count>150)throw new BingoError('Er staan al veel bestellingen op jouw account. Neem contact op met de organisatie.',409);
 const order={id:crypto.randomUUID(),number:`MF-${String(game.orders.length+1).padStart(4,'0')}`,createRequestId:requestId,accountId,email:email.toLowerCase(),customerName:text(family.ownerName,80,'accountnaam')||'Jouw gezin',quantity:count,profileIds:profileIdsFor(family,profileIds,count),show:{id:game.id,title:game.title,date:game.date,roundCount:game.plan.blocks.filter(b=>b.type==='round').length,brandId:brandId(game)},status:'requested',amountCents:config.unitPriceCents===null?null:config.unitPriceCents*count,unitPriceCents:config.unitPriceCents,paymentUrl:'',paymentVersion:0,note:'',createdAt:now,updatedAt:now,bookIds:[],paymentMail:{status:'not_sent'},readyMail:{status:'not_sent'}};
 game.orders.push(order);return order;
}
export function validatePaymentUrl(value){
 let url;try{url=new URL(cleanText(value,2000,'betaallink'));}catch{throw new BingoError('Vul een volledige, veilige HTTPS-betaallink in.');}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||!host.includes('.')||/^\d+(?:\.\d+){3}$/.test(host)||host.includes(':'))throw new BingoError('Gebruik een HTTPS-betaallink van een betaalprovider, zonder inloggegevens of lokaal adres.');
 return url.href;
}
export function setPaymentLink(game,order,input,now=Date.now()){
 draft(game);editableOrder(order);
 const paymentUrl=validatePaymentUrl(input.paymentUrl),amountCents=integer(input.amountCents,0,100000000,'Te betalen bedrag in centen'),note=text(input.note,300,'betaalnotitie');
 // Identical retries keep the same message version and provider idempotency key.
 if(order.paymentUrl===paymentUrl&&order.amountCents===amountCents&&order.note===note)return order;
 if(order.paymentMail?.status==='sending'&&order.paymentMail.leaseUntil>now)throw new BingoError('De betaalmail wordt nog aangeboden aan de maildienst. Wacht op de verzendstatus voordat je de betaallink wijzigt.',409,'order_mail_sending');
 const version=order.paymentVersion||0;
 if(version>=MAX_PAYMENT_VERSIONS)throw new BingoError('Deze bestelling heeft het maximum van 20 betaalmailversies bereikt. De bestaande verzendgeschiedenis blijft bewaard; neem contact op met de organisatie voordat je verder wijzigt.',409,'order_mail_version_limit');
 if(version>0){
  // Never discard old acceptance evidence or an uncertain send when an operator
  // deliberately replaces the link. This private history is not a retry queue.
  const history=order.paymentMailHistory||[],id=`${order.id}/payment/${version}`;
  if(!history.some(entry=>entry.id===id)){
   if(history.length>=MAX_PAYMENT_VERSIONS-1)throw new BingoError('De betaalmailgeschiedenis is vol. Controleer de bestelling bij de organisatie.',409,'order_mail_version_limit');
   const mail=structuredClone(order.paymentMail||{status:'not_sent'});
   if(mail.status==='sending')mail.uncertain=true;
   order.paymentMailHistory=[...history,{id,kind:'payment',version,archivedAt:now,payment:{url:order.paymentUrl,amountCents:order.amountCents,note:order.note||''},mail}];
  }
 }
 order.paymentUrl=paymentUrl;order.amountCents=amountCents;order.note=note;order.paymentVersion=(order.paymentVersion||0)+1;order.status='payment_pending';order.paymentReportedAt=null;order.updatedAt=now;
 order.paymentMail={status:'queued',version:order.paymentVersion,queuedAt:now};return order;
}
export function reportOrderPaid(game,order,now=Date.now()){
 editableOrder(order);if(!order.paymentUrl||!['payment_pending','payment_reported'].includes(order.status))throw new BingoError('Wacht eerst op de betaallink van de organisatie.',409);
 order.status='payment_reported';order.paymentReportedAt??=now;order.updatedAt=now;return order;
}
export function closeOrder(order,status,reason,now=Date.now()){
 editableOrder(order);order.status=status;order.updatedAt=now;
 if(status==='rejected')order.rejectionReason=cleanText(reason,300,'reden van afwijzing');
 return order;
}
export function fulfillOrder(game,family,order,{paymentVerified,hostId},now=Date.now()){
 if(order.status==='fulfilled')return order;
 draft(game);editableOrder(order);
 if(paymentVerified!==true)throw new BingoError('Bevestig eerst dat de betaling door de organisatie is gecontroleerd.',409,'payment_verification_required');
 if(!['payment_pending','payment_reported'].includes(order.status)||!order.paymentUrl)throw new BingoError('Koppel eerst een betaallink aan deze bestelling.',409);
 const profiles=profileIdsFor(family,order.profileIds,order.quantity);
 // A colon cannot occur in a public generation request ID. Keep the internal
 // fulfillment batch separate from manually generated, possibly linked sheets.
 const batch=generateBooks(game,order.quantity,`order:${order.id}`,now,{mode:'color'});
 order.bookIds=[...batch.bookIds];order.batchId=batch.id;
 for(let i=0;i<order.bookIds.length;i++){
  const book=game.books.find(b=>b.id===order.bookIds[i]),profile=profiles[i]?family.profiles.find(p=>p.id===profiles[i]):null;
  Object.assign(book,{accountId:order.accountId,profileId:profile?.id||null,name:profile?.name||'',age:profile?(profile.dateOfBirth?birthAge(profile.dateOfBirth):profile.age):null,admitted:!!profile,issueStatus:profile?'assigned':'paid-ready',orderId:order.id});
 }
 order.status='fulfilled';order.approvedAt=now;order.approvedBy=hostId;order.paymentVerifiedAt=now;order.updatedAt=now;order.readyMail={status:'queued',version:1,queuedAt:now};return order;
}
export function assignOrderBook(game,family,order,{bookId,profileId},now=Date.now()){
 draft(game);if(order.status!=='fulfilled')throw new BingoError('De organisatie moet deze bestelling eerst goedkeuren.',409);
 const profile=family.profiles.find(p=>p.id===profileId),book=game.books.find(b=>b.id===bookId&&order.bookIds.includes(b.id)&&b.accountId===order.accountId);
 if(!profile||!book)throw new BingoError('Kies een eigen bingoblad en een speler uit jouw gezin.',403,'order_ownership');
 if(book.revokedAt)throw new BingoError('Dit bingoblad is ingetrokken. Vraag de organisatie om hulp.',409);
 if(book.profileId&&book.profileId!==profile.id)throw new BingoError('Dit blad is al aan een andere speler gekoppeld.',409);
 Object.assign(book,{profileId:profile.id,name:profile.name,age:profile.dateOfBirth?birthAge(profile.dateOfBirth):profile.age,admitted:true,issueStatus:'assigned'});order.updatedAt=now;return order;
}
const paymentMailReconciliation=order=>{
 const versions=(order.paymentMailHistory||[]).filter(entry=>entry.mail?.uncertain===true||entry.mail?.status==='sending').map(entry=>entry.version);
 if(order.paymentMail?.uncertain===true||order.paymentMail?.status==='sending'&&!(order.paymentMail.leaseUntil>Date.now()))versions.push(order.paymentVersion);
 const unique=[...new Set(versions)].filter(Number.isSafeInteger).sort((a,b)=>a-b);
 return {required:unique.length>0,versions:unique};
};
const mailView=mail=>({status:mail?.status||'not_sent',sentAt:mail?.sentAt||null,error:mail?.error||null});
export function projectOrder(order,game,{admin=false}={}){
 return {id:order.id,number:order.number,status:order.status,createdAt:order.createdAt,updatedAt:order.updatedAt,quantity:order.quantity,show:structuredClone(order.show),amountCents:order.amountCents,unitPriceCents:order.unitPriceCents,paymentUrl:order.paymentUrl,note:order.note||'',rejectionReason:order.rejectionReason||'',paymentReportedAt:order.paymentReportedAt||null,approvedAt:order.approvedAt||null,paymentMail:mailView(order.paymentMail),readyMail:mailView(order.readyMail),profileIds:[...order.profileIds],bookIds:[...order.bookIds],books:order.bookIds.map(id=>game.books.find(b=>b.id===id&&b.accountId===order.accountId)).filter(Boolean).map(b=>({id:b.id,ticket:b.ticket,profileId:b.profileId,name:b.name,admitted:!!b.admitted,revokedAt:b.revokedAt||null})),...(admin?{accountId:order.accountId,email:order.email,customerName:order.customerName,paymentMailReconciliation:paymentMailReconciliation(order)}:{})};
}
