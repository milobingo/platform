import {gameRequestFixture} from './game-request-fixture.mjs';
import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,jwtBody} from './live-calls-fixture.mjs';
import {handleCalls as verifiedhandleCalls} from '../server/calls.js';
import {handleBingo as verifiedhandleBingo} from '../server/bingo.js';
import {liveCallInstructions} from '../server/live-calls.js';

test('prepare atomically blocks every draw before ringing; private call and explicit return never close bingo windows early',async t=>{
 const h=await fixture(t),before=(await h.bingo.game(h.game.id)).data;await h.bingo.mutate(h.game.id,{},game=>{delete game.participation[0].connectionChecked;});await h.invoke('host',{action:'prepare',entryId:h.entryId},409);assert.equal(await h.current(),undefined);await h.bingo.mutate(h.game.id,{},game=>{game.participation[0].connectionChecked=true;});await h.prepare();let g=(await h.bingo.game(h.game.id)).data;assert(g.state.drawHold);assert.equal(g.state.paused,false);assert.equal(g.state.callId,undefined);assert.deepEqual(g.books,before.books);
 for(const [action,body] of [['reserve',{}],['commit',{token:'test'}],['activate',{blockIndex:g.plan.blocks.findIndex(b=>b.type==='round')}],['recovery',{expectedEpoch:g.state.epoch,expectedDrawn:3}]]){
  const r=await handleBingo(h.req('host',{regieId:h.ids.host,...body},{path:'/api/bingo/games/'+g.id+'/'+action}),h.env);assert.equal(r.status,409,action);
 }
 await h.step('host','cancel');assert.equal((await h.current()).phase,'returning');assert((await h.bingo.game(g.id)).data.state.drawHold);await h.step('host','resume-draw',{},409);await h.step('host','confirm-return',{confirmed:false},409);await h.step('host','confirm-return',{confirmed:true,manual:true,note:'Deelnemer bleef hoorbaar in de YouTube-uitzending.'});assert((await h.bingo.game(g.id)).data.state.drawHold);await h.step('host','resume-draw');assert.equal((await h.current()).phase,'completed');assert.equal((await h.bingo.game(g.id)).data.state.drawHold,null);
 await h.bingo.mutate(g.id,{},game=>{game.participation[0].callStatus='accepted';game.state.window={status:'open',id:'unchanged',endsAt:Date.now()+30000};});await h.invoke('host',{action:'prepare',entryId:h.entryId},409);assert.equal((await h.bingo.game(g.id)).data.state.window.id,'unchanged');
});

test('child selection, explicit catchup and two isolated rooms enforce backstage privacy before on-air',async t=>{
 const h=await fixture(t);await h.prepare();await h.step('host','ring');await h.step('player','answer',{cardsUpdated:true,youtubeMuted:true},409);await h.answer();
 const c=await h.current();assert.equal(c.profileId,'sophie');assert.equal(c.context.callName,'Sofietje');assert.notEqual(c.name,'Parent');
 const ht=await h.step('host',undefined,{target:'backstage'},200,{path:'/api/live-calls/token'}),pt=await h.step('player',undefined,{target:'backstage'},200,{path:'/api/live-calls/token'});
 assert.equal(ht.room,pt.room);assert.deepEqual(ht.allowedRemoteIdentities,[pt.identity]);assert.deepEqual(pt.allowedRemoteIdentities,[ht.identity]);assert.equal(jwtBody(ht.token).video.canPublish,true);
 await h.step('output',undefined,{target:'backstage'},403,{path:'/api/live-calls/token'});await h.step('output',undefined,{target:'live'},403,{path:'/api/live-calls/token'});await h.step('output',undefined,{sdp:'v=0\r\n'},409,{path:'/api/live-calls/realtime'});assert.equal(h.upstream.filter(x=>x.url.includes('openai.com')).length,0);
 await h.step('host','heartbeat',{target:'backstage',connected:true,micReady:true,playerTrackReceived:true});await h.step('player','heartbeat',{target:'backstage',connected:true,micReady:true});await h.step('host','backstage-ready',{soundChecked:true,explanationGiven:true});await h.step('host','stage');await h.step('host','go-live',{contextConfirmed:true});
 const liveHost=await h.step('host',undefined,{target:'live'},200,{path:'/api/live-calls/token'}),livePlayer=await h.step('player',undefined,{target:'live'},200,{path:'/api/live-calls/token'}),liveOutput=await h.step('output',undefined,{target:'live'},200,{path:'/api/live-calls/token'});
 assert.notEqual(liveHost.room,ht.room);assert.equal(jwtBody(liveHost.token).video.canPublish,false);assert.deepEqual(livePlayer.allowedRemoteIdentities,[liveOutput.identity]);assert.deepEqual(liveOutput.allowedRemoteIdentities,[livePlayer.identity]);assert(h.upstream.some(x=>x.url.endsWith('/RemoveParticipant')&&JSON.parse(x.options.body).revoke_token_ts));assert(h.upstream.some(x=>x.url.endsWith('/DeleteRoom')));
 await h.step('host','mute',{muted:true});const update=h.upstream.find(x=>x.url.endsWith('/UpdateParticipant'));assert.equal(JSON.parse(update.options.body).permission.canPublish,false);assert.equal((await h.current()).muted,true);
});

test('failure, no answer and reload preserve hold; next caller receives fresh context and only server-confirmed facts',async t=>{
 const h=await fixture(t);await h.prepare();await h.step('host','ring');await h.calls.mutate('host',c=>({...c,ringUntil:Date.now()-1}));const polled=await h.invoke('host');assert.equal(polled.call.phase,'returning');assert.equal(polled.call.outcome,'missed');assert((await h.bingo.game(h.game.id)).data.state.drawHold);
 await h.step('host','confirm-return',{confirmed:true,manual:true,note:'Deelnemer heeft niet opgenomen en bleef bij YouTube.'});await h.step('host','resume-draw');
 await h.bingo.mutate(h.game.id,{},g=>{g.participation[0]={...g.participation[0],callStatus:'accepted',profileId:'sam',name:'Sam'};g.results=[{id:'win-sophie',type:'bingo',winner:{accountId:'family',profileId:'sophie'},prize:{title:'Fiets'},roundIndex:0,createdAt:2}];});await h.invoke('host',{action:'prepare',entryId:h.entryId,characterId:'stella',context:{callName:'Sam',reason:'Ik won een fiets',confirmedFacts:[{prize:'VERZONNEN'}]}});let c=await h.current();assert.equal(c.characterId,'stella');assert.equal(c.context.callName,'Sam');assert.deepEqual(c.context.confirmedFacts,[]);assert(!liveCallInstructions(c,(await h.bingo.game(h.game.id)).data).includes('Sofietje'));
 await h.step('host','ring');await h.answer();await h.step('player','heartbeat',{target:'backstage',connected:false,micReady:false,failed:true});assert.equal((await h.current()).phase,'returning');assert((await h.bingo.game(h.game.id)).data.state.drawHold);
});

test('one AI session starts only live; role snapshots hide secrets and old call API cannot mutate LiveKit',async t=>{
 const h=await fixture(t);await h.live();const c=await h.current();
 const before=await h.invoke('player');assert(!JSON.stringify(before).includes('Is verlegen'));assert(!JSON.stringify(before).includes('TEST_SECRET'));assert(!JSON.stringify(before).includes('test-key'));
 const realtime=await h.step('output',undefined,{sdp:'v=0\r\n'},200,{path:'/api/live-calls/realtime'});assert(realtime.sdp);const sent=h.upstream.find(x=>x.url==='https://api.openai.com/v1/live/sessions'),payload=JSON.parse(sent.options.body),session=payload.session;assert.equal(session.model,'gpt-live-1');assert.equal(session.store,false);assert.equal(session.output_modalities,undefined);assert.equal(payload.transport.type,'webrtc');assert(session.instructions.includes('Sofietje'));assert(session.instructions.includes('Is verlegen'));assert.equal(session.audio.output.voice,'verse');
 await h.step('output',undefined,{sdp:'v=0\r\n'},409,{path:'/api/live-calls/realtime'});const legacy=await handleCalls(h.req('host',undefined,{path:'/api/calls'}),h.env,()=>{throw Error('No upstream');});assert.equal(legacy.status,409);assert.equal((await h.current()).phase,'live');
 await h.step('host','finish');assert.equal((await h.current()).phase,'returning');assert(h.upstream.some(x=>x.url.endsWith('/hangup')));assert.equal((await h.current()).returnState.cue,undefined);await h.step('player','player-returned',{confirmed:true});await h.step('host','confirm-return',{confirmed:true});await h.step('host','resume-draw');assert.equal((await h.bingo.game(h.game.id)).data.state.drawHold,null);
});

test('a stale host can recover explicitly from a new regie client without releasing the hold early',async t=>{
 const h=await fixture(t),newHost=crypto.randomUUID();await h.prepare();await h.step('host','cancel');
 const note='Ouder bevestigt op het andere apparaat dat YouTube weer hoorbaar is.';
 await h.step('host','confirm-return',{confirmed:true,manual:true,note},403,{clientId:newHost});
 await h.calls.mutate('host',c=>{c.seen.host=Date.now()-21000;return c;});
 await h.step('host','confirm-return',{confirmed:true,manual:true,note},200,{clientId:newHost});assert.equal((await h.current()).hostId,newHost);assert((await h.bingo.game(h.game.id)).data.state.drawHold);
 assert.equal((await h.invoke('player')).call.returnState.note,undefined);
 await h.step('host','resume-draw',{},403);await h.step('host','resume-draw',{},200,{clientId:newHost});assert.equal((await h.bingo.game(h.game.id)).data.state.drawHold,null);
});

test('output meter is bounded and a lost output lease still permits its bound AI teardown',async t=>{
 const h=await fixture(t);await h.live();await h.step('output','heartbeat',{target:'live',connected:true,audioReady:true,voiceLevel:1.9});assert.equal((await h.invoke('host')).call.voiceLevel,1);
 await h.step('output','heartbeat',{target:'live',connected:true,audioReady:true,voiceLevel:-1});assert.equal((await h.current()).voiceLevel,0);
 await h.step('output',undefined,{sdp:'v=0\r\n'},200,{path:'/api/live-calls/realtime'});
 const out=await h.env.DB.prepare('SELECT document FROM studio_outputs WHERE owner_id = ?').bind('host').first(),state=JSON.parse(out.document);state.output.until=Date.now()-1;await h.env.DB.prepare('UPDATE studio_outputs SET document = ? WHERE owner_id = ?').bind(JSON.stringify(state),'host').run();
 await h.step('output',undefined,{},200,{path:'/api/live-calls/realtime-stop'});assert.equal((await h.current()).realtimeStopped,true);await h.step('host','finish');assert.equal((await h.current()).voiceLevel,0);assert((await h.bingo.game(h.game.id)).data.state.drawHold);
});

function handleCalls(request,env,...args){return verifiedhandleCalls(request,verifiedTestEnvironment(request,env),...args);}
function handleBingo(request,env,...args){return gameRequestFixture(verifiedhandleBingo,request,verifiedTestEnvironment(request,env),...args);}
