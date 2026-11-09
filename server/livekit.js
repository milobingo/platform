import {playerIdentity} from './player-identity.js';
import {BingoStore} from './bingo-store.js';
import {readPrivateSetting,writePrivateSetting,settingsReady,providerTestReceipt} from './secrets.js';
import {withProviderSettingsLock,assertProviderRotationAllowed} from './node-provider-settings.js';
export const livekitError=(message,status=409)=>Object.assign(new Error(message),{status,code:'livekit'});
const encoder=new TextEncoder();
const base64url=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export async function livekitJwt(settings,claims,{ttl=120,now=Date.now()}={}){
 const seconds=Math.floor(now/1000),header=base64url(encoder.encode(JSON.stringify({alg:'HS256',typ:'JWT'}))),payload=base64url(encoder.encode(JSON.stringify({iss:settings.apiKey,iat:seconds,nbf:seconds-5,exp:seconds+ttl,...claims}))),input=header+'.'+payload;
 const key=await crypto.subtle.importKey('raw',encoder.encode(settings.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return input+'.'+base64url(await crypto.subtle.sign('HMAC',key,encoder.encode(input)));
}
export function validateLivekit(input,saved={}){
 let url;try{url=new URL(String(input.url||saved.url||'').trim());}catch{throw livekitError('Vul de LiveKit Cloud project-URL in, bijvoorbeeld wss://jouw-project.livekit.cloud.',400);}
 if(url.protocol!=='wss:'||!url.hostname.endsWith('.livekit.cloud')||url.username||url.password||url.port||url.search||url.hash||url.pathname!=='/')throw livekitError('Gebruik uitsluitend de wss:// project-URL van LiveKit Cloud.',400);
 const apiKey=String(input.apiKey||saved.apiKey||'').trim(),apiSecret=String(input.apiSecret||saved.apiSecret||'').trim();
 if(!/^[A-Za-z0-9_-]{8,160}$/.test(apiKey)||apiSecret.length<16||apiSecret.length>500)throw livekitError('Vul de LiveKit API-key en API-secret in. Een leeg secretveld behoudt het bestaande secret.',400);
 return {url:url.origin,apiKey,apiSecret};
}
const ENV_TEST='livekit-cloud-environment-test';
const NATIVE_LIVEKIT='native-provider-livekit';
const environmentManaged=env=>!!(env.LIVEKIT_URL||env.LIVEKIT_API_KEY||env.LIVEKIT_API_SECRET);
export const livekitCredentialFingerprint=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify([value.url,value.apiKey,value.apiSecret])))),byte=>byte.toString(16).padStart(2,'0')).join('');
const credentialFingerprint=livekitCredentialFingerprint;
export async function livekitSettings(env){
 if(env.NATIVE_PROVIDER_SETTINGS){
  const saved=await readPrivateSetting(env,NATIVE_LIVEKIT),record=saved.value;
  if(saved.revision!==null&&(!record||typeof record!=='object'||Array.isArray(record)||record.version!==1||!['regie','environment','disabled'].includes(record.mode)))throw livekitError('De opgeslagen LiveKit-instellingen kunnen niet veilig worden gelezen.',503);
  const environmentValue={url:env.LIVEKIT_URL||'',apiKey:env.LIVEKIT_API_KEY||'',apiSecret:env.LIVEKIT_API_SECRET||''};
  let value=record?.mode==='regie'?record.credentials:record?.mode==='disabled'?{url:'',apiKey:'',apiSecret:''}:environmentValue;
  if(record?.mode==='regie'){try{value=validateLivekit(value);}catch{throw livekitError('De opgeslagen LiveKit-instellingen zijn ongeldig. De serverkoppeling wordt niet als vervanging gebruikt.',503);}}
  const fingerprint=await credentialFingerprint(value),connectionTest=record?.fingerprint===fingerprint?providerTestReceipt(record.connectionTest):null;
  return {native:true,revision:saved.revision,mode:record?.mode||'environment',source:record?.mode==='regie'?'regie':environmentManaged(env)&&record?.mode!=='disabled'?'environment':'none',canManage:settingsReady(env),environmentConfigured:livekitConfigured(environmentValue),value:{...value,connectionTest}};
 }
 if(environmentManaged(env)){
  let value={url:env.LIVEKIT_URL||'',apiKey:env.LIVEKIT_API_KEY||'',apiSecret:env.LIVEKIT_API_SECRET||''};
  try{value=validateLivekit(value);}catch{}
  const saved=await readPrivateSetting(env,ENV_TEST),fingerprint=await credentialFingerprint(value);
  return {revision:saved.revision,source:'environment',value:{...value,connectionTest:saved.value?.fingerprint===fingerprint?saved.value.connectionTest:null}};
 }
 const saved=await readPrivateSetting(env,'livekit-cloud');return {...saved,source:'private',value:saved.value||{url:'',apiKey:'',apiSecret:'',connectionTest:null}};
}
export function livekitConfigured(value){try{validateLivekit(value||{});return true;}catch{return false;}}
export function publicLivekit(saved){const p=saved.value,managed=saved.source==='environment';return {url:p.url||'',apiKey:managed||saved.native?'':p.apiKey||'',apiKeyConfigured:!!p.apiKey,secretConfigured:!!p.apiSecret,configured:livekitConfigured(p),revision:saved.revision,source:saved.source||'private',canManage:saved.native?saved.canManage:!managed,...(saved.native?{environmentConfigured:saved.environmentConfigured,disabled:saved.mode==='disabled'}:{}),connectionTest:p.connectionTest||{tested:false,testedAt:null}};}
export async function roomService(settings,method,body={},fetcher=fetch,{ignoreMissing=false,now=Date.now()}={}){
 if(!livekitConfigured(settings))throw livekitError('Stel eerst de aparte LiveKit Cloud-koppeling in.',503);
 const room=body.room||body.name,video=method==='ListRooms'?{roomList:true}:['CreateRoom','DeleteRoom'].includes(method)?{roomCreate:true}:{roomAdmin:true,room};
 const token=await livekitJwt(settings,{video},{ttl:60,now}),url=settings.url.replace(/^wss:/,'https:')+'/twirp/livekit.RoomService/'+method;
 const response=await fetcher(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 if(!response.ok){let code='';try{code=(await response.json()).code||'';}catch{}if(ignoreMissing&&['not_found','participant_not_found','room_not_found'].includes(code))return {};throw livekitError(response.status===401||response.status===403?'LiveKit accepteert deze projectgegevens niet. Controleer de URL, API-key en API-secret.':'De LiveKit-verbinding kon niet worden bevestigd. De trekking blijft geblokkeerd.',502);}
 try{return await response.json();}catch{return {};}
}
export async function manageLivekitSettings(request,env,body,fetcher=fetch){
 if(env.NATIVE_PROVIDER_SETTINGS)return request.method==='GET'?publicLivekit(await livekitSettings(env)):withProviderSettingsLock(env,locked=>manageNativeLivekitSettings(request,locked,body,fetcher));
 if(!settingsReady(env))throw livekitError('De beveiligde instellingenopslag is niet beschikbaar.',503);
 const saved=await livekitSettings(env);if(request.method==='GET')return publicLivekit(saved);
 if(body.revision!==saved.revision)throw livekitError('De instellingen zijn gewijzigd. Herlaad deze pagina.');
 if(!['save','test'].includes(body.action||'save'))throw livekitError('Onbekende LiveKit-instelling.',400);
 const managed=saved.source==='environment';
 if(managed&&!livekitConfigured(saved.value))throw livekitError('De LiveKit-serverconfiguratie is onvolledig of ongeldig. Laat de projectgegevens in de serveromgeving controleren.',503);
 const value=validateLivekit(body,saved.value);
 if(managed&&(body.action!=='test'||value.url!==saved.value.url||value.apiKey!==saved.value.apiKey||value.apiSecret!==saved.value.apiSecret))throw livekitError('De LiveKit-projectgegevens worden op de server beheerd. Test de bestaande koppeling; wijzigingen verlopen via het omgevingsbeheer.',403);
 let tested=false,connectionTest={tested:false,testedAt:null};
 if(body.action==='test'){const data=await roomService(value,'ListRooms',{},fetcher);tested=true;connectionTest={tested:true,testedAt:Date.now(),roomCount:Array.isArray(data.rooms)?data.rooms.length:0};}
 else if(value.url===saved.value.url&&value.apiKey===saved.value.apiKey&&value.apiSecret===saved.value.apiSecret)connectionTest=saved.value.connectionTest||connectionTest;
 // Environment credentials remain exclusively on the server. Only a bound test
 // receipt is stored; its revision survives reloads and prevents stale writes.
 const stored=managed?{fingerprint:await credentialFingerprint(value),connectionTest}:{...value,connectionTest};
 const result=await writePrivateSetting(env,managed?ENV_TEST:'livekit-cloud',stored,saved.revision);if(!result)throw livekitError('Een andere wijziging is net opgeslagen. Herlaad de instellingen.');
 return {...publicLivekit({value:{...value,connectionTest},revision:result.revision,source:saved.source}),saved:true,tested};
}
async function manageNativeLivekitSettings(request,env,body,fetcher){
 const saved=await livekitSettings(env);if(request.method==='GET')return publicLivekit(saved);
 if(!settingsReady(env))throw livekitError('De beveiligde instellingenopslag is niet beschikbaar.',503);
 if(!['save','test','remove','environment'].includes(body.action)||!(body.revision===null||typeof body.revision==='string'&&body.revision.length>0&&body.revision.length<=128))throw livekitError('Ververs de instellingen en kies een geldige actie.',400);
 if(body.revision!==saved.revision)throw livekitError('De instellingen zijn gewijzigd. Herlaad deze pagina.');
 let mode=saved.mode,value=saved.value,connectionTest=null,failure;
 if(body.action==='test'){
  if(['url','apiKey','apiSecret'].some(field=>body[field]!==undefined))throw livekitError('Sla gewijzigde projectgegevens eerst op. Testen gebruikt alleen de opgeslagen koppeling.',400);
  if(!livekitConfigured(value))throw livekitError('Sla eerst volledige LiveKit-projectgegevens op.',503);
  try{const data=await roomService(value,'ListRooms',{},fetcher);connectionTest={tested:true,testedAt:Date.now(),roomCount:Array.isArray(data.rooms)?data.rooms.length:0};}
  catch(error){connectionTest={tested:false,testedAt:Date.now()};failure=error;}
 }else{
  await assertProviderRotationAllowed(env);
  if(body.action==='save'){
   if(['url','apiKey','apiSecret'].some(field=>body[field]!==undefined&&typeof body[field]!=='string'))throw livekitError('Gebruik volledige tekstvelden voor de LiveKit-projectgegevens.',400);
   const url=String(body.url||value.url||'').trim(),apiKey=String(body.apiKey||'').trim();
   let sameProject=false;try{sameProject=new URL(url).origin===value.url;}catch{}
   const retainedKey=apiKey||sameProject&&value.apiKey||'';
   const sameCredentials=sameProject&&retainedKey===value.apiKey;
   value=validateLivekit({url,apiKey:retainedKey,apiSecret:String(body.apiSecret||'').trim()||(sameCredentials?value.apiSecret:'')});mode='regie';
  }else if(body.action==='remove'){value={url:'',apiKey:'',apiSecret:''};mode='disabled';}
  else{value={url:env.LIVEKIT_URL||'',apiKey:env.LIVEKIT_API_KEY||'',apiSecret:env.LIVEKIT_API_SECRET||''};mode='environment';}
 }
 if(request.signal.aborted)throw livekitError('De aanvraag is geannuleerd.',408);
 const stored={version:1,mode,...(mode==='regie'?{credentials:{url:value.url,apiKey:value.apiKey,apiSecret:value.apiSecret}}:{}),fingerprint:await credentialFingerprint(value),connectionTest};
 const result=await writePrivateSetting(env,NATIVE_LIVEKIT,stored,saved.revision);if(!result)throw livekitError('Een andere wijziging is net opgeslagen. Herlaad de instellingen.');
 if(failure)throw failure;
 return {...publicLivekit({native:true,mode,source:mode==='regie'?'regie':environmentManaged(env)&&mode!=='disabled'?'environment':'none',canManage:true,environmentConfigured:livekitConfigured({url:env.LIVEKIT_URL,apiKey:env.LIVEKIT_API_KEY,apiSecret:env.LIVEKIT_API_SECRET}),value:{...value,connectionTest},revision:result.revision}),saved:true,tested:connectionTest?.tested===true};
}
export function callRooms(call){return {backstage:'bs-'+call.id,live:'live-'+call.id};}
export function callIdentities(call){return {participantIdentity:'guest-'+call.id,guestIdentity:'guest-'+call.id,outputIdentity:'output-'+call.id,hostIdentity:'host-'+call.id};}
export async function closeLivekitRoom(settings,call,target,fetcher=fetch,now=Date.now()){
 const room=callRooms(call)[target],ids=callIdentities(call),identities=target==='backstage'?[ids.hostIdentity,ids.participantIdentity]:[ids.outputIdentity,ids.participantIdentity,ids.hostIdentity];
 for(const identity of identities)await roomService(settings,'RemoveParticipant',{room,identity,revoke_token_ts:Math.floor(now/1000)},fetcher,{ignoreMissing:true,now});
 await roomService(settings,'DeleteRoom',{room},fetcher,{ignoreMissing:true,now});
}
export async function callRoomToken(settings,call,role,target,now=Date.now()){
 const ids=callIdentities(call),room=callRooms(call)[target],identity=role==='player'?ids.participantIdentity:role==='output'?ids.outputIdentity:ids.hostIdentity;
 const publish=target==='backstage'||role==='output'||role==='player'&&!call.muted;
 const allowedRemoteIdentities=target==='backstage'?[role==='host'?ids.participantIdentity:ids.hostIdentity]:role==='player'?[ids.outputIdentity]:role==='output'?[ids.participantIdentity]:[ids.participantIdentity,ids.outputIdentity];
 const token=await livekitJwt(settings,{sub:identity,video:{room,roomJoin:true,canPublish:publish,canSubscribe:true,canPublishData:false,canPublishSources:publish?['microphone']:[],canUpdateOwnMetadata:false}},{ttl:120,now});
 return {url:settings.url,token,room,identity,role,target,...ids,allowedRemoteIdentities,expiresAt:now+120000};
}

const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export async function handleLiveKit(request,env,fetcher=fetch){
 const url=new URL(request.url),identity=await playerIdentity(request,env),write=request.method==='POST';
 if(!identity.user)return json({error:'Log in om de belverbinding te controleren.'},401);
 if(!['GET','POST'].includes(request.method))return json({error:'Onbekende aanvraag.'},405);
 if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==url.origin||write&&(request.headers.get('origin')!==url.origin||request.headers.get('x-vlampie-call')!=='1'))return json({error:'Open de verbinding vanuit de familie-app of regie.'},403);
 try{
  let body={};if(write){const raw=await request.text();if(raw.length>6000)throw livekitError('De instellingen zijn te groot.',413);body=JSON.parse(raw);}
  if(url.pathname==='/api/livekit/settings'){
   if(!identity.admin)throw livekitError('Alleen de regie kan de LiveKit-koppeling instellen.',403);
   if(env.NATIVE_PROVIDER_SETTINGS&&(request.headers.get('x-vlampie-player')==='1'||url.searchParams.get('player')==='1'))throw livekitError('Open de instellingen vanuit de regie.',403);
   if(!env.NATIVE_PROVIDER_SETTINGS&&write&&env.DB){const current=await env.DB.prepare('SELECT document FROM studio_calls WHERE owner_id = ?').bind(identity.user).first();if(current){const call=JSON.parse(current.document);if(call?.transport==='livekit'&&call.phase!=='completed'){const saved=await livekitSettings(env);if(saved.source!=='environment'){const next=validateLivekit(body,saved.value);if(next.url!==saved.value.url||next.apiKey!==saved.value.apiKey||next.apiSecret!==saved.value.apiSecret)throw livekitError('Rond eerst het lopende belmoment en de terugkeer af voordat je de LiveKit-projectgegevens wijzigt.');}}}}
   return json(await manageLivekitSettings(request,env,body,fetcher));
  }
  if(url.pathname!=='/api/livekit/preflight'||!write)throw livekitError('Onbekende LiveKit-route.',404);
  if(!env.DB)throw livekitError('De spelserver is niet beschikbaar.',503);
  const store=new BingoStore(env.DB),row=await store.game(body.gameId);if(!row)throw livekitError('Kies eerst een show.',404);
  const family=await store.family(identity.user,identity.email),profile=family.data.profiles.find(p=>p.id===body.profileId);
  if(!profile||!row.data.books.some(b=>b.accountId===identity.user&&b.profileId===profile.id&&b.admitted&&!b.revokedAt))throw livekitError('Koppel eerst een geldig boekje aan deze speler.',403);
  const settings=(await livekitSettings(env)).value;if(!livekitConfigured(settings))throw livekitError('De host heeft LiveKit Cloud nog niet gekoppeld. Er is geen echte verbindingsproef gestart.',503);
  const now=Date.now();await store.mutate(row.data.id,{},g=>{const checks=g.livekitPreflights??={},old=checks[identity.user]||{at:0,count:0};if(old.at>now-20000||old.count>=30)throw livekitError('Wacht even voordat je de verbinding opnieuw test.',429);checks[identity.user]={at:now,count:old.count+1};});
  const id=crypto.randomUUID(),room='check-'+id,participant='check-'+crypto.randomUUID();
  await roomService(settings,'CreateRoom',{name:room,empty_timeout:30,departure_timeout:1,max_participants:1},fetcher);
  const token=await livekitJwt(settings,{sub:participant,video:{room,roomJoin:true,canPublish:false,canSubscribe:false,canPublishData:false,canUpdateOwnMetadata:false}},{ttl:60,now});
  return json({url:settings.url,token,room,identity:participant,role:'player',target:'preflight',allowedRemoteIdentities:[],expiresAt:now+60000,simulated:false});
 }catch(error){return json({error:error.status?error.message:'De LiveKit-verbinding kon niet worden bevestigd.'},error.status||503);}
}
