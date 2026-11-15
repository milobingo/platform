import test from 'node:test';
import assert from 'node:assert/strict';
import {PreparedShowAudio} from '../frontend/prepared-show-audio.js';
import {createOpenAIVoice} from '../public/openai-voice.js';
import {splitSpeechText} from '../public/speech-text.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function until(predicate){const deadline=performance.now()+2000;while(!predicate()&&performance.now()<deadline)await sleep(1);assert(predicate(),'prepared audio did not reach the expected state');}
const item=(number,text='Vast fragment '+number,overrides={})=>({key:number.toString(16).padStart(64,'0'),clip:number.toString(16).padStart(64,'0'),characterId:'milo',speed:1,text,kind:'fixed',durationMs:null,...overrides});
const responseFor=(entry,{status=200,type='audio/wav',key=entry.key,bytes=new Uint8Array([1,2,3]),duration=1000}={})=>status===200?new Response(bytes,{headers:{'Content-Type':type,'X-Vlampie-Clip':key,'X-Milo-Audio-Duration-Ms':String(duration)}}):Response.json({error:{message:'Tijdelijke voorbereidingsfout'}},{status});

function fixture(t,{items=[item(1),item(2),item(3)],ready=[],delay=10000,minimumGenerationGap=0,retryLimit=0,retryDelayMs=1,beforePrepare,manifest,fetcher}={}){
 const state={enabled:true,gameId:'show-a',identity:'show-a/plan-1/profile-1'},serverReady=new Set(ready),requests=[],generations=[],snapshots=[];let flushes=0,manifests=0;
 const h={state,serverReady,requests,generations,snapshots,items,fetcher,manifest,get flushes(){return flushes;},get manifests(){return manifests;}};
 h.reply=entry=>{serverReady.add(entry.key);return responseFor(entry);};
 h.audio=new PreparedShowAudio({read:()=>({...state}),delay,minimumGenerationGap,retryLimit,retryDelayMs,
  beforePrepare:async()=>{flushes++;await beforePrepare?.(h);},
  manifest:async body=>{manifests++;assert.equal(body.gameId,state.gameId);if(h.manifest)return h.manifest(body,h);return {fingerprint:'fingerprint:'+state.identity,items:structuredClone(h.items).map(entry=>({...entry,ready:serverReady.has(entry.key)}))};},
  fetcher:async(path,options)=>{assert.equal(path,'/api/openai/speech');assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');assert.equal(options.headers['Content-Type'],'application/json');const body=JSON.parse(options.body),entry=h.items.find(entry=>entry.key===body.expectedKey);assert(entry,'only exact manifest items may be prepared');assert.equal(body.characterId,entry.characterId);assert.equal(body.speed,entry.speed);assert.equal(body.text,entry.text);requests.push({body,signal:options.signal});if(!body.cacheOnly)generations.push(entry.key);if(h.fetcher)return h.fetcher(entry,options,h);return h.reply(entry);},
  onChange:()=>{if(h.audio)snapshots.push({...h.audio.state});}
 });
 t.after(()=>{state.enabled=false;h.audio.dispose();});return h;
}

test('a running-show readiness action restores exact cached audio after reload without saving or generating',async t=>{
 const entries=[item(1),item(2),item(3)],h=fixture(t,{items:entries,ready:entries.map(entry=>entry.key)});
 const result=await h.audio.ensure({restoreCached:true});
 assert.equal(result.complete,true);assert.equal(h.flushes,0);assert.equal(h.manifests,1);assert.equal(h.requests.length,3);assert.equal(h.generations.length,0);
 assert(h.requests.every(request=>request.body.cacheOnly===true));assert(h.snapshots.some(snapshot=>snapshot.restoring));assert.equal(result.restoring,false);
 assert.equal(h.audio.lookup(item(2).text,1,{characterId:'milo'}).key,item(2).key);
 await h.audio.ensure({restoreCached:true});assert.equal(h.manifests,1);assert.equal(h.requests.length,3);
});

test('two cached readiness checks share a single restore and cannot duplicate downloads',async t=>{
 const gate=defer(),h=fixture(t,{items:[item(1)],ready:[item(1).key],fetcher:async(entry,_options,h)=>{await gate.promise;return h.reply(entry);}});
 const first=h.audio.ensure({restoreCached:true}),second=h.audio.ensure({restoreCached:true});await until(()=>h.requests.length===1);
 assert.equal(h.manifests,1);assert.equal(h.generations.length,0);gate.resolve();assert.equal((await first).complete,true);assert.equal((await second).complete,true);assert.equal(h.requests.length,1);
});

test('cached recovery retains available audio but a missing clip never becomes a generation request',async t=>{
 const h=fixture(t,{ready:[item(1).key,item(3).key]});
 await assert.rejects(h.audio.ensure({restoreCached:true}),/1 van de 3.*ontbreken/);
 assert.equal(h.audio.state.complete,false);assert.equal(h.audio.state.ready,2);assert.equal(h.requests.length,2);assert.equal(h.generations.length,0);assert.equal(h.flushes,0);
 assert(h.requests.every(request=>request.body.cacheOnly===true));assert.match(h.audio.state.error,/spelstand blijft behouden/);assert.match(h.audio.state.error,/Resterende audio voorbereiden/);
 await assert.rejects(h.audio.ensure(),/Resterende audio voorbereiden/);assert.equal(h.manifests,1);
 await h.audio.prepare({retry:true});assert.equal(h.audio.state.complete,true);assert.equal(h.flushes,1);assert.deepEqual(h.generations,[item(2).key]);assert.equal(h.requests.length,3);
});

test('a clip removed after manifest enumeration reports recovery without falling back to paid speech',async t=>{
 const h=fixture(t,{items:[item(1)],ready:[item(1).key],retryLimit:2,fetcher:async()=>Response.json({error:{code:'speech_not_prepared',message:'Oude fouttekst'}},{status:409})});
 await assert.rejects(h.audio.ensure({restoreCached:true}),/opgeslagen stemfragment is niet meer beschikbaar/);
 assert.equal(h.requests.length,1);assert.equal(h.generations.length,0);assert.equal(h.audio.state.complete,false);assert.match(h.audio.state.error,/spelstand blijft behouden/);
});

test('restoring after a non-audio edit verifies the manifest and reuses current bytes without another preparation action',async t=>{
 const h=fixture(t);await h.audio.prepare();const original=h.audio.lookup(item(1).text,1,{characterId:'milo'}).bytes;
 h.state.identity+='/non-audio-edit';h.audio.track();assert.equal(h.audio.state.phase,'stale');
 await h.audio.ensure({restoreCached:true});assert.equal(h.audio.state.complete,true);assert.equal(h.audio.lookup(item(1).text,1,{characterId:'milo'}).bytes,original);
 assert.equal(h.flushes,1);assert.equal(h.manifests,2);assert.equal(h.requests.length,3);assert.equal(h.generations.length,3);
});

test('a genuinely changed voice with no cached replacement never restores the older voice',async t=>{
 const h=fixture(t,{items:[item(1)]});await h.audio.prepare();h.state.identity+='/new-voice';h.items=[item(9,item(1).text)];h.audio.track();
 await assert.rejects(h.audio.ensure({restoreCached:true}),/ontbreken/);assert.equal(h.requests.length,1);assert.equal(h.flushes,1);assert.deepEqual(h.generations,[item(1).key]);
 assert.equal(h.audio.lookup(item(1).text,1,{characterId:'milo'}),null);assert.equal(h.audio.state.complete,false);
});

for(const boundary of ['manifest','bytes'])test(`changing the show during cached ${boundary} recovery aborts without stale readiness or paid requests`,async t=>{
 const gate=defer();let entered=false;
 const h=fixture(t,{items:[item(1)],ready:[item(1).key],manifest:boundary==='manifest'?async()=>{entered=true;await gate.promise;return {fingerprint:'old',items:[{...item(1),ready:true}]};}:undefined,fetcher:async entry=>{const response=responseFor(entry);response.arrayBuffer=async()=>{entered=true;await gate.promise;return new Uint8Array([1,2,3]).buffer;};return response;}});
 const operation=h.audio.ensure({restoreCached:true});await until(()=>entered);h.state.gameId='show-b';h.state.identity='show-b/plan-1/profile-1';h.audio.track();gate.resolve();
 await assert.rejects(operation,error=>error.name==='AbortError');assert.equal(h.audio.state.complete,false);assert.equal(h.audio.cache.size,0);assert.equal(h.generations.length,0);assert.equal(h.flushes,0);
});

test('every manifest item is loaded with at most two requests, after the latest preparation is flushed',async t=>{
 const flushGate=defer(),waiters=[];let active=0,maxActive=0;
 const entries=Array.from({length:9},(_,i)=>item(i+1)),h=fixture(t,{items:entries,ready:entries.filter((_,i)=>i%2===0).map(entry=>entry.key),beforePrepare:()=>flushGate.promise,fetcher:async(entry,_options,h)=>{active++;maxActive=Math.max(maxActive,active);const gate=defer();waiters.push({entry,gate});await gate.promise;active--;return h.reply(entry);}});
 const pending=h.audio.prepare();await flush();assert.equal(h.manifests,0);assert.equal(h.requests.length,0);flushGate.resolve();await until(()=>waiters.length===2);assert.equal(active,2);assert.equal(h.requests.length,2);
 for(let index=0;index<entries.length;index++){await until(()=>waiters.length>index);assert(maxActive<=2);waiters[index].gate.resolve();}
 const result=await pending;assert.equal(result.complete,true);assert.equal(result.ready,9);assert.equal(h.audio.cache.size,9);assert.equal(maxActive,2);assert.equal(h.flushes,1);assert.equal(h.manifests,1);assert.equal(h.generations.length,4);assert.equal(h.audio.bytes,27);assert(h.snapshots.filter(s=>s.phase==='loading').every(s=>!s.complete));
 for(const entry of entries){const cached=h.audio.lookup(entry.text,entry.speed,{characterId:entry.characterId});assert.equal(cached.key,entry.key);assert.equal(cached.fingerprint,'fingerprint:'+h.state.identity);assert.equal(cached.durationMs,1000);assert.equal(cached.bytes.byteLength,3);}
});

test('same keys reuse loaded bytes across shows and plan changes; only changed keys are fetched and old unused bytes are removed',async t=>{
 const h=fixture(t,{items:[item(1),item(2)]});await h.audio.prepare();const first=h.audio.lookup('Vast fragment 1',1,{characterId:'milo'}).bytes;assert.equal(h.requests.length,2);
 h.state.gameId='show-b';h.state.identity='show-b/plan-2/profile-1';h.items=[item(1),item(3)];h.audio.track();await h.audio.prepare();assert.equal(h.requests.length,3);assert.equal(h.requests.at(-1).body.expectedKey,item(3).key);assert.equal(h.requests.at(-1).body.gameId,'show-b');assert.equal(h.audio.lookup('Vast fragment 1',1,{characterId:'milo'}).bytes,first);assert.equal(h.audio.lookup('Vast fragment 2',1,{characterId:'milo'}),null);assert.equal(h.audio.cache.size,2);assert.equal(h.audio.bytes,6);
 await h.audio.ensure();assert.equal(h.requests.length,3,'a ready preparation check does not reload bytes');
});

test('cached clips load before new generation, without spending a second generation or waiting for slow fresh speech',async t=>{
 const gate=defer(),entries=[item(1),item(2),item(3),item(4)],h=fixture(t,{items:entries,ready:[item(3).key,item(4).key],fetcher:async(entry,_options,h)=>{if([item(1).key,item(2).key].includes(entry.key))await gate.promise;return h.reply(entry);}});
 const pending=h.audio.prepare();await until(()=>h.requests.length===4);
 assert.deepEqual(h.requests.slice(0,2).map(request=>request.body.expectedKey),[item(3).key,item(4).key]);assert.equal(h.audio.state.ready,2);assert.equal(h.audio.state.reusedTotal,2);assert.equal(h.audio.state.newTotal,2);assert.equal(h.generations.length,2);gate.resolve();await pending;assert.equal(h.audio.state.complete,true);
});

test('a temporary timeout retries only its fragment and retains already prepared audio',async t=>{
 let attempts=0;const h=fixture(t,{retryLimit:2,items:[item(1),item(2)],fetcher:async(entry,_options,h)=>{if(entry.key===item(2).key&&attempts++===0)return Response.json({error:{code:'speech_timeout',message:'De spraakdienst reageert tijdelijk niet.'}},{status:504});return h.reply(entry);}});
 await h.audio.prepare();assert.equal(h.audio.state.complete,true);assert.equal(h.requests.filter(request=>request.body.expectedKey===item(1).key).length,1);assert.equal(h.requests.filter(request=>request.body.expectedKey===item(2).key).length,2);assert.equal(h.audio.bytes,6);assert(h.snapshots.some(s=>s.retrying===1));assert.equal(h.audio.state.retrying,0);
});

test('network failures have a bounded retry count; exhaustion preserves prior bytes for a deliberate retry',async t=>{
 const h=fixture(t,{retryLimit:2,items:[item(1),item(2)],fetcher:async(entry,_options,h)=>{if(entry.key===item(2).key)throw new TypeError('Failed to fetch');return h.reply(entry);}});
 await assert.rejects(h.audio.prepare(),/Failed to fetch/);assert.equal(h.requests.filter(request=>request.body.expectedKey===item(2).key).length,3);assert.equal(h.requests.filter(request=>request.body.expectedKey===item(1).key).length,1);assert.equal(h.audio.state.phase,'error');assert.equal(h.audio.state.ready,1);assert.equal(h.audio.state.retrying,0);assert.equal(h.audio.bytes,3);
 const count=h.requests.length;await assert.rejects(h.audio.ensure());await sleep(10);assert.equal(h.requests.length,count,'readiness does not start another retry cycle');
});

test('a busy response respects Retry-After and retries the same exact manifest key',async t=>{
 let first=true;const h=fixture(t,{retryLimit:2,items:[item(1)],fetcher:async(entry,_options,h)=>{if(first){first=false;return Response.json({error:{code:'busy',message:'Even wachten'}},{status:429,headers:{'Retry-After':'1'}});}return h.reply(entry);}}),waits=[],wait=h.audio.wait.bind(h.audio);
 h.audio.wait=(ms,epoch)=>{waits.push(ms);return wait(Math.min(ms,2),epoch);};await h.audio.prepare();assert(waits.some(ms=>ms>=1000));assert.equal(h.requests.length,2);assert.equal(h.requests[0].body.expectedKey,h.requests[1].body.expectedKey);assert.equal(h.audio.state.complete,true);
});

for(const failure of [{status:429,code:'openai_limit'},{status:429,code:'busy'},{status:401,code:'sign_in'},{status:502,code:'key_rejected'},{status:502,code:'speech_script_mismatch'},{status:409,code:'speech_profile_changed'}])test(`${failure.code}/${failure.status} is never automatically retried without a safe recovery contract`,async t=>{
 const h=fixture(t,{retryLimit:2,items:[item(1)],fetcher:async()=>Response.json({error:{code:failure.code,message:'Niet opnieuw genereren'}},{status:failure.status})});await assert.rejects(h.audio.prepare(),/Niet opnieuw genereren/);assert.equal(h.requests.length,1);assert.equal(h.audio.state.complete,false);
});

test('changing the show cancels a Retry-After wait immediately and never invites an old generation',async t=>{
 const h=fixture(t,{retryLimit:2,items:[item(1)],fetcher:async()=>Response.json({error:{code:'busy',message:'Even wachten'}},{status:429,headers:{'Retry-After':'60'}})}),pending=h.audio.prepare();await until(()=>h.audio.state.retrying===1);h.state.identity+='/changed';h.audio.track();await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(h.requests.length,1);assert.equal(h.audio.state.phase,'stale');assert.equal(h.audio.state.retrying,0);
});

test('a changed speaker profile invalidates exact text/speed identities rather than playing the earlier voice',async t=>{
 const h=fixture(t,{items:[item(1,'Hallo Milo')]});await h.audio.prepare();h.state.identity='show-a/plan-1/profile-2';h.items=[item(9,'Hallo Milo',{speed:1.1})];assert.equal(h.audio.lookup('Hallo Milo',1,{characterId:'milo'}),null);h.audio.track();await h.audio.prepare();assert.equal(h.audio.lookup('Hallo Milo',1,{characterId:'milo'}),null);assert.equal(h.audio.lookup('Hallo Milo',1.1,{characterId:'milo'}).key,item(9).key);assert.deepEqual(h.generations,[item(1).key,item(9).key]);
});

test('a server-lost clip is regenerated on explicit retry even if the browser still holds the old bytes',async t=>{
 const h=fixture(t);await h.audio.prepare();h.serverReady.delete(item(2).key);const old=h.audio.cache.get(item(2).key);await h.audio.prepare({retry:true});assert.equal(h.requests.length,4);assert.equal(h.requests.at(-1).body.expectedKey,item(2).key);assert.equal(h.requests.at(-1).body.cacheOnly,false);assert.notEqual(h.audio.cache.get(item(2).key),old);assert.equal(h.audio.state.complete,true);assert.equal(h.audio.bytes,9);
});

test('a failed first worker cancels another worker waiting for the generation gap and never starts later items',async t=>{
 const h=fixture(t,{minimumGenerationGap:60,fetcher:async entry=>responseFor(entry,{status:503})});await assert.rejects(h.audio.prepare(),/Tijdelijke/);assert.equal(h.requests.length,1);assert.equal(h.audio.state.complete,false);assert.equal(h.audio.state.phase,'error');await sleep(90);assert.equal(h.requests.length,1,'a sleeping sibling must not generate after failure');assert.equal(h.audio.ready,0);
});

test('partial success is retained, active siblings are aborted and ignored, and only a manual retry completes preparation',async t=>{
 const late=defer();let fail=true;
 const h=fixture(t,{items:[item(1),item(2),item(3),item(4)],fetcher:async(entry,_options,h)=>{if(fail&&entry.key===item(2).key){await late.promise;return h.reply(entry);}if(fail&&entry.key===item(3).key)return responseFor(entry,{status:503});return h.reply(entry);}});
 await assert.rejects(h.audio.prepare(),/Tijdelijke/);assert.equal(h.audio.cache.size,1);assert.equal(h.audio.ready,1);assert.equal(h.requests.length,3);assert.equal(h.requests.find(r=>r.body.expectedKey===item(2).key).signal.aborted,true);late.resolve();await flush();assert.equal(h.audio.cache.size,1,'late sibling bytes must not turn a failed preparation green');assert.equal(h.audio.state.phase,'error');assert.equal(h.audio.state.complete,false);const count=h.requests.length;await sleep(10);assert.equal(h.requests.length,count,'there is no automatic retry loop');
 fail=false;await h.audio.prepare({retry:true});assert.equal(h.audio.state.complete,true);assert.equal(h.audio.ready,4);assert.equal(h.requests.filter(r=>r.body.expectedKey===item(1).key).length,1,'successful bytes survive retry');assert.equal(h.audio.bytes,12);
});

for(const change of ['show','plan','profile'])test(`${change} changes abort a pending manifest and reject stale items before any speech request`,async t=>{
 const gate=defer(),h=fixture(t,{manifest:()=>gate.promise}),pending=h.audio.prepare();await until(()=>h.manifests===1);h.state.identity+='/changed-'+change;if(change==='show')h.state.gameId='show-new';h.audio.track();gate.resolve({fingerprint:'old-fingerprint',items:[item(1)]});await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(h.requests.length,0);assert.equal(h.audio.state.complete,false);assert.equal(h.audio.fingerprint,null);assert.equal(h.audio.items.length,0);
});

test('a show change during the initial save barrier prevents even manifest enumeration',async t=>{
 const gate=defer(),h=fixture(t,{beforePrepare:()=>gate.promise}),pending=h.audio.prepare();await flush();h.state.identity='show-new/plan-new/profile-1';h.state.gameId='show-new';h.audio.track();gate.resolve();await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(h.manifests,0);assert.equal(h.requests.length,0);
});

for(const boundary of ['response','bytes'])test(`profile changes abort in-flight ${boundary} and stale bytes cannot enter the cache`,async t=>{
 const gate=defer();let entered=false;
 const h=fixture(t,{items:[item(1)],fetcher:async(entry,_options,h)=>{if(boundary==='response'){entered=true;await gate.promise;return h.reply(entry);}const response=responseFor(entry);response.arrayBuffer=async()=>{entered=true;await gate.promise;return new Uint8Array([7,8,9]).buffer;};return response;}}),pending=h.audio.prepare();
 await until(()=>entered);const signal=h.requests[0].signal;h.state.identity+='/new-profile';h.audio.track();assert.equal(signal.aborted,true);gate.resolve();await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(h.audio.cache.size,0);assert.equal(h.audio.bytes,0);assert.equal(h.audio.state.complete,false);
});

for(const failure of ['content-type','wrong-key','empty','http-error'])test(`${failure} never produces a green prepared status or usable playback entry`,async t=>{
 const h=fixture(t,{items:[item(1)],fetcher:async entry=>responseFor(entry,failure==='content-type'?{type:'text/html'}:failure==='wrong-key'?{key:item(99).key}:failure==='empty'?{bytes:new Uint8Array()}:{status:503})});await assert.rejects(h.audio.prepare());assert.equal(h.audio.state.complete,false);assert.equal(h.audio.state.phase,'error');assert.equal(h.audio.cache.size,0);assert.equal(h.audio.lookup('Vast fragment 1',1,{characterId:'milo'}),null);assert(h.audio.state.error.length>0);
});

test('selecting, editing and readiness checks never enumerate or generate audio until the explicit action',async t=>{
 const h=fixture(t,{delay:1});h.audio.track();h.audio.track();await sleep(25);assert.equal(h.audio.state.phase,'idle');assert.equal(h.manifests,0);assert.equal(h.flushes,0);assert.equal(h.requests.length,0);
 await assert.rejects(h.audio.ensure(),/klik op ‘Audio voorbereiden’/);assert.equal(h.manifests,0);assert.equal(h.requests.length,0);
 h.state.identity+='/first-edit';h.audio.track();await sleep(25);assert.equal(h.audio.state.phase,'idle');assert.equal(h.manifests,0);assert.equal(h.requests.length,0);
 await h.audio.prepare();assert.equal(h.audio.state.complete,true);assert.equal(h.generations.length,3);
 h.state.identity+='/later-edit';h.items=[item(1),item(4)];h.audio.track();assert.equal(h.audio.state.phase,'stale');await assert.rejects(h.audio.ensure(),/Gewijzigde audio voorbereiden/);await sleep(25);assert.equal(h.manifests,1);assert.equal(h.requests.length,3);assert.equal(h.audio.lookup('Vast fragment 1',1,{characterId:'milo'}),null);
 await h.audio.prepare();assert.equal(h.audio.state.complete,true);assert.equal(h.manifests,2);assert.deepEqual(h.generations,[item(1).key,item(2).key,item(3).key,item(4).key]);await h.audio.ensure();assert.equal(h.manifests,2);
});

test('start and resume readiness may wait for a manual preparation already in progress without starting another operation',async t=>{
 const gate=defer(),h=fixture(t,{items:[item(1)],fetcher:async(entry,_options,h)=>{await gate.promise;return h.reply(entry);}});
 const prepare=h.audio.prepare();await until(()=>h.requests.length===1);let ready=false;const check=h.audio.ensure().then(result=>{ready=true;return result;});await flush();assert.equal(ready,false);assert.equal(h.manifests,1);assert.equal(h.requests.length,1);gate.resolve();await prepare;assert.equal((await check).complete,true);assert.equal(ready,true);assert.equal(h.manifests,1);
});

test('failed manual preparation is never retried by readiness checks or later edits',async t=>{
 const h=fixture(t,{items:[item(1)],fetcher:async entry=>responseFor(entry,{status:503})});await assert.rejects(h.audio.prepare(),/Tijdelijke/);const count=h.requests.length;await assert.rejects(h.audio.ensure(),/Tijdelijke/);h.state.identity+='/edited';h.audio.track();await assert.rejects(h.audio.ensure(),/Gewijzigde audio voorbereiden/);await sleep(25);assert.equal(h.requests.length,count);assert.equal(h.manifests,1);
});

test('disposal aborts active fetches, ignores late responses and clears all held bytes',async t=>{
 const gate=defer(),h=fixture(t,{fetcher:async(entry,_options,h)=>{await gate.promise;return h.reply(entry);}}),pending=h.audio.prepare();await until(()=>h.requests.length===2);const signals=h.requests.map(r=>r.signal);h.state.enabled=false;h.audio.dispose();assert(signals.every(signal=>signal.aborted));gate.resolve();await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(h.audio.cache.size,0);assert.equal(h.audio.bytes,0);assert.equal(h.audio.state.complete,false);assert.equal(h.requests.length,2);
});

function voiceContext(){
 let context;class Context{
  state='running';currentTime=0;sources=[];decodes=[];destination={};
  constructor(){context=this;}
  async resume(){this.state='running';this.onstatechange?.();}
  async suspend(){this.state='suspended';this.onstatechange?.();}
  async decodeAudioData(bytes){this.decodes.push(bytes);return {duration:1};}
  createGain(){return {gain:{value:1},connect(){}};}
  createAnalyser(){return {fftSize:256,connect(){},getByteTimeDomainData(bytes){bytes.fill(128);}};}
  createBufferSource(){const source={connect(){},disconnect(){},start(){source.started=true;},stop(){source.stopped=true;}};this.sources.push(source);return source;}
 }
 return {Context,get context(){return context;}};
}
function playback(h,{remote=null,fetcher=()=>assert.fail('prepared live speech must not fetch or generate audio')}={}){
 const audio=voiceContext(),starts=[],errors=[];let ended=0;
 const voice=createOpenAIVoice({Context:audio.Context,getPrepared:(...args)=>h.audio.lookup(...args),getRemote:()=>remote,fetcher,onStart:(text,duration)=>starts.push({text,duration}),onEnd:()=>ended++,onError:message=>errors.push(message)});
 return {audio,voice,starts,errors,get ended(){return ended;}};
}

test('prepared local playback reads exact loaded bytes lazily, emits once and never requests the provider',async t=>{
 const h=fixture(t,{items:[item(1,'Bernhard vijftien! Vijftien!')]});await h.audio.prepare();const v=playback(h);t.after(()=>v.voice.stop());await v.voice.speak(h.items[0].text,1,{characterId:'milo',gameId:h.state.gameId,preparedOnly:true});assert.equal(v.audio.context.decodes.length,1);assert.equal(v.audio.context.sources.length,1);assert.equal(v.audio.context.sources[0].started,true);assert.notEqual(v.audio.context.decodes[0],h.audio.cache.get(item(1).key),'decoding must receive a copy, preserving reusable cache bytes');assert.equal(v.ended,0);v.audio.context.sources[0].onended();await flush();assert.equal(v.ended,1);assert.deepEqual(v.errors,[]);assert.equal(h.requests.length,1);
});

test('prepared OBS playback forwards the bound fingerprint and clip, waits for its ACK and never plays locally',async t=>{
 const h=fixture(t,{items:[item(1,'Nico zevenendertig! Zevenendertig!')]});await h.audio.prepare();const gate=defer(),played=[];
 const remote={play(clip,text,duration,onStart,options){played.push({clip,text,duration,options});onStart();return gate.promise;},stop(){gate.resolve();},pause(){},resume(){},getElapsed:()=>0},v=playback(h,{remote});t.after(()=>v.voice.stop());const pending=v.voice.speak(h.items[0].text,1,{characterId:'milo',gameId:h.state.gameId,preparedOnly:true});await until(()=>played.length===1);assert.equal(v.audio.context.sources.length,0);assert.equal(v.ended,0);assert.equal(played[0].clip,item(1).key);assert.equal(played[0].options.preparedOnly,true);assert.equal(played[0].options.preparedFingerprint,h.audio.fingerprint);assert.equal(played[0].duration,1000);gate.resolve();await pending;assert.equal(v.ended,1);assert.deepEqual(v.errors,[]);
});

test('unprepared fixed speech fails before a hot request, while explicit dynamic manual speech may fetch its new fragment',async t=>{
 const h=fixture(t,{items:[item(1)]});await h.audio.prepare();let requested=0;const v=playback(h,{fetcher:async()=>{requested++;return responseFor(item(8));}});t.after(()=>v.voice.stop());await v.voice.speak('Onbekende vaste tekst',1,{characterId:'milo',gameId:h.state.gameId,preparedOnly:true});assert.equal(requested,0);assert.equal(v.errors.length,1);assert.match(v.errors[0],/nog niet ingeladen/);assert.equal(v.ended,0);
 await v.voice.speak('Dit is een nieuwe handmatige mededeling.',1,{characterId:'milo',gameId:h.state.gameId});assert.equal(requested,1);assert.equal(v.audio.context.sources.length,1);assert.equal(v.starts.at(-1).text,'Dit is een nieuwe handmatige mededeling.');v.audio.context.sources[0].onended();await flush();assert.equal(v.ended,1);
});

for(const output of ['local','OBS'])test(`all 10,000 characters play from prepared chunks through ${output} with no hot fetches and one final completion`,async t=>{
 const script=Array.from({length:25},(_,i)=>String(i).padStart(3,'0')+'x'.repeat(397)).join(''),chunks=splitSpeechText(script),h=fixture(t,{items:chunks.map((text,i)=>item(i+1,text))});await h.audio.prepare();assert.equal(h.requests.length,25);let resolvePart;const remoteParts=[];
 const remote=output==='OBS'?{play(clip,text,duration,onStart,options){remoteParts.push({clip,text,options});onStart();return new Promise(resolve=>{resolvePart=resolve;});},stop(){resolvePart?.();},pause(){},resume(){},getElapsed:()=>0}:null,v=playback(h,{remote});t.after(()=>v.voice.stop());const pending=v.voice.speak(script,1,{characterId:'milo',gameId:h.state.gameId,preparedOnly:true});
 for(let index=0;index<chunks.length;index++){await until(()=>output==='OBS'?remoteParts.length===index+1:v.audio.context.sources.length===index+1);assert.equal(v.audio.context.decodes.length,index+1,'only the current fragment is decoded');assert.equal(v.ended,0);if(remote){assert.equal(v.audio.context.sources.length,0);assert.equal(remoteParts[index].options.preparedFingerprint,h.audio.fingerprint);resolvePart();}else v.audio.context.sources[index].onended();await flush();}
 await pending;assert.equal(v.ended,1);assert.equal(v.starts.map(entry=>entry.text).join(''),script);assert.equal(h.requests.length,25);assert.deepEqual(v.errors,[]);
});

test('stopping prepared playback cancels its remaining queue and ignores an old completion callback',async t=>{
 const script='a'.repeat(400)+'b'.repeat(400),h=fixture(t,{items:splitSpeechText(script).map((text,i)=>item(i+1,text))});await h.audio.prepare();const v=playback(h);t.after(()=>v.voice.stop());await v.voice.speak(script,1,{characterId:'milo',preparedOnly:true});const oldEnd=v.audio.context.sources[0].onended;v.voice.stop();oldEnd();await flush();assert.equal(v.audio.context.sources.length,1);assert.equal(v.audio.context.decodes.length,1);assert.equal(v.ended,0);assert.equal(v.voice.phase,'idle');assert.deepEqual(v.errors,[]);
});
