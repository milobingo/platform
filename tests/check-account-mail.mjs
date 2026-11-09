import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStorageEnvironment} from '../server/node-storage.js';
import {dispatchNodeRequest} from '../server/node-runtime.js';
import {BingoStore} from '../server/bingo-store.js';
import {MailStore} from '../server/mail-store.js';
import {recordAccountWelcome,recoverAccountWelcome} from '../server/account-mail.js';

const origin='https://studio.example';
async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'milo-account-mail-'));
 const storage=await createStorageEnvironment({SQLITE_PATH:join(directory,'app.sqlite'),OBJECT_STORAGE_PATH:join(directory,'objects')});
 t.after(async()=>{await storage.close();await rm(directory,{recursive:true,force:true});});
 const user={id:'verified-parent',email:'parent@example.test'},sent=[];
 const env={...storage,NODE_ENV:'development',APP_URL:origin,MILO_LOCAL_AUTH:'false',SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',VLAMPIE_SETTINGS_KEY:'09'.repeat(32),MAIL_FROM:'studio@example.test',MAIL_ORGANIZATION_EMAIL:'studio@example.test',ORDER_MAIL_DELIVERY:{id:'local-test-gateway',send:async delivery=>{sent.push(structuredClone({message:delivery.message,context:delivery.context,idempotencyKey:delivery.idempotencyKey}));return {accepted:true,messageId:'stub-'+sent.length};}}};
 let verifications=0;const authClientFactory=()=>({auth:{getUser:async()=>{verifications++;return {data:{user:{...user}},error:null};}}});
 const call=async(body,status=200)=>{
  const request=new Request(origin+'/api/player/onboarding',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Vlampie-Player':'1'},body:JSON.stringify(body)});
  const response=await dispatchNodeRequest(request,{env,authClientFactory,providerFetch:()=>{throw Error('No provider network in account-mail tests');}}),data=await response.json();
  assert.equal(response.status,status,JSON.stringify(data));assert.match(response.headers.get('Cache-Control'),/no-store/);return data;
 };
 return {env,user,sent,call,mail:new MailStore(storage.DB),bingo:new BingoStore(storage.DB),get verifications(){return verifications;}};
}
const onboarding={name:'Volwassen ouder',dateOfBirth:'1990-01-01',brandId:'milo'};

test('account welcome records one immutable domain marker per account and show brand',()=>{
 const family={profiles:[]},first=recordAccountWelcome(family,{accountId:'parent',email:'verified@example.test',brandId:'milo',name:'Eerste naam'},100);
 assert.strictEqual(recordAccountWelcome(family,{accountId:'parent',email:'changed@example.test',brandId:'milo',name:'Latere naam'},200),first);
 assert.deepEqual(first,{eventId:'account/parent/welcome/milo/1',brandId:'milo',email:'verified@example.test',name:'Eerste naam',createdAt:100});
 const other=recordAccountWelcome(family,{accountId:'parent',email:'verified@example.test',brandId:'vlampie',name:'Eerste naam'},300);
 assert.notEqual(other.eventId,first.eventId);assert.deepEqual(Object.keys(family.welcomeMailEvents).sort(),['milo','vlampie']);
 assert.throws(()=>recordAccountWelcome(family,{accountId:'parent',brandId:'unknown'}),error=>error.status===400);assert.equal(Object.keys(family.welcomeMailEvents).length,2);
});

test('concurrent duplicate native onboarding offers at most one welcome per brand and never opts into newsletters',async t=>{
 const h=await fixture(t);await Promise.all([h.call(onboarding),h.call(onboarding)]);await h.call({...onboarding,name:'Gewijzigde oudernaam'});
 assert.equal(h.sent.length,1);assert.equal((await h.mail.list('delivery','milo')).length,1);assert.deepEqual(h.sent[0].message.to,[h.user.email]);assert.equal(h.sent[0].context.templateId,'welcome');
 let family=(await h.bingo.family(h.user.id)).data;assert.equal(family.profiles.length,1);assert.equal(family.welcomeMailEvents.milo.name,onboarding.name);assert.equal(family.welcomeMailEvents.milo.eventId,'account/'+h.user.id+'/welcome/milo/1');
 await Promise.all([h.call({...onboarding,brandId:'vlampie'}),h.call({...onboarding,brandId:'vlampie'})]);assert.equal(h.sent.length,2);assert.equal((await h.mail.list('delivery','vlampie')).length,1);
 family=(await h.bingo.family(h.user.id)).data;assert.deepEqual(Object.keys(family.welcomeMailEvents).sort(),['milo','vlampie']);assert.notEqual(h.sent[0].idempotencyKey,h.sent[1].idempotencyKey);
 for(const brand of ['milo','vlampie']){assert.equal((await h.mail.preference(h.user.id,brand)).subscribed,0);assert.deepEqual(await h.mail.subscribers(brand),[]);}
 assert(h.verifications>=5,'the native dispatcher verifies each request through its Auth adapter');
});

test('welcome recovery requires the current verified address to match the durable marker and ignores a client recipient override',async t=>{
 const h=await fixture(t);await h.call({...onboarding,email:'untrusted-client@example.test'});assert.deepEqual(h.sent[0].message.to,['parent@example.test']);
 const first=(await h.bingo.family(h.user.id)).data.welcomeMailEvents.milo;h.user.email='new-verified@example.test';
 const blocked=await h.call({...onboarding,email:'parent@example.test'});assert.equal(blocked.welcomeMail.status,'blocked');assert.equal(h.sent.length,1);assert.deepEqual((await h.bingo.family(h.user.id)).data.welcomeMailEvents.milo,first);
 const family=(await h.bingo.family(h.user.id)).data;assert.deepEqual(await recoverAccountWelcome({env:h.env,family,identity:{user:h.user.id,email:h.user.email},brandId:'milo',origin}),{status:'blocked',reason:'verified_recipient_changed'});assert.equal(h.sent.length,1);
 await h.call({...onboarding,brandId:'vlampie'});assert.deepEqual(h.sent[1].message.to,['new-verified@example.test']);assert.equal(h.sent.length,2);
 assert.equal((await h.mail.preference(h.user.id,'milo')).subscribed,0);assert.equal((await h.mail.preference(h.user.id,'vlampie')).subscribed,0);
});

test('native onboarding preserves its welcome marker during private-storage configuration failure and repairs preparation once',async t=>{
 const h=await fixture(t),key=h.env.VLAMPIE_SETTINGS_KEY;delete h.env.VLAMPIE_SETTINGS_KEY;
 const first=await h.call(onboarding);assert.equal(first.welcomeMail.status,'failed');assert.equal(first.family.onboardingComplete,true);assert.equal(h.sent.length,0);
 const marker=structuredClone(first.family.welcomeMailEvents.milo);assert.equal((await h.mail.list('delivery','milo')).length,1);
 h.env.VLAMPIE_SETTINGS_KEY=key;await Promise.all([h.call(onboarding),h.call(onboarding)]);await h.call(onboarding);
 assert.equal(h.sent.length,1);const records=await h.mail.list('delivery','milo');assert.equal(records.length,1);assert.equal(records[0].status,'accepted');assert.equal(records[0].attempts,1);assert.deepEqual((await h.bingo.family(h.user.id)).data.welcomeMailEvents.milo,marker);
});
