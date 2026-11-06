import {makeGame,playerGame,activeGoal,completionIndex} from '../server/bingo-model.js';
import {productionSettings} from '../server/production-model.js';
import {matchFamilyOrderDemo} from './family-order-demo.js';
import {resetOrderDemo} from './order-demo-store.js';

/** Explicit, browser-local examples. This module never calls fetch or a provider. */
export const FAMILY_DEMO_GAME_ID='milo-family-demo';
export const FAMILY_DEMO_FINISHED_ID='milo-family-demo-afgelopen';
const ACCOUNT_ID='family-demo-account';
const DEMO_ERROR='Demostand: er wordt geen echte microfoon-, LiveKit- of AI-verbinding geopend.';
let state;

export function isFamilyDemo(value=globalThis.location){
 try{
  const source=typeof value==='string'?value:value?.href||value?.search||'';
  return !!source&&new URL(source,'https://family-demo.invalid/').searchParams.get('demo')==='1';
 }catch{return false;}
}
const copy=value=>typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
const error=(message,status=409,code='demo_invalid')=>Object.assign(new Error(message),{status,code,simulated:true});
const aborted=signal=>{if(signal?.aborted)throw new DOMException('De voorbeeldactie is geannuleerd.','AbortError');};
const assertDemo=()=>{if(!isFamilyDemo())throw error('De voorbeeldgegevens zijn alleen beschikbaar in de expliciete demostand.',403,'demo_required');};
const random=seed=>{let n=seed>>>0;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};};
function demoCard(seed){
 const next=random(seed),card=Array(25);
 for(let column=0;column<5;column++){
  const numbers=Array.from({length:15},(_,i)=>column*15+i+1);
  for(let i=numbers.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[numbers[i],numbers[j]]=[numbers[j],numbers[i]];}
  for(let row=0;row<5;row++)card[row*5+column]=row===2&&column===2?0:numbers[row];
 }
 return card;
}
function result(game,{id,name,ticket,bookId,accountId=ACCOUNT_ID,title,description,roundIndex=0,goalIndex=0,delivered=false,now}){
 const entrant={name,ticket:String(ticket),bookId,accountId,completeAt:18};
 return {id,type:'bingo',roundIndex,goalIndex,completeAt:18,pattern:copy(game.plan.patterns.find(p=>p.id==='patroon-hoeken')||game.plan.patterns[0]),prize:{id:'demo-prijs-'+id,title,description,image:''},winner:entrant,entrants:[entrant],createdAt:now-720000,acknowledged:true,acknowledgedAt:now-690000,delivered,deliveredAt:delivered?now-660000:null,simulated:true};
}
function createGame(family,{id,brandId='milo',finished=false},now){
 const game=makeGame({brandId,title:brandId==='vlampie'?'Vlampie’s Bingo · Demovoorbeeld':finished?'Milo’s Magische BingoShow · Terugblik (demo)':'Milo’s Magische BingoShow · Live demovoorbeeld',date:'2026-11-11T13:30',roundCount:4},'family-demo-studio','https://family-demo.invalid',now);
 game.id=id;game.revision=1;
 game.books=family.profiles.map((profile,index)=>({id:id+'-boek-'+profile.id,code:'DEMO'+(1041+index),ticket:String(1041+index),token:'demo-niet-geldig-'+index,accountId:ACCOUNT_ID,profileId:profile.id,name:profile.name,age:profile.age,admitted:true,issueStatus:'assigned',batchId:'demo-batch',cards:Array.from({length:4},(_,round)=>demoCard((brandId==='vlampie'?7200:1041)+index*137+round*311))}));
 const rounds=game.plan.blocks.filter(block=>block.type==='round'),roundIndex=finished?3:1;
 const card=game.books[0].cards[roundIndex],corners=[card[0],card[4],card[20],card[24]];
 const pool=[...new Set([...corners,7,24,62,11,45,3,58,19,70,36,14,53,8,28,64,6,17,42,55,73,12,30,49,67,2,22,39,51,69,15,33,60,75])];
 // The final corner just appeared: the sample bingo is inside the normal
 // three-ball reporting margin, rather than an already stale completion.
 const lastCorner=corners.at(-1),drawn=finished?Array.from({length:75},(_,i)=>i+1):[...pool.filter(n=>n!==53&&n!==lastCorner).slice(0,26),lastCorner,53];
 game.status=finished?'finished':'running';game.startedAt=now-1800000;
 if(finished)game.finishedAt=now-120000;
 Object.assign(game.state,{phase:finished?'finished':'running',roundIndex,blockIndex:game.plan.blocks.indexOf(rounds[roundIndex]),goalIndex:0,epoch:'family-demo-epoch-'+id,drawn,history:[{roundIndex:0,drawn:[...pool],closedAt:now-900000}],goalOpenedAt:0,paused:false});
 game.production=productionSettings({calls:{enabled:!finished,instructions:'Demovoorbeeld: de aanmelding is fictief. Er wordt geen microfoon, LiveKit of OpenAI geopend.'},memory:{enabled:true,message:'Een magische voorbeeldherinnering aan Milo & Friends. Wat fijn dat jullie erbij waren!'}},game);
 game.presentationSnapshot={rules:[{id:'demo-boekje',title:'Ieder een eigen boekje',text:'Noor en Sem hebben allebei een uniek voorbeeldboekje met drie rondes en een finaleronde.'},{id:'demo-bingo',title:'Het patroon bepaalt de bingo',text:'In dit voorbeeld is Noors patroon in ronde 2 compleet. Probeer de BINGO-bal; de melding blijft binnen deze demostand.'},{id:'demo-privacy',title:'Alles is een voorbeeld',text:'Namen, berichten, prijzen en aanmeldingen zijn fictief. Er wordt niets naar de echte spelserver of uitzending verstuurd.'}]};
 game.participation=family.profiles.map((profile,index)=>({accountId:ACCOUNT_ID,profileId:profile.id,name:profile.name,greeting:index===0,greetingConsentAt:index===0?now-300000:null,greetingStatus:index===0?'requested':'none',callConsentAt:index===0&&!finished?now-180000:null,callStatus:index===0&&!finished?'requested':'none',parentConsent:true,microphone:false,connection:false,headphones:false,simulated:true}));
 game.results=[result(game,{id:id+'-prijs-noor',name:'Noor',ticket:1041,bookId:game.books[0].id,title:'Milo’s Goocheldoos',description:'Een vrolijke doos vol kaarttrucs, een toverstokje en een geheime goochelhandleiding.',delivered:true,now}),result(game,{id:id+'-prijs-lieke',name:'Lieke',ticket:1088,bookId:'demo-boek-lieke',accountId:'demo-ander-gezin',title:'De Sterrenknuffel',description:'Een zachte knuffel om na de show nog even mee te dromen.',goalIndex:1,now})];
 if(finished)game.results.push(result(game,{id:id+'-prijs-sem',name:'Sem',ticket:1042,bookId:game.books[1].id,title:'Het Magische Knutselpakket',description:'Maak je eigen sterrenvlinder en een kleurrijke goochelhoed.',roundIndex:2,now}));
 return game;
}
function createState(){
 const now=Date.now(),family={ownerName:'Familie Jansen',email:'familie.jansen@voorbeeld.invalid',profiles:[{id:'noor-demo',name:'Noor',age:8,dateOfBirth:'2018-02-14'},{id:'sem-demo',name:'Sem',age:6,dateOfBirth:'2020-03-22'}],blocked:false,blockedGames:{},cooldowns:{},falseCounts:{}};
 const games=new Map();
 for(const options of [{id:FAMILY_DEMO_GAME_ID},{id:FAMILY_DEMO_FINISHED_ID,finished:true},{id:'vlampie-family-demo',brandId:'vlampie'}])games.set(options.id,createGame(family,options,now));
 const lines=[['host','Studio','Welkom bij het live demovoorbeeld! Milo presenteert vandaag. ✨'],['player','Lieke','Wij zitten klaar met onze boekjes!'],['player','Jayden','Milo, hoe verdween dat sterretje nou? 🪄'],['host','Studio','Ronde 2 is begonnen. We spelen voor de vier hoeken.'],['player','Noor','Ik heb net nummer 24 afgestreept!'],['player','Fenna','Die goocheldoos ziet er mooi uit. 🎁'],['moderator','Team Bingo','Een gezellig berichtje mag altijd. Kies bij je bericht de juiste speler.'],['player','Sem','Onze stiften zijn er klaar voor! ⭐'],['player','Lieke','Veel geluk allemaal!'],['host','Studio','De laatste voorbeeldbal is 53. Kijk goed naar je vier hoeken!']];
 const messages=new Map([...games.keys()].map(id=>[id,lines.map(([role,name,text],index)=>({id:id+'-bericht-'+(index+1),seq:index+1,memberId:role==='host'?'demo-studio':role==='moderator'?'demo-moderator':name==='Noor'||name==='Sem'?ACCOUNT_ID:'demo-gezin-'+name.toLowerCase(),role,name,text,profileId:name==='Noor'?'noor-demo':name==='Sem'?'sem-demo':undefined,at:now-(lines.length-index)*45000,simulated:true}))]));
 return {family,games,messages,ops:new Map(),counter:0,authenticated:true};
}
const getState=()=>state??=(createState());
const identity=s=>({accountId:ACCOUNT_ID,family:s.family,host:false,serverTime:Date.now(),simulated:true,demo:true});
const snapshot=(s,game)=>({...identity(s),game:{...playerGame(game,ACCOUNT_ID),simulated:true,demo:true}});
const chatSelf=s=>({memberId:ACCOUNT_ID,role:'player',canSend:true,profiles:s.family.profiles,reason:'',simulated:true});
function chatSnapshot(s,game){const messages=s.messages.get(game.id);return {messages,cursor:messages.length,self:chatSelf(s),hasMore:false,serverTime:Date.now(),simulated:true,demo:true};}
function bodyData(body){if(body==null)return {};if(typeof body==='string'){try{return JSON.parse(body);}catch{throw error('Dit voorbeeldverzoek bevat geen geldige gegevens.',400);}}return body;}
function urlOf(input){const value=typeof input==='string'?input:input?.url;if(!value)throw error('Dit voorbeeldadres ontbreekt.',400);return new URL(value,globalThis.location?.href||'https://family-demo.invalid/');}

async function dispatch(input,{method='GET',body,signal}={}){
 aborted(signal);assertDemo();await Promise.resolve();aborted(signal);
 const url=urlOf(input),path=url.pathname,s=getState(),data=bodyData(body),verb=method.toUpperCase();
 const orderReply=matchFamilyOrderDemo(url,{method:verb,body:data,signal},s);if(orderReply!==undefined)return orderReply;
 if(/^\/api\/(?:livekit|live-calls|openai)(?:\/|$)/.test(path))throw error(DEMO_ERROR,409,'demo_provider_disabled');
 if(path==='/api/player/session'&&verb==='GET')return {authenticated:s.authenticated,method:'demo',needsOnboarding:false,...identity(s)};
 if(path==='/api/player/brand'&&verb==='GET')return {brandId:s.games.get(url.searchParams.get('game'))?.brandId||'milo',simulated:true};
 if(path==='/api/player/logout'&&verb==='POST'){s.authenticated=false;return {ok:true,simulated:true};}
 if(path==='/api/bingo/me'&&verb==='GET')return identity(s);
 if(path==='/api/bingo/games'&&verb==='GET')return {games:[...s.games.values()].map(({id,brandId,title,date,status})=>({id,brandId,title,date,status})),simulated:true};
 if(path==='/api/bingo/profiles'&&verb==='POST'){
  const name=String(data.name||'').trim(),birth=Date.parse(data.dateOfBirth);
  if(!name||name.length>40||!Number.isFinite(birth)||birth>Date.now()||s.family.profiles.length>=30)throw error('Vul een geldige voornaam en geboortedatum in.');
  const profile={id:'family-demo-profiel-'+(++s.counter),name,dateOfBirth:data.dateOfBirth,age:Math.floor((Date.now()-birth)/31557600000)};s.family.profiles.push(profile);return {...identity(s),result:profile};
 }
 const match=path.match(/^\/api\/bingo\/games\/([^/]+)(.*)$/),game=match&&s.games.get(decodeURIComponent(match[1]));
 if(!game)throw error('Deze functie is niet aangesloten in de demostand. Er is geen echte aanvraag verstuurd.',404,'demo_unsupported');
 const suffix=match[2],now=Date.now();
 if(!suffix&&verb==='GET')return snapshot(s,game);
 if(suffix==='/chat'&&verb==='GET')return chatSnapshot(s,game);
 if(suffix==='/chat'&&verb==='POST'){
  const text=String(data.text||'').trim(),profile=s.family.profiles.find(p=>p.id===data.profileId);
  if(!profile||!text||[...text].length>500)throw error('Kies een voorbeeldspeler en schrijf een bericht van maximaal 500 tekens.');
  const key=game.id+':chat:'+String(data.requestId||'');if(data.requestId&&s.ops.has(key))return s.ops.get(key);
  const messages=s.messages.get(game.id),message={id:game.id+'-bericht-'+(messages.length+1),seq:messages.length+1,memberId:ACCOUNT_ID,profileId:profile.id,name:profile.name,role:'player',text,at:now,simulated:true};messages.push(message);
  const response={...chatSnapshot(s,game),message};if(data.requestId)s.ops.set(key,response);return response;
 }
 if(suffix==='/chat/members'&&verb==='GET')return {members:[chatSelf(s),{memberId:'demo-studio',name:'Studio',role:'host'},{memberId:'demo-moderator',name:'Team Bingo',role:'moderator'}],simulated:true};
 if(suffix==='/participation'&&verb==='POST'){
  const profile=s.family.profiles.find(p=>p.id===data.profileId);if(!profile)throw error('Kies eerst een voorbeeldspeler.');
  let entry=game.participation.find(p=>p.profileId===profile.id);if(!entry){entry={accountId:ACCOUNT_ID,profileId:profile.id,name:profile.name,simulated:true};game.participation.push(entry);}
  if(data.kind==='greeting'){
   if(data.enabled&&!data.consent)throw error('Geef eerst toestemming voor de voorbeeldbegroeting.');
   Object.assign(entry,{greeting:!!data.enabled,greetingConsentAt:data.enabled?now:null,greetingStatus:data.enabled?'requested':'withdrawn'});
  }else if(data.kind==='call'){
   if(data.enabled&&(!data.consent||profile.age<18&&!data.parentConsent))throw error('Geef eerst toestemming voor de fictieve aanmelding.');
   Object.assign(entry,{callConsentAt:data.enabled?now:null,callStatus:data.enabled?'requested':'withdrawn',parentConsent:!!data.parentConsent,microphone:false,connection:false,micChecked:false,connectionChecked:false,headphones:false,simulated:true});
  }else throw error('Kies een voorbeeldbegroeting of fictieve belaanmelding.');
  game.revision++;return snapshot(s,game);
 }
 if(suffix==='/begin'&&verb==='POST'){
  if(game.status!=='running'||game.state.paused||game.state.drawHold)throw error('Deze voorbeeldshow staat niet klaar voor een bingomelding.');
  if(data.epoch!==game.state.epoch)throw error('Dit voorbeeldpatroon is gewijzigd. Open je melding opnieuw.');
  if(!game.state.window||game.state.window.status!=='open'||game.state.window.endsAt<=now)game.state.window={id:game.id+'-meldvenster-'+(++s.counter),status:'open',startedAt:now,endsAt:now+30000,frozenAt:game.state.drawn.length,announcements:[{accountId:ACCOUNT_ID,status:'accepted'}],claims:[]};
  game.state.phase='window';game.revision++;return snapshot(s,game);
 }
 if(suffix==='/claim'&&verb==='POST'){
  const book=game.books.find(b=>b.id===data.bookId&&b.accountId===ACCOUNT_ID),window=game.state.window,goal=activeGoal(game);
  if(!book||!window||data.windowId!==window.id||window.status!=='open'||window.endsAt<=now||!goal)throw error('Open eerst een geldig voorbeeldmeldvenster en kies je boekje.');
  const previous=window.claims.find(c=>c.bookId===book.id);if(previous)return {...snapshot(s,game),claim:previous};
  const raw=completionIndex(book.cards[game.state.roundIndex],goal.pattern,game.state.drawn),completeAt=raw===null?null:Math.max(raw,game.state.goalOpenedAt),claim={id:game.id+'-melding-'+(++s.counter),accountId:ACCOUNT_ID,profileId:book.profileId,bookId:book.id,status:completeAt===null?'false':window.frozenAt-completeAt>game.settings.retroBalls?'late':'valid',completeAt,createdAt:now,simulated:true};window.claims.push(claim);game.revision++;
  return {...snapshot(s,game),claim};
 }
 if(suffix==='/memory'&&verb==='GET'){
  const profile=s.family.profiles.find(p=>p.id===url.searchParams.get('profile'));if(!profile)throw error('Kies een voorbeeldspeler.');
  return {brandId:game.brandId,name:profile.name,title:game.title,date:game.date,message:game.production.memory.message,prizes:game.results.filter(r=>r.acknowledged&&r.winner.accountId===ACCOUNT_ID&&r.winner.name===profile.name).map(r=>r.prize.title),simulated:true,demo:true};
 }
 throw error('Deze functie is niet aangesloten in de demostand. Er is geen echte aanvraag verstuurd.',404,'demo_unsupported');
}

export async function requestFamilyDemo(base,path,options={}){return copy(await dispatch(base+path,options));}
export async function familyDemoFetch(input,options={}){
 try{return Response.json(copy(await dispatch(input,options)),{headers:{'X-Milo-Demo':'local-simulation'}});}
 catch(cause){if(cause.name==='AbortError')throw cause;return Response.json({error:{message:cause.message,code:cause.code||'demo_invalid'},simulated:true},{status:cause.status||500,headers:{'X-Milo-Demo':'local-simulation'}});}
}
export function resetFamilyDemo(){state=undefined;resetOrderDemo();}
/** Static watermarked sample, never a valid or account-specific player book. */
export function familyDemoPdf(mode='color'){return mode==='mono'?'/assets/milo-friends/example-mono.pdf':'/assets/milo-friends/example-color.pdf';}
