import {gameRequestFixture} from './game-request-fixture.mjs';
import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handleCalls as verifiedhandleCalls,CallStore,REALTIME_VOICES,realtimeCharacterVoice} from '../server/calls.js';
import {CharacterSettingsStore} from '../server/character-settings.js';
import {CHARACTER_IDS,CHARACTERS} from '../server/characters.js';
import {transitionCall,expireCall,publicCall} from '../server/calls-model.js';
import {handleBingo as verifiedhandleBingo} from '../server/bingo.js';
import {BingoStore} from '../server/bingo-store.js';
import {makeGame} from '../server/bingo-model.js';
import {productionDefaults} from '../server/production-model.js';
import {writePrivateSetting} from '../server/secrets.js';
import {CallConnection} from '../public/call-common.js';
import {ShowDirector} from '../public/show-director.js';
import {CallOutput} from '../public/call-output.js';
import {PlayerCall} from '../public/call-player.js';
async function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const stmt=(sql,args=[])=>({sql,args,bind:(...args)=>stmt(sql,args),first:async()=>db.prepare(sql).get(...args)||null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:db.prepare(sql).run(...args)})});const files=new Map();let revision=0;
 const env={VLAMPIE_ADMIN_EMAIL:'host@example.test',VLAMPIE_SETTINGS_KEY:'01'.repeat(32),OPENAI_API_KEY:'test-key-never-network',DB:{prepare:sql=>stmt(sql),batch:async ss=>{db.exec('BEGIN');try{const result=ss.map(s=>/RETURNING|^SELECT/i.test(s.sql)?{results:db.prepare(s.sql).all(...s.args)}:{results:[],meta:db.prepare(s.sql).run(...s.args)});db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}},SETTINGS:{get:async k=>{const r=files.get(k);return r?{etag:r.etag,json:async()=>JSON.parse(r.data)}:null;},put:async(k,data,o)=>{const r=files.get(k);if(o?.onlyIf?.etagMatches&&r?.etag!==o.onlyIf.etagMatches||o?.onlyIf?.etagDoesNotMatch==='*'&&r)return null;const value={data,etag:'e'+(++revision)};files.set(k,value);return {etag:value.etag};}}};
 const bingo=new BingoStore(env.DB),calls=new CallStore(env.DB),hostId=crypto.randomUUID(),outputId=crypto.randomUUID(),playerId=crypto.randomUUID(),entryId=crypto.randomUUID();const game=makeGame({title:'Beltest',timeZone:'Europe/Amsterdam',date:'2026-12-05T19:00'},'host','https://studio.example');game.status='running';game.production=productionDefaults();game.production.calls.enabled=true;game.participation=[{id:entryId,accountId:'family',profileId:'james',name:'James',child:true,parentConsent:true,callConsentAt:Date.now(),callStatus:'accepted',micChecked:true,headphones:true}];await bingo.create(game);
 await env.DB.prepare('INSERT INTO studio_outputs (owner_id,revision,document) VALUES (?,0,?)').bind('host',JSON.stringify({producer:{id:hostId,until:Date.now()+900000},output:{id:outputId,until:Date.now()+900000,audioReady:true},routing:true})).run();await writePrivateSetting(env,'call-connection',{mode:'direct',keyId:'',token:''},null);
 const upstream=[];let upstreamHandler=async(url,options)=>{upstream.push({url,options});if(url.includes('generate-ice'))return Response.json({iceServers:[{urls:['turn:turn.cloudflare.com:3478'],username:'temporary',credential:'temporary'}]});if(url.endsWith('/hangup'))return new Response(null,{status:200});return new Response('v=0\r\nanswer',{status:201,headers:{Location:'https://api.openai.com/v1/realtime/calls/rtc_test_123'}});};
 const req=(role,body,extra={})=>{const id=role==='host'?hostId:role==='output'?outputId:playerId,user=role==='player'?'family':'host',path=extra.path||'/api/calls';return new Request('https://studio.example'+path+(body?'':`?gameId=${extra.gameId||game.id}&role=${role}&clientId=${extra.clientId||id}`),{method:body?'POST':'GET',headers:{Origin:'https://studio.example','Content-Type':'application/json','X-Vlampie-Call':'1','X-Vlampie-Bingo':'1','oai-authenticated-user-id':extra.user||user,'oai-authenticated-user-email':(extra.user||user)+'@example.test',...extra.headers},body:body?JSON.stringify({role,clientId:id,gameId:game.id,requestId:crypto.randomUUID(),...body}):undefined});};
 const call=async(role,body,status=200,extra={})=>{const r=await handleCalls(req(role,body,extra),env,(...a)=>upstreamHandler(...a)),data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;};
 const step=async(role,action,body={},status=200)=>call(role,{action,callId:(await calls.get('host'))?.data?.id,...body},status);
 const prepare=()=>call('host',{action:'prepare',entryId});
 const ready=async()=>{await prepare();await step('player','connect');await step('output','heartbeat',{connected:true,micLevel:.2});await step('player','heard');await step('host','ready');};
 return {db,env,files,bingo,calls,game,hostId,outputId,playerId,entryId,req,call,step,prepare,ready,upstream,setUpstream:fn=>upstreamHandler=fn};
}
test('soundcheck, staged ringing, answer, mute, natural wrap and delayed close preserve the bingo hold',async t=>{
 const h=await fixture(t);await h.prepare();await h.step('player','answer',{},409);await h.step('host','ring',{},409);await h.step('player','connect');await h.step('host','ready',{},409);await h.step('output','heartbeat',{connected:true,micLevel:.2});await h.step('player','heard');await h.step('host','ready');assert.equal((await h.calls.get('host')).data.phase,'ready');await h.step('host','ring');assert.equal((await h.bingo.game(h.game.id)).data.state.callId,(await h.calls.get('host')).data.id);
 const r=await h.step('output','realtime',{sdp:'v=0\r\no=test',requestId:'same-request'});assert(r.sdp);let c=(await h.calls.get('host')).data;assert.equal(c.realtimeId,'rtc_test_123');const config=JSON.parse(h.upstream[0].options.body.get('session'));assert.equal(config.audio.output.voice,'ballad');assert.equal(config.audio.input.turn_detection.create_response,false);assert.deepEqual(config.tools,[]);
 await h.step('output','intro-done');await h.step('player','answer');await h.step('host','mute',{muted:true});assert.equal((await h.calls.get('host')).data.muted,true);await h.step('host','finish');c=(await h.calls.get('host')).data;assert.equal(c.phase,'wrapping');assert(c.wrapUntil>Date.now());assert(!h.upstream.some(x=>x.url.endsWith('/hangup')));await h.step('output','goodbye-done');c=(await h.calls.get('host')).data;assert.equal(c.phase,'closing');await h.calls.mutate('host',c=>({...c,closeAt:Date.now()-1}));await h.call('host');c=(await h.calls.get('host')).data;assert.equal(c.phase,'ended');assert.equal((await h.bingo.game(h.game.id)).data.state.callId,null);assert.equal((await h.bingo.game(h.game.id)).data.state.paused,true);assert(h.upstream.some(x=>x.url.endsWith('/hangup')));
});
test('only the selected account and bound host/output can signal or control a call; private fields stay private',async t=>{
 const h=await fixture(t);await h.prepare();await h.call('player',undefined,200,{user:'other'}).then(d=>assert.equal(d.call,null));await h.call('player',{action:'connect',callId:(await h.calls.get('host')).data.id},403,{user:'other'});await h.call('host',undefined,403,{user:'family'});await h.call('host',{action:'ready',callId:(await h.calls.get('host')).data.id,clientId:crypto.randomUUID()},409);await h.step('player','connect');await h.step('player','ring',{},409);await h.step('player','signal',{description:{type:'offer',sdp:'v=0\r\nPRIVATE SDP'}});const output=await h.call('output'),host=await h.call('host'),player=await h.call('player');assert(output.call.offer);assert(!JSON.stringify(host).includes('PRIVATE SDP'));for(const value of [output,host,player])for(const k of ['accountId','hostId','outputId','realtimeId','ops','apiKey'])assert(!Object.hasOwn(value.call,k));await h.call('player',{action:'connect',clientId:crypto.randomUUID(),callId:player.call.id},409);await h.call('host',undefined,403,{headers:{Origin:'https://evil.example'}});
});
test('missed and declined calls retain their short outro before final teardown',async t=>{
 const h=await fixture(t);await h.ready();await h.step('host','ring');await h.step('output','intro-done');await h.step('player','decline');assert.equal((await h.calls.get('host')).data.phase,'unanswered');assert((await h.bingo.game(h.game.id)).data.state.callId);await h.step('output','missed-done');assert.equal((await h.calls.get('host')).data.phase,'declined');assert.equal((await h.bingo.game(h.game.id)).data.state.callId,null);
 const c={phase:'ringing',createdAt:100,ringUntil:1000};expireCall(c,{now:1001});assert.equal(c.phase,'unanswered');expireCall(c,{now:11002});assert.equal(c.phase,'missed');
});
test('API failure clears the show hold, and a stopped in-flight Realtime session is closed on arrival',async t=>{
 const h=await fixture(t);await h.ready();await h.step('host','ring');h.setUpstream(async()=>new Response('failed',{status:429}));await h.step('output','realtime',{sdp:'v=0\r\n',requestId:'failure-stage'},502);assert.equal((await h.calls.get('host')).data.phase,'failed');assert.equal((await h.bingo.game(h.game.id)).data.state.callId,null);
});
test('a newer show can be prepared after a terminal call from an older show',async t=>{
 const h=await fixture(t);await h.prepare();await h.step('host','stop');const next=makeGame({title:'Volgende show',timeZone:'Europe/Amsterdam',date:'2026-12-06T19:00'},'host','https://studio.example');next.status='running';next.production=productionDefaults();next.production.calls.enabled=true;next.participation=[{...h.game.participation[0],id:crypto.randomUUID()}];await h.bingo.create(next);const data=await h.call('host',{action:'prepare',entryId:next.participation[0].id,gameId:next.id});assert.equal(data.call.gameId,next.id);
});
test('a provider response arriving after replacement is hung up without altering the new call',async t=>{
 const h=await fixture(t);await h.ready();await h.step('host','ring');let release,entered;const arrived=new Promise(r=>entered=r),hangups=[];h.setUpstream(async url=>{if(url.endsWith('/hangup')){hangups.push(url);return new Response(null);}entered();await new Promise(r=>release=r);return new Response('v=0\r\n',{status:201,headers:{Location:'https://api.openai.com/v1/realtime/calls/rtc_late_123'}});});
 const pending=h.step('output','realtime',{sdp:'v=0\r\n'},409);await arrived;await h.step('host','stop');await h.bingo.mutate(h.game.id,{},g=>g.participation[0].callStatus='accepted');await h.prepare();const nextId=(await h.calls.get('host')).data.id;release();await pending;assert.equal((await h.calls.get('host')).data.id,nextId);assert.equal((await h.calls.get('host')).data.phase,'checking');assert(hangups.some(x=>x.includes('rtc_late_123')));
});
test('TURN credentials are short-lived; settings stay encrypted and settings reads never expose the token',async t=>{
 const h=await fixture(t);const current=await h.call('host',undefined,200,{path:'/api/calls/settings'});await h.call('host',{mode:'cloudflare',keyId:'key_id_1234567890',token:'PRIVATE_PROVIDER_TOKEN',revision:current.revision},200,{path:'/api/calls/settings'});const data=await h.call('host',undefined,200,{path:'/api/calls/settings'});assert(data.configured);assert(!JSON.stringify(data).includes('PRIVATE_PROVIDER_TOKEN'));assert(![...h.files.values()].some(x=>x.data.includes('PRIVATE_PROVIDER_TOKEN')));await h.prepare();await h.step('player','connect');const ice=await h.step('player','ice');assert(ice.iceServers.length);const providerCall=h.upstream.find(x=>x.url.includes('generate-ice'));assert.equal(JSON.parse(providerCall.options.body).ttl,600);await h.step('player','ice',{},429);await h.call('player',undefined,403,{path:'/api/calls/settings'});
});
test('disconnected output and withdrawn consent terminate calls and keep draws paused',async t=>{
 const h=await fixture(t);await h.ready();await h.step('host','ring');await h.bingo.mutate(h.game.id,{},g=>g.participation[0].callStatus='withdrawn');await h.call('host');assert.equal((await h.calls.get('host')).data.phase,'failed');assert.equal((await h.bingo.game(h.game.id)).data.state.callId,null);assert.equal((await h.bingo.game(h.game.id)).data.participation[0].callStatus,'withdrawn');
});
test('the bingo backend refuses resume, drawing, round switches and finishing while a call holds the game',async t=>{
 const h=await fixture(t);await h.ready();await h.step('host','ring');for(const [action,body] of [['pause',{paused:false}],['reserve',{}],['activate',{blockIndex:0}],['raffle',{}],['finish',{}]]){const req=h.req('host',{regieId:h.hostId,...body},{path:`/api/bingo/games/${h.game.id}/${action}`}),r=await handleBingo(req,h.env);assert.equal(r.status,409,action);}
});
test('the local director never advances or changes scenes during a call',()=>{const d=new ShowDirector({config:{voice:false}});d.draw();d.callHold=true;const scene=d.scene,age=d.flow.age;d.tick(100);assert.equal(d.flow.age,age);assert.equal(d.take('finale'),false);assert.equal(d.resume(),false);assert.equal(d.scene,scene);});
test('client state accepts empty initial polls and rejects older versions',()=>{const api=new CallConnection({role:'host',getGame:()=>null,getClientId:()=>''});api.accept({call:null});api.accept({call:{id:'one',createdAt:1,version:2,phase:'ready'}});api.accept({call:{id:'one',createdAt:1,version:1,phase:'checking'}});assert.equal(api.call.phase,'ready');api.accept({call:{id:'new',createdAt:2,version:1,phase:'checking'}});api.accept({call:{id:'one',createdAt:1,version:4,phase:'ended'}});assert.equal(api.call.id,'new');});
test('guest audio is never in the broadcast or AI input during checking, ready or ringing, and model voice has direct return only after answer',()=>{const output=Object.create(CallOutput.prototype);Object.assign(output,{bridge:{mixer:{voice:80,effects:50}},guestGain:{gain:{}},inputGain:{gain:{}},aiGain:{gain:{}},aiReturnGain:{gain:{}},effectsGain:{gain:{}}});for(const phase of ['checking','ready','announcing','ringing']){output.gate({id:'one',phase});assert.equal(output.guestGain.gain.value,0);assert.equal(output.inputGain.gain.value,0);assert.equal(output.aiReturnGain.gain.value,0);}output.gate({phase:'live'});assert(output.guestGain.gain.value>0);assert.equal(output.inputGain.gain.value,1);assert.equal(output.aiReturnGain.gain.value,1);output.gate({phase:'live',muted:true});assert.equal(output.inputGain.gain.value,0);assert.equal(output.guestGain.gain.value,0);output.gate({phase:'wrapping'});assert.equal(output.inputGain.gain.value,0);assert.equal(output.aiReturnGain.gain.value,1);});
test('player microphone stays off until that player explicitly answers',()=>{const track={enabled:true},player=Object.create(PlayerCall.prototype);player.stream={getAudioTracks:()=>[track]};for(const phase of ['ready','announcing','ringing','live']){player.gate({id:'one',phase});assert.equal(track.enabled,false);}player.answered='one';player.gate({id:'one',phase:'live'});assert.equal(track.enabled,true);player.gate({id:'one',phase:'live',muted:true});assert.equal(track.enabled,false);});

test('a call freezes the selected saved character, shares the global key, and never exposes its private book',async t=>{
 const h=await fixture(t),profiles=new CharacterSettingsStore(h.env.DB);
 await profiles.save('host','stella',{voice:'shimmer',speed:.87,persona:'PRIVATE_STELLA_BOOK: Ik ben Stella, een dromerig hertje.',style:'Zacht en warm, met rustige denkpauzes.',pronunciation:'Stella: Ster-la.'},0);
 await h.bingo.mutate(h.game.id,{},g=>{g.brandId='milo';g.plan.leadId='stella';});
 const prepared=await h.call('host',{action:'prepare',entryId:h.entryId,characterId:'stella'});
 assert.equal(prepared.call.characterId,'stella');assert.equal(prepared.call.characterName,'Stella Sterrenstof');assert.equal(prepared.call.realtimeVoice,'shimmer');assert.equal(prepared.call.characterRevision,1);
 assert(!JSON.stringify(prepared).includes('PRIVATE_STELLA_BOOK'));assert(!Object.hasOwn(prepared.call,'presenter'));
 // Edits after preparation affect the next call, never an ongoing voice session.
 await profiles.save('host','stella',{voice:'cedar',speed:1.2,persona:'NEW_STELLA_BOOK'},1);
 await h.step('player','connect');await h.step('output','heartbeat',{connected:true,micLevel:.2});await h.step('player','heard');await h.step('host','ready');await h.step('host','ring');
 await h.step('output','realtime',{sdp:'v=0\r\no=stella'});
 const upstream=h.upstream.find(x=>x.url==='https://api.openai.com/v1/realtime/calls'),config=JSON.parse(upstream.options.body.get('session'));
 assert.equal(upstream.options.headers.Authorization,'Bearer '+h.env.OPENAI_API_KEY);
 assert.equal(config.audio.output.voice,'shimmer');assert.equal(config.audio.output.speed,.87);
 assert.match(config.instructions,/als Stella Sterrenstof/);assert.match(config.instructions,/PRIVATE_STELLA_BOOK/);assert.doesNotMatch(config.instructions,/NEW_STELLA_BOOK/);assert.match(config.instructions,/Spreek uitsluitend natuurlijk Nederlands/);assert.match(config.instructions,/Verzin geen bingogetallen/);assert.deepEqual(config.tools,[]);
 for(const role of ['host','output','player'])assert(!JSON.stringify(await h.call(role)).includes('PRIVATE_STELLA_BOOK'));
});
test('Realtime compatibility is explicit and all character choices resolve to a supported voice',()=>{
 for(const id of CHARACTER_IDS)assert(REALTIME_VOICES.includes(realtimeCharacterVoice(CHARACTERS[id].voice)),id);
 assert.equal(realtimeCharacterVoice('marin'),'marin');assert.equal(realtimeCharacterVoice('ballad'),'ballad');
 assert.equal(realtimeCharacterVoice('nova'),'coral');assert.equal(realtimeCharacterVoice('onyx'),'cedar');assert.equal(realtimeCharacterVoice('fable'),'verse');
});
test('invalid or cross-production character choices create no call or upstream request',async t=>{
 const h=await fixture(t);
 await h.call('host',{action:'prepare',entryId:h.entryId,characterId:'forged'},400);
 await h.call('host',{action:'prepare',entryId:h.entryId,characterId:'milo'},400);
 assert.equal((await h.calls.get('host'))?.data??null,null);assert.equal(h.upstream.length,0);
 await h.bingo.mutate(h.game.id,{},g=>{g.brandId='milo';g.plan.leadId='milo';});
 await h.call('host',{action:'prepare',entryId:h.entryId,characterId:'vlampie'},400);
 const prepared=await h.prepare();assert.equal(prepared.call.characterId,'milo');assert.equal(CHARACTERS.milo.voice,'verse');assert.equal(prepared.call.realtimeVoice,'verse');
});
test('removing the global key after soundcheck ends the call without contacting the provider',async t=>{
 const h=await fixture(t);await h.ready();await h.step('host','ring');h.env.OPENAI_API_KEY='';
 await h.step('output','realtime',{sdp:'v=0\r\no=missing-key'},503);
 assert.equal(h.upstream.length,0);assert.equal((await h.calls.get('host')).data.phase,'failed');assert.equal((await h.bingo.game(h.game.id)).data.state.callId,null);assert.equal((await h.bingo.game(h.game.id)).data.state.paused,true);
});

function handleCalls(request,env,...args){return verifiedhandleCalls(request,verifiedTestEnvironment(request,env),...args);}
function handleBingo(request,env,...args){return gameRequestFixture(verifiedhandleBingo,request,verifiedTestEnvironment(request,env),...args);}
