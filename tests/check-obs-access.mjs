import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {Pool} from 'pg';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStorageEnvironment,createPostgresDatabase} from '../server/node-storage.js';
import {dispatchNodeRequest} from '../server/node-runtime.js';
import {verifyObsAccess} from '../server/node-obs-access.js';
import {withProviderSettingsLock} from '../server/node-provider-settings.js';
import {BingoStore} from '../server/bingo-store.js';
import {makeGame,forceCancelGame} from '../server/bingo-model.js';
import {makeLiveCall} from '../server/live-call-model.js';
import {CHARACTERS} from '../server/characters.js';
import {voicePath} from '../server/voice-cache.js';

const origin='https://studio.example',clipId='c'.repeat(64);
const noProvider=()=>{throw Error('An OBS fixture unexpectedly contacted a provider');};
const auth=user=>()=>({auth:{getUser:async()=>({data:{user},error:null})}});
async function fixture(t,{postgres=false}={}){
 const directory=await mkdtemp(join(tmpdir(),'milo-obs-')),storage=await createStorageEnvironment({SQLITE_PATH:join(directory,'app.sqlite'),OBJECT_STORAGE_PATH:join(directory,'objects')});
 let DB=storage.DB,admin,schema;
 if(postgres){
  const source=new URL(process.env.MILO_TEST_DATABASE_URL);assert(['localhost','127.0.0.1','[::1]'].includes(source.hostname)&&/test/i.test(source.pathname),'OBS integration requires an explicitly local test database');
  admin=new Pool({connectionString:source.toString()});schema='milo_obs_'+crypto.randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
  const client=await admin.connect();try{await client.query('SET search_path TO '+schema);for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort())await client.query((await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replaceAll('public.',schema+'.').replaceAll('SCHEMA public','SCHEMA '+schema));}finally{client.release();}
  source.searchParams.set('options','-c search_path='+schema);DB=await createPostgresDatabase(source.toString(),{allowLoopback:true});
 }
 const user={id:crypto.randomUUID(),email:'regie@example.test'},env={...storage,DB,NODE_ENV:'production',APP_URL:origin,SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',VLAMPIE_SETTINGS_KEY:'01'.repeat(32),OPENAI_API_KEY:'sk-obs-fixture-'+'x'.repeat(32),LIVEKIT_URL:'wss://fixture.livekit.cloud',LIVEKIT_API_KEY:'API_OBS_FIXTURE',LIVEKIT_API_SECRET:'SYNTHETIC_FIXTURE_SECRET_12345'};
 await DB.prepare('INSERT INTO app_user_roles (user_id,role) VALUES (?,?)').bind(user.id,'regie').run();
 const game=makeGame({brandId:'milo',title:'OBS fixture',date:'2026-12-01T14:00',timeZone:'Europe/Amsterdam'},user.id,origin),bingo=new BingoStore(DB);await bingo.create(game);
 const ids={host:crypto.randomUUID(),output:crypto.randomUUID(),instance:crypto.randomUUID()};
 const state={producer:{id:ids.host,instanceId:ids.instance,generation:1,gameId:game.id,until:Date.now()+900000},generation:1,seq:1,publishedAt:Date.now(),output:null,snapshot:{production:'milo',gameId:game.id,hostId:'milo',camera:'host',caption:'Hallo allemaal',characterSettings:[{id:'milo',gestureEnergy:70,idleMotion:true,lipSync:true,persona:'PRIVATE_PERSONA',knowledge:'PRIVATE_KNOWLEDGE',approvedMemories:'PRIVATE_MEMORY'}],privateFamily:'PRIVATE_FAMILY'},show:{title:'OBS fixture',scene:'host',privateField:'PRIVATE_SHOW'},events:[],voice:{id:crypto.randomUUID(),clip:clipId,text:'Hallo allemaal',duration:1000,phase:'prepare'},routing:true,mixer:{voice:100,music:25,effects:50}};
 await DB.prepare('INSERT INTO studio_outputs (owner_id,revision,document) VALUES (?,0,?)').bind(user.id,JSON.stringify(state)).run();
 const request=(path,body,headers={},signal)=>new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Milo-OBS-Manage':'1','X-Vlampie-Output':'1',...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),...(signal?{signal}:{})});
 const invoke=async(path,body,{status=200,headers={},providerUser=user,providerFetch=noProvider,signal}={})=>{const response=await dispatchNodeRequest(request(path,body,headers,signal),{env,authClientFactory:auth(providerUser),providerFetch}),text=await response.text();assert.equal(response.status,status,text);assert.match(response.headers.get('cache-control'),/no-store/);return {data:text?JSON.parse(text):null,response,text};};
 const create=async(expectedAccessId=null,gameId=game.id)=>(await invoke('/api/obs/access',{action:'create',gameId,expectedAccessId})).data;
 const scoped=(token,path='/api/obs/session',body,options={})=>invoke(path,body,{providerUser:null,...options,headers:{'X-Milo-OBS-Token':token,...options.headers}});
 const row=async()=>{const row=await DB.prepare('SELECT * FROM studio_outputs WHERE owner_id = ?').bind(user.id).first();return {...row,state:JSON.parse(row.document)};};
 const write=async change=>{const saved=await row(),next=structuredClone(saved.state);await change(next);await DB.prepare('UPDATE studio_outputs SET revision = ?,document = ? WHERE owner_id = ?').bind(saved.revision+1,JSON.stringify(next),user.id).run();};
 const heartbeat=token=>scoped(token,'/api/obs/output',{action:'output-heartbeat',clientId:ids.output,audioReady:true,generation:1,seq:1});
 t.after(async()=>{if(postgres){await DB.close();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}await storage.close();await rm(directory,{recursive:true,force:true});});
 return {env,DB,user,game,bingo,ids,state,request,invoke,create,scoped,row,write,heartbeat};
}
async function liveCall(h){
 const entry={id:crypto.randomUUID(),accountId:crypto.randomUUID(),profileId:crypto.randomUUID(),name:'Sophie',child:true,parentConsent:true,callConsentEnabled:true,callConsentAt:Date.now(),callPresenceAt:Date.now(),technicalReadyAt:Date.now(),micChecked:true,headphones:true,connectionChecked:true,callStatus:'accepted'};
 h.game.status='running';h.game.participation=[entry];h.game.books=[{id:crypto.randomUUID(),accountId:entry.accountId,profileId:entry.profileId,admitted:true,cards:[]}];
 const call=makeLiveCall(h.game,entry,{clientId:h.ids.host,outputId:h.ids.output,character:{id:'milo',name:'Milo',realtimeVoice:'marin'},presenter:CHARACTERS.milo,context:{callName:'Sofietje',reason:'PRIVATE_REASON',pronunciation:'PRIVATE_PRONUNCIATION',note:'PRIVATE_NOTE'}});
 Object.assign(call,{mode:'ai',liveAgreement:{agreedAt:Date.now(),profileId:entry.profileId},phase:'live',holdConfirmed:true,speechEngine:'gpt-live',liveAt:Date.now(),liveUntil:Date.now()+90000,resourcesClosed:false});call.seen.player=Date.now();call.media.player={connected:true,micReady:true,audioReady:true};call.activeContext=structuredClone(call.context);h.game.state.drawHold={callId:call.id};
 await h.DB.prepare('UPDATE bingo_games SET document = ? WHERE id = ?').bind(JSON.stringify(h.game),h.game.id).run();
 await h.DB.prepare('INSERT INTO studio_calls (owner_id,game_id,revision,document) VALUES (?,?,0,?)').bind(h.user.id,h.game.id,JSON.stringify(call)).run();
 return {call,body:extra=>({role:'output',clientId:h.ids.output,gameId:h.game.id,callId:call.id,...extra}),read:async()=>JSON.parse((await h.DB.prepare('SELECT document FROM studio_calls WHERE owner_id = ?').bind(h.user.id).first()).document)};
}

test('an existing OBS capability reads a cancelled frozen board but cannot load old voice, including cancellation during clip retrieval',async t=>{
 const h=await fixture(t),created=await h.create();await h.env.SETTINGS.put(voicePath(h.user.id,clipId),new Uint8Array([73,68,51,4]),{httpMetadata:{contentType:'audio/mpeg'}});
 await h.bingo.mutate(h.game.id,{},g=>{g.status='running';g.state.drawn=[7,19,41];});await h.write(state=>{state.snapshot.drawn=[7,19,41];state.snapshot.lastNumber=41;});
 const get=h.env.SETTINGS.get.bind(h.env.SETTINGS);let cancelled=false;h.env.SETTINGS.get=async key=>{const clip=await get(key);if(key===voicePath(h.user.id,clipId)&&!cancelled){cancelled=true;await h.bingo.mutate(h.game.id,{},g=>forceCancelGame(g,{by:h.user.id,reason:'PRIVATE-CANCEL-REASON',requestId:'obs-force-cancel',binding:'fixture'},Date.now()));}return clip;};
 await h.scoped(created.token,'/api/obs/clips/'+clipId,undefined,{status:403});assert(cancelled);
 const result=await h.scoped(created.token,'/api/obs/output');assert(result.data.state.cancelledAt);assert.equal(result.data.state.cancelledGameId,h.game.id);assert.deepEqual(result.data.state.snapshot.drawn,[7,19,41]);assert.equal(result.data.state.snapshot.lastNumber,41);assert.equal(result.data.state.snapshot.paused,true);assert.equal(result.data.state.voice,null);assert.equal(result.data.state.routing,false);assert(!result.text.includes('PRIVATE-CANCEL-REASON'));
 const heartbeat=await h.heartbeat(created.token);assert(heartbeat.data.state.cancelledAt);assert.equal(heartbeat.data.state.output,null);
 await h.scoped(created.token,'/api/obs/clips/'+clipId,undefined,{status:403});
});

test('organizer creates one-time opaque OBS access; status and every legacy output response omit hashes and raw secret',async t=>{
 const h=await fixture(t),empty=(await h.invoke('/api/obs/access?gameId='+h.game.id)).data;assert.equal(empty.configured,false);assert.equal(empty.gameId,h.game.id);assert.equal(empty.currentAccessId,null);
 let created;const realClock=Date.now;let clock=realClock();Date.now=()=>clock++;
 try{created=await h.create();}finally{Date.now=realClock;}
 assert.match(created.token,/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);assert.equal(created.expiresAt-(await h.row()).state.obsAccess.createdAt,7*24*60*60*1000,'creation and expiry share one instant even when the clock advances between calls');
 const saved=await h.row();assert(!saved.document.includes(created.token));assert(!saved.document.includes(created.token.split('.')[1]));assert.match(saved.state.obsAccess.hash,/^[a-f0-9]{64}$/);assert.equal(saved.state.producer.id,h.ids.host);
 const status=await h.invoke('/api/obs/access?gameId='+h.game.id);assert.equal(status.data.currentAccessId,created.currentAccessId);assert(!status.text.includes(saved.state.obsAccess.hash));assert(!status.text.includes(created.token));
 const legacy=await h.invoke('/api/output');assert(!legacy.text.includes('obsAccess'));assert(!legacy.text.includes(saved.state.obsAccess.hash));
 const session=(await h.scoped(created.token)).data;assert.deepEqual(Object.keys(session).sort(),['authenticated','expiresAt','gameId','role']);assert.equal(session.role,'output');
});

test('OBS token cannot authenticate a general session or reach regie APIs, publish, change role, join backstage or cross origins',async t=>{
 const h=await fixture(t),created=await h.create();
 assert.equal((await h.scoped(created.token,'/api/auth/session')).data.authenticated,false);
 for(const path of ['/api/bingo/games','/api/mail/state?brandId=milo','/api/openai/status','/api/characters','/api/livekit/settings'])await h.scoped(created.token,path,undefined,{status:401});
 for(const path of ['/api/obs/access','/api/obs/settings','/api/obs/mail','/api/obs/bingo'])await h.scoped(created.token,path,undefined,{status:path==='/api/obs/access'?401:403});
 await h.scoped(created.token,'/api/obs/output',{action:'publish',clientId:h.ids.output},{status:403});
 for(const body of [{role:'host'},{role:'player'},{role:'output',action:'prepare'},{role:'output',action:'go-live'},{role:'output',action:'resume-draw'}])await h.scoped(created.token,'/api/obs/live-calls',{gameId:h.game.id,clientId:h.ids.output,...body},{status:403});
 await h.scoped(created.token,'/api/obs/live-calls/token',{role:'output',gameId:h.game.id,target:'backstage',clientId:h.ids.output},{status:403});
 await h.scoped(created.token,'/api/obs/session',undefined,{status:403,headers:{Origin:'https://evil.example'}});
 await h.scoped(created.token,'/api/obs/session',undefined,{status:403,headers:{'Sec-Fetch-Site':'cross-site'}});
 await h.invoke('/api/obs/session?token='+created.token,undefined,{status:401,providerUser:null});
 const anonymousAuth=()=>{throw Error('OBS must not contact Supabase Auth');};assert.equal((await dispatchNodeRequest(h.request('/api/obs/session',undefined,{'X-Milo-OBS-Token':created.token}),{env:h.env,authClientFactory:anonymousAuth})).status,200);
});

test('management requires verified regie, fresh role, exact origin, custom header and stable current access intent',async t=>{
 const h=await fixture(t),body={action:'create',gameId:h.game.id,expectedAccessId:null};
 await h.invoke('/api/obs/access',body,{status:401,providerUser:null});await h.invoke('/api/obs/access',body,{status:403,providerUser:{id:crypto.randomUUID(),email:'player@example.test'}});
 for(const headers of [{'X-Milo-OBS-Manage':''},{Origin:'https://evil.example'},{Origin:''}])await h.invoke('/api/obs/access',body,{status:403,headers});
 await h.invoke('/api/obs/access',{action:'create',gameId:h.game.id},{status:409});
 const created=await h.create();await h.invoke('/api/obs/access',body,{status:409});await h.invoke('/api/obs/access',{action:'revoke',expectedAccessId:null},{status:409});
 const other=makeGame({brandId:'milo',title:'Other owned show',date:'2026-12-01T14:00',timeZone:'Europe/Amsterdam'},h.user.id,origin);await h.bingo.create(other);
 const status=(await h.invoke('/api/obs/access?gameId='+other.id)).data;assert.equal(status.gameId,other.id);assert.equal(status.activeGameId,h.game.id);assert.equal(status.currentAccessId,created.currentAccessId);
 let roleRead,controller;const checked=new Promise(resolve=>roleRead=resolve),original=h.DB.execute.bind(h.DB);let notified=false;
 h.DB.execute=async(sql,args)=>{const result=await original(sql,args);if(!notified&&sql==='SELECT role FROM app_user_roles WHERE user_id = ?'){notified=true;roleRead();}return result;};
 const stream=new ReadableStream({start(value){controller=value;}}),request=new Request(origin+'/api/obs/access',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Milo-OBS-Manage':'1'},body:stream,duplex:'half'});
 const pending=dispatchNodeRequest(request,{env:h.env,authClientFactory:auth(h.user),providerFetch:noProvider});await checked;await h.DB.prepare("UPDATE app_user_roles SET role = 'player' WHERE user_id = ?").bind(h.user.id).run();
 // Complete the body after demotion. The prior authenticated role cannot
 // authorize a credential-management write that executes after it.
 controller.enqueue(new TextEncoder().encode(JSON.stringify({action:'revoke',expectedAccessId:created.currentAccessId})));controller.close();assert.equal((await pending).status,403);assert.equal((await h.row()).state.obsAccess.id,created.currentAccessId);
 await h.invoke('/api/obs/access',{action:'revoke',expectedAccessId:created.currentAccessId},{status:403});
});

test('output projection contains programme visuals only; another show produces waiting state and no voice access',async t=>{
 const h=await fixture(t),created=await h.create(),output=await h.scoped(created.token,'/api/obs/output');
 for(const value of ['PRIVATE_PERSONA','PRIVATE_KNOWLEDGE','PRIVATE_MEMORY','PRIVATE_FAMILY','PRIVATE_SHOW',(await h.row()).state.obsAccess.hash])assert(!output.text.includes(value));
 assert.equal(output.data.state.snapshot.caption,'Hallo allemaal');assert.equal(output.data.state.snapshot.characterSettings[0].gestureEnergy,70);
 await h.heartbeat(created.token);const heartbeat=await h.invoke('/api/output',{action:'output-heartbeat',clientId:crypto.randomUUID()},{status:409});assert(!heartbeat.text.includes('obsAccess'));
 await h.write(state=>{state.producer.gameId=crypto.randomUUID();state.snapshot.gameId=state.producer.gameId;});
 const wrong=(await h.scoped(created.token,'/api/obs/output')).data.state;assert.equal(wrong.snapshot,null);assert.equal(wrong.show,null);assert.equal(wrong.voice,null);assert.equal(wrong.routing,false);
 await h.scoped(created.token,'/api/obs/output',{action:'output-heartbeat',clientId:h.ids.output,audioReady:true,generation:1,seq:1},{status:409});await h.scoped(created.token,'/api/obs/clips/'+clipId,undefined,{status:403});
});

test('OBS can retrieve only the current published voice clip and never create a paid voice request',async t=>{
 const h=await fixture(t),created=await h.create();await h.env.SETTINGS.put(voicePath(h.user.id,clipId),'SYNTHETIC_AUDIO',{httpMetadata:{contentType:'audio/mpeg'}});
 const response=await dispatchNodeRequest(h.request('/api/obs/clips/'+clipId,undefined,{'X-Milo-OBS-Token':created.token}),{env:h.env,authClientFactory:()=>{throw Error('No Auth contact');},providerFetch:noProvider});assert.equal(response.status,200);assert.equal(await response.text(),'SYNTHETIC_AUDIO');
 await h.scoped(created.token,'/api/obs/clips/'+'d'.repeat(64),undefined,{status:403});await h.scoped(created.token,'/api/obs/clips/'+clipId,{text:'Paid speech'},{status:403});
 await h.write(state=>{state.voice.phase='stop';});await h.scoped(created.token,'/api/obs/clips/'+clipId,undefined,{status:403});
});

test('revocation, replacement, expiry, owner demotion and ownership change invalidate scoped access and preserve regie data',async t=>{
 const h=await fixture(t);let created=await h.create();await h.heartbeat(created.token);assert.equal((await h.row()).state.output.obsAccessId,created.currentAccessId);
 await h.invoke('/api/obs/access',{action:'revoke',gameId:h.game.id,expectedAccessId:created.currentAccessId});await h.scoped(created.token,undefined,undefined,{status:401});let saved=await h.row();assert.equal(saved.state.output,null);assert.equal(saved.state.producer.id,h.ids.host);assert.equal(saved.state.snapshot.caption,'Hallo allemaal');
 created=await h.create();const replacement=await h.create(created.currentAccessId);await h.scoped(created.token,undefined,undefined,{status:401});created=replacement;
 await h.write(state=>{state.obsAccess.expiresAt=Date.now()-1;});await h.scoped(created.token,undefined,undefined,{status:401});
 created=await h.create(created.currentAccessId);await h.DB.prepare("UPDATE app_user_roles SET role = 'player' WHERE user_id = ?").bind(h.user.id).run();await h.scoped(created.token,undefined,undefined,{status:401});await h.DB.prepare("UPDATE app_user_roles SET role = 'regie' WHERE user_id = ?").bind(h.user.id).run();
 await h.DB.prepare('UPDATE bingo_games SET owner_id = ? WHERE id = ?').bind('another-owner',h.game.id).run();await h.scoped(created.token,undefined,undefined,{status:401});await h.DB.prepare('UPDATE bingo_games SET owner_id = ? WHERE id = ?').bind(h.user.id,h.game.id).run();
});

test('malformed durable access metadata fails closed without provider or Auth contact',async t=>{
 const h=await fixture(t),created=await h.create(),valid=structuredClone((await h.row()).state.obsAccess);
 for(const changes of [{createdAt:undefined},{createdAt:-1},{createdAt:Date.now()+60000},{expiresAt:valid.createdAt},{expiresAt:valid.createdAt+7*24*60*60*1000+1},{gameId:'invalid-game'},{hash:'invalid-hash'},{id:'invalid-locator'}]){
  await h.write(state=>{state.obsAccess={...valid,...changes};});await h.scoped(created.token,undefined,undefined,{status:401});
 }
});

test('revocation wins a racing output heartbeat CAS without resurrecting its lease',async t=>{
 const h=await fixture(t),created=await h.create();let waiting,release,blocked=false;const entered=new Promise(resolve=>waiting=resolve),original=h.DB.execute.bind(h.DB);
 h.DB.execute=async(sql,args)=>{if(!blocked&&/^UPDATE studio_outputs SET revision/.test(sql)&&JSON.parse(args[1]).output?.obsAccessId){blocked=true;waiting();await new Promise(resolve=>release=resolve);}return original(sql,args);};
 const pending=h.scoped(created.token,'/api/obs/output',{action:'output-heartbeat',clientId:h.ids.output,audioReady:true,generation:1,seq:1},{status:401});await entered;
 await h.invoke('/api/obs/access',{action:'revoke',expectedAccessId:created.currentAccessId});release();await pending;assert.equal((await h.row()).state.output,null);assert.equal((await h.row()).state.obsAccess,undefined);
});

test('scoped live calls expose consented display name and required media state, with existing bound output lease and live-only token',async t=>{
 const h=await fixture(t),created=await h.create();await h.heartbeat(created.token);const c=await liveCall(h),query=new URLSearchParams(c.body({}));
 const polled=await h.scoped(created.token,'/api/obs/live-calls?'+query);assert.equal(polled.data.call.context.callName,'Sofietje');for(const word of ['PRIVATE_REASON','PRIVATE_PRONUNCIATION','PRIVATE_NOTE','profileId','entryId','checkpoint','confirmedFacts'])assert(!polled.text.includes(word));
 const token=(await h.scoped(created.token,'/api/obs/live-calls/token',c.body({target:'live'}))).data;assert.equal(token.role,'output');assert.equal(token.target,'live');const claims=JSON.parse(Buffer.from(token.token.split('.')[1],'base64url'));assert.equal(claims.video.room,'live-'+c.call.id);assert.equal(claims.sub,'output-'+c.call.id);
 await h.scoped(created.token,'/api/obs/live-calls/token',c.body({target:'backstage'}),{status:403});await h.scoped(created.token,'/api/obs/live-calls',c.body({action:'heartbeat',clientId:crypto.randomUUID(),target:'live'}),{status:403});
 await h.scoped(created.token,'/api/obs/live-calls',c.body({action:'heartbeat',target:'live',connected:true,audioReady:true}));assert.equal((await c.read()).media.output.connected,true);
});

test('OBS prepared calls receive only scoped script/effect metadata and can claim one effect, acknowledge it and finish only after the host outro request',async t=>{
 const h=await fixture(t),created=await h.create();await h.heartbeat(created.token);const c=await liveCall(h);
 await h.DB.prepare('UPDATE studio_calls SET document = ? WHERE owner_id = ?').bind(JSON.stringify({...await c.read(),mode:'prepared',source:'random',cueId:'random:second',resumeTarget:'ending'}),h.user.id).run();
 const query=new URLSearchParams(c.body({})),polled=await h.scoped(created.token,'/api/obs/live-calls?'+query);assert.equal(polled.data.call.mode,'prepared');assert.equal(polled.data.call.source,'random');assert.equal(polled.data.call.resumeTarget,'ending');for(const hidden of ['PRIVATE_NOTE','PRIVATE_REASON','PRIVATE_PRONUNCIATION','profileId','accountId','liveAgreement','checkpoint'])assert(!polled.text.includes(hidden));
 await h.scoped(created.token,'/api/obs/live-calls',c.body({action:'finish'}),{status:409});await h.scoped(created.token,'/api/obs/live-calls',c.body({action:'magic-choice',choice:'stars'}),{status:403});
 await h.scoped(created.token,'/api/obs/live-calls',c.body({action:'magic-ready'}));assert((await c.read()).magicReadyAt);
 const host=async(action,extra={})=>h.invoke('/api/live-calls',{role:'host',clientId:h.ids.host,gameId:h.game.id,callId:c.call.id,action,...extra},{headers:{'X-Vlampie-Call':'1'}});
 await host('magic-choice',{choice:'bubbles'});const magic=(await c.read()).magic;
 const claim=await h.scoped(created.token,'/api/obs/live-calls',c.body({action:'magic-claim',magicId:magic.id,effectId:magic.effectId}));assert.equal(claim.data.effectGranted,true);assert.equal(claim.data.call.magic.choice,'bubbles');
 const replay=await h.scoped(created.token,'/api/obs/live-calls',c.body({action:'magic-claim',magicId:magic.id,effectId:magic.effectId}));assert.equal(replay.data.effectGranted,false);assert.equal((await c.read()).magic.playedAt,undefined);
 await h.scoped(created.token,'/api/obs/live-calls',c.body({action:'magic-played',magicId:magic.id,effectId:magic.effectId}));assert((await c.read()).magic.playedAt);assert.equal((await c.read()).phase,'live');
 await host('thank');const requested=await h.scoped(created.token,'/api/obs/live-calls?'+query);assert(requested.data.call.outroRequestedAt);
 const closed=await h.scoped(created.token,'/api/obs/live-calls',c.body({action:'finish'}));assert.equal(closed.data.call.phase,'returning');assert.equal((await c.read()).drawHeld,true);assert.equal((await h.bingo.game(h.game.id)).data.state.drawHold.callId,c.call.id);
});

test('queued realtime rechecks revoked capability and aborted request before any provider start',async t=>{
 for(const mode of ['revoke','abort']){
  const h=await fixture(t),created=await h.create();await h.heartbeat(created.token);const c=await liveCall(h);let release,admitted;const entered=new Promise(resolve=>admitted=resolve),held=withProviderSettingsLock({...h.env,NATIVE_PROVIDER_SETTINGS:true},async()=>{admitted();await new Promise(resolve=>release=resolve);});await entered;
  const controller=new AbortController();let calls=0;const pending=h.scoped(created.token,'/api/obs/live-calls/realtime',c.body({sdp:'v=0\r\noffer'}),{status:mode==='revoke'?401:408,signal:controller.signal,providerFetch:async()=>{calls++;throw Error('Must not start');}});
  await new Promise(resolve=>setTimeout(resolve,25));if(mode==='revoke')await h.invoke('/api/obs/access',{action:'revoke',expectedAccessId:created.currentAccessId});else controller.abort();release();await held;await pending;assert.equal(calls,0);assert.equal((await c.read()).realtimeStatus,undefined);
 }
});

test('revocation during provider start retains remote session ID and closes it without granting a programme answer',async t=>{
 for(const hangupSuccess of [true,false]){
  const h=await fixture(t),created=await h.create();await h.heartbeat(created.token);const c=await liveCall(h);let release,started;const entered=new Promise(resolve=>started=resolve);let hangups=0;
  const fetcher=async(url)=>{if(url==='https://api.openai.com/v1/live/sessions'){started();await new Promise(resolve=>release=resolve);return Response.json({session:{id:'live_obs_fixture_session'},transport:{sdp:'v=0\r\nanswer'}});}if(url.endsWith('/hangup')){hangups++;assert.equal((await c.read()).realtimeId,'live_obs_fixture_session');return new Response(null,{status:hangupSuccess?200:500});}if(url.endsWith('/attach'))return new Response(null,{status:500});throw Error('Unexpected provider URL');};
  const pending=h.scoped(created.token,'/api/obs/live-calls/realtime',c.body({sdp:'v=0\r\noffer'}),{status:401,providerFetch:fetcher});await entered;await h.invoke('/api/obs/access',{action:'revoke',expectedAccessId:created.currentAccessId});release();const result=await pending;assert(!result.text.includes('v=0'));assert(hangups>=1);const saved=await c.read();assert.equal(saved.realtimeId,'live_obs_fixture_session');assert.equal(saved.realtimeStopped,hangupSuccess);assert.equal(saved.phase,'returning');assert.equal(saved.drawHeld,true);assert.equal(JSON.parse((await h.DB.prepare('SELECT document FROM bingo_games WHERE id = ?').bind(h.game.id).first()).document).state.drawHold.callId,c.call.id);
 }
});

test('revocation during ready CAS closes the durably known session and leaves the draw hold',async t=>{
 const h=await fixture(t),created=await h.create();await h.heartbeat(created.token);const c=await liveCall(h);let release,ready;const entered=new Promise(resolve=>ready=resolve),original=h.DB.batch.bind(h.DB);let delayed=false,hangups=0;
 h.DB.batch=async statements=>{const readyWrite=statements.find(({sql,args})=>/^UPDATE studio_calls SET game_id/.test(sql)&&JSON.parse(args[2]).realtimeStatus==='ready');if(!delayed&&readyWrite){delayed=true;assert.equal((await c.read()).realtimeId,'live_obs_ready_cas');ready();await new Promise(resolve=>release=resolve);}return original(statements);};
 const providerFetch=async url=>{if(url==='https://api.openai.com/v1/live/sessions')return Response.json({session:{id:'live_obs_ready_cas'},transport:{sdp:'v=0\r\nanswer'}});if(url.endsWith('/hangup')){hangups++;assert.equal((await c.read()).realtimeId,'live_obs_ready_cas');return new Response(null,{status:200});}throw Error('Unexpected provider URL');};
 const pending=h.scoped(created.token,'/api/obs/live-calls/realtime',c.body({sdp:'v=0\r\noffer'}),{status:401,providerFetch});await entered;await h.invoke('/api/obs/access',{action:'revoke',expectedAccessId:created.currentAccessId});release();await pending;
 assert(delayed);assert(hangups>=1);const saved=await c.read();assert.equal(saved.realtimeId,'live_obs_ready_cas');assert.equal(saved.realtimeStopped,true);assert.equal(saved.phase,'returning');assert.equal(saved.drawHeld,true);
});

test('a valid OBS output starts exactly its bound live voice and can close it outside the provider FIFO',async t=>{
 const h=await fixture(t),created=await h.create();await h.heartbeat(created.token);const c=await liveCall(h);let starts=0,hangups=0;
 const providerFetch=async url=>{if(url==='https://api.openai.com/v1/live/sessions'){starts++;return Response.json({session:{id:'live_obs_success'},transport:{sdp:'v=0\r\nanswer'}});}if(url.endsWith('/hangup')){hangups++;return new Response(null,{status:200});}throw Error('Unexpected provider URL');};
 const started=(await h.scoped(created.token,'/api/obs/live-calls/realtime',c.body({sdp:'v=0\r\noffer'}),{providerFetch})).data;assert.equal(started.realtimeId,'live_obs_success');assert.equal(starts,1);assert.equal((await c.read()).realtimeStatus,'ready');
 let release,admitted;const entered=new Promise(resolve=>admitted=resolve),held=withProviderSettingsLock({...h.env,NATIVE_PROVIDER_SETTINGS:true},async()=>{admitted();await new Promise(resolve=>release=resolve);});await entered;
 try{const stopped=await h.scoped(created.token,'/api/obs/live-calls/realtime-stop',c.body({}),{providerFetch});assert.equal(stopped.data.stopped,true);assert.equal(hangups,1);assert.equal((await c.read()).realtimeStopped,true);}finally{release();await held;}
 assert.equal((await c.read()).drawHeld,true);
});

test('PostgreSQL locator lookup, output CAS and stale management intent use the actual adapter',{skip:!process.env.MILO_TEST_DATABASE_URL},async t=>{
 const h=await fixture(t,{postgres:true}),created=await h.create();const verified=await verifyObsAccess(h.request('/api/obs/session',undefined,{'X-Milo-OBS-Token':created.token}),h.env);assert.equal(verified.ownerId,h.user.id);await h.heartbeat(created.token);
 const replacements=await Promise.all([1,2].map(()=>dispatchNodeRequest(h.request('/api/obs/access',{action:'create',gameId:h.game.id,expectedAccessId:created.currentAccessId}),{env:h.env,authClientFactory:auth(h.user),providerFetch:noProvider})));
 assert.deepEqual(replacements.map(response=>response.status).sort(),[200,409]);const latest=await replacements.find(response=>response.status===200).json();await h.scoped(created.token,undefined,undefined,{status:401});assert.equal((await h.scoped(latest.token)).data.role,'output');
});
