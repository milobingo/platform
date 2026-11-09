import {createStorageEnvironment} from './node-storage.js';
import {createAuthContext,handleNodeAuth,applyAuthCookies,checkSameOrigin} from './node-auth.js';
import {handlePlayerAuth} from './player-auth.js';
import {handleOutput} from './output.js';
import {handleCalls} from './calls.js';
import {handleLiveCalls} from './live-calls.js';
import {handleLiveKit} from './livekit.js';
import {handleOpenAI} from './openai.js';
import {handlePlanner} from './planner.js';
import {handleBingo} from './bingo.js';
import {handleChat} from './chat.js';
import {handlePresentation} from './presentation.js';
import {handleCharacterSettings} from './character-settings.js';
import {nodeProviderFetch} from './node-provider-fetch.js';
import {createOrderMailDelivery} from './node-mail-gateway.js';
import {handleMail} from './mail-api.js';
import {handlePublicRules} from './game-rules-api.js';
import {handleLiveFeed} from './live-feed.js';
import {withProviderSettingsLock} from './node-provider-settings.js';
import {assertProviderSettingsLease} from './secrets.js';
import {handleObsRequest,handleObsAccess} from './node-obs-access.js';

const json=(message,status=503,code='unavailable')=>Response.json({error:{code,message}},{status});
const authPaths=new Set(['/api/auth/session','/api/player/request-code','/api/player/verify-code','/api/player/logout']);
const environmentSymbol=Symbol.for('milo.node-runtime-environment');

async function bufferedProviderRequest(request){
 const reader=request.body?.getReader();if(!reader)return {request,action:null};
 const chunks=[];let size=0,timer,abort;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(Object.assign(new Error('De providerinstellingen konden niet op tijd worden gelezen.'),{status:408,code:'request_timeout'}));},10000);});
 const cancelled=new Promise((_,reject)=>{abort=()=>{void reader.cancel().catch(()=>{});reject(Object.assign(new Error('De aanvraag is geannuleerd.'),{status:408,code:'cancelled'}));};request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();});
 try{
  for(;;){const part=await Promise.race([reader.read(),deadline,cancelled]);if(part.done)break;size+=part.value.length;if(size>40000){void reader.cancel().catch(()=>{});throw Object.assign(new Error('De providerinstellingen zijn te groot.'),{status:413,code:'body_too_large'});}chunks.push(part.value);}
 }finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);reader.releaseLock();}
 if(request.signal.aborted)throw Object.assign(new Error('De aanvraag is geannuleerd.'),{status:408,code:'cancelled'});
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let action;try{action=JSON.parse(new TextDecoder().decode(bytes)).action;}catch{}
 return {request:new Request(request.url,{method:request.method,headers:request.headers,signal:request.signal,body:bytes}),action};
}

// Standalone Next builds request.url from the loopback listener, even when
// Caddy preserved the public Host. Only the fixed, matching proxy contract may
// replace that internal origin; forwarded headers never choose an origin.
function publicRequestUrl(request,env){
 if(env.NODE_ENV!=='production'||env.HOSTNAME!=='127.0.0.1'||!/^\d{1,5}$/.test(String(env.PORT||'')))return request.url;
 try{
  const incoming=new URL(request.url),canonical=new URL(env.APP_URL);
  if(canonical.protocol!=='https:'||canonical.username||canonical.password||canonical.pathname!=='/'||canonical.search||canonical.hash)return request.url;
  if(!['http:','https:'].includes(incoming.protocol)||incoming.hostname!==env.HOSTNAME||incoming.port!==String(env.PORT)||Number(env.PORT)<1||Number(env.PORT)>65535)return request.url;
  if(request.headers.get('host')?.toLowerCase()!==canonical.host||request.headers.get('x-forwarded-host')?.toLowerCase()!==canonical.host||request.headers.get('x-forwarded-proto')!=='https')return request.url;
  return canonical.origin+incoming.pathname+incoming.search;
 }catch{return request.url;}
}

export async function getRuntimeEnvironment(){
 if(!globalThis[environmentSymbol])globalThis[environmentSymbol]=createStorageEnvironment(process.env).then(storage=>({...process.env,...storage})).catch(error=>{delete globalThis[environmentSymbol];throw error;});
 return globalThis[environmentSymbol];
}

// A request-local environment prevents identities leaking between concurrent
// users. No incoming Sites headers are forwarded into authorization.
export async function dispatchNodeRequest(request,{env,authClientFactory,providerFetch=nodeProviderFetch}={}){
 let context;
 try{
  env=env||await getRuntimeEnvironment();
  const cleanHeaders=new Headers(request.headers);
  for(const name of [...cleanHeaders.keys()])if(name.startsWith('oai-authenticated-')||name==='x-milo-role'||name==='x-milo-user')cleanHeaders.delete(name);
  let cleanRequest=new Request(request,{headers:cleanHeaders});
  const publicUrl=publicRequestUrl(cleanRequest,env);
  if(publicUrl!==cleanRequest.url)cleanRequest=new Request(publicUrl,cleanRequest);
  const url=new URL(cleanRequest.url),path=url.pathname;
  if(path==='/spelregels'||path==='/api/bingo/rules')return handlePublicRules(cleanRequest,env);
  if(path==='/mail/afmelden')return handleMail(cleanRequest,env);
  if(path.startsWith('/api/obs/')&&path!=='/api/obs/access')return handleObsRequest(cleanRequest,env,{providerFetch});
  context=await createAuthContext(cleanRequest,env,{clientFactory:authClientFactory});
  const finish=response=>applyAuthCookies(response,context);
  if(path.startsWith('/auth/')||authPaths.has(path))return finish(await handleNodeAuth(cleanRequest,env,context));
  if(context.error)return finish(json(context.error.message,context.error.status,context.error.code));
  checkSameOrigin(cleanRequest,context.origin);
  if(!context.identity.user&&path!=='/api/player/brand'&&path!=='/api/player/session')return finish(json('Log in om deze functie te gebruiken.',401,'sign_in'));
  if(cleanRequest.headers.get('upgrade')?.toLowerCase()==='websocket')return finish(json('Deze Node-runtime ondersteunt hier geen WebSocket-upgrade.',501,'websocket_unavailable'));
  if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(cleanRequest.method))return finish(json('Deze aanvraag wordt niet ondersteund.',405,'method'));
  let providerAction;
  if(cleanRequest.method==='POST'&&(path==='/api/calls'||path.startsWith('/api/live-calls')||path.startsWith('/api/livekit/')||['/api/openai/settings','/api/openai/live-preview'].includes(path))){const buffered=await bufferedProviderRequest(cleanRequest);cleanRequest=buffered.request;providerAction=buffered.action;}
  const verifiedEnv={...env,AUTH_IDENTITY:context.identity,OPENAI_ENV_ONLY:true,NATIVE_PROVIDER_SETTINGS:true,ORDER_MAIL_DELIVERY:env.ORDER_MAIL_DELIVERY||createOrderMailDelivery(env)};
  const providerOperation=handler=>withProviderSettingsLock(verifiedEnv,async locked=>{
   // A request may wait behind a provider operation. Recheck Auth and the
   // private role AFTER admission, before any provider or credential write.
   let identity;
   if(context.client){
    const {data,error}=await context.client.auth.getUser();
    if(error||!data?.user||data.user.id!==context.identity.user)return json('Je aanmelding kan niet meer worden bevestigd. Log opnieuw in.',error?.status>=500?503:401,'sign_in');
    const role=await env.DB.prepare('SELECT role FROM app_user_roles WHERE user_id = ?').bind(data.user.id).first();
    identity={user:data.user.id,email:data.user.email||'',admin:role?.role==='regie',role:role?.role==='regie'?'regie':'player',method:'supabase'};
   }else{
    const current=await createAuthContext(cleanRequest,env,{clientFactory:authClientFactory});
    if(current.error)return json(current.error.message,current.error.status,current.error.code);
    identity=current.identity;
   }
   if(!identity.user)return json('Log in om deze functie te gebruiken.',401,'sign_in');
   assertProviderSettingsLease(locked);
   const guardedFetch=(target,options={})=>{
    assertProviderSettingsLease(locked);
    const remaining=locked.PROVIDER_SETTINGS_DEADLINE-Date.now();
    return providerFetch(target,{...options,signal:AbortSignal.any([...(options.signal?[options.signal]:[]),...(locked.PROVIDER_SETTINGS_SIGNAL?[locked.PROVIDER_SETTINGS_SIGNAL]:[]),AbortSignal.timeout(Math.max(1,remaining))])});
   };
   return handler({...locked,AUTH_IDENTITY:identity,PROVIDER_CLEANUP_FETCH:providerFetch},guardedFetch);
  });
  let response;
  if(path==='/api/obs/access')response=await handleObsAccess(cleanRequest,verifiedEnv);
  else if(/^\/api\/characters(?:\/|$)/.test(path))response=await handleCharacterSettings(cleanRequest,verifiedEnv);
  else if(path.startsWith('/api/mail/'))response=await handleMail(cleanRequest,verifiedEnv,providerFetch);
  else if(path.startsWith('/api/player/'))response=await handlePlayerAuth(cleanRequest,verifiedEnv);
  else if(path==='/api/output')response=await handleOutput(cleanRequest,verifiedEnv);
  else if(path.startsWith('/api/live-calls'))response=cleanRequest.method==='POST'&&(['/api/live-calls/token','/api/live-calls/realtime'].includes(path)||path==='/api/live-calls'&&providerAction==='prepare')?await providerOperation((locked,guardedFetch)=>handleLiveCalls(cleanRequest,locked,guardedFetch)):await handleLiveCalls(cleanRequest,verifiedEnv,providerFetch);
  else if(path.startsWith('/api/livekit/'))response=cleanRequest.method==='POST'?await providerOperation((locked,guardedFetch)=>handleLiveKit(cleanRequest,locked,guardedFetch)):await handleLiveKit(cleanRequest,verifiedEnv,providerFetch);
  else if(path==='/api/calls'||path==='/api/calls/settings')response=cleanRequest.method==='POST'&&path==='/api/calls'&&['prepare','realtime'].includes(providerAction)?await providerOperation((locked,guardedFetch)=>handleCalls(cleanRequest,locked,guardedFetch)):await handleCalls(cleanRequest,verifiedEnv,providerFetch);
  else if(path.startsWith('/api/openai/')){
   if(!context.identity.admin)response=json('Alleen de regie kan deze functie gebruiken.',403,'owner_only');
   else {
    response=cleanRequest.method==='POST'&&['/api/openai/settings','/api/openai/live-preview'].includes(path)?await providerOperation((locked,guardedFetch)=>handleOpenAI(cleanRequest,locked,guardedFetch)):await handleOpenAI(cleanRequest,verifiedEnv,providerFetch);
    if(path==='/api/openai/status'&&response.ok){const status=await response.json();response=Response.json({...status,runtime:'node',transportStatus:'local_contract_tested',transportReady:true,liveVerified:false},{headers:response.headers});}
   }
  }
  else if(path.startsWith('/api/presentation/'))response=await handlePresentation(cleanRequest,verifiedEnv);
  else if(path.startsWith('/api/planner/'))response=await handlePlanner(cleanRequest,verifiedEnv);
  else if(/^\/api\/bingo\/games\/[^/]+\/chat(?:\/|$)/.test(path))response=await handleChat(cleanRequest,verifiedEnv);
  else if(/^\/api\/bingo\/games\/[^/]+\/live$/.test(path))response=await handleLiveFeed(cleanRequest,verifiedEnv);
  else if(path.startsWith('/api/bingo/'))response=await handleBingo(cleanRequest,verifiedEnv);
  else response=json('Deze functie bestaat niet.',404,'not_found');
  return finish(response);
 }catch(cause){
  const response=json(cause.status?cause.message:'De server kon deze aanvraag niet bevestigen.',cause.status||503,cause.code||'runtime_unavailable');
  return applyAuthCookies(response,context||{cookies:[]});
 }
}
