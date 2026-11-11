import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,cp} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {rootCertificates} from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {renderProtectedProductionBundle,protectedProductionPaths,PROTECTED_PRODUCTION_TEMPLATE_PINS} from '../scripts/deploy/protected-production-render.mjs';
import {profileDigest,sha256} from '../scripts/deploy/production-profile.mjs';
import {PROTECTED_PRODUCTION_ACCEPTANCE_CHECKS,PROTECTED_PRODUCTION_CHECKS,validateProtectedProductionAcceptance,verifyProtectedProductionRelease,verifyProtectedProductionPublic,readProtectedProductionFile} from '../scripts/deploy/protected-production-root-gate.mjs';
import {selectDigestVisudo} from './helpers/sudoers-toolchain.mjs';

// Public test-only identities; these are never discovered deployment targets.
const profile={version:1,environment:'production',repository:'milobingo/platform',branch:'main',siteId:'milobingo-fixture',appUrl:'https://production.milo.example',host:'milo-fixture-host',runnerName:'milo-fixture-runner',runnerUser:'run-milo-fixture',buildUser:'build-milo-fixture',appUser:'app-milo-fixture',buildLockGroup:'dg-build',workspace:'/home/run-milo-fixture/_work/platform/platform',port:4173,supabaseRef:'a'.repeat(20),bucket:'milo-fixture',configVersion:'fixture-v2',mailMode:'allowlist'};
const accounts=Object.fromEntries([profile.runnerUser,profile.buildUser,profile.appUser].map((name,i)=>[name,{uid:3100+i,gid:3200+i}]));
const metadata={accounts,configIds:['fixture-v2','fixture-v3']},sha='a'.repeat(40),head='c'.repeat(40),stageControl='b'.repeat(40),now=Date.now();
let cached;const bundle=()=>cached??=(renderProtectedProductionBundle(profile,metadata));
const input=()=>({repository:profile.repository,integrationBranch:'main',sha,requiredChecks:PROTECTED_PRODUCTION_CHECKS,githubToken:'synthetic-read-only-token',deploymentRun:{id:'300',attempt:1},deploymentWorkflow:'deploy-production.yml'});
const acceptance=()=>({format:1,releaseSha:sha,stagingRunId:200,stagingReleaseId:'200-2',observedAt:new Date(now-1000).toISOString(),checks:Object.fromEntries(PROTECTED_PRODUCTION_ACCEPTANCE_CHECKS.map(name=>[name,{status:'passed',evidence:'verification/staging-'+name+'.json'}]))});
function githubFixture(change={}){
 const calls=[];
 const repository={full_name:profile.repository},base={repository,head_repository:repository,head_branch:'main'};
 const ci={...base,id:100,run_attempt:1,head_sha:sha,workflow_id:10,status:'completed',conclusion:'success',event:'push'};
 const stage={...base,id:200,run_attempt:2,head_sha:stageControl,workflow_id:20,status:'completed',conclusion:'success',event:'workflow_dispatch',path:'.github/workflows/deploy-staging.yml',html_url:'https://github.com/milobingo/platform/actions/runs/200',run_started_at:new Date(now-120000).toISOString(),updated_at:new Date(now-60000).toISOString(),...change.stage};
 const production={...base,id:300,run_attempt:1,head_sha:head,workflow_id:30,status:'in_progress',conclusion:null,event:'workflow_dispatch',...change.production};
 const health={status:'ok',revision:sha,releaseId:'200-2',configVersion:'staging-v2',...change.health};
 const fetchFn=async(target,options={})=>{
  const url=new URL(target);calls.push({url:url.href,options});assert.equal(options.redirect,'error');
  if(url.origin==='https://milo-staging.dgwebservices.nl'){assert.equal(url.pathname,'/api/health');assert.equal(new Headers(options.headers).has('authorization'),false);return Response.json(health);}
  assert.equal(url.origin,'https://api.github.com');assert.equal(new Headers(options.headers).get('authorization'),'Bearer synthetic-read-only-token');
  const path=url.pathname.replace('/repos/milobingo/platform','');
  if(!path)return Response.json({id:1,full_name:profile.repository});
  if(path==='/branches/main')return Response.json({name:'main',commit:{sha:head}});
  if(path==='/commits/'+sha)return Response.json({sha});
  if(path.startsWith('/compare/'))return Response.json({status:change.ancestry||'ahead',base_commit:{sha:path.slice('/compare/'.length).split('...')[0]}});
  if(path.startsWith('/actions/workflows/')){
   const id=path.split('/')[3];
   if(id==='10'&&path.endsWith('/runs'))return Response.json({workflow_runs:change.ciRuns||[ci]});
   const names={'ci.yml':10,'deploy-staging.yml':20,'deploy-production.yml':30};assert(names[id]);return Response.json({id:names[id],state:'active',path:'.github/workflows/'+id});
  }
  if(path==='/actions/runs/100/attempts/1/jobs')return Response.json({jobs:[{name:'verify',run_id:100,head_sha:sha,status:'completed',conclusion:'success',...change.ciJob}]});
  if(path==='/actions/runs/200/attempts/2/jobs')return Response.json({jobs:change.stageJobs||['release-gate','deploy','verify-public'].map(name=>({name,run_id:200,head_sha:stageControl,status:'completed',conclusion:'success'}))});
  if(path==='/actions/runs/100')return Response.json({...ci,...change.latestCi});
  if(path==='/actions/runs/200')return Response.json(stage);
  if(path==='/actions/runs/300')return Response.json(production);
  throw Error('Unexpected external evidence request: '+url.href);
 };
 return {fetchFn,calls,ci};
}
const proofOptions=(fixture,change={})=>({fetchFn:fixture.fetchFn,now,loadRootPolicy:async path=>{assert.equal(path,'/etc/dg-sites/'+profile.siteId+'/protected-deploy.json');return JSON.stringify({productionProfileSha256:profileDigest(profile)});},loadAcceptance:async path=>{assert.equal(path,'/etc/dg-sites/'+profile.siteId+'/staging-acceptance/'+sha+'.json');return JSON.stringify(acceptance());},...change});

test('protected production refuses incomplete profiles, unverified account metadata and unsafe or missing immutable config IDs',async()=>{
 const empty=JSON.parse(await readFile(new URL('../infra/production/profile.example.json',import.meta.url),'utf8'));await assert.rejects(renderProtectedProductionBundle(empty,metadata));
 for(const p of [{...profile,host:'dg-nxttrack-01',port:4173},{...profile,supabaseRef:'lfsdgxcpdyghidzkzzvn'},{...profile,appUrl:'https://milo-staging.dgwebservices.nl'}])await assert.rejects(renderProtectedProductionBundle(p,metadata));
 for(const options of [{},{...metadata,accounts:null},{...metadata,accounts:{...accounts,[profile.runnerUser]:{uid:0,gid:3200}}},{...metadata,accounts:{...accounts,[profile.appUser]:accounts[profile.buildUser]}},{...metadata,configIds:[]},{...metadata,configIds:['other-v1']},{...metadata,configIds:['fixture-v2','../escape']},{...metadata,configIds:['fixture-v2','fixture-v2']}])await assert.rejects(renderProtectedProductionBundle(profile,options));
});
test('review bundle binds production paths, root profile pin, helper hashes and source provenance without GitHub secrets or runtime variables',async()=>{
 const b=await bundle(),paths=protectedProductionPaths(profile),policy=JSON.parse(b.files['protected-deploy.json'].content);assert.equal(b.manifest.installed,false);assert.equal(b.manifest.credentialsIncluded,false);assert.equal(b.manifest.profileDigest,profileDigest(profile));assert.equal(policy.productionProfileSha256,profileDigest(profile));assert.equal(policy.legacySha256,sha256(b.files['legacy-deploy-helper.py'].content));
 for(const [key,file] of [['gateSha256','release-gate.mjs'],['extractorSha256','extract-source.py'],['guardianSha256','lock-guardian.py']])assert.equal(policy[key],sha256(b.files[file].content));
 assert(b.files['deploy-entry.py'].content.includes(sha256(b.files['deploy-helper.py'].content)));assert.equal(b.files['deploy-entry.py'].path,paths.entry);assert.equal(b.files['deploy-helper.py'].path,paths.helper);assert.equal(b.files['legacy-deploy-helper.py'].path,paths.legacyHelper);
 const workflow=b.files['deploy-production.yml'].content;assert(!workflow.includes('secrets.'));assert(!workflow.includes('vars.'));assert(!workflow.includes('DG_STAGING_ACCEPTANCE_JSON'));assert(workflow.includes('github.token'));assert(workflow.includes('inputs.release_sha'));assert(workflow.includes('inputs.config_id'));assert(workflow.includes('test "$RUNNER_NAME" = \''+profile.runnerName+'\''));assert.equal((workflow.match(/actions\/checkout@/g)||[]).length,2,'Only hosted gates check out code');
 assert(b.files['service.unit'].content.includes('User='+profile.appUser));assert(b.files['service.unit'].content.includes('/srv/sites/'+profile.siteId+'/current/.runtime.env'));assert(b.files['site.caddy'].content.includes('reverse_proxy 127.0.0.1:'+profile.port));
 for(const [name,pin] of Object.entries(PROTECTED_PRODUCTION_TEMPLATE_PINS))assert.equal(sha256(await readFile(new URL('../'+name,import.meta.url))),pin);
 assert(b.manifest.sourcePins['scripts/deploy/protected-production-root-gate.mjs']);assert(b.manifest.sourcePins['scripts/deploy/production-profile.mjs']);assert(!/from ["'](?:pg|\.{1,2}\/)/.test(b.files['release-gate.mjs'].content),'Installed root code has no pg or mutable repository dependency');
});
test('production binding replaces original template bytes once even when confirmed target strings contain staging tokens',async()=>{
 const p={...profile,siteId:'milobingo-milo-staging',host:'dg-nxttrack-01.example',bucket:'run-mil-stg',port:4200},b=await renderProtectedProductionBundle(p,metadata),paths=protectedProductionPaths(p);
 assert(b.files['deploy-helper.py'].content.includes("SITE = '"+p.siteId+"'"));assert(b.files['deploy-helper.py'].content.includes("HOST = '"+p.host+"'"));assert(b.files['deploy-helper.py'].content.includes("LEGACY = Path('"+paths.legacyHelper+"')"));assert(b.files['legacy-deploy-helper.py'].content.includes("values.get('SUPABASE_STORAGE_BUCKET') == 'run-mil-stg'"));assert(b.files['site.caddy'].content.includes('reverse_proxy 127.0.0.1:4200'));
});
test('rendered Python preserves infrastructure validation while rejecting delivery env and keeps settings mode out of runtime.json',async t=>{
 const b=await bundle(),dir=await mkdtemp(join(tmpdir(),'milo-protected-prod-'));t.after(()=>rm(dir,{recursive:true,force:true}));for(const [name,file] of Object.entries(b.files))await writeFile(join(dir,name),file.content);
 const ca=rootCertificates.find(pem=>{const cert=new X509Certificate(pem);return cert.ca&&Date.parse(cert.validFrom)<=now&&Date.parse(cert.validTo)>now;});
 const values={NODE_ENV:'production',HOSTNAME:'127.0.0.1',MILO_LOCAL_AUTH:'false',PORT:String(profile.port),RELEASE_SHA:sha,RELEASE_ID:'300-1',CONFIG_VERSION:'fixture-v2',APP_URL:profile.appUrl,SUPABASE_URL:'https://'+profile.supabaseRef+'.supabase.co',SUPABASE_STORAGE_BUCKET:profile.bucket,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SECRET_KEY:'sb_secret_fixture',VLAMPIE_SETTINGS_KEY:'d'.repeat(64),SUPABASE_DB_CA_BASE64:Buffer.from(ca).toString('base64'),DATABASE_URL:'postgresql://milobingo_fixture_runtime:synthetic@db.'+profile.supabaseRef+'.supabase.co:5432/postgres?sslmode=verify-full',MAIL_ENVIRONMENT:'production'};
 const check="import importlib.util,json,sys;sys.dont_write_bytecode=True;s=importlib.util.spec_from_file_location('legacy',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);v=json.load(sys.stdin);assert m.runtime_values(v,sys.argv[2],'300-1',int(v['PORT']))==v;print('valid')";
 assert.equal(execFileSync('python3',['-I','-c',check,join(dir,'legacy-deploy-helper.py'),sha],{input:JSON.stringify(values),encoding:'utf8'}).trim(),'valid');
 for(const change of [{MAIL_MODE:'disabled'},{MAIL_MODE:'live'},{MAIL_ENVIRONMENT:'staging'},{SEND_EMAIL_HOOK_SECRET:'synthetic'},{MAIL_ALLOWED_RECIPIENTS:'parent@example.test'},{DATABASE_URL:values.DATABASE_URL.replace('milobingo_fixture_runtime:','postgres:')},{APP_URL:'https://evil.example'},{SUPABASE_URL:'https://lfsdgxcpdyghidzkzzvn.supabase.co'}])assert.notEqual(spawnSync('python3',['-I','-c',check,join(dir,'legacy-deploy-helper.py'),sha],{input:JSON.stringify({...values,...change})}).status,0);
 const brokerCheck="import importlib.util,json,sys;sys.dont_write_bytecode=True;s=importlib.util.spec_from_file_location('broker',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);assert m.PORT==int(sys.argv[2]);assert str(m.SITE_LOCK).endswith('/'+m.SITE+'.deploy.lock');assert str(m.GLOBAL_LOCK)=='/run/lock/dg-build.lock';assert m.arguments(['deploy',sys.argv[3],'300-1','fixture-v2']);print('broker-valid')";
 assert.equal(execFileSync('python3',['-I','-c',brokerCheck,join(dir,'deploy-helper.py'),String(profile.port),sha],{encoding:'utf8'}).trim(),'broker-valid');
 assert(b.files['deploy-helper.py'].content.includes("'MAIL_ENVIRONMENT': 'production'"));assert(b.files['deploy-helper.py'].content.includes("- {'MAIL_ENVIRONMENT', 'MAIL_MODE', 'MAIL_ALLOWED_RECIPIENTS', 'SEND_EMAIL_HOOK_SECRET'}"));
 execFileSync(selectDigestVisudo().parser,['-cf',join(dir,'deploy.sudoers')],{stdio:'pipe'});
});
test('unreviewed protected source drift refuses rendering rather than silently installing altered root code',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'milo-protected-source-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const name of ['infra/staging/deploy-entry.py','infra/staging/deploy-helper.py','infra/staging/milobingo-staging.service.example','infra/staging/Caddyfile.example','scripts/deploy/provision-runtime.mjs','infra/production/deploy-production.yml.template',...Object.keys(PROTECTED_PRODUCTION_TEMPLATE_PINS)]){await import('node:fs/promises').then(fs=>fs.mkdir(dirname(join(dir,name)),{recursive:true}));await cp(new URL('../'+name,import.meta.url),join(dir,name));}
 await writeFile(join(dir,'infra/protected/deploy-entry.py'),'# unreviewed modified entry\n');await assert.rejects(renderProtectedProductionBundle(profile,{...metadata,sourceRoot:dir}),/beoordeelde/);
});
test('root production gate accepts exact green CI, own running workflow and actual same-SHA staging with five separately recorded checks',async()=>{
 const fixture=githubFixture(),proof=await verifyProtectedProductionRelease(profile,input(),proofOptions(fixture));assert.equal(proof.sha,sha);assert.equal(proof.staging.releaseId,'200-2');assert.equal(proof.stagingAcceptance.checks.length,5);assert.equal(proof.stagingAcceptance.source,'root-only-production-staging-acceptance-record');assert.equal(proof.deploymentRunUrl,'https://github.com/milobingo/platform/actions/runs/300');assert.equal(proof.profileDigest,profileDigest(profile));assert(!JSON.stringify(proof).includes(input().githubToken));
 assert.notEqual(stageControl,sha,'The staging workflow control source may be newer than its explicit candidate');assert(fixture.calls.every(call=>!call.url.includes('resend')&&!call.url.includes('supabase')));
});
test('latest CI, exact jobs, main ancestry and own in-progress production attempt are independently required',async()=>{
 for(const change of [{ciJob:{conclusion:'failure'}},{latestCi:{run_attempt:2}},{ancestry:'behind'},{production:{status:'completed',conclusion:'success'}},{production:{run_attempt:2}},{production:{head_repository:{full_name:'fork/platform'}}}]){const fixture=githubFixture(change);await assert.rejects(verifyProtectedProductionRelease(profile,input(),proofOptions(fixture)));}
 const fixture=githubFixture(),newest={...fixture.ci,id:101,conclusion:'failure'};const failed=githubFixture({ciRuns:[fixture.ci,newest]});await assert.rejects(verifyProtectedProductionRelease(profile,input(),proofOptions(failed)),/Latest/);
 for(const change of [{deploymentWorkflow:'deploy-staging.yml'},{repository:'fork/platform'},{sha:'b'.repeat(40)},{deploymentRun:{id:'300',attempt:0}}])await assert.rejects(verifyProtectedProductionRelease(profile,{...input(),...change},proofOptions(githubFixture())));
});
test('actual staging run, health, all three job identities and full five-check root record cannot be substituted or inferred',async()=>{
 for(const change of [{stage:{conclusion:'failure'}},{stage:{run_attempt:3}},{stage:{head_branch:'feature'}},{health:{revision:'b'.repeat(40)}},{health:{releaseId:'201-1'}},{stageJobs:[{name:'release-gate',status:'completed',conclusion:'success'}]}]){const fixture=githubFixture(change);await assert.rejects(verifyProtectedProductionRelease(profile,input(),proofOptions(fixture)));}
 const binding={releaseSha:sha,stagingRunId:200,stagingReleaseId:'200-2',now,notBefore:now-60000};const good=acceptance();assert.equal(validateProtectedProductionAcceptance(JSON.stringify(good),binding).checks.length,5);
 for(const change of [{releaseSha:'b'.repeat(40)},{stagingRunId:201},{stagingReleaseId:'200-1'},{observedAt:new Date(now-120000).toISOString()},{observedAt:new Date(now+1000).toISOString()},{checks:{...good.checks,mailGateway:{status:'disabled',evidence:'verification/mail.json'}}},{checks:{...good.checks,familyAuth:{status:'pending',evidence:'verification/auth.json'}}},{checks:{...good.checks,showAudioAndLiveCall:{status:'passed',evidence:'https://evil.example/proof'}}},{extra:'unreviewed'}])assert.throws(()=>validateProtectedProductionAcceptance(JSON.stringify({...good,...change}),binding));
 const fixture=githubFixture();await assert.rejects(verifyProtectedProductionRelease(profile,input(),proofOptions(fixture,{loadAcceptance:async()=>{throw Error('missing');}})),/record is missing/);await assert.rejects(verifyProtectedProductionRelease(profile,input(),proofOptions(fixture,{loadRootPolicy:async()=>JSON.stringify({productionProfileSha256:'0'.repeat(64)})})),/profile pin/);
});
test('hosted gate may report pending root acceptance but cannot manufacture the five-check root receipt',async()=>{
 const fixture=githubFixture(),result=await verifyProtectedProductionRelease(profile,input(),{...proofOptions(fixture),requireAcceptance:false,loadAcceptance:()=>{throw Error('Hosted code cannot read root acceptance');}});assert.equal(result.acceptanceRequired,false);assert(!result.stagingAcceptance);
 const b=await bundle();assert(b.files['release-gate.mjs'].content.includes('runInstalledProtectedProductionGate'));assert(b.files['release-gate.mjs'].content.includes('requireAcceptance = true'));assert(!b.files['deploy-helper.py'].content.includes('requireAcceptance'));
});
test('the actual installed gate subprocess has one production CLI and consumes stdin without running the staging CLI',async t=>{
 const b=await bundle(),dir=await mkdtemp(join(tmpdir(),'milo-production-gate-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));const gate=join(dir,'installed-gate.mjs');await writeFile(gate,b.files['release-gate.mjs'].content,{mode:0o600});
 const result=spawnSync(process.execPath,[gate,'--stdin'],{input:'{}',encoding:'utf8',cwd:dir,env:{PATH:process.env.PATH},timeout:5000});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.deepEqual(result.stderr.trim().split('\n'),['Protected production gate refused: exact CI, own running workflow and complete root-owned staging acceptance are required.']);assert.equal(b.manifest.stagingGateCliRemoved,true);
});
test('root-only record reader refuses a runner-owned file or symbolic path rather than accepting writable evidence',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'milo-untrusted-record-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'acceptance.json');await writeFile(path,JSON.stringify(acceptance()),{mode:0o600});assert.throws(()=>readProtectedProductionFile(path));
});
test('public production verifier binds health to the chosen config ID and preserves anonymous auth/asset checks without providers',async()=>{
 const fetchFn=async(target,options={})=>{const url=new URL(target);assert.equal(url.origin,profile.appUrl);assert.equal(options.redirect,'error');if(url.pathname==='/api/health')return Response.json({status:'ok',revision:sha,releaseId:'300-1',configVersion:'fixture-v3'});if(url.pathname==='/spelen')return new Response('<script src="/_next/static/fixture.js"></script>');if(url.pathname.startsWith('/_next/'))return new Response('script');if(url.pathname.startsWith('/assets/'))return new Response(readFileSync(resolve('public'+url.pathname)));if(url.pathname==='/api/auth/session')return options.headers?.Origin?new Response(null,{status:403}):Response.json({authenticated:false,localAvailable:false,configured:true});if(url.pathname==='/api/bingo/games')return new Response(null,{status:401});if(url.pathname==='/auth/local')return new Response(null,{status:403});throw Error('Unexpected request');};
 assert.equal((await verifyProtectedProductionPublic(profile,{releaseSha:sha,releaseId:'300-1',configId:'fixture-v3',fetchFn})).status,'passed');await assert.rejects(verifyProtectedProductionPublic(profile,{releaseSha:sha,releaseId:'300-1',configId:'wrong-config',fetchFn}),/identity/);
});
