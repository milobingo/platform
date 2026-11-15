import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture as callFixture} from './live-calls-fixture.mjs';
import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import {forceCancelGame} from '../server/bingo-model.js';
import {cancelGameCallResources} from '../server/live-calls.js';
import {handleCalls} from '../server/calls.js';
const fixture=t=>callFixture(t,{postgres:!!process.env.MILO_TEST_DATABASE_URL});

const provider=(requests,{fail=false}={})=>async(url,options={})=>{
 requests.push({url,options});
 if(fail)return new Response(null,{status:503});
 if(url==='https://api.openai.com/v1/live/sessions')return Response.json({session:{id:'live_force_test_123'},transport:{type:'webrtc',sdp:'v=0\r\nanswer'}});
 return Response.json({});
};
async function terminate(h,{cleanup=false,fetcher=provider([])}={}){
 const current=(await h.bingo.game(h.game.id)).data;
 if(!current.cancellation)await h.bingo.mutate(h.game.id,{},game=>forceCancelGame(game,{by:'host',reason:'De regie beëindigt deze repetitie.',requestId:crypto.randomUUID(),binding:'force-call-test'}));
 return cleanup?cancelGameCallResources(h.env,'host',h.game.id,{fetcher}):null;
}
function intercept(h,match,around){
 const original=h.env.DB.prepare;
 h.env.DB.prepare=sql=>{
  const wrap=statement=>({...statement,bind:(...values)=>wrap(statement.bind(...values)),first:()=>match(sql,statement)?around(statement,()=>statement.first()):statement.first(),run:()=>match(sql,statement)?around(statement,()=>statement.run()):statement.run()});
  return wrap(original(sql));
 };
 return ()=>{h.env.DB.prepare=original;};
}
function interceptBatch(h,match,around){const original=h.env.DB.batch;h.env.DB.batch=statements=>match(statements)?around(statements,()=>original(statements)):original(statements);return ()=>{h.env.DB.batch=original;};}
async function legacy(h){
 const call={id:crypto.randomUUID(),gameId:h.game.id,brandId:'milo',entryId:h.entryId,accountId:'family',profileId:'sophie',name:'Sophie',hostId:h.ids.host,outputId:h.ids.output,phase:'announcing',createdAt:Date.now(),updatedAt:Date.now(),maxSeconds:90,muted:false,stopVoice:0,ops:[]};
 await h.calls.create('host',h.game.id,call);await h.bingo.mutate(h.game.id,{},game=>{game.state.callId=call.id;game.state.paused=true;});return call;
}

test('force cancellation closes only its issued LiveKit rooms and known AI session while retaining the terminal game checkpoint',async t=>{
 const h=await fixture(t);await h.live();await h.step('output',undefined,{target:'live'},200,{path:'/api/live-calls/token'});await h.step('output',undefined,{sdp:'v=0\r\n'},200,{path:'/api/live-calls/realtime'});
 const before=(await h.bingo.game(h.game.id)).data,requests=[],receipt=await terminate(h,{cleanup:true,fetcher:provider(requests)}),call=await h.current(),after=(await h.bingo.game(h.game.id)).data;
 assert.equal(receipt.pending,false);assert.equal(call.resourcesClosed,true);assert.equal(call.realtimeStopped,true);assert.equal(call.muted,true);assert.equal(call.aiMuted,true);assert.equal(call.phase,'completed');assert(call.completedAt);assert.deepEqual(after.state.drawHold,before.state.drawHold);assert.deepEqual(after.state.drawn,before.state.drawn);assert.deepEqual(after.books,before.books);assert.equal(after.status,'finished');assert.equal(after.state.paused,true);
 assert(requests.some(r=>r.url.endsWith('/hangup')));for(const r of requests.filter(r=>r.url.includes('/twirp/'))){const body=JSON.parse(r.options.body);assert.equal(body.room,'live-'+call.id);if(r.url.endsWith('/RemoveParticipant'))assert(Number.isInteger(body.revoke_token_ts));}
 const count=h.upstream.length;
 for(const [role,path,body] of [['output','/api/live-calls/token',{target:'live'}],['output','/api/live-calls/realtime',{sdp:'v=0\r\n'}],['host','/api/live-calls/whisper',{instruction:'Praat rustig.',characterId:'milo'}],['host','/api/live-calls',{action:'ring'}],['host','/api/live-calls',{action:'go-live',contextConfirmed:true}],['host','/api/live-calls',{action:'resume-draw'}]])await h.step(role,body.action,{...body},409,{path});
 assert.equal(h.upstream.length,count);
});

test('an unknown in-flight AI start remains unresolved after forced cancellation instead of fabricating closure',async t=>{
 const h=await fixture(t);await h.live();await h.calls.mutate('host',c=>({...c,realtimeStatus:'starting',realtimeStart:{id:crypto.randomUUID(),createdAt:Date.now(),expiresAt:Date.now()+30000},resourcesClosed:false}));
 const before=structuredClone((await h.bingo.game(h.game.id)).data.state.drawHold),requests=[],result=await terminate(h,{cleanup:true,fetcher:provider(requests)}),call=await h.current();
 assert.equal(result.pending,true);assert.equal(call.resourcesClosed,false);assert.equal(call.phase,'returning');assert.equal(call.completedAt,undefined);assert.equal(call.realtimeStatus,'starting');assert.equal(call.realtimeId,undefined);assert.match(call.cleanupError,/niet volledig/);assert.deepEqual((await h.bingo.game(h.game.id)).data.state.drawHold,before);assert.equal(requests.length,0);
});

test('confirmed cleanup completes the cancelled call and permits preparation for a different show without altering old history',async t=>{
 const h=await fixture(t);await h.live();await h.step('output',undefined,{target:'live'},200,{path:'/api/live-calls/token'});await h.step('output',undefined,{sdp:'v=0\r\n'},200,{path:'/api/live-calls/realtime'});
 const oldCallId=(await h.current()).id;await terminate(h,{cleanup:true,fetcher:provider([])});assert.equal((await h.current()).phase,'completed');
 const cancelled=structuredClone((await h.bingo.game(h.game.id)).data),nextGame=structuredClone(h.game);nextGame.id=crypto.randomUUID();await h.bingo.create(nextGame);
 const outputRow=await h.env.DB.prepare('SELECT document FROM studio_outputs WHERE owner_id = ?').bind('host').first(),output=JSON.parse(outputRow.document);output.snapshot.gameId=nextGame.id;
 await h.env.DB.prepare('UPDATE studio_outputs SET document = ? WHERE owner_id = ?').bind(JSON.stringify(output),'host').run();
 await h.invoke('host',{action:'prepare',entryId:h.entryId,characterId:'milo'},200,{gameId:nextGame.id});
 const current=await h.current();assert.notEqual(current.id,oldCallId);assert.equal(current.gameId,nextGame.id);assert.deepEqual((await h.bingo.game(h.game.id)).data,cancelled);assert.equal((await h.bingo.game(nextGame.id)).data.state.drawHold.callId,current.id);
});

test('failed provider cleanup remains pending and an explicit retry confirms closure without releasing the hold',async t=>{
 const h=await fixture(t);await h.live();await h.step('output',undefined,{target:'live'},200,{path:'/api/live-calls/token'});await h.step('output',undefined,{sdp:'v=0\r\n'},200,{path:'/api/live-calls/realtime'});
 const first=await terminate(h,{cleanup:true,fetcher:provider([],{fail:true})});assert.equal(first.pending,true);assert.equal((await h.current()).resourcesClosed,false);assert.equal((await h.current()).phase,'returning');assert.equal((await h.current()).completedAt,undefined);
 const hold=structuredClone((await h.bingo.game(h.game.id)).data.state.drawHold),retry=await cancelGameCallResources(h.env,'host',h.game.id,{fetcher:provider([])});assert.equal(retry.pending,false);assert.equal((await h.current()).resourcesClosed,true);assert.equal((await h.current()).phase,'completed');assert((await h.current()).completedAt);assert.deepEqual((await h.bingo.game(h.game.id)).data.state.drawHold,hold);
});

test('cancelling an older show never rewrites or contacts provider resources of a newer call belonging to the same owner',async t=>{
 const h=await fixture(t);await h.prepare();await terminate(h,{cleanup:true,fetcher:provider([])});
 const nextGame=structuredClone(h.game);nextGame.id=crypto.randomUUID();await h.bingo.create(nextGame);
 await h.calls.mutate('host',current=>({...current,id:crypto.randomUUID(),gameId:nextGame.id,phase:'live',resourcesClosed:false,issuedRooms:['live'],realtimeId:'live_other_game_123'}));
 const before=await h.calls.get('host'),requests=[],receipt=await cancelGameCallResources(h.env,'host',h.game.id,{fetcher:provider(requests)});assert.equal(receipt.callId,null);assert.deepEqual(await h.calls.get('host'),before);assert.equal(requests.length,0);
});

test('a LiveKit prepare waiting before its atomic insert cannot install a call after cancellation',async t=>{
 const h=await fixture(t);let tripped=false;const restore=intercept(h,sql=>!tripped&&sql.startsWith('INSERT INTO studio_calls'),async(_statement,run)=>{tripped=true;await terminate(h);return run();});
 try{await h.invoke('host',{action:'prepare',entryId:h.entryId,characterId:'milo'},409);}finally{restore();}
 assert(tripped);assert.equal((await h.calls.get('host'))?.data??null,null);assert.equal((await h.bingo.game(h.game.id)).data.status,'finished');assert.equal(h.upstream.length,0);
});

test('legacy call admission batch rejects cancellation committed after the fresh game check and before the game row lock',async t=>{
 const h=await fixture(t);let tripped=false;const restore=interceptBatch(h,statements=>!tripped&&statements[0].sql.startsWith('UPDATE bingo_games SET revision = revision'),async(_statements,run)=>{tripped=true;await terminate(h);return run();});
 try{await assert.rejects(legacy(h),e=>e.status===409);}finally{restore();}
 assert(tripped);assert.equal((await h.calls.get('host'))?.data??null,null);assert.equal((await h.bingo.game(h.game.id)).data.status,'finished');
});

test('LiveKit atomic preparation loses to cancellation before its game-and-call batch',async t=>{
 const h=await fixture(t);let tripped=false;const restore=interceptBatch(h,statements=>!tripped&&statements.some(s=>s.sql.startsWith('UPDATE studio_calls')),async(_statements,run)=>{tripped=true;await terminate(h);return run();});
 try{await h.invoke('host',{action:'prepare',entryId:h.entryId,characterId:'milo'},409);}finally{restore();}
 assert(tripped);assert.equal((await h.calls.get('host'))?.data??null,null);assert.equal((await h.bingo.game(h.game.id)).data.status,'finished');assert.equal(h.upstream.length,0);
});

test('a LiveKit token request paused after room reservation returns no token once the show is cancelled',async t=>{
 const h=await fixture(t);await h.backstage();let tripped=false;const requests=[];
 const restore=interceptBatch(h,statements=>!tripped&&statements.some(s=>s.sql.startsWith('UPDATE studio_calls')&&JSON.parse(s.args[2]).issuedRooms?.includes('backstage')),async(_statements,run)=>{tripped=true;const result=await run();await terminate(h,{cleanup:true,fetcher:provider(requests)});return result;});
 try{const data=await h.step('host',undefined,{target:'backstage'},409,{path:'/api/live-calls/token'});assert.equal(data.token,undefined);}finally{restore();}
 assert(tripped);assert.equal((await h.current()).phase,'completed');assert((await h.current()).completedAt);assert(requests.some(r=>r.url.endsWith('/DeleteRoom')));
});

test('a Live AI response arriving after force cancellation is recorded and hung up without returning SDP or releasing the draw hold',async t=>{
 const h=await fixture(t);await h.live();let entered,release;const waiting=new Promise(r=>entered=r),requests=[];
 h.setUpstream(async(url,options)=>{requests.push({url,options});if(url==='https://api.openai.com/v1/live/sessions'){entered();await new Promise(r=>release=r);return Response.json({session:{id:'live_late_cancel_123'},transport:{type:'webrtc',sdp:'v=0\r\nlate'}});}return Response.json({});});
 const pending=h.step('output',undefined,{sdp:'v=0\r\n'},409,{path:'/api/live-calls/realtime'});await waiting;const receipt=await terminate(h,{cleanup:true,fetcher:provider(requests)});assert.equal(receipt.pending,true);release();const response=await pending,call=await h.current();
 assert.equal(response.sdp,undefined);assert.equal(call.realtimeId,'live_late_cancel_123');assert.equal(call.realtimeStopped,true);assert.equal(call.resourcesClosed,true);assert.equal(call.phase,'completed');assert(call.completedAt);assert(requests.some(r=>r.url.includes('live_late_cancel_123')&&r.url.endsWith('/hangup')));const game=(await h.bingo.game(h.game.id)).data;assert.equal(game.status,'finished');assert(game.state.drawHold);
});

test('a legacy AI response arriving after cancellation remains recoverable, closes the known session and retains the terminal call hold',async t=>{
 const h=await fixture(t);h.env.NATIVE_PROVIDER_SETTINGS=true;const c=await legacy(h);let entered,release;const waiting=new Promise(r=>entered=r),requests=[];
 const fetcher=async(url,options)=>{requests.push({url,options});if(url==='https://api.openai.com/v1/realtime/calls'){entered();await new Promise(r=>release=r);return new Response('v=0\r\nlate',{status:201,headers:{Location:'https://api.openai.com/v1/realtime/calls/rtc_late_cancel_123'}});}return Response.json({});};
 const request=h.req('output',{action:'realtime',callId:c.id,sdp:'v=0\r\n'},{path:'/api/calls'}),pending=handleCalls(request,verifiedTestEnvironment(request,h.env),fetcher);await waiting;const receipt=await terminate(h,{cleanup:true,fetcher});assert.equal(receipt.pending,true);release();const response=await pending,data=await response.json(),current=await h.current();
 assert.equal(response.status,409);assert.equal(data.sdp,undefined);assert.equal(current.realtimeId,'rtc_late_cancel_123');assert.equal(current.realtimeStopped,true);assert.equal(current.resourcesClosed,true);assert(requests.some(r=>r.url.includes('rtc_late_cancel_123')&&r.url.endsWith('/hangup')));assert.equal((await h.bingo.game(h.game.id)).data.state.callId,c.id);
});

test('a whisper attach delayed until after cancellation never sends a director instruction',async t=>{
 const h=await fixture(t);await h.live();await h.step('output',undefined,{sdp:'v=0\r\n'},200,{path:'/api/live-calls/realtime'});
 let entered,release;const waiting=new Promise(r=>entered=r),sent=[];class Socket extends EventTarget{accept(){}send(value){sent.push(value);}close(){this.closed=true;}}
 const socket=new Socket();h.setUpstream(async url=>{if(url.endsWith('/attach')){entered();await new Promise(r=>release=r);return {webSocket:socket};}return Response.json({});});
 const pending=h.step('host',undefined,{instruction:'Stel één rustige vraag.',characterId:'milo'},409,{path:'/api/live-calls/whisper'});await waiting;await terminate(h,{cleanup:true,fetcher:provider([])});release();const result=await pending;
 assert.equal(result.status,undefined);assert.equal(sent.length,0);assert.equal(socket.closed,true);assert.equal((await h.current()).directorWhispers[0].status,'rejected');
});
