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

const json=(message,status=503,code='unavailable')=>Response.json({error:{code,message}},{status});
const authPaths=new Set(['/api/auth/session','/api/player/request-code','/api/player/verify-code','/api/player/logout']);
const environmentSymbol=Symbol.for('milo.node-runtime-environment');

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
  const cleanRequest=new Request(request,{headers:cleanHeaders});
  context=await createAuthContext(cleanRequest,env,{clientFactory:authClientFactory});
  const url=new URL(cleanRequest.url),path=url.pathname;
  const finish=response=>applyAuthCookies(response,context);
  if(path.startsWith('/auth/')||authPaths.has(path))return finish(await handleNodeAuth(cleanRequest,env,context));
  if(context.error)return finish(json(context.error.message,context.error.status,context.error.code));
  checkSameOrigin(cleanRequest,context.origin);
  if(!context.identity.user&&path!=='/api/player/brand'&&path!=='/api/player/session')return finish(json('Log in om deze functie te gebruiken.',401,'sign_in'));
  if(cleanRequest.headers.get('upgrade')?.toLowerCase()==='websocket')return finish(json('Deze Node-runtime ondersteunt hier geen WebSocket-upgrade.',501,'websocket_unavailable'));
  if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(cleanRequest.method))return finish(json('Deze aanvraag wordt niet ondersteund.',405,'method'));
  const verifiedEnv={...env,AUTH_IDENTITY:context.identity,OPENAI_ENV_ONLY:true};
  let response;
  if(/^\/api\/characters(?:\/|$)/.test(path))response=await handleCharacterSettings(cleanRequest,verifiedEnv);
  else if(path.startsWith('/api/player/'))response=await handlePlayerAuth(cleanRequest,verifiedEnv);
  else if(path==='/api/output')response=await handleOutput(cleanRequest,verifiedEnv);
  else if(path.startsWith('/api/live-calls'))response=await handleLiveCalls(cleanRequest,verifiedEnv,providerFetch);
  else if(path.startsWith('/api/livekit/'))response=await handleLiveKit(cleanRequest,verifiedEnv,providerFetch);
  else if(path==='/api/calls'||path==='/api/calls/settings')response=await handleCalls(cleanRequest,verifiedEnv,providerFetch);
  else if(path.startsWith('/api/openai/')){
   if(!context.identity.admin)response=json('Alleen de regie kan deze functie gebruiken.',403,'owner_only');
   else if(!env.OPENAI_API_KEY)response=json('OpenAI is nog niet ingesteld. Voeg de serversecret toe nadat de projectgegevens bekend zijn.',503,'openai_unconfigured');
   else if(path==='/api/openai/settings'&&cleanRequest.method==='POST')response=json('Beheer de OpenAI-sleutel in de serveromgeving.',409,'server_secret_required');
   else {
    response=await handleOpenAI(cleanRequest,verifiedEnv,providerFetch);
    if(path==='/api/openai/status'&&response.ok){const status=await response.json();response=Response.json({...status,runtime:'node',transportStatus:'local_contract_tested',transportReady:true,liveVerified:false});}
   }
  }
  else if(path.startsWith('/api/presentation/'))response=await handlePresentation(cleanRequest,verifiedEnv);
  else if(path.startsWith('/api/planner/'))response=await handlePlanner(cleanRequest,verifiedEnv);
  else if(/^\/api\/bingo\/games\/[^/]+\/chat(?:\/|$)/.test(path))response=await handleChat(cleanRequest,verifiedEnv);
  else if(path.startsWith('/api/bingo/'))response=await handleBingo(cleanRequest,verifiedEnv);
  else response=json('Deze functie bestaat niet.',404,'not_found');
  return finish(response);
 }catch(cause){
  const response=json(cause.status?cause.message:'De server kon deze aanvraag niet bevestigen.',cause.status||503,cause.code||'runtime_unavailable');
  return applyAuthCookies(response,context||{cookies:[]});
 }
}
