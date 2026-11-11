import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStorageEnvironment} from '../server/node-storage.js';
import {dispatchNodeRequest} from '../server/node-runtime.js';
import {readPrivateSetting,writePrivateSetting} from '../server/secrets.js';
import {resendSettings} from '../server/resend.js';
import {mailConfig} from '../server/mail-config.js';
import {withProviderSettingsLock} from '../server/node-provider-settings.js';

const origin='https://studio.example',key='re_SYNTHETIC_'+ 'a'.repeat(25),replacement='re_SYNTHETIC_'+ 'b'.repeat(25);
const credentials={key,from:'show@example.test',replyTo:'help@example.test'};
const noProvider=()=>{throw Error('No real provider request is permitted');};
const auth=user=>()=>({auth:{getUser:async()=>({data:{user},error:null})}});
async function fixture(t,extra={}){
 const directory=await mkdtemp(join(tmpdir(),'milo-resend-')),storage=await createStorageEnvironment({SQLITE_PATH:join(directory,'app.sqlite'),OBJECT_STORAGE_PATH:join(directory,'objects')});
 t.after(async()=>{await storage.close();await rm(directory,{recursive:true,force:true});});
 const user={id:crypto.randomUUID(),email:'regie@example.test'},env={NODE_ENV:'production',APP_URL:origin,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',VLAMPIE_SETTINGS_KEY:'01'.repeat(32),MAIL_ENVIRONMENT:'staging',...storage,...extra};
 await env.DB.prepare('INSERT INTO app_user_roles (user_id,role) VALUES (?,?)').bind(user.id,'regie').run();
 const request=(body,headers={},method=body===undefined?'GET':'POST')=>new Request(origin+'/api/resend/settings',{method,headers:{Origin:origin,'Content-Type':'application/json','X-Vlampie-Settings':'1',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const invoke=async(body,{status=200,headers={},providerFetch=noProvider,providerUser=user,method}={})=>{
  const response=await dispatchNodeRequest(request(body,headers,method),{env,authClientFactory:auth(providerUser),providerFetch}),text=await response.text();assert.equal(response.status,status,text);assert.match(response.headers.get('cache-control'),/no-store/);assert(!text.includes(key));assert(!text.includes(replacement));return {data:text?JSON.parse(text):null,response};
 };
 const native=()=>({...env,NATIVE_PROVIDER_SETTINGS:true});
 const raw=async()=>{const object=await env.SETTINGS.get('private/native-provider-resend.v1');return object?{etag:object.etag,body:await object.json()}:null;};
 return {env,user,request,invoke,native,raw};
}

test('native Resend status needs no provider environment keys and never imports prototype credentials',async t=>{
 const h=await fixture(t);await writePrivateSetting(h.env,'resend',{key,from:credentials.from},null);
 const status=(await h.invoke()).data;assert.equal(status.configured,false);assert.equal(status.keyConfigured,false);assert.equal(status.canManage,true);assert.equal(status.revision,null);assert.equal(status.sendingAllowed,false);assert.equal(status.hostPolicy.mode,null);
 const unavailable=await fixture(t,{VLAMPIE_SETTINGS_KEY:''});assert.equal((await unavailable.invoke()).data.canManage,false);await unavailable.invoke({action:'save',revision:null,...credentials},{status:503});
});
test('save encrypts credentials and policy with fresh IVs, sends nothing and defaults to disabled',async t=>{
 const h=await fixture(t);let saved=(await h.invoke({action:'save',revision:null,...credentials})).data;
 assert.equal(saved.configured,true);assert.equal(saved.keyConfigured,true);assert.equal(saved.source,'regie');assert.equal(saved.deliveryMode,'disabled');assert.equal(saved.sendingAllowed,false);assert.equal(saved.connectionTest.tested,false);
 const first=await h.raw();assert(!JSON.stringify(first).includes(key));assert(!JSON.stringify(first).includes(credentials.replyTo));assert.equal((await resendSettings(h.native())).value.key,key);
 saved=(await h.invoke({action:'save',revision:saved.revision,key:'',from:'changed@example.test',replyTo:''})).data;
 assert.equal((await resendSettings(h.native())).value.key,key);assert.equal(saved.from,'changed@example.test');assert.equal(saved.replyTo,'');const second=await h.raw();assert.notEqual(first.body.iv,second.body.iv);assert.notEqual(first.body.data,second.body.data);
 assert.equal((await h.env.DB.prepare('SELECT count(*) AS n FROM studio_mail_records').first()).n,0);
});
test('invalid replacements, injected headers and staging live mode preserve the previous encrypted record',async t=>{
 const h=await fixture(t),saved=(await h.invoke({action:'save',revision:null,...credentials})).data,before=await h.raw();
 for(const change of [{key:'invalid-key'},{key:42},{from:'evil@example.test\r\nBcc: outsider@example.test'},{from:'Name <show@example.test>'},{replyTo:'two@example.test,another@example.test'},{replyTo:null},{deliveryMode:null},{allowedRecipients:null},{deliveryMode:'live'},{deliveryMode:'allowlist',allowedRecipients:[]},{deliveryMode:'allowlist',allowedRecipients:['bad']},{deliveryMode:'allowlist',allowedRecipients:'parent@example.test'}]){
  await h.invoke({action:'save',revision:saved.revision,...change},{status:400});assert.deepEqual(await h.raw(),before);
 }
});
test('admin can explicitly enable a staging recipient list while a key-only edit retains that policy',async t=>{
 const h=await fixture(t);let saved=(await h.invoke({action:'save',revision:null,...credentials,deliveryMode:'allowlist',allowedRecipients:[' Parent@Example.Test ','parent@example.test','other@example.test']})).data;
 assert.deepEqual(saved.allowedRecipients,['parent@example.test','other@example.test']);assert.equal(saved.sendingAllowed,true);assert.equal(saved.environment,'staging');assert.equal(saved.hostPolicy.limited,false);
 saved=(await h.invoke({action:'save',revision:saved.revision,key:replacement})).data;assert.equal(saved.deliveryMode,'allowlist');assert.equal(saved.sendingAllowed,true);assert.equal((await resendSettings(h.native())).value.key,replacement);
});
test('the bounded settings request accepts the documented 100 long recipient addresses and refuses 101 without changing storage',async t=>{
 const h=await fixture(t),domain=['x'.repeat(40),'y'.repeat(40),'z'.repeat(40),'example','test'].join('.'),allowedRecipients=Array.from({length:100},(_,i)=>'person'+i+'x'.repeat(50)+'@'+domain);
 const body={action:'save',revision:null,...credentials,deliveryMode:'allowlist',allowedRecipients};assert(JSON.stringify(body).length>8000);const saved=(await h.invoke(body)).data;assert.equal(saved.allowedRecipients.length,100);const before=await h.raw();await h.invoke({...body,revision:saved.revision,allowedRecipients:[...allowedRecipients,'extra@example.test']},{status:400});assert.deepEqual(await h.raw(),before);
});
test('legacy host mail limits are upper bounds and production live sending requires explicit record selection',async t=>{
 const h=await fixture(t,{MAIL_ENVIRONMENT:'production',MAIL_MODE:'disabled'});let saved=(await h.invoke({action:'save',revision:null,...credentials,deliveryMode:'live'})).data;
 assert.equal(saved.deliveryMode,'live');assert.equal(saved.sendingAllowed,false);assert.equal(saved.hostPolicy.mode,'disabled');assert.equal((await mailConfig(h.native())).delivery,null);
 h.env.MAIL_MODE='allowlist';h.env.MAIL_ALLOWED_RECIPIENTS='allowed@example.test';saved=(await h.invoke()).data;assert.equal(saved.sendingAllowed,true);const adapter=(await mailConfig(h.native())).delivery;assert(adapter);
 h.env.MAIL_ALLOWED_RECIPIENTS='';assert.equal((await h.invoke()).data.sendingAllowed,false);
 delete h.env.MAIL_MODE;assert.equal((await h.invoke()).data.sendingAllowed,true);
});
test('native authorization strips forged identities and checks roles, exact origin, custom header and player context',async t=>{
 const h=await fixture(t),body={action:'save',revision:null,...credentials};
 for(const options of [{headers:{Origin:'https://evil.example'}},{headers:{Origin:''}},{headers:{'X-Vlampie-Settings':''}},{headers:{'X-Vlampie-Player':'1'}},{headers:{'Sec-Fetch-Site':'cross-site'}},{providerUser:{id:'player',email:h.user.email,user_metadata:{role:'regie'}}}])await h.invoke(body,{...options,status:403});
 await h.invoke(body,{providerUser:null,headers:{'oai-authenticated-user-id':h.user.id,'oai-authenticated-user-email':h.user.email,'X-Milo-Role':'regie'},status:401});
 assert.equal(await h.raw(),null);
});
test('revision CAS accepts one tab and refuses the stale tab without a provider call',async t=>{
 const h=await fixture(t);const responses=await Promise.all([key,replacement].map(value=>dispatchNodeRequest(h.request({action:'save',revision:null,...credentials,key:value}),{env:h.env,authClientFactory:auth(h.user),providerFetch:noProvider})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);const current=(await h.invoke()).data,before=await h.raw();await h.invoke({action:'remove',revision:null},{status:409});assert.deepEqual(await h.raw(),before);assert(current.keyConfigured);
});
test('domain test uses only the stored key and verified exact domain, never emails, and binds a redacted receipt',async t=>{
 const h=await fixture(t);let saved=(await h.invoke({action:'save',revision:null,...credentials})).data;const calls=[];
 saved=(await h.invoke({action:'test',revision:saved.revision},{providerFetch:async(url,options)=>{calls.push({url,options});return Response.json({data:[{id:'domain-id',name:'example.test',status:'verified'}],has_more:false});}})).data;
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.resend.com/domains?limit=100');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.headers.Authorization,'Bearer '+key);assert.equal(calls[0].options.redirect,'error');assert.equal(saved.connectionTest.tested,true);assert(saved.connectionTest.testedAt>0);assert.equal(saved.sendingAllowed,false);
 const before=await h.raw();await h.invoke({action:'test',revision:saved.revision,key:replacement},{status:400});assert.deepEqual(await h.raw(),before);
 saved=(await h.invoke({action:'save',revision:saved.revision,replyTo:'new@example.test'})).data;assert.equal(saved.connectionTest.tested,false);
});
test('bounded domain pagination verifies the exact sender domain and rejects unrelated verified domains',async t=>{
 const h=await fixture(t);let saved=(await h.invoke({action:'save',revision:null,...credentials})).data;const paths=[];
 saved=(await h.invoke({action:'test',revision:saved.revision},{providerFetch:async url=>{paths.push(url);return Response.json(paths.length===1?{data:[{id:'first-page-id',name:'unrelated.example.test',status:'verified'}],has_more:true}:{data:[{id:'match-id',name:'example.test',status:'verified'}],has_more:false});}})).data;
 assert.equal(saved.connectionTest.tested,true);assert.deepEqual(paths,['https://api.resend.com/domains?limit=100','https://api.resend.com/domains?limit=100&after=first-page-id']);
});
test('failed or malformed domain checks revoke the old green receipt without replacing credentials or revealing provider bodies',async t=>{
 const h=await fixture(t);let saved=(await h.invoke({action:'save',revision:null,...credentials})).data;
 for(const providerFetch of [async()=>new Response(key,{status:403}),async()=>new Response(replacement,{status:401}),async()=>Response.json({data:[{name:'example.test',status:'pending'}]}),async()=>Response.json({data:[]}),async()=>new Response('x'.repeat(66000)),async()=>{throw Error(key);}]){
  await h.invoke({action:'test',revision:saved.revision},{providerFetch,status:502});saved=(await h.invoke()).data;assert.equal(saved.connectionTest.tested,false);assert(saved.connectionTest.testedAt>0);assert.equal((await resendSettings(h.native())).value.key,key);
 }
});
test('remove leaves an encrypted tombstone blocking the DG fallback; only explicit environment restores that gateway',async t=>{
 const gateway={id:'existing-dg',send:noProvider},h=await fixture(t,{ORDER_MAIL_DELIVERY:gateway,MAIL_FROM:'legacy@example.test',MAIL_MODE:'allowlist',MAIL_ALLOWED_RECIPIENTS:'regie@example.test'});
 let saved=(await h.invoke({action:'save',revision:null,...credentials})).data;saved=(await h.invoke({action:'remove',revision:saved.revision})).data;
 assert.equal(saved.configured,false);assert.equal(saved.disabled,true);assert.equal(saved.environmentConfigured,true);assert.equal((await mailConfig(h.native())).delivery,null);const record=(await readPrivateSetting(h.env,'native-provider-resend')).value;assert.equal(record.mode,'disabled');assert(!('credentials'in record));
 saved=(await h.invoke({action:'environment',revision:saved.revision})).data;assert.equal(saved.route,'dg-gateway');assert.equal(saved.source,'environment');assert.equal(saved.keyConfigured,false);assert.equal((await mailConfig(h.native())).delivery,gateway);
});
test('corrupt settings and wrong master key fail closed without reactivating the environment gateway',async t=>{
 const h=await fixture(t,{ORDER_MAIL_DELIVERY:{send:noProvider}});await h.invoke({action:'save',revision:null,...credentials});h.env.VLAMPIE_SETTINGS_KEY='ff'.repeat(32);await h.invoke(undefined,{status:503});
 const request=new Request(origin+'/api/auth/session',{headers:{Origin:origin}});assert.equal((await dispatchNodeRequest(request,{env:h.env,authClientFactory:auth(h.user),providerFetch:noProvider})).status,200);
 const games=new Request(origin+'/api/bingo/games',{headers:{Origin:origin}});assert.equal((await dispatchNodeRequest(games,{env:h.env,authClientFactory:auth(h.user),providerFetch:noProvider})).status,200);
 const mail=new Request(origin+'/api/mail/state?brand=milo',{headers:{Origin:origin}});const response=await dispatchNodeRequest(mail,{env:h.env,authClientFactory:auth(h.user),providerFetch:noProvider});assert.equal(response.status,503);assert(!(await response.text()).includes(key));
});
test('role revocation during the provider queue is rechecked before a credential write',async t=>{
 const h=await fixture(t);let unlock,entered;const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{unlock=resolve;});
 const held=withProviderSettingsLock(h.native(),async()=>{entered();await gate;});await ready;
 const pending=dispatchNodeRequest(h.request({action:'save',revision:null,...credentials}),{env:h.env,authClientFactory:auth(h.user),providerFetch:noProvider});
 await h.env.DB.prepare('UPDATE app_user_roles SET role=? WHERE user_id=?').bind('player',h.user.id).run();unlock();await held;assert.equal((await pending).status,403);assert.equal(await h.raw(),null);
});
test('storage failure and cancelled requests preserve the previous key and never echo secret exception text',async t=>{
 const h=await fixture(t),saved=(await h.invoke({action:'save',revision:null,...credentials})).data,before=await h.raw(),put=h.env.SETTINGS.put;
 h.env.SETTINGS.put=async()=>{throw Error(replacement);};await h.invoke({action:'save',revision:saved.revision,key:replacement},{status:503});h.env.SETTINGS.put=put;assert.deepEqual(await h.raw(),before);
 const controller=new AbortController();controller.abort();const req=new Request(h.request({action:'save',revision:saved.revision,key:replacement}),{signal:controller.signal});assert.equal((await dispatchNodeRequest(req,{env:h.env,authClientFactory:auth(h.user),providerFetch:noProvider})).status,408);assert.deepEqual(await h.raw(),before);
});
test('a lost provider lock lease prevents any Resend credential write',async t=>{
 const h=await fixture(t),controller=new AbortController();h.env.DB={...h.env.DB,withObjectLock:async(_name,operation)=>{controller.abort();return operation({signal:controller.signal,deadline:Date.now()+120000});}};
 await h.invoke({action:'save',revision:null,...credentials},{status:503});assert.equal(await h.raw(),null);
});
