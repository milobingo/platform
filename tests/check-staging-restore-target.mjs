import test from 'node:test';
import assert from 'node:assert/strict';
import {stagingRestoreTargetOptions} from '../scripts/deploy/staging-restore-target.mjs';

const valid='postgresql://supabase_admin:fixture-only%40password@127.0.0.1:55433/milo_restore_test_v70_20261109_1';
test('scratch validation constructs only explicit fixed pg fields, without reparsing URL options',()=>{
 const options=stagingRestoreTargetOptions(valid);
 assert.deepEqual(options,{host:'127.0.0.1',port:55433,user:'supabase_admin',password:'fixture-only@password',database:'milo_restore_test_v70_20261109_1',ssl:false,max:1,connectionTimeoutMillis:10000,statement_timeout:15000});
 assert(!Object.hasOwn(options,'connectionString'));assert.deepEqual(stagingRestoreTargetOptions(valid.replace('postgresql:','postgres:')),options);
});

test('scratch validation rejects every query, authority/TLS override, wrong destination and missing credential before pg sees it',()=>{
 const inputs=[undefined,'not-a-connection',valid.replace('postgresql:','https:'),valid.replace('127.0.0.1','localhost'),valid.replace('127.0.0.1','100.79.0.26'),valid.replace(':55433/',':5432/'),valid.replace('/milo_restore_test_v70_','/postgres_'),valid.replace('supabase_admin:fixture-only%40password@','supabase_admin@'),valid.replace('supabase_admin:fixture-only%40password@',':fixture-only@'),valid+'#fragment',valid+'#',valid+'?',valid+'?host=source.example',valid+'?hostaddr=127.0.0.2',valid+'?port=5432',valid+'?database=postgres',valid+'?sslmode=require',valid+'?options=-c%20default_transaction_read_only=off',valid.replace('supabase_admin','%00admin'),' '+valid];
 for(const input of inputs)assert.throws(()=>stagingRestoreTargetOptions(input),error=>error.code==='staging_restore_target'&&!error.message.includes('fixture-only')&&!error.message.includes('source.example'));
});
