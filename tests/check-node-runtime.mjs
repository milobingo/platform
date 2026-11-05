import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStorageEnvironment} from '../server/node-storage.js';
import {dispatchNodeRequest} from '../server/node-runtime.js';
import {localAuthAvailable,safeReturnPath,createAuthContext} from '../server/node-auth.js';
import {handlePlayerAuth} from '../server/player-auth.js';
import {platformIdentity,playerIdentity} from '../server/player-identity.js';
import {saveSecret} from '../server/secrets.js';
import {PDFDocument} from 'pdf-lib';

const req=(path,body,headers={},origin='http://localhost:3000')=>new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Vlampie-Bingo':'1','X-Vlampie-Player':'1','X-Vlampie-Call':'1',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function fixture(t,config={}){
 const directory=await mkdtemp(join(tmpdir(),'milo-runtime-'));
 const storage=await createStorageEnvironment({SQLITE_PATH:join(directory,'app.sqlite'),OBJECT_STORAGE_PATH:join(directory,'objects')});
 const env={NODE_ENV:'development',MILO_LOCAL_AUTH:'true',...storage,...config};
 t.after(async()=>{await storage.close();await rm(directory,{recursive:true,force:true});});
 let cookies={};
 const call=async(path,body,status=200,extra={})=>{
  const response=await dispatchNodeRequest(req(path,body,{Cookie:Object.entries(cookies).map(([name,value])=>name+'='+value).join('; '),...extra}),{env});
  const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));
  for(const cookie of response.headers.getSetCookie()){const [name,value]=cookie.split(';')[0].split('=');cookies[name]=value;}
  assert.match(response.headers.get('cache-control'),/no-store/);
  return {data,response};
 };
 return {env,call,get cookies(){return cookies;},set cookies(value){cookies=value;}};
}

test('local role choice operates durable real bingo APIs with separate family ownership',async t=>{
 const h=await fixture(t);
 assert.equal((await h.call('/api/auth/session')).data.authenticated,false);
 await h.call('/api/bingo/games',undefined,401);
 await h.call('/auth/local',{role:'regie'});
 assert.equal((await h.call('/api/auth/session')).data.role,'regie');
 const regieCookies={...h.cookies};
 const {data:{game}}=await h.call('/api/bingo/games',{brandId:'milo',title:'Lokale repetitie',date:'2026-12-05T19:00',roundCount:1},201);
 assert.equal(game.ownerId,'local-regie');
 const generatedResult=(await h.call(`/api/bingo/games/${game.id}/generate`,{count:1},201)).data;
 const generated=generatedResult.game,book=generated.books[0],pdfPath=`/api/bingo/games/${game.id}/books/${book.id}/pdf`;
 const originalPut=h.env.SETTINGS.put.bind(h.env.SETTINGS);let pdfWrites=0;
 h.env.SETTINGS.put=(key,...args)=>{if(key.startsWith('bingo-pdfs/'))pdfWrites++;return originalPut(key,...args);};
 const download=async(path,cookies,status=200)=>{
  const response=await dispatchNodeRequest(req(path,undefined,{Cookie:Object.entries(cookies).map(([name,value])=>name+'='+value).join('; ')}),{env:h.env});
  assert.equal(response.status,status);
  if(status!==200)return null;
  assert.equal(response.headers.get('Content-Type'),'application/pdf');assert.match(response.headers.get('Cache-Control'),/no-store/);
  const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(new TextDecoder().decode(bytes.slice(0,5)),'%PDF-');return bytes;
 };
 const firstPdf=await download(pdfPath,regieCookies),reprintedPdf=await download(pdfPath,regieCookies);
 assert.deepEqual(reprintedPdf,firstPdf);assert.equal(pdfWrites,1);assert((await PDFDocument.load(firstPdf)).getPageCount()>0);
 await download(pdfPath,{},401);
 await h.call('/auth/local',{role:'player'});
 await download(pdfPath,h.cookies,403);await download(generatedResult.pdf,h.cookies,403);
 const familySession=(await h.call('/api/player/session')).data;
 assert.equal(familySession.accountId,'local-family');assert.equal(familySession.needsOnboarding,true);
 await h.call('/api/player/onboarding',{name:'Noor',dateOfBirth:'1990-01-01'});
 const family=(await h.call('/api/player/session')).data.family;
 await h.call('/api/bingo/games',{title:'Onbevoegd'},403);
 await h.call(`/api/bingo/games/${game.id}/register`,{profileId:family.profiles[0].id,code:generated.books[0].code});
 const familyPdf=await download(pdfPath,h.cookies);assert.deepEqual(familyPdf,firstPdf);assert.equal(pdfWrites,1);
 const reread=JSON.parse((await h.env.DB.prepare('SELECT document FROM bingo_games WHERE id = ?').bind(game.id).first()).document).books.find(candidate=>candidate.id===book.id);
 assert.deepEqual(reread.cards,book.cards);assert.equal(reread.token,book.token);assert.equal(reread.code,book.code);
 h.cookies=regieCookies;
 const games=(await h.call('/api/bingo/games')).data.games;assert.equal(games[0].linked,1);
 await h.call(`/api/bingo/games/${game.id}/start`,{regieId:'runtime-regie'});
 await h.call('/api/openai/status',undefined,503);
 await h.call('/auth/logout',{});
 assert.equal((await h.call('/api/auth/session')).data.authenticated,false);
});

test('forged Sites headers and legacy sessions never grant an identity',async t=>{
 const h=await fixture(t);
 const request=req('/api/bingo/games',{title:'Attacker'},{'oai-authenticated-user-id':'local-regie','oai-authenticated-user-email':'regie@localhost.invalid','x-milo-role':'regie',Cookie:'__Host-vlampie-session='+'a'.repeat(64)});
 assert.equal(platformIdentity(request,h.env).admin,false);assert.equal((await playerIdentity(request,h.env)).user,null);
 const response=await dispatchNodeRequest(request,{env:h.env});assert.equal(response.status,401);
 assert.equal((await handlePlayerAuth(req('/api/player/request-code',{email:'a@example.test'}),h.env)).status,410);
 await h.call('/api/player/request-code',{email:'a@example.test'},503);
});

test('local mode fails closed outside explicit loopback development and rejects tampered cookies',async t=>{
 const h=await fixture(t);
 for(const config of [{NODE_ENV:'production'},{MILO_LOCAL_AUTH:'false'},{SUPABASE_URL:'https://example.supabase.co'},{DATABASE_URL:'postgres://localhost/milo'},{VERCEL:'1'},{APP_URL:'https://milo.example'}])assert.equal(localAuthAvailable(req('/auth/local',{}),{...h.env,...config}),false,JSON.stringify(config));
 assert.equal(localAuthAvailable(req('/auth/local',{},{} ,'https://milo.example'),h.env),false);
 assert.equal(localAuthAvailable(req('/auth/local',{}, {'x-forwarded-for':'203.0.113.10'}),h.env),false);
 await h.call('/auth/local',{role:'regie'});
 h.cookies={'milo-local-session':h.cookies['milo-local-session'].slice(0,-3)+'bad'};
 assert.equal((await h.call('/api/auth/session')).data.authenticated,false);
});

test('mutation CSRF and return paths are checked before state changes',async t=>{
 const h=await fixture(t);await h.call('/auth/local',{role:'regie'});
 await h.call('/api/bingo/games',{title:'Bad'},403,{Origin:'https://attacker.example'});
 await h.call('/api/bingo/games',{title:'Bad'},403,{Origin:''});
 for(const next of ['https://attacker.example','//attacker.example','/\\attacker.example','/%2f%2fattacker.example','/auth/local','/api/bingo/games'])assert.equal(safeReturnPath(next),'/spelen');
 assert.equal(safeReturnPath('/spelen?game=abc#/book'),'/spelen?game=abc#/book');
});

function fakeProvider(user,{otpError=null}={}){
 const calls=[];
 return {calls,factory:(_url,_key,options)=>({auth:{
  getUser:async()=>({data:{user},error:null}),
  signInWithOtp:async body=>{calls.push(['otp',body]);return {error:otpError};},
  verifyOtp:async body=>{calls.push(['verify',body]);options.cookies.setAll([{name:'sb-auth-token',value:'provider-session',options:{httpOnly:true}}],{'cache-control':'private, no-store'});return {data:{user:{id:'supabase-family',email:body.email}},error:null};},
  signOut:async()=>({error:null}),
  exchangeCodeForSession:async code=>{calls.push(['exchange',code]);options.cookies.setAll([{name:'sb-auth-token',value:'provider-session',options:{}}]);return {error:null};},
  signInWithOAuth:async body=>{calls.push(['oauth',body]);return {data:{url:'https://example.supabase.co/auth/v1/authorize?provider=google'},error:null};},
 }})};
}

test('Supabase verifies identity and private SQL roles override all email and metadata claims',async t=>{
 const h=await fixture(t,{MILO_LOCAL_AUTH:'false',APP_URL:'https://studio.example',SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'});
 const user={id:'supabase-family',email:'owner@example.test',user_metadata:{role:'regie'},app_metadata:{role:'regie'}};
 const provider=fakeProvider(user);
 let context=await createAuthContext(req('/api/auth/session',undefined,{},'https://studio.example'),h.env,{clientFactory:provider.factory});
 assert.equal(context.identity.role,'player');assert.equal(context.identity.admin,false);
 await h.env.DB.prepare('INSERT INTO app_user_roles (user_id,role) VALUES (?,?)').bind(user.id,'regie').run();
 context=await createAuthContext(req('/api/auth/session',undefined,{},'https://studio.example'),h.env,{clientFactory:provider.factory});
 assert.equal(context.identity.admin,true);
 const noProvider=fakeProvider(null);context=await createAuthContext(req('/api/auth/session',undefined,{'oai-authenticated-user-id':user.id},'https://studio.example'),h.env,{clientFactory:noProvider.factory});
 assert.equal(context.identity.user,null);
});

test('OTP is issued and verified by Supabase and OAuth callbacks keep cookies and safe redirects',async t=>{
 const h=await fixture(t,{MILO_LOCAL_AUTH:'false',APP_URL:'https://studio.example',SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'});
 const provider=fakeProvider(null),call=(request)=>dispatchNodeRequest(request,{env:h.env,authClientFactory:provider.factory});
 const sent=await call(req('/api/player/request-code',{email:'parent@example.test'},{},'https://studio.example'));
 assert.equal(sent.status,200);const challenge=await sent.json();assert.equal(provider.calls[0][0],'otp');assert(!JSON.stringify(challenge).includes('123456'));
 const cookie=sent.headers.getSetCookie()[0].split(';')[0];assert.match(sent.headers.getSetCookie()[0],/HttpOnly/);assert.match(sent.headers.getSetCookie()[0],/Secure/);
 const verified=await call(req('/api/player/verify-code',{challengeId:challenge.challengeId,code:'123456'},{Cookie:cookie},'https://studio.example'));
 assert.equal(verified.status,200);assert.deepEqual(provider.calls[1],['verify',{email:'parent@example.test',token:'123456',type:'email'}]);
 assert.match(verified.headers.getSetCookie().join(';'),/sb-auth-token=provider-session/);assert(!JSON.stringify(await verified.json()).includes('provider-session'));
 const google=await call(req('/auth/google',{next:'//attacker.example'},{},'https://studio.example'));assert.equal(google.status,200);
 assert.match(provider.calls.at(-1)[1].options.redirectTo,/next=%2Fspelen$/);
 const navigationHeaders={'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'};
 const callback=await call(new Request('https://studio.example/auth/callback?code=provider-code&next=https://attacker.example',{headers:navigationHeaders}));
 assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),'https://studio.example/spelen');assert.match(callback.headers.getSetCookie().join(';'),/sb-auth-token/);
 assert.deepEqual(provider.calls.at(-1),['exchange','provider-code']);
 const exchanges=()=>provider.calls.filter(([type])=>type==='exchange').length;
 const beforeRejected=exchanges();
 for(const request of [
  new Request('https://studio.example/auth/callback?code=blocked',{method:'POST',headers:navigationHeaders}),
  new Request('https://studio.example/api/auth/session',{headers:navigationHeaders}),
  new Request('https://studio.example/auth/callback?code=blocked',{headers:{...navigationHeaders,Origin:'https://attacker.example'}}),
  new Request('https://studio.example/auth/callback?code=blocked',{headers:{...navigationHeaders,'Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty'}}),
  new Request('https://studio.example/auth/callback?code=blocked',{headers:{'Sec-Fetch-Site':'cross-site'}}),
 ]){const rejected=await call(request);assert.equal(rejected.status,403);}
 assert.equal(exchanges(),beforeRejected);
});

test('unconfigured remote auth gives a configuration error and websocket upgrades are explicit',async t=>{
 const h=await fixture(t,{NODE_ENV:'production',MILO_LOCAL_AUTH:'true',APP_URL:'https://studio.example'});
 const response=await dispatchNodeRequest(req('/api/bingo/games',undefined,{},'https://studio.example'),{env:h.env});
 assert.equal(response.status,503);assert.equal((await response.json()).error.code,'auth_unconfigured');
 const local=await fixture(t);await local.call('/auth/local',{role:'regie'});
 await local.call('/api/bingo/games',undefined,501,{Upgrade:'websocket'});
});

test('configured provider handlers use the Node fetch adapter while live verification stays explicit',async t=>{
 const h=await fixture(t,{MILO_LOCAL_AUTH:'false',APP_URL:'https://studio.example',SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',OPENAI_API_KEY:'test-only-not-real',VLAMPIE_SETTINGS_KEY:'01'.repeat(32)});
 await saveSecret(h.env,'legacy-key-must-never-override-environment',null);
 await h.env.DB.prepare('INSERT INTO app_user_roles (user_id,role) VALUES (?,?)').bind('supabase-family','regie').run();
 const provider=fakeProvider({id:'supabase-family',email:'host@example.test'}),requests=[];
 const {fakeLiveSocket}=await import('../scripts/gpt-live-fixture.mjs');
 const providerFetch=async(url,options)=>{requests.push({url,options});return fakeLiveSocket();};
 const response=await dispatchNodeRequest(req('/api/openai/speech',{characterId:'milo',text:'Hallo allemaal!'},{},'https://studio.example'),{env:h.env,authClientFactory:provider.factory,providerFetch});
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/wav');assert((await response.arrayBuffer()).byteLength>44);
 assert.equal(requests.length,1);assert.equal(requests[0].url,'https://api.openai.com/v1/live/sessions');assert.equal(requests[0].options.headers.Authorization,'Bearer test-only-not-real');
 const status=await dispatchNodeRequest(req('/api/openai/status',undefined,{},'https://studio.example'),{env:h.env,authClientFactory:provider.factory,providerFetch});
 assert.equal(status.status,200);const data=await status.json();assert.equal(data.transportReady,true);assert.equal(data.liveVerified,false);assert(!JSON.stringify(data).includes('test-only-not-real'));
});
