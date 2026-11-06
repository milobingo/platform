import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './live-calls-fixture.mjs';
import {appendLiveDirectorInstruction,liveDirectorWhisper} from '../server/live-director-whisper.js';
import {publicLiveCall} from '../server/live-call-model.js';

class Sideband extends EventTarget{
 constructor(onSend=()=>{}){super();this.onSend=onSend;this.sent=[];this.closed=false;this.accepted=false;}
 accept(){this.accepted=true;}
 send(raw){const data=JSON.parse(raw);this.sent.push(data);this.onSend(data,this);}
 emit(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
 close(){this.closed=true;this.dispatchEvent(new Event('close'));}
}
const ack=(command,socket)=>queueMicrotask(()=>socket.emit({type:'session.instructions.appended',client_event_id:command.event_id,start_ms:100,end_ms:100}));
const payload=(c,extra={})=>({callId:c.id,characterId:c.characterId,instruction:'Stel één makkelijke vraag over de favoriete kleur.',requestId:crypto.randomUUID(),...extra});
async function ready(t){
 const h=await fixture(t);await h.live();const c=await h.current();
 await h.invoke('output',{callId:c.id,sdp:'v=0\r\nfixture'},200,{path:'/api/live-calls/realtime'});return h;
}
const path={path:'/api/live-calls/whisper'};
const direct=(h,c,body,extra={})=>liveDirectorWhisper({store:h.calls,owner:'host',call:c,clientId:h.ids.host,gameId:h.game.id,body,request:h.req('host',body,path),env:h.env,...extra});

test('one confirmed sideband instruction reaches the existing session, remains private and is permanently idempotent',async t=>{
 const h=await ready(t),c=await h.current(),before=(await h.bingo.game(h.game.id)).data,body=payload(c),sockets=[],requests=[];
 h.setUpstream(async(url,options)=>{requests.push({url,options});const socket=new Sideband((command,s)=>{
  s.emit({type:'session.output_audio.delta',delta:'ignored-media'});s.emit({type:'session.output_transcript.delta',delta:'ignored-transcript'});
  s.emit({type:'session.instructions.appended',client_event_id:'another-command'});ack(command,s);
 });sockets.push(socket);return {webSocket:socket};});
 const result=await h.invoke('host',body,200,path);
 assert.equal(result.status,'accepted');assert.equal(result.requestId,body.requestId);assert.equal(result.callId,c.id);assert.equal(result.characterId,'milo');assert.equal(result.simulated,false);assert(result.acceptedAt);assert.match(result.message,/niet.*uitgevoerd/);
 assert.equal(requests.length,1);assert.equal(requests[0].url,'https://api.openai.com/v1/live/sessions/'+c.realtimeId+'/attach');
 assert.equal(sockets[0].sent.length,1);assert.equal(sockets[0].sent[0].type,'session.instructions.append');assert.equal(sockets[0].sent[0].event_id,body.requestId);assert.equal(sockets[0].sent[0].delegation_id,null);assert(sockets[0].sent[0].content.includes(body.instruction));assert(sockets[0].closed);
 assert(!sockets[0].sent.some(x=>x.type==='session.close'),'Closing this sideband must not close the main conversation');
 const stored=await h.current();assert.equal(stored.realtimeId,c.realtimeId);assert.equal(stored.phase,'live');assert.equal(stored.directorWhispers[0].status,'accepted');assert(!JSON.stringify(stored).includes(body.instruction));
 for(const role of ['host','output','player']){const publicJSON=JSON.stringify(publicLiveCall(stored,role));assert(!publicJSON.includes('directorWhispers'));assert(!publicJSON.includes(body.requestId));assert(!publicJSON.includes(body.instruction));}
 assert.deepEqual((await h.bingo.game(h.game.id)).data,before,'No draw, cards, winner or hold changes');
 const retry=await h.invoke('host',body,200,path);assert.equal(retry.acceptedAt,result.acceptedAt);assert.equal(requests.length,1);
 await h.invoke('host',{...body,instruction:'Een andere aanwijzing.'},409,path);assert.equal(requests.length,1);
});

test('the live route rejects player/output, wrong host client, cross-origin, backstage and a different character',async t=>{
 const h=await ready(t),c=await h.current(),body=payload(c);let attempted=0;h.setUpstream(async()=>{attempted++;throw Error('No provider call allowed');});
 await h.invoke('player',body,403,path);await h.invoke('output',body,403,path);
 await h.invoke('host',body,403,{...path,clientId:crypto.randomUUID()});
 await h.invoke('host',body,403,{...path,headers:{Origin:'https://foreign.example'}});
 await h.invoke('host',{...body,characterId:'stella'},409,path);
 await h.invoke('host',{...body,sessionId:'live_injected'},400,path);
 await h.calls.mutate('host',current=>({...current,phase:'backstage'}));await h.invoke('host',body,409,path);assert.equal(attempted,0);
});

test('a lost acknowledgement is uncertain and a retry never sends the command again',async t=>{
 const h=await ready(t),c=await h.current(),body=payload(c),sockets=[];let attempts=0;
 const fetcher=async()=>{attempts++;const socket=new Sideband((command,s)=>s.emit({type:'session.instructions.appended',client_event_id:'wrong-id'}));sockets.push(socket);return {webSocket:socket};};
 await assert.rejects(direct(h,c,body,{fetcher,timeoutMs:12}),e=>e.code==='whisper_uncertain'&&e.uncertain===true);
 assert.equal((await h.current()).directorWhispers[0].status,'uncertain');assert(sockets[0].closed);
 await assert.rejects(direct(h,await h.current(),body,{fetcher,timeoutMs:12}),e=>e.code==='whisper_uncertain');assert.equal(attempts,1);
 // A crashed Worker can leave only its lease. Expiry must not permit a replay.
 await h.calls.mutate('host',current=>{Object.assign(current.directorWhispers[0],{status:'sending',leaseUntil:Date.now()-1});return current;});
 await assert.rejects(direct(h,await h.current(),body,{fetcher,timeoutMs:12}),e=>e.code==='whisper_uncertain');assert.equal(attempts,1);assert.equal((await h.current()).directorWhispers[0].status,'uncertain');
});

test('only one send can be in flight and both duplicate and separate concurrent requests are blocked',async t=>{
 const h=await ready(t),c=await h.current(),body=payload(c);let socket,resolveSent;
 const sent=new Promise(resolve=>{resolveSent=resolve;});
 h.setUpstream(async()=>({webSocket:socket=new Sideband(()=>resolveSent())}));
 const first=h.invoke('host',body,200,path);
 try{
  await Promise.race([sent,first.then(()=>{throw Error('The first request finished before its send was observed.');})]);
  assert.equal(socket.sent.length,1);
  const duplicate=await h.invoke('host',body,409,path);assert.equal(duplicate.code,'whisper_pending');
  const concurrent=await h.invoke('host',payload(c),409,path);assert.equal(concurrent.code,'whisper_pending');
 }finally{
  if(socket?.sent.length)ack(socket.sent[0],socket);
  assert.equal((await first).status,'accepted');
 }
 assert.equal((await h.current()).directorWhispers.length,1);
});

test('a changed guest is checked again after attachment; ending after ACK never reports current-session success',async t=>{
 const h=await ready(t),c=await h.current(),body=payload(c);let socket;
 const changedBeforeSend=async()=>{socket=new Sideband(ack);await h.calls.mutate('host',current=>{current.activeContext.callName='Nieuwe gast';return current;});return {webSocket:socket};};
 await assert.rejects(direct(h,c,body,{fetcher:changedBeforeSend}),e=>e.code==='whisper_context_changed');assert.equal(socket.sent.length,0);assert(socket.closed);
 const fresh=await h.current(),later=payload(fresh);
 const endedAfterSend=async()=>({webSocket:new Sideband((command,s)=>{void h.calls.mutate('host',current=>({...current,phase:'returning'})).then(()=>ack(command,s));})});
 await assert.rejects(direct(h,fresh,later,{fetcher:endedAfterSend}),e=>e.code==='whisper_context_changed');
 const stored=await h.current();assert.equal(stored.phase,'returning');assert.equal(stored.directorWhispers.find(x=>x.requestId===later.requestId).status,'accepted');assert((await h.bingo.game(h.game.id)).data.state.drawHold);
});

test('explicit provider rejection and transport close are distinguished; no key/media or primary-close event leaks',async()=>{
 const request=new Request('https://studio.example/api/live-calls/whisper'),requestId=crypto.randomUUID();let rejected,closed,generic;
 await assert.rejects(appendLiveDirectorInstruction({key:'not-real',sessionId:'live_existing',requestId,instruction:'Praat wat rustiger.',request,fetcher:async()=>({webSocket:rejected=new Sideband((command,s)=>queueMicrotask(()=>s.emit({type:'error',error:{client_event_id:command.event_id}})))}),timeoutMs:12}),e=>e.code==='whisper_rejected'&&!e.uncertain);
 await assert.rejects(appendLiveDirectorInstruction({key:'not-real',sessionId:'live_existing',requestId,instruction:'Praat wat rustiger.',request,fetcher:async()=>({webSocket:closed=new Sideband((command,s)=>queueMicrotask(()=>s.dispatchEvent(new Event('close'))))}),timeoutMs:12}),e=>e.code==='whisper_uncertain'&&e.uncertain);
 await assert.rejects(appendLiveDirectorInstruction({key:'not-real',sessionId:'live_existing',requestId,instruction:'Praat wat rustiger.',request,fetcher:async()=>({webSocket:generic=new Sideband((command,s)=>queueMicrotask(()=>s.emit({type:'error',error:{code:'transport'}})))}),timeoutMs:12}),e=>e.code==='whisper_uncertain'&&e.uncertain);
 for(const socket of [rejected,closed,generic]){assert(socket.closed);assert.equal(socket.sent.length,1);assert.equal(socket.sent[0].type,'session.instructions.append');assert(!JSON.stringify(socket.sent).includes('not-real'));assert(!JSON.stringify(socket.sent).includes('input_audio'));}
});

test('an acknowledged append with a failed receipt write is uncertain, never a safely repeatable rejection',async t=>{
 const h=await ready(t),c=await h.current(),body=payload(c);let count=0,fetches=0;
 const store={get:owner=>h.calls.get(owner),mutate:async(owner,fn)=>{count++;if(count===2)throw Error('Receipt write unavailable');return h.calls.mutate(owner,fn);}};
 const fetcher=async()=>{fetches++;return {webSocket:new Sideband(ack)};};
 await assert.rejects(liveDirectorWhisper({store,owner:'host',call:c,clientId:h.ids.host,gameId:h.game.id,body,request:h.req('host',body,path),env:h.env,fetcher}),e=>e.code==='whisper_uncertain'&&e.uncertain);
 assert.equal((await h.current()).directorWhispers[0].status,'uncertain');
 await assert.rejects(direct(h,await h.current(),body,{fetcher}),e=>e.code==='whisper_uncertain');assert.equal(fetches,1);
});

test('an early replayed ACK cannot confirm a new send, and an expired call after attach receives no instruction',async t=>{
 const request=new Request('https://studio.example/api/live-calls/whisper'),requestId=crypto.randomUUID();let early;
 const earlyFetcher=async()=>{early=new Sideband();early.accept=()=>early.emit({type:'session.instructions.appended',client_event_id:requestId});return {webSocket:early};};
 await assert.rejects(appendLiveDirectorInstruction({key:'not-real',sessionId:'live_existing',requestId,instruction:'Praat rustig.',request,fetcher:earlyFetcher,timeoutMs:12}),e=>e.code==='whisper_uncertain');assert.equal(early.sent.length,1);
 const h=await ready(t),c=await h.current(),body=payload(c);let socket;
 const expiredFetcher=async()=>{socket=new Sideband(ack);await h.calls.mutate('host',current=>({...current,liveUntil:Date.now()-1}));return {webSocket:socket};};
 await assert.rejects(direct(h,c,body,{fetcher:expiredFetcher}),e=>e.code==='whisper_context_changed');assert.equal(socket.sent.length,0);assert(socket.closed);
});
