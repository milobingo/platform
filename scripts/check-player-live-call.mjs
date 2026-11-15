// State/control regression fixtures. These do not claim a cloud connection,
// physical microphone, YouTube playback, or real broadcast audio was tested.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerLiveCallController,playerCallActive} from '../frontend/player-live-call.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const checkpoint={id:'checkpoint-1',epoch:7,drawnCount:3,lastNumber:42,drawn:[2,18,42]};
function fixture(options={}){
 const events=[],actions=[],requests=[];let server=null;const game=options.game||{id:'game-1'};let visible=true,clock=100000;
 const video={info:{framePresent:true,ready:true,playing:true,muted:false,volume:80,state:1,currentTime:300,duration:8000},
  async suspend(){events.push('youtube:suspend');this.info={...this.info,playing:false,muted:true};return {silenced:options.silenced!==false,method:'fixture'};},
  async restore(){events.push('youtube:restore');this.info={...this.info,framePresent:true};},
  async resume(){events.push('youtube:resume');this.info={...this.info,...(options.autoplay===false?{playing:false,muted:true}:{playing:true,muted:false,volume:80})};return {...this.info};},
  getInfo(){return {...this.info};}};
 class Connection{
  constructor(config){this.config=config;this.call=null;}
  emit(value){server=value;this.call=value;this.config.onChange(value);}
  async poll(){events.push('server:poll');this.emit(server);return {call:server};}
  async action(action,extra={}){events.push('server:'+action);actions.push({action,...extra});let phase=server?.phase;if(action==='answer')phase='backstage';if(['fail','cancel','decline'].includes(action))phase='returning';if(action==='player-returned')phase='returned';this.emit({...server,phase,version:(server?.version||0)+1});return {call:server};}
  leave(){events.push('server:leave');}dispose(){events.push('server:dispose');}
 }
 class Media{
  constructor(config){this.config=config;this.state={connected:false,target:null,micReady:false,micPublished:false,micMuted:true,audioReady:false};}
  async connect(target){events.push('media:connect:'+target);this.state={...this.state,phase:'connected',connected:true,target,micReady:true,micPublished:true,micMuted:false,audioReady:true};this.config.onState(this.state);}
  async disconnect(){events.push('media:disconnect');this.state={...this.state,connected:false,micPublished:false};this.config.onState(this.state);}
  async setMuted(muted){events.push('media:muted:'+muted);this.state={...this.state,micMuted:muted,micPublished:!muted};this.config.onState(this.state);}
  async startAudio(){events.push('media:start-audio');this.state={...this.state,audioReady:true};this.config.onState(this.state);}
  getState(){return this.state;}async dispose(){await this.disconnect();events.push('media:dispose');}
 }
 const preflight=async args=>{events.push('media:preflight:'+args.profileId);return {microphone:true,connection:true,micChecked:true,connectionChecked:true,simulated:false};};
 const controller=new PlayerLiveCallController({getGame:()=>game,accountId:'parent',broadcast:video,Connection,Media,preflight,timers:false,requestGame:async(path,request)=>{requests.push({path,...request});return {game};},isVisible:()=>visible,...(options.game?{now:()=>clock}:{})});
 const call=(phase,extra={})=>({id:'call-1',gameId:'game-1',phase,profileId:'sophie',name:'Sophie',context:{callName:'Sophie'},checkpoint,endedAt:Date.now()-1000,returnState:{cue:{id:'cue-fixture',publishedAt:Date.now(),lastNumber:42}},drawHeld:true,version:1,...extra});
 return {controller,events,actions,requests,game,video,call,setVisible(value){visible=value;},advance(ms){clock+=ms;},async set(phase,extra={}){controller.connection.emit(call(phase,extra));await flush();},setServer(phase,extra={}){server=call(phase,extra);},clear(){events.length=0;actions.length=0;}};
}

test('ordinary viewers and ringing calls open no room; heard checkpoint and updated cards are required',async()=>{
 const f=fixture();try{await f.controller.poll();await f.set('preparing');await f.set('ringing');assert.equal(f.events.some(e=>e.startsWith('media:connect')),false);
  await assert.rejects(f.controller.answer({heard:false,cardsUpdated:true}),/laatste nummer/);await assert.rejects(f.controller.answer({heard:true,cardsUpdated:false}),/kaart/);assert.equal(f.actions.length,0);
  f.clear();await f.controller.answer({heard:true,cardsUpdated:true});await flush();
  assert.deepEqual(f.actions[0],{action:'answer',checkpointId:checkpoint.id,heardLastNumber:42,cardsUpdated:true,youtubeMuted:true});
  assert(f.events.indexOf('youtube:suspend')<f.events.indexOf('server:answer'));assert(f.events.indexOf('server:answer')<f.events.indexOf('media:connect:backstage'));assert.equal(f.events.some(e=>e==='media:connect:live'),false);
 }finally{await f.controller.dispose();}
});
test('an unverified YouTube mute prevents answer and any direct audio room',async()=>{
 const f=fixture({silenced:false});try{await f.set('ringing');await assert.rejects(f.controller.answer({heard:true,cardsUpdated:true}),/gedempt/);assert.equal(f.actions.length,0);assert.equal(f.events.some(e=>e.startsWith('media:connect')),false);}finally{await f.controller.dispose();}
});
test('live handover leaves backstage before joining live; participant unmute requires explicit republish',async()=>{
 const f=fixture();try{await f.set('backstage');f.clear();await f.set('live',{muted:false});assert(f.events.indexOf('media:disconnect')<f.events.indexOf('media:connect:live'));assert(f.events.indexOf('youtube:suspend')<f.events.indexOf('media:connect:live'));
  await f.set('live',{muted:true});assert.equal(f.controller.getSnapshot().media.micPublished,false);await assert.rejects(f.controller.resumeMicrophone(),/niet vrijgegeven/);
  f.clear();await f.set('live',{muted:false});assert.equal(f.controller.getSnapshot().needMicResume,true);assert.equal(f.events.includes('media:muted:false'),false);await f.controller.resumeMicrophone();assert.equal(f.controller.getSnapshot().needMicResume,false);assert.equal(f.controller.getSnapshot().media.micPublished,true);
 }finally{await f.controller.dispose();}
});
test('unexpected staged-room loss fails safely; only a server-confirmed handover suppresses failure',async()=>{
 const f=fixture();try{await f.set('staged');f.clear();await f.controller.mediaFailed(Object.assign(Error('connection lost'),{target:'backstage'}));await flush();assert(f.actions.some(a=>a.action==='fail'));assert.equal(f.controller.call.phase,'returning');assert.equal(f.controller.call.drawHeld,true);assert.equal(f.actions.some(a=>a.action==='resume-draw'),false);}finally{await f.controller.dispose();}
 const g=fixture();try{await g.set('staged');g.setServer('staged',{switchingLive:true});g.clear();await g.controller.mediaFailed(Object.assign(Error('private room closed'),{target:'backstage'}));assert.equal(g.actions.some(a=>a.action==='fail'),false);g.setServer('live');await g.controller.poll();await flush();assert(g.events.includes('media:connect:live'));}finally{await g.controller.dispose();}
});
test('returning restores controls without inventing playback; explicit audible normal-show confirmation precedes server return',async()=>{
 const f=fixture({autoplay:false});try{await f.set('live');f.clear();await f.set('returning');assert(f.events.includes('youtube:restore'));assert.equal(f.actions.length,0);
  await f.controller.resumeVideo();assert.equal(f.controller.getSnapshot().returnReported,false);await assert.rejects(f.controller.confirmReturn({heardNormalShow:false}),/Bevestig/);await assert.rejects(f.controller.confirmReturn({heardNormalShow:true}),/geluid/);assert.equal(f.actions.length,0);
  f.video.info={...f.video.info,playing:true,muted:false,volume:80,currentTime:7999,duration:8000,liveSeek:{target:8000,requestedAt:Date.now()},observedAt:Date.now()};await f.controller.confirmReturn({heardNormalShow:true});const returned=f.actions.find(a=>a.action==='player-returned');assert(returned.confirmed);assert.equal(returned.checkpointId,checkpoint.id);assert.equal(returned.playbackInfo.source,'youtube-live-seek-and-parent-confirmation');assert.equal(returned.playbackInfo.normalShowConfirmed,true);assert.equal(f.controller.getSnapshot().returnReported,true);assert.equal(f.controller.call.drawHeld,true);assert.equal(f.actions.some(a=>a.action==='resume-draw'),false);
 }finally{await f.controller.dispose();}
});
test('fallback return is explicitly a parent manual check, and absent video cannot be confirmed',async()=>{
 const f=fixture();try{await f.set('returning');f.video.info={framePresent:false,ready:false};await assert.rejects(f.controller.confirmReturn({heardNormalShow:true}),/geen YouTube/);f.video.info={framePresent:true,ready:false};await assert.rejects(f.controller.confirmReturn({heardNormalShow:true}),/terugkeercue/);await f.controller.confirmReturn({heardNormalShow:true,heardCurrentCue:true});assert.equal(f.actions.at(-1).playbackInfo.source,'current-cue-and-parent-confirmation');assert.equal(f.actions.at(-1).playbackInfo.apiAvailable,false);}finally{await f.controller.dispose();}
});
test('preflight is opt-in for the selected child and disposal closes media without releasing the hold',async()=>{
 const f=fixture();try{await f.set('preparing');assert.equal(f.events.some(e=>e.startsWith('media:preflight')),false);const proof=await f.controller.checkConnection('sophie');assert(proof.microphone&&proof.connection);assert(f.events.includes('media:preflight:sophie'));assert.equal(playerCallActive(f.controller.call),true);await f.controller.dispose();assert(f.events.includes('server:leave'));assert(f.events.includes('media:dispose'));assert.equal(f.actions.some(a=>a.action==='resume-draw'),false);}finally{await f.controller.dispose();}
});
test('a passive second call tab opens no microphone and cannot cancel; parent withdrawal remains a separate action',async()=>{const f=fixture();try{await f.set('live',{canControl:false});assert.equal(f.events.some(e=>e.startsWith('media:connect')),false);await assert.rejects(f.controller.stop(),/ander apparaat/);assert.equal(f.actions.length,0);await f.controller.withdrawConsent();assert.equal(f.actions.at(-1).action,'withdraw-consent');assert.equal(f.actions.some(a=>a.action==='resume-draw'),false);}finally{await f.controller.dispose();}});


test('Milo presence is per consenting child and current show, deduplicates books and never renews technical checks',async()=>{
 const game={id:'game-1',brandId:'milo',status:'running',books:[{profileId:'sophie',admitted:true,accountId:'parent'},{profileId:'sophie',admitted:true,accountId:'parent'},{profileId:'brother',admitted:true,accountId:'parent'},{profileId:'foreign',admitted:true,accountId:'another-parent'},{profileId:'revoked',admitted:true,revokedAt:1}],production:{participation:[{profileId:'sophie',callConsentEnabled:true,callStatus:'done',technicalReadyAt:90000},{profileId:'brother',callConsentEnabled:false},{profileId:'foreign',callConsentEnabled:true},{profileId:'revoked',callConsentEnabled:true}]}};
 const f=fixture({game});try{
  await f.controller.heartbeatPresence();assert.equal(f.requests.length,1);assert.deepEqual(f.requests[0].body,{kind:'presence',profileId:'sophie',visible:true,technicalContext:f.requests[0].body.technicalContext});assert.equal(f.requests[0].path,'/games/game-1/participation');assert.equal(f.events.some(event=>event.startsWith('media:')),false);
  await f.controller.heartbeatPresence();assert.equal(f.requests.length,1);f.advance(15000);await f.controller.heartbeatPresence();assert.equal(f.requests.length,2);
  f.setVisible(false);await f.controller.heartbeatPresence({force:true});assert.deepEqual(f.requests.at(-1).body,{kind:'presence',profileId:'sophie',visible:false,technicalContext:f.requests[0].body.technicalContext});f.advance(15000);await f.controller.heartbeatPresence();assert.equal(f.requests.length,3,'A hidden app sends one offline update, never a recurring presence heartbeat');
  game.production.participation[0].callConsentEnabled=false;f.advance(15000);await f.controller.heartbeatPresence();assert.equal(f.requests.length,3,'Withdrawn child sends no eligible heartbeat');
  game.id='game-2';game.production.participation=[{profileId:'brother',callConsentEnabled:true}];f.setVisible(true);await f.controller.heartbeatPresence();assert.equal(f.requests.at(-1).path,'/games/game-2/participation');assert.equal(f.requests.at(-1).body.profileId,'brother');
 }finally{await f.controller.dispose();}
 const legacy=fixture({game:{id:'game-1',brandId:'vlampie',books:[{profileId:'sophie',admitted:true}],production:{participation:[{profileId:'sophie',callConsentEnabled:true}]}}});try{await legacy.controller.heartbeatPresence();assert.equal(legacy.requests.length,0);}finally{await legacy.controller.dispose();}
});
test('Milo leaves every YouTube control untouched while answering, switching, declining and finishing',async()=>{
 const f=fixture({game:{id:'game-1',brandId:'milo'}});try{await f.set('ringing');f.clear();f.video.info.muted=true;const before={...f.video.info};await f.controller.answer();await flush();assert.equal(f.controller.call.phase,'backstage');assert.deepEqual(f.video.info,before);assert.equal(Object.hasOwn(f.actions[0],'youtubeMuted'),false);await f.set('live');await f.controller.stop();await f.set('returning');await f.controller.resumeVideo();await f.controller.confirmReturn();assert.equal(f.events.some(event=>event.startsWith('youtube:')),false);assert.deepEqual(f.video.info,before);assert.equal(f.actions.at(-1).action,'player-returned');assert.deepEqual(f.actions.at(-1),{action:'player-returned',confirmed:true});}finally{await f.controller.dispose();}
});

test('Milo live agreement requires explicit family permission and an actual private media check',async()=>{
 const f=fixture({game:{id:'game-1',brandId:'milo'}});try{await f.set('ringing');await assert.rejects(f.controller.agreeLive({agreed:true}),/privécontrole/);await f.set('backstage');f.clear();await assert.rejects(f.controller.agreeLive(),/ouder/);f.controller.status.media={...f.controller.status.media,audioReady:false};await assert.rejects(f.controller.agreeLive({agreed:true}),/elkaar hoort/);assert.equal(f.actions.length,0);f.controller.status.media={...f.controller.status.media,audioReady:true};await f.controller.agreeLive({agreed:true});assert.deepEqual(f.actions.at(-1),{action:'agree-live',agreed:true});assert.equal(f.controller.call.phase,'backstage');assert.equal(f.actions.some(action=>action.action==='go-live'||action.action==='resume-draw'),false);
 }finally{await f.controller.dispose();}
});
test('Milo magic waits for actual greeting readiness and reuses the choice request on retry',async()=>{
 const f=fixture({game:{id:'game-1',brandId:'milo'}});try{await f.set('live',{mode:'prepared'});await assert.rejects(f.controller.chooseMagic('stars'),/presentator/);await f.set('live',{mode:'prepared',magicReadyAt:1000});f.clear();const original=f.controller.connection.action.bind(f.controller.connection);let failed=true;f.controller.connection.action=async(action,body)=>{if(action==='magic-choice'&&failed){failed=false;f.actions.push({action,...body});throw Error('Fixture connection failure');}return original(action,body);};await assert.rejects(f.controller.chooseMagic('stars'),/Fixture/);const requestId=f.actions[0].requestId;await f.controller.chooseMagic('stars');assert.equal(f.actions.at(-1).requestId,requestId);assert.equal(f.actions.at(-1).choice,'stars');await f.set('live',{mode:'prepared',magicReadyAt:1000,magic:{choice:'stars',effectId:'one-effect'}});f.clear();await f.controller.chooseMagic('stars');assert.equal(f.actions.length,0);await assert.rejects(f.controller.chooseMagic('bubbles'),/al vast/);assert.equal(f.actions.length,0);
 }finally{await f.controller.dispose();}
});
test('Milo emergency withdrawal starts immediately during another action and does not wait for slow room cleanup',async()=>{
 const f=fixture({game:{id:'game-1',brandId:'milo'}});try{await f.set('live');f.clear();let release;const slow=new Promise(resolve=>release=resolve),disconnect=f.controller.media.disconnect.bind(f.controller.media);f.controller.media.disconnect=()=>{void disconnect();return slow;};f.controller.status.busy=true;const operation=f.controller.withdrawConsent();await flush();assert.equal(f.actions[0]?.action,'withdraw-consent');assert.equal(f.controller.status.media.micPublished,false);assert.equal(f.controller.blockedCallId,'call-1');await f.set('live',{mode:'prepared'});assert.equal(f.events.filter(event=>event==='media:connect:live').length,0,'A stale live projection cannot reopen a withdrawn microphone');release();await operation;assert.equal(f.actions.some(action=>action.action==='resume-draw'),false);f.controller.status.busy=false;
 }finally{await f.controller.dispose();}
});
test('Milo call closure does not inspect playback, live position or require a family return form',async()=>{
 const f=fixture({game:{id:'game-1',brandId:'milo'}});try{await f.set('returning',{resourcesClosed:true});f.video.info={framePresent:false,muted:true,currentTime:1,duration:99999};f.clear();await f.controller.confirmReturn();assert.deepEqual(f.actions[0],{action:'player-returned',confirmed:true});assert.equal(f.events.some(event=>event.startsWith('youtube:')),false);assert.equal(f.controller.call.drawHeld,true);assert.equal(f.actions.some(action=>action.action==='resume-draw'),false);}finally{await f.controller.dispose();}
});
