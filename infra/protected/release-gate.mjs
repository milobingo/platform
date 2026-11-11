import {pathToFileURL} from 'node:url';
export class ReleaseGateError extends Error {}
const requireValue=(condition,message)=>{if(!condition)throw new ReleaseGateError(message);};
const shaPattern=/^[a-f0-9]{40}$/;
export function validateReleaseInput(input) {
  requireValue(input && typeof input==='object','Release policy is missing');
  requireValue(input.repository==='milobingo/platform','Only the fixed Milo repository is permitted');
  requireValue(input.integrationBranch==='main','Only the fixed Milo integration branch is permitted');
  requireValue(shaPattern.test(input.sha || ''),'Full lowercase 40-character commit SHA is required');
  requireValue(typeof input.githubToken==='string' && input.githubToken.length>0 && input.githubToken.length<=16384 && !/[\r\n]/.test(input.githubToken),'Read-only GitHub credential is required');
  requireValue(input.deploymentWorkflow===undefined || input.deploymentWorkflow==='deploy-staging.yml','Fixed deployment workflow is invalid');
  if(input.deploymentRun!==undefined) {
    const run=input.deploymentRun;
    requireValue(run && typeof run==='object' && Object.keys(run).length===2 && /^[1-9][0-9]{0,19}$/.test(run.id || '') && typeof run.id==='string' && Number.isSafeInteger(Number(run.id)) && Number.isSafeInteger(run.attempt) && run.attempt>0,'Deployment run identity is invalid');
  }
  requireValue(JSON.stringify(input.requiredChecks)===JSON.stringify([{workflow:'ci.yml',jobs:['verify'],events:['push','workflow_dispatch']}]),'Only the fixed Milo CI workflow and verify job are permitted');
  const workflows=new Set();
  for(const check of input.requiredChecks) {
    requireValue(check && /^[A-Za-z0-9_.-]+\.ya?ml$/.test(check.workflow || '') && !workflows.has(check.workflow),'CI workflow identity is invalid or duplicated');workflows.add(check.workflow);
    requireValue(Array.isArray(check.jobs) && check.jobs.length>0 && check.jobs.length<=32 && new Set(check.jobs).size===check.jobs.length && check.jobs.every(job=>typeof job==='string' && job.length>0 && job.length<=120 && !/[\x00-\x1f]/.test(job)),'Required CI job names are invalid');
    requireValue(Array.isArray(check.events) && check.events.length>0 && check.events.every(event=>['push','workflow_dispatch'].includes(event)),'CI event policy is invalid');
  }
  return input;
}
export async function verifyRelease(input,{fetchFn=fetch}={}) {
  validateReleaseInput(input);
  const {repository,integrationBranch,sha,requiredChecks,githubToken}=input;
  const root=`/repos/${repository}`;
  async function api(path,query={}) {
    const url=new URL(path,'https://api.github.com');
    for(const [key,value] of Object.entries(query))url.searchParams.set(key,String(value));
    let response;
    try {response=await fetchFn(url,{headers:{Authorization:`Bearer ${githubToken}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},signal:AbortSignal.timeout(15000),redirect:'error'});}
    catch {throw new ReleaseGateError('GitHub metadata could not be verified');}
    requireValue(response.ok,`GitHub metadata unavailable (HTTP ${response.status})`);
    try{return await response.json();}catch{throw new ReleaseGateError('GitHub metadata is invalid');}
  }
  async function pages(path,key,query={}) {
    const values=[];
    for(let page=1;page<=20;page++) {
      const data=await api(path,{...query,per_page:100,page});
      requireValue(Array.isArray(data[key]),'Required GitHub metadata is missing');values.push(...data[key]);
      if(data[key].length<100)return values;
    }
    throw new ReleaseGateError('GitHub metadata exceeds the bounded review window');
  }
  const repo=await api(root);
  requireValue(repo.full_name===repository && Number.isSafeInteger(repo.id) && repo.id>0,'GitHub repository identity differs');
  const branch=await api(`${root}/branches/${encodeURIComponent(integrationBranch)}`);
  requireValue(branch.name===integrationBranch && shaPattern.test(branch.commit?.sha || ''),'Integration branch cannot be verified');
  const commit=await api(`${root}/commits/${sha}`);requireValue(commit.sha===sha,'GitHub returned a different commit');
  const comparison=await api(`${root}/compare/${sha}...${branch.commit.sha}`);
  requireValue(['ahead','identical'].includes(comparison.status) && comparison.base_commit?.sha===sha,'Candidate is not contained in the integration branch');
  const ciRuns=[];
  for(const check of requiredChecks) {
    const workflow=await api(`${root}/actions/workflows/${encodeURIComponent(check.workflow)}`);
    requireValue(workflow.path===`.github/workflows/${check.workflow}` && workflow.state==='active' && Number.isSafeInteger(workflow.id),'Required CI workflow identity differs');
    const runs=await pages(`${root}/actions/workflows/${workflow.id}/runs`,'workflow_runs',{head_sha:sha,branch:integrationBranch});
    const eligible=runs.filter(run=>run.head_sha===sha && run.head_branch===integrationBranch && run.head_repository?.full_name===repository && (!run.repository || run.repository.full_name===repository) && check.events.includes(run.event));
    eligible.sort((a,b)=>Number(b.id)-Number(a.id));const run=eligible[0];
    requireValue(run && Number.isSafeInteger(run.id) && run.id>0,'Required CI run is missing for this exact commit');
    requireValue(run.workflow_id===workflow.id && run.status==='completed' && run.conclusion==='success','Latest required CI run is not completed successfully');
    requireValue(Number.isSafeInteger(run.run_attempt) && run.run_attempt>0,'CI attempt identity is missing');
    const jobs=await pages(`${root}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,'jobs');
    for(const name of check.jobs) {
      const matching=jobs.filter(job=>job.name===name);
      requireValue(matching.length===1 && matching[0].head_sha===sha && matching[0].run_id===run.id && matching[0].status==='completed' && matching[0].conclusion==='success','Required CI job is missing, skipped or unsuccessful');
    }
    const latest=await api(`${root}/actions/runs/${run.id}`);
    requireValue(latest.head_sha===sha && latest.head_branch===integrationBranch && latest.head_repository?.full_name===repository && latest.workflow_id===workflow.id && latest.run_attempt===run.run_attempt && latest.status==='completed' && latest.conclusion==='success','CI changed while the release was being verified');
    ciRuns.push({workflow:check.workflow,runId:run.id,attempt:run.run_attempt,jobs:check.jobs,url:`https://github.com/${repository}/actions/runs/${run.id}`});
  }
  let deploymentRunUrl;
  if(input.deploymentRun) {
    const {id,attempt}=input.deploymentRun;
    const deploymentWorkflow=input.deploymentWorkflow || 'deploy-staging.yml';
    const workflow=await api(`${root}/actions/workflows/${deploymentWorkflow}`);
    requireValue(workflow.path===`.github/workflows/${deploymentWorkflow}` && workflow.state==='active' && Number.isSafeInteger(workflow.id),'Native deployment workflow identity differs');
    const run=await api(`${root}/actions/runs/${id}`);
    requireValue(run.id===Number(id) && run.run_attempt===attempt && run.workflow_id===workflow.id && run.event==='workflow_dispatch' && run.head_branch===integrationBranch && run.head_repository?.full_name===repository && (!run.repository || run.repository.full_name===repository) && run.status==='in_progress' && run.conclusion===null && shaPattern.test(run.head_sha || ''),'Native deployment run is missing or differs');
    if(run.head_sha!==branch.commit.sha) {
      const control=await api(`${root}/compare/${run.head_sha}...${branch.commit.sha}`);
      requireValue(['ahead','identical'].includes(control.status) && control.base_commit?.sha===run.head_sha,'Deployment workflow source is outside the integration branch');
    }
    deploymentRunUrl=`https://github.com/${repository}/actions/runs/${id}`;
  }
  return {status:'passed',repository,repositoryId:repo.id,integrationBranch,branchHead:branch.commit.sha,sha,ciRunUrl:ciRuns[0].url,ciRuns,...(deploymentRunUrl?{deploymentRunUrl}: {})};
}
export async function readJsonInput(stream=process.stdin) {
  const chunks=[];let size=0;
  for await(const chunk of stream){size+=Buffer.byteLength(chunk);requireValue(size<=65536,'Release input is too large');chunks.push(Buffer.from(chunk));}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ReleaseGateError('Release input must be JSON');}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {requireValue(process.argv.length===3 && process.argv[2]==='--stdin','Use the fixed stdin release interface');process.stdout.write(JSON.stringify(await verifyRelease(await readJsonInput()))+'\n');}
  catch(error) {console.error(error instanceof ReleaseGateError ? error.message : 'Release verification failed; no credential or provider detail is logged');process.exitCode=1;}
}
