// Local SQLite/CAS, playback and provider-stub regressions. No real calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './live-calls-fixture.mjs';
import {handleOutput} from '../server/output.js';
import {OutputBridge} from '../public/output-bridge.js';
import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import {confirmedCallFacts} from '../server/live-call-model.js';
import {handleOpenAI} from '../server/openai.js';
import {GAME_EVENT_LIMIT,GAME_CORE_EVENT_RESERVE} from '../server/game-capacity.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('atomic hold/call batch stays invisible before commit; an earlier ball wins CAS and joins checkpoint',async t=>{
 const h=await fixture(t),entered=deferred(),gate=deferred(),original=h.env.DB.batch;let gated=false;
 h.env.DB.batch=async statements=>{if(!gated&&statements.some(s=>s.sql.startsWith('UPDATE studio_calls'))){gated=true;entered.resolve();await gate.promise;}return original(statements);};
 const preparing=h.prepare();await entered.promise;assert.equal(await h.current(),null);assert.equal((await h.invoke('player')).call,null);await h.invoke('host',{action:'ring'},409);
 await h.bingo.mutate(h.game.id,{},game=>{game.state.drawn.push(41);game.state.lastCommit={number:41};});gate.resolve();await preparing;
 const call=await h.current(),game=(await h.bingo.game(h.game.id)).data;assert.equal(call.holdConfirmed,true);assert.equal(call.checkpoint.lastNumber,41);assert.deepEqual(call.checkpoint.drawn,game.state.drawn);assert.equal(game.state.drawHold.callId,call.id);assert.equal(h.upstream.length,0);
});

test('failure between the two writes rolls back both hold and call and never opens media',async t=>{
 const h=await fixture(t),original=h.env.DB.batch;let failed=false;
 h.env.DB.batch=async statements=>{if(!failed&&statements.some(s=>s.sql.startsWith('UPDATE studio_calls'))){failed=true;h.db.exec('BEGIN');try{const first=statements[0];h.db.prepare(first.sql).all(...first.args);throw Error('injected failure after hold write');}finally{h.db.exec('ROLLBACK');}}return original(statements);};
 await h.invoke('host',{action:'prepare',entryId:h.entryId},503);assert.equal(await h.current(),null);assert.equal((await h.bingo.game(h.game.id)).data.state.drawHold,undefined);assert.equal(h.upstream.length,0);
});

test('atomic call preparation preserves the shared game history capacity reserve',async t=>{
 const h=await fixture(t);await h.bingo.mutate(h.game.id,{},game=>{game.events=Array.from({length:GAME_EVENT_LIMIT-GAME_CORE_EVENT_RESERVE},()=>({type:'fixture-history',at:1}));});
 await h.invoke('host',{action:'prepare',entryId:h.entryId},409);assert.equal(await h.current(),null);assert.equal((await h.bingo.game(h.game.id)).data.state.drawHold,undefined);assert.equal(h.upstream.length,0);
});

test('late provider creation after cancellation is hung up and never returns SDP or resumes drawing',async t=>{
 const h=await fixture(t);await h.live();const gate=deferred(),entered=deferred();let hangups=0,sentCorrelation;
 h.setUpstream(async (url,options)=>{if(url==='https://api.openai.com/v1/live/sessions'){sentCorrelation=options.headers['X-Client-Request-Id'];entered.resolve();await gate.promise;return Response.json({session:{id:'live_late_fixture'},transport:{sdp:'v=0\r\nanswer'}});}if(url.endsWith('/hangup'))hangups++;return Response.json({});});
 const starting=h.step('output',undefined,{sdp:'v=0\r\n'},409,{path:'/api/live-calls/realtime'});await entered.promise;
 const reservation=(await h.current()).realtimeStart;assert.equal(sentCorrelation,reservation.id);assert(reservation.expiresAt-reservation.createdAt<=30001);
 await h.step('host','cancel');assert.equal((await h.current()).resourcesClosed,false);gate.resolve();const result=await starting;assert.equal(result.sdp,undefined);assert(hangups>0);assert.equal((await h.current()).resourcesClosed,true);assert((await h.bingo.game(h.game.id)).data.state.drawHold);
});

test('expired unknown orphan stays explicitly uncertain; closing an unrelated session cannot release the hold',async t=>{
 const h=await fixture(t);await h.live();await h.calls.mutate('host',call=>{call.realtimeStatus='starting';call.realtimeStart={id:crypto.randomUUID(),createdAt:Date.now()-40000,expiresAt:Date.now()-1000};return call;});
 const polled=await h.invoke('host');assert.equal(polled.call.recoveryStatus,'manual-reconciliation');assert.equal(polled.call.phase,'returning');assert.equal(polled.call.resourcesClosed,false);
 await h.step('output',undefined,{},409,{path:'/api/live-calls/realtime-stop'});await h.step('host','confirm-return',{confirmed:true,manual:true,note:'Ouder heeft actuele beeldcue en laatste bal gecontroleerd.'});await h.step('host','resume-draw',{},409);
 await h.step('host','reconcile',{sessionId:'live_unrelated_fixture'},409);assert.equal((await h.current()).resourcesClosed,false);await h.step('host','resume-draw',{},409);assert((await h.bingo.game(h.game.id)).data.state.drawHold);
});

test('provider timeout remains uncertain and rotated credentials cannot falsely close the orphan',async t=>{
 const h=await fixture(t);await h.live();let requests=0;h.setUpstream(async url=>{requests++;if(url==='https://api.openai.com/v1/live/sessions')throw Error('injected transport timeout');return Response.json({});});
 await h.step('output',undefined,{sdp:'v=0\r\n'},503,{path:'/api/live-calls/realtime'});assert.equal((await h.current()).realtimeStatus,'uncertain');assert.equal((await h.current()).resourcesClosed,false);
 await h.calls.mutate('host',call=>{call.realtimeId='live_orphan_fixture';return call;});h.env.OPENAI_API_KEY='rotated-fixture-key';const before=requests;await h.step('host','reconcile',{sessionId:'live_orphan_fixture'},502);assert.equal(requests,before);assert((await h.bingo.game(h.game.id)).data.state.drawHold);
});

test('known provider hangup failure remains held and a later verified cleanup can finish it',async t=>{
 const h=await fixture(t);await h.live();await h.step('output',undefined,{sdp:'v=0\r\n'},200,{path:'/api/live-calls/realtime'});
 h.setUpstream(async url=>url.includes('/twirp/')?Response.json({}):Response.json({error:{code:'fixture_unavailable'}},{status:502}));await h.step('host','finish');assert.equal((await h.current()).resourcesClosed,false);assert.equal((await h.current()).realtimeStopped,undefined);
 h.setUpstream(async()=>Response.json({}));await h.step('host','cancel',{},409); // ending is idempotent only for finish, not a new cancellation
 await h.invoke('host');await h.calls.mutate('host',call=>{call.cleanupAttemptAt=0;return call;});await h.invoke('host');assert.equal((await h.current()).resourcesClosed,true);assert((await h.bingo.game(h.game.id)).data.state.drawHold);
});

test('LiveKit deployment credential rotation cannot issue new tokens or falsely close the original rooms',async t=>{
 const h=await fixture(t);await h.backstage();await h.step('player',undefined,{target:'backstage'},200,{path:'/api/live-calls/token'});
 assert.match((await h.current()).mediaCredentialFingerprint,/^[a-f0-9]{64}$/);assert.equal((await h.invoke('host')).call.mediaCredentialFingerprint,undefined);
 h.env.LIVEKIT_URL='wss://another-project.livekit.cloud';h.env.LIVEKIT_API_KEY='API_ANOTHER_KEY';h.env.LIVEKIT_API_SECRET='ANOTHER_SECRET_NOT_REAL_12345';const before=h.upstream.length;
 await h.step('player',undefined,{target:'backstage'},409,{path:'/api/live-calls/token'});await h.step('host','cancel');
 assert.equal(h.upstream.length,before);assert.equal((await h.current()).resourcesClosed,false);assert((await h.bingo.game(h.game.id)).data.state.drawHold);
 delete h.env.LIVEKIT_URL;delete h.env.LIVEKIT_API_KEY;delete h.env.LIVEKIT_API_SECRET;await h.calls.mutate('host',call=>{call.cleanupAttemptAt=0;return call;});await h.invoke('host');assert.equal((await h.current()).resourcesClosed,true);
});

test('second tab stays passive and cannot cancel, but parent consent withdrawal always closes media and keeps hold',async t=>{
 const h=await fixture(t);await h.live();const other=crypto.randomUUID(),view=await h.invoke('player',undefined,200,{clientId:other});assert.equal(view.call.canControl,false);
 await h.step('player','cancel',{},409,{clientId:other});await h.step('player','heartbeat',{target:'live',connected:true},409,{clientId:other});
 await h.bingo.mutate(h.game.id,{},game=>{game.production.calls.enabled=false;});await h.step('player','withdraw-consent',{},200,{clientId:other});
 assert.equal((await h.current()).phase,'returning');const game=(await h.bingo.game(h.game.id)).data;assert.equal(game.participation[0].callConsentAt,null);assert.equal(game.participation[0].callStatus,'withdrawn');assert(game.state.drawHold);
});

test('unpublished results never enter live context and active-call key replacement performs no provider probe',async t=>{
 const h=await fixture(t),game=(await h.bingo.game(h.game.id)).data,entry=game.participation[0];game.results=[{id:'fixture-result',winner:{accountId:entry.accountId,profileId:entry.profileId},prize:{title:'Fiets'},createdAt:1}];assert.deepEqual(confirmedCallFacts(game,entry),[]);game.results[0].acknowledged=true;assert.equal(confirmedCallFacts(game,entry)[0].prize,'Fiets');
 await h.live();const request=h.req('host',{action:'remove',revision:null},{path:'/api/openai/settings',headers:{'X-Vlampie-Settings':'1'}});const response=await handleOpenAI(request,verifiedTestEnvironment(request,h.env),()=>{throw Error('No provider probe during call');});assert.equal(response.status,409);assert.equal((await response.json()).error.code,'call_cleanup_required');
});

test('120s playback at a 240s live edge and plain audible playback cannot prove return; a current cue can',async t=>{
 const h=await fixture(t);await h.live();await h.step('host','finish');const call=await h.current(),base={checkpointId:call.checkpoint.id,confirmed:true};
 await h.step('player','player-returned',{...base,playbackInfo:{ready:true,audible:true,currentTime:120,duration:240}},409);
 await h.step('player','player-returned',{...base,playbackInfo:{ready:true,audible:true}},409);
 await h.publishReturnCue();await h.step('player','player-returned',{...base,playbackInfo:{ready:true,audible:true,source:'current-cue-and-parent-confirmation',normalShowConfirmed:true,heardCurrentCue:true,cueId:call.returnState.cue.id,cueLastNumber:call.returnState.cue.lastNumber}});
 assert.equal((await h.current()).returnState.method,'player-current-cue');assert((await h.bingo.game(h.game.id)).data.state.drawHold);
});

test('fresh output generation restarts sequence safely and rejects delayed old producer; output acknowledges actual rendered generation',async t=>{
 const h=await fixture(t),a=crypto.randomUUID(),b=crypto.randomUUID();await h.bingo.mutate(h.game.id,{},game=>{game.state.control={id:h.ids.host,until:Date.now()+60000};});
 const send=async body=>{const req=h.req('host',{clientId:h.ids.host,...body},{path:'/api/output',headers:{'X-Vlampie-Output':'1'}});const response=await handleOutput(req,verifiedTestEnvironment(req,h.env));return {status:response.status,...await response.json()};};
 let response=await send({action:'producer-claim',instanceId:a,expectedGeneration:0});assert.equal(response.status,200);const old=response.state.producer.generation;
 response=await send({action:'publish',instanceId:a,generation:old,seq:1000,snapshot:{camera:'wide'}});assert.equal(response.status,200);
 response=await send({action:'producer-claim',instanceId:b,expectedGeneration:old});const generation=response.state.producer.generation;assert(generation>old);
 assert.equal((await send({action:'publish',instanceId:a,generation:old,seq:2000,snapshot:{camera:'old'}})).status,409);
 response=await send({action:'publish',instanceId:b,generation,seq:1,snapshot:{camera:'new'}});assert.equal(response.status,200);
 assert.equal((await send({action:'publish',instanceId:b,generation,seq:1,snapshot:{camera:'discarded'}})).status,409);
 const seen=[],bridge=Object.assign(Object.create(OutputBridge.prototype),{showAudio:{setLevels(){},setMuted(){}},receive:message=>seen.push(message),isOutput:true,seen:new Set(),offset:0,mixer:{},audioReady:false});bridge.consume(response.state);bridge.consume({...response.state,producer:{...response.state.producer,generation:old},seq:2000,snapshot:{camera:'old'}});assert.equal(bridge.receivedGeneration,generation);assert.equal(seen.at(-1).payload.camera,'new');assert.equal(bridge.renderedGeneration,undefined);assert.equal(bridge.markRendered({generation:old,seq:1000}),false);assert.equal(bridge.markRendered({generation,seq:1}),true);assert.equal(bridge.renderedGeneration,generation);
});
