import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStorageEnvironment,createPostgresDatabase} from '../server/node-storage.js';
import {dispatchNodeRequest} from '../server/node-runtime.js';
import {readSecret,saveSecret,readPrivateSetting,writePrivateSetting,saveNativeSecret} from '../server/secrets.js';
import {livekitSettings,livekitCredentialFingerprint} from '../server/livekit.js';
import {withProviderSettingsLock,reserveNativePreview,bindNativePreview} from '../server/node-provider-settings.js';
import {fixture as callFixture} from '../scripts/live-calls-fixture.mjs';
import {makeGame} from '../server/bingo-model.js';
import {BingoStore} from '../server/bingo-store.js';
import {Pool} from 'pg';
import {CallStore} from '../server/calls.js';

const origin='https://studio.example',key='sk-regie-'+ 'a'.repeat(32),replacement='sk-regie-'+ 'b'.repeat(32);
const livekit={url:'wss://regie-project.livekit.cloud',apiKey:'API_REGIE_TEST_KEY',apiSecret:'SYNTHETIC_REGIE_SECRET_12345'};
const environment={OPENAI_API_KEY:'sk-environment-'+ 'e'.repeat(32),LIVEKIT_URL:'wss://environment-project.livekit.cloud',LIVEKIT_API_KEY:'API_ENV_TEST_KEY',LIVEKIT_API_SECRET:'SYNTHETIC_ENVIRONMENT_SECRET_12345'};
const noProvider=()=>{throw Error('This test must not contact any provider');};
function auth(user){return ()=>({auth:{getUser:async()=>({data:{user},error:null})}});}
async function fixture(t,extra={}){
 const directory=await mkdtemp(join(tmpdir(),'milo-regie-provider-')),storage=await createStorageEnvironment({SQLITE_PATH:join(directory,'app.sqlite'),OBJECT_STORAGE_PATH:join(directory,'objects')});
 t.after(async()=>{await storage.close();await rm(directory,{recursive:true,force:true});});
 const user={id:crypto.randomUUID(),email:'regie@example.test'},env={NODE_ENV:'production',APP_URL:origin,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',VLAMPIE_SETTINGS_KEY:'01'.repeat(32),...storage,...extra};
 await env.DB.prepare('INSERT INTO app_user_roles (user_id,role) VALUES (?,?)').bind(user.id,'regie').run();
 const request=(path,body,headers={},method=body===undefined?'GET':'POST')=>new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Vlampie-Settings':'1','X-Vlampie-Call':'1','X-Milo-Characters':'1',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const invoke=async(path,body,{status=200,headers={},providerFetch=noProvider,providerUser=user}={})=>{const response=await dispatchNodeRequest(request(path,body,headers),{env,authClientFactory:auth(providerUser),providerFetch}),text=await response.text();assert.equal(response.status,status,text);assert.match(response.headers.get('cache-control'),/no-store/);for(const secret of [key,replacement,livekit.apiKey,livekit.apiSecret,...Object.values(environment).filter(value=>value.startsWith('sk-')||value.includes('SECRET'))])assert(!text.includes(secret),'provider responses must not contain credentials');return {data:text?JSON.parse(text):null,response};};
 return {env,user,invoke,request,native:()=>({...env,NATIVE_PROVIDER_SETTINGS:true})};
}

test('native status works without environment keys and ignores imported prototype credentials',async t=>{
 const h=await fixture(t);await saveSecret(h.env,key,null);await writePrivateSetting(h.env,'livekit-cloud',livekit,null);
 const openai=(await h.invoke('/api/openai/status')).data,media=(await h.invoke('/api/livekit/settings')).data;
 for(const status of [openai,media]){assert.equal(status.configured,false);assert.equal(status.source,'none');assert.equal(status.canManage,true);assert.equal(status.environmentConfigured,false);assert.equal(status.revision,null);}
 assert.equal((await readSecret(h.env)).key,key);assert.equal((await readPrivateSetting(h.env,'livekit-cloud')).value.apiSecret,livekit.apiSecret);
 const disabled=await fixture(t,{VLAMPIE_SETTINGS_KEY:''});assert.equal((await disabled.invoke('/api/openai/status')).data.canManage,false);assert.equal((await disabled.invoke('/api/livekit/settings')).data.canManage,false);
 await disabled.invoke('/api/openai/settings',{action:'save',revision:null,key},{status:503});
});

test('native save is encrypted, redacted and independent of provider tests; explicit overrides and fallback are reversible',async t=>{
 const h=await fixture(t,environment);
 assert.equal((await h.invoke('/api/openai/status')).data.source,'environment');assert.equal((await h.invoke('/api/livekit/settings')).data.canManage,true);
 let saved=(await h.invoke('/api/openai/settings',{action:'save',revision:null,key})).data;
 assert.equal(saved.source,'regie');assert.equal(saved.connectionTest.tested,false);assert.equal((await readSecret(h.native())).key,key);
 const encrypted=await h.env.SETTINGS.get('private/native-provider-openai.v1');assert(!JSON.stringify(await encrypted.json()).includes(key));
 const tested=(await h.invoke('/api/openai/settings',{action:'test',revision:saved.revision},{providerFetch:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/models');assert.equal(options.headers.Authorization,'Bearer '+key);return Response.json({data:[]});}})).data;
 assert.equal(tested.connectionTest.tested,true);saved=(await h.invoke('/api/openai/settings',{action:'save',revision:tested.revision,key})).data;assert.equal(saved.connectionTest.tested,false);
 const removed=(await h.invoke('/api/openai/settings',{action:'remove',revision:saved.revision})).data;assert.equal(removed.configured,false);assert.equal(removed.disabled,true);assert.equal(removed.environmentConfigured,true);assert.equal((await readSecret(h.native())).key,'');
 const fallback=(await h.invoke('/api/openai/settings',{action:'environment',revision:removed.revision})).data;assert.equal(fallback.source,'environment');assert.equal((await readSecret(h.native())).key,environment.OPENAI_API_KEY);
 let media=(await h.invoke('/api/livekit/settings',{action:'save',revision:null,...livekit})).data;assert.equal(media.source,'regie');assert.equal(media.apiKey,'');assert.equal(media.connectionTest.tested,false);
 media=(await h.invoke('/api/livekit/settings',{action:'test',revision:media.revision},{providerFetch:async url=>{assert(url.endsWith('/ListRooms'));return Response.json({rooms:[]});}})).data;assert.equal(media.connectionTest.tested,true);
 media=(await h.invoke('/api/livekit/settings',{action:'save',revision:media.revision,url:livekit.url,apiKey:'',apiSecret:''})).data;assert.equal(media.connectionTest.tested,false);assert.equal((await livekitSettings(h.native())).value.apiSecret,livekit.apiSecret);
 await h.invoke('/api/livekit/settings',{action:'save',revision:media.revision,url:'wss://different-project.livekit.cloud',apiKey:'',apiSecret:''},{status:400});
 await h.invoke('/api/livekit/settings',{action:'save',revision:media.revision,url:livekit.url,apiKey:'DIFFERENT_API_KEY',apiSecret:''},{status:400});
 media=(await h.invoke('/api/livekit/settings',{action:'remove',revision:media.revision})).data;assert.equal(media.configured,false);assert.equal(media.disabled,true);
 media=(await h.invoke('/api/livekit/settings',{action:'environment',revision:media.revision})).data;assert.equal(media.source,'environment');assert.equal((await livekitSettings(h.native())).value.apiSecret,environment.LIVEKIT_API_SECRET);
});

test('provider rejection or connection failure invalidates a receipt without replacing credentials',async t=>{
 const h=await fixture(t);let saved=(await h.invoke('/api/openai/settings',{action:'save',revision:null,key})).data;
 for(const providerFetch of [async()=>Response.json({error:{code:'invalid_key'}},{status:401}),async()=>{throw Error('synthetic connection failure');}]){
  await h.invoke('/api/openai/settings',{action:'test',revision:saved.revision},{status:502,providerFetch});saved=(await h.invoke('/api/openai/status')).data;assert.equal(saved.connectionTest.tested,false);assert.equal((await readSecret(h.native())).key,key);
 }
 let media=(await h.invoke('/api/livekit/settings',{action:'save',revision:null,...livekit})).data;
 await h.invoke('/api/livekit/settings',{action:'test',revision:media.revision},{status:502,providerFetch:async()=>new Response(null,{status:401})});media=(await h.invoke('/api/livekit/settings')).data;assert.equal(media.connectionTest.tested,false);assert.equal((await livekitSettings(h.native())).value.apiSecret,livekit.apiSecret);
});

test('verified organizer, same origin, custom header, CAS and fresh role after admission protect every native save',async t=>{
 const h=await fixture(t),body={action:'save',revision:null,key};
 for(const options of [{headers:{Origin:'https://attacker.example'}},{headers:{'X-Vlampie-Settings':''}},{headers:{'X-Vlampie-Player':'1'}},{providerUser:{id:'player',email:'regie@example.test',user_metadata:{role:'regie'}}}])await h.invoke('/api/openai/settings',body,{...options,status:403});
 await h.invoke('/api/openai/settings',body,{providerUser:null,status:401,headers:{'oai-authenticated-user-id':h.user.id}});
 await h.invoke('/api/livekit/settings',{action:'save',revision:null,...livekit},{providerUser:{id:'player',email:'regie@example.test'},status:403});
 const results=await Promise.all([key,replacement].map(value=>dispatchNodeRequest(h.request('/api/openai/settings',{...body,key:value}),{env:h.env,authClientFactory:auth(h.user),providerFetch:noProvider})));assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
 assert.equal(await saveNativeSecret(h.native(),{mode:'regie',key:replacement},null),null,'storage CAS remains authoritative');
 const revision=(await h.invoke('/api/openai/status')).data.revision;let release,admitted;const entered=new Promise(resolve=>admitted=resolve),held=withProviderSettingsLock(h.native(),async()=>{admitted();await new Promise(resolve=>release=resolve);});await entered;
 let firstAuth;const checked=new Promise(resolve=>firstAuth=resolve);const factory=()=>({auth:{getUser:async()=>{firstAuth();return {data:{user:h.user},error:null};}}});
 const pending=dispatchNodeRequest(h.request('/api/openai/settings',{action:'save',revision,key}),{env:h.env,authClientFactory:factory,providerFetch:noProvider});await checked;
 await h.env.DB.prepare("UPDATE app_user_roles SET role='player' WHERE user_id=?").bind(h.user.id).run();release();await held;assert.equal((await pending).status,403);assert.equal((await readSecret(h.native())).revision,revision);
});

test('both provider rotations reject another organizer active call, failed cleanup and orphan draw hold without mutation',async t=>{
 const h=await fixture(t,environment),call={transport:'livekit',phase:'live',id:'owned-call',resourcesClosed:false};
 await h.env.DB.prepare('INSERT INTO studio_calls (owner_id,game_id,revision,document) VALUES (?,?,0,?)').bind('other-regie','game',JSON.stringify(call)).run();
 const blocked=async()=>{await h.invoke('/api/openai/settings',{action:'save',revision:null,key},{status:409});await h.invoke('/api/livekit/settings',{action:'save',revision:null,...livekit},{status:409});};await blocked();
 call.phase='completed';await h.env.DB.prepare('UPDATE studio_calls SET document=?').bind(JSON.stringify(call)).run();await blocked();
 call.resourcesClosed=true;await h.env.DB.prepare('UPDATE studio_calls SET document=?').bind(JSON.stringify(call)).run();
 await h.env.DB.prepare('INSERT INTO bingo_games (id,owner_id,revision,document,updated_at) VALUES (?,?,0,?,0)').bind('game','other-regie',JSON.stringify({state:{drawHold:{callId:'owned-call'}}})).run();await blocked();
 assert.equal(await h.env.SETTINGS.get('private/native-provider-openai.v1'),null);assert.equal(await h.env.SETTINGS.get('private/native-provider-livekit.v1'),null);
});

test('corrupt or unreadable native overrides fail closed and never expose or silently restore environment credentials',async t=>{
 for(const provider of ['openai','livekit'])for(const corrupt of [null,false,{version:1,mode:'unknown'}]){
  const h=await fixture(t,environment);await writePrivateSetting(h.env,'native-provider-'+provider,corrupt,null);
  await h.invoke(provider==='openai'?'/api/openai/status':'/api/livekit/settings',undefined,{status:503});
 }
 const h=await fixture(t,environment);await h.invoke('/api/openai/settings',{action:'save',revision:null,key});h.env.VLAMPIE_SETTINGS_KEY='ff'.repeat(32);await h.invoke('/api/openai/status',undefined,{status:503});
});

test('durable preview ledger survives role deletion and missing latest pointer',async t=>{
 const h=await fixture(t,environment),other='former-regie',id=await reserveNativePreview(h.native(),other,'synthetic-fingerprint');await bindNativePreview(h.native(),id,'orphaned-session');
 await h.invoke('/api/openai/settings',{action:'save',revision:null,key},{status:409});
 const pending=await readPrivateSetting(h.env,'native-provider-preview-resources');assert.equal(pending.value.entries.length,1);assert.equal(pending.value.entries[0].ownerId,other);
});

test('failed latest write plus rejected hangup stays registered and blocks both credential rotations',async t=>{
 t.mock.method(console,'warn',()=>{});const h=await fixture(t,environment),original=h.env.SETTINGS.put.bind(h.env.SETTINGS);let sessionCreated=false;
 h.env.SETTINGS.put=async(path,...args)=>{if(path.endsWith('/latest.json'))throw Error('synthetic latest failure');return original(path,...args);};
 const providerFetch=async url=>{if(url.endsWith('/live/sessions')){sessionCreated=true;return Response.json({session:{id:'orphaned-native-preview'},transport:{sdp:'v=0\r\nanswer'}});}return Response.json({error:{code:'unavailable'}},{status:503});};
 await h.invoke('/api/openai/live-preview',{characterId:'milo',sdp:'v=0\r\n'},{status:503,providerFetch});assert.equal(sessionCreated,true);
 await h.env.DB.prepare('DELETE FROM app_user_roles WHERE user_id=?').bind(h.user.id).run();const second={id:crypto.randomUUID(),email:'second@example.test'};await h.env.DB.prepare('INSERT INTO app_user_roles (user_id,role) VALUES (?,?)').bind(second.id,'regie').run();
 await h.invoke('/api/openai/settings',{action:'save',revision:null,key},{status:409,providerUser:second});await h.invoke('/api/livekit/settings',{action:'save',revision:null,...livekit},{status:409,providerUser:second});
 await h.env.DB.prepare('INSERT INTO app_user_roles (user_id,role) VALUES (?,?)').bind(h.user.id,'regie').run();h.env.SETTINGS.put=original;
 await h.invoke('/api/openai/live-preview-stop',{latest:true},{providerFetch:async()=>new Response(null,{status:200})});
 assert.equal((await readPrivateSetting(h.env,'native-provider-preview-resources')).value.entries.length,0);await h.invoke('/api/openai/settings',{action:'save',revision:null,key});
});

test('native start lock never delays parental withdrawal and late provider resources are closed with their original key',async t=>{
 t.mock.method(console,'warn',()=>{});const h=await callFixture(t);await h.live();
 h.db.exec("CREATE TABLE app_user_roles (user_id TEXT PRIMARY KEY,role TEXT NOT NULL); INSERT INTO app_user_roles VALUES ('host','regie'),('family','player')");
 const settings=(await readPrivateSetting(h.env,'livekit-cloud')).value;Object.assign(h.env,{NODE_ENV:'production',APP_URL:origin,SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',LIVEKIT_URL:settings.url,LIVEKIT_API_KEY:settings.apiKey,LIVEKIT_API_SECRET:settings.apiSecret});
 let started,release,hangups=0;const entered=new Promise(resolve=>started=resolve),providerFetch=async(url,options)=>{if(url.includes('/twirp/'))return Response.json({});if(url.endsWith('/hangup')){hangups++;assert.equal(options.headers.Authorization,'Bearer '+h.env.OPENAI_API_KEY);return new Response(null,{status:200});}started();await new Promise(resolve=>release=resolve);return Response.json({session:{id:'late-native-call'},transport:{sdp:'v=0\r\nanswer'}});};
 const current=await h.current(),pending=dispatchNodeRequest(h.req('output',{callId:current.id,sdp:'v=0\r\n'},{path:'/api/live-calls/realtime'}),{env:h.env,authClientFactory:auth({id:'host',email:'host@example.test'}),providerFetch});await entered;
 let timer;const withdrawn=await Promise.race([dispatchNodeRequest(h.req('player',{action:'withdraw-consent',callId:current.id}),{env:h.env,authClientFactory:auth({id:'family',email:'parent@example.test'}),providerFetch}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('withdrawal queued behind provider start')),1000);})]);clearTimeout(timer);assert.equal(withdrawn.status,200);assert.equal((await h.current()).muted,true);assert((await h.bingo.game(h.game.id)).data.state.drawHold);
 release();assert.equal((await pending).status,409);assert(hangups>=1);assert.equal((await h.current()).resourcesClosed,true);assert((await h.bingo.game(h.game.id)).data.state.drawHold);
});

test('native legacy hangup failure preserves hold and blocks rotation until confirmed retry',async t=>{
 const h=await fixture(t,environment),gameId=crypto.randomUUID(),clientId=crypto.randomUUID(),call={id:'legacy-call',gameId,phase:'ended',realtimeId:'legacy-owned-session',hangupAttempted:'old-unconfirmed-attempt'};
 const originalGame=makeGame({title:'Legacy cleanup proof',date:'2026-11-18T12:00:00Z'},h.user.id,origin);originalGame.id=gameId;originalGame.state.callId=call.id;await new BingoStore(h.env.DB).create(originalGame);
 await h.env.DB.prepare('INSERT INTO studio_calls (owner_id,game_id,revision,document) VALUES (?,?,0,?)').bind(h.user.id,gameId,JSON.stringify(call)).run();
 const path='/api/calls?'+new URLSearchParams({role:'host',clientId,gameId});await h.invoke(path,undefined,{providerFetch:async()=>new Response(null,{status:503})});await h.invoke('/api/openai/settings',{action:'save',revision:null,key},{status:409});
 let game=JSON.parse((await h.env.DB.prepare('SELECT document FROM bingo_games WHERE id=?').bind(gameId).first()).document);assert.equal(game.state.callId,call.id);
 await h.invoke(path,undefined,{providerFetch:async()=>new Response(null,{status:200})});game=JSON.parse((await h.env.DB.prepare('SELECT document FROM bingo_games WHERE id=?').bind(gameId).first()).document);assert.equal(game.state.callId,null);await h.invoke('/api/openai/settings',{action:'save',revision:null,key});
});

test('late native cleanup cannot mutate a replacement call or clear its new show hold',async t=>{
 const h=await fixture(t,environment),store=new CallStore(h.env.DB),clientId=crypto.randomUUID(),oldGame=makeGame({title:'Previous call',date:'2026-11-18T12:00:00Z'},h.user.id,origin),newGame=makeGame({title:'Next call',date:'2026-11-19T12:00:00Z'},h.user.id,origin);
 const oldCall={id:'old-cleanup-target',gameId:oldGame.id,phase:'ended',realtimeId:'old-cleanup-provider-session',entryId:'old-entry',realtimeStarted:true,resourcesClosed:false};oldGame.state.callId=oldCall.id;oldGame.participation=[{id:'old-entry',callId:oldCall.id,callStatus:'accepted'}];await new BingoStore(h.env.DB).create(oldGame);await store.create(h.user.id,oldGame.id,oldCall);
 let now=Date.now();t.mock.method(Date,'now',()=>now);let entered,release;const started=new Promise(resolve=>entered=resolve),path='/api/calls?'+new URLSearchParams({role:'host',clientId,gameId:oldGame.id});
 const first=h.invoke(path,undefined,{providerFetch:async()=>{entered();await new Promise(resolve=>release=resolve);return new Response(null,{status:200});}});await started;
 now+=10001;await h.invoke(path,undefined,{providerFetch:async()=>new Response(null,{status:200})});assert.equal((await store.get(h.user.id)).data.realtimeStopped,true,'The second cleanup legitimately confirms the old session after its claim lease expires');
 const next={id:'new-confirmed-call',gameId:newGame.id,phase:'checking',entryId:'new-entry',name:'New participant'};newGame.state.callId=next.id;newGame.participation=[{id:'new-entry',callId:next.id,callStatus:'accepted'}];await new BingoStore(h.env.DB).create(newGame);await store.create(h.user.id,newGame.id,next,{requireConfirmedCleanup:true});
 const beforeCall=await store.get(h.user.id),beforeGame=await h.env.DB.prepare('SELECT document FROM bingo_games WHERE id=?').bind(newGame.id).first();release();await first;
 assert.deepEqual(await h.env.DB.prepare('SELECT document FROM bingo_games WHERE id=?').bind(newGame.id).first(),beforeGame,'Late old cleanup must not clear the new hold or finish the new participation entry');assert.deepEqual(await store.get(h.user.id),beforeCall,'Even the replacement call revision remains unchanged');
});

test('microphone stop during a blocked native preview start returns promptly and closes the late session',async t=>{
 const h=await fixture(t,environment);let started,release,hangups=0;const entered=new Promise(resolve=>started=resolve),providerFetch=async url=>{if(url.endsWith('/hangup')){hangups++;return new Response(null,{status:200});}started();await new Promise(resolve=>release=resolve);return Response.json({session:{id:'cancelled-native-preview'},transport:{sdp:'v=0\r\nanswer'}});};
 const pending=h.invoke('/api/openai/live-preview',{characterId:'milo',sdp:'v=0\r\n'},{status:409,providerFetch});await entered;
 let timer;const stop=await Promise.race([h.invoke('/api/openai/live-preview-stop',{latest:true},{providerFetch}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('stop queued behind preview start')),1000);})]);clearTimeout(timer);assert.equal(stop.data.pending,true);assert.equal(stop.data.closed,false);
 release();await pending;assert.equal(hangups,1);assert.equal((await readPrivateSetting(h.env,'native-provider-preview-resources')).value.entries.length,0);await h.invoke('/api/openai/settings',{action:'save',revision:null,key});
});

test('native legacy and LiveKit prepare cannot replace an unconfirmed terminal session; confirmed cleanup allows replacement',async t=>{
 const h=await callFixture(t),oldGame=makeGame({brandId:'milo',title:'Previous provider cleanup',date:'2026-11-18T12:00:00Z'},'host',origin);oldGame.status='running';await h.bingo.create(oldGame);
 const previous={id:'unconfirmed-legacy-session',gameId:oldGame.id,phase:'ended',realtimeId:'old-provider-session',realtimeStarted:true,resourcesClosed:false,hangupAttempted:'not-proof'};
 await h.calls.create('host',oldGame.id,previous);const before=await h.calls.get('host');
 await assert.rejects(h.calls.create('host',h.game.id,{id:'replacement',gameId:h.game.id,phase:'checking'},{requireConfirmedCleanup:true}),error=>error.status===409);assert.deepEqual(await h.calls.get('host'),before);
 const credentials=(await readPrivateSetting(h.env,'livekit-cloud')).value;h.env.NATIVE_PROVIDER_SETTINGS=true;
 await writePrivateSetting(h.env,'native-provider-livekit',{version:1,mode:'regie',credentials:{url:credentials.url,apiKey:credentials.apiKey,apiSecret:credentials.apiSecret},fingerprint:await livekitCredentialFingerprint(credentials),connectionTest:{tested:true,testedAt:Date.now()}},null);
 await h.invoke('host',{action:'prepare',entryId:h.entryId},409);assert.deepEqual(await h.calls.get('host'),before);assert.equal((await h.bingo.game(h.game.id)).data.state.drawHold,undefined);
 await h.calls.mutate('host',current=>({...current,realtimeStopped:true,resourcesClosed:true}));await h.prepare();assert.notEqual((await h.current()).id,previous.id);assert.equal((await h.current()).transport,'livekit');
});

test('a slow or aborted provider body holds no credential lock and oversized input cannot mutate credentials',async t=>{
 const h=await fixture(t),controller=new AbortController();let reading;
 const started=new Promise(resolve=>reading=resolve),stream=new ReadableStream({pull(){reading();return new Promise(()=>{});}});
 const request=new Request(origin+'/api/openai/settings',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Vlampie-Settings':'1'},body:stream,duplex:'half',signal:controller.signal});
 const pending=dispatchNodeRequest(request,{env:h.env,authClientFactory:auth(h.user),providerFetch:noProvider});await started;
 const saved=(await h.invoke('/api/openai/settings',{action:'save',revision:null,key})).data;assert(saved.revision);controller.abort();assert.equal((await pending).status,408);
 const excessive=new Request(origin+'/api/openai/settings',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Vlampie-Settings':'1'},body:'x'.repeat(40001)});
 assert.equal((await dispatchNodeRequest(excessive,{env:h.env,authClientFactory:auth(h.user),providerFetch:noProvider})).status,413);assert.equal((await readSecret(h.native())).revision,saved.revision);
});

test('a lost native PostgreSQL lock lease prevents credential persistence',async t=>{
 const h=await fixture(t),controller=new AbortController();controller.abort();
 const DB={...h.env.DB,withObjectLock:async(_key,operation)=>operation({signal:controller.signal,deadline:Date.now()+120000})};
 await assert.rejects(withProviderSettingsLock({...h.native(),DB},locked=>saveNativeSecret(locked,{mode:'regie',key},null)),error=>error.status===503&&error.code==='settings_lock_lost');assert.equal(await h.env.SETTINGS.get('private/native-provider-openai.v1'),null);
});

test('PostgreSQL lock serializes adapters while the local FIFO consumes only one lock admission', {skip:!process.env.MILO_TEST_DATABASE_URL},async t=>{
 const url=new URL(process.env.MILO_TEST_DATABASE_URL);assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&/test/i.test(url.pathname),'Provider lock integration requires an explicitly local test database');
 const admin=new Pool({connectionString:url.toString()}),name='milo_provider_lock_test_'+crypto.randomUUID().replaceAll('-','');let first,second,source,created=false;
 t.after(async()=>{await first?.close();await second?.close();await source?.end();try{if(created)await admin.query('DROP DATABASE "'+name+'"');}finally{await admin.end();}});
 await admin.query('CREATE DATABASE "'+name+'"');created=true;url.pathname='/'+name;source=new Pool({connectionString:url.toString()});await source.query('CREATE TABLE bingo_games (id text PRIMARY KEY)');
 first=await createPostgresDatabase(url.toString(),{allowLoopback:true});second=await createPostgresDatabase(url.toString(),{allowLoopback:true});
 const wrap=DB=>({DB,NATIVE_PROVIDER_SETTINGS:true});let release,entered,active=0,maxActive=0;const started=new Promise(resolve=>entered=resolve);
 const owner=withProviderSettingsLock(wrap(first),async env=>{assert(env.PROVIDER_SETTINGS_DEADLINE>Date.now());active++;maxActive=Math.max(maxActive,active);entered();await new Promise(resolve=>release=resolve);active--;});await started;
 let completed=0;const waiting=Array.from({length:12},(_,i)=>withProviderSettingsLock(wrap(i%2?first:second),async()=>{active++;maxActive=Math.max(maxActive,active);assert.equal((await first.prepare('SELECT 1 AS ok').first()).ok,1);completed++;active--;}));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(completed,0);release();await Promise.all([owner,...waiting]);assert.equal(completed,12);assert.equal(maxActive,1);
});
