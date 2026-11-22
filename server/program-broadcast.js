import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {lstat,open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {BingoStore} from './bingo-store.js';
import {playerIdentity} from './player-identity.js';
import {livekitJwt} from './livekit.js';
import {brandId} from './show-brands.js';

// This distribution room never shares credentials, participants or tracks with
// the private backstage/live-call rooms. Only the programme encoder publishes.
export const PROGRAM_PROFILE=Object.freeze({width:1280,height:720,fps:30,videoBitrate:1186000,audioBitrate:64000,totalBitrate:1250000,simulcast:false});
export const PROGRAM_TRACK_NAMES=Object.freeze({video:'programme-video',audio:'programme-audio'});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const generation=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const problem=(message,status=409,code='broadcast')=>Object.assign(Error(message),{status,code});
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Cookie'}});
const roomName=id=>'programme-'+id;
const publisherIdentity=id=>'programme-'+id;
const sourceName=id=>'milo-programme-'+id;
const stateOf=game=>game.programBroadcast?.version===1?game.programBroadcast:null;
const field=(record,snake,camel)=>record?.[snake]??record?.[camel];
const list=data=>Array.isArray(data.items)?data.items:[];
const activeEgress=entry=>[undefined,0,1,2,'EGRESS_STARTING','EGRESS_ACTIVE','EGRESS_ENDING'].includes(entry.status);
const mediaStatuses=new Map();

export function validateBroadcastConfiguration(value){
 if(!value||value.version!==1||value.enabled!==true)return null;
 let url;try{url=new URL(value.url);}catch{throw problem('De eigen uitzendserver is nog niet volledig ingesteld.',503,'broadcast_configuration');}
 if(url.protocol!=='wss:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||!url.hostname.includes('.')||/^\d+(?:\.\d+){3}$/.test(url.hostname))throw problem('De eigen uitzendserver vereist een beveiligde WSS-hostnaam.',503,'broadcast_configuration');
 if(!/^[A-Za-z0-9_-]{8,160}$/.test(value.apiKey||'')||typeof value.apiSecret!=='string'||value.apiSecret.length<32||value.apiSecret.length>500)throw problem('De eigen uitzendserver mist geldige serversleutels.',503,'broadcast_configuration');
 let hls=null;
 if(value.hls){
  const h=value.hls;
  if(!isAbsolute(h.root||'')||!isAbsolute(h.egressRoot||'')||!/^[a-f0-9]{64,128}$/.test(h.signingSecret||'')||h.root.includes('\0')||h.egressRoot.includes('\0'))throw problem('De tv-uitvoer is nog niet veilig ingesteld.',503,'broadcast_configuration');
  const receiverOrigins=[];if(h.receiverOrigins!==undefined){if(!Array.isArray(h.receiverOrigins)||h.receiverOrigins.length>8)throw problem('De tv-ontvangers zijn ongeldig ingesteld.',503,'broadcast_configuration');for(const value of h.receiverOrigins){let origin;try{origin=new URL(value);}catch{}if(!origin||origin.protocol!=='https:'||origin.origin!==value||origin.username||origin.password)throw problem('Gebruik alleen exacte HTTPS-origins voor tv-ontvangers.',503,'broadcast_configuration');receiverOrigins.push(value);}}
  hls={root:resolve(h.root),egressRoot:resolve(h.egressRoot),signingSecret:h.signingSecret,receiverOrigins,tokenSeconds:Math.max(300,Math.min(14400,Number.isSafeInteger(h.tokenSeconds)?h.tokenSeconds:14400))};
 }
 return {version:1,enabled:true,url:url.origin,apiKey:value.apiKey,apiSecret:value.apiSecret,hls,castAppId:/^[A-Fa-f0-9]{8}$/.test(value.castAppId||'')?value.castAppId:'CC1AD845'};
}
export async function broadcastConfiguration(env){
 // The path is set by the service, never by a request or show document. The
 // injected object is useful for isolated protocol tests, not a browser API.
 if(env.PROGRAM_BROADCAST_CONFIGURATION)return validateBroadcastConfiguration(env.PROGRAM_BROADCAST_CONFIGURATION);
 if(!env.MILO_BROADCAST_CONFIG)return null;
 if(!isAbsolute(env.MILO_BROADCAST_CONFIG))throw problem('De uitzendconfiguratie is niet beschikbaar.',503,'broadcast_configuration');
 let raw;try{
  if(await realpath(dirname(env.MILO_BROADCAST_CONFIG))!==dirname(env.MILO_BROADCAST_CONFIG))throw Error('no symlink ancestors');
  for(let parent=dirname(env.MILO_BROADCAST_CONFIG);;parent=dirname(parent)){const info=await lstat(parent);if(!info.isDirectory()||info.uid!==0||(info.mode&0o022))throw Error('root managed parents required');if(parent==='/')break;}
  const handle=await open(env.MILO_BROADCAST_CONFIG,constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await handle.stat();if(!info.isFile()||info.uid!==0||info.nlink!==1||info.size>16384||(info.mode&0o007)||(info.mode&0o022))throw Error('private configuration required');raw=await handle.readFile('utf8');}finally{await handle.close();}
 }catch{throw problem('De beschermde uitzendconfiguratie kan niet worden gelezen.',503,'broadcast_configuration');}
 try{return validateBroadcastConfiguration(JSON.parse(raw));}catch(error){if(error.status)throw error;throw problem('De uitzendconfiguratie is ongeldig.',503,'broadcast_configuration');}
}
export async function programService(settings,service,method,body,fetcher=fetch,{ignoreMissing=false}={}){
 const grants=service==='Ingress'?{ingressAdmin:true}:service==='Egress'?{roomRecord:true,room:body.room_name||''}:method==='ListRooms'?{roomList:true}:['CreateRoom','DeleteRoom'].includes(method)?{roomCreate:true}:{roomAdmin:true,room:body.room||body.name};
 const token=await livekitJwt(settings,{video:grants},{ttl:60});
 const response=await fetcher(settings.url.replace(/^wss:/,'https:')+'/twirp/livekit.'+service+'/'+method,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok){if(ignoreMissing){let code;try{code=(await response.json()).code;}catch{}if(['not_found','room_not_found','participant_not_found'].includes(code))return {};}throw problem('De uitzendserver bevestigt deze stap nog niet. Probeer opnieuw; de spelstand blijft behouden.',502,'broadcast_upstream');}
 try{return await response.json();}catch{throw problem('De uitzendserver gaf geen geldige bevestiging.',502,'broadcast_upstream');}
}
async function authorizedShow(request,env,id,{host=false}={}){
 const identity=await playerIdentity(request,env);if(!identity.user)throw problem('Log in om de uitzending te bekijken.',401,'sign_in');
 if(!env.DB?.prepare)throw problem('De showadministratie is tijdelijk niet beschikbaar.',503,'broadcast_storage');
 const store=new BingoStore(env.DB),row=await store.game(id);if(!row)throw problem('Deze show bestaat niet.',404,'show_missing');
 const ownHost=identity.admin===true&&row.owner_id===identity.user;
 if(host&&!ownHost||!ownHost&&!row.data.books.some(book=>book.accountId===identity.user&&book.admitted&&!book.revokedAt))throw problem('Deze uitzending hoort bij een geldig boekje voor deze show.',403,'broadcast_forbidden');
 if(!ownHost){const family=await env.DB.prepare('SELECT document FROM bingo_families WHERE account_id = ?').bind(identity.user).first();let data;try{data=JSON.parse(family?.document||'{}');}catch{throw problem('De toegang tot deze show kan niet worden bevestigd.',503,'broadcast_access');}if(data.blocked||data.blockedGames?.[id])throw problem('De toegang tot deze show is niet beschikbaar.',403,'broadcast_forbidden');}
 return {store,game:row.data,identity,ownHost};
}
function sameOrigin(request,write){const url=new URL(request.url),origin=request.headers.get('origin');if(request.headers.get('sec-fetch-site')==='cross-site'||origin&&origin!==url.origin||write&&(origin!==url.origin||request.headers.get('x-milo-broadcast')!=='1'))throw problem('Open de uitzending vanuit de familie-app of regie.',403,'origin');}
async function bodyOf(request){const raw=await request.text();if(Buffer.byteLength(raw)>4096)throw problem('De uitzendaanvraag is te groot.',413,'body_too_large');let body;try{body=JSON.parse(raw||'{}');}catch{throw problem('De uitzendaanvraag is ongeldig.',400,'body_invalid');}if(!body||typeof body!=='object'||Array.isArray(body))throw problem('De uitzendaanvraag is ongeldig.',400,'body_invalid');return body;}
async function programmeParticipant(settings,id,fetcher){const response=await programService(settings,'RoomService','ListParticipants',{room:roomName(id)},fetcher);return (response.participants||[]).find(person=>person.identity===publisherIdentity(id))||null;}
const programmeTracks=participant=>({video:(participant?.tracks||[]).find(track=>track.name===PROGRAM_TRACK_NAMES.video&&[1,'VIDEO'].includes(track.type)&&track.muted!==true),audio:(participant?.tracks||[]).find(track=>track.name===PROGRAM_TRACK_NAMES.audio&&[0,'AUDIO'].includes(track.type)&&track.muted!==true)});
async function hlsFile(settings,game,file){
 const state=stateOf(game);if(!settings.hls||!state||!generation(state.generation))return null;
 const root=await realpath(settings.hls.root),directory=join(root,game.id,state.generation);
 // Egress alone writes this root. Reject symlinks at every path component;
 // opening a regular file with O_NOFOLLOW prevents a swapped final symlink.
 if(await realpath(directory)!==directory)throw problem('De tv-uitvoer kan niet veilig worden gelezen.',503,'hls_storage');
 const handle=await open(join(directory,file),constants.O_RDONLY|constants.O_NOFOLLOW);const info=await handle.stat();
 if(!info.isFile()||info.nlink!==1||info.size>(file.endsWith('.m3u8')?131072:8*1024*1024)){await handle.close();throw problem('De tv-uitvoer is ongeldig.',503,'hls_storage');}
 return {handle,info};
}
async function hlsAvailable(settings,game){try{const file=await hlsFile(settings,game,'live.m3u8');if(!file)return false;try{const raw=await file.handle.readFile('utf8');return file.info.mtimeMs>Date.now()-15000&&raw.startsWith('#EXTM3U')&&/#EXTINF:/.test(raw)&&!raw.includes('#EXT-X-ENDLIST');}finally{await file.handle.close();}}catch{return false;}}
async function status(settings,game,fetcher,{queryProvider=true}={}){
 const state=stateOf(game),enabled=!!settings&&brandId(game)==='milo'&&state?.enabled===true;
 const base={providerConfigured:!!settings,enabled,provider:enabled?'livekit':null,state:game.cancelledAt||game.status==='finished'||state?.status==='stopped'?'ended':'waiting',profile:PROGRAM_PROFILE,programTrackNames:PROGRAM_TRACK_NAMES,publisherIdentity:publisherIdentity(game.id),hls:{available:false},castAppId:settings?.castAppId||'CC1AD845',serverTime:Date.now()};
 if(!enabled||base.state==='ended')return base;
 if(queryProvider){
  // Hundreds of viewers may poll together. One bounded provider query serves
  // them all; a failed query reports recovery, never a fabricated live state.
  const key=JSON.stringify([settings.url,settings.apiKey,game.id]);let cached=mediaStatuses.get(key);
  if(!cached||cached.until<Date.now()){cached={until:Date.now()+2000,pending:programmeParticipant(settings,game.id,fetcher).then(person=>{const tracks=programmeTracks(person);return tracks.audio&&tracks.video?'live':'waiting';},()=> 'reconnecting')};mediaStatuses.set(key,cached);while(mediaStatuses.size>64)mediaStatuses.delete(mediaStatuses.keys().next().value);}
  base.state=await cached.pending;
 }
 base.hls.available=await hlsAvailable(settings,game);return base;
}
export async function programViewerToken(settings,game,now=Date.now()){
 const identity='viewer-'+randomBytes(16).toString('hex');
 const token=await livekitJwt(settings,{sub:identity,video:{room:roomName(game.id),roomJoin:true,canSubscribe:true,canPublish:false,canPublishData:false,canPublishSources:[],canUpdateOwnMetadata:false}},{ttl:120,now});
 return {url:settings.url,token,room:roomName(game.id),identity,expiresAt:now+120000,publisherIdentity:publisherIdentity(game.id),programTrackNames:PROGRAM_TRACK_NAMES};
}
const capabilityBody=(game,expiresAt)=>Buffer.from(JSON.stringify({v:1,g:game.id,n:stateOf(game).generation,e:expiresAt})).toString('base64url');
const capabilitySignature=(settings,body)=>createHmac('sha256',Buffer.from(settings.hls.signingSecret,'hex')).update(body).digest('base64url');
export function programHlsCapability(settings,game,now=Date.now()){const expiresAt=now+settings.hls.tokenSeconds*1000,body=capabilityBody(game,expiresAt);return {capability:body+'.'+capabilitySignature(settings,body),expiresAt};}
export function verifyProgramHlsCapability(settings,token,now=Date.now()){
 if(!settings?.hls||typeof token!=='string'||token.length>512||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))throw problem('De tv-link is ongeldig of verlopen.',401,'hls_access');
 const [body,sig]=token.split('.'),actual=Buffer.from(sig),expected=Buffer.from(capabilitySignature(settings,body));if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw problem('De tv-link is ongeldig of verlopen.',401,'hls_access');
 let claims;try{claims=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));}catch{}
 if(!claims||claims.v!==1||!uuid(claims.g)||!generation(claims.n)||!Number.isSafeInteger(claims.e)||claims.e<=now||claims.e>now+14400000)throw problem('De tv-link is ongeldig of verlopen.',401,'hls_access');return claims;
}
function hlsAssetName(value){return typeof value==='string'&&/^(?:live\.m3u8|segment_[A-Za-z0-9_-]+\.ts)$/.test(value);}
export function rewriteProgramPlaylist(raw,prefix){
 if(!raw.startsWith('#EXTM3U')||raw.includes('\r')||raw.length>131072)throw problem('De tv-afspeellijst is ongeldig.',503,'hls_playlist');
 return raw.split('\n').map(line=>{if(!line||line.startsWith('#')){if(/URI\s*=/.test(line))throw problem('De tv-afspeellijst bevat een niet ondersteunde verwijzing.',503,'hls_playlist');return line;}if(!hlsAssetName(line)||!line.endsWith('.ts'))throw problem('De tv-afspeellijst verwijst naar een onbekend bestand.',503,'hls_playlist');return prefix+line;}).join('\n');
}

export async function handleProgramHls(request,env){
 const cors={'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Accept-Encoding, Range','Access-Control-Expose-Headers':'Content-Length, Content-Type','Cross-Origin-Resource-Policy':'cross-origin','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Vary':'Origin'};
 try{
  const settings=await broadcastConfiguration(env),url=new URL(request.url),origin=request.headers.get('origin');
  const allowedOrigins=new Set([url.origin,'https://www.gstatic.com',...(settings?.hls?.receiverOrigins||[])]);
  if(origin&&!allowedOrigins.has(origin))throw problem('Deze tv-ontvanger is niet ingesteld voor de uitzending.',403,'hls_origin');
  cors['Access-Control-Allow-Origin']=origin||url.origin;
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(!['GET','HEAD'].includes(request.method))throw problem('Deze tv-route is alleen leesbaar.',405,'method');
  const match=url.pathname.match(/^\/api\/broadcast\/hls\/([A-Za-z0-9_.-]+)\/([^/]+)$/);if(!match||url.search||!hlsAssetName(match[2]))throw problem('Deze tv-uitvoer bestaat niet.',404,'hls_missing');
  const claims=verifyProgramHlsCapability(settings,match[1]);
  const game=(await new BingoStore(env.DB).game(claims.g))?.data,state=stateOf(game||{});
  if(!game||brandId(game)!=='milo'||game.cancelledAt||state?.enabled!==true||state.status==='stopped'||state.generation!==claims.n)throw problem('Deze uitzending is gestopt of opnieuw ingesteld.',410,'hls_ended');
  let opened;try{opened=await hlsFile(settings,game,match[2]);}catch(error){if(error.code==='ENOENT')throw problem('De tv-uitzending wordt voorbereid. Probeer opnieuw.',404,'hls_waiting');throw error;}if(!opened)throw problem('De tv-uitvoer staat nog niet klaar.',404,'hls_waiting');
  const {handle,info}=opened,playlist=match[2].endsWith('.m3u8'),headers={...cors,'Cache-Control':playlist?'no-store, max-age=0':'private, max-age=60','Content-Type':playlist?'application/vnd.apple.mpegurl':'video/mp2t'};
  if(playlist){try{const raw=await handle.readFile('utf8'),body=rewriteProgramPlaylist(raw,url.origin+url.pathname.slice(0,url.pathname.lastIndexOf('/')+1));headers['Content-Length']=String(Buffer.byteLength(body));return new Response(request.method==='HEAD'?null:body,{headers});}finally{await handle.close();}}
  headers['Content-Length']=String(info.size);if(request.method==='HEAD'){await handle.close();return new Response(null,{headers});}
  return new Response(handle.readableWebStream({autoClose:true}),{headers});
 }catch(error){return Response.json({error:{code:error.code||'hls_unavailable',message:error.status?error.message:'De tv-uitzending is tijdelijk niet beschikbaar.'}},{status:error.status||503,headers:{...cors,'Cache-Control':'no-store'}});}
}

async function claimControl(store,gameId,user,action,requestId){
 const id=crypto.randomUUID(),result=await store.mutate(gameId,{authorize:game=>{if(game.ownerId!==user||brandId(game)!=='milo')throw problem('Alleen de regie van deze Milo-show kan de uitzending beheren.',403,'broadcast_forbidden');if((game.cancelledAt||game.status==='finished')&&!['stop','stop-hls'].includes(action))throw problem('Deze show is afgelopen.',409,'show_finished');}},(game,_family,now)=>{
  const prior=stateOf(game);if(prior?.control?.until>now)throw problem('Een uitzendstap wordt al uitgevoerd. Herlaad de status.',409,'broadcast_busy');
  if(!prior)game.programBroadcast={version:1,enabled:false,generation:randomBytes(16).toString('hex'),status:'prepared'};
  game.programBroadcast.control={id,action,requestId,until:now+90000};return id;
 });return {id,game:result.game};
}
async function saveControl(store,gameId,id,update,{release=true}={}){return store.mutate(gameId,{},game=>{if(stateOf(game)?.control?.id!==id)throw problem('De uitzendstap is intussen gewijzigd.',409,'broadcast_conflict');Object.assign(game.programBroadcast,update);if(release)delete game.programBroadcast.control;});}
async function controlBroadcast(store,game,identity,settings,body,fetcher){
 if(!['prepare','start-hls','stop-hls','stop'].includes(body.action)||!/^[A-Za-z0-9_-]{8,100}$/.test(body.requestId||''))throw problem('Kies een geldige uitzendstap.',400,'broadcast_action');
 const lease=await claimControl(store,game.id,identity.user,body.action,body.requestId),id=game.id;
 try{
  if(body.action==='prepare'){
   await programService(settings,'RoomService','CreateRoom',{name:roomName(id),empty_timeout:600,departure_timeout:30,max_participants:260},fetcher);
   const ingresses=list(await programService(settings,'Ingress','ListIngress',{room_name:roomName(id)},fetcher)).filter(item=>field(item,'participant_identity','participantIdentity')===publisherIdentity(id)&&item.name===sourceName(id));
   if(ingresses.length>1)throw problem('Er bestaan meerdere uitzendbronnen. Laat de beheerder deze eerst controleren.',409,'broadcast_source_conflict');
   const ingress=ingresses[0]||await programService(settings,'Ingress','CreateIngress',{input_type:'WHIP_INPUT',name:sourceName(id),room_name:roomName(id),participant_identity:publisherIdentity(id),participant_name:'Milo programma',enable_transcoding:false,audio:{name:PROGRAM_TRACK_NAMES.audio,source:'MICROPHONE'},video:{name:PROGRAM_TRACK_NAMES.video,source:'CAMERA'}},fetcher);
   const ingressId=field(ingress,'ingress_id','ingressId'),whipBase=ingress.url,streamKey=field(ingress,'stream_key','streamKey');let endpoint;try{endpoint=new URL(whipBase);}catch{}
   if(typeof ingressId!=='string'||!endpoint||endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.hash||endpoint.search||typeof streamKey!=='string'||!streamKey||streamKey.length>1024)throw problem('De uitzendbron gaf geen volledige WHIP-gegevens.',502,'broadcast_upstream');
   // Ingress returns the base URL and key separately, but a WHIP encoder POSTs
   // to the complete /whip/<key> endpoint. A Bearer header at /whip alone does
   // not select the ingress. Treat the resulting entire URL as a secret.
   const whipUrl=endpoint.origin+endpoint.pathname.replace(/\/$/,'')+'/'+encodeURIComponent(streamKey);
   if(ingresses.length&&stateOf(lease.game).status==='stopped')await programService(settings,'Ingress','UpdateIngress',{ingress_id:ingressId,enabled:true},fetcher);
   const saved=await saveControl(store,id,lease.id,{enabled:true,status:'prepared',ingressId,...(stateOf(lease.game).status==='stopped'?{generation:randomBytes(16).toString('hex'),egressId:null,egressStartedAt:null}:{})});
   return {status:await status(settings,saved.game,fetcher,{queryProvider:false}),whip:{url:whipUrl,bearerToken:streamKey},encoder:{...PROGRAM_PROFILE,videoCodec:'H264',audioCodec:'opus',keyframeSeconds:2},note:'OBS blijft uitzenden wanneer de regietab sluit. Houd OBS en het uitzendvenster met programmabeeld en -geluid geopend.'};
  }
  const egresses=list(await programService(settings,'Egress','ListEgress',{room_name:roomName(id),active:true},fetcher)).filter(activeEgress);
  if(['stop','stop-hls'].includes(body.action)){
   for(const entry of egresses)await programService(settings,'Egress','StopEgress',{egress_id:field(entry,'egress_id','egressId')},fetcher);
   if(body.action==='stop-hls'){const saved=await saveControl(store,id,lease.id,{egressId:null,egressStartedAt:null,generation:randomBytes(16).toString('hex')});return {status:await status(settings,saved.game,fetcher)};}
   if(stateOf(lease.game).ingressId)await programService(settings,'Ingress','UpdateIngress',{ingress_id:stateOf(lease.game).ingressId,enabled:false},fetcher,{ignoreMissing:true});
   await programService(settings,'RoomService','DeleteRoom',{room:roomName(id)},fetcher,{ignoreMissing:true});
   const saved=await saveControl(store,id,lease.id,{enabled:true,status:'stopped',stoppedAt:Date.now()});return {status:await status(settings,saved.game,fetcher,{queryProvider:false})};
  }
  if(!settings.hls)throw problem('De eigen tv-uitvoer is nog niet ingesteld.',503,'hls_configuration');
  if(egresses.length>1)throw problem('Er lopen meerdere tv-uitvoeren. Laat de beheerder deze controleren.',409,'hls_conflict');
  let egress=egresses[0];
  if(!egress){
   const tracks=programmeTracks(await programmeParticipant(settings,id,fetcher));if(!tracks.video||!tracks.audio)throw problem('Start eerst OBS met het programmabeeld en de uitzendmix.',409,'broadcast_waiting');
   // A new encoder starts segment numbering again. Give it a fresh durable
   // namespace so a receiver cannot replay old cached segments after restart.
   const reserved=await saveControl(store,id,lease.id,{generation:randomBytes(16).toString('hex'),egressId:null,egressStartedAt:null},{release:false});lease.game=reserved.game;
   const outputPath=join(settings.hls.egressRoot,id,stateOf(lease.game).generation);
   egress=await programService(settings,'Egress','StartEgress',{room_name:roomName(id),media:{video_track_id:tracks.video.sid,audio:{capture_all:false,routes:[{track_id:tracks.audio.sid,channel:'AUDIO_CHANNEL_BOTH'}]}},advanced:{width:1280,height:720,framerate:30,video_codec:'H264_MAIN',video_bitrate:1186,audio_codec:'AAC',audio_bitrate:64,key_frame_interval:2},outputs:[{segments:{protocol:'HLS_PROTOCOL',filename_prefix:outputPath+'/segment',playlist_name:outputPath+'/archive.m3u8',live_playlist_name:outputPath+'/live.m3u8',segment_duration:2,disable_manifest:true}}]},fetcher);
  }
  const egressId=field(egress,'egress_id','egressId');if(typeof egressId!=='string')throw problem('De tv-uitvoer gaf geen bevestiging.',502,'broadcast_upstream');
  const saved=await saveControl(store,id,lease.id,{enabled:true,status:'prepared',egressId,egressStartedAt:stateOf(lease.game).egressStartedAt||Date.now()});return {status:await status(settings,saved.game,fetcher)};
 }catch(error){
  // Unknown upstream completion is reconciled by ListIngress/ListEgress on a
  // deliberate retry. Never generate a second encoder from a timeout alone.
  const safeToRetry=['broadcast_waiting','hls_configuration','hls_conflict','broadcast_source_conflict'].includes(error.code);
  await saveControl(store,id,lease.id,{lastErrorAt:Date.now()},{release:safeToRetry}).catch(()=>{});
  if(!safeToRetry)error.retryAt=stateOf(lease.game).control.until;throw error;
 }
}
export async function handleProgramBroadcast(request,env,fetcher=fetch){
 try{
  const url=new URL(request.url),match=url.pathname.match(/^\/api\/broadcast\/([a-f0-9-]{36})\/(status|token|cast|control)$/);if(!match||!uuid(match[1]))throw problem('Deze uitzendroute bestaat niet.',404,'not_found');
  const write=request.method==='POST';if(request.method!==(match[2]==='status'?'GET':'POST'))throw problem('Deze uitzendaanvraag wordt niet ondersteund.',405,'method');sameOrigin(request,write);
  const {store,game,identity}=await authorizedShow(request,env,match[1],{host:match[2]==='control'}),settings=await broadcastConfiguration(env);
  if(match[2]==='status')return json(await status(settings,game,fetcher));
  const body=await bodyOf(request);if(!settings||brandId(game)!=='milo')throw problem('De eigen uitzending staat voor deze show nog niet aan.',503,'broadcast_disabled');
  if(match[2]==='control')return json(await controlBroadcast(store,game,identity,settings,body,fetcher));
  const state=stateOf(game);if(!state?.enabled||state.status==='stopped'||game.cancelledAt||game.status==='finished')throw problem('De uitzending is nog niet gestart of is afgelopen.',409,'broadcast_waiting');
  if(match[2]==='token')return json(await programViewerToken(settings,game));
  if(!await hlsAvailable(settings,game))throw problem('De tv-uitzending wordt nog voorbereid. Kijk intussen op dit scherm.',409,'hls_waiting');
  const cap=programHlsCapability(settings,game);return json({url:url.origin+'/api/broadcast/hls/'+cap.capability+'/live.m3u8',expiresAt:cap.expiresAt,mimeType:'application/vnd.apple.mpegurl',castAppId:settings.castAppId});
 }catch(error){return json({error:{code:error.code||'broadcast_unavailable',message:error.status?error.message:'De uitzending is tijdelijk niet beschikbaar. De spelstand blijft behouden.',...(Number.isSafeInteger(error.retryAt)?{retryAt:error.retryAt}:{})}},error.status||503);}
}
