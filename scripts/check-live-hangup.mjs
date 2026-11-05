import test from 'node:test';
import assert from 'node:assert/strict';
import {createLivePeer,hangupLive,validLiveSessionId} from '../server/gpt-live.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
class Socket extends EventTarget{
 constructor(onSend){super();this.sent=[];this.onSend=onSend;}
 accept(){this.accepted=true;}
 send(raw){const data=JSON.parse(raw);this.sent.push(data);this.onSend?.(data,this);}
 close(){this.closed=true;this.dispatchEvent(new Event('close'));}
 message(data){const event=new Event('message');event.data=JSON.stringify(data);this.dispatchEvent(event);}
}
const upgraded=socket=>({status:101,webSocket:socket});

test('REST success finishes without opening another connection',async()=>{
 for(const status of [200,204]){
  const calls=[];assert.equal(await hangupLive('test-private-key','opaque.session/abc',async(url,options)=>{calls.push({url,options});return new Response(null,{status});}),true);
  assert.equal(calls.length,1);assert(calls[0].url.endsWith('/opaque.session%2Fabc/hangup'));assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.body,undefined);
 }
});

test('REST 404 still closes an active WebRTC session through sideband before reporting success',async()=>{
 const calls=[],socket=new Socket((data,s)=>s.message({type:'session.closed'}));
 assert.equal(await hangupLive('test-key','webrtc-still-active',async url=>{calls.push(url);return url.endsWith('/hangup')?new Response(null,{status:404}):upgraded(socket);}),true);
 assert.equal(calls.length,2);assert(calls[1].endsWith('/webrtc-still-active/attach'));assert(socket.closed);assert.deepEqual(socket.sent,[{type:'session.close'}]);
});

test('failed REST hangup closes the existing session through sideband and waits for its terminal event',async()=>{
 let sent;const command=new Promise(resolve=>{sent=resolve;}),socket=new Socket(()=>sent()),calls=[];
 const closing=hangupLive('test-private-key','opaque/one?two#three',async(url,options)=>{calls.push({url,options});return url.endsWith('/hangup')?new Response(null,{status:409}):upgraded(socket);});
 await command;assert(socket.accepted);assert.equal(socket.closed,undefined);assert.deepEqual(socket.sent,[{type:'session.close'}]);
 socket.message({type:'session.started',session:{id:'opaque/one?two#three',status:'active'}});await flush();assert.equal(socket.closed,undefined,'session.started is not a close confirmation');
 socket.message({type:'session.closed',session:{status:'active'}});assert.equal(await closing,true);assert(socket.closed);
 assert.equal(calls.length,2);assert(calls[1].url.endsWith('/opaque%2Fone%3Ftwo%23three/attach'));assert.equal(calls[1].options.headers.Upgrade,'websocket');assert.equal(calls[1].options.body,undefined);assert(!socket.sent.some(e=>e.type==='session.start'));
 assert(calls.every(c=>!c.url.endsWith('/live/sessions')),'closing must never create a replacement session');
});

test('a REST network failure can still close the existing session through sideband',async()=>{
 const socket=new Socket((data,s)=>s.message({type:'session.closed'}));let calls=0;
 assert.equal(await hangupLive('test-key','s',async()=>{if(++calls===1)throw Error('network');return upgraded(socket);}),true);assert.equal(calls,2);assert(socket.closed);
});

test('opaque session identifiers are preserved, encoded once and accepted without a prefix pattern',async()=>{
 const id='new.version:β/a?b#c',calls=[];
 const result=await createLivePeer('test-key','v=0\r\noffer',{model:'gpt-live-1'},async(url,options)=>{calls.push({url,options});return Response.json({session:{id},transport:{sdp:'v=0\r\nanswer'}});});
 assert.equal(result.realtimeId,id);assert(validLiveSessionId('s'));assert(validLiveSessionId('x'.repeat(512)));
 for(const invalid of ['',null,undefined,1,'has space','line\nbreak','tab\t','control\u0000','x'.repeat(513)])assert.equal(validLiveSessionId(invalid),false);
 await assert.rejects(createLivePeer('test-key','v=0',{model:'gpt-live-1'},async url=>{calls.push({url});return url.endsWith('/hangup')?new Response(null,{status:200}):Response.json({session:{id},transport:{sdp:'not-sdp'}});}),/bevestigde sessie/);
 assert(calls.at(-1).url.endsWith('/'+encodeURIComponent(id)+'/hangup'));
});

test('ambiguous failures stay unconfirmed and diagnostics contain no key, session id or upstream body',async t=>{
 const warnings=[];t.mock.method(console,'warn',(...values)=>warnings.push(values));const key='key-DO-NOT-LOG',id='session-DO-NOT-LOG';
 for(const status of [400,409,500])assert.equal(await hangupLive(key,id,async()=>new Response(key+' '+id+' private provider body',{status})),false);
 const logged=JSON.stringify(warnings);assert.equal(warnings.length,3);assert(!logged.includes(key));assert(!logged.includes(id));assert(!logged.includes('private provider body'));assert(logged.includes('attach_rejected'));
});

test('missing session on sideband is safe to regard as absent after an uncertain REST result',async()=>{
 let calls=0;assert.equal(await hangupLive('test-key','old.session',async()=>new Response(null,{status:++calls===1?409:404})),true);assert.equal(calls,2);
});

test('socket closure or error before session.closed cannot be reported as a confirmed close',async t=>{
 t.mock.method(console,'warn',()=>{});
 for(const event of ['close','error']){
  const socket=new Socket((data,s)=>s.dispatchEvent(new Event(event)));
  assert.equal(await hangupLive('test-key','test-session',async url=>url.endsWith('/hangup')?new Response(null,{status:400}):upgraded(socket)),false);assert(socket.closed);
 }
});

test('a sideband that never confirms closure is bounded and releases its socket',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});t.mock.method(console,'warn',()=>{});
 let sent;const command=new Promise(resolve=>{sent=resolve;}),socket=new Socket(()=>sent());
 const closing=hangupLive('test-key','test-session',async url=>url.endsWith('/hangup')?new Response(null,{status:400}):upgraded(socket));
 await command;t.mock.timers.tick(6000);assert.equal(await closing,false);assert(socket.closed);assert.deepEqual(socket.sent,[{type:'session.close'}]);
});

test('invalid identifiers never reach a provider endpoint',async t=>{
 t.mock.method(console,'warn',()=>{});let calls=0;
 assert.equal(await hangupLive('test-key','has spaces',async()=>{calls++;}),false);assert.equal(calls,0);
 assert.equal(await hangupLive('test-key',null,async()=>{calls++;}),true);assert.equal(calls,0);
});

test('service failures preserve safe diagnostic fields while hiding keys, session ids and raw bodies',async t=>{
 const warnings=[];t.mock.method(console,'warn',(...values)=>warnings.push(values));const key='sk-test-private-abc',id='live_private_session_123';let diagnostic;
 assert.equal(await hangupLive(key,id,async()=>Response.json({error:{code:'server_is_overloaded',type:'service_unavailable_error',message:'private '+key+' '+id}},{status:503,headers:{'x-request-id':'req_diagnostic_123','retry-after':'30'}}),{onFailure:d=>{diagnostic=d;}}),false);
 assert.equal(diagnostic.attach.errorCode,'server_is_overloaded');assert.equal(diagnostic.attach.errorType,'service_unavailable_error');assert.equal(diagnostic.attach.requestId,'req_diagnostic_123');assert.equal(diagnostic.attach.retryAfter,30);assert.equal(diagnostic.attach.responseType,'application/json');
 const logged=JSON.stringify(warnings);assert(!logged.includes(key));assert(!logged.includes(id));assert(!logged.includes('private '));
});
test('gateway HTML can be distinguished without exposing its body or arbitrary headers',async t=>{
 t.mock.method(console,'warn',()=>{});let diagnostic;
 await hangupLive('key-no-log','id-no-log',async()=>new Response('<h1>private gateway details</h1>',{status:503,headers:{'content-type':'text/html','x-mitmproxy-blocked-reason':'private policy details','x-request-id':'sk-arbitrary-secret'}}),{onFailure:d=>{diagnostic=d;}});
 assert.equal(diagnostic.attach.responseType,'text/html');assert.equal(diagnostic.attach.policyBlocked,true);assert.equal(diagnostic.attach.requestId,null);assert.equal(diagnostic.attach.errorCode,null);assert(!JSON.stringify(diagnostic).includes('private'));
});
