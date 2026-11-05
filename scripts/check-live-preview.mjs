import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveVoicePreview} from '../frontend/live-preview.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function rig({fetcher,media,terminal=true}={}){
 const requests=[],states=[],transcripts=[],notices=[],peers=[],audios=[];
 const track={stopped:false,stop(){this.stopped=true;}},stream={getTracks:()=>[track]};
 class Peer{
  constructor(){this.iceGatheringState='complete';this.connectionState='new';peers.push(this);}
  addTrack(track,stream){this.input={track,stream};}
  createDataChannel(){return this.channel={readyState:'open',sent:[],send(text){const data=JSON.parse(text);this.sent.push(data);if(terminal&&data.type==='session.close')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'session.closed'})}));},close(){this.closed=true;}};}
  async createOffer(){return {type:'offer',sdp:'v=0\r\npreview-offer'};}
  async setLocalDescription(value){this.localDescription=value;}
  async setRemoteDescription(value){this.remoteDescription=value;this.connectionState='connected';this.channel.onmessage({data:JSON.stringify({type:'session.started'})});this.ontrack({streams:[stream],track});}
  close(){this.closed=true;this.connectionState='closed';}
 }
 class AudioElement{constructor(){audios.push(this);}async play(){this.played=true;}pause(){this.paused=true;}}
 const preview=new LiveVoicePreview({Peer,AudioElement,Stream:class{constructor(tracks){this.tracks=tracks;}},media:media||{getUserMedia:async()=>stream},onState:(...args)=>states.push(args),onNotice:notice=>notices.push(notice),onTranscript:(...args)=>transcripts.push(args),fetcher:async function(url,options){
  assert.equal(this,undefined,'fetch must not receive a LiveVoicePreview as its receiver');
  requests.push({url,options,body:JSON.parse(options.body)});
  return fetcher?fetcher(url,options):Response.json(url.endsWith('-stop')?{closed:true}:{realtimeId:'live_preview_test',sdp:'v=0\r\nanswer'});
 }});
 return {preview,requests,states,transcripts,notices,peers,audios,track,stream};
}

test('native-style fetch is called without the preview receiver for both start and stop',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async function(url,options){assert.equal(this,undefined);calls.push({url,options});return Response.json({closed:true});});
 const preview=new LiveVoicePreview();await preview.api('live-preview',{characterId:'milo',sdp:'v=0'});await preview.api('live-preview-stop',{sessionId:'live_test'});
 assert.deepEqual(calls.map(c=>c.url),['/api/openai/live-preview','/api/openai/live-preview-stop']);assert(calls.every(c=>c.options.credentials==='same-origin'&&c.options.headers['X-Milo-Characters']==='1'));
});

test('an invalid selected character cannot request microphone permission or contact the server',async()=>{
 let microphones=0;const h=rig({media:{getUserMedia:async()=>{microphones++;throw Error('must not request media');}}});
 await h.preview.start('undefined');assert.equal(microphones,0);assert.equal(h.requests.length,0);assert.equal(h.peers.length,0);assert.equal(h.states.at(-1)[0],'error');assert.match(h.states.at(-1)[1],/geldig personage/);
});
test('rehearsal connects the selected character, enables microphone input and forwards transcripts',async()=>{
 const h=rig();try{
  await h.preview.start('milo');assert.equal(h.states.at(-1)[0],'connected');assert.equal(h.requests[0].body.characterId,'milo');assert.equal(h.peers[0].input.stream,h.stream);assert(h.audios[0].played);
  assert(h.peers[0].channel.sent.some(e=>e.type==='session.input_audio.unmute'));
  for(const [type,delta] of [['session.input_transcript.delta','Hallo Milo'],['session.output_transcript.delta','Hé, wat gezellig!']])h.peers[0].channel.onmessage({data:JSON.stringify({type,delta})});
  assert.deepEqual(h.transcripts,[['Jij','Hallo Milo'],['Presentator','Hé, wat gezellig!']]);
 }finally{await h.preview.stop();}
 assert(h.track.stopped);assert(h.peers[0].closed);assert(h.audios[0].paused);assert.equal(h.requests.at(-1).body.sessionId,'live_preview_test');
});
test('stop silences audio and closes the local microphone before waiting for server confirmation',async()=>{
 let finishClose;const h=rig({fetcher:async url=>url.endsWith('-stop')?new Promise(resolve=>{finishClose=()=>resolve(Response.json({closed:true}));}):Response.json({realtimeId:'live_preview_test',sdp:'v=0\r\nanswer'})});
 await h.preview.start('milo');const lateTrack=h.peers[0].ontrack,audio=h.audios[0];
 const stopping=h.preview.stop();assert(h.track.stopped);assert.equal(h.peers[0].closed,undefined);assert(audio.paused);assert(audio.muted);assert.equal(audio.srcObject,null);
 lateTrack({streams:[h.stream],track:h.track});assert.equal(audio.srcObject,null,'a stale track must not reactivate audio');await flush();assert(h.peers[0].closed);assert.equal(h.requests.at(-1).body.closed,true);finishClose();await stopping;assert.equal(h.states.at(-1)[0],'idle');
});
test('a rejected session reports the server message and releases local media',async()=>{
 const h=rig({fetcher:async()=>Response.json({error:{message:'Het OpenAI-project heeft geen toegang.'}},{status:502})});
 await h.preview.start('milo');assert.deepEqual(h.states.at(-1),['error','Het OpenAI-project heeft geen toegang.']);assert(h.track.stopped);assert(h.peers[0].closed);assert(h.audios[0].paused);assert.equal(h.requests.length,1);
});
test('stopping during a delayed microphone permission result cannot open a late session',async()=>{
 let resolveMic;const h=rig({media:{getUserMedia:()=>new Promise(resolve=>{resolveMic=resolve;})}});
 const starting=h.preview.start('milo');await flush();await h.preview.stop();resolveMic(h.stream);await starting;assert(h.track.stopped);assert.equal(h.peers.length,0);assert.equal(h.requests.length,0);
});
test('a session allocated after stop is explicitly closed without attaching its audio',async()=>{
 let resolveSession;const h=rig({fetcher:async url=>url.endsWith('-stop')?Response.json({closed:true}):new Promise(resolve=>{resolveSession=resolve;})});
 const starting=h.preview.start('milo');await flush();await h.preview.stop();resolveSession(Response.json({realtimeId:'live_late',sdp:'v=0\r\nanswer'}));await starting;
 assert.equal(h.requests.at(-1).body.sessionId,'live_late');assert.equal(h.peers[0].remoteDescription,undefined);assert.equal(h.audios[0].played,undefined);
});

test('a reloaded page can close the server-owned previous test without a local session id or microphone',async()=>{
 const h=rig();assert.equal(await h.preview.recover(),true);assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/openai/live-preview-stop');assert.deepEqual(h.requests[0].body,{latest:true});assert.equal(h.peers.length,0);assert.equal(h.audios.length,0);assert(h.states.some(([state])=>state==='closing'));assert.equal(h.states.at(-1)[0],'idle');
});
test('unconfirmed recovery stays an error and can be retried without automatically opening a microphone',async()=>{
 let attempts=0;const h=rig({fetcher:async()=>++attempts===1?Response.json({error:{code:'close_failed',message:'Probeer vorige gesprekstest sluiten opnieuw.'}},{status:502}):Response.json({closed:true})});
 assert.equal(await h.preview.recover(),false);assert.equal(h.states.at(-1)[0],'error');assert.match(h.states.at(-1)[1],/opnieuw/);assert.equal(h.peers.length,0);
 assert.equal(await h.preview.recover(),true);assert.equal(h.states.at(-1)[0],'idle');assert.equal(h.requests.length,2);assert(h.requests.every(r=>r.url.endsWith('-stop')));
});

test('stop retains transport until the terminal event and only then acknowledges the observed closure',async()=>{
 const h=rig({terminal:false});await h.preview.start('milo');const channel=h.peers[0].channel;
 const stopping=h.preview.stop();assert(h.track.stopped);assert(h.audios[0].paused);assert.equal(channel.closed,undefined);assert.equal(h.peers[0].closed,undefined);assert.equal(h.requests.length,1);
 assert(channel.sent.some(e=>e.type==='session.input_audio.mute'));assert(channel.sent.some(e=>e.type==='session.close'));
 channel.onmessage({data:JSON.stringify({type:'session.started'})});await flush();assert.equal(channel.closed,undefined);
 channel.onmessage({data:JSON.stringify({type:'session.closed'})});assert.equal(await stopping,true);assert(channel.closed);assert(h.peers[0].closed);assert.deepEqual(h.requests.at(-1).body,{sessionId:'live_preview_test',closed:true});assert.equal(h.preview.pendingCloseId,null);
});
test('terminal wait is bounded and an unacknowledged close still uses server cleanup without claiming success',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=rig({terminal:false});await h.preview.start('milo');
 const stopping=h.preview.stop();t.mock.timers.tick(1999);await flush();assert.equal(h.peers[0].closed,undefined);assert.equal(h.requests.length,1);
 t.mock.timers.tick(1);assert.equal(await stopping,true);assert(h.peers[0].closed);assert.deepEqual(h.requests.at(-1).body,{sessionId:'live_preview_test'});
});
test('failed server closure retains its id and observed terminal receipt for a later retry',async()=>{
 let stops=0;const h=rig({fetcher:async url=>!url.endsWith('-stop')?Response.json({realtimeId:'live_preview_test',sdp:'v=0\r\nanswer'}):++stops===1?Response.json({error:{message:'Tijdelijk niet bereikbaar.'}},{status:503}):Response.json({closed:true})});
 await h.preview.start('milo');assert.equal(await h.preview.stop(),false);assert.equal(h.preview.pendingCloseId,'live_preview_test');assert.equal(h.preview.observedClosedId,'live_preview_test');assert.equal(h.states.at(-1)[0],'error');
 assert.equal(await h.preview.stop(),true);assert.equal(stops,2);assert.equal(h.preview.pendingCloseId,null);assert.equal(h.preview.observedClosedId,null);assert.deepEqual(h.requests.at(-1).body,{sessionId:'live_preview_test',closed:true});
});
test('a deliberate new start replaces a failed local connection and keeps late audio out',async()=>{
 let creations=0;const h=rig({fetcher:async url=>url.endsWith('-stop')?Response.json({error:{message:'Afsluiting niet bevestigd.'}},{status:503}):Response.json({realtimeId:++creations===1?'live_old':'live_new',sdp:'v=0\r\nanswer',replacedPrevious:creations>1})});
 await h.preview.start('milo');const lateTrack=h.peers[0].ontrack;await h.preview.stop();await h.preview.start('milo');assert.equal(h.preview.sessionId,'live_new');assert.equal(h.peers.length,2);assert.equal(creations,2);assert.equal(h.states.at(-1)[0],'connected');assert.equal(h.requests.filter(r=>!r.url.endsWith('-stop'))[1].body.replacePrevious,true);assert(h.notices.some(n=>n.includes('onbevestigd')));
 const currentAudio=h.audios[1].srcObject;lateTrack({streams:[{}]});assert.equal(h.audios[1].srcObject,currentAudio);assert(h.peers[0].closed);await h.preview.stop();
});
