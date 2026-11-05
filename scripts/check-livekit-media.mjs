import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveKitMedia,runLiveKitPreflight} from '../frontend/livekit-media.js';
import {LiveCallConnection,requestLiveCall} from '../frontend/live-call-api.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
let sequence=0;
class RawAudio{
 constructor(){this.id='audio-'+(++sequence);this.kind='audio';this.readyState='live';this.stopped=0;}
 clone(){return new RawAudio();}
 stop(){this.stopped++;this.readyState='ended';}
}
class LocalAudio{
 constructor(raw=new RawAudio()){this.mediaStreamTrack=raw;this.kind='audio';this.source='microphone';this.isMuted=false;}
 async mute(){this.isMuted=true;}
 async unmute(){this.isMuted=false;}
 stop(){this.mediaStreamTrack.stop();}
}
function fixture({phase='live',role='output',tokenWait,roomWait,microphoneWait}={}){
 const rooms=[],micTracks=[],tokens=[],events=[],failures=[],elements=[];
 let call={id:'call-one',transport:'livekit',gameId:'game-one',phase,muted:false};
 const audioParent={appendChild:element=>elements.push(element)};
 class Room{
  constructor(options){this.options=options;this.handlers=new Map();this.remoteParticipants=new Map();this.canPlaybackAudio=true;this.closed=0;this.publications=[];rooms.push(this);this.localParticipant={audioTrackPublications:new Map(),publishTrack:async(track,options)=>{const p={track,trackSid:'local-'+(++sequence),source:options.source};this.publications.push({track,options,p});this.localParticipant.audioTrackPublications.set(p.trackSid,p);return p;},unpublishTrack:async(track,stop)=>{for(const [id,p]of this.localParticipant.audioTrackPublications)if(p.track===track)this.localParticipant.audioTrackPublications.delete(id);if(stop)track.stop();}};}
  on(event,fn){const set=this.handlers.get(event)||new Set();set.add(fn);this.handlers.set(event,set);return this;}
  off(event,fn){this.handlers.get(event)?.delete(fn);return this;}
  emit(event,...args){for(const fn of this.handlers.get(event)||[])fn(...args);}
  async connect(url,token,options){this.connectOptions=options;this.url=url;if(roomWait)await roomWait.promise;this.connected=true;}
  async disconnect(){this.closed++;this.connected=false;this.emit('disconnected');}
  async startAudio(){this.audioStarted=true;}
 }
 const sdk={Room,LocalAudioTrack:LocalAudio,Track:{Kind:{Audio:'audio'},Source:{Microphone:'microphone'}},RoomEvent:{},createLocalAudioTrack:async()=>{if(microphoneWait)await microphoneWait.promise;const track=new LocalAudio();micTracks.push(track);return track;}};
 const credentials=target=>({url:'wss://example.livekit.cloud',token:'opaque-secret-token',room:'room-'+target,identity:role+'-one',role,target,hostIdentity:'host-one',participantIdentity:'guest-one',guestIdentity:'guest-one',outputIdentity:'output-one',allowedRemoteIdentities:['host-one','guest-one','output-one']});
 const api={token:async target=>{tokens.push(target);if(tokenWait)await tokenWait.promise;return credentials(target);},heartbeat:async()=>({call})};
 const media=new LiveKitMedia({role,api,getCall:()=>call,getGameId:()=>call.gameId,loadSDK:async()=>sdk,onRemoteTrack:(track,meta)=>events.push({track,meta}),onFailure:error=>failures.push(error),audioParent,heartbeatMs:0});
 const remote=(identity,source='microphone')=>{
  const raw=new RawAudio(),element={dataset:{},removed:false,paused:false,play:async()=>{},pause(){this.paused=true;},remove(){this.removed=true;},setAttribute(){}};
  const track={kind:'audio',source,sid:'remote-'+(++sequence),mediaStreamTrack:raw,attached:0,detached:0,attach(){this.attached++;return element;},detach(){this.detached++;return [element];}};
  const publication={kind:'audio',source,trackSid:track.sid,track,subscribed:null,setSubscribed(value){this.subscribed=value;}};
  return {track,publication,participant:{identity},element,raw};
 };
 return {media,rooms,sdk,micTracks,tokens,events,failures,elements,remote,get call(){return call;},set call(value){call=value;}};
}

test('ordinary viewers create no media room; output cannot access backstage',async()=>{
 const f=fixture();assert.equal(f.rooms.length,0);assert.equal(f.micTracks.length,0);
 await assert.rejects(()=>f.media.connect('backstage'),/Privéaudio/);
 assert.deepEqual(f.tokens,[]);assert.equal(f.rooms.length,0);await f.media.dispose();
});

test('program receives selected live microphone only; own, private, unknown and non-microphone tracks never reach program callback',async()=>{
 const f=fixture();await f.media.connect('live');const room=f.rooms[0];
 assert.equal(room.connectOptions.autoSubscribe,false);assert.equal(f.micTracks.length,0);
 for(const [identity,source]of [['host-one','microphone'],['output-one','microphone'],['guest-one-spoof','microphone'],['guest-one','screen_share_audio']]){const r=f.remote(identity,source);room.emit('trackSubscribed',r.track,r.publication,r.participant);assert.equal(r.publication.subscribed,false);assert.equal(r.track.attached,0);}
 const guest=f.remote('guest-one');room.emit('trackSubscribed',guest.track,guest.publication,guest.participant);
 assert.equal(f.events.length,1);assert.equal(f.events[0].track,guest.raw);assert.equal(f.events[0].meta.target,'live');assert.equal(guest.track.attached,0,'Output playback belongs only to the explicit program mixer');
 const original=new RawAudio();await f.media.publishPresenterTrack(original);assert.equal(room.publications.length,1);assert.equal(room.publications[0].options.name,'presenter-audio');assert.equal(room.publications[0].options.source,'microphone');assert.notEqual(room.publications[0].track.mediaStreamTrack,original);
 const clone=room.publications[0].track.mediaStreamTrack;await f.media.disconnect();
 assert.equal(original.readyState,'live','Transport must not stop OpenAI-owned source track');assert.equal(clone.readyState,'ended');assert.equal(f.events.at(-1).meta.removed,true);assert.equal(f.media.state.connected,false);
});

test('backstage host microphone is private and initially muted; transition closes it and host cannot publish live',async()=>{
 const f=fixture({role:'host',phase:'backstage'});await f.media.connect('backstage');
 assert.equal(f.micTracks.length,1);assert.equal(f.micTracks[0].isMuted,true);await f.media.setPrivateMic(true);assert.equal(f.micTracks[0].isMuted,false);
 const guest=f.remote('guest-one');f.rooms[0].emit('trackSubscribed',guest.track,guest.publication,guest.participant);
 assert.equal(guest.track.attached,1);assert.equal(f.events.length,0,'Private audio never invokes program/AI forwarding callback');
 f.call={...f.call,phase:'live'};await f.media.connect('live');
 assert(f.rooms[0].closed>0);assert.equal(f.micTracks[0].mediaStreamTrack.readyState,'ended');assert.equal(guest.element.removed,true);assert.equal(f.micTracks.length,1,'Host must not request a microphone in live room');
 assert.equal(f.rooms[1].publications.length,0);await assert.rejects(()=>f.media.setPrivateMic(true),/besloten regieruimte/);await assert.rejects(()=>f.media.setMuted(false),/buiten de live/);await f.media.dispose();
});

test('player hears only presenter live, not own voice or director, and missing microphone permission fails closed',async()=>{
 const f=fixture({role:'player'});await f.media.connect('live');assert.equal(f.micTracks.length,1);
 assert.equal(f.media.state.audioReady,false,'Joining a room does not yet prove the presenter return path');
 for(const identity of ['guest-one','host-one']){const r=f.remote(identity);f.rooms[0].emit('trackSubscribed',r.track,r.publication,r.participant);assert.equal(r.track.attached,0);}
 const presenter=f.remote('output-one'),play=defer();presenter.element.play=()=>play.promise;f.rooms[0].emit('trackSubscribed',presenter.track,presenter.publication,presenter.participant);assert.equal(presenter.track.attached,1);assert.equal(f.events.length,0);assert.equal(f.media.state.audioReady,false);play.resolve();await tick();assert.equal(f.media.state.audioReady,true);f.rooms[0].emit('trackUnsubscribed',presenter.track,presenter.publication,presenter.participant);assert.equal(f.media.state.audioReady,false);await f.media.dispose();
 const denied=fixture({role:'player',phase:'backstage'});denied.sdk.createLocalAudioTrack=async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});};
 await assert.rejects(()=>denied.media.connect('backstage'));assert.equal(denied.media.state.phase,'failed');assert.match(denied.media.state.error,/Microfoontoestemming/);assert.equal(denied.rooms[0].closed,1);assert.equal(denied.failures.length,1);
});

test('reconnection/lost guest stops program forwarding immediately and never joins again or resumes drawing',async()=>{
 for(const event of ['reconnecting','participantDisconnected']){
  const f=fixture();await f.media.connect('live');const guest=f.remote('guest-one');f.rooms[0].emit('trackSubscribed',guest.track,guest.publication,guest.participant);
  f.rooms[0].emit(event,event==='participantDisconnected'?guest.participant:undefined);await tick();
  assert.equal(f.media.state.phase,'failed');assert.equal(f.events.at(-1).meta.removed,true);assert.equal(f.failures.length,1);assert.equal(f.rooms.length,1);assert.equal(f.rooms[0].closed,1);assert.equal(f.media.remoteTracks.size,0);
  // An SDK reconnect event cannot resurrect removed routes after epoch change.
  f.rooms[0].emit('trackSubscribed',guest.track,guest.publication,guest.participant);assert.equal(f.media.remoteTracks.size,0);await f.media.dispose();
 }
});

test('a mute unpublication removes the guest route without treating it as a dropped call',async()=>{
 const f=fixture();await f.media.connect('live');const guest=f.remote('guest-one');f.rooms[0].emit('trackSubscribed',guest.track,guest.publication,guest.participant);f.rooms[0].emit('trackUnsubscribed',guest.track,guest.publication,guest.participant);
 assert.equal(f.events.at(-1).meta.removed,true);assert.equal(f.failures.length,0);assert.equal(f.media.state.connected,true);await f.media.dispose();
});

test('autoplay needs a real user activation, and revoked player publication needs an explicit microphone restart',async()=>{
 const f=fixture({role:'player',phase:'backstage'}),Room=f.sdk.Room;
 f.sdk.Room=class extends Room{constructor(options){super(options);this.canPlaybackAudio=false;}};
 await f.media.connect('backstage');assert.equal(f.media.state.connected,true);assert.equal(f.media.state.audioReady,false,'A blocked browser must not be reported as audible');await assert.rejects(()=>f.media.startAudio(),/nog niet vrijgegeven/);
 f.rooms[0].canPlaybackAudio=true;await f.media.startAudio();assert.equal(f.media.state.audioReady,true);
 const old=f.micTracks[0],publication=f.rooms[0].publications[0].p;f.rooms[0].localParticipant.audioTrackPublications.clear();old.mediaStreamTrack.stop();f.rooms[0].emit('localTrackUnpublished',publication);
 assert.equal(f.media.state.micPublished,false);assert.equal(f.media.state.micReady,false);assert.equal(f.micTracks.length,1,'Revocation never automatically opens a new microphone');
 await f.media.setMuted(false);assert.equal(f.micTracks.length,2);assert.equal(f.media.state.micPublished,true);assert.equal(f.media.state.micMuted,false);await f.media.dispose();
});

test('live return audio must actually play before readiness, and a late activation cannot revive a closed session',async()=>{
 const f=fixture({role:'player'});await f.media.connect('live');const presenter=f.remote('output-one');presenter.element.play=async()=>{throw Error('autoplay blocked');};f.rooms[0].emit('trackSubscribed',presenter.track,presenter.publication,presenter.participant);await tick();assert.equal(f.media.state.audioReady,false);await assert.rejects(()=>f.media.startAudio(),/browser houdt/);assert.equal(f.media.state.audioReady,false);
 presenter.element.play=async()=>{};await f.media.startAudio();assert.equal(f.media.state.audioReady,true);const wait=defer();f.rooms[0].startAudio=()=>wait.promise;const starting=f.media.startAudio();await f.media.disconnect();wait.resolve();await assert.rejects(()=>starting,/eerdere oproep/);assert.equal(f.media.state.audioReady,false);assert.equal(f.media.state.phase,'disconnected');await f.media.dispose();
});

test('late token, room and microphone results cannot recreate audio after cancellation',async()=>{
 const tokenWait=defer(),one=fixture({tokenWait}),opening=one.media.connect('live');await tick();await one.media.disconnect();tokenWait.resolve();await assert.rejects(()=>opening,/intussen/);assert.equal(one.rooms.length,0);
 const roomWait=defer(),two=fixture({roomWait}),joining=two.media.connect('live');await tick();await two.media.disconnect();roomWait.resolve();await assert.rejects(()=>joining,/intussen/);assert.equal(two.media.state.connected,false);assert(two.rooms[0].closed>=1);
 const microphoneWait=defer(),three=fixture({role:'player',phase:'backstage',microphoneWait}),asking=three.media.connect('backstage');await tick();await three.media.dispose();microphoneWait.resolve();await assert.rejects(()=>asking,/eerdere oproep/);assert.equal(three.micTracks[0].mediaStreamTrack.readyState,'ended');assert.equal(three.media.state.connected,false);assert(three.rooms[0].closed>=1);
});

test('token allowlist is mandatory and cannot be inferred from display names',async()=>{
 const f=fixture();f.media.api.token=async()=>({url:'wss://example.livekit.cloud',token:'opaque',identity:'output-one',participantIdentity:'guest-one',target:'live',role:'output'});
 await assert.rejects(()=>f.media.connect('live'),/gesprekspartner/);assert.equal(f.rooms.length,0);
});

class MeterContext{
 constructor(){this.closed=0;MeterContext.instances.push(this);}async resume(){}createMediaStreamSource(){return {connect(){},disconnect(){}};}createAnalyser(){return {fftSize:512,getFloatTimeDomainData(values){values.fill(MeterContext.level);}};}async close(){this.closed++;}
 static instances=[];static level=.1;
}
test('preflight measures locally and connects a temporary room with no publish/subscription, then closes everything',async()=>{
 const f=fixture({role:'player'}),raw=new RawAudio(),stream={getTracks:()=>[raw],getAudioTracks:()=>[raw]};
 const result=await runLiveKitPreflight({api:{preflight:async()=>({url:'wss://example.livekit.cloud',token:'opaque'})},gameId:'g',profileId:'child',loadSDK:async()=>f.sdk,mediaDevices:{getUserMedia:async()=>stream},AudioContext:MeterContext,sampleMs:0});
 assert.equal(result.simulated,false);assert.equal(result.microphone,true);assert.equal(result.connection,true);assert.equal(raw.readyState,'ended');assert.equal(f.rooms.length,1);assert.equal(f.rooms[0].connectOptions.autoSubscribe,false);assert.equal(f.rooms[0].publications.length,0);assert.equal(f.rooms[0].closed,1);assert(MeterContext.instances.at(-1).closed>0);
});

test('silent or denied preflight never opens a cloud room, and a cancelled permission prompt stops late microphone tracks',async()=>{
 const f=fixture({role:'player'});let requests=0;
 const options={api:{preflight:async()=>{requests++;return {url:'wss://example.livekit.cloud',token:'opaque'};}},loadSDK:async()=>f.sdk,AudioContext:MeterContext,sampleMs:0};
 MeterContext.level=0;const raw=new RawAudio();await assert.rejects(()=>runLiveKitPreflight({...options,mediaDevices:{getUserMedia:async()=>({getTracks:()=>[raw],getAudioTracks:()=>[raw]})}}),/geen duidelijk/);MeterContext.level=.1;assert.equal(raw.readyState,'ended');assert.equal(requests,0);assert.equal(f.rooms.length,0);
 await assert.rejects(()=>runLiveKitPreflight({...options,mediaDevices:{getUserMedia:async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});}}}),/Microfoontoestemming/);
 const pending=defer(),controller=new AbortController(),late=new RawAudio(),testing=runLiveKitPreflight({...options,signal:controller.signal,mediaDevices:{getUserMedia:()=>pending.promise}});controller.abort();pending.resolve({getTracks:()=>[late],getAudioTracks:()=>[late]});await assert.rejects(()=>testing,/geannuleerd/);assert.equal(late.readyState,'ended');
});

test('client API preserves host identity and player headers, rejects stale polls and never releases hold on leave',async()=>{
 const requests=[];const fetcher=async(path,options)=>{requests.push({path,options});return Response.json({call:null,serverTime:Date.now()});};
 await requestLiveCall('/api/live-calls?role=host&gameId=g',undefined,{fetcher});await requestLiveCall('/api/live-calls',{role:'output',action:'heartbeat'},{fetcher});await requestLiveCall('/api/live-calls?role=player&gameId=g',undefined,{fetcher});await requestLiveCall('/api/livekit/preflight',{role:'player',profileId:'child'},{fetcher});
 assert(!Object.keys(requests[0].options.headers).includes('X-Vlampie-Player'));assert(!Object.keys(requests[1].options.headers).includes('X-Vlampie-Player'));assert.equal(requests[2].options.headers['X-Vlampie-Player'],'1');assert.equal(requests[3].options.headers['X-Vlampie-Player'],'1');
 const poll=defer(),api=new LiveCallConnection({role:'host',getGameId:()=>'g',getClientId:()=>'host',request:async(path,body)=>body?{call:{id:'c',phase:'backstage',version:3,createdAt:1}}:poll.promise});
 const old=api.poll();await api.action('prepare',{entryId:'child'});poll.resolve({call:{id:'c',phase:'ringing',version:2,createdAt:1}});await old;assert.equal(api.call.phase,'backstage');
 const originalFetch=globalThis.fetch;try{globalThis.fetch=fetcher;api.leave();await tick();const leave=JSON.parse(requests.at(-1).options.body);assert.equal(leave.action,'fail');assert.notEqual(leave.action,'resume-draw');assert(!Object.keys(requests.at(-1).options.headers).includes('X-Vlampie-Player'));}finally{globalThis.fetch=originalFetch;api.dispose();}
});
