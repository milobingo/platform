import {readFileSync,realpathSync,statSync,statfsSync,existsSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {hostname,userInfo} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {postgresTlsOptions} from '../../server/node-postgres-tls.js';

export const STAGING=Object.freeze({
 repository:'milobingo/platform',branch:'main',siteId:'milobingo-staging',siteRoot:'/srv/sites/milobingo-staging',
 appUrl:'https://milo-staging.dgwebservices.nl',supabaseRef:'lfsdgxcpdyghidzkzzvn',bucket:'milo-staging',
 runnerName:'dg-nxttrack-01-nxttrack-staging',runnerUser:'run-mil-stg',appUser:'app-mil-stg',host:'dg-nxttrack-01',
 workspace:'/home/run-mil-stg/_work/platform/platform',
 deployWrapper:'/usr/local/bin/dg-site-deploy',
 nativeHelper:'/usr/local/libexec/dg-milobingo-deploy-helper',
 node:'24.18.0',pnpm:'11.25.0',minFreeBytes:4*1024**3,minFreeInodes:50000,
});
export const RUNTIME_KEYS=Object.freeze(['NODE_ENV','HOSTNAME','APP_URL','MILO_LOCAL_AUTH','PORT','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_STORAGE_BUCKET','SUPABASE_DB_CA_BASE64','DATABASE_URL','SUPABASE_SECRET_KEY','VLAMPIE_SETTINGS_KEY','OPENAI_TEXT_MODEL','OPENAI_SPEECH_MODEL','OPENAI_API_KEY','LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','RELEASE_SHA','RELEASE_ID','CONFIG_VERSION']);
export const BUILD_KEYS=Object.freeze([]);
class ReleaseError extends Error {}
const fail=message=>{throw new ReleaseError(message);};
const sha256=value=>createHash('sha256').update(value).digest('hex');
const fullHash=(value,label='Release-SHA')=>{if(typeof value!=='string'||!/^[a-f0-9]{40}$/.test(value))fail(`${label}: gebruik de volledige 40-tekens SHA in kleine letters.`);return value;};
const safeMetadata=(value,label)=>{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(value))fail(`${label}: ontbreekt of bevat ongeldige metadata.`);return value;};
const sameKeys=(actual,expected)=>Array.isArray(actual)&&actual.length===expected.length&&new Set(actual).size===actual.length&&actual.every(value=>expected.includes(value));
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const toolVersion=(tool,...args)=>execFileSync(tool,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();

export function validateReleaseSha(value){return fullHash(value);}
export function validateNativeHelperPin(entrySource,helperSource){
 const declarations=entrySource.toString('utf8').split('\n').filter(line=>/^\s*HELPER_SHA256\b/.test(line));
 const match=declarations.length===1&&/^HELPER_SHA256 = '([a-f0-9]{64})'(?:[ \t]+#[^\r\n]*)?\r?$/.exec(declarations[0]);
 if(!match)fail('Hostcontract: de beoordeelde entry moet precies één letterlijke HELPER_SHA256 bevatten.');
 if(sha256(helperSource)!==match[1])fail('Hostcontract: helperhash wijkt af van de in de beoordeelde entry vastgelegde versie.');
 return match[1];
}
export function validateCiRun(run,releaseSha){
 fullHash(releaseSha);
 if(!run||run.repository?.full_name!==STAGING.repository||run.head_repository?.full_name!==STAGING.repository)fail('CI: herkomstrepository wijkt af.');
 if(run.head_sha!==releaseSha||run.head_branch!==STAGING.branch)fail('CI: SHA of integratiebranch wijkt af.');
 if(run.path!=='.github/workflows/ci.yml'||!['push','workflow_dispatch'].includes(run.event))fail('CI: alleen de eigen vereiste CI-workflow telt.');
 if(run.status!=='completed'||run.conclusion!=='success')fail('CI: de laatste run voor deze SHA is niet geslaagd.');
 if(!Number.isSafeInteger(run.id)||run.id<1||!Number.isSafeInteger(run.run_attempt)||run.run_attempt<1)fail('CI: ongeldige run-identiteit.');
 if(run.html_url!==`https://github.com/${STAGING.repository}/actions/runs/${run.id}`)fail('CI: ongeldige bewijs-URL.');
 return {id:run.id,attempt:run.run_attempt,url:run.html_url};
}
export function selectCiRun(runs,releaseSha){
 const relevant=runs.filter(run=>run.head_sha===releaseSha&&run.path==='.github/workflows/ci.yml'&&run.repository?.full_name===STAGING.repository&&run.head_branch===STAGING.branch&&['push','workflow_dispatch'].includes(run.event)).sort((a,b)=>b.id-a.id);
 if(!relevant.length)fail('CI: geen eigen main-run gevonden voor de gekozen SHA.');
 validateCiRun(relevant[0],releaseSha);return relevant[0];
}
export function validateIdentity(identity){
 for(const [field,expected] of Object.entries({repository:STAGING.repository,runnerName:STAGING.runnerName,user:STAGING.runnerUser,host:STAGING.host,workspace:STAGING.workspace}))if(identity[field]!==expected)fail(`Runnergrens: ${field} wijkt af.`);
 return true;
}
export function validateDeploymentConfiguration(environment){
 const wrapperHash=environment.DG_DEPLOY_WRAPPER_SHA256;
 if(!/^[a-f0-9]{64}$/.test(wrapperHash||''))fail('DG_DEPLOY_WRAPPER_SHA256 ontbreekt: laat de echte wrapper eerst op de host beoordelen.');
 const port=Number(environment.DG_STAGING_PORT);
 if(!/^\d+$/.test(environment.DG_STAGING_PORT||'')||!Number.isInteger(port)||port<1024||port>65535)fail('DG_STAGING_PORT: bevestig de lokale stagingpoort.');
 const configVersion=safeMetadata(environment.CONFIG_VERSION,'Configuratieversie');
 return {wrapperHash,port,configVersion,startCommand:['node','.next/standalone/server.js']};
}
export function validateRuntimeConfiguration(values,{releaseSha,releaseId,configVersion,port}){
 fullHash(releaseSha);safeMetadata(releaseId,'Release-ID');safeMetadata(configVersion,'Configuratieversie');
 if(Object.keys(values).some(key=>!RUNTIME_KEYS.includes(key)))fail('Runtime: onbekende sleutel buiten de allowlist.');
 const forced={NODE_ENV:'production',HOSTNAME:'127.0.0.1',MILO_LOCAL_AUTH:'false',PORT:String(port),RELEASE_SHA:releaseSha,RELEASE_ID:releaseId,CONFIG_VERSION:configVersion};
 for(const [key,value] of Object.entries(forced))if(values[key]!==undefined&&values[key]!==value)fail(`Runtime: ${key} wijkt af van de goedgekeurde releasegrens.`);
 const runtime={...values,...forced};
 for(const name of RUNTIME_KEYS)if(runtime[name]!==undefined&&(typeof runtime[name]!=='string'||/[\u0000\r\n]/.test(runtime[name])))fail(`Runtime: ${name} moet één geldige regel zijn.`);
 if(runtime.APP_URL!==STAGING.appUrl||runtime.SUPABASE_URL!==`https://${STAGING.supabaseRef}.supabase.co`||runtime.SUPABASE_STORAGE_BUCKET!==STAGING.bucket)fail('Runtime: staging-origin, Supabase-project of private bucket wijkt af.');
 for(const name of ['SUPABASE_PUBLISHABLE_KEY','SUPABASE_DB_CA_BASE64','DATABASE_URL','SUPABASE_SECRET_KEY','VLAMPIE_SETTINGS_KEY'])if(!runtime[name]?.trim())fail(`Runtime: ${name} ontbreekt.`);
 if(!runtime.SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')||!runtime.SUPABASE_SECRET_KEY.startsWith('sb_secret_')||!/^[a-f0-9]{64}$/i.test(runtime.VLAMPIE_SETTINGS_KEY))fail('Runtime: sleuteltype of encryptiesleutelformaat is ongeldig.');
 let database;try{database=new URL(runtime.DATABASE_URL);}catch{fail('Runtime: DATABASE_URL heeft geen geldig formaat.');}
 if(!['postgres:','postgresql:'].includes(database.protocol)||!database.hostname||!database.username||!database.password||database.pathname==='/')fail('Runtime: DATABASE_URL is onvolledig.');
 const direct=database.hostname===`db.${STAGING.supabaseRef}.supabase.co`,pooler=database.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(database.username).endsWith(`.${STAGING.supabaseRef}`);
 if(!direct&&!pooler)fail('Runtime: DATABASE_URL hoort niet bij het bevestigde stagingproject.');
 if(database.searchParams.getAll('sslmode').length!==1||database.searchParams.get('sslmode')!=='verify-full'||[...database.searchParams.keys()].some(key=>(/^ssl/i.test(key)||key.toLowerCase()==='uselibpqcompat')&&key!=='sslmode'))fail('Runtime: DATABASE_URL moet sslmode=verify-full gebruiken zonder afwijkende TLS-overrides.');
 try{postgresTlsOptions(runtime.DATABASE_URL,{caBase64:runtime.SUPABASE_DB_CA_BASE64});}catch{fail('Runtime: DATABASE_URL of SUPABASE_DB_CA_BASE64 voldoet niet aan het geverifieerde TLS-contract.');}
 if(!Number.isInteger(Number(runtime.PORT))||Number(runtime.PORT)<1024||Number(runtime.PORT)>65535)fail('Runtime: servicepoort is ongeldig.');
 const livekit=['LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET'];
 if(livekit.some(name=>runtime[name])&&!livekit.every(name=>runtime[name]))fail('Runtime: LiveKit-configuratie is onvolledig.');
 if(runtime.LIVEKIT_URL){let url;try{url=new URL(runtime.LIVEKIT_URL);}catch{fail('Runtime: LIVEKIT_URL is ongeldig.');}if(url.protocol!=='wss:'||!url.hostname.endsWith('.livekit.cloud')||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)fail('Runtime: LIVEKIT_URL is geen LiveKit Cloud-origin.');}
 return Object.fromEntries(RUNTIME_KEYS.filter(name=>runtime[name]!==undefined&&runtime[name]!=='').map(name=>[name,runtime[name]]));
}
export function wrapperEnvironment(runtime,environment={}){
 if(Object.keys(runtime).some(key=>!RUNTIME_KEYS.includes(key)))fail('Wrapper: runtime bevat een onbekende sleutel.');
 const processKeys=['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TMPDIR'];
 return {...Object.fromEntries(processKeys.filter(key=>environment[key]!==undefined).map(key=>[key,environment[key]])),...runtime,CI:'true',DG_BUILD_ENV_KEYS:'',DG_RUNTIME_ENV_KEYS:Object.keys(runtime).join(' ')};
}
export function validateRuntimeDatabaseRole(role){
 if(!role||role.user!==role.session_user||role.login!==true||role.backend_member!==true||role.superuser!==false||role.createdb!==false||role.createrole!==false||role.bypassrls!==false||role.elevated_membership!==false||role.unexpected_membership!==false)fail('Runtime-databaseaccount moet een afzonderlijke least-privilege LOGIN met alleen de beoordeelde backendbevoegdheid zijn.');
 return true;
}
export async function verifyRuntimeDatabase(connectionString,{poolFactory,tableNames,caBase64}={}){
 if(!poolFactory){const {Pool}=await import('pg');poolFactory=options=>new Pool(options);}
 if(!tableNames){const {loadManifest}=await import('./database.mjs');tableNames=[...(await loadManifest()).tables.keys()];}
 const tls=postgresTlsOptions(connectionString,{caBase64});
 const pool=poolFactory({...tls,max:1,connectionTimeoutMillis:10000,statement_timeout:10000});
 pool.on?.('error',()=>{});let client;
 try{
  client=await pool.connect();await client.query('BEGIN READ ONLY');
  const result=await client.query(`SELECT current_user AS user,session_user AS session_user,r.rolcanlogin AS login,r.rolsuper AS superuser,r.rolcreatedb AS createdb,r.rolcreaterole AS createrole,r.rolbypassrls AS bypassrls,
   pg_has_role(current_user,'milo_backend','member') AS backend_member,
   EXISTS (SELECT 1 FROM pg_roles elevated WHERE (elevated.rolsuper OR elevated.rolcreatedb OR elevated.rolcreaterole OR elevated.rolbypassrls) AND pg_has_role(current_user,elevated.oid,'member')) AS elevated_membership,
   EXISTS (SELECT 1 FROM pg_roles other_role WHERE other_role.rolname<>current_user AND other_role.rolname<>'milo_backend' AND pg_has_role(current_user,other_role.oid,'member')) AS unexpected_membership
   FROM pg_roles r WHERE r.rolname=current_user`);
  validateRuntimeDatabaseRole(result.rows[0]);
  for(const table of tableNames){if(!/^[a-z_]+$/.test(table))fail('Runtime-databasecontract bevat een ongeldige tabelnaam.');await client.query(`SELECT 1 FROM public."${table}" LIMIT 0`);}
  console.log(JSON.stringify({gate:'runtime-database-role',status:'passed',verifiedTls:true,readableTables:tableNames.length,credentialsPrinted:false}));
 }catch{fail('Runtime-databasecontrole mislukt: verifieer TLS, het afzonderlijke LOGIN-account, milo_backend-lidmaatschap en tabelrechten.');}
 finally{if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}await pool.end();}
}

async function githubApi(path,token){
 const response=await fetch('https://api.github.com'+path,{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)fail(`GitHub-bewijs niet beschikbaar (HTTP ${response.status}).`);
 return response.json();
}
async function ciGate(environment){
 const sha=fullHash(environment.RELEASE_SHA),workflowSha=fullHash(environment.GITHUB_SHA,'Workflow-SHA');
 if(environment.GITHUB_REPOSITORY!==STAGING.repository||environment.GITHUB_REF!=='refs/heads/main'||environment.GITHUB_EVENT_NAME!=='workflow_dispatch')fail('Release: dispatch uitsluitend vanuit de eigen main-workflow.');
 if(!environment.GITHUB_TOKEN)fail('GitHub-leestoken ontbreekt.');
 const comparison=await githubApi(`/repos/${STAGING.repository}/compare/${sha}...main`,environment.GITHUB_TOKEN);
 if(!['ahead','identical'].includes(comparison.status))fail('Release: de gekozen SHA behoort niet tot de main-historie.');
 const response=await githubApi(`/repos/${STAGING.repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&branch=main&per_page=100`,environment.GITHUB_TOKEN);
 const run=selectCiRun(response.workflow_runs||[],sha),proof=validateCiRun(run,sha);
 const jobs=await githubApi(`/repos/${STAGING.repository}/actions/runs/${proof.id}/attempts/${proof.attempt}/jobs?per_page=100`,environment.GITHUB_TOKEN);
 if(!jobs.jobs?.some(job=>job.name==='verify'&&job.status==='completed'&&job.conclusion==='success'))fail('CI: de vereiste verify-job is niet succesvol bevestigd.');
 const outputs={release_sha:sha,workflow_sha:workflowSha,ci_run_id:String(proof.id),ci_run_attempt:String(proof.attempt),ci_run_url:proof.url};
 if(environment.GITHUB_OUTPUT)appendFileSync(environment.GITHUB_OUTPUT,Object.entries(outputs).map(([key,value])=>`${key}=${value}\n`).join(''));
 console.log(JSON.stringify({gate:'ci',status:'passed',...outputs}));
}
function secureRootFile(path,{executable=false}={}){
 if(realpathSync(path)!==path)fail('Hostcontract: symlink voor een vertrouwd rootbestand is niet toegestaan.');
 const stat=statSync(path);
 if(!stat.isFile()||stat.uid!==0||(stat.mode&0o022)!==0||executable&&(stat.mode&0o111)===0)fail('Hostcontract: rootbestand heeft onveilige eigenaar of rechten.');
 return readFileSync(path);
}
function hostGate(environment){
 validateIdentity({repository:environment.GITHUB_REPOSITORY,runnerName:environment.RUNNER_NAME,user:userInfo().username,host:hostname(),workspace:realpathSync(environment.GITHUB_WORKSPACE||'.')});
 const sha=fullHash(environment.RELEASE_SHA);if(git('rev-parse','HEAD')!==sha)fail('Checkout-SHA wijkt af van de goedgekeurde release.');
 if(git('status','--porcelain').trim())fail('Releasecheckout bevat onbeoordeelde wijzigingen.');
 const configuration=validateDeploymentConfiguration(environment);
 const deploySource=secureRootFile(STAGING.deployWrapper,{executable:true});
 if(sha256(deploySource)!==configuration.wrapperHash)fail('Hostcontract: wrapperhash wijkt af van de beoordeelde versie.');
 const helperHash=validateNativeHelperPin(deploySource,secureRootFile(STAGING.nativeHelper,{executable:true}));
 const site=statSync(STAGING.siteRoot);if(!site.isDirectory()||site.uid!==0||toolVersion('stat','-c','%G',STAGING.siteRoot)!==STAGING.appUser)fail('Hostcontract: site-eigenaar of appgroep wijkt af.');
 if(toolVersion('node','--version')!==`v${STAGING.node}`||toolVersion('pnpm','--version')!==STAGING.pnpm)fail('Hostcontract: Node/pnpm-versie wijkt af van de lockfile-toolchain.');
 for(const tool of ['psql','pg_dump','pg_restore','flock','sudo','curl'])toolVersion('sh','-c','command -v "$1"','milo-check',tool);
 execFileSync('sudo',['-n','-l'],{stdio:'ignore'});
 for(const path of [STAGING.workspace,STAGING.siteRoot]){const disk=statfsSync(path,{bigint:true});if(disk.bavail*disk.bsize<BigInt(STAGING.minFreeBytes)||disk.ffree<BigInt(STAGING.minFreeInodes))fail('Hostcontract: te weinig vrije bytes of inodes voor behoud van releases en backups.');}
 for(const file of ['.env','.env.local','.env.production','.env.production.local'])if(existsSync(join(STAGING.workspace,file)))fail('Releasecheckout bevat een niet-toegestaan configuratiebestand.');
 const config=readFileSync('next.config.mjs','utf8');if(!/output\s*:\s*['"]standalone['"]/.test(config))fail('Hostcontract: standalone-start vereist een expliciete standalone-build.');
 console.log(JSON.stringify({gate:'host',status:'passed',releaseSha:sha,wrapperSha256:configuration.wrapperHash,helperSha256:helperHash,port:configuration.port,buildKeys:BUILD_KEYS,runtimeKeys:RUNTIME_KEYS}));
 return configuration;
}

async function verifyPublic(environment){
 const sha=fullHash(environment.RELEASE_SHA),releaseId=safeMetadata(environment.RELEASE_ID,'Release-ID'),configVersion=safeMetadata(environment.CONFIG_VERSION,'Configuratieversie');
 const get=async(path,options={})=>{const response=await fetch(STAGING.appUrl+path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000),...options});return response;};
 let healthy=false;
 for(let attempt=0;attempt<6;attempt++){
  try{const response=await get('/api/health',{signal:AbortSignal.timeout(8000)});const health=response.ok?await response.json():null;if(health?.status==='ok'&&health.revision===sha&&health.releaseId===releaseId&&health.configVersion===configVersion){healthy=true;break;}}catch{}
  if(attempt<5)await new Promise(resolve=>setTimeout(resolve,5000));
 }
 if(!healthy)fail('Publieke health bevestigt niet de exacte SHA/release/configuratie; activatie blijft onbevestigd.');
 const demo=await get('/spelen?demo=1');if(!demo.ok)fail('Publieke familie-demo is niet beschikbaar.');
 const html=await demo.text(),assets=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match=>match[1]).filter(path=>path.startsWith('/_next/'));
 if(!assets.length)fail('Familie-demo verwijst niet naar de verwachte app-assets.');
 for(const asset of assets.slice(0,3)){const response=await get(asset);if(!response.ok||!(await response.arrayBuffer()).byteLength)fail('Een publieke appchunk ontbreekt.');}
 for(const asset of ['/assets/milo-friends/logo.png','/assets/milo-friends/characters/milo.png']){const response=await get(asset);if(!response.ok||sha256(Buffer.from(await response.arrayBuffer()))!==sha256(readFileSync(join('public',asset))))fail('Een publieke demoasset verschilt van de releasebron.');}
 const session=await get('/api/auth/session'),state=session.ok?await session.json():null;
 if(!state||state.authenticated!==false||state.localAvailable!==false||state.configured!==true)fail('Publieke anonieme Auth-grens is niet correct geconfigureerd.');
 const protectedResponse=await get('/api/bingo/games',{headers:{'oai-authenticated-user-id':'forged-admin','oai-authenticated-user-email':'admin@example.test'}});
 if(protectedResponse.status!==401)fail('Publieke backend wijst een vervalste identiteit niet correct af.');
 const local=await get('/auth/local',{method:'POST',headers:{Origin:STAGING.appUrl,'Content-Type':'application/json'},body:JSON.stringify({role:'regie'})});
 if(local.status!==403||local.headers.has('set-cookie'))fail('Lokale ontwikkelaanmelding is beschikbaar op staging.');
 console.log(JSON.stringify({gate:'public',status:'passed',releaseSha:sha,releaseId,configVersion,checks:['exact-health-identity','demo-assets','unauthenticated-access','local-login-disabled'],notTested:['real-otp-email','google-oauth-account','paid-provider-access','live-broadcast-audio']}));
}
async function main(){
 const operation=process.argv[2],environment=process.env;
 if(operation==='ci')await ciGate(environment);
 else if(operation==='host')hostGate(environment);
 else if(operation==='runtime'||operation==='deploy'){
  const configuration=hostGate(environment),values=Object.fromEntries(RUNTIME_KEYS.filter(key=>environment[key]!==undefined).map(key=>[key,environment[key]]));
  const runtime=validateRuntimeConfiguration(values,{releaseSha:environment.RELEASE_SHA,releaseId:environment.RELEASE_ID,configVersion:environment.CONFIG_VERSION,port:configuration.port});
  console.log(JSON.stringify({gate:'runtime',status:'passed',keys:Object.keys(runtime),valuesPrinted:false}));
  if(operation==='deploy'){
   await ciGate(environment);
   if(!/^\d+$/.test(environment.GITHUB_RUN_ID||'')||!/^\d+$/.test(environment.GITHUB_RUN_ATTEMPT||'')||runtime.RELEASE_ID!==`${environment.GITHUB_RUN_ID}-${environment.GITHUB_RUN_ATTEMPT}`)fail('Release-ID wijkt af van de eigen workflowpoging.');
   if(!environment.MIGRATION_DATABASE_URL)fail('MIGRATION_DATABASE_URL ontbreekt: een beheerdersverbinding mag niet als app-runtime worden gebruikt.');
   const databaseKeys=['PATH','HOME','SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_STORAGE_BUCKET','SUPABASE_DB_CA_BASE64'];
   const databaseEnvironment=Object.fromEntries(databaseKeys.filter(key=>environment[key]!==undefined).map(key=>[key,environment[key]]));
   databaseEnvironment.DATABASE_URL=environment.MIGRATION_DATABASE_URL;
   // Audit only: pending migrations or drift stop before the release wrapper.
   // --apply, backup secrets and restore-database credentials are never passed.
   execFileSync(process.execPath,['scripts/deploy/database.mjs',`--expected-project-ref=${STAGING.supabaseRef}`],{env:databaseEnvironment,stdio:'inherit'});
   await verifyRuntimeDatabase(runtime.DATABASE_URL,{caBase64:runtime.SUPABASE_DB_CA_BASE64});
   execFileSync(STAGING.deployWrapper,[STAGING.siteId,STAGING.workspace,runtime.RELEASE_SHA,runtime.RELEASE_ID],{env:wrapperEnvironment(runtime,environment),stdio:'inherit'});
  }
 }
 else if(operation==='verify')await verifyPublic(environment);
 else fail('Gebruik release-preflight.mjs ci|host|runtime|deploy|verify.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(cause=>{console.error(cause instanceof ReleaseError?cause.message:'Releasecontrole mislukt: controleer de beschikbare rootwrapper, toolchain, runnergrens en configuratienamen. Secretwaarden zijn niet getoond.');process.exitCode=1;});
