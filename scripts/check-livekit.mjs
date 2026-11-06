import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,jwtBody} from './live-calls-fixture.mjs';
import {livekitJwt,roomService,validateLivekit,livekitSettings} from '../server/livekit.js';
import {readPrivateSetting} from '../server/secrets.js';
import {handleLiveCalls as verifiedHandleLiveCalls} from '../server/live-calls.js';

test('JWTs are signed with project secret and room deletion uses the real roomCreate grant',async()=>{
 const settings={url:'wss://test-project.livekit.cloud',apiKey:'API_KEY_TEST',apiSecret:'PRIVATE_SECRET_FOR_TEST'};
 const token=await livekitJwt(settings,{sub:'opaque-uuid',video:{room:'room-uuid',roomJoin:true,canPublish:false}},{ttl:60,now:1000000});
 const [a,b,s]=token.split('.'),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(settings.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 assert(await crypto.subtle.verify('HMAC',key,Buffer.from(s,'base64url'),new TextEncoder().encode(a+'.'+b)));assert.equal(jwtBody(token).exp,1060);
 let request;await roomService(settings,'DeleteRoom',{room:'room-uuid'},async(url,options)=>{request={url,options};return Response.json({});});assert(request.url.endsWith('/twirp/livekit.RoomService/DeleteRoom'));assert.equal(jwtBody(request.options.headers.Authorization.slice(7)).video.roomCreate,true);
 for(const url of ['https://example.com','wss://localhost','wss://project.livekit.cloud.evil.test','wss://x.livekit.cloud:44','wss://x.livekit.cloud?secret=test'])assert.throws(()=>validateLivekit({...settings,url}));
});

test('LiveKit settings stay encrypted, blank secrets preserve credentials, tests contact real API and stale saves fail',async t=>{
 const h=await fixture(t),initial=await h.invoke('host',undefined,200,{path:'/api/livekit/settings'});assert(initial.configured);assert(!JSON.stringify(initial).includes('TEST_SECRET'));
 const checked=await h.invoke('host',{action:'test',revision:initial.revision,url:initial.url,apiKey:initial.apiKey,apiSecret:''},200,{path:'/api/livekit/settings'});assert(checked.tested);assert(checked.connectionTest.tested);assert(h.upstream.some(x=>x.url.endsWith('/ListRooms')));assert(![...h.files.values()].some(x=>x.data.includes('TEST_SECRET')));
 await h.invoke('host',{action:'save',revision:initial.revision},409,{path:'/api/livekit/settings'});await h.invoke('player',undefined,403,{path:'/api/livekit/settings'});
 await h.prepare();await h.invoke('host',{action:'save',revision:checked.revision,url:'wss://other-project.livekit.cloud',apiKey:checked.apiKey,apiSecret:'DIFFERENT_SECRET_123456'},409,{path:'/api/livekit/settings'});
});

test('only an opted-in family profile can run a short media-free preflight; ordinary viewers never join a call',async t=>{
 const h=await fixture(t);await h.invoke('player',{profileId:'not-my-child'},403,{path:'/api/livekit/preflight'});
 const result=await h.invoke('player',{profileId:'sophie'},200,{path:'/api/livekit/preflight'}),claims=jwtBody(result.token);assert.equal(result.target,'preflight');assert.equal(claims.video.canPublish,false);assert.equal(claims.video.canSubscribe,false);assert.equal(claims.exp-claims.iat,60);assert(!result.identity.includes('Sophie'));assert(!result.room.includes('family'));assert.equal((await h.bingo.game(h.game.id)).data.state.drawHold,undefined);assert(!h.upstream.some(x=>x.url.includes('openai')));
 await h.invoke('player',{profileId:'sophie'},429,{path:'/api/livekit/preflight'});await h.prepare();const outsider=await h.invoke('player',undefined,200,{user:'other-family'});assert.equal(outsider.call,null);await h.invoke('player',{callId:(await h.current()).id,target:'backstage'},403,{path:'/api/live-calls/token',user:'other-family'});
});

test('concurrent prepare requests select exactly one child and one durable hold',async t=>{
 const h=await fixture(t),requests=[1,2].map(()=>h.req('host',{action:'prepare',entryId:h.entryId}));
 const results=await Promise.all(requests.map(request=>handleLiveCalls(request,h.env,async()=>Response.json({}))));assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);assert.equal((await h.bingo.game(h.game.id)).data.state.drawHold.callId,(await h.current()).id);
});

test('a post-hold checkpoint-store failure retains a recoverable held call',async t=>{
 const h=await fixture(t),original=h.env.DB.prepare;let injected=false;
 h.env.DB.prepare=sql=>{const statement=original(sql);if(!sql.startsWith('UPDATE studio_calls'))return statement;const bind=statement.bind;statement.bind=(...args)=>{const bound=bind(...args),first=bound.first;bound.first=async()=>{if(!injected&&(await h.bingo.game(h.game.id)).data.state.drawHold){injected=true;throw Error('injected once');}return first();};return bound;};return statement;};
 await h.invoke('host',{action:'prepare',entryId:h.entryId},503);assert(injected);assert((await h.bingo.game(h.game.id)).data.state.drawHold);assert.equal((await h.current()).phase,'returning');assert.equal((await h.current()).drawHeld,true);
});

test('cancel during an in-flight AI creation retries a failed late hangup and never frees the draw hold',async t=>{
 t.mock.method(console,'warn',()=>{});
 const h=await fixture(t);await h.live();let entered,release,hangups=0;const waiting=new Promise(r=>entered=r);
 h.setUpstream(async(url,options)=>{if(url.includes('/twirp/'))return Response.json({});if(url.endsWith('/hangup')){hangups++;return new Response(null,{status:hangups<3?503:200});}if(url.endsWith('/attach'))return Response.json({error:{code:'unavailable'}},{status:503});entered();await new Promise(r=>release=r);return Response.json({session:{id:'live_late_owned_123'},transport:{sdp:'v=0\r\nanswer'}});});
 const pending=h.step('output',undefined,{sdp:'v=0\r\n'},409,{path:'/api/live-calls/realtime'});await waiting;await h.step('host','finish');assert.equal((await h.current()).resourcesClosed,false);release();await pending;let c=await h.current();assert.equal(c.realtimeId,'live_late_owned_123');assert.equal(c.resourcesClosed,false);assert((await h.bingo.game(h.game.id)).data.state.drawHold);
 await h.step('host','finish');c=await h.current();assert(hangups>=3);assert(c.resourcesClosed);assert.equal(c.phase,'returning');assert((await h.bingo.game(h.game.id)).data.state.drawHold);
});

function handleLiveCalls(request,env,...args){return verifiedHandleLiveCalls(request,verifiedTestEnvironment(request,env),...args);}

test('environment-managed LiveKit tests persist their revision without storing or exposing server credentials',async t=>{
 const h=await fixture(t);Object.assign(h.env,{LIVEKIT_URL:'wss://environment-project.livekit.cloud',LIVEKIT_API_KEY:'API_ENV_TEST_KEY',LIVEKIT_API_SECRET:'SERVER_ENV_SECRET_NOT_REAL_12345'});
 const path={path:'/api/livekit/settings'},initial=await h.invoke('host',undefined,200,path);
 assert.equal(initial.source,'environment');assert.equal(initial.canManage,false);assert.equal(initial.apiKey,'');assert.equal(initial.apiKeyConfigured,true);assert.equal(initial.secretConfigured,true);assert.equal(initial.connectionTest.tested,false);
 const tested=await h.invoke('host',{action:'test',revision:initial.revision},200,path);assert.equal(tested.tested,true);assert.equal(tested.connectionTest.tested,true);assert.notEqual(tested.revision,null);
 const reloaded=await h.invoke('host',undefined,200,path);assert.equal(reloaded.revision,tested.revision);assert.deepEqual(reloaded.connectionTest,tested.connectionTest);assert(!JSON.stringify(reloaded).includes(h.env.LIVEKIT_API_SECRET));assert(!JSON.stringify(reloaded).includes(h.env.LIVEKIT_API_KEY));
 const receipt=(await readPrivateSetting(h.env,'livekit-cloud-environment-test')).value;assert.deepEqual(Object.keys(receipt).sort(),['connectionTest','fingerprint']);assert.equal(typeof receipt.fingerprint,'string');
 await h.invoke('host',{action:'test',revision:initial.revision},409,path);
 await h.invoke('host',{action:'save',revision:tested.revision},403,path);
 await h.invoke('host',{action:'test',revision:tested.revision,url:'wss://other-project.livekit.cloud'},403,path);
 assert.equal(h.upstream.filter(x=>x.url.endsWith('/ListRooms')).length,1);
 assert(h.upstream.find(x=>x.url.endsWith('/ListRooms')).url.startsWith('https://environment-project.livekit.cloud/'));
 await h.prepare();assert.equal((await h.current()).phase,'preparing','Reloaded successful server test allows the real call preparation contract');
 h.env.LIVEKIT_API_SECRET='ROTATED_SERVER_ENV_SECRET_NOT_REAL_12345';const rotated=await livekitSettings(h.env);assert.equal(rotated.revision,tested.revision);assert.equal(rotated.value.connectionTest,null);
 h.env.LIVEKIT_API_SECRET='';const incomplete=await h.invoke('host',undefined,200,path);assert.equal(incomplete.configured,false);assert.equal(incomplete.source,'environment');assert.equal(incomplete.secretConfigured,false);await h.invoke('host',{action:'test',revision:incomplete.revision},503,path);assert.equal(h.upstream.filter(x=>x.url.endsWith('/ListRooms')).length,1);
});
