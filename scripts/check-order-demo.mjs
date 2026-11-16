import test from 'node:test';
import assert from 'node:assert/strict';
import {readOrderDemo,mutateOrderDemo,resetOrderDemo,ORDER_DEMO_SHOW,ORDER_DEMO_ACCOUNT,ORDER_DEMO_KEY} from '../frontend/order-demo-store.js';
import {orderAdminDemoRequest as admin} from '../frontend/order-admin-demo.js';
import {fulfillmentLabel,isPickupOrder,orderDownloadReady,paymentStatusLabel} from '../frontend/order-fulfillment.js';
import {matchFamilyOrderDemo as family} from '../frontend/family-order-demo.js';

const values=new Map();
globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
globalThis.location={href:'https://family-demo.invalid/spelen?demo=1'};
globalThis.fetch=()=>{throw Error('De bestelsimulatie mag geen netwerkverzoek doen.');};
const post=body=>({method:'POST',body});
const context=()=>({authenticated:true,accountId:ORDER_DEMO_ACCOUNT,family:{ownerName:'Voorbeeldgezin',email:'voorbeeld@voorbeeld.invalid',profiles:[{id:'custom-sophie',name:'Sophie',age:7},{id:'custom-timo',name:'Timo',age:9}]},games:new Map(),messages:new Map()});
function fixture(){resetOrderDemo();mutateOrderDemo(state=>{state.shows[0].date=new Date(Date.now()+7*86400000).toISOString();});return context();}
const route='/games/'+ORDER_DEMO_SHOW+'/orders';
const url=path=>'https://family-demo.invalid/api/bingo'+path;

test('family request → payment report → explicit organizer approval → assigned books is one shared simulation',async()=>{
 const ctx=fixture(),created=family(url(route),post({quantity:2,fulfillmentChoice:'both',profileIds:['custom-sophie',null],requestId:'integration-request'}),ctx),id=created.order.id,orderPath=route+'/'+id;
 assert.equal(created.order.status,'requested');assert.equal(created.order.fulfillmentChoice,'both');assert.equal(created.order.amountCents,700);assert.equal(created.order.books.length,0);assert.equal(isPickupOrder(created.order),true);
 assert.equal((await admin('/orders')).orders.find(o=>o.id===id).customerName,'Voorbeeldgezin');
 assert(!('email'in created.order));assert(!('accountId'in created.order));
 await assert.rejects(admin(orderPath+'/approve',post({paymentVerified:true})),/Controleer/);
 await assert.rejects(admin(orderPath+'/payment-link',post({paymentUrl:'http://bunq.me/o/VoorbeeldCode123',amountCents:700})),/HTTPS/);
 const payment=await admin(orderPath+'/payment-link',post({paymentUrl:'🙏 Betaal € 7,00 via https://bunq.me/o/VoorbeeldCode123',amountCents:700,note:'Fictief voorbeeld',sendMail:true}));
 assert.equal(payment.order.status,'payment_pending');assert.equal(payment.order.paymentUrl,'https://bunq.me/o/VoorbeeldCode123');assert.equal(orderDownloadReady(payment.order),false);assert.equal(payment.order.paymentMail.status,'simulated');
 const reported=family(url(orderPath+'/paid'),post({}),ctx);
 assert.equal(reported.order.status,'payment_reported');assert.equal(reported.order.bookIds.length,0);
 await assert.rejects(admin(orderPath+'/approve',post({paymentVerified:false})),/bevestig/);
 await assert.rejects(admin(orderPath+'/approve',post({paymentVerified:'true'})),/bevestig/);
 const approved=await admin(orderPath+'/approve',post({paymentVerified:true})),books=readOrderDemo().booksByOrder[id];
 assert.equal(approved.order.status,'fulfilled');assert.equal(orderDownloadReady(approved.order),true);assert.equal(paymentStatusLabel(approved.order),'Betaald');assert.equal(books.length,2);assert.equal(approved.order.readyMail.status,'simulated');
 assert.equal(books[0].name,'Sophie');assert.equal(books[0].profileId,'custom-sophie');assert.equal(books[1].profileId,null);
 assert.equal(new Set(books.map(b=>b.id)).size,2);assert.equal(new Set(books.map(b=>b.ticket)).size,2);
 assert.equal(new Set(books.flatMap(b=>b.cards.map(card=>card.join(',')))).size,8);
 assert(books.every(b=>b.simulated&&b.code.startsWith('DEMO')&&b.token.startsWith('ongeldig-voorbeeld-')&&b.cards.every(card=>card.length===25&&card[12]===0)));
 const snapshot=JSON.stringify(books);await admin(orderPath+'/approve',post({paymentVerified:true}));assert.equal(JSON.stringify(readOrderDemo().booksByOrder[id]),snapshot);
 const assigned=family(url(orderPath+'/assign'),post({bookId:books[1].id,profileId:'custom-timo'}),ctx);
 assert.equal(assigned.order.books[1].name,'Timo');assert.equal((await admin('/orders')).orders.find(o=>o.id===id).books[1].name,'Timo');
 assert.equal(ctx.games.get(ORDER_DEMO_SHOW).books.filter(b=>b.orderId===id).length,2);
 assert(values.has(ORDER_DEMO_KEY));assert.equal(JSON.parse(values.get(ORDER_DEMO_KEY)).orders.find(o=>o.id===id).status,'fulfilled');
});

test('closed ordering, family ownership, rejection, copy isolation and mail retry stay separate',async()=>{
 const ctx=fixture();
 const all=await admin('/orders'),own=family(url('/orders'),{},ctx);
 assert(all.orders.some(o=>o.accountId!==ORDER_DEMO_ACCOUNT));assert(own.orders.every(o=>o.id!=='demo-order-ander-gezin'));
 assert.throws(()=>family(url(route+'/demo-order-ander-gezin/paid'),post({}),ctx),/niet gevonden/);
 const failed=all.orders.find(o=>o.paymentMail.status==='failed'),retry=await admin(route+'/'+failed.id+'/mail',post({kind:'payment'}));
 assert.equal(retry.order.paymentMail.status,'simulated');assert.equal(retry.order.status,'payment_pending');assert.equal(retry.order.books.length,0);
 const rejected=await admin(route+'/demo-order-nieuw/reject',post({reason:'Fictief geannuleerd door organisatie'}));
 assert.equal(rejected.order.status,'rejected');assert.equal(rejected.order.books.length,0);
 await assert.rejects(admin(route+'/demo-order-nieuw/approve',post({paymentVerified:true})),/Controleer/);
 await admin(route+'/config',post({enabled:false,unitPriceCents:null,maxQuantity:3,description:'Gesloten oefenverkoop'}));
 assert.throws(()=>family(url(route),post({quantity:1,profileIds:[null],requestId:'closed'}),ctx),/gesloten/);
 const copy=readOrderDemo();copy.shows[0].config.enabled=true;assert.equal(readOrderDemo().shows[0].config.enabled,false);
 mutateOrderDemo(state=>{state.shows[0].status='running';});
 await assert.rejects(admin(route+'/demo-order-controleren/approve',post({paymentVerified:true})),/gestart/);
 await assert.rejects(admin(route+'/config',post({enabled:true,unitPriceCents:350,maxQuantity:30})),/vóór/);
});


test('all three delivery choices preserve quantity; saving a link does not send or assign books',async()=>{
 const ctx=fixture();
 for(const [index,fulfillmentChoice] of ['print','pickup','both'].entries()){
  const quantity=index+1,created=family(url(route),post({quantity,fulfillmentChoice,profileIds:Array(quantity).fill(null),requestId:'delivery-'+fulfillmentChoice}),ctx),orderPath=route+'/'+created.order.id;
  assert.equal(created.order.quantity,quantity);assert.equal(created.order.amountCents,quantity*350);assert.equal(created.order.fulfillmentChoice,fulfillmentChoice);assert.equal(isPickupOrder(created.order),fulfillmentChoice!=='print');
  const saved=await admin(orderPath+'/payment-link',post({paymentUrl:'https://bunq.me/o/VoorbeeldCode'+index+'?note=CaseSensitive',amountCents:quantity*350,sendMail:false}));
  assert.equal(saved.order.paymentMail.status,'queued');assert.equal(saved.order.bookIds.length,0);assert.equal(saved.order.books.length,0);assert.equal(readOrderDemo().booksByOrder[created.order.id],undefined);
  const invalid='https://bunq.me.evil.test/o/Lookalike';await assert.rejects(admin(orderPath+'/payment-link',post({paymentUrl:invalid,amountCents:quantity*350,sendMail:true})));
  assert.equal((await admin('/orders')).orders.find(order=>order.id===created.order.id).paymentUrl,saved.order.paymentUrl);
 }
 assert.throws(()=>family(url(route),post({quantity:1,profileIds:[null],requestId:'missing-choice'}),ctx),/Kies Zelf printen/);
 const legacy=(await admin('/orders')).orders.find(order=>order.id==='demo-order-ander-gezin');assert.equal(fulfillmentLabel(legacy.fulfillmentChoice),'Onbekend');
});
