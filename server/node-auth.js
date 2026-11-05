import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {BingoStore} from './bingo-store.js';
import {readCookie} from './player-identity.js';

const LOCAL_COOKIE='milo-local-session';
const OTP_COOKIE='milo-pending-otp';
const LOCAL_LIFETIME=8*60*60;
const localKeySymbol=Symbol.for('milo.local-auth-key');
const anonymous=()=>({user:null,email:'',admin:false,role:null,method:'anonymous'});
const error=(message,status=400,code='invalid')=>Object.assign(new Error(message),{status,code});
const json=(data,status=200)=>Response.json(data,{status});
const fail=(message,status=400,code='invalid')=>{throw error(message,status,code);};
const loopback=hostname=>['localhost','127.0.0.1','::1','[::1]','::ffff:127.0.0.1'].includes(String(hostname).toLowerCase());
const truthy=value=>String(value).toLowerCase()==='true';
const localKey=()=>globalThis[localKeySymbol]??(globalThis[localKeySymbol]=randomBytes(32));
// OAuth returns as a top-level navigation from the provider. Its authorization
// code is bound to the HttpOnly PKCE verifier; API mutations still require Origin.
const oauthCallback=request=>request.method==='GET'&&new URL(request.url).pathname==='/auth/callback'&&!request.headers.has('origin')&&request.headers.get('sec-fetch-mode')==='navigate'&&(!request.headers.has('sec-fetch-dest')||request.headers.get('sec-fetch-dest')==='document');

export function safeReturnPath(value,fallback='/spelen'){
 if(typeof value!=='string'||value.length>1500||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020\u007f]/.test(value))return fallback;
 try{
  const decoded=decodeURIComponent(value);if(decoded.startsWith('//')||/[\\\u0000-\u0020\u007f]/.test(decoded))return fallback;
  const url=new URL(value,'http://local.test');if(url.origin!=='http://local.test'||url.pathname.startsWith('/auth/')||url.pathname.startsWith('/api/'))return fallback;
  return url.pathname+url.search+url.hash;
 }catch{return fallback;}
}

export function localAuthAvailable(request,env=process.env){
 const url=new URL(request.url);
 if(!truthy(env.MILO_LOCAL_AUTH)||env.NODE_ENV==='production'||!loopback(url.hostname))return false;
 if(['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_STORAGE_BUCKET','DATABASE_URL','OPENAI_API_KEY','LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','VERCEL','VERCEL_ENV','NETLIFY','CF_PAGES','RENDER','FLY_APP_NAME','WEBSITE_SITE_NAME','K_SERVICE'].some(name=>!!env[name]))return false;
 if(env.APP_URL){try{if(!loopback(new URL(env.APP_URL).hostname))return false;}catch{return false;}}
 if(request.headers.get('forwarded'))return false;
 const host=request.headers.get('host'),forwardedHost=request.headers.get('x-forwarded-host');
 if(host&&host.toLowerCase()!==url.host.toLowerCase()||forwardedHost&&forwardedHost.toLowerCase()!==url.host.toLowerCase())return false;
 const forwardedFor=request.headers.get('x-forwarded-for');
 if(forwardedFor&&!forwardedFor.split(',').every(ip=>loopback(ip.trim())))return false;
 return true;
}

export function authOrigin(request,env=process.env){
 const incoming=new URL(request.url);
 if(!env.APP_URL){
  if(loopback(incoming.hostname)&&env.NODE_ENV!=='production')return incoming.origin;
  fail('APP_URL is nog niet ingesteld voor deze omgeving.',503,'auth_configuration');
 }
 let url;try{url=new URL(env.APP_URL);}catch{fail('APP_URL moet een geldige oorsprong zijn.',503,'auth_configuration');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.protocol!=='https:'&&(!loopback(url.hostname)||env.NODE_ENV==='production'))fail('APP_URL moet een geldige HTTPS-oorsprong zijn.',503,'auth_configuration');
 if(incoming.origin!==url.origin)fail('Open de app via het ingestelde webadres.',403,'origin');
 return url.origin;
}

export function checkSameOrigin(request,origin=new URL(request.url).origin){
 const unsafe=!['GET','HEAD','OPTIONS'].includes(request.method);
 if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==origin||unsafe&&request.headers.get('origin')!==origin)fail('Open deze functie vanuit de app.',403,'origin');
}

function serializeCookie(name,value,options={}){
 const parts=[`${name}=${encodeURIComponent(value)}`];
 parts.push(`Path=${options.path||'/'}`);
 if(options.maxAge!==undefined)parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
 if(options.expires)parts.push(`Expires=${new Date(options.expires).toUTCString()}`);
 if(options.httpOnly!==false)parts.push('HttpOnly');
 if(options.secure)parts.push('Secure');
 parts.push(`SameSite=${String(options.sameSite||'lax').replace(/^./,c=>c.toUpperCase())}`);
 return parts.join('; ');
}
function appendCookie(context,name,value,options={}){
 context.cookies.push(serializeCookie(name,value,{...options,secure:new URL(context.origin).protocol==='https:',path:'/'}));
}
export function applyAuthCookies(response,context){
 const headers=new Headers(response.headers);
 headers.set('Cache-Control','private, no-store');headers.set('Pragma','no-cache');headers.set('Expires','0');headers.set('Vary','Cookie');headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','same-origin');
 for(const [key,value] of context.cacheHeaders||[])headers.set(key,value);
 for(const cookie of context.cookies||[])headers.append('Set-Cookie',cookie);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
function localIdentity(request){
 const value=readCookie(request,LOCAL_COOKIE);if(!value)return anonymous();
 try{
  const [payload,signature,...rest]=decodeURIComponent(value).split('.');if(rest.length||!payload||!signature)return anonymous();
  const expected=createHmac('sha256',localKey()).update(payload).digest();const actual=Buffer.from(signature,'base64url');
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return anonymous();
  const session=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  if(!['regie','player'].includes(session.role)||!Number.isSafeInteger(session.expires)||session.expires<Date.now())return anonymous();
  return {user:session.role==='regie'?'local-regie':'local-family',email:session.role==='regie'?'regie@localhost.invalid':'gezin@localhost.invalid',role:session.role,admin:session.role==='regie',method:'local'};
 }catch{return anonymous();}
}
function readCookies(request){
 return (request.headers.get('cookie')||'').split(';').map(part=>{
  const equal=part.indexOf('=');if(equal<1)return null;
  try{return {name:part.slice(0,equal).trim(),value:decodeURIComponent(part.slice(equal+1))};}catch{return null;}
 }).filter(Boolean);
}
function supabaseConfig(env){
 const url=env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL;
 const key=env.SUPABASE_PUBLISHABLE_KEY||env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)return null;
 try{const parsed=new URL(url);if(parsed.protocol!=='https:'&&!(parsed.protocol==='http:'&&loopback(parsed.hostname)&&env.NODE_ENV!=='production'))return null;}catch{return null;}
 return {url,key};
}

export async function createAuthContext(request,env=process.env,{clientFactory}={}){
 const context={identity:anonymous(),cookies:[],cacheHeaders:new Map(),configured:!!supabaseConfig(env),localAvailable:localAuthAvailable(request,env),origin:new URL(request.url).origin,client:null,error:null};
 try{
  context.origin=authOrigin(request,env);
  if(!oauthCallback(request))checkSameOrigin(request,context.origin);
  if(context.localAvailable){context.identity=localIdentity(request);return context;}
  const config=supabaseConfig(env);
  if(!config){context.error=error('Supabase Auth is nog niet ingesteld. Gebruik lokaal de expliciete ontwikkelaanmelding.',503,'auth_unconfigured');return context;}
  const factory=clientFactory||(await import('@supabase/ssr')).createServerClient;
  context.client=factory(config.url,config.key,{
   auth:{flowType:'pkce',autoRefreshToken:false,detectSessionInUrl:false,persistSession:true},
   cookieOptions:{httpOnly:true,secure:new URL(context.origin).protocol==='https:',sameSite:'lax',path:'/'},
   cookies:{
    getAll:()=>readCookies(request),
    setAll:(cookies,headers)=>{
     for(const {name,value,options} of cookies)appendCookie(context,name,value,{...options,httpOnly:true});
     for(const [name,value] of Object.entries(headers||{}))context.cacheHeaders.set(name,value);
    },
   },
  });
  // getUser contacts Auth and verifies the session. Never authorize getSession
  // cookie payloads or user_metadata. Roles are read fresh from private SQL.
  const {data,error:authError}=await context.client.auth.getUser();
  if(authError){
   if(authError.status>=500||authError.name==='AuthRetryableFetchError')context.error=error('Supabase Auth is tijdelijk niet bereikbaar.',503,'auth_unavailable');
   return context;
  }
  if(!data?.user)return context;
  if(!env.DB?.prepare){context.error=error('De server kan de accountrol nog niet controleren.',503,'role_unavailable');return context;}
  const role=await env.DB.prepare('SELECT role FROM app_user_roles WHERE user_id = ?').bind(data.user.id).first();
  context.identity={user:data.user.id,email:data.user.email||'',admin:role?.role==='regie',role:role?.role==='regie'?'regie':'player',method:'supabase'};
 }catch(cause){context.error=cause.status?cause:error('Aanmelden is tijdelijk niet beschikbaar.',503,'auth_unavailable');}
 return context;
}

export function authSession(context){
 return {authenticated:!!context.identity.user,user:context.identity.user,email:context.identity.email,role:context.identity.role,local:context.identity.method==='local',configured:context.configured,localAvailable:context.localAvailable};
}
async function readBody(request){
 if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))fail('Gebruik een JSON-aanvraag.',415,'content_type');
 const raw=await request.text();if(new TextEncoder().encode(raw).length>5000)fail('De aanvraag is te groot.',413,'too_large');
 try{const value=JSON.parse(raw||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{fail('De aanvraag kon niet worden gelezen.');}
}
function emailOf(value){const email=String(value||'').trim().toLowerCase();if(email.length>254||! /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))fail('Vul een geldig e-mailadres in.');return email;}
function providerError(cause,message){return error(cause?.status===429?'Je hebt te vaak een code aangevraagd. Probeer later opnieuw.':message,cause?.status===429?429:cause?.status>=500||cause?.name==='AuthRetryableFetchError'?503:400,'auth_provider');}

export async function handleNodeAuth(request,env,context){
 const url=new URL(request.url),path=url.pathname;
 try{
  if(!oauthCallback(request))checkSameOrigin(request,context.origin);
  if(path==='/api/auth/session'&&request.method==='GET'){
   if(context.error&&context.error.code!=='auth_unconfigured')throw context.error;
   return json(authSession(context));
  }
  if(path==='/auth/local'){
   if(request.method!=='POST')return json({error:{code:'method',message:'Gebruik de lokale aanmeldknop.'}},405);
   if(!context.localAvailable)fail('Lokale aanmelding is alleen beschikbaar op deze computer in ontwikkelmodus.',403,'local_auth_disabled');
   const body=await readBody(request);if(!['regie','player'].includes(body.role))fail('Kies regie of gezin.');
   const payload=Buffer.from(JSON.stringify({role:body.role,expires:Date.now()+LOCAL_LIFETIME*1000})).toString('base64url');
   const signature=createHmac('sha256',localKey()).update(payload).digest('base64url');
   appendCookie(context,LOCAL_COOKIE,payload+'.'+signature,{maxAge:LOCAL_LIFETIME,httpOnly:true});
   return json({ok:true,next:safeReturnPath(body.next,body.role==='regie'?'/':'/spelen')});
  }
  const isLogout=['/auth/logout','/api/player/logout'].includes(path);
  if(isLogout){
   if(request.method!=='POST')fail('Gebruik de afmeldknop.',405,'method');
   if(context.client){const {error:signOutError}=await context.client.auth.signOut({scope:'local'});if(signOutError)throw providerError(signOutError,'Afmelden kon niet worden bevestigd.');}
   appendCookie(context,LOCAL_COOKIE,'',{maxAge:0});appendCookie(context,OTP_COOKIE,'',{maxAge:0});
   appendCookie(context,'__Host-vlampie-session','',{maxAge:0});appendCookie(context,'__Host-vlampie-verify','',{maxAge:0});
   return json({ok:true});
  }
  if(context.error)throw context.error;
  if(!context.client)fail('Supabase Auth is nog niet ingesteld voor e-mail en Google.',503,'auth_unconfigured');
  if(path==='/auth/callback'){
   if(request.method!=='GET')fail('Onbekende aanvraag.',405,'method');
   const code=url.searchParams.get('code');if(!code||code.length>3000)fail('De aanmeldlink is ongeldig of verlopen.');
   const {error:exchangeError}=await context.client.auth.exchangeCodeForSession(code);
   if(exchangeError)throw providerError(exchangeError,'De aanmeldlink is ongeldig of verlopen. Probeer opnieuw.');
   return Response.redirect(context.origin+safeReturnPath(url.searchParams.get('next')),303);
  }
  if(request.method!=='POST')fail('Gebruik de aanmeldknop.',405,'method');
  const body=await readBody(request);
  if(path==='/auth/google'){
   const next=safeReturnPath(body.next);
   const {data,error:googleError}=await context.client.auth.signInWithOAuth({provider:'google',options:{redirectTo:context.origin+'/auth/callback?next='+encodeURIComponent(next),skipBrowserRedirect:true}});
   if(googleError||!data?.url)throw providerError(googleError,'Aanmelden met Google is nog niet beschikbaar.');
   const target=new URL(data.url),provider=new URL(supabaseConfig(env).url);
   if(target.origin!==provider.origin)fail('De aanmeldprovider gaf een ongeldig adres terug.',502,'auth_provider');
   return json({url:target.href});
  }
  if(['/auth/otp','/api/player/request-code'].includes(path)){
   const email=emailOf(body.email),now=Date.now();
   const {error:otpError}=await context.client.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:context.origin+'/auth/callback'}});
   if(otpError)throw providerError(otpError,'De e-mail kon niet worden verstuurd. Controleer de Supabase e-mailinstellingen.');
   const challengeId=randomBytes(24).toString('base64url');
   appendCookie(context,OTP_COOKIE,Buffer.from(JSON.stringify({email,id:challengeId,expires:now+600000})).toString('base64url'),{maxAge:600});
   return json({challengeId,expiresAt:now+600000,resendAt:now+60000});
  }
  if(['/auth/verify','/api/player/verify-code'].includes(path)){
   let email=body.email?emailOf(body.email):null;
   if(path==='/api/player/verify-code'){
    let pending;try{pending=JSON.parse(Buffer.from(decodeURIComponent(readCookie(request,OTP_COOKIE)),'base64url').toString('utf8'));}catch{}
    if(!pending||pending.id!==body.challengeId||pending.expires<Date.now())fail('Vraag op dit apparaat een nieuwe code aan.');
    email=emailOf(pending.email);
   }
   if(!email||!/^\d{6,10}$/.test(String(body.token||body.code||'')))fail('Vul de code uit je e-mail in.');
   const {data,error:verifyError}=await context.client.auth.verifyOtp({email,token:String(body.token||body.code),type:'email'});
   if(verifyError||!data?.user)throw providerError(verifyError,'De code is onjuist of verlopen. Vraag zo nodig een nieuwe code aan.');
   if(!env.DB?.prepare)fail('De gezinsopslag is nog niet ingesteld.',503,'storage_unavailable');
   const family=(await new BingoStore(env.DB).family(data.user.id,data.user.email||email)).data;
   appendCookie(context,OTP_COOKIE,'',{maxAge:0});
   return json({authenticated:true,needsOnboarding:!family.onboardingComplete});
  }
  fail('Deze aanmeldfunctie bestaat niet.',404,'not_found');
 }catch(cause){return json({error:{code:cause.code||'auth_unavailable',message:cause.status?cause.message:'Aanmelden is tijdelijk niet beschikbaar.'}},cause.status||503);}
}
