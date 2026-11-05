import test from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTERS,normaliseCharacterSettings,characterIdentity,liveVoice} from '../server/characters.js';
import {liveSession,createLivePeer,synthesizeLiveScript,normalizedScript} from '../server/gpt-live.js';
import {handleOpenAI as verifiedHandleOpenAI} from '../server/openai.js';
import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import {CharacterSettingsStore} from '../server/character-settings.js';
import {fixture} from './live-calls-fixture.mjs';
import {fakeLiveSocket} from './gpt-live-fixture.mjs';

const request=(route,body={},user='host',headers={})=>new Request('https://studio.example/api/openai/'+route,{method:'POST',headers:{origin:'https://studio.example','content-type':'application/json','X-Milo-Characters':'1','oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test',...headers},body:JSON.stringify(body)});
test('one saved custom voice serves scripted audio and spontaneous Live sessions without a TTS fallback',async()=>{
 const c=normaliseCharacterSettings('milo',{...CHARACTERS.milo,customVoiceId:'voice_milo_custom'}),session=liveSession(c);
 assert.deepEqual(session.audio.output.voice,liveVoice(c));assert.equal(session.model,'gpt-live-1');assert.equal(session.store,false);assert.equal(session.output_modalities,undefined);assert.equal(session.tools,undefined);
 assert.match(session.instructions,/Milo Magico/);assert.match(session.instructions,/bana(a)n/);assert.match(session.instructions,/geen.*adres/i);assert.match(session.instructions,/Verzin geen persoonlijke/);
 const audio=await synthesizeLiveScript('test-only-key',c,'Nummer 27. 27!',new Request('https://studio.example'),async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/live/sessions');assert.equal(options.headers.Upgrade,'websocket');
  return fakeLiveSocket({text:'Nummer zevenentwintig. Zevenentwintig!',onStart:cfg=>{assert.deepEqual(cfg.audio.output.voice,session.audio.output.voice);assert.equal(cfg.store,false);assert.equal(cfg.audio.format.rate,24000);}});
 });
 assert.equal(new TextDecoder().decode(audio.slice(0,4)),'RIFF');assert(audio.length>48000);
 assert.equal(normalizedScript('Tweeënzeventig!'),normalizedScript('72'));
});
test('incomplete or different script audio is rejected and the connection is closed',async()=>{
 const abort=new AbortController();let sends=0;
 const task=synthesizeLiveScript('test-key',CHARACTERS.milo,'Nummer 27.',new Request('https://studio.example',{signal:abort.signal}),async()=>{
  const result=fakeLiveSocket({text:'Nummer 28.'}),send=result.webSocket.send;result.webSocket.send=x=>{sends++;send(x);};return result;
 });
 setTimeout(()=>abort.abort(),20);await assert.rejects(task,/geannuleerd/);assert(sends>=2);
});
test('WebRTC uses JSON Live startup and returns the typed session id; rejected upstream never exposes keys',async()=>{
 const c=CHARACTERS.milo,key='test-only-private',result=await createLivePeer(key,'v=0\r\n',liveSession(c),async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/live/sessions');assert.equal(options.headers.Authorization,'Bearer '+key);
  const payload=JSON.parse(options.body);assert.equal(payload.transport.type,'webrtc');assert.equal(payload.transport.sdp,'v=0\r\n');assert.equal(payload.session.model,'gpt-live-1');
  return Response.json({session:{id:'live_verified_test'},transport:{sdp:'v=0\r\nanswer'}});
 });assert.equal(result.realtimeId,'live_verified_test');assert.equal(result.speechEngine,'gpt-live');
 await assert.rejects(createLivePeer(key,'v=0',liveSession(c),async()=>new Response(key,{status:403})),error=>!error.message.includes(key)&&error.message.includes('modeltoegang'));
});
test('invalid Live SDP answer closes an allocated session before reporting failure',async()=>{
 const calls=[];await assert.rejects(createLivePeer('test-key','v=0',liveSession(CHARACTERS.milo),async(url)=>{calls.push(url);return url.endsWith('/hangup')?new Response(null,{status:200}):Response.json({session:{id:'live_invalid_sdp'},transport:{sdp:'bad'}});}),/bevestigde sessie/);
 assert(calls.at(-1).endsWith('/live_invalid_sdp/hangup'));
});
test('voice design uses the saved prompt and revision, and persists the returned ID per character',async t=>{
 const h=await fixture(t);const response=await handleOpenAI(request('design-voice',{characterId:'milo',revision:0,voiceDescription:'UNTRUSTED OVERRIDE'}),h.env,async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/audio/voices');const body=JSON.parse(options.body);assert.equal(body.type,'prompt');assert.equal(body.prompt,CHARACTERS.milo.voiceDescription);assert(!body.prompt.includes('UNTRUSTED'));return Response.json({id:'voice_milo_designed',type:'prompt'});
 });assert.equal(response.status,200);const data=await response.json();assert.equal(data.character.customVoiceId,'voice_milo_designed');assert.equal(data.revision,1);
 const saved=await new CharacterSettingsStore(h.env.DB).read('host');assert.equal(saved.characters.find(c=>c.id==='milo').customVoiceId,'voice_milo_designed');assert.equal(saved.characters.find(c=>c.id==='stella').customVoiceId,'');
 const denied=()=>{throw Error('No upstream allowed');};assert.equal((await handleOpenAI(request('design-voice',{characterId:'milo',revision:0}),h.env,denied)).status,409);
 assert.equal((await handleOpenAI(request('design-voice',{characterId:'milo',revision:1},'host',{origin:'https://elsewhere.example'}),h.env,denied)).status,403);
});
test('extended character knowledge is durable and each caller gets only fresh verified context',async t=>{
 const h=await fixture(t),store=new CharacterSettingsStore(h.env.DB);await store.save('host','milo',{approvedMemories:'De hoed heet Hoedini.',conversationStyle:'Laat het kind uitpraten.',tricks:'Een banaan uit de hoed.'},0);
 const c=(await store.read('host')).characters.find(c=>c.id==='milo'),instructions=characterIdentity(c);assert.match(instructions,/Hoedini/);assert.match(instructions,/uitpraten/);assert.equal(c.memoryPolicy,'session');assert.equal(liveSession(c).store,false);
 assert.throws(()=>normaliseCharacterSettings('milo',{customVoiceId:'ElevenLabs-id'}),/OpenAI/);
});
test('microphone rehearsal owns its session and only its owner can close that allocated session',async t=>{
 const h=await fixture(t),calls=[];
 const upstream=async(url,options)=>{calls.push(url);return url.endsWith('/hangup')?new Response(null,{status:200}):Response.json({session:{id:'live_preview_owned'},transport:{sdp:'v=0\r\nanswer'}});};
 const start=await handleOpenAI(request('live-preview',{characterId:'milo',sdp:'v=0\r\n'}),h.env,upstream);assert.equal(start.status,200);assert.equal((await start.json()).speechEngine,'gpt-live');
 const before=calls.length,wrong=await handleOpenAI(request('live-preview-stop',{sessionId:'live_somebody_else'}),h.env,upstream);assert.equal(wrong.status,409);assert.equal(calls.length,before);
 const stop=await handleOpenAI(request('live-preview-stop',{sessionId:'live_preview_owned'}),h.env,upstream);assert.equal(stop.status,200);assert(calls.at(-1).endsWith('/live_preview_owned/hangup'));
});

test('voice design waits for a slow provider and retains its result beyond the old server deadline',async t=>{
 const h=await fixture(t);t.mock.timers.enable({apis:['setTimeout']});
 t.mock.method(AbortSignal,'timeout',ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('signal timed out','TimeoutError')),ms);return controller.signal;});
 let reached,requests=0;const ready=new Promise(resolve=>{reached=resolve;});
 const pending=handleOpenAI(request('design-voice',{characterId:'milo',revision:0}),h.env,async(url,options)=>{requests++;reached();return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});setTimeout(()=>resolve(Response.json({id:'voice_slow_saved'})),70000);});});
 await ready;t.mock.timers.tick(70000);const response=await pending;assert.equal(response.status,200);assert.equal((await response.json()).character.customVoiceId,'voice_slow_saved');assert.equal(requests,1);
});
test('unconfirmed voice design times out cleanly without a retry or changing the saved voice',async t=>{
 const h=await fixture(t);t.mock.timers.enable({apis:['setTimeout']});
 t.mock.method(AbortSignal,'timeout',ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('signal timed out','TimeoutError')),ms);return controller.signal;});
 let reached,requests=0;const ready=new Promise(resolve=>{reached=resolve;});
 const pending=handleOpenAI(request('design-voice',{characterId:'milo',revision:0}),h.env,async(url,options)=>{requests++;reached();return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));});
 await ready;t.mock.timers.tick(180000);const response=await pending,data=await response.json();assert.equal(response.status,502);assert.equal(data.error.code,'timeout');assert.match(data.error.message,/Herlaad eerst het profiel/);assert.equal(requests,1);
 const saved=await new CharacterSettingsStore(h.env.DB).read('host');assert.equal(saved.revision,0);assert.equal(saved.characters.find(c=>c.id==='milo').customVoiceId,'');
});

test('the owner can close the previous rehearsal after reload and a closed record never blocks the next test',async t=>{
 const h=await fixture(t),calls=[];let serial=0;
 const upstream=async url=>{calls.push(url);return url.endsWith('/hangup')?new Response(null,{status:200}):Response.json({session:{id:'live_recovery_'+(++serial)},transport:{sdp:'v=0\r\nanswer'}});};
 const start=()=>handleOpenAI(request('live-preview',{characterId:'milo',sdp:'v=0\r\n'}),h.env,upstream);
 assert.equal((await start()).status,200);
 const recovered=await handleOpenAI(request('live-preview-stop',{latest:true}),h.env,upstream);assert.equal(recovered.status,200);assert.equal((await recovered.json()).closed,true);
 const stored=JSON.parse(h.files.get('private/live-preview/host/live_recovery_1.json').data);assert(stored.closedAt);
 const count=calls.length;assert.equal((await handleOpenAI(request('live-preview-stop',{latest:true}),h.env,upstream)).status,200);assert.equal(calls.length,count,'confirmed closure is idempotent');
 assert.equal((await start()).status,200);assert.equal(calls.length,count+1,'next test must not hang up an already closed session');
 const newer=h.files.get('private/live-preview/host/latest.json').data;
 assert.equal((await handleOpenAI(request('live-preview-stop',{sessionId:'live_recovery_1'}),h.env,upstream)).status,200);assert.equal(h.files.get('private/live-preview/host/latest.json').data,newer,'an old window cannot erase a newer test');
});
test('previous-test recovery is owner-only, same-origin and creates no new session when nothing is open',async t=>{
 const h=await fixture(t);let calls=0;const upstream=()=>{calls++;throw Error('must not open a voice session');};
 assert.equal((await handleOpenAI(request('live-preview-stop',{latest:true}),h.env,upstream)).status,200);
 assert.equal((await handleOpenAI(request('live-preview-stop',{latest:true},'other'),h.env,upstream)).status,403);
 assert.equal((await handleOpenAI(request('live-preview-stop',{latest:true},'host',{origin:'https://elsewhere.example'}),h.env,upstream)).status,403);
 assert.equal((await handleOpenAI(request('live-preview-stop',{latest:true,sessionId:'live_foreign'}),h.env,upstream)).status,400);assert.equal(calls,0);
});
test('503 closure preserves the unconfirmed session and a user-initiated replacement can proceed',async t=>{
 const h=await fixture(t),id='live_unconfirmed';
 const seeded=JSON.stringify({id,characterId:'milo',createdAt:Date.now()-86400000});await h.env.SETTINGS.put('private/live-preview/host/latest.json',seeded);await h.env.SETTINGS.put('private/live-preview/host/'+id+'.json',seeded);
 let creations=0;const upstream=async url=>{if(url==='https://api.openai.com/v1/live/sessions'){creations++;return Response.json({session:{id:'live_replacement'},transport:{sdp:'v=0\r\nanswer'}});}return new Response(null,{status:503});};
 const response=await handleOpenAI(request('live-preview-stop',{latest:true}),h.env,upstream);assert.equal(response.status,503);const error=(await response.json()).error;assert.equal(error.code,'close_unavailable');assert.equal(error.diagnostic.attachStatus,503);assert.doesNotMatch(error.message,/Kies opnieuw/);
 let old=JSON.parse(h.files.get('private/live-preview/host/'+id+'.json').data);assert.equal(old.closeState,'unconfirmed');assert.equal(old.closedAt,undefined);assert.equal(creations,0,'stop must never create a replacement');
 const replacement=await handleOpenAI(request('live-preview',{characterId:'milo',sdp:'v=0\r\n',replacePrevious:true}),h.env,upstream);assert.equal(replacement.status,200);assert.equal((await replacement.json()).replacedPrevious,true);assert.equal(creations,1);
 old=JSON.parse(h.files.get('private/live-preview/host/'+id+'.json').data);assert.equal(old.closeState,'unconfirmed');assert.equal(old.closedAt,undefined);assert.equal(old.replacedBy,'live_replacement');assert.equal(JSON.parse(h.files.get('private/live-preview/host/latest.json').data).id,'live_replacement');
});

test('first start after reload can recover a stale 503 session without a permanent 409 loop',async t=>{
 const h=await fixture(t),id='live_stale';const record=JSON.stringify({id,characterId:'milo',createdAt:Date.now()-86400000});await h.env.SETTINGS.put('private/live-preview/host/latest.json',record);await h.env.SETTINGS.put('private/live-preview/host/'+id+'.json',record);let creations=0;
 const response=await handleOpenAI(request('live-preview',{characterId:'milo',sdp:'v=0\r\n'}),h.env,async url=>url.endsWith('/live/sessions')?(creations++,Response.json({session:{id:'live_fresh'},transport:{sdp:'v=0\r\nanswer'}})):new Response(null,{status:503}));
 assert.equal(response.status,200);assert.equal((await response.json()).replacedPrevious,true);assert.equal(creations,1);assert.equal(JSON.parse(h.files.get('private/live-preview/host/'+id+'.json').data).closedAt,undefined);
});

test('new-session service failures surface 503 separately and never overwrite the old recovery record',async t=>{
 const h=await fixture(t);const response=await handleOpenAI(request('live-preview',{characterId:'milo',sdp:'v=0\r\n'}),h.env,async()=>Response.json({error:{code:'server_is_overloaded',type:'service_unavailable_error'}},{status:503}));
 assert.equal(response.status,503);const error=(await response.json()).error;assert.equal(error.code,'live_unavailable');assert.match(error.message,/geen nieuwe testverbinding/);assert.equal(error.diagnostic.errorCode,'server_is_overloaded');assert.equal(h.files.has('private/live-preview/host/latest.json'),false);
});

test('invalid character and invalid SDP are rejected separately before any provider request',async t=>{
 const h=await fixture(t);const upstream=()=>{throw Error('invalid preview input must not reach the provider');};
 for(const characterId of [undefined,'undefined','unknown','__proto__']){const response=await handleOpenAI(request('live-preview',{characterId,sdp:'v=0\r\n'}),h.env,upstream);assert.equal(response.status,400);assert.equal((await response.json()).error.code,'invalid_character');}
 for(const sdp of [undefined,{},'not an SDP']){const response=await handleOpenAI(request('live-preview',{characterId:'milo',sdp}),h.env,upstream);assert.equal(response.status,400);assert.equal((await response.json()).error.code,'invalid_sdp');}
 const large=await handleOpenAI(request('live-preview',{characterId:'milo',sdp:'v=0'+'x'.repeat(30000)}),h.env,upstream);assert.equal(large.status,413);assert.equal((await large.json()).error.code,'sdp_too_large');
});

test('a terminal receipt is limited to the owner-bound local preview and is recorded as a client observation',async t=>{
 const h=await fixture(t),id='live_client_terminal';await h.env.SETTINGS.put('private/live-preview/host/'+id+'.json',JSON.stringify({id,characterId:'milo',createdAt:Date.now()}));
 const upstream=()=>{throw Error('an observed terminal event needs no provider retry');};
 assert.equal((await handleOpenAI(request('live-preview-stop',{sessionId:'foreign',closed:true}),h.env,upstream)).status,409);
 assert.equal((await handleOpenAI(request('live-preview-stop',{latest:true,closed:true}),h.env,upstream)).status,400);
 assert.equal((await handleOpenAI(request('live-preview-stop',{sessionId:id,closed:true}),h.env,upstream)).status,200);
 const record=JSON.parse(h.files.get('private/live-preview/host/'+id+'.json').data);assert(record.closedAt);assert(record.clientObservedClosedAt);assert.equal(record.closeConfirmation,'client_terminal');
});

function handleOpenAI(request,env,...args){return verifiedHandleOpenAI(request,verifiedTestEnvironment(request,env),...args);}
