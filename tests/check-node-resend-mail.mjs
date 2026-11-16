import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createResendMailDelivery} from '../server/node-resend-mail.js';
import {createStorageEnvironment} from '../server/node-storage.js';
import {writePrivateSetting} from '../server/secrets.js';
import {resendFingerprint} from '../server/resend.js';
import {mailConfig} from '../server/mail-config.js';
import {MailStore} from '../server/mail-store.js';
import {dispatchMailEvent,sendOutbox,mailState,sendCampaignBatch} from '../server/mail-service.js';
import {withProviderSettingsLock} from '../server/node-provider-settings.js';
import {makeGame} from '../server/bingo-model.js';
import {BingoStore} from '../server/bingo-store.js';
import {dispatchOrderMail} from '../server/bingo-order-mail.js';

const origin='https://studio.example',key='re_SYNTHETIC_'+ 'a'.repeat(25),value={key,from:'show@example.test',replyTo:'help@example.test'};
const env={APP_URL:origin,MAIL_ENVIRONMENT:'staging'},policy={deliveryMode:'allowlist',allowedRecipients:['parent@example.test']};
const message={from:'"Milo & Friends BingoShow" <show@example.test>',to:['parent@example.test'],subject:'Een veilig servicebericht',text:'De echte spelstand staat in jullie account.',html:'<p>De echte spelstand staat in jullie account.</p>'};
const input={message,context:{kind:'payment'},idempotencyKey:'milo-order/order-1/payment/1'};
const receipt=()=>Response.json({id:'f6cfad14-8cc4-4f15-951e-d8f66701dc7e'});

test('direct Resend requires explicit record policy, correct environment, recipient list and retained host upper bounds',async()=>{
 const noFetch=()=>{throw Error('No provider permitted');};
 for(const [configuration,options] of [[env,{}],[env,{deliveryMode:'live'}],[{},policy],[{...env,MAIL_MODE:'disabled'},policy],[{...env,MAIL_MODE:'allowlist',MAIL_ALLOWED_RECIPIENTS:''},policy],[env,{deliveryMode:'allowlist',allowedRecipients:[]}]])assert.equal(await createResendMailDelivery(configuration,value,{...options,fetcher:noFetch}),null);
 const adapter=await createResendMailDelivery({...env,MAIL_MODE:'allowlist',MAIL_ALLOWED_RECIPIENTS:'parent@example.test'},value,{...policy,allowedRecipients:['parent@example.test','other@example.test'],fetcher:noFetch});assert(adapter);
 assert.deepEqual(await adapter.send({...input,message:{...message,to:['other@example.test']}}),{accepted:false,uncertain:false});
});
test('adapter sends a single constrained HTTPS payload with stable idempotency and explicit reply-to, preserving sender',async()=>{
 const calls=[],adapter=await createResendMailDelivery(env,value,{...policy,fetcher:async(url,options)=>{calls.push({url,options});return receipt();}});
 assert.equal(adapter.idempotencyWindowMs,86400000);assert.equal(adapter.supportsMarketing,true);
 assert.deepEqual(await adapter.send(input),{accepted:true,messageId:'resend:f6cfad14-8cc4-4f15-951e-d8f66701dc7e'});await adapter.send(input);
 assert.equal(calls.length,2);assert.equal(calls[0].url,'https://api.resend.com/emails');assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.headers.Authorization,'Bearer '+key);assert.equal(calls[0].options.headers['Idempotency-Key'],input.idempotencyKey);assert.equal(calls[0].options.body,calls[1].options.body);
 const payload=JSON.parse(calls[0].options.body);assert.equal(payload.from,message.from);assert.equal(payload.reply_to,value.replyTo);assert.deepEqual(payload.to,message.to);assert(!('key'in payload));
 for(const change of [{to:['outsider@example.test']},{to:['parent@example.test','other@example.test']},{from:'"Old sender" <old@example.test>'},{subject:'evil\r\nBcc: someone@example.test'},{headers:{Bcc:'someone@example.test'}}])assert.deepEqual(await adapter.send({...input,message:{...message,...change}}),{accepted:false,uncertain:false});
 assert.equal(calls.length,2);
});
test('direct Resend marketing requires the existing one-click unsubscribe payload on the app origin',async()=>{
 let calls=0;const adapter=await createResendMailDelivery(env,value,{...policy,fetcher:async()=>{calls++;return receipt();}}),context={kind:'studio',templateId:'newsletter',marketing:true};
 assert.deepEqual(await adapter.send({...input,context}),{accepted:false,uncertain:false});
 const headers={'List-Unsubscribe':'<'+origin+'/mail/afmelden?token=synthetic>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'};
 assert.equal((await adapter.send({...input,context,message:{...message,headers}})).accepted,true);
 assert.deepEqual(await adapter.send({...input,context,message:{...message,headers:{...headers,'List-Unsubscribe':'<https://evil.example/mail/afmelden>'}}}),{accepted:false,uncertain:false});assert.equal(calls,1);
});
test('definite rejections, ambiguous responses and network loss remain distinct; no receipt/error body is exposed',async()=>{
 for(const [providerFetch,uncertain] of [[async()=>new Response(key,{status:401}),false],[async()=>new Response(key,{status:429}),false],[async()=>new Response(key,{status:500}),true],[async()=>new Response(key,{status:409}),true],[async()=>Response.json({id:key}),true],[async()=>new Response('x'.repeat(5000)),true],[async()=>{throw Error(key);},true]]){
  const adapter=await createResendMailDelivery(env,value,{...policy,fetcher:providerFetch});const outcome=await adapter.send(input);assert.deepEqual(outcome,{accepted:false,uncertain});assert(!JSON.stringify(outcome).includes(key));
 }
});
test('credential/sender rotation changes adapter identity while recipient-policy changes preserve provider identity',async()=>{
 const base=await createResendMailDelivery(env,value,policy);assert.equal(base.id,(await createResendMailDelivery(env,value,{...policy,allowedRecipients:['other@example.test']})).id);
 for(const change of [{key:key+'x'},{from:'other@example.test'},{replyTo:'other@example.test'}])assert.notEqual(base.id,(await createResendMailDelivery(env,{...value,...change},policy)).id);
});

async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'milo-resend-outbox-')),storage=await createStorageEnvironment({SQLITE_PATH:join(directory,'app.sqlite'),OBJECT_STORAGE_PATH:join(directory,'objects')});t.after(async()=>{await storage.close();await rm(directory,{recursive:true,force:true});});
 let response='accepted',count=0;const sent=[],environment={...env,...storage,NATIVE_PROVIDER_SETTINGS:true,VLAMPIE_SETTINGS_KEY:'03'.repeat(32),MAIL_PROVIDER_FETCH:async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');sent.push({body:options.body,key:options.headers['Idempotency-Key']});count++;if(typeof response==='function')return response();if(response==='network')throw Error('synthetic loss');if(response==='rejected')return new Response(null,{status:401});return receipt();}};
 let revision=null;
 const configure=async(mode='regie',deliveryMode='allowlist',changes={},recipients=policy.allowedRecipients)=>withProviderSettingsLock(environment,async locked=>{const credentials={...value,...changes};const result=await writePrivateSetting(locked,'native-provider-resend',{version:1,mode,...(mode==='regie'?{credentials}:{}),deliveryMode,allowedRecipients:recipients,fingerprint:await resendFingerprint(credentials),connectionTest:{tested:false,testedAt:null}},revision);assert(result);revision=result.revision;});
 return {env:environment,sent,configure,response:next=>{response=next;},count:()=>count,store:new MailStore(environment.DB)};
}
const event={ownerId:'regie',eventId:'welcome-resend',templateId:'welcome',brandId:'milo',context:{voornaam:'Ouder',gezinsnaam:'Gezin',account_link:origin+'/spelen',organisatie_email:'help@example.test'},recipient:{accountId:'parent',email:'parent@example.test',name:'Ouder'},origin};
test('existing encrypted outbox deduplicates native Resend events and retains frozen failed and uncertain histories across settings changes',async t=>{
 const h=await fixture(t);await h.configure('regie','disabled');const disabled=await dispatchMailEvent({...event,eventId:'disabled-event',env:h.env});assert.equal(disabled.status,'failed');assert.equal(h.count(),0);
 await h.configure();const accepted=await dispatchMailEvent({...event,env:h.env});assert.equal(accepted.status,'accepted');assert.equal((await dispatchMailEvent({...event,env:h.env})).status,'accepted');assert.equal(h.count(),1);assert.equal(JSON.parse(h.sent[0].body).reply_to,'help@example.test');
 h.response('rejected');const rejected=await dispatchMailEvent({...event,eventId:'rejected-event',env:h.env});assert.equal(rejected.status,'failed');const frozen=h.sent.at(-1);h.response('accepted');assert.equal((await sendOutbox({env:h.env,id:rejected.id,retry:true})).status,'accepted');assert.deepEqual(h.sent.at(-1),frozen);
 h.response('network');const uncertain=await dispatchMailEvent({...event,eventId:'uncertain-event',env:h.env});assert.equal(uncertain.status,'uncertain');const before=await h.store.get(uncertain.id),count=h.count();await h.configure('regie','allowlist',{key:key+'rotated'});assert.deepEqual(await h.store.get(uncertain.id),before);await sendOutbox({env:h.env,id:uncertain.id,retry:true});assert.equal(h.count(),count);assert.deepEqual(await h.store.get(uncertain.id),before);
 await h.configure('disabled');assert.equal((await mailConfig(h.env)).delivery,null);const state=await mailState(h.env,'milo');assert.equal(state.provider.configured,false);assert.equal(state.outbox.find(r=>r.id===uncertain.id).status,'uncertain');
});
test('a captured adapter rechecks disabled state, rotated credentials and changed recipient policy before HTTP contact',async t=>{
 const h=await fixture(t);await h.configure();const old=(await mailConfig(h.env)).delivery;
 await h.configure('disabled');assert.deepEqual(await old.send(input),{accepted:false,uncertain:false});assert.equal(h.count(),0);
 await h.configure('regie','allowlist',{key:key+'rotated'});assert.deepEqual(await old.send(input),{accepted:false,uncertain:false});assert.equal(h.count(),0);
 await h.configure();const beforePolicyChange=(await mailConfig(h.env)).delivery;await h.configure('regie','allowlist',{},['other@example.test']);assert.deepEqual(await beforePolicyChange.send(input),{accepted:false,uncertain:false});assert.equal(h.count(),0);
});
test('completed disable cannot race ahead of an in-flight contact; after disable even an old adapter cannot send again',async t=>{
 const h=await fixture(t);await h.configure();const adapter=(await mailConfig(h.env)).delivery;let started,release;
 const entered=new Promise(resolve=>{started=resolve;}),blocked=new Promise(resolve=>{release=resolve;});h.response(async()=>{started();await blocked;return receipt();});
 const sending=adapter.send(input);await entered;let disabled=false;const disabling=h.configure('disabled').then(()=>{disabled=true;});
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(disabled,false);release();assert.equal((await sending).accepted,true);await disabling;assert.equal(disabled,true);assert.deepEqual(await adapter.send(input),{accepted:false,uncertain:false});assert.equal(h.count(),1);
});
test('manual mail contact rechecks an organizer role after admission while ordinary authorized domain events remain usable',async t=>{
 const h=await fixture(t);await h.configure();h.env.AUTH_IDENTITY={user:'operator',admin:true};await h.env.DB.prepare('INSERT INTO app_user_roles(user_id,role) VALUES (?,?)').bind('operator','regie').run();const adapter=(await mailConfig(h.env)).delivery;
 await h.env.DB.prepare('UPDATE app_user_roles SET role=? WHERE user_id=?').bind('player','operator').run();assert.deepEqual(await adapter.send({...input,context:{kind:'studio',templateId:'welcome',test:true}}),{accepted:false,uncertain:false});assert.equal(h.count(),0);
 h.env.AUTH_IDENTITY={user:'parent',admin:false};assert.deepEqual(await adapter.send({...input,context:{kind:'studio',templateId:'welcome',test:true}}),{accepted:false,uncertain:false});assert.equal((await adapter.send(input)).accepted,true);assert.equal(h.count(),1);
});
test('a real order with an unknown prior Resend offering cannot retry across encrypted credential rotation',async t=>{
 const h=await fixture(t);await h.configure();const original=(await mailConfig(h.env)).delivery,game=makeGame({title:'Bewaar de eerdere aanbieding',date:'2026-12-01T19:00:00Z',brandId:'milo'},'regie',origin);
 const frozen=structuredClone(message);game.orders=[{id:'order-one',number:'MF-0001',status:'payment_pending',email:'parent@example.test',customerName:'Ouder',quantity:1,amountCents:250,paymentUrl:'https://bunq.me/o/OrderOneTest',paymentVersion:1,show:{title:game.title,date:game.date},paymentMail:{status:'offering',uncertain:true,leaseUntil:Date.now()-1,firstAttemptAt:Date.now()-1000,adapterId:original.id,idempotencyWindowMs:original.idempotencyWindowMs,payload:frozen,attempts:1}}];
 const store=new BingoStore(h.env.DB);await store.create(game);await h.configure('regie','allowlist',{key:key+'rotated'});await dispatchOrderMail({store,gameId:game.id,orderId:'order-one',kind:'payment',env:h.env,origin});
 const mail=(await store.game(game.id)).data.orders[0].paymentMail;assert.equal(h.count(),0);assert.equal(mail.uncertain,true);assert.equal(mail.adapterId,original.id);assert.equal(mail.status,'failed');assert.deepEqual(mail.payload,frozen);assert.match(mail.error,/onzeker/);
});
test('mail state distinguishes saved credentials from permission to send; disabled sending leaves a prepared campaign untouched',async t=>{
 const h=await fixture(t);await h.configure('regie','disabled');const state=await mailState(h.env,'milo');assert.equal(state.provider.configured,true);assert.equal(state.provider.deliveryEnabled,false);assert.match(state.provider.deliveryReason,/staat uit/);
 const id=crypto.randomUUID();await h.store.create({id,kind:'campaign',brandId:'milo',ownerId:'regie',status:'prepared',templateId:'newsletter',recipientIds:[],createdAt:Date.now(),updatedAt:Date.now()});const before=await h.store.get(id);
 await assert.rejects(sendCampaignBatch({env:h.env,id,ownerId:'regie',brandId:'milo',confirm:true,origin}),error=>error.code==='mail_disabled');assert.deepEqual(await h.store.get(id),before);assert.equal(h.count(),0);
});
