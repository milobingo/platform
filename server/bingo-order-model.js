import {BingoError,integer,cleanText,generateBooks,assertBookAccountLimit} from './bingo-model.js';
import {brandId} from './show-brands.js';
import {birthAge} from './player-identity.js';
import {normalizeShowTime} from './show-time.js';
import {recordOrderMailEvent} from './order-events.js';
import {prepareAutomaticRules} from './game-rules.js';
import {normalizeBunqPaymentLink} from '../public/bunq-payment.js';

const text=(value,max,label)=>value==null||value===''?'':cleanText(value,max,label);
const MAX_PAYMENT_VERSIONS=20;
export const ORDER_STATES=Object.freeze(['requested','payment_pending','payment_reported','fulfilled','cancelled','rejected']);
export const FULFILLMENT_CHOICES=Object.freeze(['print','pickup','both']);
export function fulfillmentChoice(value){if(!FULFILLMENT_CHOICES.includes(value))throw new BingoError('Kies Zelf printen, Ophalen of Zelf printen én ophalen.',400,'order_fulfillment_choice');return value;}
// Historical fulfilled orders predate the explicit payment object. Their
// recorded approval remains evidence; reads never rewrite their paid books.
export function orderPaymentVerified(order){return order.payment?.state==='verified'||!order.payment&&order.status==='fulfilled'&&!!(order.paymentVerifiedAt||order.approvedAt);}
export function orderDownloadReady(game,order){
 if(!orderPaymentVerified(order)||order.status!=='fulfilled'||!Array.isArray(order.bookIds)||order.bookIds.length!==order.quantity||new Set(order.bookIds).size!==order.quantity)return false;
 try{for(const id of order.bookIds)assertOrderBookIntegrity(game,game.books.find(book=>book.id===id),{accountId:order.accountId,download:true});return true;}catch{return false;}
}
export function orderingConfig(input={}){
 input=input&&typeof input==='object'?input:{};
 return {enabled:input.enabled===true,unitPriceCents:input.unitPriceCents==null||input.unitPriceCents===''?null:integer(input.unitPriceCents,0,1000000,'Prijs per bingoblad in centen'),maxQuantity:integer(input.maxQuantity??30,1,30,'Maximum aantal bingobladen'),description:text(input.description,300,'besteluitleg'),deadline:input.deadline?normalizeShowTime(input.deadline,{timeZone:input.timeZone}).date:null};
}
export function orderingAvailable(game,now=Date.now()){
 const config=orderingConfig(game.ordering),starts=Date.parse(game.date),deadline=Date.parse(config.deadline||game.date);
 // Offsetless historical timestamps need a reviewed migration; the server
 // must never reinterpret a booked show in its process timezone.
 return config.enabled&&game.status==='draft'&&/(?:Z|[+-]\d\d:\d\d)$/.test(game.date||'')&&Number.isFinite(starts)&&Number.isFinite(deadline)&&now<Math.min(starts,deadline);
}
export function orderShow(game,now=Date.now()){
 const config=orderingConfig(game.ordering);
 return {id:game.id,revision:game.revision,title:game.title,date:game.date,timeZone:game.timeZone||null,status:game.status,cancelledAt:game.cancelledAt||null,brandId:brandId(game),roundCount:game.plan.blocks.filter(b=>b.type==='round').length,ordering:config,config,available:orderingAvailable(game,now)};
}
export function activeOrders(game){return (game.orders||[]).some(o=>!['cancelled','rejected'].includes(o.status));}
export function assertOrderBookIntegrity(game,book,{accountId=null,download=false}={}){
 if(!book||book.revokedAt)throw new BingoError('Dit bingoblad is ingetrokken of ontbreekt. Vraag de organisatie om hulp.',409,'order_book_invalid');
 if(accountId&&book.accountId!==accountId)throw new BingoError('Dit bingoblad hoort niet bij jouw gezin.',403,'order_ownership');
 if(!book.orderId){
  if((game.orders||[]).some(order=>order.bookIds?.includes(book.id)||order.batchId&&order.batchId===book.batchId)||game.batches.some(batch=>batch.id===book.batchId&&batch.requestId?.startsWith('order:')))throw new BingoError('Dit bestelblad mist de gecontroleerde koppeling met de bestelling.',409,'order_book_relation');
  return book;
 }
 const order=(game.orders||[]).find(o=>o.id===book.orderId);
 if(!order||order.show?.id!==game.id||order.show?.brandId!==brandId(game)||order.status!=='fulfilled'||!orderPaymentVerified(order)||order.bookIds?.length!==order.quantity||new Set(order.bookIds).size!==order.quantity||order.accountId!==book.accountId||!order.bookIds?.includes(book.id))throw new BingoError('De bestelling en dit blad moeten door de organisatie worden gecontroleerd.',409,'order_book_relation');
 if(!['assigned','paid-ready'].includes(book.issueStatus))throw new BingoError('De uitgiftestatus van dit bestelblad moet worden gecontroleerd.',409,'order_book_issue_state');
 if(download&&order.bookIds.some(id=>{const other=game.books.find(candidate=>candidate.id===id);return !other||other.revokedAt||other.accountId!==order.accountId||other.orderId!==order.id||!['assigned','paid-ready'].includes(other.issueStatus)||other.profileId&&!other.admitted;}))throw new BingoError('De volledige set bladen van deze bestelling is nog niet beschikbaar. Vraag de organisatie om hulp.',409,'order_issuance_incomplete');
 if(download&&book.profileId&&!book.admitted)throw new BingoError('Dit gekoppelde blad is niet toegelaten. Vraag de organisatie om hulp.',409,'order_book_not_admitted');
 return book;
}
export function assertOrderBookAssignment(game,book,accountId){
 if(!book.orderId)return;
 assertOrderBookIntegrity(game,book);
 if(book.accountId!==accountId)throw new BingoError('Een uitgegeven bestelblad kan niet naar een ander gezin worden overgedragen. Gebruik een gecontroleerde ordercorrectie.',409,'order_transfer_forbidden');
}
export function assertOrderStartReady(game){
 const unresolved=(game.orders||[]).filter(o=>o.status==='payment_reported'||o.payment?.state==='verified'&&o.status!=='fulfilled'&&o.refund?.state!=='verified'||['required','processing'].includes(o.reconciliation?.state)||['required','processing','failed'].includes(o.refund?.state));
 if(unresolved.length)throw new BingoError(`${unresolved.length} bestelling(en) vragen nog betaalcontrole, uitgifte of terugbetaling. Los deze vóór de start op.`,409,'orders_unresolved');
 for(const order of game.orders||[])if(order.status==='fulfilled'){
  if(order.bookIds.length!==order.quantity)throw new BingoError('Een betaalde bestelling heeft nog geen complete boekjesset.',409,'order_issuance_incomplete');
  for(const id of order.bookIds)assertOrderBookIntegrity(game,game.books.find(b=>b.id===id));
 }
 return true;
}
export function orderById(game,id){const order=(game.orders||[]).find(o=>o.id===id);if(!order)throw new BingoError('Deze bestelling bestaat niet.',404,'order_missing');return order;}
function editableOrder(order){if(['fulfilled','cancelled','rejected'].includes(order.status))throw new BingoError('Deze bestelling is al afgerond.',409,'order_closed');}
function draft(game){if(game.status!=='draft')throw new BingoError('Deze show is gestart of afgelopen. Nieuwe boekjes kunnen niet meer worden uitgegeven of gekoppeld.',409,'order_show_closed');}
function profileIdsFor(family,values,quantity){
 if(values!==undefined&&(!Array.isArray(values)||values.length!==quantity))throw new BingoError('Kies voor ieder blad een gezinslid of laat het nog vrij.');
 return Array.from({length:quantity},(_,i)=>{const id=values?.[i]||null;if(id&&!family.profiles.some(p=>p.id===id))throw new BingoError('Een gekozen speler hoort niet bij jouw gezin.',403,'order_profile');return id;});
}
export function createOrder(game,family,{accountId,email,requestId,quantity,profileIds,fulfillmentChoice:choice},now=Date.now()){
 const prior=(game.orders||[]).find(o=>o.accountId===accountId&&o.createRequestId===requestId);if(prior)return prior;
 prepareAutomaticRules(game,now);
 if(!orderingAvailable(game,now))throw new BingoError('Bestellen voor deze show is nog niet geopend of inmiddels gesloten.',409,'ordering_closed');
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email||''))throw new BingoError('Je account heeft nog geen bevestigd e-mailadres.',409,'order_email');
 const config=orderingConfig(game.ordering),count=integer(quantity,1,config.maxQuantity,'Aantal bingobladen'),delivery=fulfillmentChoice(choice);
 game.orders??=[];if(game.orders.length>=100)throw new BingoError('Deze show heeft het maximum aantal bestellingen bereikt.',409);
 const own=game.orders.filter(o=>o.accountId===accountId&&!['cancelled','rejected'].includes(o.status));
 if(own.filter(o=>o.status!=='fulfilled').length>=10||own.reduce((sum,o)=>sum+o.quantity,0)+count>150)throw new BingoError('Er staan al veel bestellingen op jouw account. Neem contact op met de organisatie.',409);
 const order={id:crypto.randomUUID(),number:`MF-${String(game.orders.length+1).padStart(4,'0')}`,createRequestId:requestId,accountId,email:email.toLowerCase(),customerName:text(family.ownerName,80,'accountnaam')||'Jouw gezin',quantity:count,fulfillmentChoice:delivery,profileIds:profileIdsFor(family,profileIds,count),show:{id:game.id,title:game.title,date:game.date,roundCount:game.plan.blocks.filter(b=>b.type==='round').length,brandId:brandId(game)},status:'requested',amountCents:config.unitPriceCents===null?null:config.unitPriceCents*count,unitPriceCents:config.unitPriceCents,paymentUrl:'',paymentVersion:0,note:'',createdAt:now,updatedAt:now,bookIds:[],paymentMail:{status:'not_sent'},readyMail:{status:'not_sent'}};
 recordOrderMailEvent(order,'order-received',now);recordOrderMailEvent(order,'org-order-new',now);game.orders.push(order);return order;
}
export function validatePaymentUrl(value){
 try{return normalizeBunqPaymentLink(value);}catch(error){throw new BingoError(error.message,400,error.code||'payment_link_invalid');}
}
export function setPaymentLink(game,order,input,now=Date.now()){
 draft(game);editableOrder(order);
 if(orderPaymentVerified(order))throw new BingoError('De betaling is al bevestigd. De betaalgegevens staan vast.',409,'payment_already_verified');
 const paymentUrl=validatePaymentUrl(input.paymentUrl),fixed=order.unitPriceCents!=null?integer(order.unitPriceCents,0,1000000,'Prijs per bingoblad in centen')*integer(order.quantity,1,30,'Aantal bingobladen'):null,amount=input.amountCents??fixed??order.amountCents;
 if(amount==null||amount==='')throw new BingoError('Leg eerst het verschuldigde bedrag voor deze bestelling vast.',400,'order_amount_required');
 const amountCents=integer(amount,0,100000000,'Te betalen bedrag in centen'),note=text(input.note,300,'betaalnotitie');
 if(fixed!==null&&amountCents!==fixed)throw new BingoError('Het bedrag staat vast op basis van het bestelde aantal en de prijs bij bestelling.',409,'order_amount_mismatch');
 // Identical retries keep the same message version and provider idempotency key.
 if(order.paymentUrl===paymentUrl&&order.amountCents===amountCents&&order.note===note)return order;
 if(['claimed','offering','sending'].includes(order.paymentMail?.status)&&order.paymentMail.leaseUntil>now)throw new BingoError('De betaalmail wordt nog aangeboden aan de maildienst. Wacht op de verzendstatus voordat je de betaallink wijzigt.',409,'order_mail_sending');
 const version=order.paymentVersion||0;
 if(version>=MAX_PAYMENT_VERSIONS)throw new BingoError('Deze bestelling heeft het maximum van 20 betaalmailversies bereikt. De bestaande verzendgeschiedenis blijft bewaard; neem contact op met de organisatie voordat je verder wijzigt.',409,'order_mail_version_limit');
 if(version>0){
  // Never discard old acceptance evidence or an uncertain send when an operator
  // deliberately replaces the link. This private history is not a retry queue.
  const history=order.paymentMailHistory||[],id=`${order.id}/payment/${version}`;
  if(!history.some(entry=>entry.id===id)){
   if(history.length>=MAX_PAYMENT_VERSIONS-1)throw new BingoError('De betaalmailgeschiedenis is vol. Controleer de bestelling bij de organisatie.',409,'order_mail_version_limit');
   const mail=structuredClone(order.paymentMail||{status:'not_sent'});
   if(['offering','sending'].includes(mail.status))mail.uncertain=true;
   order.paymentMailHistory=[...history,{id,kind:'payment',version,archivedAt:now,payment:{url:order.paymentUrl,amountCents:order.amountCents,note:order.note||''},mail}];
  }
 }
 order.paymentUrl=paymentUrl;order.amountCents=amountCents;order.note=note;order.paymentVersion=(order.paymentVersion||0)+1;order.status='payment_pending';order.paymentReportedAt=null;order.updatedAt=now;
 order.paymentMail={status:'queued',version:order.paymentVersion,queuedAt:now};return order;
}
export function reportOrderPaid(game,order,now=Date.now()){
 if(orderPaymentVerified(order))return order;
 if(['cancelled','rejected'].includes(order.status)&&order.paymentUrl){order.paymentReportedAt??=now;order.latePaymentReportedAt=now;order.reconciliation={state:'required',reason:'late_payment_reported_after_closure',openedAt:now};order.updatedAt=now;recordOrderMailEvent(order,'payment-reported',now,order.paymentVersion||1);return order;}
 editableOrder(order);if(!order.paymentUrl||!['payment_pending','payment_reported'].includes(order.status))throw new BingoError('Wacht eerst op de betaallink van de organisatie.',409);
 order.status='payment_reported';order.paymentReportedAt??=now;order.updatedAt=now;recordOrderMailEvent(order,'payment-reported',now,order.paymentVersion||1);return order;
}
function financialEvidence(order,value){
 if(!value||typeof value!=='object'||value.currency!=='EUR'||value.amountCents!==order.amountCents||value.orderNumber!==order.number)throw new BingoError('Controleer het volledige bedrag, EUR en het exacte bestelnummer van het betalingsbewijs.',409,'payment_evidence_mismatch');
 return {reference:cleanText(value.reference,120,'unieke transactiereferentie'),amountCents:value.amountCents,currency:'EUR',orderNumber:order.number};
}
export async function paymentReceiptHash(game,evidence){
 if(!evidence||typeof evidence.reference!=='string'||!evidence.reference.trim())throw new BingoError('Leg eerst het volledige, gecontroleerde betalingsbewijs vast.',409,'payment_evidence_required');
 const reference=cleanText(evidence?.reference,120,'unieke transactiereferentie').normalize('NFKC').toLowerCase();
 const material=JSON.stringify(['milo-manual-payment-v1',game.ownerId,reference,'EUR']);
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(material))),v=>v.toString(16).padStart(2,'0')).join('');
}
export function reconcileOrderPayment(game,order,{operation,evidence,hostId,reason,receiptHash},now=Date.now()){
 if((order.financialHistory?.length||0)>=100)throw new BingoError('De betaalhistorie vraagt beheercontrole.',409);
 const entry={id:crypto.randomUUID(),operation,actor:hostId,at:now};
 if(operation==='confirm-payment'){
  const checked=financialEvidence(order,evidence);
  if(!/^[a-f0-9]{64}$/.test(receiptHash||''))throw new BingoError('De transactie-identiteit kon niet veilig worden vastgesteld.',409,'payment_receipt_required');
  if((game.orders||[]).some(other=>other.id!==order.id&&other.payment?.reference===checked.reference))throw new BingoError('Deze transactie is al aan een andere bestelling gekoppeld.',409,'payment_reference_used');
  if(order.payment?.state==='verified'){
   if(order.payment.receiptHash===receiptHash)return order;
   throw new BingoError('De betaling is al bevestigd. Een ander betaalbewijs vereist een gecontroleerde correctie.',409,'payment_already_verified');
  }
  order.payment={...checked,receiptHash,state:'verified',verifiedAt:now,verifiedBy:hostId};order.paymentVerifiedAt=now;
  if(['cancelled','rejected'].includes(order.status)||game.status!=='draft'){order.refund={state:'required',amountCents:checked.amountCents,currency:'EUR',requiredAt:now};order.reconciliation={state:'required',reason:'verified_payment_without_admission',openedAt:now};}
  else order.issuance={...order.issuance,state:'pending',requestedAt:now};
 }else if(operation==='resolve-unpaid'){
  if(order.payment?.state==='verified'||order.paymentVerifiedAt)throw new BingoError('Een bevestigde betaling vraagt uitgifte of aantoonbare terugbetaling.',409,'refund_required');
  entry.reason=cleanText(reason,300,'gecontroleerde toelichting');order.reconciliation={state:'resolved',reason:'manually_verified_unpaid',resolvedAt:now,resolvedBy:hostId};
 }else if(operation==='refund-start'){
  if(order.payment?.state!=='verified')throw new BingoError('Verifieer eerst de ontvangen betaling voordat je een terugbetaling registreert.',409);
  order.refund={...order.refund,state:'processing',amountCents:order.payment.amountCents,currency:'EUR',startedAt:now};order.reconciliation={state:'processing',reason:'refund_in_progress',openedAt:now};
 }else if(operation==='refund-failed'){
  if(!['processing','failed'].includes(order.refund?.state))throw new BingoError('Er is geen lopende terugbetaling.',409);
  order.refund={...order.refund,state:'failed',error:cleanText(reason,300,'reden van mislukken')};order.reconciliation={state:'required',reason:'refund_failed',openedAt:now};
 }else if(operation==='refund-confirm'){
  if(order.refund?.state==='verified')return order;
  if(!['required','processing','failed'].includes(order.refund?.state))throw new BingoError('Registreer eerst de vereiste terugbetaling.',409);
  order.refund={...financialEvidence(order,evidence),state:'verified',verifiedAt:now,verifiedBy:hostId};order.reconciliation={state:'resolved',reason:'refund_verified',resolvedAt:now};recordOrderMailEvent(order,'refund-confirmed',now);
 }else throw new BingoError('Kies een gecontroleerde betaal- of terugbetalingsstap.');
 order.financialHistory??=[];order.financialHistory.push(entry);order.updatedAt=now;return order;
}
export function changeOrderedShow(game,{operation,date,timeZone,revision,reason,followUp},now=Date.now()){
 if(game.status!=='draft')throw new BingoError('Wijzig of annuleer een geboekte show vóór de spelstart.',409,'order_show_locked');
 if(revision!==game.revision)throw new BingoError('De show of bestellingen zijn gewijzigd. Bekijk de wijziging opnieuw.',409,'conflict');
 if(!['reschedule','cancel-show'].includes(operation))throw new BingoError('Kies verplaatsen of annuleren.');
 const explanation=cleanText(reason,600,'bevestigde uitleg'),previous=game.date,next=operation==='reschedule'?normalizeShowTime(date,{timeZone}).date:null;
 if(operation==='reschedule'&&next===previous)return game;
 const step=operation==='cancel-show'?cleanText(followUp,600,'actuele vervolgstap voor geboekte gezinnen'):'';
 game.scheduleRevision=(game.scheduleRevision||0)+1;game.scheduleHistory??=[];game.scheduleHistory.push({revision:game.scheduleRevision,operation,previousDate:previous,nextDate:next,reason:explanation,at:now});
 if(operation==='reschedule'){game.date=next;game.timeZone='Europe/Amsterdam';}
 else{game.status='finished';game.cancelledAt=now;game.cancelledReason=explanation;game.state.paused=true;}
 for(const order of game.orders||[]){
  if(['cancelled','rejected'].includes(order.status)&&!order.paymentVerifiedAt&&!order.paymentReportedAt)continue;
  order.showHistory??=[];order.showHistory.push(structuredClone(order.show));
  if(next)order.show.date=next;else order.show.cancelled=true;
  const eventId=recordOrderMailEvent(order,next?'show-rescheduled':'show-cancelled',now,game.scheduleRevision),event=order.serviceEvents.find(e=>e.eventId===eventId);
  event.previousDate=previous;event.reason=explanation;event.followUp=step;
  if(!next&&(order.paymentVerifiedAt||order.paymentReportedAt||order.paymentUrl)){
   order.reconciliation={state:'required',reason:'show_cancelled_financial_review',openedAt:now};
   if(order.paymentVerifiedAt)order.refund={state:'required',amountCents:order.amountCents,currency:'EUR',requiredAt:now};
  }
  order.updatedAt=now;
 }
 if(!next)for(const book of game.books){book.revokedAt??=now;book.admitted=false;book.revokedReason='Show geannuleerd';}
 return game;
}
export function closeOrder(order,status,reason,now=Date.now()){
 editableOrder(order);
 if(orderPaymentVerified(order))throw new BingoError('Deze betaling is al bevestigd. Gebruik een gecontroleerde terugbetaling.',409,'refund_required');
 const reasonText=status==='rejected'?cleanText(reason,300,'reden van afwijzing'):'';
 if(order.paymentReportedAt||order.paymentUrl||order.paymentVerifiedAt)order.reconciliation={state:'required',reason:order.paymentReportedAt?'payment_reported_after_closure':'issued_link_may_still_accept_payment',openedAt:now};
 order.status=status;order.updatedAt=now;
 if(status==='rejected')order.rejectionReason=reasonText;
 recordOrderMailEvent(order,status==='cancelled'?'order-cancelled':'order-rejected',now);return order;
}
export function confirmOrderPayment(game,order,{paymentVerified,hostId,paymentEvidence,receiptHash},now=Date.now()){
 if(order.status==='fulfilled')return order;
 draft(game);editableOrder(order);
 if(orderPaymentVerified(order))return order;
 if(paymentVerified!==true)throw new BingoError('Bevestig eerst dat de betaling door de organisatie is gecontroleerd.',409,'payment_verification_required');
 if(!['payment_pending','payment_reported'].includes(order.status)||!order.paymentUrl)throw new BingoError('Koppel eerst een betaallink aan deze bestelling.',409);
 reconcileOrderPayment(game,order,{operation:'confirm-payment',evidence:paymentEvidence,hostId,receiptHash},now);
 order.issuance={state:'pending',requestedAt:now};order.updatedAt=now;return order;
}
export function fulfillOrder(game,family,order,{hostId},now=Date.now()){
 if(order.status==='fulfilled')return order;
 draft(game);editableOrder(order);
 if(!orderPaymentVerified(order))throw new BingoError('Bevestig eerst dat de betaling door de organisatie is gecontroleerd.',409,'payment_verification_required');
 if(['required','processing','failed','verified'].includes(order.refund?.state))throw new BingoError('Deze bestelling vraagt terugbetalingscontrole voordat bladen kunnen worden uitgegeven.',409,'refund_required');
 const profiles=profileIdsFor(family,order.profileIds,order.quantity);
 // A colon cannot occur in a public generation request ID. Keep the internal
 // fulfillment batch separate from manually generated, possibly linked sheets.
 // All card writes below share one CAS transaction. A previously persisted
 // partial batch can be completed without replacing any issued numbers/cards.
 const batches=game.batches.filter(batch=>batch.requestId===`order:${order.id}`);
 if(batches.length>1)throw new BingoError('Deze bestelling heeft meerdere uitgiftesets en vraagt beheercontrole.',409,'order_issuance_integrity');
 let batch=batches[0];
 const invalid=()=>{throw new BingoError('De bestaande bladen van deze bestelling vragen beheercontrole. Er zijn geen nummers vervangen.',409,'order_issuance_integrity');};
 if(batch){
  if(order.batchId&&order.batchId!==batch.id||!Array.isArray(batch.bookIds)||batch.bookIds.length>order.quantity||new Set(batch.bookIds).size!==batch.bookIds.length||(order.bookIds||[]).some(id=>!batch.bookIds.includes(id)))invalid();
  for(const id of batch.bookIds){const book=game.books.find(book=>book.id===id);if(!book||book.batchId!==batch.id||book.revokedAt||book.accountId&&book.accountId!==order.accountId||book.orderId&&book.orderId!==order.id)invalid();}
 }else if(order.batchId||order.bookIds?.length)invalid();
 if(game.books.some(book=>book.orderId===order.id&&!batch?.bookIds.includes(book.id)))invalid();
 const alreadyOwned=batch?.bookIds.filter(id=>game.books.find(book=>book.id===id)?.accountId===order.accountId).length||0;
 assertBookAccountLimit(game,order.accountId,null,{additional:order.quantity-alreadyOwned});
 if(!batch)batch=generateBooks(game,order.quantity,`order:${order.id}`,now,{mode:'color'});
 else if(batch.bookIds.length<order.quantity){
  const resumeId=`order:${order.id}:resume:${batch.bookIds.length}`;
  if(game.batches.some(other=>other.requestId===resumeId))invalid();
  const extra=generateBooks(game,order.quantity-batch.bookIds.length,resumeId,now,{mode:'color'});
  for(const id of extra.bookIds){game.books.find(book=>book.id===id).batchId=batch.id;batch.bookIds.push(id);}
  game.batches.splice(game.batches.indexOf(extra),1);
 }
 order.bookIds=[...batch.bookIds];order.batchId=batch.id;
 for(let i=0;i<order.bookIds.length;i++){
  const book=game.books.find(b=>b.id===order.bookIds[i]),profile=profiles[i]?family.profiles.find(p=>p.id===profiles[i]):null;
  Object.assign(book,{accountId:order.accountId,profileId:profile?.id||null,name:profile?.name||'',age:profile?(profile.dateOfBirth?birthAge(profile.dateOfBirth):profile.age):null,admitted:!!profile,issueStatus:profile?'assigned':'paid-ready',orderId:order.id});
 }
 order.status='fulfilled';order.approvedAt??=now;order.approvedBy??=hostId;order.updatedAt=now;order.issuance={...order.issuance,state:'ready',readyAt:now,error:null};order.readyMail={status:'queued',version:1,queuedAt:now};return order;
}
export function failOrderIssuance(order,error,now=Date.now()){
 if(order.status==='fulfilled'||!orderPaymentVerified(order))return order;
 // Unexpected storage/provider details stay private; known domain errors are
 // already written for the operator and explain how to recover safely.
 const message=error instanceof BingoError?error.message:'Het aanmaken van de bladen is mislukt. De betaling blijft bevestigd; probeer de generatie opnieuw.';
 order.issuance={...order.issuance,state:'failed',failedAt:now,error:message};order.updatedAt=now;return order;
}
export function assignOrderBook(game,family,order,{bookId,profileId},now=Date.now()){
 draft(game);if(order.status!=='fulfilled')throw new BingoError('De organisatie moet deze bestelling eerst goedkeuren.',409);
 const profile=family.profiles.find(p=>p.id===profileId),book=game.books.find(b=>b.id===bookId&&order.bookIds.includes(b.id)&&b.accountId===order.accountId);
 if(!profile||!book)throw new BingoError('Kies een eigen bingoblad en een speler uit jouw gezin.',403,'order_ownership');
 assertOrderBookIntegrity(game,book,{accountId:order.accountId});
 if(book.revokedAt)throw new BingoError('Dit bingoblad is ingetrokken. Vraag de organisatie om hulp.',409);
 // Reassigning within the same family is a profile correction, not ownership
 // transfer. It is deliberately closed once the admission snapshot is frozen.
 if(book.profileId!==profile.id){order.assignmentHistory??=[];if(order.assignmentHistory.length>=100)throw new BingoError('De koppelhistorie vraagt beheercontrole.',409);order.assignmentHistory.push({bookId:book.id,fromProfileId:book.profileId||null,toProfileId:profile.id,at:now});}
 Object.assign(book,{profileId:profile.id,name:profile.name,age:profile.dateOfBirth?birthAge(profile.dateOfBirth):profile.age,admitted:true,issueStatus:'assigned'});order.updatedAt=now;return order;
}
const paymentMailReconciliation=order=>{
 const versions=(order.paymentMailHistory||[]).filter(entry=>entry.mail?.uncertain===true||['sending','offering'].includes(entry.mail?.status)).map(entry=>entry.version);
 if(order.paymentMail?.uncertain===true||['sending','offering'].includes(order.paymentMail?.status)&&!(order.paymentMail.leaseUntil>Date.now()))versions.push(order.paymentVersion);
 const unique=[...new Set(versions)].filter(Number.isSafeInteger).sort((a,b)=>a-b);
 return {required:unique.length>0,versions:unique};
};
const mailView=mail=>({status:mail?.status||'not_sent',sentAt:mail?.sentAt||null,error:mail?.error||null,uncertain:mail?.uncertain===true,canRetry:['queued','failed'].includes(mail?.status)&&mail?.uncertain!==true});
export function projectOrder(order,game,{admin=false}={}){
 const verified=orderPaymentVerified(order),downloadReady=orderDownloadReady(game,order),issuance={state:downloadReady?'ready':order.issuance?.state==='failed'?'failed':verified?'pending':'not_started',error:order.issuance?.error||null,canRetry:verified&&game.status==='draft'&&!['fulfilled','cancelled','rejected'].includes(order.status)&&!order.refund?.state};
 const payment=order.payment?{state:order.payment.state,amountCents:order.payment.amountCents,currency:order.payment.currency,...(admin?{verifiedAt:order.payment.verifiedAt||null,verifiedBy:order.payment.verifiedBy||null}:{})}:verified?{state:'verified',amountCents:order.amountCents,currency:'EUR',...(admin?{verifiedAt:order.paymentVerifiedAt||order.approvedAt||null,verifiedBy:order.approvedBy||null}:{})}:null;
 return {id:order.id,number:order.number,status:order.status,createdAt:order.createdAt,updatedAt:order.updatedAt,quantity:order.quantity,fulfillmentChoice:FULFILLMENT_CHOICES.includes(order.fulfillmentChoice)?order.fulfillmentChoice:'unknown',show:structuredClone(order.show),amountCents:order.amountCents,unitPriceCents:order.unitPriceCents,paymentUrl:order.paymentUrl,note:order.note||'',rejectionReason:order.rejectionReason||'',paymentReportedAt:order.paymentReportedAt||null,approvedAt:order.approvedAt||null,payment,issuance,downloadReady,reconciliation:order.reconciliation?{state:order.reconciliation.state,reason:order.reconciliation.reason}:null,refund:order.refund?{state:order.refund.state,amountCents:order.refund.amountCents,currency:order.refund.currency}:null,paymentMail:mailView(order.paymentMail),readyMail:mailView(order.readyMail),profileIds:[...(order.profileIds||[])],bookIds:[...(order.bookIds||[])],books:(order.bookIds||[]).map(id=>game.books.find(b=>b.id===id&&b.accountId===order.accountId)).filter(Boolean).map(b=>({id:b.id,ticket:b.ticket,profileId:b.profileId,name:b.name,admitted:!!b.admitted,revokedAt:b.revokedAt||null})),...(admin?{accountId:order.accountId,email:order.email,customerName:order.customerName,paymentMailReconciliation:paymentMailReconciliation(order)}:{})};
}
