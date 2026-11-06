import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import WebSocket,{WebSocketServer} from 'ws';
import {createNodeProviderFetch} from '../server/node-provider-fetch.js';
import {synthesizeLiveScript,hangupLive,LIVE_MODEL} from '../server/gpt-live.js';
import {CHARACTERS} from '../server/characters.js';
import {appendLiveDirectorInstruction} from '../server/live-director-whisper.js';

const key='test-only-never-a-real-provider-key';
const auth={Upgrade:'websocket',Authorization:'Bearer '+key};
const event=(socket,type)=>new Promise(resolve=>socket.addEventListener(type,resolve,{once:true}));
async function fixture(t,{upgrade,connection,restFetch,handshakeTimeoutMs=200,closeTimeoutMs=60}={}){
 const server=createServer((request,response)=>{response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({path:request.url}));});
 const webSockets=new WebSocketServer({noServer:true,perMessageDeflate:false}),connections=new Set(),upstreams=[];
 server.on('connection',socket=>{connections.add(socket);socket.on('close',()=>connections.delete(socket));});
 server.on('upgrade',(request,socket,head)=>{
  upstreams.push({url:request.url,authorization:request.headers.authorization});
  if(upgrade){upgrade(request,socket,head,webSockets);return;}
  webSockets.handleUpgrade(request,socket,head,ws=>webSockets.emit('connection',ws,request));
 });
 webSockets.on('connection',(socket,request)=>{socket.on('error',()=>{});connection?.(socket,request);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{for(const ws of webSockets.clients)ws.terminate();for(const socket of connections)socket.destroy();await new Promise(resolve=>server.close(resolve));webSockets.close();});
 const fetcher=createNodeProviderFetch({restFetch:restFetch||globalThis.fetch,handshakeTimeoutMs,closeTimeoutMs,webSocketFactory:(url,options)=>{
  const target=new URL(url);target.protocol='ws:';target.host=new URL(origin).host;return new WebSocket(target,options);
 }});
 return {server,webSockets,origin,fetcher,upstreams};
}

test('native REST fetch stays native, upgrade allowlist never forwards secrets to another origin',async t=>{
 const h=await fixture(t);
 const response=await h.fetcher(h.origin+'/rest',{headers:{'Content-Type':'application/json'}});assert(response instanceof Response);assert.deepEqual(await response.json(),{path:'/rest'});
 for(const url of ['https://attacker.example/v1/live/sessions','https://api.openai.com/not-live','https://user:pass@api.openai.com/v1/live/sessions']){
  const rejected=await h.fetcher(url,{headers:auth});assert.equal(rejected.status,400);
 }
 assert.equal(h.upstreams.length,0);
});

test('upgrade resolves only once open, buffers early messages and supports listener removal and close',async t=>{
 const h=await fixture(t,{connection:socket=>{
  socket.send(JSON.stringify({type:'early'}));
  socket.on('message',data=>socket.send(data.toString()));
 }});
 const response=await h.fetcher('https://api.openai.com/v1/live/sessions',{headers:auth});
 assert.equal(response.status,101);const socket=response.webSocket;assert.equal(socket.readyState,WebSocket.OPEN);
 assert.equal(h.upstreams[0].authorization,'Bearer '+key);
 let removed=0;const listener=()=>removed++;socket.addEventListener('message',listener);socket.removeEventListener('message',listener);
 const early=event(socket,'message');socket.accept();assert.deepEqual(JSON.parse((await early).data),{type:'early'});
 const echoed=event(socket,'message');socket.send('hello');assert.equal((await echoed).data,'hello');assert.equal(removed,0);
 const closed=event(socket,'close');socket.close(1000);assert.equal((await closed).code,1000);
});

test('rejected and redirected handshakes return bounded safe status without leaking key or following redirects',async t=>{
 let redirects=0;
 const h=await fixture(t,{upgrade:(request,socket)=>{
  const status=request.url.endsWith('/redirect/attach')?302:429;if(status===302)redirects++;
  const body=JSON.stringify({error:{code:'rate_limit_exceeded',type:'provider_error',message:'do not expose '+key}});
  socket.end(`HTTP/1.1 ${status} Rejected\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nLocation: https://attacker.example/\r\nX-Request-ID: req_${key}\r\nRetry-After: 2\r\n\r\n${body}`);
 }});
 const response=await h.fetcher('https://api.openai.com/v1/live/sessions',{headers:auth});assert(response instanceof Response);assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'2');assert.equal(response.headers.get('x-request-id'),null);
 const body=await response.text();assert(!body.includes(key));assert.match(body,/rate_limit_exceeded/);
 const redirect=await h.fetcher('https://api.openai.com/v1/live/sessions/redirect/attach',{headers:auth});assert.equal(redirect.status,302);assert.equal(redirects,1);assert.equal(h.upstreams.length,2);
});

test('abort before or during handshake and handshake timeout close pending sockets',async t=>{
 const h=await fixture(t,{upgrade:()=>{},handshakeTimeoutMs:35});
 const already=new AbortController();already.abort();await assert.rejects(h.fetcher('https://api.openai.com/v1/live/sessions',{headers:auth,signal:already.signal}),{name:'AbortError'});assert.equal(h.upstreams.length,0);
 const controller=new AbortController();const pending=h.fetcher('https://api.openai.com/v1/live/sessions',{headers:auth,signal:controller.signal});setTimeout(()=>controller.abort(),15);await assert.rejects(pending,{name:'AbortError'});
 const timeout=await h.fetcher('https://api.openai.com/v1/live/sessions',{headers:auth});assert.equal(timeout.status,503);assert.equal((await timeout.json()).error.code,'websocket_connection_failed');
 await assert.rejects(h.fetcher('https://api.openai.com/v1/live/sessions',{headers:auth,signal:AbortSignal.timeout(10)}),{name:'TimeoutError'});
});

test('synthesis runs the transferred voice/session protocol and caches only complete confirmed PCM',async t=>{
 let session,closed=false;
 const voiced=Buffer.alloc(4800);for(let i=0;i<voiced.length;i+=2)voiced.writeInt16LE(1000,i);
 const silence=Buffer.alloc(48000);
 const h=await fixture(t,{connection:socket=>socket.on('message',raw=>{
  const message=JSON.parse(raw.toString());
  if(message.type==='session.start'){
   session=message.session;socket.send(JSON.stringify({type:'session.started'}));
   socket.send(JSON.stringify({type:'session.output_transcript.delta',delta:'Hallo allemaal!'}));
   socket.send(JSON.stringify({type:'session.output_audio.delta',delta:voiced.toString('base64')}));
   socket.send(JSON.stringify({type:'session.output_audio.delta',delta:silence.toString('base64')}));
  }
  if(message.type==='session.close'){closed=true;socket.send(JSON.stringify({type:'session.closed'}));}
 })});
 const bytes=await synthesizeLiveScript(key,CHARACTERS.milo,'Hallo allemaal!',new Request('http://local.test/'),h.fetcher);
 assert.equal(session.model,LIVE_MODEL);assert.equal(session.audio.output.voice,CHARACTERS.milo.voice);assert.equal(session.store,false);assert.equal(closed,true);
 assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'RIFF');assert.equal(bytes.length,44+voiced.length+silence.length);
});

test('request cancellation after socket open closes synthesis and never returns partial audio',async t=>{
 const controller=new AbortController();let serverClosed;
 const h=await fixture(t,{connection:socket=>{
  serverClosed=once(socket,'close');socket.on('message',raw=>{if(JSON.parse(raw.toString()).type==='session.start')controller.abort();});
 }});
 await assert.rejects(synthesizeLiveScript(key,CHARACTERS.milo,'Hallo allemaal!',new Request('http://local.test/',{signal:controller.signal}),h.fetcher),/geannuleerd/);
 await serverClosed;
});

test('session teardown confirms session.closed; rejected close stays unconfirmed',async t=>{
 const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(args));
 let rejectClose=false;
 const h=await fixture(t,{restFetch:async()=>Response.json({error:{code:'unavailable'}},{status:503}),connection:socket=>socket.on('message',raw=>{
  assert.equal(JSON.parse(raw.toString()).type,'session.close');
  socket.send(JSON.stringify({type:rejectClose?'error':'session.closed'}));
 })});
 assert.equal(await hangupLive(key,'live_test_123',h.fetcher),true);
 rejectClose=true;let diagnostic;
 assert.equal(await hangupLive(key,'live_test_456',h.fetcher,{onFailure:value=>diagnostic=value}),false);
 assert.equal(diagnostic.reason,'close_rejected');assert.equal(diagnostic.restStatus,503);assert.equal(diagnostic.attachStatus,101);assert(!JSON.stringify(warnings).includes(key));
});

test('live whisper uses an existing Node WebSocket session, accepts only its ACK and leaves primary media open',async t=>{
 const commands=[];let sidebandClosed;
 const h=await fixture(t,{connection:(socket,request)=>{
  if(!request.url.endsWith('/attach'))return;
  sidebandClosed=once(socket,'close');
  socket.on('message',raw=>{
   const command=JSON.parse(raw.toString());commands.push(command);
   socket.send(JSON.stringify({type:'session.output_transcript.delta',delta:'ignored private media'}));
   socket.send(JSON.stringify({type:'session.instructions.appended',client_event_id:'another-request'}));
   socket.send(JSON.stringify({type:'session.instructions.appended',client_event_id:command.event_id}));
  });
 }});
 const primary=(await h.fetcher('https://api.openai.com/v1/live/sessions',{headers:auth})).webSocket;primary.accept();
 const requestId=crypto.randomUUID(),instruction='Praat rustig en stel één makkelijke vraag.';
 const accepted=await appendLiveDirectorInstruction({key,sessionId:'live_existing_node',requestId,instruction,request:new Request('https://studio.example/api/live-calls/whisper'),fetcher:h.fetcher,timeoutMs:500});
 assert(Number.isFinite(accepted.acceptedAt));await sidebandClosed;
 assert.deepEqual(h.upstreams.map(x=>x.url),['/v1/live/sessions','/v1/live/sessions/live_existing_node/attach']);
 assert.equal(commands.length,1);assert.equal(commands[0].type,'session.instructions.append');assert.equal(commands[0].event_id,requestId);assert.equal(commands[0].delegation_id,null);assert(commands[0].content.includes(instruction));
 assert(!JSON.stringify(commands).includes(key));assert(!commands.some(x=>x.type==='session.close'||x.type==='session.start'||x.type==='session.input_audio.append'));
 assert.equal(primary.readyState,WebSocket.OPEN);const closed=event(primary,'close');primary.close();await closed;
});

test('an early buffered Node sideband ACK cannot confirm a later whisper send',async t=>{
 const requestId=crypto.randomUUID(),commands=[];
 const h=await fixture(t,{connection:socket=>{
  socket.send(JSON.stringify({type:'session.instructions.appended',client_event_id:requestId}));
  socket.on('message',raw=>commands.push(JSON.parse(raw.toString())));
 }});
 await assert.rejects(appendLiveDirectorInstruction({key,sessionId:'live_existing_node',requestId,instruction:'Houd het rustig.',request:new Request('https://studio.example/api/live-calls/whisper'),fetcher:h.fetcher,timeoutMs:60}),error=>error.code==='whisper_uncertain'&&error.uncertain===true);
 assert.equal(commands.length,1);assert.equal(commands[0].type,'session.instructions.append');
});

test('request abort on an open Node whisper sideband reports uncertain and never sends primary-session close',async t=>{
 const controller=new AbortController(),commands=[];let sidebandClosed;
 const h=await fixture(t,{connection:socket=>{
  sidebandClosed=once(socket,'close');
  socket.on('message',raw=>{commands.push(JSON.parse(raw.toString()));controller.abort();});
 }});
 await assert.rejects(appendLiveDirectorInstruction({key,sessionId:'live_existing_node',requestId:crypto.randomUUID(),instruction:'Stel één makkelijke vraag.',request:new Request('https://studio.example/api/live-calls/whisper',{signal:controller.signal}),fetcher:h.fetcher,timeoutMs:500}),error=>error.code==='whisper_uncertain'&&error.uncertain===true);
 await sidebandClosed;assert.equal(commands.length,1);assert.equal(commands[0].type,'session.instructions.append');
});
