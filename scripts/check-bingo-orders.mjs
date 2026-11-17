import test from 'node:test';
import assert from 'node:assert/strict';
import {createSqliteDatabase} from '../server/node-storage.js';
import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import {PDFDocument} from 'pdf-lib';
import {handleBingo} from '../server/bingo.js';
import {BingoStore} from '../server/bingo-store.js';
import {dispatchOrderMail} from '../server/bingo-order-mail.js';
import {dispatchNodeRequest} from '../server/node-runtime.js';
import {setPaymentLink} from '../server/bingo-order-model.js';
import {generateBooks} from '../server/bingo-model.js';
import {publishGameRules,assertRulesCurrent} from '../server/game-rules.js';

function setup(){
 const db=createSqliteDatabase(':memory:'),files=new Map(),mail=[];
 const fetcher=async payload=>{mail.push(structuredClone({...payload,signal:undefined}));return {accepted:true,messageId:'stub-'+mail.length};};
 const env={VLAMPIE_ADMIN_EMAIL:'host@example.test',DB:db,ORDER_MAIL_DELIVERY:{id:'test-dg-mail',idempotencyWindowMs:86400000,send:fetcher},SETTINGS:{get:async key=>files.has(key)?{body:files.get(key)}:null,put:async(key,value)=>files.set(key,value)}};
 const req=(route,{method='GET',body,user='host',email=user==='host'?'host@example.test':user+'@example.test',headers={}}={})=>new Request('https://studio.example/api/bingo'+route,{method,headers:{Origin:'https://studio.example','x-vlampie-bingo':'1','Content-Type':'application/json','oai-authenticated-user-id':user,'oai-authenticated-user-email':email,...headers},...(body===undefined?{}:{body:JSON.stringify({regieId:'regie-main',requestId:crypto.randomUUID(),...body})})});
 const raw=(route,options={},provider=fetcher)=>{const request=req(route,options);return handleBingo(request,verifiedTestEnvironment(request,{...env,ORDER_MAIL_DELIVERY:env.ORDER_MAIL_DELIVERY?{...env.ORDER_MAIL_DELIVERY,send:provider}:undefined}));};
 const call=async(route,options={},status=200,provider=fetcher)=>{
  // Explicit fictitious bank evidence for existing approval scenarios. Tests
  // for missing/mismatched evidence pass paymentEvidence:null deliberately.
  if(route.endsWith('/approve')&&options.body?.paymentVerified&&!Object.hasOwn(options.body,'paymentEvidence')){const id=route.split('/')[2],orderId=route.split('/')[4],order=(await new BingoStore(db).game(id)).data.orders.find(o=>o.id===orderId);options={...options,body:{...options.body,paymentEvidence:{reference:'bank-fixture-'+order.id,amountCents:order.amountCents,currency:'EUR',orderNumber:order.number}}};}
  const response=await raw(route,options,provider),data=await response.json();assert.equal(response.status,status,data.error?.message||'Unexpected HTTP status');return data;
 };
 return {db,env,files,mail,fetcher,store:new BingoStore(db),req,raw,call};
}
const post=(body,user='host',headers={})=>({method:'POST',body,user,headers});
async function fixture(h,quantity=2){
 const date=new Date(Date.now()+7*86400000).toISOString().slice(0,16),{game}=await h.call('/games',post({title:'Milo’s testpremière',brandId:'milo',date,timeZone:'Europe/Amsterdam',roundCount:4}),201),route='/games/'+game.id;
 await h.call(route+'/orders/config',post({enabled:true,unitPriceCents:250,maxQuantity:30,description:'Een magische middag.'}));
 await h.store.mutate(game.id,{},g=>publishGameRules(g));
 const profile=(await h.call('/profiles',post({name:'Sophie',age:7},'family'),201)).result;
 const second=(await h.call('/profiles',post({name:'Timo',age:9},'family'),201)).result;
 const {order}=await h.call(route+'/orders',post({quantity,fulfillmentChoice:'print',profileIds:Array.from({length:quantity},(_,i)=>i===0?profile.id:null)},'family'),201);
 return {game,route,order,profile,second};
}
const link=(h,f,extra={})=>h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({sendMail:true,paymentUrl:'https://bunq.me/o/milo?order=123&token=secret',amountCents:f.order.amountCents,note:'Dank je <gezin>!',...extra}));

test('new random order references preserve legacy numbers and remain stable on a repeated creation',async()=>{
 const h=setup(),f=await fixture(h,1);try{
  await h.store.mutate(f.game.id,{},game=>{game.orders[0].number='MF-0001';});
  const legacy=structuredClone((await h.store.game(f.game.id)).data.orders[0]);
  const body={quantity:1,fulfillmentChoice:'pickup',requestId:'random-reference-create',number:'MF-FORGED',reference:'MF-FORGED'};
  const created=await h.call(f.route+'/orders',post(body,'family'),201);
  assert.match(created.order.number,/^MF-[A-Z0-9]{6}$/);assert.notEqual(created.order.number,'MF-FORGED');
  const repeated=await h.call(f.route+'/orders',post(body,'family'));
  assert.equal(repeated.order.id,created.order.id);assert.equal(repeated.order.number,created.order.number);
  const stored=(await h.store.game(f.game.id)).data;
  assert.equal(stored.orders.length,2);assert.deepEqual(stored.orders[0],legacy);
  const listed=await h.call('/orders');assert.equal(listed.orders.find(order=>order.id===legacy.id).number,'MF-0001');
 }finally{h.db.close();}
});

test('concurrent orders in different shows retry a forced random reference collision',async t=>{
 const h=setup(),a=await fixture(h,1),b=await fixture(h,1);try{
  const original=crypto.getRandomValues.bind(crypto);let draws=0;
  t.mock.method(crypto,'getRandomValues',value=>value instanceof Uint8Array?value.fill(draws++<2?0:1):original(value));
  const result=await Promise.all([h.call(a.route+'/orders',post({quantity:1,fulfillmentChoice:'print'},'family'),201),h.call(b.route+'/orders',post({quantity:1,fulfillmentChoice:'both'},'family'),201)]);
  assert(draws>=3,'a duplicated candidate must be retried');assert.notEqual(result[0].order.number,result[1].order.number);
  for(const value of result)assert.match(value.order.number,/^MF-[A-Z0-9]{6}$/);
  const all=(await h.store.games()).flatMap(row=>row.data.orders);
  assert.equal(all.length,4);assert.equal(new Set(all.map(order=>order.number)).size,4);
 }finally{h.db.close();}
});

test('exhausted random reference collisions leave the existing order and all books unchanged',async t=>{
 const h=setup(),f=await fixture(h,1);try{
  // Zero entropy always yields the same valid candidate, making collisions
  // deterministic without weakening randomness in application code.
  const original=crypto.getRandomValues.bind(crypto);
  t.mock.method(crypto,'getRandomValues',value=>value instanceof Uint8Array?value.fill(0):original(value));
  await h.call(f.route+'/orders',post({quantity:1,fulfillmentChoice:'print'},'family'),201);
  const before=(await h.store.game(f.game.id)).data;
  await h.call(f.route+'/orders',post({quantity:1,fulfillmentChoice:'print'},'family'),409);
  assert.deepEqual((await h.store.game(f.game.id)).data,before);assert.equal(before.books.length,0);
 }finally{h.db.close();}
});

test('one explicit manual payment confirmation derives all facts from the order and records the host once',async()=>{
 const h=setup(),f=await fixture(h,2);try{
  await link(h,f);const base=`${f.route}/orders/${f.order.id}/approve`;
  for(const confirm of [undefined,false,'true',1])await h.call(base,post({confirm}),409);
  await h.call(base,post({confirm:true},'family'),403);
  await h.call(base,post({confirm:true},'other-host',{'oai-authenticated-user-email':'host@example.test'}),403);
  assert.equal((await h.store.game(f.game.id)).data.books.length,0);
  const responses=await Promise.all([h.call(base,post({confirm:true,amountCents:1,currency:'USD',orderNumber:'MF-FORGED',reference:'invented-client-reference'})),h.call(base,post({confirm:true}))]);
  assert.deepEqual(responses[0].order.bookIds,responses[1].order.bookIds);
  const saved=(await h.store.game(f.game.id)).data,order=saved.orders[0];
  assert.equal(order.payment.state,'verified');assert.equal(order.payment.method,'manual_host');
  assert.equal(order.payment.amountCents,500);assert.equal(order.payment.currency,'EUR');assert.equal(order.payment.orderNumber,f.order.number);
  assert.equal(order.payment.verifiedBy,'host');assert.equal(typeof order.payment.verifiedAt,'number');
  assert.equal(order.payment.reference,undefined);assert.equal(order.payment.receiptHash,undefined);
  assert.equal(order.financialHistory.length,1);assert.equal(saved.books.length,2);assert.equal(saved.batches.length,1);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM bingo_payment_receipts').first()).n,0,'manual confirmation must not invent bank evidence');
  const payment=structuredClone(order.payment),books=structuredClone(saved.books);
  await h.call(base,post({confirm:true}));const repeated=(await h.store.game(f.game.id)).data;
  assert.deepEqual(repeated.orders[0].payment,payment);assert.deepEqual(repeated.books,books);assert.equal(repeated.orders[0].financialHistory.length,1);
 }finally{h.db.close();}
});

test('manual payment stays confirmed after issuance failure and recovers without another confirmation',async t=>{
 const h=setup(),f=await fixture(h,2);try{
  await link(h,f);const batch=h.db.batch.bind(h.db);let fail=true;
  t.mock.method(h.db,'batch',statements=>{if(fail&&statements.some(statement=>statement.sql.includes('INSERT INTO bingo_codes'))){fail=false;throw Error('fictitious issuance storage failure');}return batch(statements);});
  const base=`${f.route}/orders/${f.order.id}/approve`,failed=await h.call(base,post({confirm:true}));
  assert.equal(failed.order.payment.state,'verified');assert.equal(failed.order.issuance.state,'failed');
  const before=(await h.store.game(f.game.id)).data,payment=structuredClone(before.orders[0].payment);
  assert.equal(before.books.length,0);assert.equal(before.orders[0].financialHistory.length,1);
  const recovered=await h.call(base,post({}));assert.equal(recovered.order.downloadReady,true);
  const after=(await h.store.game(f.game.id)).data;
  assert.deepEqual(after.orders[0].payment,payment);assert.equal(after.orders[0].financialHistory.length,1);assert.equal(after.books.length,2);assert.equal(after.batches.length,1);
 }finally{h.db.close();}
});

test('optional queue-injected order unit checks the real execution clock after the deadline and leaves the game unchanged',async t=>{
 const h=setup(),f=await fixture(h,1);try{
  const deadline=Date.now()+250;await h.store.mutate(f.game.id,{},g=>{g.ordering.deadline=new Date(deadline).toISOString();});const before=(await h.store.game(f.game.id)).data;
  let queued=false;h.db.kind='postgres';h.db.withGameMutation=async(_id,operation)=>{queued=true;while(Date.now()<=deadline)await new Promise(done=>setTimeout(done,20));return operation();};
  // Test-only opt-in: ordinary order/production routes deliberately do not join
  // the native family-claim FIFO. Exercise their fresh-clock callback contract.
  const mutate=BingoStore.prototype.mutate;t.mock.method(BingoStore.prototype,'mutate',function(id,options={},operation){return mutate.call(this,id,{...options,serializeLocal:true},operation);});
  const response=await h.raw(f.route+'/orders',post({quantity:1,fulfillmentChoice:'print'},'family'));assert(queued);assert.equal(response.status,409);assert.equal((await response.json()).error.code,'ordering_closed');assert.deepEqual((await h.store.game(f.game.id)).data,before);assert.equal(h.mail.length,0);
 }finally{h.db.close();}
});

test('optional queue-injected production unit uses the execution clock after a real cooldown and records that fresh time',async t=>{
 const h=setup(),f=await fixture(h,1);try{
  await link(h,f,{amountCents:250});await h.call(`${f.route}/orders/${f.order.id}/approve`,post({paymentVerified:true}));
  const releaseAt=Date.now()+250;await h.store.mutate(f.game.id,{},g=>{g.participationLimits={family:{at:releaseAt-2000,count:1}};});
  h.db.kind='postgres';h.db.withGameMutation=async(_id,operation)=>{while(Date.now()<=releaseAt)await new Promise(done=>setTimeout(done,20));return operation();};
  const mutate=BingoStore.prototype.mutate;t.mock.method(BingoStore.prototype,'mutate',function(id,options={},operation){return mutate.call(this,id,{...options,serializeLocal:true},operation);});
  await h.call(f.route+'/participation',post({profileId:f.profile.id,kind:'greeting',enabled:true,consent:true},'family'));const saved=(await h.store.game(f.game.id)).data;
  assert(saved.participation[0].greetingConsentAt>releaseAt);assert(saved.participation[0].updatedAt>releaseAt);assert.equal(saved.participationLimits.family.at,saved.participation[0].updatedAt);
 }finally{h.db.close();}
});

test('order mail rejects lease or uncertain-guarantee expiry between claim and offering before any adapter contact',async t=>{
 for(const expiry of ['lease','guarantee'])await t.test(expiry,async()=>{
  const h=setup(),f=await fixture(h,1);try{
   h.env.ORDER_MAIL_DELIVERY.idempotencyWindowMs=1000;
   await h.store.mutate(f.game.id,{},g=>{setPaymentLink(g,g.orders[0],{paymentUrl:'https://bunq.me/o/pre-offer',amountCents:250});if(expiry==='guarantee')Object.assign(g.orders[0].paymentMail,{status:'failed',uncertain:true,adapterId:'test-dg-mail',idempotencyWindowMs:1000,firstAttemptAt:Date.now()});});
   const get=h.env.SETTINGS.get;let templateReads=0;h.env.SETTINGS.get=async key=>{if(key==='private/studio-mail-milo.v1'&&++templateReads===2)await h.store.mutate(f.game.id,{},g=>{const mail=g.orders[0].paymentMail;if(expiry==='lease')mail.leaseUntil=Date.now()-1;else mail.firstAttemptAt=Date.now()-1001;});return get(key);};
   await dispatchOrderMail({store:h.store,gameId:f.game.id,orderId:f.order.id,kind:'payment',env:h.env,origin:'https://studio.example'});
   const order=(await h.store.game(f.game.id)).data.orders[0];assert.equal(templateReads,2);assert.equal(h.mail.length,0);assert.equal(order.paymentVersion,1);assert.equal(order.paymentMail.status,'failed');assert.equal(order.paymentMail.leaseUntil,0);assert.equal(order.paymentMail.attempts,1);if(expiry==='lease')assert.match(order.paymentMail.error,/verlopen vóór aanbieding/);else{assert.equal(order.paymentMail.uncertain,true);assert.match(order.paymentMail.error,/Veilig automatisch/);}
  }finally{h.db.close();}
 });
});

test('ORD-01 published participation rules lock order quantity while sales settings remain editable',async()=>{
 const h=setup();try{
  const {game}=await h.call('/games',post({title:'Gepubliceerde bestellimiet',brandId:'milo',date:'2026-12-18T13:30',timeZone:'Europe/Amsterdam',roundCount:1}),201),route='/games/'+game.id;
  await h.call(route+'/orders/config',post({enabled:true,maxQuantity:5,unitPriceCents:250}));await h.store.mutate(game.id,{},g=>publishGameRules(g));
  const before=(await h.store.game(game.id)).data,denied=await h.raw(route+'/orders/config',post({enabled:false,maxQuantity:6,unitPriceCents:300}));
  assert.equal(denied.status,409,'the published maximum cannot silently invalidate participation rules');assert.equal((await denied.json()).error.code,'rules_locked');assert.deepEqual((await h.store.game(game.id)).data,before,'rejected changes leave both ordering and publication unchanged');
  const deadline='2026-12-17T13:30:00Z',updated=await h.call(route+'/orders/config',post({enabled:false,maxQuantity:5,unitPriceCents:300,description:'Aangepaste besteltekst',deadline}));
  assert.equal(updated.config.enabled,false);assert.equal(updated.config.unitPriceCents,300);assert.equal(updated.config.description,'Aangepaste besteltekst');assert.equal(updated.config.deadline,'2026-12-17T13:30:00.000Z');
  const after=(await h.store.game(game.id)).data;assertRulesCurrent(after);assert.deepEqual(after.rulesPublication,before.rulesPublication);
  await h.call(route+'/orders/config',post({...updated.config,enabled:true}));assertRulesCurrent((await h.store.game(game.id)).data);
 }finally{h.db.close();}
});

test('ORD-02 issued order books cannot be transferred by generic book administration or downloaded after revocation',async()=>{
 const h=setup(),f=await fixture(h,1);try{
  await link(h,f);const approved=await h.call(`${f.route}/orders/${f.order.id}/approve`,post({paymentVerified:true}));
  const book=approved.order.books[0],other=(await h.call('/profiles',post({name:'Ander gezin',age:10},'stranger'),201)).result;
  await h.call(f.route+'/book-state',post({operation:'issue',bookId:book.id,issueStatus:'generated'}),409);
  await h.call(f.route+'/book-state',post({operation:'assign',bookId:book.id,accountId:'stranger',profileId:other.id}),409);
  await h.call(`${f.route}/books/${book.id}/pdf`,{user:'stranger'},403);
  await h.call(f.route+'/book-state',post({operation:'revoke',bookId:book.id,reason:'Gecontroleerde intrekking'}));
  await h.call(`${f.route}/books/${book.id}/pdf`,{user:'family'},409);
  await h.call(`${f.route}/orders/${f.order.id}/pdf`,{user:'family'},409);
 }finally{h.db.close();}
});

test('ORD-03 cancelling a reported payment preserves a visible unresolved reconciliation instead of forgetting the report',async()=>{
 const h=setup(),f=await fixture(h,1);try{
  await link(h,f);await h.call(`${f.route}/orders/${f.order.id}/paid`,post({},'family'));
  const closed=await h.call(`${f.route}/orders/${f.order.id}/cancel`,post({},'family'));
  assert.equal(closed.order.status,'cancelled');assert.equal(closed.order.reconciliation?.state,'required');
  assert.equal((await h.store.game(f.game.id)).data.books.length,0);
 }finally{h.db.close();}
});

test('ORD-03 payment evidence is exact, globally unique across shows and a late closed payment creates a refund case without books',async()=>{
 const h=setup(),a=await fixture(h,1),b=await fixture(h,1);try{
  await link(h,a,{amountCents:250});await link(h,b,{amountCents:250});
  await h.call(`${a.route}/orders/${a.order.id}/approve`,post({paymentVerified:true,paymentEvidence:null}),409);
  const evidence=order=>({reference:'one-real-bank-transaction',amountCents:250,currency:'EUR',orderNumber:order.number});
  const results=await Promise.all([h.raw(`${a.route}/orders/${a.order.id}/approve`,post({paymentVerified:true,paymentEvidence:evidence(a.order)})),h.raw(`${b.route}/orders/${b.order.id}/approve`,post({paymentVerified:true,paymentEvidence:evidence(b.order)}))]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await h.db.prepare('SELECT count(*) n FROM bingo_payment_receipts').first()).n,1);
  const games=await h.store.games();assert.equal(games.reduce((sum,r)=>sum+r.data.books.length,0),1,'the losing cross-show attempt rolls back its generated books and codes');
  const loser=results[0].status===409?a:b;await h.call(`${loser.route}/orders/${loser.order.id}/cancel`,post({},'family'));
  await h.call(`${loser.route}/orders/${loser.order.id}/paid`,post({},'family'));
  const verified=await h.call(`${loser.route}/orders/${loser.order.id}/reconcile`,post({operation:'confirm-payment',evidence:{...evidence(loser.order),reference:'late-distinct-bank-transaction'}}));
  assert.equal(verified.order.status,'cancelled');assert.equal(verified.order.refund.state,'required');assert.equal(verified.order.books.length,0);
  await h.call(`${loser.route}/orders/${loser.order.id}/reconcile`,post({operation:'refund-confirm',evidence:{...evidence(loser.order),reference:'refund-tx',amountCents:1}}),409);
  const refunded=await h.call(`${loser.route}/orders/${loser.order.id}/reconcile`,post({operation:'refund-confirm',evidence:{...evidence(loser.order),reference:'refund-tx'}}));assert.equal(refunded.order.refund.state,'verified');assert.equal(refunded.order.reconciliation.state,'resolved');assert.equal(refunded.order.books.length,0);
 }finally{h.db.close();}
});

test('ORD-01 deadline equality closes ordering and controlled rescheduling preserves issued numbers while refreshing PDF identity',async()=>{
 const h=setup(),f=await fixture(h,1);try{
  await link(h,f,{amountCents:250});const approved=await h.call(`${f.route}/orders/${f.order.id}/approve`,post({paymentVerified:true})),before=(await h.store.game(f.game.id)).data,identities=structuredClone(before.books);
  const body={operation:'reschedule',date:'2026-11-25T13:30',timeZone:'Europe/Amsterdam',revision:before.revision,reason:'Gecontroleerde verplaatsing van de testshow',confirm:true};
  await h.call(f.route+'/orders/show-change',post({...body,preview:true}));assert.deepEqual((await h.store.game(f.game.id)).data,before,'preview is read-only');
  const moved=await h.call(f.route+'/orders/show-change',post(body));assert.equal(moved.game.date,'2026-11-25T12:30:00.000Z');assert.deepEqual(moved.game.books,identities);assert.deepEqual(moved.orders[0].bookIds,approved.order.bookIds);assert.equal(moved.orders[0].show.date,moved.game.date);
  await h.call(f.route+'/orders/show-change',post({...body,date:'2026-12-01T13:30'}),409);
 }finally{h.db.close();}
});

test('orders are future-show specific, owner scoped, server priced and permanently idempotent',async()=>{
 const h=setup(),f=await fixture(h);try{
  assert.equal(f.order.amountCents,500);assert.equal(f.order.show.date,f.game.date);assert.equal(f.order.show.roundCount,4);
  assert(!('email'in f.order));assert(!('accountId'in f.order));
  const mine=await h.call('/orders',{user:'family'});assert.equal(mine.orders.length,1);assert(mine.shows.some(s=>s.id===f.game.id&&s.available));
  assert.equal((await h.call('/orders',{user:'stranger'})).orders.length,0);
  await h.call(`${f.route}/orders/${f.order.id}`,{user:'stranger'},403);
  await h.call(f.route+'/orders/config',post({enabled:true},'family'),403);
  await h.call(f.route+'/orders',post({quantity:0},'family'),400);
  await h.call(f.route+'/orders',post({quantity:31},'family'),400);
  await h.call(f.route+'/orders',post({quantity:1,fulfillmentChoice:'print',profileIds:['foreign-child']},'family'),403);
  const body={requestId:'durable-order-retry',quantity:1,fulfillmentChoice:'print',amountCents:1,email:'thief@example.test'};
  const created=await h.call(f.route+'/orders',post(body,'family'),201);assert.equal(created.order.amountCents,250);
  await h.store.mutate(f.game.id,{},g=>{g.ops=[];g.ordering.enabled=false;});
  const retry=await h.call(f.route+'/orders',post({...body,quantity:20},'family'),201);assert.equal(retry.order.id,created.order.id);assert.equal(retry.order.quantity,1);
  assert.equal((await h.store.game(f.game.id)).data.orders.length,2);
  await h.call(f.route+'/orders',post({quantity:1,fulfillmentChoice:'print'},'family'),409);
  await h.call(f.route+'/orders/config',post({enabled:true,unitPriceCents:null}));
  const unpriced=await h.call(f.route+'/orders',post({quantity:1,fulfillmentChoice:'print',amountCents:99},'family'),201);assert.equal(unpriced.order.amountCents,null);
  await h.store.mutate(f.game.id,{},g=>{g.date='2020-01-01T12:00';});
  assert.equal((await h.call(f.route+'/orders',{user:'family'})).available,false);
  await h.call(f.route+'/orders',post({quantity:1,fulfillmentChoice:'print'},'family'),409);
 }finally{h.db.close();}
});

test('family mode on a platform organizer shows only own orders and never host-only details',async()=>{
 const h=setup(),f=await fixture(h);try{
  const headers={'X-Vlampie-Player':'1'},own=await h.call(f.route+'/orders',post({quantity:1,fulfillmentChoice:'print'},'host',headers),201);
  const familyView=await h.call('/orders',{headers});assert.deepEqual(familyView.orders.map(o=>o.id),[own.order.id]);assert(!('email'in familyView.orders[0]));
  await h.call(`${f.route}/orders/${f.order.id}`,{headers},403);
  await h.call(f.route+'/orders/config',post({enabled:true},'host',headers),403);
  await h.call(`${f.route}/orders/${own.order.id}/payment-link`,post({sendMail:true,paymentUrl:'https://bunq.me/o/own',amountCents:250}));
  const reported=await h.call(`${f.route}/orders/${own.order.id}/paid`,post({},'host',headers));assert.equal(reported.order.status,'payment_reported');
  const hostView=await h.call('/orders');assert.equal(hostView.orders.length,2);assert.equal(hostView.orders.find(o=>o.id===f.order.id).email,'family@example.test');
 }finally{h.db.close();}
});

test('payment mail has a trusted recipient, escaped content and real provider acceptance semantics',async()=>{
 const h=setup(),f=await fixture(h);try{
  for(const paymentUrl of ['javascript:alert(1)','http://pay.example.test/x','https://u:p@pay.example.test/x','https://localhost/x','https://127.0.0.1/x'])await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({paymentUrl,amountCents:500}),400);
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({sendMail:true,paymentUrl:'https://bunq.me/o/x',amountCents:500},'family'),403);
  const linked=await link(h,f,{email:'evil@example.test'});assert.equal(linked.order.status,'payment_pending');assert.equal(linked.order.paymentMail.status,'sent');assert.equal(h.mail.length,1);
  const payload=h.mail[0].message;assert.deepEqual(payload.to,['family@example.test']);assert(payload.html.includes('Dank je &lt;gezin&gt;!'));assert(payload.html.includes('&amp;token=secret'));assert(!payload.html.includes('re_test'));
  const saved=(await h.store.game(f.game.id)).data.orders[0];assert.equal(saved.paymentMail.acceptedByProvider,true);assert.equal(saved.paymentMail.providerId,'stub-1');
  await link(h,f);assert.equal(h.mail.length,1);assert.equal((await h.store.game(f.game.id)).data.orders[0].paymentVersion,1);
  const publicView=await h.call(`${f.route}/orders/${f.order.id}`,{user:'family'});assert(!JSON.stringify(publicView).includes('payload'));assert(!JSON.stringify(publicView).includes('providerId'));assert(!JSON.stringify(publicView).includes('re_test'));
  await h.call(`${f.route}/orders/${f.order.id}/pdf`,{user:'family'},403);
 }finally{h.db.close();}
});

test('approval is explicit and permanently one-time; stored sheets render in both colors',async()=>{
 const h=setup(),f=await fixture(h);try{
  await link(h,f);
  await h.call(`${f.route}/orders/${f.order.id}/approve`,post({}),409);
  await h.call(`${f.route}/orders/${f.order.id}/approve`,post({paymentVerified:true},'family'),403);
  const reported=await h.call(`${f.route}/orders/${f.order.id}/paid`,post({},'family'));assert.equal(reported.order.status,'payment_reported');assert.equal((await h.store.game(f.game.id)).data.books.length,0);
  const results=await Promise.all([h.call(`${f.route}/orders/${f.order.id}/approve`,post({paymentVerified:true,requestId:'approval-first-id'})),h.call(`${f.route}/orders/${f.order.id}/approve`,post({paymentVerified:true,requestId:'approval-second-id'}))]);
  assert.deepEqual(results[0].order.bookIds,results[1].order.bookIds);
  let stored=(await h.store.game(f.game.id)).data;assert.equal(stored.books.length,2);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM bingo_codes').first()).n,2);assert(stored.books.every(b=>b.accountId==='family'&&b.orderId===f.order.id));assert.equal(stored.books[0].profileId,f.profile.id);assert.equal(stored.books[1].profileId,null);assert.equal(stored.books[1].admitted,false);
  const identities=JSON.stringify(stored.books);await h.store.mutate(f.game.id,{},g=>{g.ops=[];});
  const repeat=await h.call(`${f.route}/orders/${f.order.id}/approve`,post({paymentVerified:true}));assert.deepEqual(repeat.order.bookIds,results[0].order.bookIds);assert.equal((await h.store.game(f.game.id)).data.books.length,2);
  const pdfRoute=`${f.route}/orders/${f.order.id}/pdf`,color=await h.raw(pdfRoute+'?mode=color&format=a5',{user:'family'}),mono=await h.raw(pdfRoute+'?mode=mono&format=a4',{user:'family'});
  assert.equal(color.status,200);assert.equal(mono.status,200);const colorBytes=new Uint8Array(await color.arrayBuffer()),monoBytes=new Uint8Array(await mono.arrayBuffer());assert.equal((await PDFDocument.load(colorBytes)).getPageCount(),2);assert.equal((await PDFDocument.load(monoBytes)).getPageCount(),1);
  assert.notDeepEqual(colorBytes,monoBytes);assert.deepEqual(new Uint8Array(await (await h.raw(pdfRoute+'?mode=color&format=a5',{user:'family'})).arrayBuffer()),colorBytes);
  assert.equal(JSON.stringify((await h.store.game(f.game.id)).data.books),identities);
  await h.call(pdfRoute,{user:'stranger'},403);await h.call(pdfRoute+'?mode=invalid',{user:'family'},400);
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({sendMail:true,paymentUrl:'https://bunq.me/o/changed',amountCents:999}),409);
 }finally{h.db.close();}
});

test('fulfillment choices are required and server stored; unpaid choices never create cards, codes, jobs or PDFs',async()=>{
 const h=setup(),f=await fixture(h,1);try{
  for(const fulfillmentChoice of [null,'unknown','both-times',true])await h.call(f.route+'/orders',post({quantity:1,fulfillmentChoice},'family'),400);
  await h.call(f.route+'/orders',post({quantity:1},'family'),400);
  const orders=[f.order];
  for(const [fulfillmentChoice,quantity] of [['pickup',3],['both',2]])orders.push((await h.call(f.route+'/orders',post({quantity,fulfillmentChoice,amountCents:1,show:{id:'forged-show'}},'family'),201)).order);
  assert.deepEqual(orders.map(order=>[order.fulfillmentChoice,order.quantity,order.amountCents]),[['print',1,250],['pickup',3,750],['both',2,500]]);
  for(const order of orders){await link(h,{...f,order});await h.call(`${f.route}/orders/${order.id}/pdf`,{user:'family'},403);await h.call(`${f.route}/orders/${order.id}/pdf`,{},403);}
  const stored=(await h.store.game(f.game.id)).data;
  assert.equal(stored.books.length,0);assert.equal(stored.batches.length,0);assert.equal(stored.orders.every(order=>order.bookIds.length===0&&!order.batchId&&!order.issuance),true);assert.equal((await h.db.prepare('SELECT count(*) n FROM bingo_codes').first()).n,0);assert.equal(h.files.size,0);
  assert.deepEqual((await h.call('/orders')).orders.filter(order=>['pickup','both'].includes(order.fulfillmentChoice)).map(order=>order.id).sort(),orders.slice(1).map(order=>order.id).sort());
  assert(orders.every(order=>order.show.id===f.game.id));
 }finally{h.db.close();}
});

test('saving a bunq share normalizes without sending; explicit concurrent sends use stored price and recipient',async()=>{
 const h=setup(),f=await fixture(h,2);try{
  const route=`${f.route}/orders/${f.order.id}/payment-link`,body={paymentUrl:'🙏 Betaal € 5,00 voor "test" via https://bunq.me/o/VoorbeeldCode123',amountCents:500};
  const saved=await h.call(route,post(body));assert.equal(saved.order.paymentUrl,'https://bunq.me/o/VoorbeeldCode123');assert.equal(saved.order.status,'payment_pending');assert.equal(h.mail.length,0);
  const stored=(await h.store.game(f.game.id)).data.orders[0];assert.equal(stored.paymentUrl,saved.order.paymentUrl);assert.equal(stored.paymentMail.status,'queued');
  await h.call(route,post({...body,amountCents:501,sendMail:true}),409);assert.equal(h.mail.length,0);
  await Promise.all([h.call(route,post({...body,sendMail:true,email:'attacker@example.test'})),h.call(route,post({...body,sendMail:true}))]);
  assert.equal(h.mail.length,1);assert.deepEqual(h.mail[0].message.to,['family@example.test']);assert.match(h.mail[0].message.html,/https:\/\/bunq.me\/o\/VoorbeeldCode123/);assert.match(h.mail[0].message.html,/Betaal via bunq/);
  const after=(await h.store.game(f.game.id)).data;assert.equal(after.orders[0].payment?.state,undefined);assert.equal(after.books.length,0);assert.equal(after.batches.length,0);assert.equal(h.files.size,0);
 }finally{h.db.close();}
});

test('mail retry rejects legacy unnormalized or foreign payment links before provider contact without changing the saved link',async()=>{
 const h=setup(),f=await fixture(h,1);try{
  for(const paymentUrl of ['https://bunq.me.evil.test/o/Lookalike','https://pay.example.test/legacy','Betaal via https://bunq.me/o/ValidButNotNormalized']){
   await h.store.mutate(f.game.id,{},g=>Object.assign(g.orders[0],{status:'payment_pending',paymentVersion:1,paymentUrl,paymentMail:{status:'queued',version:1}}));
   const rejected=(await h.call(`${f.route}/orders/${f.order.id}/mail`,post({kind:'payment'}))).order;
   assert.equal(rejected.paymentUrl,paymentUrl);assert.equal(rejected.paymentMail.status,'failed');assert.match(rejected.paymentMail.error,/bunq|genormaliseerde/);assert.equal(h.mail.length,0);
  }
  const stored=(await h.store.game(f.game.id)).data;assert.equal(stored.books.length,0);assert.equal(stored.batches.length,0);assert.equal(stored.orders[0].payment,undefined);assert.equal(h.files.size,0);
 }finally{h.db.close();}
});

test('ready-mail retries never contact the provider for fulfilled paid orders with revoked or incomplete sheets',async()=>{
 const h=setup(),f=await fixture(h,2);try{
  await link(h,f);const approved=await h.call(`${f.route}/orders/${f.order.id}/approve`,post({paymentVerified:true})),bookIds=[...approved.order.bookIds],sentBefore=h.mail.length;
  assert.equal(approved.order.downloadReady,true);assert.equal(approved.order.readyMail.status,'sent');assert.equal(sentBefore,2);
  for(const unavailable of ['revoked','incomplete']){
   await h.store.mutate(f.game.id,{},g=>{
    const order=g.orders[0],book=g.books.find(book=>book.id===bookIds[0]);delete book.revokedAt;
    order.bookIds=[...bookIds];order.readyMail={status:'failed',version:1,error:'Gesimuleerde eerdere mailfout'};
    if(unavailable==='revoked')book.revokedAt=Date.now();else order.bookIds.pop();
   });
   const before=(await h.store.game(f.game.id)).data;
   const retry=(await h.call(`${f.route}/orders/${f.order.id}/mail`,post({kind:'ready'}))).order;
   assert.equal(retry.status,'fulfilled');assert.equal(retry.payment.state,'verified');assert.equal(retry.downloadReady,false);assert.equal(retry.readyMail.status,'failed');assert.equal(h.mail.length,sentBefore,unavailable+' sheets prevent provider contact');
   await dispatchOrderMail({store:h.store,gameId:f.game.id,orderId:f.order.id,kind:'ready',env:h.env,origin:'https://studio.example'});
   assert.equal(h.mail.length,sentBefore);assert.deepEqual((await h.store.game(f.game.id)).data,before,'blocked retries preserve payment, cards and mail receipt');
  }
 }finally{h.db.close();}
});

test('QR registration cannot assign an unpaid historical order batch even when its code is known',async()=>{
 const h=setup(),f=await fixture(h,1);try{
  // A malformed historical batch must not become a route around payment. The
  // normal order handler never creates this unpaid stock in the first place.
  await h.store.mutate(f.game.id,{},g=>{const order=g.orders[0],batch=generateBooks(g,1,`order:${order.id}`);order.batchId=batch.id;order.bookIds=[...batch.bookIds];});
  const before=(await h.store.game(f.game.id)).data,book=before.books[0];assert.equal(book.accountId,null);assert.equal(before.orders[0].payment,undefined);
  await h.call(f.route+'/register',post({code:book.code,profileId:f.profile.id},'family'),409);
  await h.call(f.route+'/register',post({token:book.token,profileId:f.profile.id},'family'),409);
  assert.deepEqual((await h.store.game(f.game.id)).data,before);assert.equal(h.files.size,0);
 }finally{h.db.close();}
});

test('generation failing after a partial in-memory set keeps payment/audit committed and retries exactly once',async t=>{
 const h=setup(),f=await fixture(h,3);try{
  await link(h,f);const original=crypto.randomUUID.bind(crypto);let generating=0;
  const mock=t.mock.method(crypto,'randomUUID',()=>{if(new Error().stack.includes('generateBooks')&&++generating===5)throw new Error('private-mid-generation-failure');return original();});
  const failed=await h.call(`${f.route}/orders/${f.order.id}/approve`,post({paymentVerified:true}));mock.mock.restore();
  assert.equal(generating,5);assert.equal(failed.order.payment.state,'verified');assert.equal(failed.order.payment.verifiedBy,'host');assert.equal(typeof failed.order.payment.verifiedAt,'number');assert.equal(failed.order.issuance.state,'failed');assert.equal(failed.order.issuance.canRetry,true);assert.equal(failed.order.downloadReady,false);assert(!JSON.stringify(failed).includes('private-mid-generation'));
  const before=(await h.store.game(f.game.id)).data,payment=structuredClone(before.orders[0].payment);assert.equal(before.books.length,0);assert.equal(before.batches.length,0);assert.equal((await h.db.prepare('SELECT count(*) n FROM bingo_codes').first()).n,0);assert.equal((await h.db.prepare('SELECT count(*) n FROM bingo_payment_receipts').first()).n,1);
  const sentBefore=h.mail.length;await h.call(`${f.route}/orders/${f.order.id}/mail`,post({kind:'payment'}));assert.equal(h.mail.length,sentBefore);
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({sendMail:true,paymentUrl:'https://bunq.me/o/AlreadyPaid',amountCents:750}),409);assert.equal(h.mail.length,sentBefore);
  assert.equal(before.orders[0].financialHistory.length,1);await h.call(`${f.route}/orders/${f.order.id}/pdf`,{user:'family'},403);await h.call(`${f.route}/orders/${f.order.id}/approve`,post({},'family'),403);
  await h.call(`${f.route}/orders/${f.order.id}/cancel`,post({},'family'),409);
  const [retried]=await Promise.all([h.call(`${f.route}/orders/${f.order.id}/approve`,post({})),h.call(`${f.route}/orders/${f.order.id}/approve`,post({}))]);
  const ready=(await h.store.game(f.game.id)).data;assert.equal(retried.order.status,'fulfilled');assert.equal(retried.order.downloadReady,true);assert.equal(retried.order.issuance.canRetry,false);assert.equal(ready.books.length,3);assert.equal(ready.batches.length,1);assert.equal(new Set(ready.orders[0].bookIds).size,3);assert.equal((await h.db.prepare('SELECT count(*) n FROM bingo_codes').first()).n,3);assert.deepEqual(ready.orders[0].payment,payment);assert.equal(ready.orders[0].financialHistory.length,1);
  const identities=structuredClone(ready.books);await h.call(`${f.route}/orders/${f.order.id}/approve`,post({}));assert.deepEqual((await h.store.game(f.game.id)).data.books,identities);
  const family=(await h.call(`${f.route}/orders/${f.order.id}`,{user:'family'})).order;assert(!('verifiedBy'in family.payment));assert(!('verifiedAt'in family.payment));
  const invalidId=ready.orders[0].bookIds[1],validId=ready.orders[0].bookIds[0];await h.store.mutate(f.game.id,{},g=>{g.books.find(book=>book.id===invalidId).revokedAt=Date.now();});
  await h.call(`${f.route}/books/${validId}/pdf`,{user:'family'},409);await h.call(`${f.route}/batches/${ready.batches[0].id}/pdf`,{},409);
 }finally{h.db.close();}
});

test('paid partial stored batches resume with existing numbers and legacy paid downloads stay private',async()=>{
 const h=setup(),f=await fixture(h,3);try{
  await link(h,f);
  // This models an older interrupted issuer: payment and the first sheet are
  // already durable. New issuance uses a single transaction for every sheet.
  await h.store.mutate(f.game.id,{},g=>{
   const order=g.orders[0],batch=generateBooks(g,1,`order:${order.id}`),book=g.books.find(book=>book.id===batch.bookIds[0]);
   Object.assign(order,{payment:{state:'verified',reference:'partial-fixture',amountCents:750,currency:'EUR',orderNumber:order.number,verifiedBy:'original-host',verifiedAt:12345},paymentVerifiedAt:12345,batchId:batch.id,bookIds:[book.id],issuance:{state:'failed',error:'Onderbroken testuitgifte'}});
   Object.assign(book,{orderId:order.id,accountId:order.accountId,issueStatus:'paid-ready',admitted:false});
  });
  const partial=(await h.store.game(f.game.id)).data,original=structuredClone(partial.books[0]);
  await h.call(`${f.route}/books/${original.id}/pdf`,{user:'family'},409);await h.call(`${f.route}/batches/${partial.orders[0].batchId}/pdf`,{},409);assert.equal(h.files.size,0);
  const result=await h.call(`${f.route}/orders/${f.order.id}/approve`,post({})),ready=(await h.store.game(f.game.id)).data;
  assert.equal(result.order.books.length,3);assert.equal(ready.batches.length,1);assert.equal(ready.batches[0].id,partial.batches[0].id);assert.equal(ready.books[0].id,original.id);assert.equal(ready.books[0].ticket,original.ticket);assert.equal(ready.books[0].code,original.code);assert.equal(ready.books[0].token,original.token);assert.deepEqual(ready.books[0].cards,original.cards);assert.equal(ready.orders[0].payment.verifiedBy,'original-host');assert.equal(ready.orders[0].paymentVerifiedAt,12345);
  const identities=structuredClone(ready.books);await h.store.mutate(f.game.id,{},g=>{delete g.orders[0].fulfillmentChoice;delete g.orders[0].issuance;delete g.orders[0].payment;});
  const before=(await h.db.prepare('SELECT document FROM bingo_games WHERE id=?').bind(f.game.id).first()).document;
  const legacy=(await h.call(`${f.route}/orders/${f.order.id}`,{user:'family'})).order;assert.equal(legacy.fulfillmentChoice,'unknown');assert.equal(legacy.payment.state,'verified');assert.equal(legacy.downloadReady,true);assert.equal((await h.db.prepare('SELECT document FROM bingo_games WHERE id=?').bind(f.game.id).first()).document,before);
  const familyPdf=await h.raw(`${f.route}/orders/${f.order.id}/pdf`,{user:'family'});assert.equal(familyPdf.status,200);assert.equal(familyPdf.headers.get('Cache-Control'),'private, no-store');
  const bytes=new Uint8Array(await familyPdf.arrayBuffer()),hostPdf=await h.raw(`${f.route}/orders/${f.order.id}/pdf`);assert.deepEqual(new Uint8Array(await hostPdf.arrayBuffer()),bytes);assert.equal((await PDFDocument.load(bytes)).getPageCount(),3);
  for(const path of [`${f.route}/orders/${f.order.id}/pdf`,`${f.route}/books/${original.id}/pdf`,`${f.route}/batches/${ready.batches[0].id}/pdf`])await h.call(path,{user:'stranger'},403);
  await h.call(`${f.route}/orders/${f.order.id}/approve`,post({}));assert.deepEqual((await h.store.game(f.game.id)).data.books,identities);
 }finally{h.db.close();}
});

test('paid sheets can only be assigned to their owner’s children, including via existing QR registration',async()=>{
 const h=setup(),f=await fixture(h,3);try{
  await link(h,f);const approved=await h.call(`${f.route}/orders/${f.order.id}/approve`,post({paymentVerified:true})),ids=approved.order.bookIds;
  const other=(await h.call('/profiles',post({name:'Bram',age:8},'stranger'),201)).result;
  await h.call(`${f.route}/orders/${f.order.id}/assign`,post({bookId:ids[1],profileId:other.id},'family'),403);
  await h.call(`${f.route}/orders/${f.order.id}/assign`,post({bookId:ids[1],profileId:other.id},'stranger'),403);
  const assigned=await h.call(`${f.route}/orders/${f.order.id}/assign`,post({bookId:ids[1],profileId:f.second.id},'family'));assert(assigned.order.books.find(b=>b.id===ids[1]).admitted);
  await h.call(`${f.route}/orders/${f.order.id}/assign`,post({bookId:ids[1],profileId:f.profile.id},'family'));
  const stored=(await h.store.game(f.game.id)).data,free=stored.books.find(b=>b.id===ids[2]);
  await h.call(f.route+'/register',post({profileId:other.id,code:free.code},'stranger'),409);
  const registered=await h.call(f.route+'/register',post({profileId:f.second.id,code:free.code},'family'));assert(registered.game.books.find(b=>b.id===free.id).admitted);
  const pending=(await h.call(f.route+'/orders',post({quantity:1,fulfillmentChoice:'print'},'family'),201)).order;
  await link(h,{...f,order:pending});
  await h.call(f.route+'/start',post({}));
  await h.call(`${f.route}/orders/${pending.id}/approve`,post({paymentVerified:true}),409);
  await h.call(`${f.route}/orders/${f.order.id}/assign`,post({bookId:ids[0],profileId:f.profile.id},'family'),409);
  await h.call(f.route+'/orders',post({quantity:1,fulfillmentChoice:'print'},'family'),409);
 }finally{h.db.close();}
});

test('active order snapshots lock title, date, rounds and brand; cancellation preserves history',async()=>{
 const h=setup(),f=await fixture(h);try{
  for(const change of [{title:'Andere show'},{timeZone:'Europe/Amsterdam',date:new Date(Date.now()+9*86400000).toISOString().slice(0,16)},{plan:{...f.game.plan,blocks:f.game.plan.blocks.filter((b,i)=>i!==f.game.plan.blocks.findIndex(b=>b.type==='round'))}}])await h.call(f.route,{method:'PUT',body:change},400);
  await h.call(f.route+'/brand',post({brandId:'vlampie'}),409);
  await h.call(`${f.route}/orders/${f.order.id}/cancel`,post({},'family'));assert.equal((await h.call('/orders',{user:'family'})).orders[0].status,'cancelled');
  await h.call(`${f.route}/orders/${f.order.id}/approve`,post({paymentVerified:true}),409);
  const renamed=await h.call(f.route,{method:'PUT',body:{title:'Andere show'}});assert.equal(renamed.game.title,'Andere show');assert.equal((await h.call('/orders',{user:'family'})).orders[0].show.title,f.game.title);
 }finally{h.db.close();}
});

test('failed mail retries freeze body and key, and require a gateway acceptance receipt',async()=>{
 const h=setup(),f=await fixture(h);try{
  const failed=[];const provider=async payload=>{failed.push(payload);return {accepted:true};};
  const first=await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({sendMail:true,paymentUrl:'https://bunq.me/o/retry',amountCents:500}),200,provider);assert.equal(first.order.paymentMail.status,'failed');assert.equal(first.order.status,'payment_pending');
  h.env.IGNORED_BROWSER_MAIL_FROM='changed@example.test';
  await h.call(`${f.route}/orders/${f.order.id}/mail`,post({kind:'payment'}),200,provider);assert.equal(failed.length,2);assert.deepEqual(failed[0].message,failed[1].message);assert.equal(failed[0].idempotencyKey,failed[1].idempotencyKey);assert(failed[1].message.from.endsWith('<host@example.test>'));assert.deepEqual(failed[1].context,{brandId:'milo',gameId:f.game.id,orderId:f.order.id,kind:'payment'});
  const stored=(await h.store.game(f.game.id)).data.orders[0];assert(stored.paymentMail.uncertain);
  await h.store.mutate(f.game.id,{},g=>{g.orders[0].paymentMail.firstAttemptAt=Date.now()-86400001;});
  await dispatchOrderMail({store:h.store,gameId:f.game.id,orderId:f.order.id,kind:'payment',env:{...h.env,ORDER_MAIL_DELIVERY:{...h.env.ORDER_MAIL_DELIVERY,send:provider}},origin:'https://studio.example'});assert.equal(failed.length,2);assert.match((await h.store.game(f.game.id)).data.orders[0].paymentMail.error,/Veilig automatisch/);
 }finally{h.db.close();}
});

test('expired sending leases after a worker crash preserve uncertainty and stop beyond the adapter guarantee',async()=>{
 const h=setup(),f=await fixture(h);try{
  const now=Date.now();await h.store.mutate(f.game.id,{},g=>{const o=g.orders[0];o.status='payment_pending';o.paymentVersion=1;o.paymentUrl='https://bunq.me/o/crash';o.paymentMail={status:'sending',version:1,attemptId:'crashed-worker',firstAttemptAt:now-86400001,leaseUntil:now-60000,attempts:1,adapterId:'test-dg-mail',idempotencyWindowMs:86400000};});
  // A temporary loss of mail configuration must preserve the uncertainty of
  // the crashed attempt too, rather than turn it into a fresh safe attempt.
  const adapter=h.env.ORDER_MAIL_DELIVERY;delete h.env.ORDER_MAIL_DELIVERY;
  await dispatchOrderMail({store:h.store,gameId:f.game.id,orderId:f.order.id,kind:'payment',env:h.env,origin:'https://studio.example',now});
  assert.equal((await h.store.game(f.game.id)).data.orders[0].paymentMail.uncertain,true);h.env.ORDER_MAIL_DELIVERY=adapter;
  await dispatchOrderMail({store:h.store,gameId:f.game.id,orderId:f.order.id,kind:'payment',env:h.env,origin:'https://studio.example',now});
  assert.equal(h.mail.length,0);const mail=(await h.store.game(f.game.id)).data.orders[0].paymentMail;assert.equal(mail.status,'failed');assert.equal(mail.uncertain,true);assert.match(mail.error,/Veilig automatisch/);
 }finally{h.db.close();}
});

test('outbox lease prevents parallel sends and payment-link replacement while sending',async()=>{
 const h=setup(),f=await fixture(h);let release;const gate=new Promise(resolve=>release=resolve);let started;const entered=new Promise(resolve=>started=resolve);let sends=0;
 try{
  const provider=async()=>{sends++;started();await gate;return {accepted:true,messageId:'accepted-after-gate'};};
  const sending=h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({sendMail:true,paymentUrl:'https://bunq.me/o/leased',amountCents:500}),200,provider);await entered;
  await h.call(`${f.route}/orders/${f.order.id}/mail`,post({kind:'payment'}),200,provider);assert.equal(sends,1);
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({sendMail:true,paymentUrl:'https://bunq.me/o/replaced',amountCents:500}),409,provider);
  release();const result=await sending;assert.equal(result.order.paymentMail.status,'sent');assert.equal(sends,1);
 }finally{release();h.db.close();}
});


test('a manually generated batch cannot capture fulfillment or replace existing ownership',async()=>{
 const h=setup(),f=await fixture(h,1);try{
  const generated=await h.call(f.route+'/generate',post({count:1,requestId:'order-'+f.order.id}),201);
  const person=(await h.call('/profiles',post({name:'Eigenaar',age:8},'stranger'),201)).result;
  await h.call(f.route+'/register',post({profileId:person.id,code:generated.game.books[0].code},'stranger'));
  const before=structuredClone((await h.store.game(f.game.id)).data.books[0]);
  await link(h,f,{amountCents:250});const approved=await h.call(`${f.route}/orders/${f.order.id}/approve`,post({paymentVerified:true}));
  assert.equal(approved.order.bookIds.length,1);assert.notEqual(approved.order.bookIds[0],before.id);
  const stored=(await h.store.game(f.game.id)).data;assert.equal(stored.books.length,2);assert.deepEqual(stored.books.find(b=>b.id===before.id),before);
  assert.equal(stored.books.find(b=>b.id===approved.order.bookIds[0]).accountId,'family');
 }finally{h.db.close();}
});

test('missing delivery configuration preserves the requested order and ready sheets with failed mail states',async()=>{
 const h=setup(),f=await fixture(h);try{
  delete h.env.ORDER_MAIL_DELIVERY;
  const linked=await link(h,f);assert.equal(linked.order.paymentMail.status,'failed');assert.match(linked.order.paymentMail.error,/niet ingesteld/);assert.equal(h.mail.length,0);
  const ready=await h.call(`${f.route}/orders/${f.order.id}/approve`,post({paymentVerified:true}));assert.equal(ready.order.status,'fulfilled');assert.equal(ready.order.readyMail.status,'failed');assert.equal(ready.order.books.length,2);
  const pdf=await h.raw(`${f.route}/orders/${f.order.id}/pdf`,{user:'family'});assert.equal(pdf.status,200);assert.equal(pdf.headers.get('Content-Type'),'application/pdf');
 }finally{h.db.close();}
});

test('uncertain mail cannot cross delivery identities or invent an idempotency guarantee',async()=>{
 const h=setup(),f=await fixture(h);try{
  let sends=0;const uncertain=async()=>{sends++;throw new Error('private-adapter-token-must-not-leak');};
  const first=await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({sendMail:true,paymentUrl:'https://bunq.me/o/uncertain',amountCents:500}),200,uncertain);
  assert.equal(first.order.paymentMail.status,'failed');assert(!JSON.stringify(first).includes('private-adapter'));
  const original=h.env.ORDER_MAIL_DELIVERY;h.env.ORDER_MAIL_DELIVERY={...original,id:'another-mail-gateway'};
  await h.call(`${f.route}/orders/${f.order.id}/mail`,post({kind:'payment'}),200,uncertain);assert.equal(sends,1);
  h.env.ORDER_MAIL_DELIVERY={...original,idempotencyWindowMs:0};
  await h.call(`${f.route}/orders/${f.order.id}/mail`,post({kind:'payment'}),200,uncertain);assert.equal(sends,1);
  h.env.ORDER_MAIL_DELIVERY=original;
  await h.call(`${f.route}/orders/${f.order.id}/mail`,post({kind:'payment'}),200,uncertain);assert.equal(sends,2);
 }finally{h.db.close();}
});

test('an explicit gateway rejection can retry without claiming any guaranteed idempotency window',async()=>{
 const h=setup(),f=await fixture(h);try{
  h.env.ORDER_MAIL_DELIVERY.idempotencyWindowMs=0;
  let sends=0;const rejected=async()=>{sends++;return {accepted:false,uncertain:false};};
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({sendMail:true,paymentUrl:'https://bunq.me/o/rejected',amountCents:500}),200,rejected);
  await h.call(`${f.route}/orders/${f.order.id}/mail`,post({kind:'payment'}),200,rejected);assert.equal(sends,2);
  assert.equal((await h.store.game(f.game.id)).data.orders[0].paymentMail.uncertain,false);
 }finally{h.db.close();}
});


test('reading legacy settings preserves stored data and invalidated published rules refuse a silent rewrite',async()=>{
 const h=setup(),f=await fixture(h);try{
  await link(h,f);await h.call(f.route+'/generate',post({count:1}),201);
  await h.store.mutate(f.game.id,{},g=>{delete g.settings.consolationEnabled;delete g.settings.consolationPrizeTitle;g.plan.prizes[0].title='Eigen prijs voor dit gezin';});
  const before=(await h.store.game(f.game.id)).data,rawBefore=(await h.db.prepare('SELECT document FROM bingo_games WHERE id=?').bind(f.game.id).first()).document;
  await h.call(f.route);await h.call('/orders',{user:'family'});await h.call(f.route+'/orders',{user:'family'});
  assert.equal((await h.db.prepare('SELECT document FROM bingo_games WHERE id=?').bind(f.game.id).first()).document,rawBefore,'reads do not rewrite legacy snapshots');
  await h.call(f.route,{method:'PUT',body:{settings:{...before.settings,youtubeId:'abcdefghijk'}}},409);
  const after=(await h.store.game(f.game.id)).data;
  assert.deepEqual(after.books,before.books);assert.deepEqual(after.batches,before.batches);assert.deepEqual(after.orders,before.orders);assert.deepEqual(after.plan.prizes,before.plan.prizes);assert.deepEqual(after.results,before.results);
  assert.deepEqual(after.settings,before.settings);
 }finally{h.db.close();}
});

test('native session dispatch injects delivery and protects the complete order and cached PDF flow',async()=>{
 const h=setup();h.env.NODE_ENV='development';h.env.MILO_LOCAL_AUTH='true';let cookies={};
 const nativeRequest=(path,body,extra={})=>new Request('http://localhost:4173'+path,{method:body===undefined?'GET':'POST',headers:{Origin:'http://localhost:4173','Content-Type':'application/json','X-Vlampie-Bingo':'1',Cookie:Object.entries(cookies).map(([key,value])=>key+'='+value).join('; '),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const call=async(path,body,status=200,extra={})=>{
  if(path.endsWith('/approve')&&body?.paymentVerified){const parts=path.split('/'),order=(await h.store.game(parts[4])).data.orders.find(o=>o.id===parts[6]);body={...body,paymentEvidence:{reference:'native-bank-'+order.id,amountCents:order.amountCents,currency:'EUR',orderNumber:order.number}};}
  const response=await dispatchNodeRequest(nativeRequest(path,body,extra),{env:h.env}),data=await response.json();assert.equal(response.status,status,JSON.stringify(data));
  for(const cookie of response.headers.getSetCookie()){const [key,value]=cookie.split(';')[0].split('=');cookies[key]=value;}
  return data;
 };
 try{
  await call('/api/bingo/orders',undefined,401,{'oai-authenticated-user-id':'host','oai-authenticated-user-email':'host@example.test'});
  await call('/auth/local',{role:'regie'});const regie={...cookies};
  const {game}=await call('/api/bingo/games',{title:'Native order rehearsal',timeZone:'Europe/Amsterdam',date:new Date(Date.now()+7*86400000).toISOString(),brandId:'milo',roundCount:1},201),route='/api/bingo/games/'+game.id;
  await call(route+'/orders/config',{enabled:true,unitPriceCents:250});await h.store.mutate(game.id,{},g=>publishGameRules(g));
  await call('/auth/local',{role:'player'});const family={...cookies};
  const {result:profile}=await call('/api/bingo/profiles',{name:'Noor',age:8},201);
  const {order}=await call(route+'/orders',{quantity:1,fulfillmentChoice:'print',profileIds:[profile.id],email:'attacker@example.test'},201);
  await call(route+'/orders/'+order.id+'/approve',{paymentVerified:true},403);
  cookies=regie;await call(route+'/orders/'+order.id+'/payment-link',{sendMail:true,paymentUrl:'https://bunq.me/o/native',amountCents:250});
  const approved=await call(route+'/orders/'+order.id+'/approve',{paymentVerified:true});assert.equal(approved.order.status,'fulfilled');assert.equal(approved.order.readyMail.status,'sent');
  assert.equal(h.mail.length,2);assert(h.mail.every(m=>m.message.to[0]==='gezin@localhost.invalid'));
  const original=(await h.store.game(game.id)).data.books[0];cookies=family;
  const download=async()=>{const response=await dispatchNodeRequest(nativeRequest(route+'/orders/'+order.id+'/pdf?mode=color&format=a5'),{env:h.env});assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'application/pdf');return new Uint8Array(await response.arrayBuffer());};
  const pdf=await download();assert.deepEqual(await download(),pdf);assert.equal((await PDFDocument.load(pdf)).getPageCount(),1);
  assert.deepEqual((await h.store.game(game.id)).data.books[0],original);
  cookies={};await call(route+'/orders/'+order.id+'/pdf',undefined,401);
 }finally{h.db.close();}
});


test('an explicit payment-link replacement archives accepted evidence once and keeps private history out of order projections',async()=>{
 const h=setup(),f=await fixture(h);try{
  await link(h,f);const original=structuredClone((await h.store.game(f.game.id)).data.orders[0]);
  const replacement={sendMail:true,requestId:'replace-payment-accepted',paymentUrl:'https://bunq.me/o/new?private=accepted-history',amountCents:500,note:'Nieuwe betaalnotitie'};
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post(replacement));
  const stored=(await h.store.game(f.game.id)).data.orders[0],history=stored.paymentMailHistory;
  assert.equal(stored.paymentVersion,2);assert.equal(history.length,1);assert.equal(history[0].id,`${f.order.id}/payment/1`);assert.equal(history[0].version,1);assert.equal(history[0].kind,'payment');assert.equal(typeof history[0].archivedAt,'number');
  assert.deepEqual(history[0].mail,original.paymentMail);assert.deepEqual(history[0].payment,{url:original.paymentUrl,amountCents:original.amountCents,note:original.note});assert.equal(history[0].mail.providerId,'stub-1');assert.equal(history[0].mail.acceptedByProvider,true);
  assert.equal(h.mail.length,2);assert.notEqual(h.mail[0].idempotencyKey,h.mail[1].idempotencyKey);
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post(replacement));
  await h.store.mutate(f.game.id,{},g=>{g.ops=[];});
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({...replacement,requestId:'same-link-new-request'}));
  const retry=(await h.store.game(f.game.id)).data.orders[0];assert.equal(retry.paymentVersion,2);assert.deepEqual(retry.paymentMailHistory,history);assert.equal(h.mail.length,2);
  const family=await h.call(`${f.route}/orders/${f.order.id}`,{user:'family'}),admin=await h.call('/orders');
  assert(!JSON.stringify(family).includes('paymentMailHistory'));assert(!JSON.stringify(family).includes('providerId'));assert(!JSON.stringify(family).includes('adapterId'));assert(!JSON.stringify(family).includes('paymentMailReconciliation'));
  assert(!JSON.stringify(admin.orders[0]).includes('payload'));assert(!JSON.stringify(admin.orders[0]).includes('providerId'));assert(!('paymentMailHistory'in admin.orders[0]));assert.deepEqual(admin.orders[0].paymentMailReconciliation,{required:false,versions:[]});
  await h.call(`${f.route}/orders/${f.order.id}`,{user:'stranger'},403);
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({...replacement,paymentUrl:'https://bunq.me/o/theft'},'stranger'),403);
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,{...post(replacement),user:'another-host',email:'host@example.test'},403);
  assert.deepEqual((await h.store.game(f.game.id)).data.orders[0],retry);
 }finally{h.db.close();}
});

test('replacing an uncertain payment mail preserves its frozen attempt and alerts only the owning admin',async()=>{
 const h=setup(),f=await fixture(h);try{
  h.env.ORDER_MAIL_DELIVERY.idempotencyWindowMs=0;
  let oldSends=0;const unconfirmed=async()=>{oldSends++;return {accepted:false,uncertain:true};};
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({sendMail:true,paymentUrl:'https://bunq.me/o/uncertain-old',amountCents:500}),200,unconfirmed);
  const old=structuredClone((await h.store.game(f.game.id)).data.orders[0].paymentMail);assert.equal(old.uncertain,true);
  const current=await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({sendMail:true,paymentUrl:'https://bunq.me/o/explicit-replacement',amountCents:500}));
  assert.equal(current.order.paymentMail.status,'sent');assert.deepEqual(current.order.paymentMailReconciliation,{required:true,versions:[1]});
  const stored=(await h.store.game(f.game.id)).data.orders[0];assert.deepEqual(stored.paymentMailHistory[0].mail,old);assert.equal(stored.paymentMailHistory[0].version,1);assert.equal(oldSends,1);assert.equal(h.mail.length,1);
  await h.call(`${f.route}/orders/${f.order.id}/mail`,post({kind:'payment'}));assert.equal(h.mail.length,1);assert.equal(oldSends,1);
  const family=(await h.call(`${f.route}/orders/${f.order.id}`,{user:'family'})).order;assert.equal(family.paymentMail.status,'sent');assert(!('paymentMailReconciliation'in family));assert(!('paymentMailHistory'in family));
  const admin=(await h.call('/orders')).orders[0];assert.deepEqual(admin.paymentMailReconciliation,{required:true,versions:[1]});assert(!JSON.stringify(admin).includes('adapterId'));assert(!JSON.stringify(admin).includes('payload'));
 }finally{h.db.close();}
});

test('an expired sending lease is archived as uncertain while retaining its original receipt metadata',async()=>{
 const h=setup(),f=await fixture(h);try{
  const now=Date.now();await h.store.mutate(f.game.id,{},g=>{
   const order=g.orders[0];Object.assign(order,{paymentVersion:1,status:'payment_pending',paymentUrl:'https://bunq.me/o/crashed-old',paymentMail:{status:'sending',version:1,attemptId:'crashed-after-acceptance',firstAttemptAt:now-60000,leaseUntil:now-1,adapterId:'old-dg-gateway',idempotencyWindowMs:0,payload:{to:['family@example.test'],text:'Frozen private attempt'},acceptedByProvider:true,providerId:'reconciliation-receipt'}});
  });
  const current=await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({sendMail:true,paymentUrl:'https://bunq.me/o/after-expired-lease',amountCents:500}));
  const archived=(await h.store.game(f.game.id)).data.orders[0].paymentMailHistory[0];assert.equal(archived.mail.status,'sending');assert.equal(archived.mail.uncertain,true);assert.equal(archived.mail.providerId,'reconciliation-receipt');assert.equal(archived.mail.acceptedByProvider,true);assert.equal(archived.mail.attemptId,'crashed-after-acceptance');assert.equal(archived.mail.payload.text,'Frozen private attempt');
  assert.deepEqual(current.order.paymentMailReconciliation,{required:true,versions:[1]});assert.equal(h.mail.length,1);assert.equal(h.mail[0].message.text.includes('Frozen private attempt'),false);
 }finally{h.db.close();}
});

test('the payment version limit rejects before any mutation and still permits an unchanged final-version retry',async()=>{
 const h=setup(),f=await fixture(h);try{
  delete h.env.ORDER_MAIL_DELIVERY;
  for(let version=1;version<=20;version++)await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({sendMail:true,paymentUrl:'https://bunq.me/o/version'+version,amountCents:500}));
  const before=(await h.store.game(f.game.id)).data,order=before.orders[0];assert.equal(order.paymentVersion,20);assert.equal(order.paymentMailHistory.length,19);
  const direct=structuredClone(order);assert.throws(()=>setPaymentLink(before,direct,{paymentUrl:'https://bunq.me/o/version21',amountCents:500}),error=>error.code==='order_mail_version_limit');assert.deepEqual(direct,order,'pure operation leaves every field unchanged on limit');
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({sendMail:true,paymentUrl:'https://bunq.me/o/version21',amountCents:500}),409);
  assert.deepEqual((await h.store.game(f.game.id)).data,before,'failed API change commits no new game revision or partial archive');
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({sendMail:true,paymentUrl:order.paymentUrl,amountCents:order.amountCents,note:order.note}));
  const retry=(await h.store.game(f.game.id)).data.orders[0];assert.equal(retry.paymentVersion,20);assert.deepEqual(retry.paymentMailHistory,order.paymentMailHistory);assert.equal(h.mail.length,0);
 }finally{h.db.close();}
});
