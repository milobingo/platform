import test from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createPostgresDatabase,createSqliteDatabase} from '../server/node-storage.js';
import {capacitySchema,capacityTarget,stagingCapacityProof,qualifyCapacitySql,classifyCapacityResponse,sanitizeCapacityProgress,capacityLeaseSeconds,capacityClaimTiming,runCapacityScenario} from '../scripts/deploy/staging-capacity-v70.mjs';
import {loadManifest} from '../scripts/deploy/database.mjs';

const ref='lfsdgxcpdyghidzkzzvn',testUrl=process.env.MILO_TEST_DATABASE_URL;
const configuration=()=>({DATABASE_URL:`postgresql://migration:fixture-only@db.${ref}.supabase.co:5432/postgres?sslmode=verify-full`,SUPABASE_URL:`https://${ref}.supabase.co`,SUPABASE_STORAGE_BUCKET:'milo-staging',SUPABASE_SECRET_KEY:'sb_secret_fixture_only',SUPABASE_DB_CA_BASE64:'public-fixture-ca-placeholder'});
test('capacity target pins numeric run identity, project and schema-only options before connecting',()=>{
 const env=configuration(),result=capacityTarget(env,'42620664279');assert.equal(result.schema,'milo_v70_fixture_42620664279');assert(!Object.hasOwn(result,'scopedUrl'),'session startup options cannot become the isolation boundary');
 for(const id of ['',undefined,'../public','1;DROP','0','1_2','9'.repeat(21)])assert.throws(()=>capacitySchema(id),e=>e.code==='capacity_run_id');
 for(const suffix of ['&options=-csearch_path=public','&Options=anything','&search_path=public'])assert.throws(()=>capacityTarget({...env,DATABASE_URL:env.DATABASE_URL+suffix},'42'),e=>e.code==='capacity_base_options');
 assert.throws(()=>capacityTarget({...env,SUPABASE_DB_CA_BASE64:''},'42'),e=>e.code==='capacity_ca_required');
 assert.throws(()=>capacityTarget({...env,SUPABASE_URL:'https://other.supabase.co'},'42'),e=>e.code==='project_mismatch');
});

test('capacity SQL lexer fixes every relation while preserving string literals and refusing public/unknown relations or extra statements',()=>{
 const schema=capacitySchema('42620664279');assert.equal(qualifyCapacitySql("UPDATE bingo_games SET document='bingo_games FROM bingo_families' WHERE id IN (SELECT game_id FROM bingo_codes)",schema),`UPDATE "${schema}"."bingo_games" SET document='bingo_games FROM bingo_families' WHERE id IN (SELECT game_id FROM "${schema}"."bingo_codes")`);
 assert.equal(qualifyCapacitySql('SELECT * FROM "bingo_families"',schema),`SELECT * FROM "${schema}"."bingo_families"`);
 for(const sql of ['UPDATE public.bingo_games SET revision=1','SELECT * FROM app_user_roles','SELECT * FROM "public"."bingo_games"','SELECT * FROM bingo_payment_receipts','UPDATE bingo_games SET revision=1; DROP SCHEMA public','SELECT * FROM bingo_games --comment'])assert.throws(()=>qualifyCapacitySql(sql,schema),e=>e.code.startsWith('capacity_'));
});

test('capacity CLI binds its release and checkout before opening any database or exposing credentials',async()=>{
 for(const [releaseSha,code] of [['opaque-do-not-echo','capacity_release_sha'],['0'.repeat(40),'capacity_checkout_sha']]){
  const child=spawn(process.execPath,['scripts/deploy/staging-capacity-v70.mjs','--run-id=42620664279'],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,GITHUB_RUN_ID:'42620664279',GITHUB_REPOSITORY:'milobingo/platform',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',RELEASE_SHA:releaseSha}}),stdout=[],stderr=[];child.stdout.on('data',x=>stdout.push(x));child.stderr.on('data',x=>stderr.push(x));
  assert.equal(await new Promise(done=>child.once('exit',done)),1);assert.equal(Buffer.concat(stdout).length,0);assert.equal(JSON.parse(Buffer.concat(stderr)).code,code);assert(!Buffer.concat(stderr).toString().includes('opaque-do-not-echo'));
 }
});

test('delayed deadline refusals are never CAS retries or successes, and diagnostics exclude response bodies and unrecognized codes',async()=>{
 const classifyAfterDelay=async response=>{await new Promise(done=>setTimeout(done,10));return classifyCapacityResponse(response);};
 assert.deepEqual(await classifyAfterDelay({status:409,data:{error:{code:'conflict'}}}),{outcome:'retry',httpStatus:409,serverErrorCode:'conflict'});
 const privateBody={status:409,data:{error:{code:'closed',message:'PRIVATE-PARENT-NAME parent@example.test'},book:{code:'PRIVATE-BOOK-CODE'}}};
 assert.deepEqual(await classifyAfterDelay(privateBody),{outcome:'refused',httpStatus:409,serverErrorCode:'closed'});
 assert.deepEqual(await classifyAfterDelay({status:409,data:{error:{code:'context_changed'}}}),{outcome:'refused',httpStatus:409,serverErrorCode:'context_changed'});
 assert.deepEqual(classifyCapacityResponse({status:503,data:{error:{code:'unavailable',message:'PRIVATE-DRIVER-DETAIL'}}}),{outcome:'refused',httpStatus:503,serverErrorCode:'unavailable'});
 const unknown=classifyCapacityResponse({status:409,data:{error:{code:'parent@example.test',message:'PRIVATE-PARENT-NAME'}}});assert.equal(unknown.serverErrorCode,null);assert(!JSON.stringify(unknown).includes('PRIVATE'));assert(!JSON.stringify(unknown).includes('parent@'));
 assert.deepEqual(classifyCapacityResponse({status:200,data:{}}),{outcome:'success',httpStatus:200,serverErrorCode:null});
});

test('capacity refuses concurrency outside1..100 before any native connection or fixture operation',async()=>{
 for(const concurrency of [0,-1,101,1.5]){
  await assert.rejects(runCapacityScenario(null,{concurrency}),e=>e.code==='capacity_bounds');
  await assert.rejects(stagingCapacityProof({concurrency,poolFactory:()=>assert.fail('invalid concurrency must not connect')}),e=>e.code==='capacity_bounds');
 }
});

test('capacity lease input accepts only explicit30/180 or the180 default before any database access',()=>{
 assert.equal(capacityLeaseSeconds(),180);assert.equal(capacityLeaseSeconds('180'),180);assert.equal(capacityLeaseSeconds('30'),30);
 for(const value of ['',null,30,180,'60','030','30 ','180\n','PRIVATE-DATABASE-URL'])assert.throws(()=>capacityLeaseSeconds(value),error=>error.code==='capacity_lease_seconds'&&!error.message.includes('PRIVATE'));
});

test('claim proof uses actual completion before the saved deadline, excluding exact-boundary and late commits or unfinished requests',()=>{
 const start=Date.now(),endsAt=start+30000;
 assert.deepEqual(capacityClaimTiming({startedAt:start,finishedAt:endsAt-1,endsAt}),{claimProcessingElapsedMs:29999,remainingWindowMs:1,claimsFinishedBeforeDeadline:true});
 assert.deepEqual(capacityClaimTiming({startedAt:start,finishedAt:endsAt,endsAt}),{claimProcessingElapsedMs:30000,remainingWindowMs:0,claimsFinishedBeforeDeadline:false});
 assert.deepEqual(capacityClaimTiming({startedAt:start,finishedAt:endsAt+5000,endsAt}),{claimProcessingElapsedMs:35000,remainingWindowMs:-5000,claimsFinishedBeforeDeadline:false});
 assert.deepEqual(capacityClaimTiming({startedAt:start,endsAt,now:endsAt+10}),{claimProcessingElapsedMs:30010,remainingWindowMs:-10,claimsFinishedBeforeDeadline:null});
});

test('capacity failure progress keeps only aggregate counts, timings, known phases and numeric queue statistics',()=>{
 const secret='PRIVATE-parent@example.test-book-code',progress=sanitizeCapacityProgress({phase:'claim',elapsedMs:193000,beginSuccesses:100,claimSuccesses:237,successfulOperations:337,apiAttempts:440,apiResponses:439,apiConflicts:101,retries:101,storageConflicts:422,peakDocumentBytes:1161539,claimProcessingElapsedMs:178001,remainingWindowMs:-3000,claimsFinishedBeforeDeadline:false,gameId:secret,document:{parent:secret},latencyMs:{count:337,p50:320,p95:901,max:1200,ids:[secret]},beginLatencyMs:{count:100,p50:300,p95:600,max:800},claimLatencyMs:{count:237,p50:400,p95:901,max:1200},apiLatencyMs:{count:439,p50:320,p95:901,max:1200},nativeQueue:{enabled:true,pending:0,active:0,keys:0,enqueued:440,started:440,completed:439,failed:1,rejected:0,expired:0,maxDepth:100,totalWaitMs:203000,maxWaitMs:30000,privateKeys:[secret]}});
 assert.equal(progress.phase,'claim');assert.equal(progress.beginSuccesses,100);assert.equal(progress.claimSuccesses,237);assert.equal(progress.apiAttempts,440);assert.equal(progress.apiResponses,439);assert.equal(progress.retries,101);assert.equal(progress.storageConflicts,422);assert.equal(progress.peakDocumentBytes,1161539);assert.equal(progress.remainingWindowMs,-3000);assert.equal(progress.claimsFinishedBeforeDeadline,false);assert.equal(progress.claimLatencyMs.count,237);assert.equal(progress.nativeQueue.maxDepth,100);assert.equal(progress.nativeQueue.keys,0);assert(!JSON.stringify(progress).includes('PRIVATE'));assert(!Object.hasOwn(progress,'gameId'));
 const invalid=sanitizeCapacityProgress({phase:secret,elapsedMs:NaN,beginSuccesses:secret,claimSuccesses:Infinity,peakDocumentBytes:-1,latencyMs:{count:secret,p50:secret,p95:-1,max:Infinity},claimsFinishedBeforeDeadline:secret,nativeQueue:{enabled:true,keys:[secret],maxWaitMs:secret}});assert.equal(invalid.phase,'unknown');assert.equal(invalid.elapsedMs,null);assert.equal(invalid.beginSuccesses,null);assert.equal(invalid.claimSuccesses,null);assert.equal(invalid.peakDocumentBytes,null);assert.equal(invalid.nativeQueue.keys,null);assert.equal(invalid.claimsFinishedBeforeDeadline,null);assert(!JSON.stringify(invalid).includes('PRIVATE'));
});

test('actual scenario attaches partial begin progress and latency after an asynchronous native storage refusal without copying the error',async t=>{
 const db=createSqliteDatabase(':memory:'),schema=capacitySchema('42628359660');t.after(()=>db.close());
 await db.execute(`ATTACH DATABASE ':memory:' AS "${schema}"`,[]);
 const definitions=(await db.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('bingo_games','bingo_families','bingo_codes')",[])).results;
 for(const row of definitions)await db.execute(row.sql.replace(/^CREATE TABLE\s+[`"]?\w+[`"]?/i,`CREATE TABLE "${schema}"."${row.name}"`),[]);
 const batch=db.batch.bind(db);let batches=0;db.batch=async statements=>{if(++batches===4){await new Promise(done=>setTimeout(done,10));throw Error('PRIVATE-parent@example.test-book-code');}return batch(statements);};
 db.gameMutationQueueStats=()=>({enabled:true,pending:0,active:0,keys:0,enqueued:batches,started:batches,completed:batches-1,failed:1,maxDepth:1,privateKeys:['PRIVATE-GAME-ID']});t.mock.method(console,'error',()=>{});
 await assert.rejects(runCapacityScenario(db,{schema,leaseSeconds:30,concurrency:1}),error=>{assert.equal(error.code,'capacity_api_refused');assert.deepEqual(error.capacityRefusal,{httpStatus:503,serverErrorCode:'unavailable'});const progress=error.capacityProgress;assert.equal(progress.phase,'begin');assert.equal(progress.beginSuccesses,3);assert.equal(progress.claimSuccesses,0);assert.equal(progress.successfulOperations,3);assert.equal(progress.apiAttempts,4);assert.equal(progress.apiResponses,4);assert.equal(progress.latencyMs.count,3);assert.equal(progress.apiLatencyMs.count,4);assert(progress.apiLatencyMs.max>=10);assert(progress.elapsedMs>=10);assert.equal(progress.nativeQueue.failed,1);assert(!JSON.stringify(progress).includes('PRIVATE'));return true;});
});

function fixturePool(options,failures){
 const pool=new Pool(options),disconnects=[];
 pool.on('connect',client=>disconnects.push(new Promise(done=>client.once('end',done))));
 // pg idle error events also carry a Client. Keep only a SQLSTATE, never the
 // object itself, while still failing the fixture for unexpected idle errors.
 pool.on('error',error=>failures.push(/^[A-Z0-9]{5}$/.test(error.code||'')?error.code:'unknown_pool_error'));
 const finish=pool.end.bind(pool);let finishing;
 pool.end=()=>finishing??=(async()=>{let timer;try{await Promise.race([(async()=>{await finish();await Promise.all(disconnects);})(),new Promise((done,reject)=>{timer=setTimeout(()=>reject(Error('The capacity fixture did not close every PostgreSQL connection.')),5000);})]);}finally{clearTimeout(timer);}})();
 return pool;
}
async function dropFixtureDatabase(admin,name){
 for(let attempt=0;attempt<40;attempt++){
  try{await admin.query('DROP DATABASE "'+name+'"');return;}catch(error){if(error.code!=='55006')throw Error('Capacity fixture database cleanup failed ('+(/^[A-Z0-9]{5}$/.test(error.code||'')?error.code:'unknown')+').');if(attempt===39)assert.fail('The capacity fixture still has a live connection after bounded cleanup (55006).');await new Promise(done=>setTimeout(done,50));}
 }
}
async function fixture(t){
 const local=new URL(testUrl);assert(['127.0.0.1','localhost','[::1]'].includes(local.hostname));assert.match(local.pathname,/test/i);
 const failures=[],admin=fixturePool({connectionString:testUrl},failures),name='milo_capacity_test_'+randomUUID().replaceAll('-',''),proofPools=[];let source,directory,created=false;
 t.after(async()=>{try{await Promise.all([...(source?[source]:[]),...proofPools].map(pool=>pool.end()));if(created)await dropFixtureDatabase(admin,name);}finally{try{await admin.end();}finally{if(directory)await rm(directory,{recursive:true,force:true});}}assert.deepEqual(failures,[],'capacity fixture pools must not emit idle errors');});
 await admin.query('CREATE DATABASE "'+name+'"');created=true;local.pathname='/'+name;
 source=fixturePool({connectionString:local.toString()},failures);directory=await mkdtemp(join(tmpdir(),'milo-capacity-ca-'));
 const manifest=await loadManifest();for(const migration of manifest.migrations)await source.query(migration.sql);
 await source.query("INSERT INTO public.bingo_games VALUES ('existing-public-game','existing-public-owner',1,'{\"sourceData\":\"must-stay\"}',1)");await source.query("INSERT INTO public.bingo_families VALUES ('existing-public-family',1,'{\"sourceData\":\"must-stay\"}')");await source.query("INSERT INTO public.bingo_codes VALUES ('PUBLIC-CODE','existing-public-game')");
 const key=join(directory,'key.pem'),cert=join(directory,'ca.pem');await promisify(execFile)('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','2','-subj','/CN=milo-capacity-fixture','-addext','basicConstraints=critical,CA:TRUE']);
 const env={...configuration(),SUPABASE_DB_CA_BASE64:(await readFile(cert)).toString('base64')};
 // The real native adapter and PostgreSQL storage are exercised here over an
 // isolated local connection. Actual hosted CA/hostname proof stays required
 // by the production defaults; no test switch exists in the CLI or env.
 const options={env,poolFactory:requested=>{assert.equal(requested.ssl.rejectUnauthorized,true);const pool=fixturePool({connectionString:local.toString(),max:1,statement_timeout:15000,lock_timeout:5000},failures);proofPools.push(pool);return pool;},tlsVerifier:(_client,host)=>assert.equal(host,'db.'+ref+'.supabase.co'),databaseFactory:async()=>createPostgresDatabase(local.toString(),{allowLoopback:true})};
 return {source,options};
}

test('C01 actual local PostgreSQL serves500 successful API operations for100households/400books, observes a real180s deadline, saves one draw and preserves public data',{skip:!testUrl,timeout:300000},async t=>{
 const h=await fixture(t),runId=String(Date.now()),fetch=globalThis.fetch;globalThis.fetch=async()=>{assert.fail('No network provider may be called by capacity fixtures.');};t.after(()=>{globalThis.fetch=fetch;});
 const result=await stagingCapacityProof({...h.options,runId,leaseSeconds:180,concurrency:10});assert.equal(result.concurrency,10);assert.equal(result.nativePoolMax,10);assert.equal(result.successfulOperations,500);assert.equal(result.beginSuccesses,100);assert.equal(result.claimSuccesses,400);assert(result.apiAttempts>=500);assert.equal(result.apiAttempts,500+result.retries);assert.equal(result.apiConflicts,result.retries);assert.equal(result.totalApiResponses,result.apiAttempts+6);assert.equal(result.results,1);assert.equal(result.entrants,400);assert.equal(result.idsPreserved,true);assert.equal(result.providerCalls,0);assert.equal(result.realDeadlineObserved,true);assert.equal(result.claimsFinishedBeforeDeadline,true);assert(result.remainingWindowMs>0);assert(result.claimProcessingElapsedMs>=0);assert.equal(result.progress.phase,'complete');assert.equal(result.progress.apiResponses,result.apiAttempts);assert.equal(result.leaseSeconds,180);assert(result.elapsedMs>=180000);assert.equal(result.publicTables.length,23);assert.equal(result.publicTablesUnchanged,true);assert.equal(result.fixtureSchemaRemoved,true);
 assert.equal((await h.source.query('SELECT to_regnamespace($1) AS schema',[capacitySchema(runId)])).rows[0].schema,null);assert.equal((await h.source.query('SELECT document FROM public.bingo_games')).rows[0].document,'{"sourceData":"must-stay"}');
 console.log('LOCAL_POSTGRES_CAPACITY '+JSON.stringify({successfulOperations:result.successfulOperations,apiAttempts:result.apiAttempts,apiConflicts:result.apiConflicts,storageConflicts:result.storageConflicts,peakDocumentBytes:result.peakDocumentBytes,elapsedMs:result.elapsedMs,latencyMs:result.latencyMs,fixtureSchemaRemoved:result.fixtureSchemaRemoved,publicTablesUnchanged:true,hostedTlsVerified:false}));
});

test('isolated PostgreSQL capacity refuses existing-schema takeover and cleans its exact new schema after failure',{skip:!testUrl,timeout:30000},async t=>{
 const h=await fixture(t),runId=String(Date.now()),schema=capacitySchema(runId);await h.source.query('CREATE SCHEMA "'+schema+'"');await h.source.query('CREATE TABLE "'+schema+'".untouched(id int)');
 await assert.rejects(stagingCapacityProof({...h.options,runId,scenario:()=>assert.fail('collision must stop before scenario')}),e=>e.code==='capacity_schema_collision');assert.equal((await h.source.query('SELECT count(*)::int AS n FROM "'+schema+'".untouched')).rows[0].n,0);
 await h.source.query('DROP TABLE "'+schema+'".untouched');await h.source.query('DROP SCHEMA "'+schema+'" RESTRICT');
 await assert.rejects(stagingCapacityProof({...h.options,runId,scenario:async()=>{throw Object.assign(Error('fixture failure PRIVATE-ERROR'),{code:'capacity_injected_failure',capacityProgress:{phase:'claim',elapsedMs:5000,beginSuccesses:100,claimSuccesses:12,successfulOperations:112,apiAttempts:113,apiResponses:113,retries:0,storageConflicts:3,peakDocumentBytes:10000,document:'PRIVATE-DOCUMENT',latencyMs:{count:112,p50:20,p95:40,max:60}}});}}),e=>{assert.equal(e.code,'capacity_injected_failure');assert(e.capacityEvidence.fixtureSchemaRemoved&&e.capacityEvidence.publicTablesUnchanged);assert.equal(e.capacityEvidence.progress.claimSuccesses,12);assert.equal(e.capacityEvidence.progress.phase,'claim');assert.equal(e.capacityEvidence.progress.latencyMs.count,112);assert(!JSON.stringify(e.capacityEvidence).includes('PRIVATE'));return true;});assert.equal((await h.source.query('SELECT to_regnamespace($1) AS schema',[schema])).rows[0].schema,null);
});
