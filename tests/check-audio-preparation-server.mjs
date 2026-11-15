import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStorageEnvironment} from '../server/node-storage.js';
import {dispatchNodeRequest} from '../server/node-runtime.js';
import {handleOpenAI} from '../server/openai.js';
import {BingoStore} from '../server/bingo-store.js';
import {makeGame} from '../server/bingo-model.js';
import {CHARACTERS} from '../server/characters.js';
import {synthesizeLiveScript,ScriptSpeechError} from '../server/gpt-live.js';
import {voicePath} from '../server/voice-cache.js';
import {fakeLiveSocket} from '../scripts/gpt-live-fixture.mjs';

const origin='https://studio.example';
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'milo-audio-server-')),storage=await createStorageEnvironment({SQLITE_PATH:join(root,'app.sqlite'),OBJECT_STORAGE_PATH:join(root,'objects')});
 t.after(async()=>{await storage.close();await rm(root,{recursive:true,force:true});});
 const user={id:crypto.randomUUID(),email:'regie@example.test'},env={...storage,NODE_ENV:'production',APP_URL:origin,SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',VLAMPIE_SETTINGS_KEY:'01'.repeat(32),OPENAI_API_KEY:'synthetic-preparation-key-no-network'};
 await env.DB.prepare('INSERT INTO app_user_roles(user_id,role) VALUES (?,?)').bind(user.id,'regie').run();
 const store=new BingoStore(env.DB),game=makeGame({brandId:'milo',title:'Fictieve audiorepetitie',date:'2026-12-05T18:00:00Z'},user.id,origin);await store.create(game);
 const invoke=(route,body,{providerFetch=()=>assert.fail('Unexpected provider request'),signal,owner=user}={})=>dispatchNodeRequest(new Request(origin+'/api/openai/'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Vlampie-Settings':'1'},body:JSON.stringify(body),signal}),{env,providerFetch,authClientFactory:()=>({auth:{getUser:async()=>({data:{user:owner},error:null})}})});
 const speech=(text='Bernhard vijftien! Vijftien!')=>({gameId:game.id,characterId:'milo',speed:1,text});
 return {env,user,game,store,invoke,speech};
}

test('two regie tabs share one in-flight verified clip, then reuse the unchanged persistent cache',async t=>{
 const h=await fixture(t),entered=deferred(),release=deferred(),body=h.speech();let requests=0,puts=0;
 const put=h.env.SETTINGS.put.bind(h.env.SETTINGS);h.env.SETTINGS.put=async(...args)=>{if(args[0].startsWith('voice-cache/'))puts++;return put(...args);};
 const providerFetch=async()=>{requests++;entered.resolve();await release.promise;return fakeLiveSocket({text:body.text});};
 const first=h.invoke('speech',body,{providerFetch});await entered.promise;
 const second=h.invoke('speech',body,{providerFetch});await new Promise(resolve=>setTimeout(resolve,20));release.resolve();
 const responses=await Promise.all([first,second]);assert.deepEqual(responses.map(value=>value.status),[200,200]);assert.equal(requests,1);
 const bytes=await Promise.all(responses.map(value=>value.arrayBuffer()));assert.deepEqual(bytes[0],bytes[1]);assert(bytes[0].byteLength>48000);
 const clip=responses[0].headers.get('x-vlampie-clip');assert.match(clip,/^[a-f0-9]{64}$/);assert(await h.env.SETTINGS.head(voicePath(h.user.id,clip)));
 const cached=await h.invoke('speech',{...body,cacheOnly:true});assert.equal(cached.status,200);assert.equal(cached.headers.get('x-vlampie-cached'),'1');assert.equal(cached.headers.get('x-vlampie-clip'),clip);
 // Object storage metadata must retain transcript verification for OBS/readiness.
 const object=await h.env.SETTINGS.get(voicePath(h.user.id,clip));assert.equal(object.customMetadata.scriptVerified,'true');assert.equal(requests,1);
 assert.equal(puts,1);
});

test('credential rotation stays responsive during speech and old-key audio cannot enter the cache',async t=>{
 const h=await fixture(t),entered=deferred(),release=deferred(),body=h.speech();let requests=0,cacheWrites=0;
 const put=h.env.SETTINGS.put.bind(h.env.SETTINGS);h.env.SETTINGS.put=async(...args)=>{if(args[0]!== 'private/native-provider-openai.v1')cacheWrites++;return put(...args);};
 const first=h.invoke('speech',body,{providerFetch:async()=>{requests++;entered.resolve();await release.promise;return fakeLiveSocket({text:body.text});}});await entered.promise;
 const saved=await h.invoke('settings',{action:'save',revision:null,key:'sk-synthetic-new-key-'+ 'a'.repeat(32)});assert.equal(saved.status,200);assert.equal((await saved.json()).source,'regie');
 release.resolve();const response=await first;assert.equal(response.status,409);assert.equal((await response.json()).error.code,'provider_settings_changed');assert.equal(requests,1);assert.equal(cacheWrites,0);
});

test('a new credential revision cannot join an older request and the two active limit remains intact',async t=>{
 const h=await fixture(t),entered=deferred(),release=deferred(),body=h.speech();let requests=0;
 const providerFetch=async()=>{requests++;if(requests===2)entered.resolve();await release.promise;return fakeLiveSocket({text:body.text});};
 const first=h.invoke('speech',body,{providerFetch});
 // Wait for the first upstream operation before changing its settings revision.
 while(requests===0)await new Promise(resolve=>setImmediate(resolve));
 const saved=await h.invoke('settings',{action:'save',revision:null,key:'sk-synthetic-new-key-'+ 'b'.repeat(32)});assert.equal(saved.status,200);
 const second=h.invoke('speech',body,{providerFetch});await entered.promise;
 const busy=await h.invoke('speech',h.speech('Izaak zestien! Zestien!'));assert.equal(busy.status,429);assert.equal((await busy.json()).error.code,'busy');assert.equal(busy.headers.get('retry-after'),'2');
 release.resolve();const responses=await Promise.all([first,second]);assert.deepEqual(responses.map(value=>value.status),[409,200]);assert.equal(requests,2);
});

test('aborting the first shared request never caches partial audio; a later retry can prepare it',async t=>{
 const h=await fixture(t),entered=deferred(),release=deferred(),abort=new AbortController(),body=h.speech();let requests=0;
 const providerFetch=async()=>{requests++;entered.resolve();await release.promise;return fakeLiveSocket({text:body.text});};
 const first=h.invoke('speech',body,{providerFetch,signal:abort.signal});await entered.promise;
 const second=h.invoke('speech',body,{providerFetch});await new Promise(resolve=>setTimeout(resolve,20));abort.abort();release.resolve();
 const responses=await Promise.all([first,second]);assert.deepEqual(responses.map(value=>value.status),[408,408]);assert.equal(requests,1);
 const fresh=await h.invoke('speech',body,{providerFetch:async()=>{requests++;return fakeLiveSocket({text:body.text});}});assert.equal(fresh.status,200);assert.equal(requests,2);
});

test('different owners never share a preparation even with matching text, voice and provider credentials',async t=>{
 const h=await fixture(t),other={id:crypto.randomUUID(),email:'other@example.test'};
 await h.env.DB.prepare('INSERT INTO app_user_roles(user_id,role) VALUES (?,?)').bind(other.id,'regie').run();
 const game=makeGame({brandId:'milo',title:'Andere fictieve regie',date:'2026-12-05T18:00:00Z'},other.id,origin);await h.store.create(game);
 const entered=deferred(),release=deferred(),body=h.speech();let requests=0;
 const providerFetch=async()=>{if(++requests===2)entered.resolve();await release.promise;return fakeLiveSocket({text:body.text});};
 const first=h.invoke('speech',body,{providerFetch}),second=h.invoke('speech',{...body,gameId:game.id},{providerFetch,owner:other});await entered.promise;release.resolve();
 const responses=await Promise.all([first,second]);assert.deepEqual(responses.map(value=>value.status),[200,200]);assert.equal(requests,2);assert.notEqual(responses[0].headers.get('x-vlampie-clip'),responses[1].headers.get('x-vlampie-clip'));
});

test('GPT-Live timeouts, script mismatches and transport loss stay distinguishable without caching',async()=>{
 const text='Bernhard vijftien! Vijftien!',request=()=>new Request(origin);
 const quiet={webSocket:{accept(){},addEventListener(){},send(){},close(){}}};
 await assert.rejects(synthesizeLiveScript('synthetic-key',CHARACTERS.milo,text,request(),async()=>quiet,{scriptTimeoutMs:10}),error=>error instanceof ScriptSpeechError&&error.status===504&&error.code==='timeout'&&error.phase==='session_start');
 await assert.rejects(synthesizeLiveScript('synthetic-key',CHARACTERS.milo,text,request(),async()=>fakeLiveSocket({text:'Bernhard sixteen! Sixteen!'}),{scriptTimeoutMs:10}),error=>error.status===409&&error.code==='speech_script_mismatch');
 const listeners=new Map(),broken={webSocket:{accept(){},addEventListener(type,fn){listeners.set(type,fn);},send(raw){if(JSON.parse(raw).type==='session.start')queueMicrotask(()=>listeners.get('error')());},close(){}}};
 await assert.rejects(synthesizeLiveScript('synthetic-key',CHARACTERS.milo,text,request(),async()=>broken),error=>error.status===503&&error.code==='connection');
});

test('timeout phases distinguish handshake, missing transcript, missing audio, missing PCM silence and unconfirmed closure',async()=>{
 const text='Bernhard vijftien! Vijftien!';
 await assert.rejects(synthesizeLiveScript('synthetic-key',CHARACTERS.milo,text,new Request(origin),async()=>{throw new DOMException('synthetic deadline','TimeoutError');}),error=>error.status===504&&error.code==='timeout'&&error.phase==='handshake');
 for(const phase of ['transcript','audio','silence','close']){
  const listeners=new Map(),emit=data=>queueMicrotask(()=>listeners.get('message')?.({data:JSON.stringify(data)}));
  const socket={webSocket:{accept(){},addEventListener(type,fn){listeners.set(type,fn);},send(raw){if(JSON.parse(raw).type!=='session.start')return;emit({type:'session.started'});if(phase==='transcript')return;emit({type:'session.output_transcript.delta',delta:text});if(phase==='audio')return;emit({type:'session.output_audio.delta',delta:Buffer.from(new Int16Array(2400).fill(850).buffer).toString('base64')});if(phase==='close')emit({type:'session.output_audio.delta',delta:Buffer.from(new Int16Array(24000).buffer).toString('base64')});},close(){}}};
  await assert.rejects(synthesizeLiveScript('synthetic-key',CHARACTERS.milo,text,new Request(origin),async()=>socket,{scriptTimeoutMs:30,closeTimeoutMs:10}),error=>error.status===504&&error.code==='timeout'&&error.phase===phase);
 }
});

test('deadline treats a correct incomplete prefix as a timeout while rejecting an actual Dutch or English deviation',async()=>{
 for(const sample of [
  {text:'Bernhard vijftien! Vijftien!',transcript:'Bernhard vijftien!',status:504,code:'timeout'},
  {text:'Bernhard vijftien! Vijftien!',transcript:'Bernhard vij',status:504,code:'timeout'},
  {text:'Nummer 27. 27!',transcript:'Nummer zevenent',status:504,code:'timeout'},
  {text:'Bernhard vijftien! Vijftien!',transcript:'Bernhard fifteen!',status:409,code:'speech_script_mismatch'},
  {text:'Bernhard vijftien! Vijftien!',transcript:'Bernhard zestien!',status:409,code:'speech_script_mismatch'}
 ])await assert.rejects(synthesizeLiveScript('synthetic-key',CHARACTERS.milo,sample.text,new Request(origin),async()=>fakeLiveSocket({text:sample.transcript}),{scriptTimeoutMs:10}),error=>error.status===sample.status&&error.code===sample.code&&error.phase==='transcript');
});

test('a verified script finishing near its deadline retains its separate bounded close-confirmation budget',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const text='Bernhard vijftien! Vijftien!',listeners=new Map(),started=deferred();let closeRequests=0;
 const emit=data=>listeners.get('message')?.({data:JSON.stringify(data)}),socket={webSocket:{accept(){},addEventListener(type,fn){listeners.set(type,fn);},send(raw){const event=JSON.parse(raw);if(event.type==='session.start'){emit({type:'session.started'});started.resolve();}else if(event.type==='session.close')closeRequests++;},close(){}}};
 const pending=synthesizeLiveScript('synthetic-key',CHARACTERS.milo,text,new Request(origin),async()=>socket,{scriptTimeoutMs:40,closeTimeoutMs:20});await started.promise;
 t.mock.timers.tick(39);emit({type:'session.output_transcript.delta',delta:text});emit({type:'session.output_audio.delta',delta:Buffer.from(new Int16Array(2400).fill(850).buffer).toString('base64')});emit({type:'session.output_audio.delta',delta:Buffer.from(new Int16Array(24000).buffer).toString('base64')});assert.equal(closeRequests,1);
 // The old script deadline has passed, but 15 of the separate 20 close units
 // have elapsed. Success still requires an actual session.closed event.
 t.mock.timers.tick(15);emit({type:'session.closed'});const audio=await pending;assert.equal(new TextDecoder().decode(audio.slice(0,4)),'RIFF');assert(audio.length>48000);assert.equal(closeRequests,1);
});
test('a clean provider closure with a correct but cut-off Dutch ending is retryable truncation, never an accepted clip',async()=>{
 const listeners=new Map(),emit=data=>queueMicrotask(()=>listeners.get('message')?.({data:JSON.stringify(data)})),socket={webSocket:{accept(){},addEventListener(type,fn){listeners.set(type,fn);},send(raw){if(JSON.parse(raw).type!=='session.start')return;emit({type:'session.started'});emit({type:'session.output_transcript.delta',delta:'Bernhard vij'});emit({type:'session.closed'});},close(){}}};
 await assert.rejects(synthesizeLiveScript('synthetic-key',CHARACTERS.milo,'Bernhard vijftien!',new Request(origin),async()=>socket),error=>error.status===504&&error.code==='speech_truncated'&&error.phase==='transcript');
});

for(const route of ['speech','test'])test(`${route}: only an explicit temporary rate limit permits retries, never quota or credentials`,async t=>{
 const h=await fixture(t),body=route==='speech'?h.speech():{};
 for(const sample of [
  {status:429,code:'rate_limit_exceeded',type:'rate_limit_error',expected:'openai_rate_limit',retry:'9'},
  {status:429,code:'insufficient_quota',type:'rate_limit_error',expected:'openai_limit',retry:null},
  {status:429,code:'billing_hard_limit_reached',type:'rate_limit_error',expected:'openai_limit',retry:null},
  {status:429,code:'unknown_limit',type:'unknown_error',expected:'openai_limit',retry:null},
  {status:401,code:'invalid_api_key',type:'authentication_error',expected:'key_rejected',retry:null}
 ]){
  const response=await h.invoke(route,body,{providerFetch:async()=>Response.json({error:{code:sample.code,type:sample.type,message:'PRIVATE-UPSTREAM-TEXT-MUST-NOT-LEAK'}},{status:sample.status,headers:{'Retry-After':'9'}})}),json=await response.json();
  assert.equal(response.status,sample.status===401?502:429);assert.equal(json.error.code,sample.expected);assert.equal(response.headers.get('retry-after'),sample.retry);assert(!JSON.stringify(json).includes('PRIVATE-UPSTREAM'));assert.match(response.headers.get('cache-control'),/no-store/);
 }
});

test('a minute boundary resets the request budget without releasing active preparations',async t=>{
 const base=Date.now();let now=base;t.mock.method(Date,'now',()=>now);
 const entered=deferred(),release=deferred(),env={OPENAI_API_KEY:'synthetic-no-network',AUTH_IDENTITY:{user:crypto.randomUUID(),admin:true}};let requests=0;
 const request=(route,body)=>new Request(origin+'/api/openai/'+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const providerFetch=async()=>{if(++requests===2)entered.resolve();await release.promise;return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/mpeg'}});};
 const first=handleOpenAI(request('speech',{text:'Vijftien!'}),env,providerFetch),second=handleOpenAI(request('speech',{text:'Zestien!'}),env,providerFetch);await entered.promise;
 now=base+61000;const busy=await handleOpenAI(request('test',{}),env,()=>assert.fail('Active preparations must block this provider request'));assert.equal(busy.status,429);assert.equal((await busy.json()).error.code,'busy');assert.equal(busy.headers.get('retry-after'),'2');
 release.resolve();const responses=await Promise.all([first,second]);assert.deepEqual(responses.map(value=>value.status),[200,200]);assert.equal(requests,2);
});

test('upstream rate-limit inspection is bounded and unknown or oversized errors never become retryable',async()=>{
 const user=crypto.randomUUID(),env={OPENAI_API_KEY:'synthetic-no-network',AUTH_IDENTITY:{user,admin:true}};
 const request=()=>new Request(origin+'/api/openai/test',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
 for(const response of [new Response('x'.repeat(8192),{status:429,headers:{'Retry-After':'7'}}),new Response(null,{status:429}),Response.json({error:{code:'rate_limit_exceeded'}},{status:429,headers:{'Retry-After':'not-a-delay'}})]){
  const result=await handleOpenAI(request(),env,async()=>response),data=await result.json();
  assert.equal(result.status,429);assert.equal(data.error.code,response.headers.get('retry-after')==='not-a-delay'?'openai_rate_limit':'openai_limit');assert.equal(result.headers.get('retry-after'),response.headers.get('retry-after')==='not-a-delay'?'5':null);
 }
});

test('storage reads and ambiguous writes surface safe storage errors; a confirmed retry reuses any persisted clip',async t=>{
 const h=await fixture(t),get=h.env.SETTINGS.get.bind(h.env.SETTINGS),put=h.env.SETTINGS.put.bind(h.env.SETTINGS),body=h.speech();let requests=0;
 h.env.SETTINGS.get=async key=>{if(key.startsWith('voice-cache/'))throw Error('PRIVATE-STORAGE-URL-and-token');return get(key);};
 const unreadable=await h.invoke('speech',body);assert.equal(unreadable.status,503);assert.equal((await unreadable.json()).error.code,'cache_unavailable');
 h.env.SETTINGS.get=get;h.env.SETTINGS.put=async(...args)=>{const saved=await put(...args);if(args[0].startsWith('voice-cache/'))throw Error('PRIVATE-STORAGE-URL-and-token');return saved;};
 const ambiguous=await h.invoke('speech',body,{providerFetch:async()=>{requests++;return fakeLiveSocket({text:body.text});}}),error=await ambiguous.json();assert.equal(ambiguous.status,503);assert.equal(error.error.code,'cache_write_failed');assert.match(error.error.message,/opslagverbinding/);assert(!JSON.stringify(error).includes('PRIVATE-STORAGE'));
 h.env.SETTINGS.put=put;const retry=await h.invoke('speech',body);assert.equal(retry.status,200);assert.equal(retry.headers.get('x-vlampie-cached'),'1');assert.equal(requests,1);
});
