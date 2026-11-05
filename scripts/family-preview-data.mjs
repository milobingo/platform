// UI fixtures for preview-dev.mjs only. Never imported by the production Worker.
// Explicitly opt in with /spelen?voorbeeld=1. No credentials or provider calls.
import {makeGame,generateBooks,playerGame} from '../server/bingo-model.js';
import {productionSettings} from '../server/production-model.js';

const accountId='family-preview',origin='http://localhost';
const family={ownerName:'Sophie Jansen',email:'sophie@voorbeeld.invalid',profiles:[{id:'noor-preview',name:'Noor',age:8,dateOfBirth:'2018-02-14'},{id:'sem-preview',name:'Sem',age:6,dateOfBirth:'2020-03-22'}],blocked:false,blockedGames:{},cooldowns:{},falseCounts:{}};
const games=new Map();
for(const [brandId,id,title] of [['milo','milo-family-preview','Milo’s Magische BingoShow · Voorbeeld'],['vlampie','vlampie-family-preview','Vlampie’s Bingo · Voorbeeld']]){
 const game=makeGame({brandId,title,date:'2026-11-14T18:30',roundCount:3},'preview-host',origin);
 game.id=id;generateBooks(game,2,'preview-books-'+brandId);
 game.books.forEach((book,i)=>Object.assign(book,{id:brandId+'-book-'+i,accountId,profileId:family.profiles[i].id,name:family.profiles[i].name,age:family.profiles[i].age,admitted:true,ticket:1041+i}));
 game.production=productionSettings({calls:{enabled:true,instructions:'Voorbeeldweergave. Er wordt geen microfoon of LiveKit-verbinding geopend. In de echte show spreek je eerst privé met de regie.'},memory:{enabled:true,message:'Wat fijn dat jullie erbij waren. Een magische herinnering aan de voorbeeldshow.'}},game);
 game.presentationSnapshot={rules:[{title:'Iedere speler een eigen boekje',text:'Kijk naar het patroon, streep de genoemde nummers af en meld alleen een complete bingo.'},{title:'Samen een fijne show',text:'Groeten en belmomenten gaan altijd met toestemming van een ouder. De regie kiest het juiste moment.'}]};
 game.status='running';Object.assign(game.state,{phase:'running',roundIndex:0,blockIndex:game.plan.blocks.findIndex(b=>b.type==='round'),goalIndex:0,epoch:'preview-epoch-'+brandId,drawn:[7,24,62,11,45,3,58,19,70,36,14,53],paused:false});
 games.set(id,game);
}
const messages=[{id:'preview-host',seq:1,memberId:'preview-host',role:'host',name:'Studio',text:'Welkom op jullie familieplek! Leg de boekjes klaar, de magie begint zo. ✨',at:Date.now()-180000},{id:'preview-noor',seq:2,memberId:'preview-guest',role:'player',name:'Lieke',text:'Wij zitten er klaar voor. Veel plezier allemaal! 🌟',at:Date.now()-70000}];
let authenticated=true;
export function isFamilyPreview(req){try{const ref=new URL(req.headers.referer||'');return ref.pathname.startsWith('/spelen')&&ref.searchParams.get('voorbeeld')==='1';}catch{return false;}}
const identity=()=>({accountId,family,host:false,serverTime:Date.now()});
const snapshot=game=>({game:playerGame(game,accountId),family,serverTime:Date.now(),simulated:true});
async function bodyOf(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)throw Error('Te groot voorbeeldverzoek.');}return raw?JSON.parse(raw):{};}
export async function handleFamilyPreview(req,res,url){
 if(!isFamilyPreview(req))return false;
 const path=url.pathname,method=req.method||'GET';
 const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','X-Milo-Preview':'simulated'});res.end(JSON.stringify(data));return true;};
 const fail=message=>send({simulated:true,error:{message}},409);
 if(path==='/api/player/session')return send(authenticated?{authenticated:true,method:'email',needsOnboarding:false,...identity(),simulated:true}:{authenticated:false,simulated:true});
 if(path==='/api/player/brand')return send({brandId:games.get(url.searchParams.get('game'))?.brandId||'milo',simulated:true});
 if(path==='/api/player/logout'){authenticated=false;return send({ok:true,simulated:true});}
 if(path==='/api/bingo/me')return send(identity());
 if(path==='/api/bingo/games')return send({games:[...games.values()].map(({id,brandId,title,date,status})=>({id,brandId,title,date,status})),simulated:true});
 if(path==='/api/live-calls'&&method==='GET')return send({call:null,serverTime:Date.now(),simulated:true});
 if(path.startsWith('/api/live-calls')||path.startsWith('/api/livekit'))return fail('Dit is een UI-voorbeeld. LiveKit, microfoon en de echte uitzending zijn niet verbonden.');
 const match=path.match(/^\/api\/bingo\/games\/([^/]+)(.*)$/),game=match&&games.get(match[1]);
 if(game){
  const suffix=match[2];
  if(!suffix)return send(snapshot(game));
  if(suffix==='/chat/stream'){res.writeHead(204,{'X-Milo-Preview':'polling-only'});res.end();return true;}
  if(suffix==='/chat'){
   if(method==='POST'){const body=await bodyOf(req),profile=family.profiles.find(p=>p.id===body.profileId)||family.profiles[0],message={id:'preview-chat-'+(messages.length+1),seq:messages.length+1,memberId:accountId,role:'player',name:profile.name,text:String(body.text||'').slice(0,500),at:Date.now()};messages.push(message);}
   return send({messages,cursor:messages.length,self:{memberId:accountId,role:'player',canSend:true,profiles:family.profiles},serverTime:Date.now(),simulated:true});
  }
  if(suffix==='/chat/members')return send({members:[],simulated:true});
  if(suffix==='/participation'&&method==='POST'){
   const body=await bodyOf(req),profile=family.profiles.find(p=>p.id===body.profileId);if(!profile)return fail('Kies een voorbeeldspeler.');
   if(body.kind==='call')return fail('Een echte microfoon- en verbindingstest is in deze UI-preview niet beschikbaar.');
   game.participation??=[];let entry=game.participation.find(e=>e.profileId===profile.id);if(!entry){entry={accountId,profileId:profile.id,name:profile.name};game.participation.push(entry);}Object.assign(entry,{greetingConsentAt:Date.now(),greetingStatus:'requested'});game.revision=(game.revision||0)+1;return send(snapshot(game));
  }
  if(suffix==='/begin'&&method==='POST'){
   await bodyOf(req);game.state.window={id:'preview-window-'+game.brandId,status:'open',startedAt:Date.now(),endsAt:Date.now()+30000,announcements:[{accountId,status:'accepted'}],claims:[]};return send(snapshot(game));
  }
  if(suffix==='/claim'&&method==='POST'){
   const body=await bodyOf(req);if(!game.books.some(b=>b.id===body.bookId))return fail('Kies een voorbeeldboekje.');const claim={id:'preview-claim-'+Date.now(),bookId:body.bookId,accountId,status:'received'};game.state.window?.claims.push(claim);return send({...snapshot(game),claim});
  }
  if(suffix==='/memory')return send({brandId:game.brandId,name:family.profiles.find(p=>p.id===url.searchParams.get('profile'))?.name||'Jullie gezin',title:game.title,date:game.date,prizes:[],message:game.production.memory.message,simulated:true});
  if(suffix.includes('/pdf'))return fail('De UI-preview maakt geen echte bingokaarten. PDF-downloads werken met de gekoppelde spelserver.');
 }
 if(path==='/api/bingo/profiles'&&method==='POST'){const body=await bodyOf(req),birth=Date.parse(body.dateOfBirth);if(!body.name||!Number.isFinite(birth))return fail('Vul een naam en geboortedatum in.');family.profiles.push({id:'preview-person-'+family.profiles.length,name:String(body.name).slice(0,40),dateOfBirth:body.dateOfBirth,age:Math.floor((Date.now()-birth)/31557600000)});return send(identity());}
 return fail('Deze functie is niet aangesloten in de UI-preview. Er is geen echte aanvraag verstuurd.');
}
