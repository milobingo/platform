import test from 'node:test';
import assert from 'node:assert/strict';
import {rootCertificates} from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createSqliteDatabase} from '../server/node-storage.js';
import {BingoStore} from '../server/bingo-store.js';
import {makeGame} from '../server/bingo-model.js';
import {handleBingo} from '../server/bingo.js';
import {isProgrammeTestFixture} from '../server/programme-test-fixture.js';
import {FIXTURE_ORIGIN,validateFixtureTarget,makeProgrammeFixture,validateFixtureManifest,assertFixtureRecord,createFixtureRecord,removeFixtureRecord,cleanupFixtureResources} from '../scripts/load/staging-fixture.mjs';

async function fixture(t){const db=createSqliteDatabase(':memory:');t.after(()=>db.close());const store=new BingoStore(db),fresh=makeProgrammeFixture(),manifest=await createFixtureRecord(db,fresh);return {db,store,fresh,manifest,read:()=>store.game(manifest.gameId)};}
test('fixture environment requires root, exact host/IP and the staging Supabase runtime with verified TLS',()=>{
 const pem=rootCertificates.find(pem=>{const cert=new X509Certificate(pem);return cert.ca&&Date.parse(cert.validFrom)<Date.now()&&Date.parse(cert.validTo)>Date.now();});assert(pem);
 const env={NODE_ENV:'production',APP_URL:FIXTURE_ORIGIN,MAIL_ENVIRONMENT:'staging',MILO_LOCAL_AUTH:'false',SUPABASE_URL:'https://lfsdgxcpdyghidzkzzvn.supabase.co',SUPABASE_STORAGE_BUCKET:'milo-staging',SUPABASE_DB_CA_BASE64:Buffer.from(pem).toString('base64'),DATABASE_URL:'postgresql://runtime:private-fake-password@db.lfsdgxcpdyghidzkzzvn.supabase.co:5432/postgres?sslmode=verify-full'};
 const target={host:'dg-nxttrack-01',uid:0,addresses:['128.140.93.95']};assert.equal(validateFixtureTarget(env,target),true);
 for(const patch of [{host:'other-vps'},{uid:1001},{addresses:['167.235.202.206']}])assert.throws(()=>validateFixtureTarget(env,{...target,...patch}));
 for(const patch of [{APP_URL:'https://milo.dgwebservices.nl'},{MAIL_ENVIRONMENT:'production'},{MILO_LOCAL_AUTH:'true'},{SUPABASE_URL:'https://msupvdycmtbycaonqgan.supabase.co'},{DATABASE_URL:env.DATABASE_URL.replace('verify-full','disable')},{DATABASE_URL:env.DATABASE_URL.replace('lfsdgxcpdyghidzkzzvn','msupvdycmtbycaonqgan')}])assert.throws(()=>validateFixtureTarget({...env,...patch},target));
 const invoked=spawnSync(process.execPath,['scripts/load/staging-fixture.mjs','create'],{encoding:'utf8'});assert.notEqual(invoked.status,0);assert((invoked.stderr+invoked.stdout).includes('fixture_host'));assert(!(invoked.stderr+invoked.stdout).includes('DATABASE_URL'));
});
test('one fixture has a fictitious owner, no accounts/orders/cards and a non-secret durable manifest',async t=>{
 const h=await fixture(t),row=await h.read();assertFixtureRecord(row,h.manifest);assert(isProgrammeTestFixture(row.data));assert.equal(row.data.status,'draft');assert.equal(row.data.ordering.enabled,false);assert.equal(row.data.books.length,0);assert.equal(h.manifest.room,'programme-'+h.manifest.gameId);assert.equal(validateFixtureManifest(h.manifest),h.manifest);
 for(const table of ['bingo_families','app_user_roles','studio_calls','studio_outputs'])assert.equal(Number((await h.db.prepare('SELECT COUNT(*) AS count FROM '+table).first()).count),0);
 assert(!/token|password|secret|apiKey|whip|credential/i.test(JSON.stringify(h.manifest)));await assert.rejects(()=>createFixtureRecord(h.db,h.fresh),error=>error.code==='fixture_exists');
 const privateGame=structuredClone(row.data);privateGame.testOnly=false;assert(!isProgrammeTestFixture(privateGame));
});
test('technical shows are hidden from both show/order catalogs and cannot be booked through ordinary bingo routes',async t=>{
 const h=await fixture(t),real=makeGame({brandId:'milo',title:'Echte show behouden',date:'2027-12-05T19:00:00Z'},'real-host',FIXTURE_ORIGIN);await h.store.create(real);const before=JSON.stringify((await h.store.game(real.id)).data);
 const invoke=async path=>{const response=await handleBingo(new Request(FIXTURE_ORIGIN+'/api/bingo/'+path,{headers:{Origin:FIXTURE_ORIGIN}}),{DB:h.db,AUTH_IDENTITY:{user:'unrelated-family',admin:false}});return {status:response.status,data:await response.json()};};
 const games=await invoke('games');assert.equal(games.status,200);assert.deepEqual(games.data.games.map(game=>game.id),[real.id]);
 const orders=await invoke('orders');assert.equal(orders.status,200);assert.deepEqual(orders.data.shows.map(game=>game.id),[real.id]);
 assert.equal((await invoke('games/'+h.manifest.gameId)).status,404);assert.equal((await invoke('games/'+h.manifest.gameId+'/orders')).status,404);assert.equal(JSON.stringify((await h.store.game(real.id)).data),before);
});
test('cleanup is mandatory, failure preserves the fixture and unrelated records stay byte-identical',async t=>{
 const h=await fixture(t),real=makeGame({brandId:'vlampie',title:'Vlampie behouden',date:'2027-12-05T19:00:00Z'},'real-host',FIXTURE_ORIGIN);await h.store.create(real);const before=(await h.store.game(real.id)).document;let cleaned=false;
 await assert.rejects(()=>removeFixtureRecord(h.db,h.manifest),error=>error.code==='fixture_cleanup_required');
 await assert.rejects(()=>removeFixtureRecord(h.db,h.manifest,{cleanup:async()=>{throw Error('Unconfirmed provider close');}}));assert(await h.read());
 const removed=await removeFixtureRecord(h.db,h.manifest,{cleanup:async()=>{cleaned=true;},removeMedia:async()=>{assert(cleaned);}});assert(cleaned);assert.equal(removed.status,'removed');assert.equal(await h.read(),null);assert.equal((await h.store.game(real.id)).document,before);
 assert.equal((await removeFixtureRecord(h.db,removed)).status,'removed','a completed cleanup is idempotent without recreating anything');
});
test('changed ownership/tags, real participation, related rows and races all block deletion before damage',async t=>{
 for(const change of [g=>{g.ownerId=crypto.randomUUID();},g=>{g.technicalFixture.marker=crypto.randomUUID();},g=>{g.testOnly=false;},g=>{g.books.push({id:'real-card',code:'REALTEST01'});},g=>{g.orders=[{id:'real-order'}];},g=>{g.participation=[{id:'real-child'}];},g=>{g.status='running';},g=>{g.programBroadcast.control={until:Date.now()+60000};}]){
  const h=await fixture(t);await h.store.mutate(h.manifest.gameId,{},change);let cleaned=false;await assert.rejects(()=>removeFixtureRecord(h.db,h.manifest,{cleanup:async()=>{cleaned=true;}}));assert.equal(cleaned,false);assert(await h.read());
 }
 const related=await fixture(t);await related.db.prepare('INSERT INTO bingo_chat_rooms (game_id,revision,last_op) VALUES (?,0,?)').bind(related.manifest.gameId,'real').run();let cleaned=false;await assert.rejects(()=>removeFixtureRecord(related.db,related.manifest,{cleanup:async()=>{cleaned=true;}}),error=>error.code==='fixture_related_records');assert.equal(cleaned,false);
 const race=await fixture(t);await assert.rejects(()=>removeFixtureRecord(race.db,race.manifest,{cleanup:async()=>{await race.store.mutate(race.manifest.gameId,{},g=>{g.orders=[{id:'concurrent-real-order'}];});}}));assert.equal((await race.read()).data.orders[0].id,'concurrent-real-order');
});
test('resource cleanup touches only the exact fixture room and refuses foreign publishers or ingress',async t=>{
 const h=await fixture(t),settings={url:'wss://media.example.test',apiKey:'API_FIXTURE',apiSecret:'private-test-secret-12345678901234567890'},requests=[];
 const fetcher=async(url,options)=>{const method=url.split('/').at(-1),body=JSON.parse(options.body);requests.push({method,body});if(method==='ListIngress')return Response.json({items:[{ingress_id:'IN_own',name:'milo-programme-'+h.manifest.gameId,room_name:h.manifest.room,participant_identity:h.manifest.room}]});if(method==='ListParticipants')return Response.json({participants:[{identity:h.manifest.room,tracks:[{name:'programme-video'}]}]});return Response.json({items:[]});};
 const result=await cleanupFixtureResources(settings,h.manifest,fetcher);assert.equal(result.roomClosed,true);assert(requests.some(request=>request.method==='DeleteRoom'&&request.body.room===h.manifest.room));assert(requests.some(request=>request.method==='DeleteIngress'&&request.body.ingress_id==='IN_own'));
 const foreign=[];await assert.rejects(()=>cleanupFixtureResources(settings,h.manifest,async(url)=>{const method=url.split('/').at(-1);foreign.push(method);if(method==='ListIngress')return Response.json({items:[{ingress_id:'IN_someone_else',name:'other-project',room_name:h.manifest.room,participant_identity:'private-child'}]});return Response.json({});}),error=>error.code==='fixture_foreign_ingress');assert.deepEqual(foreign,['ListIngress']);
});
