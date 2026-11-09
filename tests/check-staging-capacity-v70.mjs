import test from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createPostgresDatabase} from '../server/node-storage.js';
import {capacitySchema,capacityTarget,stagingCapacityProof,qualifyCapacitySql,classifyCapacityResponse} from '../scripts/deploy/staging-capacity-v70.mjs';
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

async function fixture(t){
 const local=new URL(testUrl);assert(['127.0.0.1','localhost','[::1]'].includes(local.hostname));assert.match(local.pathname,/test/i);
 const admin=new Pool({connectionString:testUrl}),name='milo_capacity_test_'+randomUUID().replaceAll('-','');await admin.query('CREATE DATABASE "'+name+'"');local.pathname='/'+name;
 const source=new Pool({connectionString:local.toString()}),directory=await mkdtemp(join(tmpdir(),'milo-capacity-ca-'));
 t.after(async()=>{await source.end();await admin.query('DROP DATABASE "'+name+'" WITH (FORCE)');await admin.end();await rm(directory,{recursive:true,force:true});});
 const manifest=await loadManifest();for(const migration of manifest.migrations)await source.query(migration.sql);
 await source.query("INSERT INTO public.bingo_games VALUES ('existing-public-game','existing-public-owner',1,'{\"sourceData\":\"must-stay\"}',1)");await source.query("INSERT INTO public.bingo_families VALUES ('existing-public-family',1,'{\"sourceData\":\"must-stay\"}')");await source.query("INSERT INTO public.bingo_codes VALUES ('PUBLIC-CODE','existing-public-game')");
 const key=join(directory,'key.pem'),cert=join(directory,'ca.pem');await promisify(execFile)('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','2','-subj','/CN=milo-capacity-fixture','-addext','basicConstraints=critical,CA:TRUE']);
 const env={...configuration(),SUPABASE_DB_CA_BASE64:(await readFile(cert)).toString('base64')};
 // The real native adapter and PostgreSQL storage are exercised here over an
 // isolated local connection. Actual hosted CA/hostname proof stays required
 // by the production defaults; no test switch exists in the CLI or env.
 const options={env,poolFactory:requested=>{assert.equal(requested.ssl.rejectUnauthorized,true);return new Pool({connectionString:local.toString(),max:1,statement_timeout:15000,lock_timeout:5000});},tlsVerifier:(_client,host)=>assert.equal(host,'db.'+ref+'.supabase.co'),databaseFactory:async()=>createPostgresDatabase(local.toString(),{allowLoopback:true})};
 return {source,options};
}

test('C01 actual local PostgreSQL serves500 successful API operations for100households/400books, observes a real180s deadline, saves one draw and preserves public data',{skip:!testUrl,timeout:300000},async t=>{
 const h=await fixture(t),runId=String(Date.now()),fetch=globalThis.fetch;globalThis.fetch=async()=>{assert.fail('No network provider may be called by capacity fixtures.');};t.after(()=>{globalThis.fetch=fetch;});
 const result=await stagingCapacityProof({...h.options,runId,leaseSeconds:180});assert.equal(result.successfulOperations,500);assert(result.apiAttempts>=500);assert.equal(result.apiAttempts,500+result.retries);assert.equal(result.apiConflicts,result.retries);assert.equal(result.totalApiResponses,result.apiAttempts+6);assert.equal(result.results,1);assert.equal(result.entrants,400);assert.equal(result.idsPreserved,true);assert.equal(result.providerCalls,0);assert.equal(result.realDeadlineObserved,true);assert.equal(result.leaseSeconds,180);assert(result.elapsedMs>=180000);assert.equal(result.publicTables.length,23);assert.equal(result.publicTablesUnchanged,true);assert.equal(result.fixtureSchemaRemoved,true);
 assert.equal((await h.source.query('SELECT to_regnamespace($1) AS schema',[capacitySchema(runId)])).rows[0].schema,null);assert.equal((await h.source.query('SELECT document FROM public.bingo_games')).rows[0].document,'{"sourceData":"must-stay"}');
 console.log('LOCAL_POSTGRES_CAPACITY '+JSON.stringify({successfulOperations:result.successfulOperations,apiAttempts:result.apiAttempts,apiConflicts:result.apiConflicts,storageConflicts:result.storageConflicts,peakDocumentBytes:result.peakDocumentBytes,elapsedMs:result.elapsedMs,latencyMs:result.latencyMs,fixtureSchemaRemoved:result.fixtureSchemaRemoved,publicTablesUnchanged:true,hostedTlsVerified:false}));
});

test('isolated PostgreSQL capacity refuses existing-schema takeover and cleans its exact new schema after failure',{skip:!testUrl,timeout:30000},async t=>{
 const h=await fixture(t),runId=String(Date.now()),schema=capacitySchema(runId);await h.source.query('CREATE SCHEMA "'+schema+'"');await h.source.query('CREATE TABLE "'+schema+'".untouched(id int)');
 await assert.rejects(stagingCapacityProof({...h.options,runId,scenario:()=>assert.fail('collision must stop before scenario')}),e=>e.code==='capacity_schema_collision');assert.equal((await h.source.query('SELECT count(*)::int AS n FROM "'+schema+'".untouched')).rows[0].n,0);
 await h.source.query('DROP TABLE "'+schema+'".untouched');await h.source.query('DROP SCHEMA "'+schema+'" RESTRICT');
 await assert.rejects(stagingCapacityProof({...h.options,runId,scenario:async()=>{throw Object.assign(Error('fixture failure'),{code:'capacity_injected_failure'});}}),e=>e.code==='capacity_injected_failure'&&e.capacityEvidence.fixtureSchemaRemoved&&e.capacityEvidence.publicTablesUnchanged);assert.equal((await h.source.query('SELECT to_regnamespace($1) AS schema',[schema])).rows[0].schema,null);
});
