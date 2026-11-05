import {playerIdentity} from './player-identity.js';
import {ChatStore} from './chat-store.js';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const json=(data,status=200)=>Response.json(data,{status,headers});
class ChatError extends Error { constructor(message,status=400,code='invalid'){super(message);this.status=status;this.code=code;} }
const fail=(message,status,code)=>{throw new ChatError(message,status,code);};
const roleOf=(context,isHost)=>isHost?'host':context.member_role==='moderator'?'moderator':'player';
function authorize(context,identity) {
 if(!context)fail('Dit spel bestaat niet.',404,'not_found');
 const isHost=identity.admin&&context.owner_id===identity.user;
 if(identity.admin&&!isHost)fail('Dit spel hoort bij een andere host.',403,'forbidden');
 const linked=!!context.linked;
 if(!isHost&&!linked&&context.member_role!=='moderator')fail('Koppel eerst een deelnemend boekje voor deze show.',403,'not_participant');
 return isHost;
}
function selfOf(context,identity,now) {
 const host=authorize(context,identity),role=roleOf(context,host),mutedUntil=context.muted_until||0;
 let reason='';
 if(context.game.status==='finished')reason='De show is afgelopen. Je kunt de chat nog teruglezen.';
 else if(!host&&(context.family.blocked||context.family.blockedGames?.[context.game.id]))reason='Dit account is voor deze show geblokkeerd.';
 else if(mutedUntil>now)reason='Je account is tijdelijk gedempt door de moderatie.';
 const profiles=host?[]:(context.family.profiles||[]).map(p=>({id:p.id,name:p.name}));
 if(!reason&&!host&&!profiles.length)reason='Voeg eerst een speler toe aan je account.';
 return {memberId:context.member_id,role,mutedUntil,canSend:!reason,reason,profiles};
}
function payload(context,identity,after,now=Date.now()) {
 const self=selfOf(context,identity,now);
 if(after===null)return {messages:context.messages,cursor:context.cursor,hasMore:false,self,serverTime:now};
 const hasMore=context.events.length>100,events=context.events.slice(0,100).map(e=>{
  if(e.type==='message')return {seq:e.seq,type:e.type,message:e.message};
  if(e.type==='delete')return {seq:e.seq,type:e.type,messageId:e.messageId};
  return {seq:e.seq,type:e.type,member:e.member};
 });
 return {events,cursor:hasMore?events.at(-1).seq:context.cursor,hasMore,self,serverTime:now};
}
const cursorOf=value=>{if(value===null||value==='')return null;if(!/^\d{1,15}$/.test(value)||!Number.isSafeInteger(Number(value)))fail('Ongeldige chatcursor.',400,'cursor');return Number(value);};
async function bodyOf(request) {
 const raw=await request.text();if(new TextEncoder().encode(raw).length>8192)fail('Dit chatbericht is te groot.',413,'too_large');
 let body;try{body=JSON.parse(raw);}catch{fail('De aanvraag kon niet worden gelezen.');}
 if(!body||typeof body!=='object'||Array.isArray(body))fail('Ongeldige aanvraag.');
 if(typeof body.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId))fail('Een unieke aanvraagcode is verplicht.',400,'request_id');
 return body;
}
function chatText(value) {
 if(typeof value!=='string')fail('Vul een bericht in.',400,'text');
 const text=value.replace(/[\u0000-\u0008\u000B-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g,'').trim();
 if(!text)fail('Vul een bericht in.',400,'text');
 if([...text].length>500)fail('Een bericht mag maximaal 500 tekens bevatten.',400,'text');
 return text;
}
async function connected(store,gameId,identity,options) {
 let context=await store.read(gameId,identity.user,options);authorize(context,identity);
 if(!context.member_id){await store.join(context,identity.user);context=await store.read(gameId,identity.user,options);authorize(context,identity);if(!context.member_id)fail('De deelnemerslijst veranderde. Probeer opnieuw.',409,'conflict');}
 return context;
}
function streamChat(request,store,gameId,identity,initial,after) {
 const encoder=new TextEncoder();let cancelled=false,timer=null,wake=null,cleanup=()=>{};
 const stream=new ReadableStream({
  start(controller) {
   const stop=()=>{cancelled=true;if(timer!==null)clearTimeout(timer);timer=null;wake?.();wake=null;};
   const abort=()=>{stop();try{controller.close();}catch{}};
   request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();cleanup=()=>{stop();request.signal.removeEventListener('abort',abort);};
   const send=data=>{if(cancelled)return;controller.enqueue(encoder.encode(`id: ${data.cursor}\nevent: sync\ndata: ${JSON.stringify(data)}\n\n`));};
   const sleep=()=>new Promise(resolve=>{wake=resolve;timer=setTimeout(()=>{timer=null;wake=null;resolve();},1000);});
   void(async()=>{
    try {
     let context=initial,position=after;
     for(let ticks=0;ticks<=20&&!cancelled;ticks++) {
      const data=payload(context,identity,position);if(ticks===20)data.reconnect=true;send(data);position=data.cursor;
      if(ticks===20)break;
      if(!data.hasMore)await sleep();if(cancelled)break;
      context=await store.read(gameId,identity.user,{after:position});
     }
    }catch(error){if(!cancelled)controller.enqueue(encoder.encode(`event: chat-error\ndata: ${JSON.stringify({error:{code:error.code||'unavailable',message:error instanceof ChatError?error.message:'De chatverbinding is onderbroken.'}})}\n\n`));}
    finally {cleanup();try{controller.close();}catch{}}
   })();
  },
  cancel(){cleanup();},
 });
 return new Response(stream,{headers:{...headers,'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'private, no-cache, no-store, no-transform','X-Accel-Buffering':'no'}});
}
export async function handleChat(request,env={}) {
 const {user,email,admin}=await playerIdentity(request,env),url=new URL(request.url),match=url.pathname.match(/^\/api\/bingo\/games\/([a-f0-9-]{36})\/chat(?:\/(.*))?$/),write=!['GET','HEAD'].includes(request.method),identity={user,admin};
 if(!user)return json({error:{code:'sign_in',message:'Log in om mee te praten.'}},401);
 if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==url.origin||write&&(request.headers.get('origin')!==url.origin||request.headers.get('x-vlampie-bingo')!=='1'))return json({error:{code:'origin',message:'Gebruik de chat vanuit Vlampie’s Bingo.'}},403);
 if(!env.DB?.prepare||!env.DB?.batch)return json({error:{code:'unavailable',message:'De chat is tijdelijk niet beschikbaar.'}},503);
 try {
  if(!match)fail('Deze chatfunctie bestaat niet.',404,'not_found');
  const gameId=match[1],action=match[2]||'',store=new ChatStore(env.DB);await store.open(gameId);
  if(request.method==='GET') {
   const after=cursorOf(url.searchParams.get('after')??(action==='stream'?request.headers.get('Last-Event-ID'):null));
   let context=await connected(store,gameId,identity,{after,content:action!=='members',books:action==='members'});
   if(action==='members') {
    if(roleOf(context,authorize(context,identity))==='player')fail('Alleen de host en moderators kunnen deelnemers beheren.',403,'forbidden');
    await store.joinParticipants(context);context=await store.read(gameId,user,{members:true,content:false});
    if(roleOf(context,authorize(context,identity))==='player')fail('Je moderatorrol is gewijzigd.',403,'forbidden');
    const members=context.members.map(member=>{const role=member.accountId===context.owner_id?'host':member.role==='moderator'?'moderator':'player',names=role==='host'?['Host']:(member.family.profiles||[]).map(p=>p.name);return {memberId:member.id,name:names[0]||'Deelnemer',names,role,mutedUntil:member.mutedUntil};});
    return json({members,serverTime:Date.now()});
   }
   if(action==='stream')return streamChat(request,store,gameId,identity,context,after);
   if(action)fail('Deze chatfunctie bestaat niet.',404,'not_found');
   return json(payload(context,identity,after));
  }
  if(request.method!=='POST')fail('Deze methode is niet beschikbaar.',405,'method');
  const body=await bodyOf(request),deleteMatch=action.match(/^messages\/([a-f0-9-]{36})\/delete$/),memberMatch=action.match(/^members\/([a-f0-9-]{36})\/(mute|role)$/);
  if(action&&!deleteMatch&&!memberMatch)fail('Deze chatfunctie bestaat niet.',404,'not_found');
  const actionKey=!action?'message':deleteMatch?`delete:${deleteMatch[1]}`:`${memberMatch[2]}:${memberMatch[1]}`;
  await connected(store,gameId,identity,{content:false});
  for(let attempt=0;attempt<6;attempt++) {
   const context=await store.read(gameId,user,{content:false}),now=Date.now(),self=selfOf(context,identity,now),isHost=self.role==='host';
   const existing=await store.operation(gameId,user,body.requestId);
   if(existing) {
    if(existing.action!==actionKey)fail('Deze aanvraagcode is al voor een andere actie gebruikt.',409,'request_reused');
    if(!action){const saved=await store.message(gameId,existing.result_id);return json({message:saved.message},201);}
    return json({ok:true});
   }
   let message=null,member=null,deletedId=null,authorizationTarget=null,resultId;
   if(!action) {
    if(!self.canSend)fail(self.reason,403,context.game.status==='finished'?'finished':self.mutedUntil>now?'muted':'blocked');
    if(context.last_sent_at&&now-context.last_sent_at<2000)fail('Wacht even voordat je opnieuw een bericht stuurt.',429,'rate_limit');
    const text=chatText(body.text),profile=isHost?null:(context.family.profiles||[]).find(p=>p.id===body.profileId);
    if(!isHost&&!profile)fail('Kies een speler uit je eigen account.',400,'profile_invalid');
    message={id:crypto.randomUUID(),profileId:profile?.id||null,name:isHost?'Host':profile.name,role:self.role,text};resultId=message.id;
   }else {
    if(self.role==='player')fail('Alleen de host en moderators kunnen deze actie uitvoeren.',403,'forbidden');
    if(context.game.status==='finished'&&!deleteMatch&&!isHost)fail('De show is afgelopen. Alleen de host kan de moderatie nog beheren.',403,'finished');
    const targetMessage=deleteMatch?await store.message(gameId,deleteMatch[1]):null;
    if(deleteMatch&&!targetMessage)fail('Dit bericht bestaat niet.',404,'not_found');
    const target=await store.member(gameId,deleteMatch?targetMessage.message.memberId:memberMatch[1]);
    if(!target)fail('Deze deelnemer bestaat niet.',404,'not_found');
    authorizationTarget={id:target.id,role:target.role};
    const targetRole=target.account_id===context.owner_id?'host':target.role==='moderator'?'moderator':'player';
    const ownMessage=!!deleteMatch&&target.account_id===user;
    if(!ownMessage&&(target.account_id===user||targetRole==='host'||!isHost&&targetRole!=='player'))fail('Je kunt dit account niet modereren.',403,'forbidden');
    if(deleteMatch){deletedId=deleteMatch[1];resultId=deletedId;}
    else if(memberMatch[2]==='role') {
     if(!isHost)fail('Alleen de host kan moderators benoemen of verwijderen.',403,'forbidden');
     if(!['player','moderator'].includes(body.role))fail('Kies een geldige moderatorrol.',400,'role');
     member={id:target.id,role:body.role};resultId=target.id;
    }else {
     if(![0,60,300,900,3600,86400].includes(body.seconds))fail('Kies een geldige muteduur.',400,'duration');
     member={id:target.id,mutedUntil:body.seconds?now+body.seconds*1000:0};resultId=target.id;
    }
   }
   const saved=await store.commit(context,user,{requestId:body.requestId,action:actionKey,resultId,message,member,deletedId,authorizationTarget,now});
   if(saved) {
    if(message){const current=await store.message(gameId,message.id);return json({message:current.message},201);}
    return json({ok:true});
   }
  }
  fail('De chat is tegelijk bijgewerkt. Probeer opnieuw met dezelfde aanvraag.',409,'conflict');
 }catch(error) {
  if(error instanceof ChatError)return json({error:{code:error.code,message:error.message}},error.status);
  console.error('Showchat:',error?.name||'StorageError');return json({error:{code:'unavailable',message:'De chat kon de aanvraag niet bevestigen. Probeer opnieuw.'}},503);
 }
}
