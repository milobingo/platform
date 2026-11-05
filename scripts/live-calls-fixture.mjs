import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {BingoStore} from '../server/bingo-store.js';
import {CallStore} from '../server/calls.js';
import {makeGame,generateBooks} from '../server/bingo-model.js';
import {productionDefaults} from '../server/production-model.js';
import {writePrivateSetting} from '../server/secrets.js';
import {handleLiveCalls as verifiedhandleLiveCalls} from '../server/live-calls.js';
import {handleLiveKit as verifiedhandleLiveKit} from '../server/livekit.js';
export async function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 const stmt=(sql,args=[])=>({sql,args,bind:(...a)=>stmt(sql,a),first:async()=>db.prepare(sql).get(...args)||null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:db.prepare(sql).run(...args)})});let rev=0;const files=new Map();
 const env={VLAMPIE_ADMIN_EMAIL:'host@example.test',VLAMPIE_SETTINGS_KEY:'01'.repeat(32),OPENAI_API_KEY:'test-key-no-network',DB:{prepare:sql=>stmt(sql),batch:async statements=>{db.exec('BEGIN');try{const results=statements.map(s=>/RETURNING|^SELECT/i.test(s.sql)?{results:db.prepare(s.sql).all(...s.args)}:{results:[],meta:db.prepare(s.sql).run(...s.args)});db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}},SETTINGS:{get:async k=>{const v=files.get(k);return v?{etag:v.etag,json:async()=>JSON.parse(v.data)}:null;},put:async(k,data,opts)=>{const old=files.get(k);if(opts?.onlyIf?.etagMatches&&opts.onlyIf.etagMatches!==old?.etag||opts?.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const v={etag:'e'+(++rev),data};files.set(k,v);return {etag:v.etag};}}};
 const bingo=new BingoStore(env.DB),calls=new CallStore(env.DB),ids={host:crypto.randomUUID(),player:crypto.randomUUID(),output:crypto.randomUUID()},entryId=crypto.randomUUID();
 const game=makeGame({brandId:'milo',title:'Milo belrepetitie',date:'2026-11-01T14:00'},'host','https://studio.example');generateBooks(game,2,'original-books');game.books.forEach((b,i)=>Object.assign(b,{accountId:'family',profileId:i?'sam':'sophie',name:i?'Sam':'Sophie'}));game.status='running';game.production=productionDefaults();game.production.calls.enabled=true;game.state.drawn=[7,13,27];game.state.lastCommit={number:27};game.participation=[{id:entryId,accountId:'family',profileId:'sophie',name:'Sophie',child:true,parentConsent:true,callConsentAt:Date.now(),callStatus:'accepted',micChecked:true,headphones:true,connectionChecked:true}];await bingo.create(game);
 await bingo.editFamily('family','parent@example.test',f=>{f.ownerName='Parent';f.profiles=[{id:'sophie',name:'Sophie',age:7,dateOfBirth:'2019-04-03'},{id:'sam',name:'Sam',age:9,dateOfBirth:'2017-04-03'}];});
 await env.DB.prepare('INSERT INTO studio_outputs (owner_id,revision,document) VALUES (?,0,?)').bind('host',JSON.stringify({producer:{id:ids.host,until:Date.now()+900000},output:{id:ids.output,until:Date.now()+900000,audioReady:true},routing:true,snapshot:{gameId:game.id}})).run();
 await writePrivateSetting(env,'livekit-cloud',{url:'wss://test-project.livekit.cloud',apiKey:'API_TEST_KEY',apiSecret:'TEST_SECRET_NOT_REAL_12345',connectionTest:{tested:true,testedAt:Date.now()}},null);
 const upstream=[];let handler=async(url,options)=>{upstream.push({url,options});if(url.includes('/twirp/'))return Response.json(url.endsWith('/ListRooms')?{rooms:[]}:{});if(url.endsWith('/hangup'))return new Response(null,{status:200});if(url==='https://api.openai.com/v1/live/sessions')return Response.json({session:{id:'live_livekit_test_123'},transport:{type:'webrtc',sdp:'v=0\r\nanswer'}});return new Response('v=0\r\nanswer',{status:201,headers:{Location:'https://api.openai.com/v1/realtime/calls/rtc_livekit_test_123'}});};
 const req=(role,body,{path='/api/live-calls',user=role==='player'?'family':'host',clientId=ids[role],headers={},gameId=game.id}={})=>new Request('https://studio.example'+path+(body?'':'?'+new URLSearchParams({role,clientId,gameId})),{method:body?'POST':'GET',headers:{Origin:'https://studio.example','Content-Type':'application/json','X-Vlampie-Call':'1','X-Vlampie-Bingo':'1','oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test',...headers},...(body?{body:JSON.stringify({role,clientId,gameId,requestId:crypto.randomUUID(),...body})}:{})});
 const invoke=async(role,body,status=200,extra={})=>{const request=req(role,body,extra),r=await (extra.path?.startsWith('/api/livekit')?handleLiveKit:handleLiveCalls)(request,env,(...a)=>handler(...a)),data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;};
 const current=async()=>(await calls.get('host'))?.data;
 const step=async(role,action,body={},status=200,extra={})=>invoke(role,{action,callId:(await current())?.id,...body},status,extra);
 const prepare=()=>invoke('host',{action:'prepare',entryId,characterId:'milo',context:{callName:'Sofietje',pronunciation:'Soo-fie',reason:'Even kennismaken',note:'Is verlegen; begin makkelijk.'}});
 const answer=async()=>{const c=await current();return step('player','answer',{checkpointId:c.checkpoint.id,heardLastNumber:c.checkpoint.lastNumber,cardsUpdated:true,youtubeMuted:true});};
 const backstage=async()=>{await prepare();await step('host','ring');await answer();await step('host','heartbeat',{target:'backstage',connected:true,micReady:true});await step('player','heartbeat',{target:'backstage',connected:true,micReady:true});};
 const live=async()=>{await backstage();await step('host','backstage-ready',{soundChecked:true,explanationGiven:true});await step('host','stage');await step('host','go-live',{contextConfirmed:true});};
 return {db,env,bingo,calls,ids,entryId,game,files,upstream,req,invoke,step,current,prepare,answer,backstage,live,setUpstream:fn=>handler=fn};
}
export const jwtBody=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));

function handleLiveCalls(request,env,...args){return verifiedhandleLiveCalls(request,verifiedTestEnvironment(request,env),...args);}
function handleLiveKit(request,env,...args){return verifiedhandleLiveKit(request,verifiedTestEnvironment(request,env),...args);}
