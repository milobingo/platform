import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSqliteDatabase} from '../server/node-storage.js';
import {makeGame} from '../server/bingo-model.js';
import {BingoStore} from '../server/bingo-store.js';
import {callRoomToken} from '../server/livekit.js';
import {playerGame} from '../server/bingo-model.js';
import {fixture as callFixture} from '../scripts/live-calls-fixture.mjs';
import {dispatchNodeRequest} from '../server/node-runtime.js';
import {handleProgramBroadcast,handleProgramHls,PROGRAM_PROFILE,PROGRAM_TRACK_NAMES,programHlsCapability,verifyProgramHlsCapability,rewriteProgramPlaylist,validateBroadcastConfiguration,broadcastConfiguration} from '../server/program-broadcast.js';

const origin='https://broadcast.example.test';
const claims=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
async function fixture(t){
 const db=createSqliteDatabase(':memory:');t.after(()=>db.close());
 const store=new BingoStore(db),game=makeGame({brandId:'milo',title:'Eigen uitzending',date:'2027-12-05T19:00:00Z'},'host',origin);
 game.books=[{id:'test-book',accountId:'family',profileId:'child',admitted:true,name:'Fictieve speler',cards:[]}];
 await store.create(game);
 const root=await mkdtemp(join(tmpdir(),'milo-programme-'));
 const configuration={version:1,enabled:true,url:'wss://media.example.test',apiKey:'PROGRAMME_API_KEY',apiSecret:'private-programme-secret-only-for-test-12345',hls:{root,egressRoot:'/out',signingSecret:'01'.repeat(32),tokenSeconds:14400}};
 const env={DB:db,PROGRAM_BROADCAST_CONFIGURATION:configuration},upstream=[],ingresses=[],egresses=[];let participants=[],delay=null,fail=null;
 const read=async()=>(await store.game(game.id)).data;
 const fetcher=async(url,options)=>{
  const method=url.split('/').at(-1),body=JSON.parse(options.body);upstream.push({method,body,grants:claims(options.headers.Authorization.slice(7))});
  if(delay)await delay(method);if(fail?.(method))throw Error('Injected network timeout');
  if(method==='ListIngress')return Response.json({items:ingresses});
  if(method==='CreateIngress'){const entry={ingress_id:'IN_test',url:'https://ingress.example.test/whip',stream_key:'test-whip-bearer-private',...body};ingresses.push(entry);return Response.json(entry);}
  if(method==='ListParticipants')return Response.json({participants});
  if(method==='ListEgress')return Response.json({items:egresses.filter(entry=>entry.status==='EGRESS_ACTIVE')});
  if(method==='StartEgress'){const entry={egress_id:'EG_test_'+egresses.length,status:'EGRESS_ACTIVE',...body};egresses.push(entry);return Response.json(entry);}
  if(method==='StopEgress'){const entry=egresses.find(entry=>entry.egress_id===body.egress_id);if(entry)entry.status='EGRESS_COMPLETE';return Response.json(entry||{});}
  return Response.json({});
 };
 const invoke=async(action='status',body={},identity={user:'host',admin:true},headers={})=>{
  const method=action==='status'?'GET':'POST',request=new Request(origin+'/api/broadcast/'+game.id+'/'+action,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Milo-Broadcast':'1',...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})});
  const response=await handleProgramBroadcast(request,{...env,AUTH_IDENTITY:identity},fetcher);return {status:response.status,data:await response.json()};
 };
 const control=(action,requestId=crypto.randomUUID())=>invoke('control',{action,requestId});
 const prepare=()=>control('prepare');
 const ready=()=>{participants=[{identity:'programme-'+game.id,tracks:[{sid:'TR_video',type:'VIDEO',name:PROGRAM_TRACK_NAMES.video},{sid:'TR_audio',type:'AUDIO',name:PROGRAM_TRACK_NAMES.audio}]}];};
 const manifest=async()=>{const current=await read(),directory=join(root,game.id,current.programBroadcast.generation);await mkdir(directory,{recursive:true});await writeFile(join(directory,'live.m3u8'),'#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:2.0,\nsegment_7.ts\n');await writeFile(join(directory,'segment_7.ts'),Buffer.from('representative-media-bytes'));return directory;};
 return {db,store,game,env,configuration,upstream,ingresses,egresses,read,invoke,control,prepare,ready,manifest,setDelay:value=>delay=value,setFailure:value=>fail=value,setParticipants:value=>participants=value};
}

test('broadcast remains disabled without an explicitly configured and prepared Milo programme',async t=>{
 const h=await fixture(t),before=await h.read(),status=await h.invoke();assert.equal(status.status,200);assert.equal(status.data.providerConfigured,true);assert.equal(status.data.enabled,false);assert.equal(h.upstream.length,0);assert.deepEqual(await h.read(),before);
 assert.equal(await broadcastConfiguration({}),null);assert.equal(validateBroadcastConfiguration({version:1,enabled:false}),null);
 for(const url of ['ws://example.test','wss://127.0.0.1','https://media.example.test','wss://user:secret@media.example.test','wss://media.example.test/path','wss://media.example.test?token=secret'])assert.throws(()=>validateBroadcastConfiguration({...h.configuration,url}));
 assert.equal((await h.invoke('token',{},null)).status,401);assert.equal((await h.invoke('token',{}, {user:'stranger',admin:false})).status,403);assert.equal((await h.invoke('control',{action:'prepare',requestId:crypto.randomUUID()},{user:'family',admin:false})).status,403);
 await h.store.mutate(h.game.id,{},g=>{g.brandId='vlampie';});assert.equal((await h.invoke()).data.enabled,false);assert.equal((await h.prepare()).status,503);assert.equal(h.upstream.length,0,'Vlampies existing call/YouTube environment must remain untouched');
});
test('viewer admission and CSRF fail closed; grants cannot publish data, media or join backstage',async t=>{
 const h=await fixture(t);await h.prepare();const result=await h.invoke('token',{}, {user:'family',admin:false});assert.equal(result.status,200);const token=claims(result.data.token);
 assert.equal(token.video.room,'programme-'+h.game.id);assert.equal(token.video.roomJoin,true);assert.equal(token.video.canSubscribe,true);assert.equal(token.video.canPublish,false);assert.equal(token.video.canPublishData,false);assert.equal(token.video.canUpdateOwnMetadata,false);assert.deepEqual(token.video.canPublishSources,[]);assert.equal(token.exp-token.iat,120);assert(!token.sub.includes('family'));assert.deepEqual(result.data.programTrackNames,PROGRAM_TRACK_NAMES);
 assert.equal((await h.invoke('token',{}, {user:'other-regie',admin:true})).status,403);
 assert.equal((await h.invoke('token',{}, {user:'family',admin:false},{Origin:'https://evil.test'})).status,403);
 assert.equal((await h.invoke('token',{}, {user:'family',admin:false},{'X-Milo-Broadcast':'0'})).status,403);
 await h.store.mutate(h.game.id,{},g=>{g.books[0].revokedAt=Date.now();});assert.equal((await h.invoke('token',{}, {user:'family',admin:false})).status,403);
 await h.store.mutate(h.game.id,{},g=>{delete g.books[0].revokedAt;});await h.store.editFamily('family','',family=>{family.blockedGames[h.game.id]=true;});assert.equal((await h.invoke('token',{}, {user:'family',admin:false})).status,403);
 const privateCall=await callRoomToken({url:'wss://private.livekit.cloud',apiKey:'PRIVATE_API_KEY',apiSecret:'PRIVATE_EXISTING_SECRET'},{id:'call-test',muted:false},'host','backstage');assert.equal(claims(privateCall.token).video.room,'bs-call-test');assert.notEqual(result.data.url,privateCall.url);
});
test('prepare is durable, retries reuse one WHIP ingress and two tabs create no duplicate source',async t=>{
 const h=await fixture(t),before=await h.read();let release,entered;const waiting=new Promise(resolve=>entered=resolve);h.setDelay(async method=>{if(method==='CreateIngress'){entered();await new Promise(resolve=>release=resolve);}});
 const first=h.prepare();await waiting;assert.equal((await h.prepare()).status,409);release();const prepared=await first;assert.equal(prepared.status,200);assert.equal(prepared.data.whip.bearerToken,'test-whip-bearer-private');assert.equal(prepared.data.whip.url,'https://ingress.example.test/whip/test-whip-bearer-private');h.setDelay(null);
 assert.equal((await h.prepare()).status,200);assert.equal(h.upstream.filter(x=>x.method==='CreateIngress').length,1);assert.equal(h.ingresses[0].enable_transcoding,false);assert.equal(h.ingresses[0].room_name,'programme-'+h.game.id);assert.equal(h.ingresses[0].audio.name,PROGRAM_TRACK_NAMES.audio);
 const after=await h.read();for(const field of ['state','plan','settings','books','orders','results','rulesPublication'])assert.deepEqual(after[field],before[field],field+' is unaffected by broadcast preparation');assert(!JSON.stringify(after).includes('test-whip-bearer-private'));assert(!JSON.stringify(await h.invoke()).includes(h.configuration.apiSecret));
});
test('one HLS encoder uses only the programme publisher AV, survives refresh, and has explicit stop paths',async t=>{
 const h=await fixture(t);await h.prepare();assert.equal((await h.control('start-hls')).status,409);assert.equal((await h.read()).programBroadcast.control,undefined,'waiting for OBS has no uncertain encoder side effect and can be retried immediately');h.ready();const before=await h.read();const started=await h.control('start-hls');assert.equal(started.status,200);assert.equal((await h.control('start-hls')).status,200);assert.equal(h.upstream.filter(x=>x.method==='StartEgress').length,1);
 const request=h.egresses[0];assert.equal(request.media.video_track_id,'TR_video');assert.equal(request.media.audio.routes[0].track_id,'TR_audio');assert.equal(request.advanced.video_bitrate+request.advanced.audio_bitrate,1250);assert.equal(request.outputs[0].segments.segment_duration,2);assert.equal(PROGRAM_PROFILE.totalBitrate,1250000);assert(request.outputs[0].segments.filename_prefix.startsWith('/out/'+h.game.id+'/'));
 assert.equal((await h.invoke('cast',{}, {user:'family',admin:false})).status,409,'an API start acknowledgement is not a playable playlist');await h.manifest();assert.equal((await h.invoke('cast',{}, {user:'family',admin:false})).status,200);
 const firstGeneration=(await h.read()).programBroadcast.generation;h.egresses[0].status='EGRESS_COMPLETE';assert.equal((await h.control('start-hls')).status,200);assert.notEqual((await h.read()).programBroadcast.generation,firstGeneration,'a replacement encoder cannot reuse cached segment names after a restart');
 assert.equal((await h.control('stop-hls')).status,200);assert.equal(h.egresses.at(-1).status,'EGRESS_COMPLETE');assert.equal((await h.read()).programBroadcast.enabled,true);assert.equal((await h.read()).programBroadcast.egressId,null);assert.equal((await h.invoke('token',{}, {user:'family',admin:false})).status,200,'stopping tv leaves direct WebRTC enabled');
 assert.equal((await h.control('stop')).status,200);assert.equal((await h.read()).programBroadcast.enabled,true);assert.equal((await h.read()).programBroadcast.status,'stopped');assert.equal((await h.invoke('token',{}, {user:'family',admin:false})).status,409);assert.deepEqual((await h.read()).state,before.state,'stop cannot release a call hold or alter a draw clock');
});
test('captured native WHIP provider names reach viewer status/tokens and select only the reserved publisher for HLS',async t=>{
 const h=await fixture(t);await h.prepare();
 // Shape observed on real LiveKit 1.13.11 + Ingress 1.6.0 WHIP bypass.
 // Names are literal provider evidence, independent of PROGRAM_TRACK_NAMES.
 const nativeTracks=[{sid:'TR_native_video',type:'VIDEO',name:'synthesized-camera',source:'CAMERA',mime_type:'video/H264',muted:false,width:0,height:0},{sid:'TR_native_audio',type:'AUDIO',name:'synthesized-microphone',source:'MICROPHONE',mime_type:'audio/opus',muted:false}];
 h.setParticipants([{identity:'private-backstage-host',tracks:nativeTracks.map(track=>({...track,sid:'TR_private_'+track.type}))},{identity:'programme-'+h.game.id,tracks:nativeTracks}]);
 const state=await h.invoke();assert.equal(state.data.state,'live');assert.deepEqual(state.data.programTrackNames,{video:'synthesized-camera',audio:'synthesized-microphone'});
 const viewer=await h.invoke('token',{}, {user:'family',admin:false});assert.equal(viewer.status,200);assert.deepEqual(viewer.data.programTrackNames,state.data.programTrackNames);assert.equal(viewer.data.publisherIdentity,'programme-'+h.game.id);
 assert.equal(h.ingresses[0].video.name,'synthesized-camera');assert.equal(h.ingresses[0].audio.name,'synthesized-microphone');assert.equal(h.ingresses[0].enable_transcoding,false);
 assert.equal((await h.control('start-hls')).status,200);assert.equal(h.egresses[0].media.video_track_id,'TR_native_video');assert.equal(h.egresses[0].media.audio.routes[0].track_id,'TR_native_audio');assert.equal(h.egresses[0].media.audio.capture_all,false);
});
test('a provider timeout retains a bounded durable lease and a deliberate later retry reconciles instead of creating again',async t=>{
 const h=await fixture(t);h.setFailure(method=>method==='CreateIngress');assert.equal((await h.prepare()).status,503);assert.equal((await h.prepare()).status,409);assert((await h.read()).programBroadcast.control.until>Date.now());
 h.setFailure(null);h.ingresses.push({ingress_id:'IN_created-before-disconnect',name:'milo-programme-'+h.game.id,participant_identity:'programme-'+h.game.id,url:'https://ingress.example.test/whip',stream_key:'recovered-private-bearer'});
 await h.store.mutate(h.game.id,{},g=>{g.programBroadcast.control.until=Date.now()-1;});assert.equal((await h.prepare()).status,200);assert.equal(h.upstream.filter(x=>x.method==='CreateIngress').length,1,'one failed response does not create a second ingress');
});
test('HLS capability protects playlist and segments without session cookies, with CORS and no public raw path',async t=>{
 const h=await fixture(t);await h.prepare();h.ready();await h.control('start-hls');await h.manifest();const cast=await h.invoke('cast',{}, {user:'family',admin:false}),url=cast.data.url;
 const playlist=await dispatchNodeRequest(new Request(url),{env:h.env});assert.equal(playlist.status,200);assert.equal(playlist.headers.get('access-control-allow-origin'),origin);assert(playlist.headers.get('cache-control').includes('no-store'));const raw=await playlist.text();assert(raw.includes(origin+'/api/broadcast/hls/'));assert(!raw.includes('/out/'));assert(!raw.includes(h.configuration.hls.signingSecret));
 const segmentUrl=raw.split('\n').find(line=>line.startsWith('https://'));const segment=await handleProgramHls(new Request(segmentUrl),h.env);assert.equal(segment.status,200);assert.equal(await segment.text(),'representative-media-bytes');
 const noCookieHead=await handleProgramHls(new Request(segmentUrl,{method:'HEAD'}),h.env);assert.equal(noCookieHead.status,200);assert.equal(await noCookieHead.text(),'');
 const preflight=await dispatchNodeRequest(new Request(url,{method:'OPTIONS',headers:{Origin:'https://www.gstatic.com'}}),{env:h.env});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'https://www.gstatic.com');
 assert.equal((await handleProgramHls(new Request(url.replace(/hls\/./,'hls/x')),h.env)).status,401);
 assert.equal((await handleProgramHls(new Request(url.replace('live.m3u8','private.json')),h.env)).status,404);
 assert.equal((await handleProgramHls(new Request(url,{headers:{Origin:'https://evil.example.test'}}),h.env)).status,403);
 const claims=verifyProgramHlsCapability(validateBroadcastConfiguration(h.configuration),url.split('/').at(-2));assert.equal(claims.g,h.game.id);assert.throws(()=>verifyProgramHlsCapability(validateBroadcastConfiguration(h.configuration),url.split('/').at(-2),cast.data.expiresAt+1));
 await h.control('stop-hls');assert.equal((await handleProgramHls(new Request(url),h.env)).status,410,'stopping invalidates every previously issued playlist/segment capability');
});
test('playlist URI injection and symlink media cannot escape the isolated show directory',async t=>{
 for(const text of ['#EXTM3U\nhttps://evil.test/segment_1.ts\n','#EXTM3U\n../secret.ts\n','#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="file:///private"\n','#EXTM3U\nsegment_1.ts?key=secret\n'])assert.throws(()=>rewriteProgramPlaylist(text,origin+'/api/broadcast/hls/cap/'));
 const h=await fixture(t);await h.prepare();const directory=await h.manifest(),game=await h.read(),cap=programHlsCapability(validateBroadcastConfiguration(h.configuration),game);await writeFile(join(h.configuration.hls.root,'outside-secret'),'PRIVATE');await symlink(join(h.configuration.hls.root,'outside-secret'),join(directory,'segment_escape.ts'));const response=await handleProgramHls(new Request(origin+'/api/broadcast/hls/'+cap.capability+'/segment_escape.ts'),h.env);assert.notEqual(response.status,200);assert(!await response.text().then(text=>text.includes('PRIVATE')));assert.equal(await readFile(join(h.configuration.hls.root,'outside-secret'),'utf8'),'PRIVATE');
});
test('family projection contains only selected source status and programme callers confirm the immutable heard checkpoint',async t=>{
 const h=await fixture(t);await h.prepare();const game=await h.read(),view=playerGame(game,'family');assert.deepEqual(view.programBroadcast,{enabled:true,state:'prepared'});assert(!JSON.stringify(view).includes('ingressId'));assert(!JSON.stringify(view).includes(h.configuration.apiKey));
 const calls=await callFixture(t);await calls.bingo.mutate(calls.game.id,{},g=>{g.programBroadcast={version:1,enabled:true,status:'prepared',generation:'01'.repeat(16)};});await calls.prepare();await calls.step('host','ring');const call=await calls.current(),checkpoint={checkpointId:call.checkpoint.id,heardLastNumber:call.checkpoint.lastNumber,cardsUpdated:true,programmeSilenced:true};
 for(const missing of ['heardLastNumber','cardsUpdated','programmeSilenced']){const body={...checkpoint};delete body[missing];await calls.step('player','answer',body,409);assert.equal((await calls.current()).phase,'ringing');}
 await calls.step('player','answer',{...checkpoint,heardLastNumber:12},409);await calls.step('player','answer',checkpoint);assert.equal((await calls.current()).phase,'backstage');assert((await calls.bingo.game(calls.game.id)).data.state.drawHold,'answer cannot release the shared draw hold');
});
