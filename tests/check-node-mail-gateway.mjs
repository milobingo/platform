import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createOrderMailDelivery} from '../server/node-mail-gateway.js';

const secret=Buffer.alloc(32,7),configuration={SUPABASE_URL:'https://test-project.supabase.co',SEND_EMAIL_HOOK_SECRET:'v1,whsec_'+secret.toString('base64'),MAIL_ENVIRONMENT:'staging',MAIL_MODE:'allowlist',MAIL_ALLOWED_RECIPIENTS:'parent@example.invalid'};
const message={to:['parent@example.invalid'],subject:'Bestelling',text:'Veilig in je account',html:'<p>Veilig in je account</p>'};
const input={message,context:{kind:'payment'},idempotencyKey:'milo-order/order-id/payment/1'};
const accepted=()=>new Response(null,{headers:{'x-mail-status':'accepted','x-mail-provider':'resend','x-provider-message-id':'receipt-1'}});
test('unconfigured/disabled, incomplete and staging-live mail never creates a delivery adapter',()=>{
 for(const env of [{},{...configuration,MAIL_MODE:'disabled'},{...configuration,SEND_EMAIL_HOOK_SECRET:''},{...configuration,MAIL_MODE:'live'},{...configuration,MAIL_ENVIRONMENT:''},{...configuration,MAIL_ALLOWED_RECIPIENTS:''},{...configuration,SUPABASE_URL:'https://attacker.invalid'},{...configuration,SUPABASE_URL:'https://test-project.supabase.co/path'}])assert.equal(createOrderMailDelivery(env),null);
});
test('signed DG envelope preserves stable correlation, constrains recipient and disables redirects',async()=>{
 const calls=[];
 const adapter=createOrderMailDelivery(configuration,{now:()=>1700000000000,randomId:()=> 'attempt-1',fetcher:async(url,init)=>{calls.push({url,init});return accepted();}});
 assert.equal(adapter.idempotencyWindowMs,0);
 assert.deepEqual(await adapter.send(input),{accepted:true,messageId:'resend:receipt-1'});
 const {url,init}=calls[0],body=JSON.parse(init.body);
 assert.equal(url,'https://test-project.supabase.co/functions/v1/send-email-hook');
 assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.method,'POST');
 assert.equal(body.kind,'transactional');assert.equal(body.message.to,'parent@example.invalid');
 assert.equal(body.message.messageType,'milo_order_payment');assert.match(body.message.outboxId,/^milo-[a-f0-9]{64}$/);
 assert.equal(body.message.providerProbe,false);assert(!('from'in body.message));assert(!('authorization'in init.headers));
 assert.equal(init.headers['webhook-signature'],'v1,'+createHmac('sha256',secret).update('msg_attempt-1.1700000000.'+init.body).digest('base64'));
 assert.equal(init.headers['webhook-timestamp'],'1700000000');
 await adapter.send(input);assert.equal(JSON.parse(calls[1].init.body).message.outboxId,body.message.outboxId);
 await adapter.send({...input,idempotencyKey:input.idempotencyKey+'-new'});assert.notEqual(JSON.parse(calls[2].init.body).message.outboxId,body.message.outboxId);
 const before=calls.length;
 for(const to of [['outsider@example.invalid'],['parent@example.invalid','outsider@example.invalid']])assert.deepEqual(await adapter.send({...input,message:{...message,to}}),{accepted:false,uncertain:false});
 assert.equal(calls.length,before);
});
test('sandbox validation, malformed success and lost/rejected outcomes remain truthful',async()=>{
 for(const [response,expected] of [
  [new Response(null,{headers:{'x-mail-status':'validated'}}),{accepted:false,uncertain:false}],
  [new Response(null,{headers:{'x-mail-status':'accepted','x-mail-provider':'resend'}}),{accepted:false,uncertain:true}],
  [new Response(null,{headers:{'x-provider-message-id':'receipt','x-mail-provider':'resend'}}),{accepted:false,uncertain:true}],
  [new Response(null,{status:403}),{accepted:false,uncertain:false}],
  [new Response(null,{status:503,headers:{'x-mail-status':'deferred'}}),{accepted:false,uncertain:false}],
  [new Response(null,{status:409}),{accepted:false,uncertain:true}],
  [new Response(null,{status:503}),{accepted:false,uncertain:true}],
 ]){
  const adapter=createOrderMailDelivery(configuration,{fetcher:async()=>response});
  assert.deepEqual(await adapter.send(input),expected);
 }
 assert.deepEqual(await createOrderMailDelivery(configuration,{fetcher:async()=>{throw new Error('network');}}).send(input),{accepted:false,uncertain:true});
});
test('gateway or signing key rotation changes the frozen adapter identity',()=>{
 const original=createOrderMailDelivery(configuration);
 assert.equal(original.id,createOrderMailDelivery({...configuration,MAIL_ALLOWED_RECIPIENTS:'parent@example.invalid,another@example.invalid'}).id);
 assert.notEqual(original.id,createOrderMailDelivery({...configuration,SEND_EMAIL_HOOK_SECRET:'whsec_'+Buffer.alloc(32,8).toString('base64')}).id);
 assert.notEqual(original.id,createOrderMailDelivery({...configuration,SUPABASE_URL:'https://other-project.supabase.co'}).id);
});
