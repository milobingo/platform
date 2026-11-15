import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Pool} from 'pg';
import {createSqliteDatabase,createPostgresDatabase} from '../server/node-storage.js';
import {BingoStore} from '../server/bingo-store.js';
import {handleBingo} from '../server/bingo.js';
import {makeGame,activateBlock,forceCancelGame} from '../server/bingo-model.js';
import {rulesContract} from '../server/game-rules.js';
import {broadcastSettings,normalizeYoutubeId} from '../server/broadcast-settings.js';
import {NUMBER_NINE_AUDIENCE,MILO_BANTER} from '../public/bingo-speech.js';

const origin='https://broadcast.example',video='ezsA3hsxIEc',other='dQw4w9WgXcQ';
async function fixture(t,{status='draft',paused=false,cancelled=false,postgres=false}={}){
 let db;
 if(postgres){
  const source=new URL(process.env.MILO_TEST_DATABASE_URL);assert(['localhost','127.0.0.1','[::1]'].includes(source.hostname)&&/test/i.test(source.pathname),'Broadcast integration requires an explicitly local test database');
  const admin=new Pool({connectionString:source.toString()}),schema='milo_broadcast_'+crypto.randomUUID().replaceAll('-','');
  t.after(async()=>{try{await db?.close();await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');}finally{await admin.end();}});
  await admin.query('CREATE SCHEMA '+schema);const client=await admin.connect();
  try{await client.query('SET search_path TO '+schema);for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort())await client.query((await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replaceAll('public.',schema+'.').replaceAll('SCHEMA public','SCHEMA '+schema));}finally{client.release();}
  source.searchParams.set('options','-c search_path='+schema);db=await createPostgresDatabase(source.toString(),{allowLoopback:true});
 }else{db=createSqliteDatabase(':memory:');t.after(()=>db.close());}
 const store=new BingoStore(db),game=makeGame({brandId:'milo',title:'Uitzending voorbereiden',date:'2027-12-05T19:00:00Z'},'host',origin);
 if(status==='running'){game.status='running';activateBlock(game,game.plan.blocks.findIndex(block=>block.type==='round'));game.state.drawn=[7,9];game.state.lastCommit={number:9,at:123};game.state.paused=paused;game.state.control={id:'fixture-regie',until:Date.now()+60000};}
 else game.status=status;
 if(cancelled){game.status='running';forceCancelGame(game,{by:'host',reason:'Test afgelopen show',requestId:'cancel-broadcast-test',binding:'fixture'},Date.now());}
 await store.create(game);
 const read=async()=>(await store.game(game.id)).data;
 const invoke=async(action='broadcast',body={},options={})=>{
  const method=options.method||'POST',headers={Origin:origin,'Content-Type':'application/json','X-Vlampie-Bingo':'1',...options.headers};
  const response=await handleBingo(new Request(origin+'/api/bingo/games/'+game.id+(action?'/'+action:''),{method,headers,...(method==='GET'?{}:{body:JSON.stringify({requestId:crypto.randomUUID(),regieId:'fixture-regie',...body})})}),{DB:db,AUTH_IDENTITY:options.identity===undefined?{user:'host',admin:true}:options.identity});
  return {status:response.status,data:await response.json()};
 };
 const save=(youtubeId=video,revision=0,options={})=>invoke('broadcast',{youtubeId,expectedBroadcastRevision:revision,...options.body},options);
 return {db,store,game,read,invoke,save};
}
test('public video IDs and supported YouTube URLs normalize without any provider request',()=>{
 for(const input of [video,' '+video+' ','https://www.youtube.com/watch?v='+video+'&t=12','https://youtu.be/'+video+'?si=abc','youtube.com/live/'+video,'www.youtube.com/embed/'+video,'https://www.youtube-nocookie.com/embed/'+video])assert.equal(normalizeYoutubeId(input),video);
 assert.equal(normalizeYoutubeId('  '),'');
 for(const input of ['https://youtube.com.evil.example/watch?v='+video,'https://evil.example/'+video,'https://user:password@youtube.com/watch?v='+video,'javascript:alert(1)','https://youtube.com/watch?v=invalid',null,{},'https://www'])assert.throws(()=>normalizeYoutubeId(input),error=>error.code==='youtube_invalid');
});
for(const state of [{status:'draft'},{status:'running'},{status:'running',paused:true}])test(`YouTube autosave accepts ${JSON.stringify(state)} independently of rules, timeline and preparation revision`,async t=>{
 const h=await fixture(t,state),before=await h.read(),saved=await h.save('https://youtu.be/'+video);assert.equal(saved.status,200,JSON.stringify(saved));
 assert.deepEqual(saved.data.broadcast,{youtubeId:video,revision:1});const after=await h.read();assert.equal(after.settings.youtubeId,video);assert.equal(after.broadcastRevision,1);assert.equal(after.preparationRevision,before.preparationRevision);
 for(const field of ['plan','state','production','books','orders','results','rulesPublication'])assert.deepEqual(after[field],before[field],field+' must not change');assert.deepEqual(rulesContract(after),rulesContract(before));
 const reloaded=await h.invoke('',{},{method:'GET'});assert.equal(reloaded.status,200);assert.equal(reloaded.data.game.settings.youtubeId,video);assert.equal(reloaded.data.game.broadcastRevision,1);
 if(state.status==='running'){const fullSave=await h.invoke('',{plan:before.plan,settings:{...before.settings,claimSeconds:60}},{method:'PUT'});assert.equal(fullSave.status,409);assert.equal(fullSave.data.error.code,'preparation_locked');}
});
test('terminal shows reject broadcast changes; role, ownership, origin, JSON and field guards fail closed',async t=>{
 for(const config of [{status:'finished'},{cancelled:true}]){const h=await fixture(t,config),before=await h.read();assert.equal((await h.save()).status,409);assert.deepEqual(await h.read(),before);}
 const h=await fixture(t),before=await h.read();
 for(const options of [{identity:{user:'family',admin:false}},{identity:{user:'other-host',admin:true}},{identity:null},{headers:{Origin:'https://evil.example'}},{headers:{'X-Vlampie-Bingo':'0'}},{headers:{'Content-Type':'text/plain'}}])assert([401,403,415].includes((await h.save(video,0,options)).status));
 assert.equal((await h.invoke('broadcast',{youtubeId:video,expectedBroadcastRevision:0,settings:{claimSeconds:600}})).status,400);assert.equal((await h.invoke('broadcast',{youtubeId:video})).status,400);assert.equal((await h.save('bad-id')).status,400);assert.deepEqual(await h.read(),before);
});
test('two tabs conflict on the broadcast revision; idempotent retries and clearing are explicit',async t=>{
 const h=await fixture(t),requestId=crypto.randomUUID(),first=await h.save(video,0,{body:{requestId}});assert.equal(first.status,200);
 assert.deepEqual((await h.save(video,0,{body:{requestId}})).data.broadcast,{youtubeId:video,revision:1});assert.equal((await h.read()).broadcastRevision,1);
 const conflict=await h.save(other);assert.equal(conflict.status,409);assert.equal(conflict.data.error.code,'broadcast_conflict');assert.deepEqual(conflict.data.broadcast,{youtubeId:video,revision:1});assert.equal((await h.read()).settings.youtubeId,video);
 assert.equal((await h.save(other,1)).status,200);assert.equal((await h.save('',2)).status,200);assert.deepEqual(broadcastSettings(await h.read()),{youtubeId:'',revision:3});
 const race=await Promise.all([h.save(video,3),h.save(other,3)]);assert.deepEqual(race.map(result=>result.status).sort(),[200,409]);assert.equal((await h.read()).broadcastRevision,4);
});
test('a storage error preserves the old ID; retrying the same request stores it once',async t=>{
 const h=await fixture(t),execute=h.db.execute.bind(h.db),before=await h.read(),requestId=crypto.randomUUID();let fail=true;
 h.db.execute=async(sql,args)=>{if(fail&&/^UPDATE bingo_games SET revision/.test(sql)){fail=false;throw Error('Injected durable storage failure');}return execute(sql,args);};
 assert.equal((await h.save(video,0,{body:{requestId}})).status,503);assert.deepEqual(await h.read(),before);assert.equal((await h.save(video,0,{body:{requestId}})).status,200);assert.equal((await h.read()).broadcastRevision,1);
});
test('a stale complete preparation PUT preserves a newer broadcast ID, including a lost CAS race',async t=>{
 const h=await fixture(t);await h.save(video);const before=await h.read(),plan=structuredClone(before.plan);plan.blocks.find(block=>block.type==='welcome').text='Een eigen welkomsttekst';
 const execute=h.db.execute.bind(h.db);let raced=false;
 h.db.execute=async(sql,args)=>{if(!raced&&/^UPDATE bingo_games SET revision/.test(sql)&&JSON.parse(args[1]).preparationRevision===1){raced=true;assert.equal((await h.save(other,1)).status,200);}return execute(sql,args);};
 const saved=await h.invoke('',{plan,settings:{...before.settings,youtubeId:''},expectedPreparationRevision:0},{method:'PUT'});assert.equal(saved.status,200,JSON.stringify(saved));assert(raced);const after=await h.read();assert.equal(after.settings.youtubeId,other);assert.equal(after.broadcastRevision,2);assert.equal(after.preparationRevision,1);assert.equal(after.plan.blocks.find(block=>block.type==='welcome').text,'Een eigen welkomsttekst');
});
test('optional speech claims are durable at most once, including retries, two tabs and old operation eviction',async t=>{
 const h=await fixture(t,{status:'running'}),before=await h.read(),cueId=NUMBER_NINE_AUDIENCE.id,requestId=crypto.randomUUID();
 const [first,second]=await Promise.all([h.invoke('audio-cue',{cueId,requestId}),h.invoke('audio-cue',{cueId,requestId:crypto.randomUUID()})]);assert.equal([first,second].filter(result=>result.data.claimed===true).length,1);assert.equal((await h.invoke('audio-cue',{cueId,requestId})).data.claimed,false);
 await h.store.mutate(h.game.id,{},game=>{game.ops=[];});assert.equal((await h.invoke('audio-cue',{cueId,requestId:crypto.randomUUID()})).data.claimed,false);
 const after=await h.read();assert.deepEqual(after.state,before.state);assert.deepEqual(rulesContract(after),rulesContract(before));assert(after.audioCues[cueId]);
 assert.equal((await h.invoke('audio-cue',{cueId:MILO_BANTER[0].id})).data.claimed,true);assert.equal((await h.invoke('audio-cue',{cueId:'arbitrary-unapproved-text'})).status,400);
});
test('optional speech cannot be claimed before an official nine, across an old epoch or while held',async t=>{
 for(const hold of ['paused','window','result','pending','call','drawHold','wrong-nine','old-epoch','old-number','finished','cancelled']){
  const h=await fixture(t,{status:'running'});await h.store.mutate(h.game.id,{},game=>{
   if(hold==='paused')game.state.paused=true;if(hold==='window')game.state.window={id:'held',status:'open',endsAt:Date.now()+60000};if(hold==='result')game.state.resultId='held';if(hold==='pending')game.state.pending={token:'held'};if(hold==='call')game.state.callId='held';if(hold==='drawHold')game.state.drawHold={id:'held'};if(hold==='wrong-nine')game.state.lastCommit.number=7;if(hold==='finished')game.status='finished';if(hold==='cancelled')forceCancelGame(game,{by:'host',reason:'Test',requestId:crypto.randomUUID(),binding:'test'},Date.now());
  });
  const response=await h.invoke('audio-cue',{cueId:NUMBER_NINE_AUDIENCE.id,...(hold==='old-epoch'?{expectedEpoch:'old-round'}:hold==='old-number'?{expectedNumber:8}:{})});assert.equal(response.status,409,hold+':'+JSON.stringify(response));assert.equal((await h.read()).audioCues,undefined);
 }
});
test('optional speech requires the current unexpired control lease and never acquires or extends it',async t=>{
 for(const variant of ['missing-id','other-tab','expired','no-control']){
  const h=await fixture(t,{status:'running'});
  if(variant==='expired'||variant==='no-control')await h.store.mutate(h.game.id,{},game=>{if(variant==='no-control')delete game.state.control;else game.state.control.until=Date.now()-1;});
  const before=await h.read(),response=await h.invoke('audio-cue',{cueId:MILO_BANTER[0].id,...(variant==='missing-id'?{regieId:null}:variant==='other-tab'?{regieId:'another-regie'}:{})});
  assert.equal(response.status,409,variant);assert.equal(response.data.error.code,'control_busy',variant);assert.deepEqual(await h.read(),before,variant+' must not acquire or renew a lease');
 }
 const h=await fixture(t,{status:'running'}),before=await h.read();assert.equal((await h.invoke('audio-cue',{cueId:MILO_BANTER[0].id})).data.claimed,true);assert.deepEqual((await h.read()).state.control,before.state.control,'a successful cue must not extend its lease');
});
test('a control handover that wins the CAS prevents the old tab from consuming a cue',async t=>{
 const h=await fixture(t,{status:'running'}),execute=h.db.execute.bind(h.db),newControl={id:'another-regie',until:Date.now()+60000};let raced=false;
 h.db.execute=async(sql,args)=>{if(!raced&&/^UPDATE bingo_games SET revision/.test(sql)&&JSON.parse(args[1]).audioCues){raced=true;await h.store.mutate(h.game.id,{},game=>{game.state.control=newControl;});}return execute(sql,args);};
 const response=await h.invoke('audio-cue',{cueId:MILO_BANTER[0].id});assert(raced);assert.equal(response.status,409);assert.equal(response.data.error.code,'control_busy');const after=await h.read();assert.deepEqual(after.state.control,newControl);assert.equal(after.audioCues,undefined);
});
test('PostgreSQL broadcast revisions and durable audio receipts use real CAS and survive reload',{skip:process.env.MILO_TEST_DATABASE_URL?false:'MILO_TEST_DATABASE_URL is not set; this integration requires an explicitly local PostgreSQL test database'},async t=>{
 const h=await fixture(t,{postgres:true}),before=await h.read(),ids=[crypto.randomUUID(),crypto.randomUUID()],videos=[video,other];
 const results=await Promise.all(videos.map((youtubeId,index)=>h.save(youtubeId,0,{body:{requestId:ids[index]}})));assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
 const winner=results.findIndex(result=>result.status===200),saved=(await h.invoke('',{},{method:'GET'})).data.game,hostState=structuredClone(before.state);delete hostState.deck;
 assert.equal(saved.settings.youtubeId,videos[winner]);assert.equal(saved.broadcastRevision,1);assert.equal(saved.preparationRevision,before.preparationRevision);assert.deepEqual(saved.state,hostState);assert.equal(Object.hasOwn(saved.state,'deck'),false,'The host response must not reveal the private draw deck');assert.deepEqual((await h.read()).state,before.state,'Saving a broadcast must preserve the complete private server state');
 assert.equal((await h.save(videos[winner],0,{body:{requestId:ids[winner]}})).status,200);assert.equal((await h.read()).broadcastRevision,1);
 for(const identity of [{user:'other-host',admin:true},{user:'family',admin:false}])assert.equal((await h.save(video,1,{identity})).status,403);
 await h.store.mutate(h.game.id,{},game=>{game.status='running';activateBlock(game,game.plan.blocks.findIndex(block=>block.type==='round'));game.state.drawn=[9];game.state.lastCommit={number:9,at:Date.now()};game.state.control={id:'fixture-regie',until:Date.now()+60000};});
 const lease=(await h.read()).state.control,cueId=NUMBER_NINE_AUDIENCE.id;assert.equal((await h.invoke('audio-cue',{cueId,regieId:'another-tab'})).data.error.code,'control_busy');
 const claims=await Promise.all([h.invoke('audio-cue',{cueId}),h.invoke('audio-cue',{cueId})]);assert(claims.every(result=>result.status===200));assert.equal(claims.filter(result=>result.data.claimed===true).length,1);
 await h.store.mutate(h.game.id,{},game=>{game.ops=[];});assert.equal((await h.invoke('audio-cue',{cueId})).data.claimed,false);
 const reloaded=(await new BingoStore(h.db).game(h.game.id)).data;assert(reloaded.audioCues[cueId]);assert.deepEqual(reloaded.state.control,lease);assert.equal(reloaded.settings.youtubeId,videos[winner]);assert.equal(reloaded.broadcastRevision,1);
});
