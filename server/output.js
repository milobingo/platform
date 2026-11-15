import {platformIdentity} from './player-identity.js';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const cancelledMessage='Deze show is geannuleerd.';
function cancelledOutput(state,game){
 return {...state,cancelledAt:game.cancelledAt,cancelledGameId:game.id,routing:false,voice:null,events:[],output:null,
  snapshot:{...state.snapshot,gameId:game.id,cancelledAt:game.cancelledAt,paused:true,speaking:false,speechActive:false,mouth:0,caption:cancelledMessage,liveCall:null,showCue:null,movement:null,magic:null},
  show:state.show?{...state.show,paused:true,liveCall:null,externalHold:true,drawBlocked:true,gameStage:null,flow:'cancelled',kind:'cancelled',title:'Show geannuleerd',countdown:0}:null};
}
// Read the game again even when an old producer has not observed cancellation.
// This also keeps a failed best-effort relay cleanup from exposing old audio.
export async function currentOutputState(env,owner,state){
 const gameId=state?.producer?.gameId||state?.snapshot?.gameId;if(!gameId)return state;
 const row=await env.DB.prepare('SELECT owner_id,document FROM bingo_games WHERE id = ?').bind(gameId).first();
 const game=row?.owner_id===owner?JSON.parse(row.document):null;return game?.cancelledAt?cancelledOutput(state,game):state;
}
export async function cancelGameOutput(env,owner,gameId){
 for(let attempt=0;attempt<8;attempt++){
  const row=await env.DB.prepare('SELECT * FROM studio_outputs WHERE owner_id = ?').bind(owner).first();if(!row)return {pending:false};
  const state=JSON.parse(row.document);if(state.producer?.gameId!==gameId&&state.snapshot?.gameId!==gameId)return {pending:false};
  const next=await currentOutputState(env,owner,state);if(!next.cancelledAt)return {pending:false};
  const saved=await env.DB.prepare('UPDATE studio_outputs SET revision = ?,document = ? WHERE owner_id = ? AND revision = ? RETURNING revision').bind(row.revision+1,JSON.stringify(next),owner,row.revision).first();if(saved)return {pending:false};
 }
 return {pending:true};
}
// Access hashes never belong in producer or output responses.
export function publicOutputState(state){if(!state)return null;const {obsAccess:unused,...visible}=state;if(visible.output){const {obsAccessId:marker,...output}=visible.output;visible.output=output;}return visible;}
function assertScopedOutput(state,access,now=Date.now()){
 if(!access)return;const saved=state?.obsAccess;
 if(!saved||saved.id!==access.id||saved.hash!==access.hash||saved.gameId!==access.gameId||saved.expiresAt<=now)throw Object.assign(new Error('De OBS-link is ingetrokken of verlopen.'),{status:401});
}
export async function handleOutput(request,env){
 const url=new URL(request.url),access=env.OBS_ACCESS,{user,admin}=access?{user:access.ownerId,admin:false}:platformIdentity(request,env);
 if(!user||!admin&&!access)return json({error:'Alleen de host kan het uitzendvenster openen.'},403);
 if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==url.origin||request.method==='POST'&&(request.headers.get('origin')!==url.origin||request.headers.get('x-vlampie-output')!=='1'))return json({error:'Open de uitzending vanuit de studio.'},403);
 if(!env.DB)return json({error:'De uitzendverbinding is tijdelijk niet beschikbaar.'},503);
 try{
  if(request.method==='GET'){const row=await env.DB.prepare('SELECT document FROM studio_outputs WHERE owner_id = ?').bind(user).first();const state=await currentOutputState(env,user,row?JSON.parse(row.document):null);assertScopedOutput(state,access);return json({state:publicOutputState(state),serverTime:Date.now()});}
  if(request.method!=='POST')return json({error:'Onbekende aanvraag.'},405);
  const raw=await request.text();if(new TextEncoder().encode(raw).length>400000)return json({error:'Uitzendbericht te groot.'},413);const body=JSON.parse(raw),id=body.clientId;
  if(access&&body.action!=='output-heartbeat')return json({error:'Deze OBS-link kan alleen het uitzendvenster verbinden.'},403);
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))return json({error:'Ongeldig uitzendvenster.'},400);
  await env.DB.prepare('INSERT INTO studio_outputs (owner_id,revision,document) VALUES (?,0,?) ON CONFLICT(owner_id) DO NOTHING').bind(user,JSON.stringify({producer:null,output:null,snapshot:null,seq:0,events:[],voice:null,mixer:{voice:100,music:25,effects:50},routing:false})).run();
  for(let i=0;i<6;i++){
   const row=await env.DB.prepare('SELECT * FROM studio_outputs WHERE owner_id = ?').bind(user).first(),s=JSON.parse(row.document),now=Date.now();let gameGuard=null;
   assertScopedOutput(s,access,now);
   const current=await currentOutputState(env,user,s);
   if(current?.cancelledAt&&body.action==='output-heartbeat')return json({state:publicOutputState(current),serverTime:now});
   if(access&&(s.producer?.gameId!==access.gameId||s.snapshot?.gameId!==access.gameId||s.producer?.until<=now))return json({error:'De OBS-link wacht op het actuele uitzendbeeld van de gekozen show.'},409);
   if(['producer-claim','publish'].includes(body.action)){
    const gameId=Object.hasOwn(body,'gameId')?body.gameId:s.producer?.gameId||s.snapshot?.gameId;let controlsGame=false;
    if(gameId){const game=await env.DB.prepare('SELECT owner_id,revision,document FROM bingo_games WHERE id = ?').bind(gameId).first();if(!game||game.owner_id!==user)return json({error:'Spel niet beschikbaar.'},403);const g=JSON.parse(game.document);if(g.cancelledAt)return json({error:cancelledMessage,code:'show_cancelled',state:publicOutputState(cancelledOutput(s,g)),serverTime:now},409);gameGuard={id:gameId,revision:game.revision};controlsGame=g.state.control?.until>now&&g.state.control.id===id;if(g.status==='running'&&!controlsGame)return json({error:'Neem eerst bevoegd de spelregie over voordat je het uitzendbeeld levert.'},409);}
    if(s.producer&&s.producer.id!==id&&s.producer.until>now&&!(body.action==='producer-claim'&&body.takeover===true&&controlsGame))return json({error:'Een ander regievenster levert het uitzendbeeld.'},409);
    if(typeof body.instanceId!=='string'||!/^[a-f0-9-]{36}$/.test(body.instanceId))return json({error:'Open het regievenster opnieuw.'},400);
    if(body.action==='producer-claim'){
     const same=s.producer?.id===id&&s.producer.instanceId===body.instanceId&&s.producer.until>now&&s.producer.gameId===(gameId||null);
     if(!same&&body.expectedGeneration!==(s.generation||0))return json({error:'De uitzendbron is intussen gewijzigd. Controleer eerst de actuele regie.'},409);
     if(s.producer?.id!==id||s.producer.instanceId!==body.instanceId||s.producer.until<=now||s.producer.gameId!==(gameId||null)){s.generation=(s.generation||0)+1;s.seq=0;s.events=[];s.voice=null;s.publishedAt=null;s.snapshot=null;s.show=null;s.routing=false;delete s.cancelledAt;delete s.cancelledGameId;}
     s.producer={id,instanceId:body.instanceId,generation:s.generation,gameId:gameId||null,until:now+15000};
    }else{
     if(s.producer?.id!==id||s.producer.instanceId!==body.instanceId||s.producer.until<=now||body.generation!==s.producer.generation||s.producer.gameId!==(gameId||null))return json({error:'Deze uitzendgeneratie is verlopen. Neem bewust opnieuw de regie over.'},409);
     if(!Number.isSafeInteger(body.seq)||body.seq<=s.seq)return json({error:'Dit beeldbericht is achterhaald en is niet gepubliceerd.'},409);
     s.producer.until=now+15000;s.seq=body.seq;s.publishedAt=now;s.snapshot=body.snapshot;s.show=body.show;s.voice=body.voice||null;s.routing=!!body.routing;s.events=(body.events||[]).filter(e=>typeof e.id==='string'&&e.at>now-10000).slice(-30);s.mixer=Object.fromEntries(['voice','music','effects'].map(k=>[k,Math.max(0,Math.min(100,Number(body.mixer?.[k])||0))]));
    }
   }else if(body.action==='output-heartbeat'){
    if(s.output&&s.output.id!==id&&s.output.until>now)return json({error:'Een ander uitzendvenster verzorgt het geluid.',state:publicOutputState(s)},409);
    const rendered=body.generation===s.producer?.generation&&Number.isSafeInteger(body.seq)&&body.seq>0&&body.seq<=s.seq;
    s.output={id,...(access?{obsAccessId:access.id}:{}),until:now+7000,at:now,audioReady:!!body.audioReady,audioPlayedAt:body.audioReady&&Number.isSafeInteger(body.audioPlayedAt)&&body.audioPlayedAt>0&&body.audioPlayedAt<=now+5000?body.audioPlayedAt:null,testAck:body.testAck&&typeof body.testAck.id==='string'&&/^[a-f0-9-]{36}$/.test(body.testAck.id)&&['played','error'].includes(body.testAck.status)?{id:body.testAck.id,status:body.testAck.status,at:s.output?.testAck?.id===body.testAck.id&&s.output.testAck.status===body.testAck.status?s.output.testAck.at:now,error:String(body.testAck.error||'').slice(0,200)}:null,generation:rendered?body.generation:null,seq:rendered?body.seq:0,meters:body.meters?Object.fromEntries(['voice','music','effects'].map(k=>[k,Math.max(0,Math.min(1,Number(body.meters[k])||0))])):{},voiceAck:rendered&&body.voiceAck&&typeof body.voiceAck.id==='string'?{id:body.voiceAck.id,status:['loading','starting','ready','playing','paused','ended','error'].includes(body.voiceAck.status)?body.voiceAck.status:'error',elapsed:Math.max(0,Math.min(120000,Number(body.voiceAck.elapsed)||0)),error:String(body.voiceAck.error||'').slice(0,200)}:null};
   }else return json({error:'Onbekende uitzendactie.'},400);
   const update=env.DB.prepare('UPDATE studio_outputs SET revision = ?,document = ? WHERE owner_id = ? AND revision = ?'+(gameGuard?' AND EXISTS (SELECT 1 FROM bingo_games WHERE id = ? AND owner_id = ? AND revision = ?)':'')+' RETURNING revision').bind(row.revision+1,JSON.stringify(s),user,row.revision,...(gameGuard?[gameGuard.id,user,gameGuard.revision]:[]));
   // Lock and compare the actual game in the same transaction as publication.
   // Cancellation either follows this packet and removes it, or wins the CAS
   // and makes this entire stale publication roll back.
   let saved;if(gameGuard){const result=await env.DB.batch([env.DB.prepare('UPDATE bingo_games SET revision = revision WHERE id = ? AND owner_id = ? AND revision = ? RETURNING revision').bind(gameGuard.id,user,gameGuard.revision),update]);saved=result[0]?.results?.length&&result[1]?.results?.length;}else saved=await update.first();if(saved)return json({state:publicOutputState(await currentOutputState(env,user,s)),serverTime:now});
  }return json({error:'De uitzendverbinding is bezig. Probeer opnieuw.'},409);
 }catch(error){return json({error:error.status?error.message:'De uitzendverbinding is onderbroken.'},error.status||503);}
}
