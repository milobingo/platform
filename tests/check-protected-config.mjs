import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const check=values=>spawnSync(process.execPath,['scripts/check-config.mjs','--phase=runtime','--profile=local'],{encoding:'utf8',env:{PATH:process.env.PATH,NODE_ENV:'production',...values}});
test('a protected runtime can open beheer before provider credentials or a mail gateway exist',()=>{
 for(const values of [{MAIL_ENVIRONMENT:'staging'},{MAIL_ENVIRONMENT:'production'},{MAIL_ENVIRONMENT:'staging',MAIL_MODE:'allowlist',MAIL_ALLOWED_RECIPIENTS:'approved@example.test'},{MAIL_ENVIRONMENT:'production',MAIL_MODE:'live'}]){
  const result=check(values);assert.equal(result.status,0,result.stderr);
 }
});
test('server mail limits still reject live staging, invalid policy, recipients and a bad explicit gateway secret',()=>{
 for(const values of [{MAIL_ENVIRONMENT:'staging',MAIL_MODE:'live'},{MAIL_ENVIRONMENT:'other'},{MAIL_ENVIRONMENT:'production',MAIL_MODE:'unknown'},{MAIL_ENVIRONMENT:'staging',MAIL_MODE:'allowlist'},{MAIL_ENVIRONMENT:'staging',MAIL_MODE:'allowlist',MAIL_ALLOWED_RECIPIENTS:'invalid'},{MAIL_ENVIRONMENT:'production',MAIL_MODE:'live',SEND_EMAIL_HOOK_SECRET:'private-fixture-invalid'}]){
  const result=check(values);assert.notEqual(result.status,0);assert(!(result.stdout+result.stderr).includes('private-fixture-invalid'));
 }
});
