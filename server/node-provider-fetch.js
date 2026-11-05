import WebSocket from 'ws';

const OPENAI_ORIGIN='https://api.openai.com';
const livePath=/^\/v1\/live\/sessions(?:\/[^/?]+\/attach)?$/;
const safeToken=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(value)?value:null;
const failure=(status,code,type='transport_error',headers={})=>Response.json({error:{code,type,message:'De providerverbinding kon niet worden bevestigd.'}},{status,headers});
const abortError=signal=>new DOMException('De providerverbinding is geannuleerd.',signal?.reason?.name==='TimeoutError'?'TimeoutError':'AbortError');
function diagnosticHeaders(upstream,authorization){
 const headers={},key=authorization.replace(/^Bearer\s+/i,'');
 const requestId=upstream['x-request-id'],retry=upstream['retry-after'];
 if(safeToken(requestId)&&!requestId.includes(key))headers['x-request-id']=requestId;
 if(typeof retry==='string'&&/^\d{1,5}$/.test(retry))headers['retry-after']=retry;
 return headers;
}

// Worker sockets buffer events until accept(). Use the same small interface so
// the transferred session protocol, voice identity and close confirmations stay
// unchanged. Listener registration completes before the queued events are sent.
function workerSocket(socket,{closeTimeoutMs,maxPayload}){
 const target=new EventTarget();let accepted=false,queued=[],queuedBytes=0,scheduled=false,closeTimer;
 const deliver=()=>{
  scheduled=false;if(!accepted)return;
  const events=queued;queued=[];queuedBytes=0;
  for(const event of events)target.dispatchEvent(event);
 };
 const enqueue=(event,size=0)=>{
  queuedBytes+=size;
  if(queued.length>=64||queuedBytes>maxPayload){queued=[];queuedBytes=0;socket.terminate();event=new Event('error');}
  queued.push(event);
  if(accepted&&!scheduled){scheduled=true;queueMicrotask(deliver);}
 };
 socket.on('message',(data,binary)=>enqueue(new MessageEvent('message',{data:binary?new Uint8Array(data):data.toString('utf8')}),data.length));
 socket.on('error',()=>enqueue(new Event('error')));
 socket.on('close',(code,reason)=>{
  clearTimeout(closeTimer);
  const event=new Event('close');Object.assign(event,{code,reason:reason.toString('utf8'),wasClean:code!==1006});enqueue(event);
 });
 return {
  get readyState(){return socket.readyState;},
  accept(){if(accepted)return;accepted=true;if(!scheduled){scheduled=true;queueMicrotask(deliver);}},
  addEventListener:(...args)=>target.addEventListener(...args),
  removeEventListener:(...args)=>target.removeEventListener(...args),
  send(data){if(socket.readyState!==WebSocket.OPEN)throw new Error('De providerverbinding is gesloten.');socket.send(data);},
  close(code=1000,reason=''){
   if(socket.readyState===WebSocket.CLOSED)return;
   socket.close(code,reason);
   if(!closeTimer){closeTimer=setTimeout(()=>socket.terminate(),closeTimeoutMs);closeTimer.unref?.();}
  },
 };
}

async function rejectionResponse(response,authorization){
 const headers=diagnosticHeaders(response.headers,authorization);
 let raw='',bytes=0;
 try{
  for await(const part of response){
   bytes+=part.length;if(bytes>4096){response.destroy();break;}raw+=part.toString('utf8');
  }
 }catch{}
 let details;try{details=JSON.parse(raw)?.error;}catch{}
 const confidential=authorization.replace(/^Bearer\s+/i,'');
 const token=value=>safeToken(value)&&!value.includes(confidential)?value:null;
 const status=response.statusCode>=200&&response.statusCode<=599&&![204,205,304].includes(response.statusCode)?response.statusCode:502;
 return failure(status,token(details?.code)||'websocket_handshake_rejected',token(details?.type)||'handshake_error',headers);
}

export function createNodeProviderFetch({restFetch=globalThis.fetch,webSocketFactory=(url,options)=>new WebSocket(url,options),handshakeTimeoutMs=15000,closeTimeoutMs=2000,maxPayload=1024*1024}={}){
 return async function nodeProviderFetch(input,init={}){
  const original=input instanceof Request?input:null;
  const url=new URL(original?.url||input);
  const headers=new Headers(init.headers||original?.headers);
  if(headers.get('upgrade')?.toLowerCase()!=='websocket')return restFetch(input,init);
  // Never redirect or send provider credentials to another host. The factory is
  // injectable solely for loopback protocol tests; runtime uses the fixed origin.
  if(url.origin!==OPENAI_ORIGIN||url.username||url.password||url.hash||!livePath.test(url.pathname))return failure(400,'unsupported_websocket_endpoint');
  const authorization=headers.get('authorization')||'';
  if(!/^Bearer \S+$/.test(authorization))return failure(503,'provider_key_missing');
  if((init.method||original?.method||'GET')!=='GET'||init.body||original?.body)return failure(405,'websocket_method');
  const signal=init.signal||original?.signal;
  if(signal?.aborted)throw abortError(signal);
  const forwarded=Object.fromEntries([...headers].filter(([name])=>!['upgrade','connection','host','sec-websocket-key','sec-websocket-version'].includes(name)));
  url.protocol='wss:';
  return new Promise((resolve,reject)=>{
   let socket,settled=false,rejectionActive=false,handshakeHeaders=new Headers(),rejectionTimer;
   const cleanup=()=>{signal?.removeEventListener('abort',aborted);clearTimeout(rejectionTimer);};
   // The fetch signal bounds the upgrade. Once open, the existing session
   // protocol owns request cancellation and its longer speech/close deadlines;
   // a 15-second handshake timer must not truncate a valid spoken sentence.
   const finish=response=>{if(settled)return;settled=true;cleanup();resolve(response);};
   const aborted=()=>{if(settled)return;settled=true;cleanup();socket?.terminate();reject(abortError(signal));};
   try{socket=webSocketFactory(url.href,{headers:forwarded,followRedirects:false,perMessageDeflate:false,handshakeTimeout:handshakeTimeoutMs,closeTimeout:closeTimeoutMs,maxPayload});}
   catch{return finish(failure(503,'websocket_connection_failed'));}
   const compatible=workerSocket(socket,{closeTimeoutMs,maxPayload});
   signal?.addEventListener('abort',aborted,{once:true});
   if(signal?.aborted){aborted();return;}
   socket.once('upgrade',response=>{
    handshakeHeaders=new Headers(diagnosticHeaders(response.headers,authorization));
   });
   socket.once('open',()=>finish({status:101,statusText:'Switching Protocols',ok:false,headers:handshakeHeaders,body:null,webSocket:compatible}));
   socket.on('error',()=>{if(!settled&&!rejectionActive)finish(failure(503,'websocket_connection_failed'));});
   socket.once('close',()=>{if(!settled&&!rejectionActive)finish(failure(503,'websocket_connection_closed'));});
   socket.once('unexpected-response',(request,response)=>{
    rejectionActive=true;
    // Bound both bytes and duration. This also closes a rejected upgrade whose
    // body never ends; neither a secret nor an upstream error string is logged.
    rejectionTimer=setTimeout(()=>{response.destroy();request.destroy();finish(failure(503,'websocket_handshake_timeout'));socket.terminate();},handshakeTimeoutMs);
    rejectionTimer.unref?.();
    void rejectionResponse(response,authorization).then(result=>{finish(result);request.destroy();socket.terminate();});
   });
  });
 };
}

export const nodeProviderFetch=createNodeProviderFetch();
