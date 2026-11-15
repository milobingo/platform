import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_SPEECH_CHARACTERS,MAX_SPEECH_CHUNK_CHARACTERS,MAX_SPEECH_REQUEST_CHARACTERS,speechCharacterCount,assertSpeechText,splitSpeechText} from '../public/speech-text.js';
import {createOpenAIVoice} from '../public/openai-voice.js';
import {StudioEngine} from '../frontend/engine.js';
import {handleOpenAI} from '../server/openai.js';
import {createSqliteDatabase} from '../server/node-storage.js';
import {BingoStore} from '../server/bingo-store.js';
import {makeGame,forceCancelGame} from '../server/bingo-model.js';
import {fakeLiveSocket} from '../scripts/gpt-live-fixture.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const until=async predicate=>{const deadline=performance.now()+3000;while(!predicate()&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,1));assert(predicate(),'speech did not reach its expected state within three seconds');};
class Context{
 constructor(){Context.last=this;this.state='running';this.currentTime=10;this.sources=[];}
 resume(){this.state='running';this.onstatechange?.();return Promise.resolve();}
 suspend(){this.state='suspended';this.onstatechange?.();return Promise.resolve();}
 decodeAudioData(){return Promise.resolve({duration:1});}
 createBufferSource(){const source={connect(){},disconnect(){},start(){source.started=true;},stop(){source.stopped=true;}};this.sources.push(source);return source;}
}
const audio=()=>new Response(new Uint8Array([1]),{headers:{'Content-Type':'audio/wav','X-Vlampie-Clip':'a'.repeat(64)}});
const script=Array.from({length:25},(_,i)=>String(i).padStart(3,'0')+'x'.repeat(397)).join('');

function localVoice(options={}){const requests=[],starts=[],errors=[];let ended=0;const voice=createOpenAIVoice({Context,fetcher:async(path,opts)=>{requests.push(JSON.parse(opts.body));return audio();},onStart:text=>starts.push(text),onEnd:()=>ended++,onError:message=>errors.push(message),...options});return {voice,requests,starts,errors,get ended(){return ended;}};}

test('10,000 Unicode characters split without losing, duplicating or breaking text and oversize input remains untouched',()=>{
 const text=Array.from(('✨ Milo zegt: hallo! Welkom op het Sterrenplein. 🪄\n').repeat(300)).slice(0,MAX_SPEECH_CHARACTERS).join('');assert.equal(speechCharacterCount(text),10000);assertSpeechText(text);const chunks=splitSpeechText(text);assert.equal(chunks.join(''),text);assert(chunks.length>20);assert(chunks.every(part=>speechCharacterCount(part)<=MAX_SPEECH_CHUNK_CHARACTERS));assert(!chunks.some(part=>/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/u.test(part)));
 for(const value of ['',null,' '.repeat(10),'x'.repeat(10001)])assert.throws(()=>assertSpeechText(value));assert.equal(text.length>10000,true,'Unicode code points are counted rather than UTF-16 units');
 assert.equal(splitSpeechText('a'.repeat(10000)).join(''),'a'.repeat(10000));assert.equal(splitSpeechText(' Voor en na.\n\t ').join(''),' Voor en na.\n\t ');
});

test('a full 10,000-character local script fetches one bounded clip at a time and ends exactly once after every word',async()=>{
 const h=localVoice();await h.voice.speak(script,1.1,{characterId:'milo',gameId:'selected-show'});assert.equal(h.requests.length,1);
 for(let index=0;index<25;index++){
  await until(()=>Context.last.sources.length===index+1);assert.equal(h.ended,0);assert.equal(h.requests.length,index+1,'future clips must not all be generated upfront');assert.equal(h.requests[index].characterId,'milo');assert.equal(h.requests[index].gameId,'selected-show');assert.equal(h.requests[index].speed,1.1);assert(speechCharacterCount(h.requests[index].text)<=MAX_SPEECH_CHUNK_CHARACTERS);
  Context.last.currentTime++;Context.last.sources[index].onended();await flush();
 }
 assert.equal(h.voice.phase,'idle');assert.equal(h.ended,1);assert.equal(h.starts.join(''),script);assert.equal(h.requests.map(r=>r.text).join(''),script);assert.deepEqual(h.errors,[]);h.voice.stop();
});

test('pausing between clips retains the current queue and decoded audio; resume does not request or repeat the first clip',async()=>{
 let release;const requests=[],starts=[];let ended=0;
 const voice=createOpenAIVoice({Context,fetcher:async(_path,opts)=>{requests.push(JSON.parse(opts.body));if(requests.length===2)await new Promise(resolve=>{release=resolve;});return audio();},onStart:text=>starts.push(text),onEnd:()=>ended++});
 await voice.speak(script.slice(0,800));Context.last.sources[0].onended();await until(()=>requests.length===2);await voice.pause();release();await until(()=>voice.phase==='ready');assert.equal(starts.length,1);assert.equal(Context.last.sources.length,1);assert.equal(ended,0);
 await voice.resume();assert.equal(starts.length,2);assert.equal(requests.length,2);assert.equal(Context.last.sources.length,2);Context.last.sources[1].onended();await flush();assert.equal(ended,1);assert.equal(starts.join(''),script.slice(0,800));voice.stop();
});

test('stop aborts an in-flight later clip, clears the remaining script and ignores its late response',async()=>{
 let release,signal;const requests=[],starts=[];let ended=0;
 const voice=createOpenAIVoice({Context,fetcher:async(_path,opts)=>{requests.push(JSON.parse(opts.body));if(requests.length===2){signal=opts.signal;await new Promise(resolve=>{release=resolve;});}return audio();},onStart:text=>starts.push(text),onEnd:()=>ended++});
 await voice.speak(script);Context.last.sources[0].onended();await until(()=>requests.length===2);voice.stop();assert(signal.aborted);release();await flush();assert.equal(voice.phase,'idle');assert.equal(requests.length,2);assert.equal(starts.length,1);assert.equal(ended,0);assert.equal(Context.last.sources.length,1);
});

test('a failed later clip reports failure without an early completion or generating the rest of the script',async()=>{
 let requestCount=0;const h=localVoice({fetcher:async()=>++requestCount===1?audio():Response.json({error:{message:'Provider tijdelijk niet bereikbaar'}},{status:503})});await h.voice.speak(script);Context.last.sources[0].onended();await until(()=>h.errors.length===1);assert.equal(requestCount,2);assert.equal(h.ended,0);assert.equal(h.voice.phase,'idle');assert.match(h.errors[0],/Provider/);h.voice.stop();
});

test('10,000 characters use the same OBS clip route in sequence; no local source plays and only the final acknowledgement completes the script',async()=>{
 const requests=[],played=[],starts=[],errors=[];let ended=0,resolvePart,stops=0;
 const remote={play(clip,text,duration,onStart){assert.equal(clip,'a'.repeat(64));assert.equal(duration,1000);played.push(text);onStart();return new Promise(resolve=>{resolvePart=resolve;});},pause(){},resume(){},stop(){stops++;},getElapsed:()=>0};
 const voice=createOpenAIVoice({Context,getRemote:()=>remote,fetcher:async(_path,opts)=>{requests.push(JSON.parse(opts.body));return audio();},onStart:text=>starts.push(text),onEnd:()=>ended++,onError:message=>errors.push(message)});
 const pending=voice.speak(script,1,{characterId:'milo',gameId:'the-same-show'});
 for(let index=0;index<25;index++){await until(()=>played.length===index+1);assert.equal(requests.length,index+1);assert.equal(ended,0);assert.equal(Context.last.sources.length,0);resolvePart();await flush();}
 await pending;assert.equal(ended,1);assert.equal(played.join(''),script);assert.equal(starts.join(''),script);assert.deepEqual(errors,[]);assert.equal(stops,0);voice.stop();
});

test('stop during a remote clip cancels its playback and never starts the next queued clip',async()=>{
 let resolve,stopped=0,requests=0,ended=0;
 const remote={play(_clip,_text,_duration,onStart){onStart();return new Promise(done=>{resolve=done;});},stop(){stopped++;resolve?.();},pause(){},resume(){},getElapsed:()=>0};
 const voice=createOpenAIVoice({Context,getRemote:()=>remote,fetcher:async()=>{requests++;return audio();},onEnd:()=>ended++});const pending=voice.speak(script);await until(()=>voice.phase==='playing');voice.stop();await pending;assert.equal(stopped,1);assert.equal(requests,1);assert.equal(ended,0);assert.equal(voice.phase,'idle');
});

test('the real speech API, saved GPT-Live character and clip cache prepare every part and reuse all cached parts without credentials',async t=>{
 const db=createSqliteDatabase(':memory:');t.after(()=>db.close());const files=new Map(),upstream=[],requests=[];const env={DB:db,AUTH_IDENTITY:{user:'long-script-owner',email:'owner@example.test',admin:true},OPENAI_API_KEY:'test-only-long-speech',SETTINGS:{get:async key=>{const file=files.get(key);return file?{body:file.audio,httpMetadata:file.options.httpMetadata}:null;},put:async(key,value,options)=>{files.set(key,{audio:value,options});}}};
 const fetcher=async(_path,opts)=>{const body=JSON.parse(opts.body);requests.push(body.text);return handleOpenAI(new Request('https://studio.example/api/openai/speech',{...opts,headers:{...opts.headers,Origin:'https://studio.example'}}),env,async(url,providerOptions)=>{upstream.push(body.text);assert.equal(url,'https://api.openai.com/v1/live/sessions');assert.equal(providerOptions.headers.Upgrade,'websocket');return fakeLiveSocket({text:body.text.trim(),onStart:session=>{assert.equal(session.model,'gpt-live-1');assert.equal(session.store,false);assert.equal(session.audio.output.voice,'verse');assert(session.input[0].content[0].text.endsWith(body.text.trim()));}});});};
 const h=localVoice({fetcher});await h.voice.speak(script,1,{characterId:'milo',brandId:'milo'});
 for(let index=0;index<25;index++){await until(()=>Context.last.sources.length===index+1);Context.last.sources[index].onended();await flush();}
 assert.equal(h.ended,1);assert.equal(upstream.join(''),script);assert.equal(files.size,25);assert(requests.every(text=>speechCharacterCount(text)<=MAX_SPEECH_REQUEST_CHARACTERS));
 delete env.OPENAI_API_KEY;await h.voice.speak(script,1,{characterId:'milo',brandId:'milo'});
 for(let index=0;index<25;index++){await until(()=>Context.last.sources.length===index+26);Context.last.sources[index+25].onended();await flush();}
 assert.equal(h.ended,2);assert.equal(upstream.length,25,'a prepared long script must stay usable if the key is removed');assert.deepEqual(h.errors,[]);h.voice.stop();
});

test('the fragment endpoint rejects an overlong direct request honestly and cancelled shows cannot generate or read script audio',async t=>{
 const db=createSqliteDatabase(':memory:');t.after(()=>db.close());const store=new BingoStore(db),game=makeGame({brandId:'milo',date:'2027-12-05T19:00:00Z'},'owner','https://studio.example');game.status='running';forceCancelGame(game,{by:'owner',reason:'Test annulering',requestId:'test-request',binding:'test'});await store.create(game);
 const env={DB:db,AUTH_IDENTITY:{user:'owner',email:'owner@example.test',admin:true},OPENAI_API_KEY:'test-only-no-provider',SETTINGS:{get:async()=>null}},call=text=>handleOpenAI(new Request('https://studio.example/api/openai/speech',{method:'POST',headers:{Origin:'https://studio.example','Content-Type':'application/json'},body:JSON.stringify({characterId:'milo',gameId:game.id,text})}),env,()=>assert.fail('cancelled or invalid speech must never reach a provider'));
 const direct=await call('x'.repeat(501));assert.equal(direct.status,400);assert.match((await direct.json()).error.message,/fragment/);const cancelled=await call('Deze show mag niets meer zeggen.');assert.equal(cancelled.status,409);assert.equal((await cancelled.json()).error.code,'show_cancelled');
});

test('the engine preserves a 10,001-character field and rejects before stop, provider access or truncation',()=>{
 const input='x'.repeat(10001),e=Object.create(StudioEngine.prototype);Object.assign(e,{game:{status:'draft'},voiceText:input,liveCalls:null,stopSpeech(){assert.fail('invalid input must not replace the current speech');}});assert.throws(()=>e.speak(input),/10.000/);assert.equal(e.voiceText,input);
});

test('the browser rehearsal also speaks the complete script in bounded parts and stopping cancels future parts',t=>{
 const priorUtterance=globalThis.SpeechSynthesisUtterance,priorSynthesis=globalThis.speechSynthesis,spoken=[];t.after(()=>{globalThis.SpeechSynthesisUtterance=priorUtterance;globalThis.speechSynthesis=priorSynthesis;});globalThis.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};globalThis.speechSynthesis={getVoices:()=>[],speak:u=>{spoken.push(u);u.onstart?.();},cancel(){},resume(){},pause(){}};
 const e=Object.create(StudioEngine.prototype);let ended=0;Object.assign(e,{game:{status:'draft'},demo:true,speechToken:1,liveCalls:null,stopSpeech(){this.speechToken++;},emit(){},characters:[],director:{},audio:{duck(){}},speechEnded(){ended++;}});
 e.speak(script,'milo','browser');for(let index=0;index<25;index++){assert.equal(spoken.length,index+1);assert.equal(ended,0);spoken[index].onend();}assert.equal(ended,1);assert.equal(spoken.map(u=>u.text).join(''),script);
 e.speak(script,'milo','browser');e.speechToken++;spoken.at(-1).onend();assert.equal(spoken.length,26);assert.equal(ended,1);
});
