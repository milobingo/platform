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

function setup(){
 const db=createSqliteDatabase(':memory:'),files=new Map(),mail=[];
 const fetcher=async payload=>{mail.push(structuredClone({...payload,signal:undefined}));return {accepted:true,messageId:'stub-'+mail.length};};
 const env={VLAMPIE_ADMIN_EMAIL:'host@example.test',DB:db,ORDER_MAIL_DELIVERY:{id:'test-dg-mail',idempotencyWindowMs:86400000,send:fetcher},SETTINGS:{get:async key=>files.has(key)?{body:files.get(key)}:null,put:async(key,value)=>files.set(key,value)}};
 const req=(route,{method='GET',body,user='host',email=user==='host'?'host@example.test':user+'@example.test',headers={}}={})=>new Request('https://studio.example/api/bingo'+route,{method,headers:{Origin:'https://studio.example','x-vlampie-bingo':'1','Content-Type':'application/json','oai-authenticated-user-id':user,'oai-authenticated-user-email':email,...headers},...(body===undefined?{}:{body:JSON.stringify({regieId:'regie-main',requestId:crypto.randomUUID(),...body})})});
 const raw=(route,options={},provider=fetcher)=>{const request=req(route,options);return handleBingo(request,verifiedTestEnvironment(request,{...env,ORDER_MAIL_DELIVERY:env.ORDER_MAIL_DELIVERY?{...env.ORDER_MAIL_DELIVERY,send:provider}:undefined}));};
 const call=async(route,options={},status=200,provider=fetcher)=>{const response=await raw(route,options,provider),data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;};
 return {db,env,files,mail,fetcher,store:new BingoStore(db),req,raw,call};
}
const post=(body,user='host',headers={})=>({method:'POST',body,user,headers});
async function fixture(h,quantity=2){
 const date=new Date(Date.now()+7*86400000).toISOString().slice(0,16),{game}=await h.call('/games',post({title:'Milo’s testpremière',brandId:'milo',date,roundCount:4}),201),route='/games/'+game.id;
 await h.call(route+'/orders/config',post({enabled:true,unitPriceCents:250,maxQuantity:30,description:'Een magische middag.'}));
 const profile=(await h.call('/profiles',post({name:'Sophie',age:7},'family'),201)).result;
 const second=(await h.call('/profiles',post({name:'Timo',age:9},'family'),201)).result;
 const {order}=await h.call(route+'/orders',post({quantity,profileIds:Array.from({length:quantity},(_,i)=>i===0?profile.id:null)},'family'),201);
 return {game,route,order,profile,second};
}
const link=(h,f,extra={})=>h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({paymentUrl:'https://pay.example.test/milo?order=123&token=secret',amountCents:500,note:'Dank je <gezin>!',...extra}));

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
  await h.call(f.route+'/orders',post({quantity:1,profileIds:['foreign-child']},'family'),403);
  const body={requestId:'durable-order-retry',quantity:1,amountCents:1,email:'thief@example.test'};
  const created=await h.call(f.route+'/orders',post(body,'family'),201);assert.equal(created.order.amountCents,250);
  await h.store.mutate(f.game.id,{},g=>{g.ops=[];g.ordering.enabled=false;});
  const retry=await h.call(f.route+'/orders',post({...body,quantity:20},'family'),201);assert.equal(retry.order.id,created.order.id);assert.equal(retry.order.quantity,1);
  assert.equal((await h.store.game(f.game.id)).data.orders.length,2);
  await h.call(f.route+'/orders',post({quantity:1},'family'),409);
  await h.call(f.route+'/orders/config',post({enabled:true,unitPriceCents:null}));
  const unpriced=await h.call(f.route+'/orders',post({quantity:1,amountCents:99},'family'),201);assert.equal(unpriced.order.amountCents,null);
  await h.store.mutate(f.game.id,{},g=>{g.date='2020-01-01T12:00';});
  assert.equal((await h.call(f.route+'/orders',{user:'family'})).available,false);
  await h.call(f.route+'/orders',post({quantity:1},'family'),409);
 }finally{h.db.close();}
});

test('family mode on a platform organizer shows only own orders and never host-only details',async()=>{
 const h=setup(),f=await fixture(h);try{
  const headers={'X-Vlampie-Player':'1'},own=await h.call(f.route+'/orders',post({quantity:1},'host',headers),201);
  const familyView=await h.call('/orders',{headers});assert.deepEqual(familyView.orders.map(o=>o.id),[own.order.id]);assert(!('email'in familyView.orders[0]));
  await h.call(`${f.route}/orders/${f.order.id}`,{headers},403);
  await h.call(f.route+'/orders/config',post({enabled:true},'host',headers),403);
  await h.call(`${f.route}/orders/${own.order.id}/payment-link`,post({paymentUrl:'https://pay.example.test/own',amountCents:250}));
  const reported=await h.call(`${f.route}/orders/${own.order.id}/paid`,post({},'host',headers));assert.equal(reported.order.status,'payment_reported');
  const hostView=await h.call('/orders');assert.equal(hostView.orders.length,2);assert.equal(hostView.orders.find(o=>o.id===f.order.id).email,'family@example.test');
 }finally{h.db.close();}
});

test('payment mail has a trusted recipient, escaped content and real provider acceptance semantics',async()=>{
 const h=setup(),f=await fixture(h);try{
  for(const paymentUrl of ['javascript:alert(1)','http://pay.example.test/x','https://u:p@pay.example.test/x','https://localhost/x','https://127.0.0.1/x'])await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({paymentUrl,amountCents:500}),400);
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({paymentUrl:'https://pay.example.test/x',amountCents:500},'family'),403);
  const linked=await link(h,f,{email:'evil@example.test'});assert.equal(linked.order.status,'payment_pending');assert.equal(linked.order.paymentMail.status,'sent');assert.equal(h.mail.length,1);
  const payload=h.mail[0].message;assert.deepEqual(payload.to,['family@example.test']);assert(payload.html.includes('Dank je &lt;gezin&gt;!'));assert(payload.html.includes('&amp;token=secret'));assert(!payload.html.includes('re_test'));
  const saved=(await h.store.game(f.game.id)).data.orders[0];assert.equal(saved.paymentMail.acceptedByProvider,true);assert.equal(saved.paymentMail.providerId,'stub-1');
  await link(h,f);assert.equal(h.mail.length,1);assert.equal((await h.store.game(f.game.id)).data.orders[0].paymentVersion,1);
  const publicView=await h.call(`${f.route}/orders/${f.order.id}`,{user:'family'});assert(!JSON.stringify(publicView).includes('payload'));assert(!JSON.stringify(publicView).includes('providerId'));assert(!JSON.stringify(publicView).includes('re_test'));
  await h.call(`${f.route}/orders/${f.order.id}/pdf`,{user:'family'},403);
 }finally{h.db.close();}
});

test('approval is explicit, atomic and permanently one-time; stored sheets render in both colors',async()=>{
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
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({paymentUrl:'https://pay.example.test/changed',amountCents:999}),409);
 }finally{h.db.close();}
});

test('paid sheets can only be assigned to their owner’s children, including via existing QR registration',async()=>{
 const h=setup(),f=await fixture(h,3);try{
  await link(h,f);const approved=await h.call(`${f.route}/orders/${f.order.id}/approve`,post({paymentVerified:true})),ids=approved.order.bookIds;
  const other=(await h.call('/profiles',post({name:'Bram',age:8},'stranger'),201)).result;
  await h.call(`${f.route}/orders/${f.order.id}/assign`,post({bookId:ids[1],profileId:other.id},'family'),403);
  await h.call(`${f.route}/orders/${f.order.id}/assign`,post({bookId:ids[1],profileId:other.id},'stranger'),403);
  const assigned=await h.call(`${f.route}/orders/${f.order.id}/assign`,post({bookId:ids[1],profileId:f.second.id},'family'));assert(assigned.order.books.find(b=>b.id===ids[1]).admitted);
  await h.call(`${f.route}/orders/${f.order.id}/assign`,post({bookId:ids[1],profileId:f.profile.id},'family'),409);
  const stored=(await h.store.game(f.game.id)).data,free=stored.books.find(b=>b.id===ids[2]);
  await h.call(f.route+'/register',post({profileId:other.id,code:free.code},'stranger'),409);
  const registered=await h.call(f.route+'/register',post({profileId:f.second.id,code:free.code},'family'));assert(registered.game.books.find(b=>b.id===free.id).admitted);
  const pending=(await h.call(f.route+'/orders',post({quantity:1},'family'),201)).order;
  await link(h,{...f,order:pending});
  await h.call(f.route+'/start',post({}));
  await h.call(`${f.route}/orders/${pending.id}/approve`,post({paymentVerified:true}),409);
  await h.call(`${f.route}/orders/${f.order.id}/assign`,post({bookId:ids[0],profileId:f.profile.id},'family'),409);
  await h.call(f.route+'/orders',post({quantity:1},'family'),409);
 }finally{h.db.close();}
});

test('active order snapshots lock title, date, rounds and brand; cancellation preserves history',async()=>{
 const h=setup(),f=await fixture(h);try{
  for(const change of [{title:'Andere show'},{date:new Date(Date.now()+9*86400000).toISOString().slice(0,16)},{plan:{...f.game.plan,blocks:f.game.plan.blocks.filter((b,i)=>i!==f.game.plan.blocks.findIndex(b=>b.type==='round'))}}])await h.call(f.route,{method:'PUT',body:change},400);
  await h.call(f.route+'/brand',post({brandId:'vlampie'}),409);
  await h.call(`${f.route}/orders/${f.order.id}/cancel`,post({},'family'));assert.equal((await h.call('/orders',{user:'family'})).orders[0].status,'cancelled');
  await h.call(`${f.route}/orders/${f.order.id}/approve`,post({paymentVerified:true}),409);
  const renamed=await h.call(f.route,{method:'PUT',body:{title:'Andere show'}});assert.equal(renamed.game.title,'Andere show');assert.equal((await h.call('/orders',{user:'family'})).orders[0].show.title,f.game.title);
 }finally{h.db.close();}
});

test('failed mail retries freeze body and key, and require a gateway acceptance receipt',async()=>{
 const h=setup(),f=await fixture(h);try{
  const failed=[];const provider=async payload=>{failed.push(payload);return {accepted:true};};
  const first=await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({paymentUrl:'https://pay.example.test/retry',amountCents:500}),200,provider);assert.equal(first.order.paymentMail.status,'failed');assert.equal(first.order.status,'payment_pending');
  h.env.IGNORED_BROWSER_MAIL_FROM='changed@example.test';
  await h.call(`${f.route}/orders/${f.order.id}/mail`,post({kind:'payment'}),200,provider);assert.equal(failed.length,2);assert.deepEqual(failed[0].message,failed[1].message);assert.equal(failed[0].idempotencyKey,failed[1].idempotencyKey);assert(!('from'in failed[1].message));assert.deepEqual(failed[1].context,{brandId:'milo',gameId:f.game.id,orderId:f.order.id,kind:'payment'});
  const stored=(await h.store.game(f.game.id)).data.orders[0];assert(stored.paymentMail.uncertain);const old=stored.paymentMail.firstAttemptAt;
  await dispatchOrderMail({store:h.store,gameId:f.game.id,orderId:f.order.id,kind:'payment',env:{...h.env,ORDER_MAIL_DELIVERY:{...h.env.ORDER_MAIL_DELIVERY,send:provider}},origin:'https://studio.example',now:old+86400001});assert.equal(failed.length,2);assert.match((await h.store.game(f.game.id)).data.orders[0].paymentMail.error,/Veilig automatisch/);
 }finally{h.db.close();}
});

test('expired sending leases after a worker crash preserve uncertainty and stop beyond the adapter guarantee',async()=>{
 const h=setup(),f=await fixture(h);try{
  const now=Date.now();await h.store.mutate(f.game.id,{},g=>{const o=g.orders[0];o.status='payment_pending';o.paymentVersion=1;o.paymentUrl='https://pay.example.test/crash';o.paymentMail={status:'sending',version:1,attemptId:'crashed-worker',firstAttemptAt:now-86400001,leaseUntil:now-60000,attempts:1,adapterId:'test-dg-mail',idempotencyWindowMs:86400000};});
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
  const sending=h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({paymentUrl:'https://pay.example.test/leased',amountCents:500}),200,provider);await entered;
  await h.call(`${f.route}/orders/${f.order.id}/mail`,post({kind:'payment'}),200,provider);assert.equal(sends,1);
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({paymentUrl:'https://pay.example.test/replaced',amountCents:500}),409,provider);
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
  const first=await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({paymentUrl:'https://pay.example.test/uncertain',amountCents:500}),200,uncertain);
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
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({paymentUrl:'https://pay.example.test/rejected',amountCents:500}),200,rejected);
  await h.call(`${f.route}/orders/${f.order.id}/mail`,post({kind:'payment'}),200,rejected);assert.equal(sends,2);
  assert.equal((await h.store.game(f.game.id)).data.orders[0].paymentMail.uncertain,false);
 }finally{h.db.close();}
});


test('reading and updating legacy settings preserves stored cards, orders and custom prizes',async()=>{
 const h=setup(),f=await fixture(h);try{
  await link(h,f);await h.call(f.route+'/generate',post({count:1}),201);
  await h.store.mutate(f.game.id,{},g=>{delete g.settings.consolationEnabled;delete g.settings.consolationPrizeTitle;g.plan.prizes[0].title='Eigen prijs voor dit gezin';});
  const before=(await h.store.game(f.game.id)).data,rawBefore=(await h.db.prepare('SELECT document FROM bingo_games WHERE id=?').bind(f.game.id).first()).document;
  await h.call(f.route);await h.call('/orders',{user:'family'});await h.call(f.route+'/orders',{user:'family'});
  assert.equal((await h.db.prepare('SELECT document FROM bingo_games WHERE id=?').bind(f.game.id).first()).document,rawBefore,'reads do not rewrite legacy snapshots');
  await h.call(f.route,{method:'PUT',body:{settings:{...before.settings,claimSeconds:45}}});
  const after=(await h.store.game(f.game.id)).data;
  assert.deepEqual(after.books,before.books);assert.deepEqual(after.batches,before.batches);assert.deepEqual(after.orders,before.orders);assert.deepEqual(after.plan.prizes,before.plan.prizes);assert.deepEqual(after.results,before.results);
  assert.equal(after.settings.claimSeconds,45);assert.equal(after.settings.consolationEnabled,false);
 }finally{h.db.close();}
});

test('native session dispatch injects delivery and protects the complete order and cached PDF flow',async()=>{
 const h=setup();h.env.NODE_ENV='development';h.env.MILO_LOCAL_AUTH='true';let cookies={};
 const nativeRequest=(path,body,extra={})=>new Request('http://localhost:4173'+path,{method:body===undefined?'GET':'POST',headers:{Origin:'http://localhost:4173','Content-Type':'application/json','X-Vlampie-Bingo':'1',Cookie:Object.entries(cookies).map(([key,value])=>key+'='+value).join('; '),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const call=async(path,body,status=200,extra={})=>{
  const response=await dispatchNodeRequest(nativeRequest(path,body,extra),{env:h.env}),data=await response.json();assert.equal(response.status,status,JSON.stringify(data));
  for(const cookie of response.headers.getSetCookie()){const [key,value]=cookie.split(';')[0].split('=');cookies[key]=value;}
  return data;
 };
 try{
  await call('/api/bingo/orders',undefined,401,{'oai-authenticated-user-id':'host','oai-authenticated-user-email':'host@example.test'});
  await call('/auth/local',{role:'regie'});const regie={...cookies};
  const {game}=await call('/api/bingo/games',{title:'Native order rehearsal',date:new Date(Date.now()+7*86400000).toISOString().slice(0,16),brandId:'milo',roundCount:1},201),route='/api/bingo/games/'+game.id;
  await call(route+'/orders/config',{enabled:true,unitPriceCents:250});
  await call('/auth/local',{role:'player'});const family={...cookies};
  const {result:profile}=await call('/api/bingo/profiles',{name:'Noor',age:8},201);
  const {order}=await call(route+'/orders',{quantity:1,profileIds:[profile.id],email:'attacker@example.test'},201);
  await call(route+'/orders/'+order.id+'/approve',{paymentVerified:true},403);
  cookies=regie;await call(route+'/orders/'+order.id+'/payment-link',{paymentUrl:'https://pay.example.test/native',amountCents:250});
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
  const replacement={requestId:'replace-payment-accepted',paymentUrl:'https://pay.example.test/new?private=accepted-history',amountCents:525,note:'Nieuwe betaalnotitie'};
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
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({...replacement,paymentUrl:'https://pay.example.test/theft'},'stranger'),403);
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,{...post(replacement),user:'another-host',email:'host@example.test'},403);
  assert.deepEqual((await h.store.game(f.game.id)).data.orders[0],retry);
 }finally{h.db.close();}
});

test('replacing an uncertain payment mail preserves its frozen attempt and alerts only the owning admin',async()=>{
 const h=setup(),f=await fixture(h);try{
  h.env.ORDER_MAIL_DELIVERY.idempotencyWindowMs=0;
  let oldSends=0;const unconfirmed=async()=>{oldSends++;return {accepted:false,uncertain:true};};
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({paymentUrl:'https://pay.example.test/uncertain-old',amountCents:500}),200,unconfirmed);
  const old=structuredClone((await h.store.game(f.game.id)).data.orders[0].paymentMail);assert.equal(old.uncertain,true);
  const current=await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({paymentUrl:'https://pay.example.test/explicit-replacement',amountCents:510}));
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
   const order=g.orders[0];Object.assign(order,{paymentVersion:1,status:'payment_pending',paymentUrl:'https://pay.example.test/crashed-old',paymentMail:{status:'sending',version:1,attemptId:'crashed-after-acceptance',firstAttemptAt:now-60000,leaseUntil:now-1,adapterId:'old-dg-gateway',idempotencyWindowMs:0,payload:{to:['family@example.test'],text:'Frozen private attempt'},acceptedByProvider:true,providerId:'reconciliation-receipt'}});
  });
  const current=await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({paymentUrl:'https://pay.example.test/after-expired-lease',amountCents:500}));
  const archived=(await h.store.game(f.game.id)).data.orders[0].paymentMailHistory[0];assert.equal(archived.mail.status,'sending');assert.equal(archived.mail.uncertain,true);assert.equal(archived.mail.providerId,'reconciliation-receipt');assert.equal(archived.mail.acceptedByProvider,true);assert.equal(archived.mail.attemptId,'crashed-after-acceptance');assert.equal(archived.mail.payload.text,'Frozen private attempt');
  assert.deepEqual(current.order.paymentMailReconciliation,{required:true,versions:[1]});assert.equal(h.mail.length,1);assert.equal(h.mail[0].message.text.includes('Frozen private attempt'),false);
 }finally{h.db.close();}
});

test('the payment version limit rejects before any mutation and still permits an unchanged final-version retry',async()=>{
 const h=setup(),f=await fixture(h);try{
  delete h.env.ORDER_MAIL_DELIVERY;
  for(let version=1;version<=20;version++)await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({paymentUrl:'https://pay.example.test/version/'+version,amountCents:500+version}));
  const before=(await h.store.game(f.game.id)).data,order=before.orders[0];assert.equal(order.paymentVersion,20);assert.equal(order.paymentMailHistory.length,19);
  const direct=structuredClone(order);assert.throws(()=>setPaymentLink(before,direct,{paymentUrl:'https://pay.example.test/version/21',amountCents:521}),error=>error.code==='order_mail_version_limit');assert.deepEqual(direct,order,'pure operation leaves every field unchanged on limit');
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({paymentUrl:'https://pay.example.test/version/21',amountCents:521}),409);
  assert.deepEqual((await h.store.game(f.game.id)).data,before,'failed API change commits no new game revision or partial archive');
  await h.call(`${f.route}/orders/${f.order.id}/payment-link`,post({paymentUrl:order.paymentUrl,amountCents:order.amountCents,note:order.note}));
  const retry=(await h.store.game(f.game.id)).data.orders[0];assert.equal(retry.paymentVersion,20);assert.deepEqual(retry.paymentMailHistory,order.paymentMailHistory);assert.equal(h.mail.length,0);
 }finally{h.db.close();}
});
