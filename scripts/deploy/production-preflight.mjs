import {readFileSync,realpathSync,lstatSync,statfsSync,existsSync,appendFileSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {hostname,userInfo} from 'node:os';
import {loadProductionProfile,validateProductionProfile,productionPaths,profileDigest,requireProfilePin,MAIL_RUNTIME_KEYS,sha256,fail} from './production-profile.mjs';
import {RUNTIME_KEYS as BASE_RUNTIME_KEYS,selectCiRun,validateCiRun,validateNativeHelperPin,verifyRuntimeDatabase,STAGING} from './release-preflight.mjs';
import {postgresTlsOptions} from '../../server/node-postgres-tls.js';
import {createOrderMailDelivery} from '../../server/node-mail-gateway.js';
export const PRODUCTION_RUNTIME_KEYS=Object.freeze([...BASE_RUNTIME_KEYS,...MAIL_RUNTIME_KEYS]);
const sha=value=>{if(!/^[a-f0-9]{40}$/.test(value||''))fail('Geef de volledige main-release-SHA.');return value;};
const runId=value=>{if(!/^[1-9][0-9]{0,19}$/.test(String(value||'')))fail('Geef de exacte geslaagde stagingrun.');return String(value);};
const execute=(binary,args)=>execFileSync(binary,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
export function validateProductionStagingProof(run,health,jobs,releaseSha){
 sha(releaseSha);
 if(!run||run.repository?.full_name!=='milobingo/platform'||run.head_repository?.full_name!=='milobingo/platform'||run.head_branch!=='main'||run.head_sha!==releaseSha||run.path!=='.github/workflows/deploy-staging.yml'||run.event!=='workflow_dispatch'||run.status!=='completed'||run.conclusion!=='success'||!Number.isSafeInteger(run.id)||run.id<1||!Number.isSafeInteger(run.run_attempt)||run.run_attempt<1||run.html_url!==`https://github.com/milobingo/platform/actions/runs/${run.id}`)fail('De eigen stagingworkflow voor precies deze bron moet volledig geslaagd zijn.');
 if(!['release-gate','deploy','verify-public'].every(name=>jobs?.some(job=>job.name===name&&job.status==='completed'&&job.conclusion==='success')))fail('Staging mist een geslaagde release-, deploy- of publieke job.');
 if(health?.status!=='ok'||health.revision!==releaseSha||health.releaseId!==`${run.id}-${run.run_attempt}`||typeof health.configVersion!=='string'||!health.configVersion)fail('De actuele publieke staginghealth hoort niet bij deze bron en workflowpoging.');
 return {id:run.id,attempt:run.run_attempt,url:run.html_url};
}
export const STAGING_ACCEPTANCE_CHECKS=Object.freeze(['familyAuth','regieAuthorization','ordersAndPdf','mailGateway','showAudioAndLiveCall']);
export function validateProductionStagingAcceptance(raw,{releaseSha,stagingRunId,stagingReleaseId,now=Date.now(),notBefore=0}={}){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>8192||/\bsk-[A-Za-z0-9_-]{10,}|\bsb_secret_[A-Za-z0-9_-]{10,}|postgres(?:ql)?:|\bwhsec_[A-Za-z0-9+/=]{20,}|Bearer /i.test(raw))fail('DG_STAGING_ACCEPTANCE_JSON ontbreekt of bevat ongeschikte gegevens; gebruik alleen veilig stagingbewijs.');
 let value;try{value=JSON.parse(raw);}catch{fail('Het beschermde stagingacceptatierecord is geen geldige JSON.');}
 const fields=['format','releaseSha','stagingRunId','stagingReleaseId','observedAt','checks'];
 if(!value||Array.isArray(value)||Object.keys(value).length!==fields.length||Object.keys(value).some(key=>!fields.includes(key))||value.format!==1||value.releaseSha!==releaseSha||value.stagingRunId!==stagingRunId||value.stagingReleaseId!==stagingReleaseId||typeof value.observedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.observedAt)||!Number.isFinite(Date.parse(value.observedAt))||Date.parse(value.observedAt)>now||Date.parse(value.observedAt)<notBefore)fail('Stagingacceptatie moet exact aan deze bron en stagingworkflowpoging zijn gebonden.');
 if(!value.checks||Array.isArray(value.checks)||Object.keys(value.checks).length!==STAGING_ACCEPTANCE_CHECKS.length||Object.keys(value.checks).some(key=>!STAGING_ACCEPTANCE_CHECKS.includes(key)))fail('Alle vereiste echte stagingacceptatiecontroles moeten zijn vastgelegd.');
 for(const name of STAGING_ACCEPTANCE_CHECKS){
  const check=value.checks[name];
  if(!check||Array.isArray(check)||Object.keys(check).length!==2||check.status!=='passed'||typeof check.evidence!=='string'||check.evidence.length>240||check.evidence.includes('..')||!/^(?:verification\/[A-Za-z0-9_.\/-]+\.json(?:#[A-Za-z0-9_.-]+)?|https:\/\/github\.com\/milobingo\/platform\/actions\/runs\/[1-9][0-9]*(?:\/artifacts\/[1-9][0-9]*)?)$/.test(check.evidence)||Object.keys(check).some(key=>!['status','evidence'].includes(key)))fail('Echte account-, regie-, bestel/PDF-, mail- en live-audioacceptatie moeten allemaal geslaagd zijn; pending en uitzonderingen blokkeren productie.');
 }
 return {source:'protected-production-environment-record',observedAt:value.observedAt,checks:STAGING_ACCEPTANCE_CHECKS,digest:sha256(JSON.stringify(value))};
}
export async function productionReleaseGate(profile,env,{fetcher=fetch}={}){
 validateProductionProfile(profile);requireProfilePin(profile,env.DG_PRODUCTION_PROFILE_SHA256);const releaseSha=sha(env.RELEASE_SHA),id=runId(env.STAGING_RUN_ID);
 if(env.GITHUB_REPOSITORY!=='milobingo/platform'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||!env.GITHUB_TOKEN)fail('Productie vereist de eigen handmatige main-workflow en een beperkt GitHub-leestoken.');
 const api=async path=>{const response=await fetcher('https://api.github.com/repos/milobingo/platform'+path,{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+env.GITHUB_TOKEN,'X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)fail('Het vereiste GitHub-bronbewijs kon niet worden gecontroleerd.');return response.json();};
 const comparison=await api(`/compare/${releaseSha}...main`);if(!['ahead','identical'].includes(comparison.status))fail('De productiesource behoort niet tot de eigen main-historie.');
 const runs=await api(`/actions/workflows/ci.yml/runs?head_sha=${releaseSha}&branch=main&per_page=100`),ci=validateCiRun(selectCiRun(runs.workflow_runs||[],releaseSha),releaseSha);
 const ciJobs=await api(`/actions/runs/${ci.id}/attempts/${ci.attempt}/jobs?per_page=100`);if(!ciJobs.jobs?.some(job=>job.name==='verify'&&job.status==='completed'&&job.conclusion==='success'))fail('De eigen exacte CI-verifyjob is niet geslaagd.');
 const stage=await api(`/actions/runs/${id}`),stageJobs=await api(`/actions/runs/${id}/attempts/${stage.run_attempt}/jobs?per_page=100`);
 const publicHealth=await fetcher(STAGING.appUrl+'/api/health',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});if(!publicHealth.ok)fail('De echte staginghealth is niet beschikbaar.');
 const staging=validateProductionStagingProof(stage,await publicHealth.json(),stageJobs.jobs,releaseSha);
 const stageTimes=[stage.run_started_at,stage.updated_at].map(value=>Date.parse(value)).filter(Number.isFinite);
 const stagingAcceptance=validateProductionStagingAcceptance(env.DG_STAGING_ACCEPTANCE_JSON,{releaseSha,stagingRunId:staging.id,stagingReleaseId:`${staging.id}-${staging.attempt}`,notBefore:stageTimes.length?Math.max(...stageTimes):0});
 if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,`release_sha=${releaseSha}\n`);
 return {gate:'production-release',status:'passed',releaseSha,profileDigest:profileDigest(profile),ci,staging,stagingAcceptance};
}
export function validateProductionRuntime(profile,values,{releaseSha,releaseId}={}){
 const p=validateProductionProfile(profile),paths=productionPaths(p);sha(releaseSha);
 if(!/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/.test(releaseId||''))fail('Productierelease-ID moet de eigen workflowpoging zijn.');
 if(Object.keys(values).some(key=>!PRODUCTION_RUNTIME_KEYS.includes(key))||Object.entries(values).some(([key,value])=>typeof value!=='string'||value.length>(key==='SUPABASE_DB_CA_BASE64'?87384:32768)||/[\x00-\x1f\x7f]/.test(value)))fail('Productieruntime bevat onbekende of ongeldige waarden.');
 const forced={NODE_ENV:'production',HOSTNAME:'127.0.0.1',MILO_LOCAL_AUTH:'false',PORT:String(p.port),RELEASE_SHA:releaseSha,RELEASE_ID:releaseId,CONFIG_VERSION:p.configVersion,MAIL_ENVIRONMENT:'production',MAIL_MODE:p.mailMode};
 for(const [key,value] of Object.entries(forced))if(values[key]!==undefined&&values[key]!==value)fail('Productieruntime wijkt af van het vaste release- of mailcontract.');
 const runtime={...values,...forced};
 if(runtime.APP_URL!==p.appUrl||runtime.SUPABASE_URL!==`https://${p.supabaseRef}.supabase.co`||runtime.SUPABASE_STORAGE_BUCKET!==p.bucket)fail('Productieorigin, project of private bucket wijkt af van het doelprofiel.');
 if(!runtime.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')||!runtime.SUPABASE_SECRET_KEY?.startsWith('sb_secret_')||!/^[a-fA-F0-9]{64}$/.test(runtime.VLAMPIE_SETTINGS_KEY||''))fail('Verplichte eigen productiekeys ontbreken of hebben een ongeldig type.');
 let database;try{database=new URL(runtime.DATABASE_URL);}catch{fail('Productie-databaseverbinding ontbreekt.');}
 const user=decodeURIComponent(database.username),direct=database.hostname===`db.${p.supabaseRef}.supabase.co`&&user===paths.runtimeRole,pooled=database.hostname.endsWith('.pooler.supabase.com')&&user===`${paths.runtimeRole}.${p.supabaseRef}`;
 if(!['postgres:','postgresql:'].includes(database.protocol)||!database.password||database.pathname==='/'||database.hash||database.port&&database.port!=='5432'||!direct&&!pooled||database.searchParams.getAll('sslmode').length!==1||database.searchParams.get('sslmode')!=='verify-full'||[...database.searchParams.keys()].some(key=>(/^ssl/i.test(key)||key.toLowerCase()==='uselibpqcompat')&&key!=='sslmode'))fail('Gebruik uitsluitend de eigen beperkte productierol op het bevestigde project met verify-full.');
 try{postgresTlsOptions(runtime.DATABASE_URL,{caBase64:runtime.SUPABASE_DB_CA_BASE64});}catch{fail('De productiedatabase voldoet niet aan het geverifieerde TLS-contract.');}
 // Hosting and encrypted beheer settings are independent. A newly installed
 // app must be reachable before the organizer adds provider credentials.
 // Existing environment fallbacks remain valid, but are never required.
 const live=['LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET'];if(live.some(key=>runtime[key])&&!live.every(key=>runtime[key]))fail('De productie-LiveKitconfiguratie is onvolledig.');
 if(runtime.LIVEKIT_URL){let url;try{url=new URL(runtime.LIVEKIT_URL);}catch{fail('Ongeldige productie-LiveKitorigin.');}if(url.protocol!=='wss:'||!url.hostname.endsWith('.livekit.cloud')||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)fail('Gebruik de eigen LiveKit Cloud-origin.');}
 if(p.mailMode==='allowlist'&&!validRecipients(runtime.MAIL_ALLOWED_RECIPIENTS))fail('De ingestelde serverlimiet voor mail vereist geldige testontvangers.');
 if(p.mailMode!=='disabled'&&runtime.SEND_EMAIL_HOOK_SECRET&&!createOrderMailDelivery(runtime))fail('De bestaande DG-mailgatewayconfiguratie is ongeldig.');
 return Object.fromEntries(PRODUCTION_RUNTIME_KEYS.filter(key=>runtime[key]!==undefined&&runtime[key]!=='').map(key=>[key,runtime[key]]));
}
function validRecipients(value){const recipients=String(value||'').split(',').map(item=>item.trim()).filter(Boolean);return recipients.length>0&&recipients.length<=100&&recipients.every(item=>item.length<=320&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));}
export function productionWrapperEnvironment(runtime,env={}){
 if(Object.keys(runtime).some(key=>!PRODUCTION_RUNTIME_KEYS.includes(key)))fail('Onbekende productie-runtimekey.');
 const processKeys=['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TMPDIR'];return {...Object.fromEntries(processKeys.filter(key=>env[key]!==undefined).map(key=>[key,env[key]])),...runtime,CI:'true',DG_BUILD_ENV_KEYS:'',DG_RUNTIME_ENV_KEYS:Object.keys(runtime).join(' ')};
}
function trustedFile(path,read=true){
 for(let current=path;;current=dirname(current)){const item=lstatSync(current);if(item.uid!==0||item.mode&0o022||item.isSymbolicLink())fail('Productie-rootbestand of ouderpad is niet vertrouwd.');if(current==='/')break;}
 const info=lstatSync(path);if(!info.isFile()||info.nlink!==1)fail('Productie-rootbestand moet een gewoon enkelvoudig bestand zijn.');return read?readFileSync(path):info;
}
export function productionHostGate(profile,env){
 const p=validateProductionProfile(profile),paths=productionPaths(p);requireProfilePin(p,env.DG_PRODUCTION_PROFILE_SHA256);
 if(hostname()!==p.host||userInfo().username!==p.runnerUser||process.getuid()===0||env.RUNNER_NAME!==p.runnerName||env.GITHUB_REPOSITORY!==p.repository||realpathSync(env.GITHUB_WORKSPACE||'.')!==p.workspace)fail('De werkelijke productiehost, runner, caller of checkout wijkt af.');
 if(execute('/usr/bin/git',['rev-parse','HEAD'])!==sha(env.RELEASE_SHA)||execute('/usr/bin/git',['status','--porcelain']))fail('Productiecheckout wijkt af van de exacte schone bron.');
 const entry=trustedFile(paths.entry);if(!/^[a-f0-9]{64}$/.test(env.DG_DEPLOY_WRAPPER_SHA256||'')||sha256(entry)!==env.DG_DEPLOY_WRAPPER_SHA256)fail('Productie-entry wijkt af van de beoordeelde rootwrapper.');
 const helperHash=validateNativeHelperPin(entry,trustedFile(paths.helper));
 // The runner cannot read a root:root 0600 profile. Check metadata here;
 // the pinned privileged helper validates its contents and exact runtime port.
 const configured=trustedFile(paths.deployProfile,false);if(configured.mode&0o077)fail('Het productieprofiel moet root-only blijven.');
 const unit=trustedFile('/etc/systemd/system/'+paths.service).toString('utf8');
 for(const [key,value] of Object.entries({User:p.appUser,Group:p.appUser,WorkingDirectory:paths.siteRoot+'/current/.next/standalone',EnvironmentFile:paths.siteRoot+'/current/.runtime.env',ExecStart:paths.node+' '+paths.siteRoot+'/current/.next/standalone/server.js'})){const found=unit.split('\n').filter(line=>line.startsWith(key+'='));if(found.length!==1||found[0]!==key+'='+value)fail('De productieunit heeft niet het vaste app-/envcontract.');}
 if(execute(paths.node,['--version'])!=='v24.18.0'||execute(paths.pnpm,['--version'])!=='11.25.0')fail('Productietoolchain wijkt af van de vastgezette versies.');
 for(const path of [p.workspace,paths.siteRoot]){const disk=statfsSync(path,{bigint:true});if(disk.bavail*disk.bsize<4n*1024n**3n||disk.ffree<50000n)fail('Onvoldoende productiecapaciteit voor behoud van releases.');}
 for(const file of ['.env','.env.local','.env.production','.env.production.local'])if(existsSync(join(p.workspace,file)))fail('Productiecheckout bevat een verboden lokaal configuratiebestand.');
 return {gate:'production-host',status:'passed',releaseSha:env.RELEASE_SHA,helperHash,profileDigest:profileDigest(p)};
}
export async function verifyProductionPublic(profile,{releaseSha,releaseId,fetcher=fetch}={}){
 const p=validateProductionProfile(profile);sha(releaseSha);const get=(path,options={})=>fetcher(p.appUrl+path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),...options});
 const healthResponse=await get('/api/health'),health=healthResponse.ok?await healthResponse.json():null;
 if(!health||health.status!=='ok'||health.revision!==releaseSha||health.releaseId!==releaseId||health.configVersion!==p.configVersion)fail('Publieke productiehealth bevestigt de exacte release/configuratie niet.');
 const demo=await get('/spelen?demo=1');if(!demo.ok)fail('Productiedemo ontbreekt.');const html=await demo.text(),chunks=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match=>match[1]).filter(path=>path.startsWith('/_next/'));if(!chunks.length)fail('Publieke productiechunks ontbreken.');
 for(const path of chunks.slice(0,3)){const response=await get(path);if(!response.ok||!(await response.arrayBuffer()).byteLength)fail('Een productiechunk ontbreekt.');}
 for(const path of ['/assets/milo-friends/logo.png','/assets/milo-friends/characters/milo.png']){const response=await get(path);if(!response.ok||sha256(Buffer.from(await response.arrayBuffer()))!==sha256(readFileSync(join('public',path))))fail('Een productieasset verschilt van de goedgekeurde bron.');}
 const session=await get('/api/auth/session'),state=session.ok?await session.json():null;if(state?.authenticated!==false||state.localAvailable!==false||state.configured!==true)fail('Productie heeft geen veilige geconfigureerde anonieme Auth-grens.');
 const forged=await get('/api/bingo/games',{headers:{'oai-authenticated-user-id':'forged-admin','oai-authenticated-user-email':'admin@example.test'}});if(forged.status!==401)fail('Productie accepteert een vervalste identiteit.');
 const cross=await get('/api/auth/session',{headers:{Origin:'https://foreign.example','Sec-Fetch-Site':'cross-site'}});if(cross.status!==403)fail('Productie weigert de vreemde origin niet.');
 const local=await get('/auth/local',{method:'POST',headers:{Origin:p.appUrl,'Content-Type':'application/json'},body:JSON.stringify({role:'regie'})});if(local.status!==403||local.headers.has('set-cookie'))fail('Productie staat lokale ontwikkelaanmelding toe.');
 return {gate:'production-public',status:'passed',releaseSha,releaseId,profileDigest:profileDigest(p),realAccountOrProviderCallsMade:false};
}
async function main(){
 const [operation,...args]=process.argv.slice(2);if(args.length>1||args[0]&&!args[0].startsWith('--profile='))fail('Gebruik production-preflight.mjs profile|release|host|runtime|deploy|verify [--profile=<pad>].');
 const profile=await loadProductionProfile(args[0]?.slice(10)),env=process.env,paths=productionPaths(profile);
 if(operation==='profile'){console.log(JSON.stringify({ok:true,profileDigest:profileDigest(profile),installed:false}));return;}
 requireProfilePin(profile,env.DG_PRODUCTION_PROFILE_SHA256);
 if(operation==='release')console.log(JSON.stringify(await productionReleaseGate(profile,env)));
 else if(operation==='host')console.log(JSON.stringify(productionHostGate(profile,env)));
 else if(operation==='verify')console.log(JSON.stringify(await verifyProductionPublic(profile,{releaseSha:env.RELEASE_SHA,releaseId:env.RELEASE_ID})));
 else if(operation==='runtime'||operation==='deploy'){
  productionHostGate(profile,env);const runtime=validateProductionRuntime(profile,Object.fromEntries(PRODUCTION_RUNTIME_KEYS.filter(key=>env[key]!==undefined).map(key=>[key,env[key]])),{releaseSha:env.RELEASE_SHA,releaseId:env.RELEASE_ID});
  if(operation==='runtime'){console.log(JSON.stringify({gate:'production-runtime',status:'passed',keys:Object.keys(runtime),valuesPrinted:false}));return;}
  if(runtime.RELEASE_ID!==`${runId(env.GITHUB_RUN_ID)}-${runId(env.GITHUB_RUN_ATTEMPT)}`)fail('Productierelease hoort niet bij de eigen workflowpoging.');
  await productionReleaseGate(profile,env);if(!env.MIGRATION_DATABASE_URL)fail('De afzonderlijke productie-migratieverbinding ontbreekt.');
  const {auditDatabase}=await import('./database.mjs');
  const audit=await auditDatabase({expectedProjectRef:profile.supabaseRef,env:{SUPABASE_URL:runtime.SUPABASE_URL,SUPABASE_STORAGE_BUCKET:runtime.SUPABASE_STORAGE_BUCKET,SUPABASE_SECRET_KEY:runtime.SUPABASE_SECRET_KEY,SUPABASE_DB_CA_BASE64:runtime.SUPABASE_DB_CA_BASE64,DATABASE_URL:env.MIGRATION_DATABASE_URL}});
  if(!audit.ok)fail('Productiedatabase mist beheerhistorie, migratie- of toegangsvoorwaarden. Voer eerst de afzonderlijk beoordeelde backup-/herstelbootstrap uit.');
  await verifyRuntimeDatabase(runtime.DATABASE_URL,{caBase64:runtime.SUPABASE_DB_CA_BASE64});
  execFileSync(paths.entry,[profile.siteId,profile.workspace,runtime.RELEASE_SHA,runtime.RELEASE_ID],{env:productionWrapperEnvironment(runtime,env),stdio:'inherit'});
 }else fail('Onbekende productiecontrole.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Productiecontrole geweigerd: controleer doelprofiel, exacte CI/stagingacceptatie, runner, rootwrapper en configuratienamen. Geen credentials gelogd.');process.exitCode=1;});
