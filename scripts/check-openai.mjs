import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {handleOpenAI as verifiedhandleOpenAI} from '../server/openai.js';
import {createOpenAIVoice} from '../public/openai-voice.js';
import {readFile} from 'node:fs/promises';

const baseEnv={VLAMPIE_ADMIN_EMAIL:'owner@example.test',VLAMPIE_SETTINGS_KEY:'00'.repeat(32),SETTINGS:{get:async()=>null}};
const env={...baseEnv,OPENAI_API_KEY:'test-not-a-real-secret'};
let user=0;
function request(path,body,extra={}){
  return new Request('https://studio.example/api/openai/'+path,{method:path==='status'?'GET':'POST',headers:{'oai-authenticated-user-id':'test-'+(++user),'Content-Type':'application/json','oai-authenticated-user-email':'owner@example.test',Origin:'https://studio.example',...extra},...(path==='status'?{}:{body:JSON.stringify(body??{})})});
}
const noFetch=()=>{throw new Error('Must not reach upstream');};
test('missing identity, cross-origin and malformed requests cannot spend API credit',async()=>{
  assert.equal((await handleOpenAI(request('speech',{text:'Hoi'},{'oai-authenticated-user-id':''}),env,noFetch)).status,401);
  assert.equal((await handleOpenAI(request('speech',{text:'Hoi'},{Origin:'https://elsewhere.example'}),env,noFetch)).status,403);
  assert.equal((await handleOpenAI(request('speech',{text:'a'.repeat(501)}),env,noFetch)).status,400);
  assert.equal((await handleOpenAI(request('speech',{text:'Hoi',speed:9}),env,noFetch)).status,400);
  assert.equal((await handleOpenAI(request('reply',{message:'a'.repeat(501)}),env,noFetch)).status,400);
  assert.equal((await handleOpenAI(request('speech',{text:'a'.repeat(8000)}),env,noFetch)).status,400);
});
test('configuration status never returns the key and missing key is explicit',async()=>{
  assert.deepEqual(await (await handleOpenAI(request('status'),baseEnv,noFetch)).json(),{configured:false,voice:'ballad',aiGenerated:true,revision:null,source:'none',canManage:true,speechEngine:'gpt-live',model:'gpt-live-1',liveVerified:false});
  const response=await handleOpenAI(request('status'),env,noFetch);assert.equal((await response.text()).includes(env.OPENAI_API_KEY),false);
  const missing=await handleOpenAI(request('speech',{text:'Hoi'}),baseEnv,noFetch);assert.equal(missing.status,503);assert.equal((await missing.json()).error.code,'not_configured');
});
test('speech uses server-selected Ballad, Dutch instructions, bounded speed and audio response',async()=>{
  const response=await handleOpenAI(request('speech',{text:'Hallo Vlampie!',voice:'other',speed:1.1}),env,async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/audio/speech');assert.equal(options.headers.Authorization,'Bearer '+env.OPENAI_API_KEY);
    const body=JSON.parse(options.body);assert.equal(body.voice,'ballad');assert.equal(body.speed,1.1);assert.match(body.instructions,/Nederlands/);assert.equal(body.response_format,'mp3');
    return new Response(new Uint8Array([73,68,51,1,2]),{headers:{'content-type':'audio/mpeg'}});
  });
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('content-type'),'audio/mpeg');assert.equal((await response.arrayBuffer()).byteLength,5);
});
test('regie reply uses Responses, keeps untrusted messages separate and does not retain responses',async()=>{
  const response=await handleOpenAI(request('reply',{name:'Sanne',message:'🎉'.repeat(500),drawn:[1,5,5,76,'9']}),env,async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(options.body);assert.equal(body.store,false);assert.match(body.instructions,/bevestigt nooit een winnaar/);
    assert.deepEqual(JSON.parse(body.input).getrokkenProefnummers,[1,5]);assert.equal(JSON.parse(body.input).bericht,'🎉'.repeat(500));
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Wat spannend! De regie controleert je kaart.'}]}]});
  });
  assert.deepEqual(await response.json(),{text:'Wat spannend! De regie controleert je kaart.',voice:'ballad'});
});
test('upstream failures are sanitized and connection test does not generate speech',async()=>{
  for(const status of [401,429,500]){
    const response=await handleOpenAI(request('test'),env,async url=>{assert.equal(url,'https://api.openai.com/v1/models');return new Response('provider details '+env.OPENAI_API_KEY,{status});});
    assert.equal(response.status,status===429?429:502);assert.ok(!(await response.text()).includes(env.OPENAI_API_KEY));
  }
});

class FakeContext{
  constructor(){this.currentTime=10;this.state='running';this.destination={};this.sources=[];FakeContext.last=this;}
  resume(){return Promise.resolve();}
  decodeAudioData(){return Promise.resolve({duration:3.5});}
  createBufferSource(){const source={connect(){},disconnect(){},start(){source.started=true;},stop(){source.stopped=true;}};this.sources.push(source);return source;}
}
const audioResponse=()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'audio/mpeg'}});
test('visual speech starts after decode with true duration and stops with the audio',async()=>{
  const events=[];const player=createOpenAIVoice({Context:FakeContext,fetcher:async()=>audioResponse(),onStart:(...x)=>events.push(x),onEnd:()=>events.push('end')});
  await player.speak('Hallo!');assert.equal(player.phase,'playing');assert.deepEqual(events,[['Hallo!',3500]]);
  FakeContext.last.currentTime=11.25;assert.equal(player.elapsed,1250);
  FakeContext.last.sources[0].onended();assert.equal(player.phase,'idle');assert.equal(events.at(-1),'end');
});
test('stop during fetch prevents a late response from playing',async()=>{
  let resolveFetch,signal;const events=[];
  const player=createOpenAIVoice({Context:FakeContext,fetcher:(_,options)=>{signal=options.signal;return new Promise(r=>resolveFetch=r);},onStart:()=>events.push('start')});
  const pending=player.speak('Hallo');assert.equal(player.phase,'loading');player.stop();assert.equal(signal.aborted,true);resolveFetch(audioResponse());await pending;
  assert.equal(player.phase,'idle');assert.deepEqual(events,[]);assert.equal(FakeContext.last.sources.length,0);
});
test('newer utterance wins when network responses arrive out of order',async()=>{
  const resolves=[],events=[];const player=createOpenAIVoice({Context:FakeContext,fetcher:()=>new Promise(r=>resolves.push(r)),onStart:text=>events.push(text)});
  const first=player.speak('oud'),second=player.speak('nieuw');resolves[1](audioResponse());await second;resolves[0](audioResponse());await first;
  assert.deepEqual(events,['nieuw']);player.stop();assert.equal(FakeContext.last.sources[0].stopped,true);
});
test('autoplay restriction keeps decoded audio ready and retry makes no API call',async()=>{
  class BlockedContext extends FakeContext{constructor(){super();this.state='suspended';}resume(){if(this.allowed)this.state='running';return Promise.resolve();}}
  let calls=0;const events=[];const player=createOpenAIVoice({Context:BlockedContext,fetcher:async()=>{calls++;return audioResponse();},onStart:text=>events.push(text)});
  await player.speak('Hallo');assert.equal(player.phase,'ready');assert.deepEqual(events,[]);
  FakeContext.last.allowed=true;await player.resume();assert.equal(player.phase,'playing');assert.equal(calls,1);assert.deepEqual(events,['Hallo']);player.stop();
});
test('API failure stays a failure and does not start an alternate voice',async()=>{
  const errors=[],starts=[];const player=createOpenAIVoice({Context:FakeContext,fetcher:async()=>Response.json({error:{message:'Sleutel ontbreekt'}},{status:503}),onError:x=>errors.push(x),onStart:x=>starts.push(x)});
  await player.speak('Hoi');assert.equal(player.phase,'idle');assert.deepEqual(errors,['Sleutel ontbreekt']);assert.deepEqual(starts,[]);
});
test('an interrupted audio context resumes the existing source at the same position',async()=>{
  class ResumableContext extends FakeContext{resume(){this.state='running';this.onstatechange?.();return Promise.resolve();}}
  let starts=0;const player=createOpenAIVoice({Context:ResumableContext,fetcher:async()=>audioResponse(),onStart:()=>starts++});
  await player.speak('Hallo');const context=FakeContext.last;context.currentTime=11;context.state='suspended';context.onstatechange();
  assert.equal(player.phase,'paused');assert.equal(player.elapsed,1000);assert.equal(player.running,false);
  await player.resume();assert.equal(player.phase,'playing');assert.equal(player.elapsed,1000);assert.equal(context.sources.length,1);assert.equal(starts,1);player.stop();
});
test('all new controls exist, and the client has no key or direct provider endpoint',async()=>{
  const html=await readFile(new URL('./fixtures/legacy-studio.html',import.meta.url),'utf8'),app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),client=await readFile(new URL('../public/openai-voice.js',import.meta.url),'utf8');
  for(const id of ['speech-provider','speech-provider-label','openai-play','openai-status','openai-test','openai-help','ai-chat-form','ai-chat-message','ai-chat-submit','ai-chat-status','browser-voice-setting'])assert.match(html,new RegExp('id="'+id+'"'));
  assert.doesNotMatch(app+client,/OPENAI_API_KEY|api\.openai\.com/);assert.match(app,/openaiVoice=isShow\?null/);
});


test('regie pause holds the existing source and resume makes no new API request',async()=>{
 class PausableContext extends FakeContext{resume(){this.state='running';this.onstatechange?.();return Promise.resolve();}suspend(){this.state='suspended';this.onstatechange?.();return Promise.resolve();}}
 let calls=0,starts=0;const player=createOpenAIVoice({Context:PausableContext,fetcher:async()=>{calls++;return audioResponse();},onStart:()=>starts++});
 await player.speak('Nummer tweeënveertig');FakeContext.last.currentTime=11;await player.pause();assert.equal(player.phase,'paused');assert.equal(player.elapsed,1000);await player.resume();assert.equal(player.phase,'playing');assert.equal(player.elapsed,1000);assert.equal(calls,1);assert.equal(starts,1);assert.equal(FakeContext.last.sources.length,1);player.stop();
});
test('pause while the voice loads prevents a late response from starting audio',async()=>{
 let resolve;const starts=[];const player=createOpenAIVoice({Context:FakeContext,fetcher:()=>new Promise(r=>resolve=r),onStart:text=>starts.push(text)});
 const pending=player.speak('Nummer 42');await player.pause();resolve(audioResponse());await pending;assert.equal(player.phase,'ready');assert.deepEqual(starts,[]);await player.resume();assert.equal(player.phase,'playing');assert.deepEqual(starts,['Nummer 42']);player.stop();
});

function handleOpenAI(request,env,...args){return verifiedhandleOpenAI(request,verifiedTestEnvironment(request,env),...args);}
