import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {authOrigin,checkSameOrigin} from './node-auth.js';
import {handleOutput,currentOutputState} from './output.js';
import {handleLiveCalls} from './live-calls.js';
import {voicePath} from './voice-cache.js';
import {buildShowAudioManifest,scopedShowAudioManifest} from './show-audio-manifest.js';
import {SPEECH_POLICY_VERSION} from '../public/bingo-speech.js';
import {withProviderSettingsLock} from './node-provider-settings.js';
import {assertProviderSettingsLease} from './secrets.js';

const LIFETIME=7*24*60*60*1000;
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
const problem=(message,status=403,code='obs_forbidden')=>Object.assign(new Error(message),{status,code});
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Pragma':'no-cache','Vary':'X-Milo-OBS-Token','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
const initialState=()=>({producer:null,output:null,snapshot:null,seq:0,events:[],voice:null,mixer:{voice:100,music:25,effects:50},routing:false});
const pick=(source,fields)=>source&&typeof source==='object'?Object.fromEntries(fields.filter(key=>source[key]!==undefined).map(key=>[key,source[key]])):null;

async function readBody(request){
 if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))throw problem('Gebruik een JSON-aanvraag.',415,'content_type');
 const reader=request.body?.getReader();if(!reader)throw problem('De OBS-aanvraag is leeg.',400);
 const chunks=[];let length=0,timer,abort;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(problem('De OBS-aanvraag duurde te lang.',408,'request_timeout'));},10000);});
 const cancelled=new Promise((_,reject)=>{abort=()=>{void reader.cancel().catch(()=>{});reject(problem('De OBS-aanvraag is geannuleerd.',408,'cancelled'));};request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();});
 try{for(;;){const part=await Promise.race([reader.read(),timeout,cancelled]);if(part.done)break;length+=part.value.length;if(length>40000){void reader.cancel().catch(()=>{});throw problem('De OBS-aanvraag is te groot.',413);}chunks.push(part.value);}}
 finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);reader.releaseLock();}
 if(request.signal.aborted)throw problem('De OBS-aanvraag is geannuleerd.',408,'cancelled');
 const raw=Buffer.concat(chunks,length);let body;try{body=JSON.parse(raw.toString());}catch{throw problem('De OBS-aanvraag kon niet worden gelezen.',400);}
 if(!body||typeof body!=='object'||Array.isArray(body))throw problem('De OBS-aanvraag is ongeldig.',400);return body;
}
async function outputRow(env,owner){return env.DB.prepare('SELECT * FROM studio_outputs WHERE owner_id = ?').bind(owner).first();}
async function assertOwner(env,owner,gameId){
 const role=await env.DB.prepare('SELECT role FROM app_user_roles WHERE user_id = ?').bind(owner).first();
 if(role?.role!=='regie')throw problem('De OBS-link is niet meer beschikbaar.',401,'obs_invalid');
 const game=await env.DB.prepare('SELECT owner_id FROM bingo_games WHERE id = ?').bind(gameId).first();
 if(!game||game.owner_id!==owner)throw problem('De OBS-link is niet meer beschikbaar.',401,'obs_invalid');
}
function status(access,requestedGameId=null){return {configured:!!access&&access.expiresAt>Date.now(),gameId:requestedGameId||access?.gameId||null,requestedGameId,activeGameId:access?.gameId||null,currentAccessId:access?.id||null,expiresAt:access?.expiresAt||null,expired:!!access&&access.expiresAt<=Date.now()};}

// This route is reached only after normal session verification. A link is never
// itself an authenticated organizer, including on /api/auth/session.
export async function handleObsAccess(request,env){
 try{
  checkSameOrigin(request,authOrigin(request,env));
  const identity=env.AUTH_IDENTITY;if(!identity?.user||identity.admin!==true)throw problem('Alleen de regie kan een OBS-link beheren.');
  if(!env.DB)throw problem('De OBS-opslag is niet beschikbaar.',503);
  if(request.method==='GET'){const requested=new URL(request.url).searchParams.get('gameId');if(requested&&!uuid(requested))throw problem('Kies een geldige show.',400);const row=await outputRow(env,identity.user),access=row?JSON.parse(row.document).obsAccess:null;return json(status(access,requested));}
  if(request.method!=='POST')throw problem('Deze aanvraag wordt niet ondersteund.',405,'method');
  if(request.headers.get('x-milo-obs-manage')!=='1')throw problem('Beheer de OBS-link vanuit de regie.');
  const body=await readBody(request);if(!['create','revoke'].includes(body.action))throw problem('Kies een beschikbare OBS-actie.',400);
  if(!Object.hasOwn(body,'expectedAccessId')||body.expectedAccessId!==null&&!/^[A-Za-z0-9_-]{43}$/.test(body.expectedAccessId))throw problem('Herlaad eerst de actuele OBS-link.',409,'obs_conflict');
  const freshRole=await env.DB.prepare('SELECT role FROM app_user_roles WHERE user_id = ?').bind(identity.user).first();if(freshRole?.role!=='regie')throw problem('Je regietoegang kan niet meer worden bevestigd.');
  if(body.action==='create'){if(!uuid(body.gameId))throw problem('Kies eerst een opgeslagen show.',400);await assertOwner(env,identity.user,body.gameId);}
  const locator=randomBytes(32).toString('base64url'),secret=randomBytes(32).toString('base64url'),createdAt=Date.now();
  const access=body.action==='create'?{version:1,id:locator,hash:digest(secret),gameId:body.gameId,createdAt,expiresAt:createdAt+LIFETIME}:null;
  await env.DB.prepare('INSERT INTO studio_outputs (owner_id,revision,document) VALUES (?,0,?) ON CONFLICT(owner_id) DO NOTHING').bind(identity.user,JSON.stringify(initialState())).run();
  for(let attempt=0;attempt<8;attempt++){
   const row=await outputRow(env,identity.user),state=JSON.parse(row.document),previous=state.obsAccess;
   if((previous?.id||null)!==body.expectedAccessId)throw problem('De OBS-link is intussen gewijzigd. Herlaad eerst de actuele link.',409,'obs_conflict');
   // Invalidating an OBS link also invalidates its audio lease. The persistent
   // call and draw hold stay intact until ordinary provider cleanup confirms.
   if(previous&&state.output?.obsAccessId===previous.id)state.output=null;
   if(access)state.obsAccess=access;else delete state.obsAccess;
   const saved=await env.DB.prepare('UPDATE studio_outputs SET revision = ?,document = ? WHERE owner_id = ? AND revision = ? RETURNING revision').bind(row.revision+1,JSON.stringify(state),identity.user,row.revision).first();
   if(saved)return json({...status(access,body.gameId||null),...(access?{token:locator+'.'+secret}:{})});
  }
  throw problem('De uitzendverbinding wijzigt tegelijk. Probeer opnieuw.',409,'obs_conflict');
 }catch(error){return json({error:{message:error.status?error.message:'De OBS-link kon niet worden beheerd.',code:error.code||'obs_unavailable'}},error.status||503);}
}

export async function verifyObsAccess(request,env){
 if(request.signal.aborted)throw problem('De OBS-aanvraag is geannuleerd.',408,'cancelled');
 if(!env.DB)throw problem('De OBS-opslag is niet beschikbaar.',503);
 checkSameOrigin(request,authOrigin(request,env));
 const token=request.headers.get('x-milo-obs-token')||'';
 if(!/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(token))throw problem('Deze OBS-link is ongeldig of verlopen. Maak in de regie een nieuwe link.',401,'obs_invalid');
 const [id,secret]=token.split('.');
 // Only the random public locator participates in lookup. The bearer secret is
 // hashed and compared in constant time, and never appears in SQL or a URL.
 // No migration is needed; this bounded organizer catalog has one row per owner.
 const row=await env.DB.prepare("SELECT * FROM studio_outputs WHERE json_extract(document,'$.obsAccess.id') = ? LIMIT 1").bind(id).first();
 let state;try{state=row?JSON.parse(row.document):null;}catch{}
 const access=state?.obsAccess,hash=digest(secret);
 if(!access||access.version!==1||access.id!==id||! /^[a-f0-9]{64}$/.test(access.hash||'')||!timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(access.hash,'hex'))||!Number.isSafeInteger(access.createdAt)||access.createdAt<0||access.createdAt>Date.now()+5000||!Number.isSafeInteger(access.expiresAt)||access.expiresAt<=access.createdAt||access.expiresAt<=Date.now()||access.expiresAt>access.createdAt+LIFETIME||!uuid(access.gameId))throw problem('Deze OBS-link is ingetrokken of verlopen. Maak in de regie een nieuwe link.',401,'obs_invalid');
 await assertOwner(env,row.owner_id,access.gameId);
 return {...access,ownerId:row.owner_id,state};
}

const visualFields=['production','gameId','gameTitle','cancelledAt','audioPreparation','backgroundMusic','gameStatus','hostId','guestId','cohostId','speakerId','camera','movingCamera','cameraTransition','cameraDuration','motion','speaking','speechActive','voiceMode','outputRouting','mouth','caption','lastNumber','drawn','roundTitle','pattern','paused','magic','theme','scene','showCue','movement','gestureEnergy','idleMotion','lipSync','blink','effects','lightShow','lookAt','bingoPending','bingoElapsed','bingoDrawn','bingoNumber','outputVersion','sceneRevision'];
const showFields=['brandId','scene','liveCall','sceneRevision','transition','transitionMs','rules','rulePage','roundPatterns','goalIndex','patternPage','question','age','duration','flow','paused','preview','title','round','pattern','prize','pauseMinutes','countdown','number','drawnCount','claim','winner','lookAt','audience','reducedMotion','planKind','planTitle','patternCells','patternFreeCenter','patternVariant','prizeImage','prizeDescription','callSeconds','callText','externalHold','drawBlocked','kind','endAfter'];
const visualCharacter=character=>pick(character,['id','name','color','asset','gestureEnergy','idleMotion','lipSync','defaultAnimation']);
const patternView=pattern=>pick(pattern,['id','title','cells','freeCenter','variant']);
const entrantView=entrant=>pick(entrant,['bookId','name','ticket']);
function showView(show){
 const result=pick(show,showFields);if(!result)return null;
 if(Array.isArray(show.roundPatterns))result.roundPatterns=show.roundPatterns.map(patternView);
 if(show.claim)result.claim=pick(show.claim,['id','name','number','ticket','pattern','status']);
 if(show.winner&&typeof show.winner==='object')result.winner=entrantView(show.winner);
 if(show.question&&typeof show.question==='object')result.question=pick(show.question,['name','text','message']);
 const game=show.gameStage;if(game){result.gameStage=pick(game,['type','startsAt','rotateSeconds','message','rules','greetings','playId','duration']);if(Array.isArray(game.prizes))result.gameStage.prizes=game.prizes.map(prize=>pick(prize,['title','description','image']));if(game.result){result.gameStage.result=pick(game.result,['id','minigame']);result.gameStage.result.winner=entrantView(game.result.winner);result.gameStage.result.entrants=(game.result.entrants||[]).map(entrantView);result.gameStage.result.prize=pick(game.result.prize,['title','description','image']);}}
 return result;
}
export function obsOutputState(state,access){
 const visible={producer:pick(state?.producer,['id','instanceId','generation','gameId','until']),output:pick(state?.output,['id','until','at','audioReady','audioPlayedAt','testAck','generation','seq','meters','voiceAck','audioPreparation']),generation:state?.generation||0,seq:state?.seq||0,publishedAt:state?.publishedAt||null,snapshot:null,show:null,events:[],voice:null,mixer:pick(state?.mixer,['voice','music','effects']),routing:false};
 if(visible.output?.testAck)visible.output.testAck=pick(visible.output.testAck,['id','status','at','error']);
 if(visible.output?.audioPreparation)visible.output.audioPreparation=pick(visible.output.audioPreparation,['fingerprint','ready','total','error']);
 if(!state||state.producer?.gameId!==access.gameId||state.snapshot?.gameId!==access.gameId)return {...visible,producer:null,output:null,seq:0,publishedAt:null};
 if(state.cancelledAt&&state.cancelledGameId===access.gameId){visible.cancelledAt=state.cancelledAt;visible.cancelledGameId=access.gameId;}
 visible.snapshot=pick(state.snapshot,visualFields);if(state.snapshot.pattern)visible.snapshot.pattern=patternView(state.snapshot.pattern);
 if(state.snapshot.backgroundMusic!==undefined)visible.snapshot.backgroundMusic=state.snapshot.backgroundMusic===true;
 if(state.snapshot.gameStatus!==undefined)visible.snapshot.gameStatus=['draft','running','finished'].includes(state.snapshot.gameStatus)?state.snapshot.gameStatus:null;
 if(state.snapshot.audioPreparation)visible.snapshot.audioPreparation=pick(state.snapshot.audioPreparation,['fingerprint','total','complete']);
 for(const key of ['showCue','movement'])if(state.snapshot[key])visible.snapshot[key]=pick(state.snapshot[key],['id','instanceId','elapsed','duration','paused','source','hostId','returnAt']);
 if(state.snapshot.magic)visible.snapshot.magic=pick(state.snapshot.magic,['id','startedAt','playing','elapsed','duration']);
 if(state.snapshot.mouth&&typeof state.snapshot.mouth==='object')visible.snapshot.mouth=pick(state.snapshot.mouth,['open','round']);
 if(Array.isArray(state.snapshot.characterSettings))visible.snapshot.characterSettings=state.snapshot.characterSettings.map(visualCharacter);
 else if(state.snapshot.characterSettings&&typeof state.snapshot.characterSettings==='object')visible.snapshot.characterSettings=state.snapshot.characterSettings.id?visualCharacter(state.snapshot.characterSettings):Object.fromEntries(Object.entries(state.snapshot.characterSettings).map(([id,value])=>[id,visualCharacter(value)]));
 visible.show=showView(state.show);if(state.snapshot.show)visible.snapshot.show=showView(state.snapshot.show);
 visible.events=(state.events||[]).map(event=>pick(event,['id','kind','at','cue']));visible.voice=pick(state.voice,['id','clip','text','duration','phase']);if(visible.voice){visible.voice.preparedOnly=state.voice.preparedOnly===true;if(typeof state.voice.preparedFingerprint==='string'&&/^[a-f0-9]{64}$/.test(state.voice.preparedFingerprint))visible.voice.preparedFingerprint=state.voice.preparedFingerprint;}visible.routing=!!state.routing;return visible;
}
export function obsLiveCall(call){
 if(!call)return null;const visible=pick(call,['id','version','transport','gameId','brandId','characterId','characterName','speechEngine','phase','createdAt','updatedAt','liveUntil','muted','aiMuted','drawHeld','realtimeStatus','realtimeStopped','voiceLevel','simulated','participantIdentity','guestIdentity','outputIdentity','hostIdentity','resourcesClosed','mode','source','cueId','resumeTarget','magicReadyAt','outroRequestedAt']);
 if(call.magic){visible.magic=pick(call.magic,['id','choice','chosenAt','effectId','playedAt']);if(call.magic.effectClaim)visible.magic.effectClaim=pick(call.magic.effectClaim,['id','outputId','claimedAt']);}
 visible.context={callName:call.context?.callName||call.name||'Deelnemer'};visible.media=Object.fromEntries(['player','output'].filter(role=>call.media?.[role]).map(role=>[role,pick(call.media[role],['connected','micReady','audioReady'])]));return visible;
}
function rewritten(request,path,body){const url=new URL(request.url);url.pathname=path;const headers=new Headers(request.headers);headers.delete('x-milo-obs-token');if(body!==undefined){headers.set('Content-Type','application/json');headers.set('X-Vlampie-Call','1');headers.set('X-Vlampie-Output','1');}return new Request(url,{method:request.method,headers,signal:request.signal,...(body===undefined?{}:{body:JSON.stringify(body)})});}

export async function handleObsRequest(request,env,{providerFetch=fetch}={}){
 try{
  const url=new URL(request.url),path=url.pathname;
  if(!['GET','POST'].includes(request.method))throw problem('Deze OBS-aanvraag wordt niet ondersteund.',405,'method');
  let access=await verifyObsAccess(request,env);
  if(path==='/api/obs/session'&&request.method==='GET')return json({authenticated:true,role:'output',gameId:access.gameId,expiresAt:access.expiresAt});
  if(path==='/api/obs/show-audio'&&request.method==='GET'){
   const manifest=await buildShowAudioManifest(env,access.ownerId,access.gameId);
   access=await verifyObsAccess(request,env);const current=await buildShowAudioManifest(env,access.ownerId,access.gameId,{includeReadiness:false});
   if(current.fingerprint!==manifest.fingerprint)throw problem('De stemvoorbereiding is gewijzigd. Laad de actuele fragmenten opnieuw.',409,'show_audio_changed');
   return json(scopedShowAudioManifest(manifest));
  }
  const native={...env,AUTH_IDENTITY:{user:access.ownerId,admin:false,role:'output',method:'obs'},OBS_ACCESS:access,OPENAI_ENV_ONLY:true,NATIVE_PROVIDER_SETTINGS:true};
  if(path==='/api/obs/output'){
   const body=request.method==='POST'?await readBody(request):undefined;
   if(body&&body.action!=='output-heartbeat')throw problem('Een OBS-link kan geen uitzendbeeld of regie publiceren.');
   const response=await handleOutput(rewritten(request,'/api/output',body),native),data=await response.json();
   access=await verifyObsAccess(request,env);if(data.state)data.state=obsOutputState(await currentOutputState(env,access.ownerId,data.state),access);return json(data,response.status);
  }
  if(/^\/api\/obs\/clips\/[a-f0-9]{64}$/.test(path)&&request.method==='GET'){
   const clipId=path.split('/').at(-1);
   const assertClip=async current=>{const state=await currentOutputState(env,current.ownerId,current.state);if(state?.cancelledAt)throw problem('Deze show is geannuleerd. Het uitzendgeluid is gestopt.');
    if(state?.producer?.gameId===current.gameId&&state.snapshot?.gameId===current.gameId&&state.producer.until>Date.now()&&state.voice?.clip===clipId&&['prepare','play','pause'].includes(state.voice?.phase))return {kind:'published',fingerprint:JSON.stringify([state.producer.generation,state.voice.id,clipId])};
    const manifest=await buildShowAudioManifest(env,current.ownerId,current.gameId,{includeReadiness:false});if(!manifest.items.some(item=>item.key===clipId))throw problem('Dit stemfragment hoort niet bij de actuele uitzending.');
    return {kind:'prepared',fingerprint:manifest.fingerprint};
   };
   const before=await assertClip(access);
   const clip=await env.SETTINGS?.get(voicePath(access.ownerId,clipId));if(!clip)throw problem('Het actuele stemfragment is niet beschikbaar.',404,'clip_missing');
   const after=await assertClip(await verifyObsAccess(request,env));
   if(before.kind!==after.kind||before.fingerprint!==after.fingerprint)throw problem('De uitzending of stemvoorbereiding is intussen gewijzigd.',409,'show_audio_changed');
   if(after.kind==='prepared'&&(clip.customMetadata?.policyVersion!==SPEECH_POLICY_VERSION||clip.customMetadata?.scriptVerified!=='true'))throw problem('Dit stemfragment is nog niet gecontroleerd voorbereid.',409,'speech_not_prepared');
   return new Response(clip.body,{headers:{'Cache-Control':'private, no-store','Content-Type':clip.httpMetadata?.contentType||'audio/mpeg','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
  }
  if(['/api/obs/live-calls','/api/obs/live-calls/token','/api/obs/live-calls/realtime','/api/obs/live-calls/realtime-stop'].includes(path)){
   const body=request.method==='POST'?await readBody(request):undefined,role=body?.role||url.searchParams.get('role'),gameId=body?.gameId||url.searchParams.get('gameId');
   if(role!=='output'||gameId!==access.gameId)throw problem('Deze OBS-link hoort alleen bij het uitzendvenster van de gekozen show.');
   if(request.method==='GET'&&path!=='/api/obs/live-calls'||request.method==='POST'&&path==='/api/obs/live-calls'&&!['heartbeat','fail','magic-ready','magic-claim','magic-played','finish'].includes(body.action)||path.endsWith('/token')&&body?.target!=='live')throw problem('Deze belactie is niet beschikbaar voor OBS.');
   const routed=rewritten(request,path.replace('/api/obs/','/api/'),body);
   const run=async(locked,fetcher)=>{if(request.signal.aborted)throw problem('De OBS-aanvraag is geannuleerd.',408,'cancelled');access=await verifyObsAccess(request,env);return handleLiveCalls(routed,{...locked,OBS_ACCESS:access,OBS_REVALIDATE:()=>verifyObsAccess(request,env),PROVIDER_CLEANUP_FETCH:providerFetch},fetcher);};
   let response;
   if(request.method==='POST'&&['/api/obs/live-calls/token','/api/obs/live-calls/realtime'].includes(path)){
    response=await withProviderSettingsLock(native,async locked=>{assertProviderSettingsLease(locked);return run(locked,async(target,options={})=>{assertProviderSettingsLease(locked);if(request.signal.aborted)throw problem('De OBS-aanvraag is geannuleerd.',408,'cancelled');await verifyObsAccess(request,env);return providerFetch(target,{...options,signal:AbortSignal.any([request.signal,...(options.signal?[options.signal]:[]),...(locked.PROVIDER_SETTINGS_SIGNAL?[locked.PROVIDER_SETTINGS_SIGNAL]:[]),AbortSignal.timeout(Math.max(1,locked.PROVIDER_SETTINGS_DEADLINE-Date.now()))])});});});
   }else response=await run(native,providerFetch);
   await verifyObsAccess(request,env);const data=await response.json();if(data.call)data.call=obsLiveCall(data.call);return json(data,response.status);
  }
  throw problem('Deze functie is niet beschikbaar voor OBS.');
 }catch(error){return json({error:{message:error.status?error.message:'De OBS-verbinding kon niet worden bevestigd.',code:error.code||'obs_unavailable'}},error.status||503);}
}
