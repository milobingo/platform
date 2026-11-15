import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStorageEnvironment} from '../server/node-storage.js';
import {dispatchNodeRequest} from '../server/node-runtime.js';
import {BingoStore} from '../server/bingo-store.js';
import {makeGame,forceCancelGame} from '../server/bingo-model.js';
import {CharacterSettingsStore} from '../server/character-settings.js';
import {CHARACTERS,characterLiveInstructions} from '../server/characters.js';
import {buildShowAudioManifest,showAudioScripts,showCallPresenters} from '../server/show-audio-manifest.js';
import {voicePath,characterVoiceKey,waveDurationMs} from '../server/voice-cache.js';
import {synthesizeLiveScript,normalizedScript} from '../server/gpt-live.js';
import {fakeLiveSocket} from '../scripts/gpt-live-fixture.mjs';
import {splitSpeechText} from '../public/speech-text.js';
import {bingoNumberText,dutchNumber,SPEECH_POLICY_VERSION,MILO_BANTER,NUMBER_NINE_AUDIENCE,roundSpeech,prizeSpeech} from '../public/bingo-speech.js';
import {premierePlan} from '../server/premiere-plan.js';
import {LIVE_CALL_LINES} from '../public/live-call-script.js';

const origin='https://studio.example',noProvider=()=>assert.fail('A read-only/cache-only route contacted a provider');
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'milo-show-audio-')),storage=await createStorageEnvironment({SQLITE_PATH:join(root,'app.sqlite'),OBJECT_STORAGE_PATH:join(root,'objects')});t.after(async()=>{await storage.close();await rm(root,{recursive:true,force:true});});
 const user={id:crypto.randomUUID(),email:'regie@example.test'},env={...storage,NODE_ENV:'production',APP_URL:origin,SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',VLAMPIE_SETTINGS_KEY:'01'.repeat(32),OPENAI_API_KEY:'test-show-audio-no-network'};
 await env.DB.prepare('INSERT INTO app_user_roles(user_id,role) VALUES (?,?)').bind(user.id,'regie').run();
 const store=new BingoStore(env.DB),game=makeGame({brandId:'milo',title:'Nederlandse stemmen',date:'2026-12-05T18:00:00Z'},user.id,origin);await store.create(game);
 const invoke=async(path,body,{status=200,providerFetch=noProvider,token,providerUser=user,headers={}}={})=>{
  const response=await dispatchNodeRequest(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Milo-OBS-Manage':'1','X-Vlampie-Output':'1',...(token?{'X-Milo-OBS-Token':token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),{env,providerFetch,authClientFactory:()=>({auth:{getUser:async()=>({data:{user:providerUser},error:null})}})});
  const bytes=new Uint8Array(await response.arrayBuffer()),isAudio=(response.headers.get('content-type')||'').startsWith('audio/'),data=isAudio?null:JSON.parse(new TextDecoder().decode(bytes));assert.equal(response.status,status,JSON.stringify(data));return {response,bytes,data};
 };
 const manifest=()=>buildShowAudioManifest(env,user.id,game.id);
 const seed=async item=>{const audio=await synthesizeLiveScript('test-only-key',CHARACTERS[item.characterId],item.text,new Request(origin),async()=>fakeLiveSocket({text:item.text}));await env.SETTINGS.put(voicePath(user.id,item.key),audio,{httpMetadata:{contentType:'audio/wav'},customMetadata:{policyVersion:SPEECH_POLICY_VERSION,scriptVerified:'true',durationMs:String(waveDurationMs(audio))}});};
 const access=async()=>(await invoke('/api/obs/access',{action:'create',gameId:game.id,expectedAccessId:null})).data.token;
 return {env,user,store,game,invoke,manifest,seed,access};
}

test('all 75 official scripts use the fixed BINGO names and Dutch words; Vlampie retains its existing script',()=>{
 const scripts=Array.from({length:75},(_,i)=>bingoNumberText(i+1));assert.equal(new Set(scripts).size,75);
 for(let n=1;n<=75;n++){assert(scripts[n-1].startsWith(['Bernhard','Izaak','Nico','Gerard','Otto'][Math.floor((n-1)/15)]+' '));assert(!/\d/.test(scripts[n-1]));assert.equal(bingoNumberText(n,'vlampie'),`Nummer ${n}. ${n}!`);}
 assert.equal(bingoNumberText(15),'Bernhard vijftien!');assert.equal(bingoNumberText(16),'Izaak zestien!');assert.equal(bingoNumberText(22),'Izaak tweeëntwintig!');assert.equal(dutchNumber(72),'tweeënzeventig');
 assert.equal(normalizedScript('Nico zevenendertig!'),normalizedScript('Nico 37!'));assert.notEqual(normalizedScript('Nico thirty-seven!'),normalizedScript('Nico 37!'));
 for(const n of [0,76,-1,1.5,'9'])assert.throws(()=>bingoNumberText(n));
 assert.match(characterLiveInstructions(CHARACTERS.milo,{scripted:true}),/uitsluitend natuurlijk Nederlands/);assert.match(characterLiveInstructions(CHARACTERS.milo,{scripted:true}),/enthousiasme/);
});

test('the show manifest covers every runner goal, prize, long block, guest turn, fixed number and optional cue with exact chunk identities',async t=>{
 const h=await fixture(t),long=('Magische sterren fonkelen boven de zaal. ').repeat(40);
 await h.store.mutate(h.game.id,{},g=>{g.plan.blocks.splice(1,0,{id:'long-story',type:'story',speakerId:'milo',text:long},{id:'guest-turns',type:'guest',speakerId:'milo',text:'Welkom, Kora!',dialogue:[{speakerId:'kora',text:'Ahoy, lieve vrienden!'},{speakerId:'milo',text:'Wat gezellig dat je er bent!'}]});});
 const manifest=await h.manifest(),game=(await h.store.game(h.game.id)).data,scripts=showAudioScripts(game);assert.equal(manifest.ready,0);assert.equal(manifest.complete,false);assert.equal(manifest.items.filter(item=>item.kind==='number').length,75);
 assert.deepEqual(scripts.filter(item=>item.id==='long-story').map(item=>item.text),splitSpeechText(long).map(text=>text.trim()));assert(manifest.items.some(item=>item.characterId==='kora'&&item.text==='Ahoy, lieve vrienden!'));
 for(const round of game.plan.blocks.filter(block=>block.type==='round'))for(const goal of round.goals){const pattern=game.plan.patterns.find(item=>item.id===goal.patternId),prize=game.plan.prizes.find(item=>item.id===goal.prizeId);assert(manifest.items.some(item=>item.text===roundSpeech(round.title,pattern.title)));assert(manifest.items.some(item=>item.text===prizeSpeech(prize.title)));}
 for(const cue of [...MILO_BANTER,NUMBER_NINE_AUDIENCE])assert(manifest.items.some(item=>item.text===cue.text));
 assert.equal(new Set(manifest.items.map(item=>item.key)).size,manifest.total);assert(manifest.items.every(item=>Array.from(item.text).length<=400));
});

test('all premiere manual speaking cards are prepared but private operator directions and condition labels are never speech',async t=>{
 const h=await fixture(t),plan=premierePlan();assert.equal(plan.manualCues.length,20);
 const privateNote='VERTROUWELIJK: controleer eerst de officiële serveruitslag.',conditionTitle='ALLEEN BIJ BEVESTIGDE WINNAAR';
 for(const block of plan.blocks)block.operatorNotes=privateNote;
 for(const cue of plan.manualCues){cue.notes=privateNote;cue.conditionLabel=conditionTitle;}
 // Force a multi-part speaking card: every character of its text belongs in
 // the bank, while technical directions must remain exclusively with regie.
 plan.manualCues[0].text='Dit is een lange voorbereide spreekkaart. '.repeat(24);
 await h.store.mutate(h.game.id,{},game=>{game.plan=plan;});
 const manifest=await h.manifest(),saved=(await h.store.game(h.game.id)).data,scripts=showAudioScripts(saved);
 for(const cue of plan.manualCues){
  const expected=splitSpeechText(cue.text).map(part=>part.trim()),actual=scripts.filter(item=>item.kind==='manual'&&item.id===cue.id);
  assert.deepEqual(actual.map(item=>item.text),expected);assert(actual.every(item=>item.characterId===cue.speakerId));
  for(const [index,text]of expected.entries())assert(manifest.items.some(item=>item.text===text&&item.sources.some(source=>source.kind==='manual'&&source.id===cue.id&&source.chunkIndex===index)));
 }
 assert(!scripts.some(item=>item.text.includes(privateNote)||item.text.includes(conditionTitle)));
 assert(!manifest.items.some(item=>item.text.includes(privateNote)||item.text.includes(conditionTitle)));
 assert.equal(new Set(manifest.items.map(item=>item.key)).size,manifest.total);
});

test('call preparation includes only actual cast and explicitly chosen presenters, retaining them after cue completion',async t=>{
 const h=await fixture(t),before=await h.manifest(),saved=(await h.store.game(h.game.id)).data;
 assert.deepEqual(showCallPresenters(saved),['milo']);
 assert.equal(before.items.filter(item=>item.kind==='live-call').length,Object.keys(LIVE_CALL_LINES).length);
 assert(!before.items.some(item=>item.kind==='live-call'&&item.characterId==='bruno'));
 await h.store.mutate(h.game.id,{},game=>{
  game.plan.cohostId='stella';game.plan.blocks.push({id:'guest-cast',type:'guest',speakerId:'otto',text:'Welkom, Kora!',dialogue:[{speakerId:'kora',text:'Ahoy allemaal!'}]});
  game.plan.manualCues=[{id:'cue-cast',speakerId:'coco',text:'Wat een gezellige show!'}];
  game.callCues=[{id:'manual-cast',source:'manual',status:'pending',characterId:'bella'},{id:'closed-cast',source:'manual',status:'completed',characterId:'bruno'},{id:'ignored-cast',source:'manual',status:'pending',characterId:'unknown'}];
 });
 const after=await h.manifest(),changed=(await h.store.game(h.game.id)).data;
 assert.deepEqual(showCallPresenters(changed),['milo','stella','otto','kora','coco','bella','bruno']);
 for(const characterId of showCallPresenters(changed))for(const text of Object.values(LIVE_CALL_LINES))assert(after.items.some(item=>item.characterId===characterId&&item.text===text));
 for(const item of before.items.filter(item=>item.kind==='live-call'))assert(after.items.some(next=>next.key===item.key),'adding another presenter retains previously generated clip keys');
 assert.notEqual(after.fingerprint,before.fingerprint);assert(!after.items.some(item=>item.kind==='live-call'&&item.characterId==='unknown'));
 await h.store.mutate(h.game.id,{},game=>{game.callCues.find(cue=>cue.id==='manual-cast').status='completed';});
 assert.equal((await h.manifest()).fingerprint,after.fingerprint,'closing a selected call must retain the same prepared bank');
});

test('an explanation prepares the individual visible pattern steps instead of repeating the combined block text',async t=>{
 const h=await fixture(t),steps=[{patternId:'patroon-hoeken',text:'Eerst spelen we voor de vier hoekjes.'},{patternId:'patroon-boven-onder',text:'Daarna de bovenste én onderste rij. '.repeat(20)},{patternId:'patroon-vol',text:'Tot slot de volle kaart, met het vrije middenvak.'}],combined='Dit is de gecombineerde bewerktekst en mag niet extra worden uitgesproken.',privateNote='Alleen regie: wissel het patroon na elke zin.';
 await h.store.mutate(h.game.id,{},game=>{game.plan.blocks.splice(2,0,{id:'pattern-explanation',type:'explanation',speakerId:'milo',text:combined,operatorNotes:privateNote,explanationSteps:steps.map(step=>({...step,notes:privateNote}))});});
 const manifest=await h.manifest(),scripts=showAudioScripts((await h.store.game(h.game.id)).data);
 for(const[index,step]of steps.entries()){
  const id='pattern-explanation-'+index,expected=splitSpeechText(step.text).map(part=>part.trim());assert.deepEqual(scripts.filter(item=>item.id===id).map(item=>item.text),expected);
  for(const[chunkIndex,text]of expected.entries())assert(manifest.items.some(item=>item.text===text&&item.sources.some(source=>source.id===id&&source.kind==='explanation'&&source.chunkIndex===chunkIndex)));
 }
 assert(!scripts.some(item=>item.text===combined||item.text.includes(privateNote)));assert(!manifest.items.some(item=>item.text===combined||item.text.includes(privateNote)));
});

test('preparation validates all 75 number transcripts before cached readiness and excludes unverified old metadata',async t=>{
 const h=await fixture(t),before=await h.manifest();
 for(const item of before.items)await h.seed(item);
 const prepared=await h.manifest();assert.equal(prepared.complete,true);assert.equal(prepared.ready,prepared.total);assert.equal(prepared.items.filter(item=>item.kind==='number'&&item.ready&&item.durationMs>0).length,75);
 const item=prepared.items.find(item=>item.kind==='number');await h.env.SETTINGS.put(voicePath(h.user.id,item.key),new Uint8Array([1,2]),{customMetadata:{policyVersion:'old-policy',scriptVerified:'true'}});
 const invalidated=await h.manifest();assert.equal(invalidated.complete,false);assert.equal(invalidated.ready,prepared.total-1);
});

test('cache-only hits and misses use no key/provider; stale bindings cannot generate and actual preparation stores verified WAV duration',async t=>{
 const h=await fixture(t),manifest=await h.manifest(),item=manifest.items.find(item=>item.id==='ball-15'),body={gameId:h.game.id,characterId:item.characterId,speed:item.speed,text:item.text,expectedKey:item.key,cacheOnly:true};
 await h.invoke('/api/openai/speech',body,{status:409});await h.invoke('/api/openai/speech',{...body,expectedKey:'a'.repeat(64)},{status:409});
 let requests=0;const prepared=await h.invoke('/api/openai/speech',{...body,cacheOnly:false},{providerFetch:async()=>{requests++;return fakeLiveSocket({text:item.text});}});assert.equal(requests,1);assert(waveDurationMs(prepared.bytes)>0);assert.equal(prepared.response.headers.get('x-vlampie-clip'),item.key);
 h.env.OPENAI_API_KEY='';const cached=await h.invoke('/api/openai/speech',body);assert.equal(cached.response.headers.get('x-vlampie-cached'),'1');assert.equal(cached.response.headers.get('x-milo-speech-policy'),SPEECH_POLICY_VERSION);assert(Number(cached.response.headers.get('x-milo-audio-duration-ms'))>0);
 await new CharacterSettingsStore(h.env.DB).save(h.user.id,'milo',{...CHARACTERS.milo,style:'Nog levendiger en duidelijk Nederlands.'},0);await h.invoke('/api/openai/speech',body,{status:409});assert.notEqual((await h.manifest()).fingerprint,manifest.fingerprint);
});

test('manifest fingerprints change with actual plan and speaker settings while gameplay revisions leave them stable',async t=>{
 const h=await fixture(t),before=await h.manifest();await h.store.mutate(h.game.id,{},g=>{g.state.drawn=[1,2,3];});assert.equal((await h.manifest()).fingerprint,before.fingerprint);
 await h.store.mutate(h.game.id,{},g=>{g.plan.blocks.find(block=>block.type==='welcome').text='Een nieuwe Nederlandse begroeting.';});const edited=await h.manifest();assert.notEqual(edited.fingerprint,before.fingerprint);
 await new CharacterSettingsStore(h.env.DB).save(h.user.id,'milo',{...CHARACTERS.milo,speed:1.1,customVoiceId:'voice_manifest_test'},0);assert.notEqual((await h.manifest()).fingerprint,edited.fingerprint);assert.notEqual(await characterVoiceKey(h.user.id,CHARACTERS.milo,1,'Hallo!'),await characterVoiceKey(h.user.id,{...CHARACTERS.milo,persona:'Een ander opgeslagen karakterboek.'},1,'Hallo!'));
});

test('manifest ownership, verified regie and exact origin protect preparation without provider requests',async t=>{
 const h=await fixture(t),body={gameId:h.game.id};await h.invoke('/api/openai/show-audio',body,{providerUser:null,status:401});await h.invoke('/api/openai/show-audio',body,{providerUser:{id:crypto.randomUUID(),email:'family@example.test'},status:403});await h.invoke('/api/openai/show-audio',body,{headers:{Origin:'https://other.example'},status:403});
 const other=makeGame({brandId:'milo',title:'Andere eigenaar',date:'2026-12-05T18:00:00Z'},crypto.randomUUID(),origin);await h.store.create(other);await h.invoke('/api/openai/show-audio',{gameId:other.id},{status:403});
 const own=await h.invoke('/api/openai/show-audio',body);assert.equal(own.data.gameId,h.game.id);assert.equal(own.data.policyVersion,SPEECH_POLICY_VERSION);
 const vlampie=makeGame({brandId:'vlampie',title:'Eigen Vlampie-show',date:'2026-12-05T18:00:00Z'},h.user.id,origin);await h.store.create(vlampie);const separate=await buildShowAudioManifest(h.env,h.user.id,vlampie.id);assert(separate.items.some(item=>item.id==='ball-15'&&item.text==='Nummer 15. 15!'));assert(!separate.items.some(item=>item.kind==='banter'));
});

test('a cached static response rechecks the character after the storage await and a late generation cannot mark a changed profile ready',async t=>{
 const h=await fixture(t),item=(await h.manifest()).items.find(item=>item.kind==='number');await h.seed(item);const get=h.env.SETTINGS.get.bind(h.env.SETTINGS);let tripped=false;
 h.env.SETTINGS.get=async key=>{const value=await get(key);if(key===voicePath(h.user.id,item.key)&&!tripped){tripped=true;await new CharacterSettingsStore(h.env.DB).save(h.user.id,'milo',{...CHARACTERS.milo,speed:1.1},0);}return value;};
 await h.invoke('/api/openai/speech',{gameId:h.game.id,characterId:item.characterId,speed:item.speed,text:item.text,expectedKey:item.key,cacheOnly:true},{status:409});assert(tripped);
 const fresh=await fixture(t),next=(await fresh.manifest()).items.find(item=>item.kind==='number');let requests=0;
 await fresh.invoke('/api/openai/speech',{gameId:fresh.game.id,characterId:next.characterId,speed:next.speed,text:next.text,expectedKey:next.key},{status:409,providerFetch:async()=>{requests++;await new CharacterSettingsStore(fresh.env.DB).save(fresh.user.id,'milo',{...CHARACTERS.milo,speed:1.1},0);return fakeLiveSocket({text:next.text});}});assert.equal(requests,1);assert.equal(await fresh.env.SETTINGS.head(voicePath(fresh.user.id,next.key)),null);
});

for(const change of ['revoke','profile','cancel'])test(`manifest metadata enumeration never returns an old authorized list after ${change}`,async t=>{
 const h=await fixture(t),token=await h.access(),head=h.env.SETTINGS.head.bind(h.env.SETTINGS);let tripped=false;
 h.env.SETTINGS.head=async key=>{const value=await head(key);if(!tripped){tripped=true;if(change==='revoke'){const row=await h.env.DB.prepare('SELECT revision,document FROM studio_outputs WHERE owner_id=?').bind(h.user.id).first(),state=JSON.parse(row.document);delete state.obsAccess;await h.env.DB.prepare('UPDATE studio_outputs SET revision=?,document=? WHERE owner_id=?').bind(row.revision+1,JSON.stringify(state),h.user.id).run();}else if(change==='profile')await new CharacterSettingsStore(h.env.DB).save(h.user.id,'milo',{...CHARACTERS.milo,speed:1.1},0);else await h.store.mutate(h.game.id,{},g=>{g.status='running';forceCancelGame(g,{by:h.user.id,reason:'Manifestannulering',requestId:'manifest-cancel',binding:'fixture'});});}return value;};
 const denied=await h.invoke('/api/obs/show-audio',undefined,{token,providerUser:null,status:change==='revoke'?401:409});assert(tripped);assert.equal(denied.data.items,undefined);
});

test('OBS preloads only the bound current manifest with no private scripts, arbitrary owner clips or provider authority',async t=>{
 const h=await fixture(t),token=await h.access(),manifest=await h.manifest(),item=manifest.items.find(item=>item.kind==='number');await h.seed(item);
 const scoped=await h.invoke('/api/obs/show-audio',undefined,{token,providerUser:null});assert.equal(scoped.data.fingerprint,manifest.fingerprint);assert(scoped.data.items.every(value=>!('text' in value)&&(!('characterId' in value)||value.callKey&&value.characterId!=='vlampie')));assert.equal(scoped.data.ready,1);
 await h.invoke('/api/obs/clips/'+item.key,undefined,{token,providerUser:null});await h.env.SETTINGS.put(voicePath(h.user.id,'a'.repeat(64)),new Uint8Array([1]));await h.invoke('/api/obs/clips/'+'a'.repeat(64),undefined,{token,providerUser:null,status:403});
 await h.invoke('/api/obs/show-audio',{gameId:h.game.id},{token,providerUser:null,status:403});await h.invoke('/api/openai/show-audio',{gameId:h.game.id},{token,providerUser:null,status:401});
});

for(const change of ['revoke','profile','cancel'])test(`an OBS preload delayed in object retrieval loses access after ${change}`,async t=>{
 const h=await fixture(t),token=await h.access(),item=(await h.manifest()).items.find(item=>item.kind==='number');await h.seed(item);const get=h.env.SETTINGS.get.bind(h.env.SETTINGS);let tripped=false;
 h.env.SETTINGS.get=async key=>{const object=await get(key);if(key===voicePath(h.user.id,item.key)&&!tripped){tripped=true;if(change==='revoke'){const row=await h.env.DB.prepare('SELECT revision,document FROM studio_outputs WHERE owner_id=?').bind(h.user.id).first(),state=JSON.parse(row.document);delete state.obsAccess;await h.env.DB.prepare('UPDATE studio_outputs SET revision=?,document=? WHERE owner_id=?').bind(row.revision+1,JSON.stringify(state),h.user.id).run();}else if(change==='profile')await new CharacterSettingsStore(h.env.DB).save(h.user.id,'milo',{...CHARACTERS.milo,speed:1.1},0);else await h.store.mutate(h.game.id,{},g=>{g.status='running';forceCancelGame(g,{by:h.user.id,reason:'Test annulering',requestId:'audio-cancel',binding:'fixture'});});}return object;};
 await h.invoke('/api/obs/clips/'+item.key,undefined,{token,providerUser:null,status:change==='revoke'?401:change==='cancel'?409:403});assert(tripped);
});
