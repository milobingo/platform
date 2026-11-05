import {playerIdentity} from './player-identity.js';
import {BingoStore} from './bingo-store.js';
import {readPrivateSetting,writePrivateSetting,settingsReady} from './secrets.js';
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
export async function livekitSettings(env){
 if(env.LIVEKIT_URL||env.LIVEKIT_API_KEY||env.LIVEKIT_API_SECRET)return {revision:null,source:'environment',value:{url:env.LIVEKIT_URL||'',apiKey:env.LIVEKIT_API_KEY||'',apiSecret:env.LIVEKIT_API_SECRET||'',connectionTest:null}};
 const saved=await readPrivateSetting(env,'livekit-cloud');return {...saved,value:saved.value||{url:'',apiKey:'',apiSecret:'',connectionTest:null}};
}
export const livekitConfigured=value=>!!value?.url&&!!value?.apiKey&&!!value?.apiSecret;
export function publicLivekit(saved){const p=saved.value;return {url:p.url||'',apiKey:p.apiKey||'',apiKeyConfigured:!!p.apiKey,secretConfigured:!!p.apiSecret,configured:livekitConfigured(p),revision:saved.revision,connectionTest:p.connectionTest||{tested:false,testedAt:null}};}
export async function roomService(settings,method,body={},fetcher=fetch,{ignoreMissing=false,now=Date.now()}={}){
 if(!livekitConfigured(settings))throw livekitError('Stel eerst de aparte LiveKit Cloud-koppeling in.',503);
 const room=body.room||body.name,video=method==='ListRooms'?{roomList:true}:['CreateRoom','DeleteRoom'].includes(method)?{roomCreate:true}:{roomAdmin:true,room};
 const token=await livekitJwt(settings,{video},{ttl:60,now}),url=settings.url.replace(/^wss:/,'https:')+'/twirp/livekit.RoomService/'+method;
 const response=await fetcher(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 if(!response.ok){let code='';try{code=(await response.json()).code||'';}catch{}if(ignoreMissing&&['not_found','participant_not_found','room_not_found'].includes(code))return {};throw livekitError(response.status===401||response.status===403?'LiveKit accepteert deze projectgegevens niet. Controleer de URL, API-key en API-secret.':'De LiveKit-verbinding kon niet worden bevestigd. De trekking blijft geblokkeerd.',502);}
 try{return await response.json();}catch{return {};}
}
export async function manageLivekitSettings(request,env,body,fetcher=fetch){
 if(!settingsReady(env))throw livekitError('De beveiligde instellingenopslag is niet beschikbaar.',503);
 const saved=await livekitSettings(env);if(request.method==='GET')return publicLivekit(saved);
 if(body.revision!==saved.revision)throw livekitError('De instellingen zijn gewijzigd. Herlaad deze pagina.');
 if(!['save','test'].includes(body.action||'save'))throw livekitError('Onbekende LiveKit-instelling.',400);
 const value=validateLivekit(body,saved.value);let tested=false,connectionTest={tested:false,testedAt:null};
 if(body.action==='test'){const data=await roomService(value,'ListRooms',{},fetcher);tested=true;connectionTest={tested:true,testedAt:Date.now(),roomCount:Array.isArray(data.rooms)?data.rooms.length:0};}
 else if(value.url===saved.value.url&&value.apiKey===saved.value.apiKey&&value.apiSecret===saved.value.apiSecret)connectionTest=saved.value.connectionTest||connectionTest;
 const result=await writePrivateSetting(env,'livekit-cloud',{...value,connectionTest},saved.revision);if(!result)throw livekitError('Een andere wijziging is net opgeslagen. Herlaad de instellingen.');
 return {...publicLivekit({value:{...value,connectionTest},revision:result.revision}),saved:true,tested};
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
   if(write&&env.DB){const current=await env.DB.prepare('SELECT document FROM studio_calls WHERE owner_id = ?').bind(identity.user).first();if(current){const call=JSON.parse(current.document);if(call?.transport==='livekit'&&call.phase!=='completed'){const saved=await livekitSettings(env),next=validateLivekit(body,saved.value);if(next.url!==saved.value.url||next.apiKey!==saved.value.apiKey||next.apiSecret!==saved.value.apiSecret)throw livekitError('Rond eerst het lopende belmoment en de terugkeer af voordat je de LiveKit-projectgegevens wijzigt.');}}}
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
