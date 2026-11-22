import test from 'node:test';
import assert from 'node:assert/strict';
import {programBroadcastRequest,programVisibleDrawn} from '../frontend/program-broadcast-api.js';
import {ProgramCast,CAST_RECEIVER_MARKER} from '../frontend/program-cast.js';
import {ProgramBroadcastController} from '../frontend/program-broadcast-player.js';

const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}assert.fail('Expected state was not reached');};
class Emitter{constructor(){this.events=new Map();}on(name,fn){if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(fn);}off(name,fn){this.events.get(name)?.delete(fn);}emit(name,...events){for(const fn of this.events.get(name)||[])fn(...events);}addEventListener(name,fn){this.on(name,fn);}removeEventListener(name,fn){this.off(name,fn);}}
class Element extends Emitter{
 constructor(tag){super();this.tagName=tag;this.children=[];this.muted=true;this.paused=true;this.isConnected=false;this.attributes={};}
 setAttribute(key,value){this.attributes[key]=value;}append(node){this.children.push(node);node.parent=this;node.isConnected=true;}remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.isConnected=false;}
 play(){if(this.rejectPlay)return Promise.reject(Error('Browser blocked audio'));this.paused=false;this.emit('playing');return Promise.resolve();}pause(){this.paused=true;}load(){}canPlayType(){return 'probably';}
}
function mediaFixture({config={state:'live',hls:{available:true}}}={}){
 const document={createElement:tag=>new Element(tag)},container=new Element('div'),publications=[],credentials={url:'wss://media.example.invalid',token:'fixture-viewer-only',publisherIdentity:'programme-show',programTrackNames:{video:'programme-video',audio:'programme-audio'}};
 class Room extends Emitter{constructor(options){super();this.options=options;this.remoteParticipants=new Map();this.canPlaybackAudio=true;Room.latest=this;}async connect(url,token,options){this.connection={url,token,options};}async disconnect(){this.disconnected=true;}async startAudio(){this.audioStarted=true;}}
 class Cast{constructor({onChange}){this.onChange=onChange;this.active=false;this.initialize=async()=>{};}async start(){this.active=true;this.onChange({castActive:true,castPhase:'playing'});}async stop(){if(this.refuseStop)throw Error('TV stop not acknowledged');this.active=false;this.onChange({castActive:false,castPhase:'idle'});}dispose(){}}
 const request=async(_id,action)=>action==='token'?credentials:{url:'https://example.invalid/api/broadcast/hls/fixture/live.m3u8',expiresAt:Date.now()+60000,mimeType:'application/x-mpegURL'};
 const controller=new ProgramBroadcastController({request,loadSDK:async()=>({Room}),Cast,document});controller.mount(container,{gameId:'show',config});
 const publish=(kind,name=credentials.programTrackNames[kind],identity=credentials.publisherIdentity)=>{
  const publication={kind,trackName:name,trackSid:name,subscribed:null,setSubscribed(value){this.subscribed=value;}},track={kind,sid:name,attach(element){this.element=element;},detach(){this.detached=true;}};publications.push(publication);controller.room.emit('trackSubscribed',track,publication,{identity});return {track,publication};
 };
 return {controller,container,Room,publish,credentials,publications};
}

test('programme requests use native sessions, explicit CSRF marker and keep tokens out of URLs',async()=>{
 const calls=[];const result=await programBroadcastRequest('a/b','token',{body:{},fetcher:async(url,options)=>{calls.push({url,options});return Response.json({token:'short-lived-fixture'});}});
 assert.equal(result.token,'short-lived-fixture');assert.equal(calls[0].url,'/api/broadcast/a%2Fb/token');assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.headers['X-Milo-Broadcast'],'1');assert.equal(calls[0].options.body,'{}');assert(!calls[0].url.includes('fixture'));
 await assert.rejects(programBroadcastRequest('a','cast',{body:{},fetcher:async()=>Response.json({error:{code:'broadcast_forbidden',message:'Geen showtoegang'}},{status:403})}),error=>error.status===403&&error.code==='broadcast_forbidden');
});

test('TV board never advances on new server balls or a round change without a heard-number acknowledgement',()=>{
 const game={id:'a',state:{roundIndex:0,drawn:[7,19,41]}};
 assert.deepEqual(programVisibleDrawn(game,false,null),[7,19,41]);assert.deepEqual(programVisibleDrawn(game,true,null),[]);
 const heard={key:'a:0',number:19};assert.deepEqual(programVisibleDrawn(game,true,heard),[7,19]);game.state.drawn.push(55);assert.deepEqual(programVisibleDrawn(game,true,heard),[7,19]);
 assert.deepEqual(programVisibleDrawn(game,true,{key:'a:0',number:75}),[]);game.state.roundIndex=1;assert.deepEqual(programVisibleDrawn(game,true,heard),[]);
});

test('viewer subscribes only to named programme tracks; rejected private audio never attaches; no capture or publication',async t=>{
 const h=mediaFixture();t.after(()=>h.controller.dispose());await until(()=>h.controller.room?.connection);
 assert.equal(h.controller.room.connection.options.autoSubscribe,false);
 const privateAudio=h.publish('audio','backstage-microphone','private-host');assert.equal(privateAudio.publication.subscribed,false);assert.equal(privateAudio.track.element,undefined);
 const wrongName=h.publish('audio','microphone');assert.equal(wrongName.publication.subscribed,false);
 const video=h.publish('video'),audio=h.publish('audio');await until(()=>h.controller.getSnapshot().playing);
 assert(video.track.element===h.controller.video);assert.equal(video.track.element.muted,true);assert.equal(audio.track.element.muted,true);assert.equal(h.controller.tracks.size,2);
 await h.controller.activateAudio();assert.equal(audio.track.element.muted,false);assert.equal(h.controller.getSnapshot().muted,false);assert.equal(h.controller.room.audioStarted,true);assert.equal(h.controller.getSnapshot().simulated,false);
});

test('the viewer uses server-issued native WHIP names and rejects old or backstage names even when the publisher is correct',async t=>{
 const h=mediaFixture();t.after(()=>h.controller.dispose());await until(()=>h.controller.room?.connection);h.credentials.programTrackNames={video:'synthesized-camera',audio:'synthesized-microphone'};
 const obsolete=h.publish('audio','programme-audio'),backstage=h.publish('audio','synthesized-microphone','private-host');assert.equal(obsolete.publication.subscribed,false);assert.equal(backstage.publication.subscribed,false);assert.equal(obsolete.track.element,undefined);assert.equal(backstage.track.element,undefined);
 const video=h.publish('video'),audio=h.publish('audio');assert.equal(video.track.element,h.controller.video);assert(audio.track.element);assert.equal(h.controller.tracks.size,2);await h.controller.activateAudio();assert.equal(audio.track.element.muted,false);
});

test('autoplay rejection remains visible and local audio is restored only after a successful play attempt',async t=>{
 const h=mediaFixture();t.after(()=>h.controller.dispose());await until(()=>h.controller.room?.connection);h.publish('video');const audio=h.publish('audio');audio.track.element.rejectPlay=true;
 await assert.rejects(h.controller.activateAudio(),/blocked/);assert.equal(h.controller.getSnapshot().muted,true);assert.equal(h.controller.getSnapshot().autoplayBlocked,true);assert.equal(audio.track.element.muted,true);
 audio.track.element.rejectPlay=false;await h.controller.activateAudio();assert.equal(h.controller.getSnapshot().muted,false);assert.equal(h.controller.getSnapshot().autoplayBlocked,false);
});

test('Cast transfer mutes the mix, restores it on end, and fails closed before private audio without a TV stop acknowledgement',async t=>{
 const h=mediaFixture();t.after(()=>h.controller.dispose());await until(()=>h.controller.room?.connection);h.publish('video');const audio=h.publish('audio');await h.controller.activateAudio();await h.controller.startCast();assert.equal(audio.track.element.muted,true);assert.equal(h.controller.remoteActive,true);
 h.controller.cast.refuseStop=true;await assert.rejects(h.controller.suspend(),/not acknowledged/);assert.equal(h.controller.getSnapshot().suspended,true);assert.equal(audio.track.element.muted,true);
 h.controller.cast.refuseStop=false;const proof=await h.controller.suspend();assert.equal(proof.silenced,true);assert.equal(h.controller.remoteActive,false);assert.equal(audio.track.element.muted,true);
 await h.controller.restore({play:true});assert.equal(audio.track.element.muted,false);assert.equal(h.controller.getSnapshot().suspended,false);
});

test('AirPlay requires an actual native wireless event; private transition waits for disconnection and restores WebRTC',async t=>{
 const h=mediaFixture();t.after(()=>h.controller.dispose());await until(()=>h.controller.room?.connection);h.publish('video');const audio=h.publish('audio');await h.controller.activateAudio();let picker=0;
 h.controller.airplay.webkitShowPlaybackTargetPicker=()=>picker++;await h.controller.prepareAirPlay();h.controller.showAirPlayPicker();assert.equal(picker,1);assert.equal(h.controller.getSnapshot().airplayActive,false);assert.equal(audio.track.element.muted,false);
 h.controller.airplay.webkitCurrentPlaybackTargetIsWireless=true;await h.controller.onAirPlayChange();assert.equal(h.controller.getSnapshot().airplayActive,true);assert.equal(audio.track.element.muted,true);
 await assert.rejects(h.controller.suspend(),/AirPlay/);assert.equal(picker,2);assert.equal(h.controller.airplay.paused,true);
 h.controller.airplay.webkitCurrentPlaybackTargetIsWireless=false;await h.controller.onAirPlayChange();assert.equal(h.controller.getSnapshot().suspended,true);assert.equal(audio.track.element.muted,true);
 assert.equal((await h.controller.suspend()).silenced,true);await h.controller.restore({play:true});assert.equal(audio.track.element.muted,false);
});

test('temporary signal loss reconnects the same room and does not touch the game; ended status remains visible',async t=>{
 const h=mediaFixture();t.after(()=>h.controller.dispose());await until(()=>h.controller.room?.connection);h.publish('video');h.publish('audio');const room=h.controller.room;
 room.emit('reconnecting');assert.equal(h.controller.getSnapshot().phase,'reconnecting');room.emit('reconnected');assert.equal(h.controller.room,room);assert.equal(h.controller.getSnapshot().phase,'live');
 room.emit('disconnected');assert.equal(h.controller.getSnapshot().phase,'disconnected');await h.controller.connect();assert.notEqual(h.controller.room,room);assert.equal(room.disconnected,true);
 h.controller.configure({state:'ended'});assert.equal(h.controller.getSnapshot().phase,'ended');assert.equal(h.controller.room,null);
});

function castFixture({storage={items:new Map(),getItem(key){return this.items.get(key)||null;},setItem(key,value){this.items.set(key,value);},removeItem(key){this.items.delete(key);}}}={}){
 const context=new Emitter(),remote={isConnected:true,isMediaLoaded:true},session={media:null,loads:[],getMediaSession(){return this.media;},async loadMedia(request){this.loads.push(request);this.media={media:request.media,playerState:'BUFFERING'};},endSession(){this.endRequests=(this.endRequests||0)+1;if(this.ackStop){this.media=null;remote.isConnected=false;context.emit('session',{sessionState:'ENDED',session:this});}}};
 Object.assign(context,{setOptions(value){this.options=value;},getCastState:()=> 'AVAILABLE',requestSession:async()=>{},getCurrentSession:()=>session});
 const controller=new Emitter(),sdk={framework:{CastContext:{getInstance:()=>context},RemotePlayer:class{constructor(){return remote;}},RemotePlayerController:class{constructor(){return controller;}},CastContextEventType:{SESSION_STATE_CHANGED:'session',CAST_STATE_CHANGED:'cast'},SessionState:{SESSION_ENDED:'ENDED',SESSION_START_FAILED:'FAILED'},RemotePlayerEventType:{IS_CONNECTED_CHANGED:'connected',IS_MEDIA_LOADED_CHANGED:'loaded',PLAYER_STATE_CHANGED:'player'},CastState:{NO_DEVICES_AVAILABLE:'NONE'}},cast:{ErrorCode:{CANCEL:'cancel',RECEIVER_UNAVAILABLE:'receiver_unavailable',TIMEOUT:'timeout'},AutoJoinPolicy:{ORIGIN_SCOPED:'origin'},media:{DEFAULT_MEDIA_RECEIVER_APP_ID:'CC1AD845',StreamType:{LIVE:'LIVE'},PlayerState:{PLAYING:'PLAYING',BUFFERING:'BUFFERING',PAUSED:'PAUSED',IDLE:'IDLE'},MediaInfo:class{constructor(contentId,contentType){Object.assign(this,{contentId,contentType});}},LoadRequest:class{constructor(media){this.media=media;}}}}};
 const changes=[],cast=new ProgramCast({gameId:'show',getAccess:async()=>({url:'https://example.invalid/signed/live.m3u8'}),loadSDK:async()=>sdk,onChange:patch=>changes.push(patch),stopTimeoutMs:80,storage});
 return {cast,changes,context,controller,session,remote,sdk,storage};
}

test('Google Cast load acknowledgement is not playback proof; live edge is requested; reload/end events preserve the correct show',async t=>{
 const h=castFixture();t.after(()=>h.cast.dispose());await h.cast.start();assert.equal(h.cast.active,false);assert.equal(h.session.loads.length,1);const request=h.session.loads[0];assert.equal(request.currentTime,undefined);assert.equal(request.media.streamType,'LIVE');assert.equal(request.autoplay,true);
 h.session.media.playerState='PLAYING';h.controller.emit('player');assert.equal(h.cast.active,true);h.session.media.playerState='PAUSED';h.controller.emit('player');assert.equal(h.cast.active,true);
 h.session.media.media.customData={miloBroadcastGameId:'different-show'};h.controller.emit('player');assert.equal(h.cast.active,false);
 h.session.media.media.customData={miloBroadcastGameId:'show'};h.session.media.playerState='PLAYING';h.controller.emit('player');assert.equal(h.cast.active,true);
 h.session.ackStop=true;await h.cast.stop();assert.equal(h.cast.active,false);assert(h.changes.some(patch=>patch.castPhase==='playing'));
});

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('a non-playing Cast still requires the matching SESSION_ENDED acknowledgement; disconnected/failed/unrelated events are insufficient',async t=>{
 const h=castFixture();t.after(()=>h.cast.dispose());await h.cast.start();assert.equal(h.cast.active,false);
 const stopped=h.cast.stop();h.remote.isConnected=false;h.controller.emit('connected');h.context.emit('session',{sessionState:'FAILED',session:h.session});h.context.emit('session',{sessionState:'ENDED',session:{getSessionId:()=> 'another-session'}});
 await assert.rejects(stopped,/niet bevestigd/);assert(h.session.endRequests>0);
 h.session.ackStop=true;await h.cast.stop();assert.equal(h.cast.active,false);
});

test('a load resolving after an earlier end acknowledgement is ended again before the private transition can report silence',async t=>{
 const h=castFixture(),m=mediaFixture(),load=deferred();t.after(()=>{m.controller.dispose();h.cast.dispose();});await until(()=>m.controller.room?.connection);m.controller.cast.dispose();m.controller.cast=h.cast;
 h.cast.onChange=patch=>{m.controller.update(patch);m.controller.syncMute();};
 h.session.loadMedia=async request=>{h.session.loads.push(request);await load.promise;h.session.media={media:request.media,playerState:'PLAYING'};h.remote.isConnected=true;h.remote.isMediaLoaded=true;h.controller.emit('player');};
 const start=h.cast.start();await until(()=>h.session.loads.length===1);h.session.ackStop=true;let finished=false;const stopped=m.controller.suspend().then(value=>{finished=true;return value;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false,'An early end event cannot release private audio while loadMedia is unresolved');assert.equal(m.controller.getSnapshot().suspended,true);
 load.resolve();await start;const proof=await stopped;assert.equal(proof.silenced,true);assert(h.session.endRequests>=2,'A late completed load requires a new end request/ack');assert.equal(h.session.media,null);assert.equal(h.cast.active,false);
});

test('a session request that completes after stop is cancelled, never loads media, and waits for the created session to end',async t=>{
 const h=castFixture(),launch=deferred();t.after(()=>h.cast.dispose());let sessionAvailable=false;h.context.getCurrentSession=()=>sessionAvailable?h.session:null;h.context.requestSession=async()=>{await launch.promise;sessionAvailable=true;};
 const start=h.cast.start();await until(()=>h.cast.operations.size===1);let finished=false;h.session.ackStop=true;const stopped=h.cast.stop().then(()=>{finished=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);
 launch.resolve();await start;await stopped;assert.equal(h.session.loads.length,0);assert(h.session.endRequests>0);assert.equal(h.cast.active,false);
});

test('a lost load response keeps the private transition blocked; late completion still performs receiver cleanup',async t=>{
 const h=castFixture(),load=deferred();t.after(()=>h.cast.dispose());h.session.loadMedia=async request=>{h.session.loads.push(request);await load.promise;h.session.media={media:request.media,playerState:'PLAYING'};};
 const start=h.cast.start();await until(()=>h.session.loads.length===1);h.session.ackStop=true;await assert.rejects(h.cast.stop(),/niet bevestigd/);
 assert.equal(h.cast.operations.size,1);load.resolve();await start;assert.equal(h.session.media,null);assert(h.session.endRequests>=2);await h.cast.stop();assert.equal(h.cast.active,false);
});

test('an early end acknowledgement cannot authorize a later completed load without a fresh matching end acknowledgement',async t=>{
 const h=castFixture(),load=deferred();t.after(()=>h.cast.dispose());h.session.loadMedia=async request=>{h.session.loads.push(request);await load.promise;h.session.media={media:request.media,playerState:'PLAYING'};};
 const end=h.session.endSession;h.session.endSession=function(){this.ackStop=!this.endRequests;return end.call(this);};
 const start=h.cast.start();await until(()=>h.session.loads.length===1);const stopped=h.cast.stop();await new Promise(resolve=>setImmediate(resolve));load.resolve();await start;await assert.rejects(stopped,/niet bevestigd/);
 assert(h.session.endRequests>=2);h.session.endSession=end;h.session.ackStop=true;await h.cast.stop();assert.equal(h.session.media,null);
});

test('an inactive Cast error still blocks programme silence until its uncertain receiver session has a matching end acknowledgement',async t=>{
 const h=castFixture(),m=mediaFixture();t.after(()=>{m.controller.dispose();h.cast.dispose();});await until(()=>m.controller.room?.connection);m.controller.cast.dispose();m.controller.cast=h.cast;h.cast.onChange=patch=>m.controller.update(patch);
 h.session.loadMedia=async request=>{h.session.media={media:request.media,playerState:'PLAYING'};throw Error('Response lost after receiver started');};
 await assert.rejects(h.cast.start(),/Response lost/);assert.equal(h.cast.active,false);assert.equal(m.controller.getSnapshot().castPhase,'error');
 await assert.rejects(m.controller.suspend(),/niet bevestigd/);assert.equal(m.controller.getSnapshot().suspended,true);
 h.session.ackStop=true;assert.equal((await m.controller.suspend()).silenced,true);assert.equal(h.session.media,null);
});

test('a fallback HLS-unavailable mount discovers Cast when the authoritative configuration becomes available',async t=>{
 const h=mediaFixture({config:{state:'waiting',hls:{available:false}}});t.after(()=>h.controller.dispose());let initialized=0;h.controller.cast.initialize=async()=>{initialized++;};
 assert.equal(initialized,0);h.controller.configure({state:'live',hls:{available:true}});assert.equal(initialized,1);
});

test('a new pending Cast keeps local audio until receiver PLAYING, whereas restored receiver history starts muted',async t=>{
 const h=castFixture(),m=mediaFixture();t.after(()=>{m.controller.dispose();h.cast.dispose();});await until(()=>m.controller.room?.connection);m.controller.cast.dispose();m.controller.cast=h.cast;h.cast.onChange=patch=>{m.controller.update(patch);m.controller.syncMute();};
 m.publish('video');const audio=m.publish('audio');await m.controller.activateAudio();assert.equal(audio.track.element.muted,false);
 await m.controller.startCast();assert.equal(h.storage.getItem(CAST_RECEIVER_MARKER),'show');assert.equal(m.controller.getSnapshot().castMayBeActive,true);assert.equal(m.controller.getSnapshot().castRestoring,false);assert.equal(h.cast.active,false);assert.equal(audio.track.element.muted,false,'A pending/loadMedia acknowledgement is not playback proof');
 h.session.media.playerState='PLAYING';h.controller.emit('player');assert.equal(audio.track.element.muted,true);h.session.ackStop=true;await m.controller.stopCast();assert.equal(audio.track.element.muted,false);
});

test('reload keeps possible Cast and the phone board gated until delayed SDK discovery, delayed resume and receiver-end acknowledgement complete',async t=>{
 const h=castFixture(),sdk=deferred();h.storage.setItem(CAST_RECEIVER_MARKER,'show');
 const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{configurable:true,value:h.storage});
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;});
 const m=mediaFixture({config:{state:'waiting',hls:{available:false}}});t.after(()=>{m.controller.dispose();h.cast.dispose();});await until(()=>m.controller.room?.connection);m.controller.cast.dispose();m.controller.cast=h.cast;h.cast.possible=true;h.cast.onChange=patch=>{m.controller.update(patch);m.controller.syncMute();};
 let sessionAvailable=false;h.context.getCurrentSession=()=>sessionAvailable?h.session:null;h.cast.loadSDK=()=>sdk.promise;
 assert.equal(m.controller.getSnapshot().castMayBeActive,true);assert.equal(m.controller.getSnapshot().castRestoring,true);assert.equal(m.controller.getSnapshot().castActive,false);
 m.publish('video');const audio=m.publish('audio');await m.controller.activateAudio();assert.equal(audio.track.element.muted,true,'Unknown restored receiver keeps local audio silent before discovery');
 const game={id:'show',state:{roundIndex:0,drawn:[7,19,41]}};assert.deepEqual(programVisibleDrawn(game,m.controller.getSnapshot().castMayBeActive,null),[]);
 let finished=false;const stopping=m.controller.suspend().then(value=>{finished=true;return value;});await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);
 sdk.resolve(h.sdk);await until(()=>!!h.cast.sdk);await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false,'initialize/setOptions is not an asynchronous receiver-resume acknowledgement');assert.equal(h.storage.getItem(CAST_RECEIVER_MARKER),'show');assert.equal(h.cast.active,false);
 sessionAvailable=true;h.session.media={media:{customData:{miloBroadcastGameId:'show'}},playerState:'PLAYING'};h.context.emit('session',{sessionState:'RESUMED',session:h.session});await until(()=>h.session.endRequests>0);assert.equal(finished,false,'Discovering a receiver does not prove that receiver stopped');
 h.session.media=null;h.remote.isConnected=false;h.context.emit('session',{sessionState:'ENDED',session:h.session});assert.equal((await stopping).silenced,true);assert.equal(finished,true);assert.equal(h.storage.getItem(CAST_RECEIVER_MARKER),null);assert.equal(m.controller.getSnapshot().castMayBeActive,false);
});

test('unresolved receiver history remains fail-closed after initialization, while a never-cast unsupported device needs no Cast SDK',async t=>{
 const pending=castFixture();t.after(()=>pending.cast.dispose());pending.storage.setItem(CAST_RECEIVER_MARKER,'show');pending.context.getCurrentSession=()=>null;
 await assert.rejects(pending.cast.stop(),/niet bevestigd/);assert.equal(pending.storage.getItem(CAST_RECEIVER_MARKER),'show');assert.equal(pending.cast.active,false);
 const unused=castFixture();t.after(()=>unused.cast.dispose());let sdkRequests=0;unused.cast.loadSDK=async()=>{sdkRequests++;throw Error('Unsupported browser');};await unused.cast.stop();assert.equal(sdkRequests,0);assert.equal(unused.storage.getItem(CAST_RECEIVER_MARKER),null);
});

test('explicitly cancelled or unavailable fresh picker clears only its unused marker and permits the next private transition',async t=>{
 for(const code of ['cancel','receiver_unavailable']){
  const h=castFixture(),m=mediaFixture();t.after(()=>{m.controller.dispose();h.cast.dispose();});await until(()=>m.controller.room?.connection);m.controller.cast.dispose();m.controller.cast=h.cast;h.cast.onChange=patch=>{m.controller.update(patch);m.controller.syncMute();};
  h.context.getCurrentSession=()=>null;h.context.requestSession=async()=>{throw code;};let accessRequests=0;h.cast.getAccess=async()=>{accessRequests++;throw Error('Must not request media after cancellation');};
  await assert.rejects(m.controller.startCast(),error=>error===code);assert.equal(h.cast.operations.size,0);assert.equal(h.storage.getItem(CAST_RECEIVER_MARKER),null);assert.equal(m.controller.getSnapshot().castMayBeActive,false);assert.equal(accessRequests,0);assert.equal(h.session.loads.length,0);
  assert.equal((await m.controller.suspend()).silenced,true);const game={id:'show',state:{roundIndex:0,drawn:[7,19]}};assert.deepEqual(programVisibleDrawn(game,m.controller.getSnapshot().castMayBeActive,null),[7,19]);
 }
});

test('ambiguous fresh picker failure or a cancelled picker that created a receiver cannot clear the privacy marker',async t=>{
 for(const scenario of ['timeout','unknown','created-before-cancel']){
  const h=castFixture();t.after(()=>h.cast.dispose());let sessionAvailable=false;h.context.getCurrentSession=()=>sessionAvailable?h.session:null;h.context.requestSession=async()=>{if(scenario==='created-before-cancel')sessionAvailable=true;throw scenario==='unknown'?Error('Response lost'):scenario==='timeout'?'timeout':'cancel';};
  await assert.rejects(h.cast.start());assert.equal(h.storage.getItem(CAST_RECEIVER_MARKER),'show');await assert.rejects(h.cast.stop(),/niet bevestigd/);assert.equal(h.storage.getItem(CAST_RECEIVER_MARKER),'show');
 }
});

test('a natural matching receiver end restores the phone board and local mix, and does not trap a later private transition',async t=>{
 const h=castFixture(),m=mediaFixture();t.after(()=>{m.controller.dispose();h.cast.dispose();});await until(()=>m.controller.room?.connection);m.controller.cast.dispose();m.controller.cast=h.cast;h.cast.onChange=patch=>{const wasRemote=m.controller.remoteActive;m.controller.update(patch);m.controller.syncMute();if(wasRemote&&!m.controller.remoteActive&&!m.controller.getSnapshot().suspended)void m.controller.restore({play:true});};
 m.publish('video');const audio=m.publish('audio');await m.controller.activateAudio();await m.controller.startCast();h.session.media.playerState='PLAYING';h.controller.emit('player');assert.equal(audio.track.element.muted,true);assert.equal(h.storage.getItem(CAST_RECEIVER_MARKER),'show');
 h.context.getCurrentSession=()=>null;h.session.media=null;h.remote.isConnected=false;h.context.emit('session',{sessionState:'ENDED',session:h.session});await until(()=>audio.track.element.muted===false);assert.equal(h.storage.getItem(CAST_RECEIVER_MARKER),null);assert.equal(m.controller.getSnapshot().castMayBeActive,false);
 const game={id:'show',state:{roundIndex:0,drawn:[7,19]}};assert.deepEqual(programVisibleDrawn(game,m.controller.getSnapshot().castMayBeActive,null),[7,19]);assert.equal((await m.controller.suspend()).silenced,true);assert.equal(audio.track.element.muted,true);
});

test('natural receiver end cancels media access still being fetched, so no late media load follows cleared history',async t=>{
 const h=castFixture(),access=deferred();t.after(()=>h.cast.dispose());let fetching=false;h.cast.getAccess=async()=>{fetching=true;return access.promise;};const starting=h.cast.start();await until(()=>fetching);
 h.context.emit('session',{sessionState:'ENDED',session:h.session});assert.equal(h.storage.getItem(CAST_RECEIVER_MARKER),null);access.resolve({url:'https://example.invalid/signed/never-load.m3u8'});await starting;assert.equal(h.session.loads.length,0);assert.equal(h.cast.active,false);
});
