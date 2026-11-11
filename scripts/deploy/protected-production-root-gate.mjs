import {lstatSync,openSync,fstatSync,readFileSync,closeSync,constants,appendFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateProductionProfile,loadProductionProfile,profileDigest,sha256} from './production-profile.mjs';
import {verifyRelease,readJsonInput,ReleaseGateError} from '../../infra/protected/release-gate.mjs';

const requireValue=(condition,message)=>{if(!condition)throw new ReleaseGateError(message);};
const SHA=/^[a-f0-9]{40}$/;
export const PROTECTED_PRODUCTION_ACCEPTANCE_CHECKS=Object.freeze(['familyAuth','regieAuthorization','ordersAndPdf','mailGateway','showAudioAndLiveCall']);
export const PROTECTED_PRODUCTION_CHECKS=Object.freeze([{workflow:'ci.yml',jobs:['verify'],events:['push','workflow_dispatch']}]);
export function protectedProductionGatePaths(profile){
 const p=validateProductionProfile(profile),root='/etc/dg-sites/'+p.siteId;
 return {policy:root+'/protected-deploy.json',acceptanceDirectory:root+'/staging-acceptance'};
}
export function readProtectedProductionFile(path,limit=8192){
 requireValue(typeof path==='string'&&path.startsWith('/'),'Root record requires an absolute path');
 for(let part=path;;part=dirname(part)){
  const item=lstatSync(part);requireValue(item.uid===0&&!(item.mode&0o022)&&!item.isSymbolicLink(),'Root record path is untrusted');if(part==='/')break;
 }
 const before=lstatSync(path);requireValue(before.isFile()&&before.nlink===1&&!(before.mode&0o077)&&before.size<=limit,'Root record must be private and bounded');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const item=fstatSync(fd);requireValue(item.dev===before.dev&&item.ino===before.ino&&item.uid===0&&item.nlink===1&&!(item.mode&0o077)&&item.size<=limit,'Root record changed during open');const raw=readFileSync(fd,'utf8');requireValue(Buffer.byteLength(raw)<=limit,'Root record exceeds its bound');return raw;}finally{closeSync(fd);}
}
export function validateProtectedProductionAcceptance(raw,{releaseSha,stagingRunId,stagingReleaseId,now=Date.now(),notBefore=0}={}){
 requireValue(typeof raw==='string'&&Buffer.byteLength(raw)<=8192&&!/\bsk-[A-Za-z0-9_-]{10,}|\bsb_secret_[A-Za-z0-9_-]{10,}|postgres(?:ql)?:|\bwhsec_[A-Za-z0-9+/=]{20,}|Bearer /i.test(raw),'Staging acceptance must contain only bounded public evidence');
 let value;try{value=JSON.parse(raw);}catch{throw new ReleaseGateError('Root staging acceptance is not valid JSON');}
 const fields=['format','releaseSha','stagingRunId','stagingReleaseId','observedAt','checks'];
 requireValue(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&Object.keys(value).every(key=>fields.includes(key))&&value.format===1&&value.releaseSha===releaseSha&&value.stagingRunId===stagingRunId&&value.stagingReleaseId===stagingReleaseId,'Root staging acceptance belongs to a different source or run');
 requireValue(typeof value.observedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.observedAt)&&Number.isFinite(Date.parse(value.observedAt))&&Date.parse(value.observedAt)<=now&&Date.parse(value.observedAt)>=notBefore,'Root staging acceptance must follow this deployment');
 requireValue(value.checks&&typeof value.checks==='object'&&!Array.isArray(value.checks)&&Object.keys(value.checks).length===PROTECTED_PRODUCTION_ACCEPTANCE_CHECKS.length&&Object.keys(value.checks).every(name=>PROTECTED_PRODUCTION_ACCEPTANCE_CHECKS.includes(name)),'Five actual staging acceptance checks are required');
 for(const name of PROTECTED_PRODUCTION_ACCEPTANCE_CHECKS){
  const check=value.checks[name];requireValue(check&&typeof check==='object'&&!Array.isArray(check)&&Object.keys(check).length===2&&Object.keys(check).every(key=>['status','evidence'].includes(key))&&check.status==='passed'&&typeof check.evidence==='string'&&check.evidence.length<=240&&!check.evidence.includes('..')&&/^(?:verification\/[A-Za-z0-9_.\/-]+\.json(?:#[A-Za-z0-9_.-]+)?|https:\/\/github\.com\/milobingo\/platform\/actions\/runs\/[1-9][0-9]*(?:\/artifacts\/[1-9][0-9]*)?)$/.test(check.evidence),'Actual account, regie, orders/PDF, mail and live-audio checks must all pass');
 }
 return {source:'root-only-production-staging-acceptance-record',observedAt:value.observedAt,checks:PROTECTED_PRODUCTION_ACCEPTANCE_CHECKS,digest:sha256(JSON.stringify(value))};
}
async function jsonResponse(response,limit=1048576){
 requireValue(response.ok,'Required release evidence is unavailable');const reader=response.body?.getReader();requireValue(reader,'Required release evidence has no body');const chunks=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;requireValue(size<=limit,'Required release evidence exceeds its bound');chunks.push(part.value);}}finally{if(size>limit)await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ReleaseGateError('Required release evidence is invalid JSON');}
}
function githubApi(token,fetchFn){
 const root='https://api.github.com/repos/milobingo/platform';
 const api=async(path,query={})=>{const url=new URL(root+path);for(const [key,value] of Object.entries(query))url.searchParams.set(key,String(value));let response;try{response=await fetchFn(url,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});}catch{throw new ReleaseGateError('Required GitHub release evidence could not be verified');}return jsonResponse(response);};
 const pages=async(path,key)=>{const rows=[];for(let page=1;page<=20;page++){const data=await api(path,{per_page:100,page});requireValue(Array.isArray(data[key]),'Required workflow jobs are missing');rows.push(...data[key]);if(data[key].length<100)return rows;}throw new ReleaseGateError('Workflow jobs exceed the bounded review window');};
 return {api,pages};
}
async function containedControl(api,run,branchHead){
 requireValue(SHA.test(run.head_sha||''),'Workflow control source is invalid');if(run.head_sha===branchHead)return;
 const proof=await api('/compare/'+run.head_sha+'...'+branchHead);requireValue(['ahead','identical'].includes(proof.status)&&proof.base_commit?.sha===run.head_sha,'Workflow control source is outside main');
}
async function productionRun(api,input,branchHead){
 const workflow=await api('/actions/workflows/deploy-production.yml'),run=await api('/actions/runs/'+input.deploymentRun.id);
 requireValue(workflow.path==='.github/workflows/deploy-production.yml'&&workflow.state==='active'&&Number.isSafeInteger(workflow.id),'Fixed production workflow is unavailable');
 requireValue(run.id===Number(input.deploymentRun.id)&&run.run_attempt===input.deploymentRun.attempt&&run.workflow_id===workflow.id&&run.event==='workflow_dispatch'&&run.head_branch==='main'&&run.head_repository?.full_name==='milobingo/platform'&&run.repository?.full_name==='milobingo/platform'&&run.status==='in_progress'&&run.conclusion===null,'The own running production workflow attempt differs');
 await containedControl(api,run,branchHead);return 'https://github.com/milobingo/platform/actions/runs/'+run.id;
}
async function stagingProof(api,pages,input,branchHead,fetchFn){
 let health;try{health=await jsonResponse(await fetchFn('https://milo-staging.dgwebservices.nl/api/health',{headers:{Accept:'application/json','Cache-Control':'no-cache'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)}),65536);}catch{throw new ReleaseGateError('The actual staging release is unavailable');}
 requireValue(health?.status==='ok'&&health.revision===input.sha&&typeof health.configVersion==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(health.configVersion)&&/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/.test(health.releaseId||''),'Production requires the exact currently healthy staging source');
 const [id,attempt]=health.releaseId.split('-');requireValue(Number.isSafeInteger(Number(id))&&Number.isSafeInteger(Number(attempt)),'Staging workflow identity is outside the supported range');
 const workflow=await api('/actions/workflows/deploy-staging.yml'),run=await api('/actions/runs/'+id);
 requireValue(workflow.path==='.github/workflows/deploy-staging.yml'&&workflow.state==='active'&&Number.isSafeInteger(workflow.id),'The fixed staging workflow differs');
 requireValue(run.id===Number(id)&&run.run_attempt===Number(attempt)&&run.workflow_id===workflow.id&&run.path==='.github/workflows/deploy-staging.yml'&&run.event==='workflow_dispatch'&&run.head_branch==='main'&&run.head_repository?.full_name==='milobingo/platform'&&run.repository?.full_name==='milobingo/platform'&&run.status==='completed'&&run.conclusion==='success'&&run.html_url==='https://github.com/milobingo/platform/actions/runs/'+id,'The actual staging workflow has not fully succeeded');
 await containedControl(api,run,branchHead);
 const jobs=await pages('/actions/runs/'+id+'/attempts/'+attempt+'/jobs','jobs');
 for(const name of ['release-gate','deploy','verify-public']){const matching=jobs.filter(job=>job.name===name);requireValue(matching.length===1&&matching[0].run_id===run.id&&matching[0].head_sha===run.head_sha&&matching[0].status==='completed'&&matching[0].conclusion==='success','A required staging workflow job is missing or unsuccessful');}
 const latest=await api('/actions/runs/'+id);requireValue(latest.run_attempt===run.run_attempt&&latest.head_sha===run.head_sha&&latest.workflow_id===run.workflow_id&&latest.status==='completed'&&latest.conclusion==='success','Staging workflow changed during verification');
 const times=[run.run_started_at,run.updated_at].map(value=>Date.parse(value)).filter(Number.isFinite);requireValue(times.length===2,'Staging deployment time is unavailable');
 return {id:run.id,attempt:run.run_attempt,url:run.html_url,releaseId:health.releaseId,configVersion:health.configVersion,notBefore:Math.max(...times)};
}
export async function verifyProtectedProductionRelease(profile,input,{fetchFn=fetch,loadRootPolicy=path=>readProtectedProductionFile(path,32768),loadAcceptance=readProtectedProductionFile,now=Date.now(),requireAcceptance=true}={}){
 const p=validateProductionProfile(profile),paths=protectedProductionGatePaths(p);
 if(requireAcceptance){
  let policy;try{policy=JSON.parse(await loadRootPolicy(paths.policy));}catch{throw new ReleaseGateError('The root production policy is unavailable');}
  requireValue(policy?.productionProfileSha256===profileDigest(p),'Root production policy profile pin differs');
 }
 requireValue(input&&Object.keys(input).length===7&&Object.keys(input).every(key=>['repository','integrationBranch','sha','requiredChecks','githubToken','deploymentRun','deploymentWorkflow'].includes(key))&&input.deploymentWorkflow==='deploy-production.yml','Use only the fixed production release interface');
 requireValue(input.deploymentRun&&typeof input.deploymentRun.id==='string'&&/^[1-9][0-9]{0,19}$/.test(input.deploymentRun.id)&&Number.isSafeInteger(Number(input.deploymentRun.id))&&Number.isSafeInteger(input.deploymentRun.attempt)&&input.deploymentRun.attempt>0&&Object.keys(input.deploymentRun).length===2,'Own production workflow identity is required');
 // The independent CI gate deliberately receives no caller-selected workflow.
 const candidate={repository:input.repository,integrationBranch:input.integrationBranch,sha:input.sha,requiredChecks:input.requiredChecks,githubToken:input.githubToken};
 const ci=await verifyRelease(candidate,{fetchFn});
 const {api,pages}=githubApi(input.githubToken,fetchFn),deploymentRunUrl=await productionRun(api,input,ci.branchHead);
 const staging=await stagingProof(api,pages,input,ci.branchHead,fetchFn);let stagingAcceptance;
 if(requireAcceptance){
  const path=paths.acceptanceDirectory+'/'+input.sha+'.json';let raw;try{raw=await loadAcceptance(path,8192);}catch{throw new ReleaseGateError('The root-only five-check staging acceptance record is missing');}
  stagingAcceptance={...validateProtectedProductionAcceptance(raw,{releaseSha:input.sha,stagingRunId:staging.id,stagingReleaseId:staging.releaseId,notBefore:staging.notBefore,now}),path};
 }
 return {...ci,deploymentRunUrl,profileDigest:profileDigest(p),staging,...(stagingAcceptance?{stagingAcceptance}:{}),acceptanceRequired:requireAcceptance};
}
export async function runInstalledProtectedProductionGate(profile){
 try{requireValue(process.argv.length===3&&process.argv[2]==='--stdin','Use the fixed stdin release interface');const result=await verifyProtectedProductionRelease(profile,await readJsonInput());process.stdout.write(JSON.stringify(result)+'\n');}catch{console.error('Protected production gate refused: exact CI, own running workflow and complete root-owned staging acceptance are required.');process.exitCode=1;}
}
export async function verifyProtectedProductionPublic(profile,{releaseSha,releaseId,configId,fetchFn=fetch,sourceRoot=process.cwd()}={}){
 const p=validateProductionProfile(profile);requireValue(SHA.test(releaseSha||'')&&/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/.test(releaseId||'')&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(configId||''),'Exact public release identity is required');
 const get=(path,options={})=>fetchFn(p.appUrl+path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),...options});
 const health=await jsonResponse(await get('/api/health'),65536);requireValue(health?.status==='ok'&&health.revision===releaseSha&&health.releaseId===releaseId&&health.configVersion===configId,'Public production identity differs');
 const demo=await get('/spelen?demo=1');requireValue(demo.ok,'Production demo is unavailable');const html=await demo.text();requireValue(Buffer.byteLength(html)<=1048576,'Production demo exceeds its bound');const chunks=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match=>match[1]).filter(path=>path.startsWith('/_next/'));requireValue(chunks.length>0,'Production script assets are missing');
 for(const path of chunks.slice(0,3)){const response=await get(path);requireValue(response.ok&&(await response.arrayBuffer()).byteLength>0,'Production script asset is empty');}
 for(const path of ['/assets/milo-friends/logo.png','/assets/milo-friends/characters/milo.png']){const response=await get(path);requireValue(response.ok&&sha256(Buffer.from(await response.arrayBuffer()))===sha256(readFileSync(resolve(sourceRoot,'public'+path))),'Production asset differs from the source');}
 const session=await jsonResponse(await get('/api/auth/session'),65536);requireValue(session?.authenticated===false&&session.localAvailable===false&&session.configured===true,'Production anonymous Auth boundary differs');
 requireValue((await get('/api/bingo/games',{headers:{'oai-authenticated-user-id':'forged-admin','oai-authenticated-user-email':'admin@example.test'}})).status===401,'Production accepts a forged identity');
 requireValue((await get('/api/auth/session',{headers:{Origin:'https://foreign.example','Sec-Fetch-Site':'cross-site'}})).status===403,'Production accepts a foreign origin');
 const local=await get('/auth/local',{method:'POST',headers:{Origin:p.appUrl,'Content-Type':'application/json'},body:JSON.stringify({role:'regie'})});requireValue(local.status===403&&!local.headers.has('set-cookie'),'Production local login is enabled');
 return {status:'passed',gate:'protected-production-public',releaseSha,releaseId,configId,profileDigest:profileDigest(p),actualAccountOrProviderRequests:false};
}
async function hosted(){
 try{
  const args=process.argv.slice(2);requireValue(args[0]==='hosted'&&args.length<=2&&(!args[1]||args[1].startsWith('--profile=')),'Use hosted --profile=<reviewed-production-profile>');
  const profile=await loadProductionProfile(args[1]?.slice(10)),env=process.env;requireValue(env.GITHUB_REPOSITORY==='milobingo/platform'&&env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_EVENT_NAME==='workflow_dispatch','Production dispatch must use the own main workflow');
  const input={repository:'milobingo/platform',integrationBranch:'main',sha:env.RELEASE_SHA,requiredChecks:PROTECTED_PRODUCTION_CHECKS,githubToken:env.GITHUB_TOKEN,deploymentRun:{id:env.GITHUB_RUN_ID,attempt:Number(env.GITHUB_RUN_ATTEMPT)},deploymentWorkflow:'deploy-production.yml'};
  const result=await verifyProtectedProductionRelease(profile,input,{requireAcceptance:false});
  if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,'release_sha='+result.sha+'\nci_run_url='+result.ciRunUrl+'\n');
  console.log(JSON.stringify({...result,rootAcceptancePending:true}));
 }catch{console.error('Protected production hosted gate refused: confirmed profile, exact CI and healthy accepted staging source required.');process.exitCode=1;}
}
if(['hosted','public'].includes(process.argv[2])&&process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='hosted')await hosted();
 else try{requireValue(process.argv.length===4&&process.argv[3].startsWith('--profile='),'Use public --profile=<reviewed-production-profile>');console.log(JSON.stringify(await verifyProtectedProductionPublic(await loadProductionProfile(process.argv[3].slice(10)),{releaseSha:process.env.RELEASE_SHA,releaseId:process.env.RELEASE_ID,configId:process.env.CONFIG_ID})));}catch{console.error('Protected production public release or access boundary could not be confirmed.');process.exitCode=1;}
}
