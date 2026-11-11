import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createStorageEnvironment} from '../server/node-storage.js';
import {inspectWorkspace} from '../scripts/deploy/staging-workspace-preflight.mjs';

async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'milo-workspace-preflight-'));
 const storage=await createStorageEnvironment({SQLITE_PATH:join(directory,'test.sqlite'),OBJECT_STORAGE_PATH:join(directory,'objects')});
 t.after(async()=>{await storage.close();await rm(directory,{recursive:true,force:true});});
 return {directory,...storage,VLAMPIE_SETTINGS_KEY:'07'.repeat(32),OPENAI_API_KEY:'sk-fixture-only-not-a-real-key',LIVEKIT_URL:'wss://fixture.livekit.cloud',LIVEKIT_API_KEY:'fixture-api-key',LIVEKIT_API_SECRET:'fixture-secret-not-a-real-key'};
}

test('read-only workspace preflight opens both mail catalogues and redacted native settings',async t=>{
 const env=await fixture(t),before=await readdir(join(env.directory,'objects'));
 const result=await inspectWorkspace(env);
 assert.equal(result.status,'passed');assert.deepEqual(result.templates.map(row=>[row.brand,row.templateCount]),[['milo',17],['vlampie',17]]);
 assert.equal(result.providerSettingsEditable,true);assert.equal(result.storedCredentialsReturned,false);
 assert.deepEqual(result.readableProviders,['openai','livekit','resend']);
 assert.equal(result.databaseWrites,0);assert.equal(result.objectWrites,0);assert.equal(result.providerRequests,0);assert.equal(result.realAccountLoginVerified,false);
 assert(!JSON.stringify(result).includes('sk-fixture'));assert(!JSON.stringify(result).includes(env.LIVEKIT_API_SECRET));
 assert.deepEqual(await readdir(join(env.directory,'objects')),before);
 assert.equal((await env.DB.prepare('SELECT count(*) AS total FROM studio_mail_records').first()).total,0);
});

test('unavailable private storage fails the deployment gate without leaking its error contents',async t=>{
 const env=await fixture(t);
 env.SETTINGS={get:async()=>{throw Error('private-secret-fixture-value');}};
 await assert.rejects(inspectWorkspace(env),error=>error.phase==='mail_state_milo'&&!error.message.includes('private-secret'));
});

test('workspace CLI refuses an unbound target before any database or storage access',()=>{
 let stdout='';
 try{execFileSync(process.execPath,['scripts/deploy/staging-workspace-preflight.mjs'],{env:{PATH:process.env.PATH,APP_URL:'https://unrelated.example',DATABASE_URL:'do-not-connect-secret'},encoding:'utf8',stdio:['ignore','pipe','pipe']});assert.fail('Unbound target must fail');}
 catch(error){assert.equal(error.status,1);stdout=error.stdout;}
 const result=JSON.parse(stdout);assert.equal(result.status,'failed');assert.equal(result.phase,'target');assert(!stdout.includes('do-not-connect-secret'));
});
