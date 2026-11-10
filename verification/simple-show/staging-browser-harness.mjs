import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,access,readdir,rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {join} from 'node:path';

const repo='/home/codex/repos/milobingo';
const sha=process.argv[2];assert.match(sha,/^[a-f0-9]{40}$/);
const expectedBrowsers=Number(process.argv[4]);assert(Number.isSafeInteger(expectedBrowsers));
const run=Number(process.argv[3]);assert(Number.isSafeInteger(run)&&run>0);const releaseId=run+'-1',configVersion='staging-2026-11-05-v1';
const origin='https://milo-staging.dgwebservices.nl';
const directory=join(repo,'verification/simple-show/staging',sha,releaseId);
const testFiles=['playwright.config.mjs','tests/browser/family.spec.mjs','tests/browser/handoff-v6.spec.mjs','tests/browser/handoff-v70.spec.mjs','tests/browser/regie-settings.spec.mjs','tests/browser/start-rules.spec.mjs','tests/browser/obs-source.spec.mjs','tests/browser/broadcast-preparation.spec.mjs'];
const localFiles=['verification/browser-tests.json','verification/simple-show/local-browser-tests.json','verification/simple-show/browser.log'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fileHashes=async files=>Object.fromEntries(await Promise.all(files.map(async file=>[file,hash(await readFile(join(repo,file)))])));
const job=JSON.parse(execFileSync('gh',['run','view',String(run),'--repo','milobingo/platform','--json','status,conclusion,headSha,jobs,url'],{encoding:'utf8'}));
assert.equal(job.headSha,sha);assert.equal(job.status,'completed');assert.equal(job.conclusion,'success');assert.equal(job.jobs.length,3);assert(job.jobs.every(item=>item.status==='completed'&&item.conclusion==='success'));
const sources=await fileHashes(testFiles);
for(const file of testFiles)assert.equal(sources[file],hash(execFileSync('git',['show',sha+':'+file],{cwd:repo})),file+' must match the deployed commit');
const localBefore=await fileHashes(localFiles);
const health=async()=>{
 const response=await fetch(origin+'/api/health',{cache:'no-store',signal:AbortSignal.timeout(10000)}),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.status,'ok');assert.equal(body.revision,sha);assert.equal(body.releaseId,releaseId);assert.equal(body.configVersion,configVersion);
 return {observedAt:new Date().toISOString(),httpStatus:response.status,status:body.status,revision:body.revision,releaseId:body.releaseId,configVersion:body.configVersion,checks:body.checks};
};
const preHealth=await health();
await mkdir(directory,{recursive:true});
try{await access(join(directory,'release-acceptance.json'));throw Error('This release already has acceptance evidence; do not overwrite.');}catch(error){if(error.code!=='ENOENT')throw error;}
// The isolated in-memory SQLite fixture resolves drizzle from cwd. Materialize
// only release-pinned SQL here so test outputs cannot overwrite local evidence.
const fixtureSql = (await readdir(join(repo,'drizzle'))).filter(name=>name.endsWith('.sql')).sort();
const fixtureMigrations = {};
await mkdir(join(directory,'drizzle'),{recursive:true});
for(const name of fixtureSql){
 const relative='drizzle/'+name,bytes=await readFile(join(repo,relative));
 assert.equal(hash(bytes),hash(execFileSync('git',['show',sha+':'+relative],{cwd:repo})),relative+' must match release');
 fixtureMigrations[relative]=hash(bytes);
 await writeFile(join(directory,relative),bytes,{flag:'wx',mode:0o444});
}
const proof={fixtureMigrations:{kind:'release-pinned-read-only-SQL-for-in-memory-SQLite',sha256:fixtureMigrations,database:':memory:',actualStagingDatabaseWrites:false},format:1,kind:'actual-staging-browser-acceptance',origin,releaseSha:sha,releaseId,deployWorkflowRun:run,deployWorkflow:{url:job.url,headSha:job.headSha,status:job.status,conclusion:job.conclusion,jobs:job.jobs.map(({name,status,conclusion})=>({name,status,conclusion}))},startedAt:new Date().toISOString(),preHealth,testSourceSha256:sources,localEvidenceSha256Before:localBefore,scope:{actualStagingHtmlCssCanvasAndAssets:true,actualUnauthenticatedAuthChecks:true,regieAndFamilyApiTransportSimulated:true,providersSimulatedOrBlocked:true,realAccountAcceptance:false,realCaptionTrackVerified:false,realDbOrProviderOrMailWrites:false}};
await writeFile(join(directory,'release-acceptance.json'),JSON.stringify({...proof,status:'running'},null,2)+'\n');
const env={};
for(const name of ['PATH','HOME','TMPDIR','LANG','LC_ALL','DISPLAY','XDG_CACHE_HOME','PLAYWRIGHT_BROWSERS_PATH','LD_LIBRARY_PATH','NODE_EXTRA_CA_CERTS'])if(process.env[name])env[name]=process.env[name];
env.SIMPLE_SHOW_EVIDENCE_ROOT=join(directory,'broadcast-preparation');env.SIMPLE_PREPARATION_EVIDENCE_ROOT=join(directory,'preparation');env.OBS_SOURCE_EVIDENCE_ROOT=join(directory,'obs-source');env.START_RULES_EVIDENCE_ROOT=join(directory,'start-rules');env.REGIE_SETTINGS_EVIDENCE_ROOT=join(directory,'regie-settings');env.BROWSER_BASE_URL=origin;env.PLAYWRIGHT_JSON_OUTPUT_FILE=join(directory,'browser-tests.json');env.FORCE_COLOR='0';
const log=createWriteStream(join(directory,'browser.log'),{flags:'wx'});
const child=spawn(process.execPath,[join(repo,'node_modules/@playwright/test/cli.js'),'test','--config',join(repo,'playwright.config.mjs'),'--output',join(directory,'test-results')],{cwd:directory,env,stdio:['ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{log.write(chunk);process.stdout.write(chunk);});
const exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});await new Promise(resolve=>log.end(resolve));
let postHealth,healthFailure=null;
try{postHealth=await health();}catch(error){healthFailure={name:error.name,message:error.message};}
await rm(join(directory,'drizzle'),{recursive:true});
const report=JSON.parse(await readFile(join(directory,'browser-tests.json'),'utf8'));
const localAfter=await fileHashes(localFiles),sourceAfter=await fileHashes(testFiles);
const localPreserved=JSON.stringify(localBefore)===JSON.stringify(localAfter),sourcesPreserved=JSON.stringify(sources)===JSON.stringify(sourceAfter);
const stats=report.stats,status=exitCode===0&&stats.expected===expectedBrowsers&&stats.skipped===0&&stats.unexpected===0&&stats.flaky===0&&!healthFailure&&localPreserved&&sourcesPreserved?'passed':'failed';
await writeFile(join(directory,'release-acceptance.json'),JSON.stringify({...proof,finishedAt:new Date().toISOString(),postHealth,healthFailure,exitCode,stats,localEvidenceSha256After:localAfter,localEvidencePreserved:localPreserved,testSourcesUnchanged:sourcesPreserved,status},null,2)+'\n');
console.log(JSON.stringify({status,directory,exitCode,stats,localEvidencePreserved:localPreserved,testSourcesUnchanged:sourcesPreserved}));
if(status!=='passed')process.exitCode=1;
