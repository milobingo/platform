import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {makeGame} from '../server/bingo-model.js';
import {handleOpenAI as verifiedHandleOpenAI} from '../server/openai.js';
globalThis.crypto??=webcrypto;

class PrivateBucket{
 constructor(){this.items=new Map();this.seq=0;}
 async get(path){const item=this.items.get(path);return item?{etag:item.etag,json:async()=>JSON.parse(item.body)}:null;}
 async put(path,body,{onlyIf}={}){const old=this.items.get(path);if(onlyIf?.etagDoesNotMatch==='*'&&old||onlyIf?.etagMatches&&old?.etag!==onlyIf.etagMatches)return null;const etag='revision-'+(++this.seq);this.items.set(path,{body,etag});return {etag};}
}
function fixture(){
 const owner=crypto.randomUUID(),game=makeGame({brandId:'milo',title:'Milo’s testshow',date:'2026-11-18T13:30'},owner,'https://studio.example');game.status='running';game.state.epoch='epoch-1';game.state.drawn=[3,17,53];game.state.lastCommit={number:53};
 const bucket=new PrivateBucket(),f={owner,game,call:null,requests:[],mode:'ok',reply:'Pak jullie boekjes maar. We maken er samen een magisch moment van!',fetches:0};
 f.env={VLAMPIE_ADMIN_EMAIL:'owner@example.test',VLAMPIE_SETTINGS_KEY:'00'.repeat(32),OPENAI_API_KEY:'test-not-a-real-secret',SETTINGS:bucket,DB:{prepare(sql){return {bind(...args){return {async first(){if(sql.includes('FROM bingo_games'))return args[0]===game.id?{id:game.id,owner_id:owner,revision:1,document:JSON.stringify(game)}:null;if(sql.includes('FROM show_character_settings'))return null;if(sql.includes('FROM studio_calls'))return f.call?{owner_id:owner,game_id:f.call.gameId,revision:1,document:JSON.stringify(f.call)}:null;throw Error('Unexpected database write/query: '+sql);}};}};}}};
 f.body={gameId:game.id,characterId:'milo',instruction:'Bouw rustig spanning op voor het volgende magische moment.',requestId:crypto.randomUUID()};
 f.request=(body=f.body,headers={})=>new Request('https://studio.example/api/openai/director-whisper',{method:'POST',headers:{Origin:'https://studio.example','Content-Type':'application/json','oai-authenticated-user-id':owner,'oai-authenticated-user-email':'owner@example.test','X-Milo-Director':'1',...headers},body:JSON.stringify(body)});
 f.fetcher=async(url,options)=>{f.fetches++;const body=JSON.parse(options.body);f.requests.push({url,body});if(url.endsWith('/moderations'))return Response.json({results:[{flagged:f.mode==='flagged'}]});assert(url.endsWith('/responses'));if(f.onResponse)await f.onResponse();if(f.mode==='throw')throw Error('private transport error '+f.env.OPENAI_API_KEY);if(f.mode==='429')return Response.json({error:'secret raw'}, {status:429});if(f.mode==='incomplete')return Response.json({status:'incomplete'});return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({action:'reply',reply:f.reply})}]}]});};
 f.callApi=async(body=f.body,headers={},fetcher=f.fetcher)=>handleOpenAI(f.request(body,headers),f.env,fetcher);
 return f;
}
const noFetch=()=>{throw Error('Unauthorized request spent provider credit');};

test('director hints require owner, exact origin, regie header, own show and permitted character before spending credit',async()=>{
 const f=fixture();
 for(const [body,headers,status] of [
  [f.body,{'oai-authenticated-user-id':''},401],
  [f.body,{'oai-authenticated-user-email':'family@example.test'},403],
  [f.body,{Origin:'https://other.example'},403],
  [f.body,{Origin:''},403],
  [f.body,{'X-Milo-Director':''},403],
  [f.body,{'X-Vlampie-Player':'1'},403],
  [f.body,{'oai-authenticated-user-id':'another-owner'},403],
  [{...f.body,gameId:undefined},{},400],
  [{...f.body,requestId:'guess'},{},400],
  [{...f.body,instruction:' '},{},400],
  [{...f.body,instruction:'x'.repeat(501)},{},400],
  [{...f.body,characterId:'vlampie'},{},409],
 ])assert.equal((await f.callApi(body,headers,noFetch)).status,status);
 f.game.status='finished';assert.equal((await f.callApi(f.body,{},noFetch)).status,409);
});

test('a natural reaction uses saved cast identity and only server facts; hint and game state stay private',async()=>{
 const f=fixture(),original=structuredClone(f.game),canary='PRIVATE_CANARY_DIRECTOR_DO_NOT_BROADCAST';
 const body={...f.body,characterId:'stella',instruction:'Stel een makkelijke vraag over sterren. '+canary,drawn:[99],name:'Private parent account'};
 f.reply='Welke kleur zou jouw eigen ster krijgen?';
 const response=await f.callApi(body),data=await response.json();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(data,{status:'prepared',requestId:body.requestId,characterId:'stella',gameId:f.game.id,contextCallId:null,reply:f.reply,simulated:false});
 assert.equal(f.fetches,3);const generation=f.requests.find(r=>r.url.endsWith('/responses')).body;assert.match(generation.instructions,/Stella/);assert.equal(generation.store,false);assert.equal(generation.text.format.strict,true);
 const input=JSON.parse(generation.input);assert.deepEqual(input.openbareShow.drawn,[3,17,53]);assert.equal(input.openbareShow.lastNumber,53);assert(!generation.input.includes('Private parent account'));assert(!generation.input.includes('99'));
 assert(!JSON.stringify(data).includes(canary));assert.deepEqual(f.game,original);
 for(const item of f.env.SETTINGS.items.values()){assert(!item.body.includes(canary));assert(!item.body.includes(f.reply));assert(!item.body.includes(f.env.OPENAI_API_KEY));}
});

test('all twelve Milo presenters and Vlampie use their own permitted cast without requiring the stored lead',async()=>{
 for(const characterId of ['milo','stella','otto','pip','lola','bella','piko','bruno','nino','benny','kora','coco']){
  const f=fixture();assert.equal((await f.callApi({...f.body,characterId})).status,200,characterId);
 }
 const f=fixture();f.game.brandId='vlampie';assert.equal((await f.callApi(f.body,{},noFetch)).status,409);assert.equal((await f.callApi({...f.body,characterId:'vlampie'})).status,200);
});

test('same id is a durable encrypted reply and a changed hint never reuses it',async()=>{
 const f=fixture(),first=await (await f.callApi()).json(),count=f.fetches;
 const replay=await (await f.callApi()).json();assert.deepEqual(replay,{...first,replayed:true});assert.equal(f.fetches,count);
 assert.equal((await f.callApi({...f.body,instruction:'Vertel iets anders.'},{},noFetch)).status,409);
 f.game.state.epoch='epoch-2';assert.equal((await f.callApi(f.body,{},noFetch)).status,409);
});

test('parallel preparation shares one CAS claim and an uncertain attempt is not silently regenerated',async()=>{
 const f=fixture();let release,started;const entered=new Promise(r=>started=r);f.onResponse=()=>{started();return new Promise(r=>release=r);};
 const first=f.callApi();await entered;const parallel=await f.callApi();assert.equal(parallel.status,409);assert.equal((await parallel.json()).error.code,'whisper_pending');
 release();assert.equal((await first).status,200);assert.equal(f.requests.filter(r=>r.url.endsWith('/responses')).length,1);
 const bad=fixture();bad.mode='throw';assert.equal((await bad.callApi()).status,503);const calls=bad.fetches;assert.equal((await bad.callApi()).status,503);assert.equal(bad.fetches,calls);
});

test('moderation, private echoes, invented numbers, results and incomplete provider output cannot become a prepared reply',async()=>{
 for(const setup of [f=>f.mode='flagged',f=>f.mode='incomplete',f=>f.reply=f.body.instruction,f=>f.reply='Het volgende nummer is 74.',f=>f.reply='Ik kies 75!',f=>f.reply='Wij trekken drieënvijftig!',f=>f.reply='Gefeliciteerd, jij hebt gewonnen!',f=>f.reply='Je hebt bingo!',f=>f.reply='ＢＩＮＧＯ! Je hebt gewonnen!',f=>f.reply='Sophie, jouw gezin krijgt de hoofdprijs!',f=>f.reply='Dit is jouw troostprijs.',f=>f.reply='Jij bent onze winnares.']){
  const f=fixture();setup(f);const response=await f.callApi(),text=await response.text();assert(response.status>=400);assert(!text.includes(f.env.OPENAI_API_KEY));
  const calls=f.fetches;assert((await f.callApi()).status>=400);assert.equal(f.fetches,calls);
 }
 const f=fixture();f.reply='Nummer 53 is al getrokken. Heb je die gevonden?';assert.equal((await f.callApi()).status,200);
});

test('normal hints remain possible during private backstage without guest data, but never bypass LiveKit drawHold or switching',async()=>{
 const f=fixture(),id=crypto.randomUUID();f.game.state.drawHold={id:'hold',callId:id};f.call={id,gameId:f.game.id,transport:'livekit',phase:'backstage',context:{callName:'PRIVATE_CHILD',note:'PRIVATE_BACKSTAGE'},realtimeId:null};
 const response=await f.callApi(),data=await response.json();assert.equal(response.status,200);assert.equal(data.contextCallId,id);assert(!JSON.stringify(f.requests).includes('PRIVATE_CHILD'));assert(!JSON.stringify(f.requests).includes('PRIVATE_BACKSTAGE'));
 for(const update of [{phase:'live'},{phase:'staged',switchingLive:true},{phase:'staged',realtimeId:'live_existing'},{phase:'returning'}]){
  const x=fixture();x.game.state.drawHold={id:'hold',callId:id};x.call={id,gameId:x.game.id,transport:'livekit',phase:'backstage',...update};assert.equal((await x.callApi(x.body,{},noFetch)).status,409);
 }
 const race=fixture();race.call={id,gameId:race.game.id,transport:'livekit',phase:'live'};assert.equal((await race.callApi(race.body,{},noFetch)).status,409,'call installed before drawHold must block too');
 const other=fixture();other.call={id,gameId:crypto.randomUUID(),transport:'livekit',phase:'backstage'};assert.equal((await other.callApi(other.body,{},noFetch)).status,409);
});

test('a show epoch change or backstage-to-live transition during generation discards the reaction and preserves the hold',async()=>{
 for(const mode of ['epoch','call']){
  const f=fixture(),id=crypto.randomUUID();if(mode==='call'){f.game.state.drawHold={id:'hold',callId:id};f.call={id,gameId:f.game.id,transport:'livekit',phase:'backstage'};}
  f.onResponse=async()=>{if(mode==='epoch')f.game.state.epoch='new-epoch';else f.call.phase='live';};
  const hold=structuredClone(f.game.state.drawHold),response=await f.callApi();assert.equal(response.status,409);assert.deepEqual(f.game.state.drawHold,hold);assert.equal(f.requests.filter(r=>r.url.endsWith('/responses')).length,1);
 }
});

function handleOpenAI(request,env,...args){return verifiedHandleOpenAI(request,verifiedTestEnvironment(request,env),...args);}

test('real handler ignores forged identity headers and environment mode cannot save or substitute provider keys',async()=>{
 const f=fixture();
 assert.equal((await verifiedHandleOpenAI(f.request(),f.env,noFetch)).status,401);
 assert.equal((await verifiedHandleOpenAI(f.request(),{...f.env,AUTH_IDENTITY:{user:f.owner,admin:false}},noFetch)).status,403);
 const environment={...f.env,OPENAI_ENV_ONLY:true,AUTH_IDENTITY:{user:f.owner,admin:true}};
 const status=new Request('https://studio.example/api/openai/status');
 const info=await (await verifiedHandleOpenAI(status,environment,noFetch)).json();assert.equal(info.source,'environment');assert.equal(info.canManage,false);
 const save=new Request('https://studio.example/api/openai/settings',{method:'POST',headers:{Origin:'https://studio.example','X-Vlampie-Settings':'1','Content-Type':'application/json'},body:JSON.stringify({action:'save',revision:null,key:'sk-dummy-never-use-elsewhere'})});
 const denied=await verifiedHandleOpenAI(save,environment,noFetch);assert.equal(denied.status,409);assert.equal((await denied.json()).error.code,'server_secret_required');
 const prepared=await verifiedHandleOpenAI(f.request(),environment,async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer '+f.env.OPENAI_API_KEY);return f.fetcher(url,options);});assert.equal(prepared.status,200);
});

test('a short raw whisper echo remains private when the provider changes punctuation, case or accents',async()=>{
 for(const [instruction,reply] of [['Vraag iets','"Vraag iets!"'],['Rústig aan!','Rustig aan.'],['VRAAG IETS','vraag iets'],['Vraag iets','Ｖｒａａｇ　ｉｅｔｓ！'],['Vertel rustig dat de sterren schitteren','"Vertel rustig dat de sterren schitteren!" Daarna lachen we.']]){
  const f=fixture();f.body.instruction=instruction;f.reply=reply;const response=await f.callApi();assert.equal(response.status,422);assert.equal((await response.json()).error.code,'whisper_private_echo');
 }
});
