import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {rootCertificates} from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {validateProductionProfile,productionPaths,profileDigest,requireProfilePin} from '../scripts/deploy/production-profile.mjs';
import {renderProductionBundle} from '../scripts/deploy/production-render.mjs';
import {validateProductionRuntime,productionWrapperEnvironment,validateProductionStagingProof,validateProductionStagingAcceptance,productionReleaseGate,verifyProductionPublic,STAGING_ACCEPTANCE_CHECKS} from '../scripts/deploy/production-preflight.mjs';
import {selectDigestVisudo} from './helpers/sudoers-toolchain.mjs';
const sha='a'.repeat(40),stageId=303,releaseId='404-1';
// Isolated documentation/test fixtures, never a discovered production destination.
const profile={version:1,environment:'production',repository:'milobingo/platform',branch:'main',siteId:'milobingo-fixture',appUrl:'https://production.milo.example',host:'milo-fixture-host',runnerName:'milo-fixture-runner',runnerUser:'run-milo-fixture',buildUser:'build-milo-fixture',appUser:'app-milo-fixture',buildLockGroup:'dg-build',workspace:'/home/run-milo-fixture/_work/platform/platform',port:4173,supabaseRef:'a'.repeat(20),bucket:'milo-fixture',configVersion:'fixture-v1',mailMode:'allowlist'};
const ca=rootCertificates.find(pem=>{const c=new X509Certificate(pem);return c.ca&&Date.parse(c.validFrom)<=Date.now()&&Date.parse(c.validTo)>Date.now();});
const runtime=()=>({OPENAI_API_KEY:'dummy-provider-key-not-real',LIVEKIT_URL:'wss://fixture.livekit.cloud',LIVEKIT_API_KEY:'API_DUMMY_TEST',LIVEKIT_API_SECRET:'DUMMY_LIVEKIT_SECRET_NOT_REAL_12345',APP_URL:profile.appUrl,SUPABASE_URL:`https://${profile.supabaseRef}.supabase.co`,SUPABASE_STORAGE_BUCKET:profile.bucket,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_dummy',SUPABASE_SECRET_KEY:'sb_secret_dummy',VLAMPIE_SETTINGS_KEY:'c'.repeat(64),SUPABASE_DB_CA_BASE64:Buffer.from(ca).toString('base64'),DATABASE_URL:`postgresql://${productionPaths(profile).runtimeRole}:dummy@db.${profile.supabaseRef}.supabase.co:5432/postgres?sslmode=verify-full`,MAIL_ENVIRONMENT:'production',MAIL_MODE:'allowlist',MAIL_ALLOWED_RECIPIENTS:'approved@example.test',SEND_EMAIL_HOOK_SECRET:Buffer.alloc(32,5).toString('base64')});
const acceptance=()=>({format:1,releaseSha:sha,stagingRunId:stageId,stagingReleaseId:stageId+'-1',observedAt:new Date(Date.now()-1000).toISOString(),checks:Object.fromEntries(STAGING_ACCEPTANCE_CHECKS.map(name=>[name,{status:'passed',evidence:`verification/staging-${name}.json`}]))});
const stage=()=>({id:stageId,run_attempt:1,repository:{full_name:profile.repository},head_repository:{full_name:profile.repository},head_branch:'main',head_sha:sha,path:'.github/workflows/deploy-staging.yml',event:'workflow_dispatch',status:'completed',conclusion:'success',html_url:`https://github.com/milobingo/platform/actions/runs/${stageId}`});
const stageHealth=()=>({status:'ok',revision:sha,releaseId:stageId+'-1',configVersion:'staging-fixture-v1'});
const jobs=['release-gate','deploy','verify-public'].map(name=>({name,status:'completed',conclusion:'success'}));

test('production profile requires a real separate destination and rejects staging or injected configuration',async()=>{
 const incomplete=JSON.parse(await readFile(new URL('../infra/production/profile.example.json',import.meta.url),'utf8'));assert.throws(()=>validateProductionProfile(incomplete));
 assert.equal(validateProductionProfile(profile).port,4173,'Same port is valid on a different confirmed host');
 for(const change of [{host:'dg-nxttrack-01',port:4173},{appUrl:'https://milo-staging.dgwebservices.nl'},{supabaseRef:'lfsdgxcpdyghidzkzzvn'},{siteId:'milobingo-staging'},{runnerUser:'run-mil-stg'},{appUser:profile.runnerUser},{workspace:profile.workspace+'/..'},{host:'host;id'},{appUrl:'https://user:secret@production.milo.example'},{DATABASE_URL:'must-not-be-in-public-profile'}])assert.throws(()=>validateProductionProfile({...profile,...change}));
 assert.equal(profileDigest(profile),profileDigest(Object.fromEntries(Object.entries(profile).reverse())));assert.throws(()=>requireProfilePin(profile,'b'.repeat(64)));assert.equal(requireProfilePin(profile,profileDigest(profile)),true);
});

test('rendered production wrapper pins reviewed source and enforces fixed target and production mail policy',async t=>{
 const temporary=await mkdtemp(join(tmpdir(),'milo-production-render-'));t.after(()=>rm(temporary,{recursive:true,force:true}));
 const bundle=await renderProductionBundle(profile);assert.equal(bundle.manifest.installed,false);assert.equal(bundle.manifest.profileDigest,profileDigest(profile));
 for(const [name,file] of Object.entries(bundle.files))await writeFile(join(temporary,name),file.content);
 const helper=bundle.files['deploy-helper.py'].content,entry=bundle.files['deploy-entry.py'].content;
 assert(helper.startsWith('#!/usr/bin/python3 -I\n'));assert(entry.includes(bundle.manifest.files['deploy-helper.py'].sha256));
 for(const old of ['lfsdgxcpdyghidzkzzvn','milo-staging.dgwebservices.nl','run-mil-stg','build-mil-stg','app-mil-stg'])assert(!helper.includes(old));
 assert(bundle.files['site.caddy'].content.includes('header_up X-Forwarded-Proto https'));assert(bundle.files['service.unit'].content.includes('EnvironmentFile='+productionPaths(profile).siteRoot+'/current/.runtime.env'));
 assert(bundle.files['deploy-production.yml'].content.includes('DG_STAGING_ACCEPTANCE_JSON'));assert(!bundle.files['deploy-production.yml'].content.includes('--apply'));
 assert(bundle.files['production-provision-runtime.mjs'].content.includes("userInfo().username !== 'run-milo-fixture'"));assert(bundle.files['production-provision-runtime.mjs'].content.includes('process.getuid() === 0'));assert(!bundle.files['production-provision-runtime.mjs'].content.includes('process.getuid() !== 1001'));
 const values=validateProductionRuntime(profile,runtime(),{releaseSha:sha,releaseId});
 const python="import importlib.util,json,sys;sys.dont_write_bytecode=True;s=importlib.util.spec_from_file_location('prod',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);v=json.load(sys.stdin);assert m.arguments([m.SITE,m.WORKSPACE,sys.argv[2],sys.argv[3]])==(sys.argv[2],sys.argv[3]);assert m.runtime_values(v,sys.argv[2],sys.argv[3],int(v['PORT']))==v;print('native-policy-passed')";
 assert.equal(execFileSync('python3',['-I','-c',python,join(temporary,'deploy-helper.py'),sha,releaseId],{input:JSON.stringify(values),encoding:'utf8'}).trim(),'native-policy-passed');
 for(const change of [
  {MAIL_ENVIRONMENT:'staging'},
  {OPENAI_API_KEY:''},{LIVEKIT_URL:''},{LIVEKIT_API_KEY:''},{LIVEKIT_API_SECRET:''},
  {DATABASE_URL:values.DATABASE_URL.replace(productionPaths(profile).runtimeRole+':','postgres:')},
  {DATABASE_URL:values.DATABASE_URL.replace(':5432/',':6543/')},
  {DATABASE_URL:values.DATABASE_URL.replace('db.'+profile.supabaseRef+'.supabase.co','aws-fixture.pooler.supabase.com')},
  {DATABASE_URL:values.DATABASE_URL+'&host=attacker.example'},
 ]){const invalid={...values,...change};assert.notEqual(spawnSync('python3',['-I','-c',python,join(temporary,'deploy-helper.py'),sha,releaseId],{input:JSON.stringify(invalid),encoding:'utf8'}).status,0);}
 const pooled={...values,DATABASE_URL:values.DATABASE_URL.replace(productionPaths(profile).runtimeRole+':',productionPaths(profile).runtimeRole+'.'+profile.supabaseRef+':').replace('db.'+profile.supabaseRef+'.supabase.co','aws-fixture.pooler.supabase.com')};assert.equal(execFileSync('python3',['-I','-c',python,join(temporary,'deploy-helper.py'),sha,releaseId],{input:JSON.stringify(pooled),encoding:'utf8'}).trim(),'native-policy-passed');
 const {parser}=selectDigestVisudo();
 execFileSync(parser,['-cf',join(temporary,'deploy.sudoers')],{stdio:'pipe'});
});

test('sudoers parser selection requires digest support and rejects a no-op or incompatible pinned parser',()=>{
 const attempted=[];
 const run=(parser,args)=>{
  attempted.push(parser);
  if(args[0]==='--version')return {status:0,stdout:'visudo version fixture\n'};
  const policy=readFileSync(args[1],'utf8');
  return {status:parser.endsWith('/visudo.ws')&&!policy.includes('INVALID!')?0:1};
 };
 assert.equal(selectDigestVisudo({pinned:null,run}).parser,'/usr/sbin/visudo.ws');
 assert(!attempted.includes('/usr/sbin/visudo'));
 assert.throws(()=>selectDigestVisudo({pinned:'/usr/sbin/visudo',run}),/digest_capable_visudo_required/);
 assert.throws(()=>selectDigestVisudo({pinned:'/tmp/visudo',run}),/visudo_parser_path_not_allowed/);
 assert.throws(()=>selectDigestVisudo({pinned:null,run:()=>({status:0,stdout:'no-op'})}),/digest_capable_visudo_required/);
});

test('binding preserves confirmed names containing old tokens and port digits without cascading substitutions',async()=>{
 for(const change of [
  {siteId:'milobingo-4173',appUrl:'https://bingo4173.example',port:4200},
  {siteId:'milobingo-milo-staging',host:'dg-nxttrack-01.example',bucket:'run-mil-stg',port:4200},
  {siteId:'milobingo-stagingproject',host:'stagingproject.example',runnerName:'prod__WORKSPACE__',buildUser:'build-stagingrunner',appUser:'app-stagingdatabase',port:4200},
 ]){
  const p={...profile,...change},bundle=await renderProductionBundle(p),paths=productionPaths(p),helper=bundle.files['deploy-helper.py'].content,unit=bundle.files['service.unit'].content,caddy=bundle.files['site.caddy'].content,entry=bundle.files['deploy-entry.py'].content;
  assert(helper.includes("SITE = '"+p.siteId+"'"));assert(helper.includes("socket.gethostname() == '"+p.host+"'"));assert(helper.includes("values.get('SUPABASE_STORAGE_BUCKET') == '"+p.bucket+"'"));
  assert(unit.includes('WorkingDirectory='+paths.siteRoot+'/current/.next/standalone'));assert(unit.includes('EnvironmentFile='+paths.siteRoot+'/current/.runtime.env'));
  const provision=bundle.files['production-provision-runtime.mjs'].content;assert(provision.includes("const runtimeRole = '"+paths.runtimeRole+"'"));assert(provision.includes("hostname() !== '"+p.host+"'"));assert(bundle.files['deploy-production.yml'].content.includes("test \"$RUNNER_NAME\" = '"+p.runnerName+"'"));
  assert(caddy.includes(new URL(p.appUrl).hostname+' {'));assert(caddy.includes('header_up Host '+new URL(p.appUrl).hostname));assert(caddy.includes('reverse_proxy 127.0.0.1:'+p.port+' {'));assert(entry.includes("SITE = '"+p.siteId+"'"));
 }
});

test('production runtime binds TLS, limited account, mail mode and strips all deployment/build credentials',()=>{
 const values=validateProductionRuntime(profile,runtime(),{releaseSha:sha,releaseId});assert.equal(values.PORT,String(profile.port));assert.equal(values.MAIL_ENVIRONMENT,'production');
 const wrapped=productionWrapperEnvironment(values,{PATH:'/usr/bin',HOME:'/fixture',GITHUB_TOKEN:'never-forward',MIGRATION_DATABASE_URL:'never-forward',BACKUP_ENCRYPTION_KEY:'never-forward',RESTORE_TEST_DATABASE_URL:'never-forward',NODE_OPTIONS:'never-forward'});
 for(const key of ['GITHUB_TOKEN','MIGRATION_DATABASE_URL','BACKUP_ENCRYPTION_KEY','RESTORE_TEST_DATABASE_URL','NODE_OPTIONS'])assert(!Object.hasOwn(wrapped,key));assert(wrapped.DG_RUNTIME_ENV_KEYS.includes('SEND_EMAIL_HOOK_SECRET'));assert.equal(wrapped.DG_BUILD_ENV_KEYS,'');
 for(const key of ['OPENAI_API_KEY','LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET']){const incomplete=runtime();delete incomplete[key];assert.throws(()=>validateProductionRuntime(profile,incomplete,{releaseSha:sha,releaseId}));}
 for(const change of [{MAIL_ENVIRONMENT:'staging'},{MAIL_MODE:'live'},{MAIL_ALLOWED_RECIPIENTS:''},{SEND_EMAIL_HOOK_SECRET:'invalid'},{DATABASE_URL:runtime().DATABASE_URL.replace('db.'+profile.supabaseRef,'db.lfsdgxcpdyghidzkzzvn')},{DATABASE_URL:runtime().DATABASE_URL+'&host=attacker.example'},{DATABASE_URL:runtime().DATABASE_URL.replace('verify-full','no-verify')},{LIVEKIT_URL:'wss://attacker.example'}])assert.throws(()=>validateProductionRuntime(profile,{...runtime(),...change},{releaseSha:sha,releaseId}));
});

test('same-SHA staging proof requires exact successful workflow jobs and currently matching public release',()=>{
 assert.equal(validateProductionStagingProof(stage(),stageHealth(),jobs,sha).id,stageId);
 for(const [run,health,checks] of [[{...stage(),head_sha:'b'.repeat(40)},stageHealth(),jobs],[{...stage(),conclusion:'failure'},stageHealth(),jobs],[stage(),{...stageHealth(),releaseId:'other-1'},jobs],[stage(),stageHealth(),jobs.filter(job=>job.name!=='verify-public')]])assert.throws(()=>validateProductionStagingProof(run,health,checks,sha));
});

test('protected full staging acceptance cannot be inferred from health, pending checks or a different release',()=>{
 const binding={releaseSha:sha,stagingRunId:stageId,stagingReleaseId:stageId+'-1'};const good=acceptance();assert.equal(validateProductionStagingAcceptance(JSON.stringify(good),binding).checks.length,5);
 for(const change of [{releaseSha:'b'.repeat(40)},{stagingReleaseId:'other-1'},{observedAt:'invalid'},{checks:{...good.checks,familyAuth:{status:'pending',evidence:'verification/pending.json'}}},{checks:{...good.checks,mailGateway:{status:'disabled',evidence:'verification/disabled.json'}}},{checks:{...good.checks,showAudioAndLiveCall:{status:'passed',evidence:'https://attacker.example/proof'}}},{secret:'sk-dummy-no-secret-here'}])assert.throws(()=>validateProductionStagingAcceptance(JSON.stringify({...good,...change}),binding));
 const benign=acceptance();benign.checks.familyAuth.evidence='verification/staging-task-results.json';assert(validateProductionStagingAcceptance(JSON.stringify(benign),binding));
 assert.throws(()=>validateProductionStagingAcceptance(JSON.stringify(good),{...binding,notBefore:Date.now()}));
 assert.throws(()=>validateProductionStagingAcceptance('',binding));
});

test('promotion consults own exact CI, staging identity and protected complete acceptance without provider calls',async()=>{
 const ci={...stage(),id:202,path:'.github/workflows/ci.yml',event:'push',html_url:'https://github.com/milobingo/platform/actions/runs/202'};
 const env={DG_PRODUCTION_PROFILE_SHA256:profileDigest(profile),RELEASE_SHA:sha,STAGING_RUN_ID:String(stageId),GITHUB_REPOSITORY:profile.repository,GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_TOKEN:'dummy-read-only',DG_STAGING_ACCEPTANCE_JSON:JSON.stringify(acceptance())};
 const fetcher=async url=>{
  if(url==='https://milo-staging.dgwebservices.nl/api/health')return Response.json(stageHealth());
  assert(url.startsWith('https://api.github.com/repos/milobingo/platform/'));
  if(url.includes('/compare/'))return Response.json({status:'identical'});
  if(url.includes('/workflows/ci.yml/runs?'))return Response.json({workflow_runs:[ci]});
  if(url.endsWith('/actions/runs/202/attempts/1/jobs?per_page=100'))return Response.json({jobs:[{name:'verify',status:'completed',conclusion:'success'}]});
  if(url.endsWith(`/actions/runs/${stageId}`))return Response.json(stage());
  if(url.includes(`/actions/runs/${stageId}/attempts/1/jobs`))return Response.json({jobs});throw Error('Unexpected fixture endpoint');
 };
 const result=await productionReleaseGate(profile,env,{fetcher});assert.equal(result.status,'passed');assert.equal(result.stagingAcceptance.source,'protected-production-environment-record');
 await assert.rejects(productionReleaseGate(profile,{...env,DG_STAGING_ACCEPTANCE_JSON:''},{fetcher}));await assert.rejects(productionReleaseGate({...profile,mailMode:'disabled'},{...env,DG_PRODUCTION_PROFILE_SHA256:profileDigest({...profile,mailMode:'disabled'})},{fetcher}));
});

test('public production verification checks actual bytes and access boundaries without an account/provider call',async()=>{
 const calls=[];
 const fetcher=async(url,options)=>{calls.push(url);assert(url.startsWith(profile.appUrl));const path=url.slice(profile.appUrl.length);
  if(path==='/api/health')return Response.json({status:'ok',revision:sha,releaseId,configVersion:profile.configVersion});
  if(path==='/spelen?demo=1')return new Response('<script src="/_next/fixture.js"></script>');if(path.startsWith('/_next/'))return new Response('fixture chunk');
  if(path.startsWith('/assets/'))return new Response(readFileSync(join('public',path)));
  if(path==='/api/auth/session')return options.headers?.Origin?new Response(null,{status:403}):Response.json({authenticated:false,localAvailable:false,configured:true});
  if(path==='/api/bingo/games')return new Response(null,{status:401});if(path==='/auth/local')return new Response(null,{status:403});throw Error('Unexpected fixture endpoint');
 };
 const result=await verifyProductionPublic(profile,{releaseSha:sha,releaseId,fetcher});assert.equal(result.status,'passed');assert.equal(result.realAccountOrProviderCallsMade,false);assert(calls.length>=9);
});

test('production imports have no CLI side effects and incomplete default profile cannot render or deploy',async t=>{
 const marker='DUMMY_SECRET_MUST_NOT_APPEAR';
 const imported=spawnSync(process.execPath,['--input-type=module','-e',"process.argv[1]='/tmp/not-a-deploy-command';await import('./scripts/deploy/production-preflight.mjs');await import('./scripts/deploy/production-render.mjs');console.log('import-safe');"],{encoding:'utf8',env:{...process.env,OPENAI_API_KEY:marker}});assert.equal(imported.status,0);assert.equal(imported.stdout.trim(),'import-safe');assert.equal(imported.stderr,'');
 const temporary=await mkdtemp(join(tmpdir(),'milo-production-block-'));t.after(()=>rm(temporary,{recursive:true,force:true}));const output=join(temporary,'not-created');
 const rendered=spawnSync(process.execPath,['scripts/deploy/production-render.mjs','--profile=infra/production/profile.example.json','--output='+output],{encoding:'utf8',env:{...process.env,OPENAI_API_KEY:marker}});assert.notEqual(rendered.status,0);assert(!existsSync(output));assert(!(rendered.stdout+rendered.stderr).includes(marker));
});
