import {brandId} from './show-brands.js';
import {recordAccountWelcome,recoverAccountWelcome} from './account-mail.js';
import {BingoStore} from './bingo-store.js';
import {playerIdentity,birthAge,refreshAges} from './player-identity.js';

const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200)=>Response.json(data,{status,headers});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};

// Passwordless login and logout are dispatched through node-auth.js. Legacy
// Resend challenges and player_sessions are deliberately never accepted here.
export async function handlePlayerAuth(request,env={}){
 const url=new URL(request.url),path=url.pathname.slice('/api/player'.length),write=!['GET','HEAD'].includes(request.method);
 try{
  if(['/request-code','/verify-code','/logout','/mail-settings'].includes(path))return json({error:{code:'supabase_auth_required',message:'Aanmelden en e-mail worden via Supabase Auth beheerd.'}},410);
  if(!env.DB?.prepare)fail('Aanmelden is tijdelijk niet beschikbaar.',503);
  if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==url.origin||write&&(request.headers.get('origin')!==url.origin||request.headers.get('x-vlampie-player')!=='1'))fail('Open deze functie vanuit de spelersapp.',403);
  let body={};if(write){const raw=await request.text();if(new TextEncoder().encode(raw).length>5000)fail('De aanvraag is te groot.',413);try{body=JSON.parse(raw||'{}');}catch{fail('De aanvraag is niet leesbaar.');}}
  if(path==='/brand'&&request.method==='GET'){
   const gameId=url.searchParams.get('game');if(!/^[a-f0-9-]{36}$/.test(gameId||''))fail('Ongeldig spel.');
   const row=await new BingoStore(env.DB).game(gameId);if(!row)fail('Dit spel bestaat niet.',404);return json({brandId:brandId(row.data)});
  }
  const identity=await playerIdentity(request,env);
  if(path==='/session'&&request.method==='GET'){
   if(!identity.user)return json({authenticated:false});
   const family=refreshAges((await new BingoStore(env.DB).family(identity.user,identity.email)).data);
   return json({authenticated:true,accountId:identity.user,email:identity.email,method:identity.method,host:identity.admin,family,needsOnboarding:!identity.admin&&!family.onboardingComplete});
  }
  if(path==='/onboarding'&&request.method==='POST'){
   if(!identity.user)fail('Log eerst in.',401);
   const name=String(body.name||'').trim(),dateOfBirth=body.dateOfBirth,welcomeBrand=body.brandId||'milo';let age;
   if(!['milo','vlampie'].includes(welcomeBrand))fail('Kies een geldige showwereld.');
   try{age=birthAge(dateOfBirth);}catch(error){fail(error.message);}
   if(!name||name.length>40||/[<>\x00-\x1f]/.test(name))fail('Vul je voornaam in (maximaal 40 tekens).');
   const saved=await new BingoStore(env.DB).editFamily(identity.user,identity.email,f=>{
    let profile=f.profiles.find(p=>p.id===(body.profileId||f.accountProfileId));
    if(body.profileId&&!profile)fail('Deze speler hoort niet bij jouw account.',403);
    if(!profile){if(f.profiles.length>=30)fail('Dit account heeft al 30 spelers.');profile={id:crypto.randomUUID()};f.profiles.unshift(profile);f.accountProfileId=profile.id;}
    Object.assign(profile,{name,dateOfBirth,age});f.accountProfileId=profile.id;f.ownerName=name;f.onboardingComplete=true;recordAccountWelcome(f,{accountId:identity.user,email:identity.email,brandId:welcomeBrand,name});
   });
   const welcome=await recoverAccountWelcome({env,family:saved.family,identity,brandId:welcomeBrand,origin:url.origin});
   return json({family:refreshAges(saved.family),welcomeMail:{status:welcome.status}});
  }
  fail('Deze functie bestaat niet.',404);
 }catch(error){return json({error:{message:error.status?error.message:'Aanmelden is tijdelijk niet beschikbaar. Probeer opnieuw.'}},error.status||503);}
}
