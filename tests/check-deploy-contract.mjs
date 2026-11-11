import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {X509Certificate,createHash} from 'node:crypto';
import {rootCertificates} from 'node:tls';
import {STAGING,RUNTIME_KEYS,BUILD_KEYS,validateReleaseSha,validateNativeHelperPin,validateCiRun,selectCiRun,validateIdentity,validateDeploymentConfiguration,validateRuntimeConfiguration,wrapperEnvironment,validateRuntimeDatabaseRole,verifyRuntimeDatabase} from '../scripts/deploy/release-preflight.mjs';

const releaseSha='a'.repeat(40),otherSha='b'.repeat(40),wrapperHash='c'.repeat(64);
const metadata={releaseSha,releaseId:'42000000001-1',configVersion:'staging-2026-11-05-v1',port:4190};
const goodRun=(overrides={})=>({id:41951694175,run_attempt:1,path:'.github/workflows/ci.yml',head_sha:releaseSha,head_branch:'main',event:'push',status:'completed',conclusion:'success',repository:{full_name:STAGING.repository},head_repository:{full_name:STAGING.repository},html_url:'https://github.com/milobingo/platform/actions/runs/41951694175',...overrides});
const testCa=new X509Certificate(rootCertificates.find(pem=>{const ca=new X509Certificate(pem);return ca.ca&&Date.parse(ca.validFrom)<=Date.now()&&Date.parse(ca.validTo)>Date.now();})).toString();
const testCaBase64=Buffer.from(testCa).toString('base64');
const values=()=>({APP_URL:STAGING.appUrl,SUPABASE_URL:`https://${STAGING.supabaseRef}.supabase.co`,SUPABASE_STORAGE_BUCKET:STAGING.bucket,SUPABASE_DB_CA_BASE64:testCaBase64,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test_only',SUPABASE_SECRET_KEY:'sb_secret_test_only',DATABASE_URL:`postgresql://postgres.${STAGING.supabaseRef}:test-only@db.${STAGING.supabaseRef}.supabase.co:5432/postgres?sslmode=verify-full`,VLAMPIE_SETTINGS_KEY:'01'.repeat(32)});

test('release selection accepts only a complete immutable source SHA',()=>{
 assert.equal(validateReleaseSha(releaseSha),releaseSha);
 for(const invalid of ['',null,'main','a'.repeat(39),'a'.repeat(41),'A'.repeat(40),'a'.repeat(40)+'\n','$(echo leak)'])assert.throws(()=>validateReleaseSha(invalid));
});

test('reviewed native entry transitively pins its exact helper before database apply',()=>{
 const entry=readFileSync(new URL('../infra/staging/deploy-entry.py',import.meta.url),'utf8');
 const helper=readFileSync(new URL('../infra/staging/deploy-helper.py',import.meta.url));
 const hash=createHash('sha256').update(helper).digest('hex');
 const rendered=entry.replace('__HELPER_SHA256__',hash);
 assert.equal(validateNativeHelperPin(rendered,helper),hash);
 assert.equal(STAGING.nativeHelper,'/usr/local/libexec/dg-milobingo-deploy-helper');
 assert.throws(()=>validateNativeHelperPin(rendered,Buffer.concat([helper,Buffer.from('\n# drift')])));
 for(const source of [entry,rendered+`\nHELPER_SHA256 = '${hash}'\n`,rendered.replace(`'${hash}'`,`'${hash.toUpperCase()}'`),rendered.replace(`'${hash}'`,`'${hash}' + ''`)])assert.throws(()=>validateNativeHelperPin(source,helper));
});

test('CI proof binds successful required workflow to its own repository, branch and exact SHA',()=>{
 assert.deepEqual(validateCiRun(goodRun(),releaseSha),{id:41951694175,attempt:1,url:'https://github.com/milobingo/platform/actions/runs/41951694175'});
 for(const changes of [
  {repository:{full_name:'attacker/platform'}},{head_repository:{full_name:'attacker/platform'}},
  {head_sha:otherSha},{head_branch:'feature'},{path:'.github/workflows/runner-test.yml'},
  {event:'pull_request'},{conclusion:'failure'},{status:'in_progress'},{run_attempt:0},
  {html_url:'https://attacker.example/success'},{id:'41951694175'},
 ])assert.throws(()=>validateCiRun(goodRun(changes),releaseSha));
});

test('a later failed CI run cannot be hidden behind an older passing run or a pull request run',()=>{
 const older=goodRun();
 const latest=goodRun({id:41951694176,html_url:'https://github.com/milobingo/platform/actions/runs/41951694176',conclusion:'failure'});
 assert.throws(()=>selectCiRun([older,latest],releaseSha),/laatste run/);
 const unrelated=goodRun({id:41951694177,event:'pull_request',html_url:'https://github.com/milobingo/platform/actions/runs/41951694177'});
 assert.throws(()=>selectCiRun([older,latest,unrelated],releaseSha));
 assert.equal(selectCiRun([unrelated,older],releaseSha).id,older.id);
});

test('dedicated runner and wrapper configuration fail closed on identity or unreviewed metadata',()=>{
 const identity={repository:STAGING.repository,runnerName:STAGING.runnerName,user:STAGING.runnerUser,host:STAGING.host,workspace:STAGING.workspace};
 assert.equal(validateIdentity(identity),true);
 for(const field of Object.keys(identity))assert.throws(()=>validateIdentity({...identity,[field]:'other'}));
 const configuration={DG_DEPLOY_WRAPPER_SHA256:wrapperHash,DG_STAGING_PORT:'4190',CONFIG_VERSION:'staging-v1'};
 assert.equal(validateDeploymentConfiguration(configuration).port,4190);
 for(const changes of [{DG_DEPLOY_WRAPPER_SHA256:''},{DG_DEPLOY_WRAPPER_SHA256:'HEAD'},{DG_STAGING_PORT:'80'},{DG_STAGING_PORT:'65536'},{DG_STAGING_PORT:'4190; id'},{CONFIG_VERSION:'bad\nmetadata'}])assert.throws(()=>validateDeploymentConfiguration({...configuration,...changes}));
});

test('runtime configuration is staging-only, keeps all privileged keys server-side and forces loopback',()=>{
 const runtime=validateRuntimeConfiguration(values(),metadata);
 assert.equal(runtime.HOSTNAME,'127.0.0.1');assert.equal(runtime.NODE_ENV,'production');assert.equal(runtime.MILO_LOCAL_AUTH,'false');assert.equal(runtime.RELEASE_SHA,releaseSha);assert.equal(runtime.PORT,'4190');
 assert.deepEqual(BUILD_KEYS,[]);assert(Object.keys(runtime).every(key=>RUNTIME_KEYS.includes(key)));
 for(const changes of [
  {APP_URL:'https://milo.dgwebservices.nl'},
  {SUPABASE_URL:'https://other.supabase.co'},
  {SUPABASE_STORAGE_BUCKET:'production'},
  {NEXT_PUBLIC_SUPABASE_SECRET_KEY:'sb_secret_must_not_be_public'},
  {GITHUB_TOKEN:'must-not-reach-app'},
  {DATABASE_URL:values().DATABASE_URL.replace('sslmode=verify-full','sslmode=disable')},
  {DATABASE_URL:values().DATABASE_URL.replace('sslmode=verify-full','sslmode=require')},
  {DATABASE_URL:values().DATABASE_URL.replace(`db.${STAGING.supabaseRef}.supabase.co`,'db.other-project.supabase.co')},
  {DATABASE_URL:values().DATABASE_URL+'&host=other-project.supabase.co'},
  {SUPABASE_DB_CA_BASE64:''},{SUPABASE_DB_CA_BASE64:'invalid-root-cert'},
  {SUPABASE_PUBLISHABLE_KEY:'sb_secret_wrong_key'},
  {OPENAI_API_KEY:'test-only\nSECOND_ENV=leak'},
  {LIVEKIT_URL:'wss://test.livekit.cloud'},
 ])assert.throws(()=>validateRuntimeConfiguration({...values(),...changes},metadata));
});

test('release metadata and local-mode overrides cannot override a verified runtime boundary',()=>{
 for(const changes of [{NODE_ENV:'development'},{HOSTNAME:'0.0.0.0'},{MILO_LOCAL_AUTH:'true'},{PORT:'4191'},{RELEASE_SHA:otherSha},{RELEASE_ID:'other-release'},{CONFIG_VERSION:'other-config'}])assert.throws(()=>validateRuntimeConfiguration({...values(),...changes},metadata));
 for(const changedMetadata of [{...metadata,releaseId:'42000000001\nAPP_URL=wrong'},{...metadata,configVersion:'../prod'},{...metadata,releaseSha:'main'}])assert.throws(()=>validateRuntimeConfiguration(values(),changedMetadata));
});

test('DG wrapper receives only approved runtime keys and basic process metadata',()=>{
 const runtime=validateRuntimeConfiguration(values(),metadata);
 const environment=wrapperEnvironment(runtime,{PATH:'/usr/bin',HOME:'/home/run-mil-stg',GITHUB_TOKEN:'github-test-secret',SSH_AUTH_SOCK:'/private/socket',MIGRATION_DATABASE_URL:'migration-admin-secret',BACKUP_ENCRYPTION_KEY:'backup-secret',RESTORE_TEST_DATABASE_URL:'restore-secret',DG_RUNTIME_ENV_KEYS:'GITHUB_TOKEN',AWS_SECRET_ACCESS_KEY:'aws-test-secret'});
 assert.equal(environment.PATH,'/usr/bin');assert.equal(environment.DG_BUILD_ENV_KEYS,'');
 assert.deepEqual(environment.DG_RUNTIME_ENV_KEYS.split(' '),Object.keys(runtime));
 for(const key of ['GITHUB_TOKEN','SSH_AUTH_SOCK','MIGRATION_DATABASE_URL','BACKUP_ENCRYPTION_KEY','RESTORE_TEST_DATABASE_URL','AWS_SECRET_ACCESS_KEY'])assert.equal(environment[key],undefined,key);
 assert.throws(()=>wrapperEnvironment({...runtime,DEPLOY_PASSWORD:'not-runtime'}));
});

test('normal deployment exposes no project secrets and builds only through the protected root broker',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/deploy-staging.yml',import.meta.url),'utf8');
 assert.match(workflow,/workflow_dispatch:/);assert.doesNotMatch(workflow,/^  (?:push|pull_request):/m);
 assert.match(workflow,/config_id:/);assert.doesNotMatch(workflow,/apply_database:/);
 assert.match(workflow,/deploy:\n    needs: release-gate/);
 assert.match(workflow,/runs-on: \[self-hosted, Linux, X64, dg-nxttrack-01, milobingo, staging\]/);
 assert.match(workflow,/name: staging/);assert.doesNotMatch(workflow,/name: production/);
 assert.doesNotMatch(workflow,/\$\{\{\s*(?:secrets|vars)\.|DATABASE_URL|OPENAI_API_KEY|LIVEKIT_API_SECRET|SUPABASE_SECRET_KEY|VLAMPIE_SETTINGS_KEY/);
 const deploy=workflow.slice(workflow.indexOf('  deploy:'),workflow.indexOf('\n  verify-public:'));
 assert.doesNotMatch(deploy,/actions\/checkout|pnpm install|pnpm build|scripts\/deploy/);
 assert.match(deploy,/JSON\.stringify\(\{githubToken:process\.env\.GITHUB_TOKEN\}\)/);
 assert.match(deploy,/\| \/usr\/local\/bin\/dg-milo-deploy deploy "\$RELEASE_SHA" "\$RELEASE_ID" "\$CONFIG_ID"/);
 assert.match(deploy,/test "\$result" != 75/);assert.match(deploy,/attempt in 1 2 3 4/);
 assert.match(workflow,/CONFIG_VERSION: \$\{\{ inputs.config_id \}\}/);
 const archived=readFileSync(new URL('../infra/legacy/github/staging-database-audit.yml.retired',import.meta.url),'utf8');
 assert.match(archived,/secrets.MIGRATION_DATABASE_URL/,'old management contract is preserved outside active workflows');
});

const properRole=()=>({user:'milo_app_staging',session_user:'milo_app_staging',login:true,backend_member:true,superuser:false,createdb:false,createrole:false,bypassrls:false,elevated_membership:false,unexpected_membership:false});
test('runtime accepts the separate backend LOGIN and rejects administrative role flags and memberships',()=>{
 assert.equal(validateRuntimeDatabaseRole(properRole()),true);
 for(const flag of ['superuser','createdb','createrole','bypassrls','elevated_membership','unexpected_membership'])assert.throws(()=>validateRuntimeDatabaseRole({...properRole(),[flag]:true}));
 for(const changes of [{login:false},{backend_member:false},{session_user:'postgres'},{}]){
  if(Object.keys(changes).length)assert.throws(()=>validateRuntimeDatabaseRole({...properRole(),...changes}));
 }
 assert.throws(()=>validateRuntimeDatabaseRole(null));
});

test('runtime database verification uses verified TLS and read-only role/table checks before releasing the connection',async t=>{
 const queries=[];let options,released=false,ended=false;
 t.mock.method(console,'log',()=>{});
 const poolFactory=input=>{options=input;return {on(){},connect:async()=>({query:async sql=>{queries.push(sql);return {rows:sql.startsWith('SELECT current_user')?[properRole()]:[]};},release(){released=true;}}),end:async()=>{ended=true;}};};
 await verifyRuntimeDatabase(values().DATABASE_URL,{poolFactory,tableNames:['app_user_roles','bingo_games'],caBase64:testCaBase64});
 assert.deepEqual(options.ssl,{rejectUnauthorized:true,ca:testCa.trim()+'\n'});assert.equal(options.sslnegotiation,'postgres');assert(!new URL(options.connectionString).searchParams.has('sslmode'));
 assert.equal(queries[0],'BEGIN READ ONLY');assert.match(queries[1],/pg_has_role/);assert(queries.includes('SELECT 1 FROM public."app_user_roles" LIMIT 0'));assert(queries.includes('SELECT 1 FROM public."bingo_games" LIMIT 0'));
 assert.equal(queries.at(-1),'ROLLBACK');assert(released&&ended);
 assert(!queries.some(sql=>/^(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/.test(sql)));
 const denied=[];
 const administrativePool=()=>({on(){},connect:async()=>({query:async sql=>{denied.push(sql);return {rows:sql.startsWith('SELECT current_user')?[{...properRole(),superuser:true}]:[]};},release(){}}),end:async()=>{}});
 await assert.rejects(verifyRuntimeDatabase(values().DATABASE_URL,{poolFactory:administrativePool,tableNames:['app_user_roles']}),/Runtime-databasecontrole mislukt/);
 assert(!denied.some(sql=>sql.startsWith('SELECT 1 FROM public.')));
});
