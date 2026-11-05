import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveCallOutput} from '../frontend/live-call-output.js';
import {OutputBridge} from '../public/output-bridge.js';
import {Context,Stream,Track,call,reaches} from './live-call-audio-fixtures.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
class Peer {
 constructor(){this.connectionState='new';Peer.instances.push(this);}
 static instances=[];
 addTrack(track,stream){this.input={track,stream};}
 createDataChannel(){return this.channel={readyState:'connecting',sent:[],send(value){this.sent.push(JSON.parse(value));},close(){this.readyState='closed';}};}
 async createOffer(){return {type:'offer',sdp:'v=0\r\no=mock'};}
 async setLocalDescription(value){this.localDescription=value;}
 async setRemoteDescription(value){this.remoteDescription=value;this.connectionState='connected';this.onconnectionstatechange?.();this.ontrack?.({track:new Track('ai-return')});this.channel.readyState='open';this.channel.onopen?.();this.channel.onmessage?.({data:JSON.stringify({type:'session.started'})});}
 close(){this.closed=true;this.connectionState='closed';}
}
function setup({request,ready=true}={}){
 const calls=[],events=[],bridge={active:true,audioReady:ready,context:new Context(),latest:{routing:true},mixer:{voice:100},showAudio:{setMuted:value=>events.push(['show-muted',value])},stopSource:()=>events.push(['stop-old-voice'])},engine={isOutput:true,demo:false,bridge};
 const api={lastOK:0,request:async(path,body)=>{calls.push({path,body});if(request)return request(path,body);return path.endsWith('/realtime')?{sdp:'v=0\r\nanswer',realtimeId:'rt-'+body.callId}:{};},action:async(action,body)=>calls.push({action,body})};
 const media={state:{connected:false},connect:async target=>{events.push(['connect',target]);media.state={connected:true};},publishPresenterTrack:async track=>events.push(['presenter-published',track.id]),disconnect:async()=>{media.state={connected:false};events.push(['disconnect']);}};
 const output=new LiveCallOutput({engine,media,api,Peer,Stream});return {output,engine,bridge,api,media,calls,events};
}
async function ready(output,c){const task=output.sync(c);await flush();output.remoteTrack(new Track('live-'+c.id),{identity:c.guestIdentity,target:'live'});await task;return task;}

test('no viewer/backstage AI sessions; first live greeting waits for actual selected guest playback readiness',async()=>{
 const h=setup(),c=call();await h.output.sync({...c,phase:'backstage'});assert.equal(h.calls.length,0);assert.equal(h.events.length,0);
 const task=h.output.sync({...c,media:{player:{connected:false,audioReady:false}}});await flush();assert.equal(h.calls.length,0,'no paid session while caller is still switching rooms');
 assert.equal(h.output.remoteTrack(new Track('private-host'),{identity:'host-a',target:'backstage'}),false);
 h.output.remoteTrack(new Track('guest'),{identity:c.guestIdentity,target:'live'});await flush();assert.equal(h.calls.length,0,'track alone does not prove caller playback ready');
 void h.output.sync(c);await task;assert.equal(h.calls.filter(r=>r.path?.endsWith('/realtime')).length,1);assert.equal(h.output.status,'live');
 const commands=h.output.channel.sent;assert(!commands.some(e=>e.type==='response.create'||e.type==='session.update'));assert(commands.some(e=>e.type==='session.input_audio.unmute'));assert.equal(h.output.audio.listening,true,'GPT-Live listens during its greeting, using full duplex');
 for(let i=0;i<5;i++)await h.output.sync({...c,version:i+2});assert.equal(h.calls.filter(r=>r.path?.endsWith('/realtime')).length,1,'one session per live caller');
 const patch=h.output.stagePatch({hostId:'milo',show:{},pattern:{title:'old'}});assert.equal(patch.liveCall.name,'Sophie');assert.equal(patch.pattern,null);assert.equal(patch.roundTitle,'In gesprek met Sophie');await h.output.dispose();
});

test('return/failure immediately silences programme and AI, stale callbacks cannot attach old audio',async()=>{
 const h=setup(),c=call();await ready(h.output,c);const peer=h.output.peer,oldOnTrack=peer.ontrack,source=h.output.audio.guestSource;
 const stopping=h.output.sync({...c,phase:'returning'});assert.equal(h.output.audio.enabled,false);assert.equal(source.edges.size,0);assert(peer.closed);assert.equal(h.bridge.liveCallActive,false);
 oldOnTrack({track:new Track('late-ai')});assert.equal(h.output.audio.presenterTrack,null);await stopping;await flush();assert(h.calls.some(r=>r.path?.endsWith('/realtime-stop')));await h.output.dispose();
});

test('a delayed SDP after stop is discarded and explicitly closed instead of opening a late voice',async()=>{
 let finish;const h=setup({request:(path)=>path.endsWith('/realtime')?new Promise(resolve=>finish=resolve):Promise.resolve({})}),c=call();
 const task=h.output.sync(c);await flush();h.output.remoteTrack(new Track('guest'),{identity:c.guestIdentity,target:'live'});await flush();assert(finish);
 const peer=h.output.peer;await h.output.stop();finish({sdp:'v=0\r\nlate-answer',realtimeId:'late-id'});await task;assert(peer.closed);assert.equal(peer.remoteDescription,undefined);assert.equal(h.output.audio.presenterTrack,null);assert(h.calls.filter(r=>r.path?.endsWith('/realtime-stop')).length>=1);await h.output.dispose();
});

test('next caller replaces active name/session and mute never feeds the AI input',async()=>{
 const h=setup(),a=call();await ready(h.output,a);h.output.event({type:'session.started'});
 const guest=h.output.audio.guestSource;assert(reaches(guest,h.output.audio.aiInputDestination));await h.output.sync({...a,muted:true});assert(!reaches(guest,h.output.audio.aiInputDestination));assert(!reaches(guest,h.output.audio.programDestination));
 await h.output.sync({...a,phase:'returning'});await flush();const b=call('call-b','Daan');await ready(h.output,b);assert.equal(h.output.stagePatch({show:{}}).liveCall.name,'Daan');assert(!h.output.transcript.includes('Sophie'));assert.equal(h.output.remoteTrack(new Track('old-sophie'),{identity:a.guestIdentity,target:'live'}),false);assert.equal(h.calls.filter(r=>r.path?.endsWith('/realtime')).length,2);await h.output.dispose();
});

test('demonstration and missing output activation cannot masquerade as a real connection',async()=>{
 const h=setup({ready:false}),c=call();await h.output.sync(c);assert.equal(h.output.status,'waiting-audio');assert.equal(h.calls.length,0);assert.equal(h.events.length,0);
 h.engine.demo=true;await h.output.sync({...c,simulated:true});assert.equal(h.output.status,'demonstration');assert.equal(h.calls.length,0);assert.equal(h.output.getState().connected,false);await h.output.dispose();
});

test('a skipped return snapshot cannot retain a previous caller in the next live session',async()=>{
 const h=setup(),a=call();await ready(h.output,a);const oldGuest=h.output.audio.guestSource,oldPeer=h.output.peer,b=call('call-direct-next','Noor');
 await h.output.sync(b);assert(oldPeer.closed);assert.equal(oldGuest.edges.size,0);await flush();await ready(h.output,b);
 assert.equal(h.output.sessionCall.id,b.id);assert.equal(h.output.stagePatch({show:{}}).liveCall.name,'Noor');assert.equal(h.calls.filter(r=>r.path?.endsWith('/realtime')).length,2);await h.output.dispose();
});

test('a suspended audio context immediately closes live audio and never releases the draw hold',async()=>{
 const h=setup(),c=call();await ready(h.output,c);const source=h.output.audio.guestSource;h.bridge.context.state='suspended';h.output.tick();assert.equal(h.output.audio.enabled,false);assert.equal(source.edges.size,0);await flush();
 assert.equal(h.output.getState().connected,false);assert.equal(h.output.getState().programAudioReady,false);assert(h.calls.some(r=>r.action==='fail'));assert(!h.calls.some(r=>r.action==='resume-draw'));await h.output.dispose();
});

test('studio mouth samples the real presenter analyser on every snapshot without waiting for a poll',async()=>{
 const h=setup(),c=call();await ready(h.output,c);const apiCount=h.calls.length;
 h.output.audio.presenterAnalyser.sample=145;const talking=h.output.stagePatch({show:{}});assert(talking.mouth>.1);assert.equal(talking.speaking,true);
 h.output.audio.presenterAnalyser.sample=128;const silent=h.output.stagePatch({show:{}});assert.equal(silent.mouth,0);assert.equal(silent.speaking,false);assert.equal(h.calls.length,apiCount,'rendering never creates another cloud request');await h.output.dispose();
});

function voiceBridge(context){
 const bridge=Object.create(OutputBridge.prototype),events=[];
 Object.assign(bridge,{active:true,audioReady:true,context,gain:{},channel:{postMessage:message=>events.push(message)},receive:event=>events.push(event)});return {bridge,events};
}
test('starting live invalidates a scripted voice decode already in flight',async t=>{
 let finishDecode,decodeStarted=false,starts=0;const oldFetch=globalThis.fetch;t.after(()=>globalThis.fetch=oldFetch);
 globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});
 const {bridge,events}=voiceBridge({decodeAudioData:()=>{decodeStarted=true;return new Promise(resolve=>finishDecode=resolve);},createBufferSource:()=>({start(){starts++;},connect(){}})});
 const loading=bridge.applyVoice({id:'scripted-a',clip:'clip-a',phase:'prepare'});await flush();assert(decodeStarted);
 bridge.setLiveCallActive(true);finishDecode({duration:2});await loading;
 assert.equal(bridge.buffer,null);assert.equal(bridge.loadToken,null);assert.equal(bridge.ack.status,'error');assert.equal(starts,0);assert(!events.some(e=>e.ack?.status==='ready'));
 bridge.setLiveCallActive(false);await bridge.applyVoice({id:'scripted-a',phase:'play'});assert.equal(starts,0,'same cancelled command cannot restart when live ends');
});
test('a pending resume cannot resurrect scripted speech over a live caller; pause does not suspend the programme context',async()=>{
 let finishResume,starts=0,suspends=0;const {bridge}=voiceBridge({state:'running',currentTime:7,resume:()=>new Promise(resolve=>finishResume=resolve),suspend:()=>suspends++,createBufferSource:()=>({start(){starts++;},connect(){},stop(){},disconnect(){}})});
 Object.assign(bridge,{voiceId:'scripted-b',loadToken:'scripted-b',buffer:{duration:4},ack:{id:'scripted-b',status:'ready'}});
 const playing=bridge.applyVoice({id:'scripted-b',phase:'play'});bridge.setLiveCallActive(true);finishResume();await playing;assert.equal(starts,0);assert.equal(bridge.ack.status,'error');
 bridge.setLiveCallActive(false);Object.assign(bridge,{voiceId:'scripted-c',loadToken:'scripted-c',buffer:{duration:4},ack:{id:'scripted-c',status:'playing'},source:{stop(){},disconnect(){}},started:6,playbackOffset:0});
 await bridge.applyVoice({id:'scripted-c',phase:'pause'});assert.equal(suspends,0);assert.equal(bridge.ack.status,'paused');assert.equal(bridge.voiceElapsed,1000);
});
