import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createStorageEnvironment,createSupabaseObjectStore} from '../../server/node-storage.js';
import {mailState} from '../../server/mail-service.js';
import {handleOpenAI} from '../../server/openai.js';
import {manageLivekitSettings} from '../../server/livekit.js';
import {handleResend} from '../../server/resend.js';

const ORIGIN='https://milo-staging.dgwebservices.nl',PROJECT='https://lfsdgxcpdyghidzkzzvn.supabase.co';
const fail=phase=>Object.assign(new Error('De read-only werkplekcontrole is niet geslaagd.'),{phase});
const forbidden=()=>{throw fail('unexpected_write_or_provider_request');};

// Verify the actual runtime's database/object reads, without an HTTP auth
// bypass, a settings write, a provider call or any change to source data.
export async function inspectWorkspace(environment){
 const DB={prepare(sql){if(!/^\s*SELECT\b/i.test(sql))throw fail('unexpected_database_write');return environment.DB.prepare(sql);},batch:forbidden};
 const SETTINGS={get:key=>environment.SETTINGS.get(key),put:forbidden,delete:forbidden};
 const owner=await DB.prepare("SELECT user_id FROM app_user_roles WHERE role = 'regie' ORDER BY user_id LIMIT 1").first();
 const env={...environment,DB,SETTINGS,NATIVE_PROVIDER_SETTINGS:true,AUTH_IDENTITY:{user:owner?.user_id||'deployment-read-only-probe',admin:true}};
 const templates=[];
 for(const brand of ['milo','vlampie']){
  let state;try{state=await mailState(env,brand);}catch{throw fail('mail_state_'+brand);}
  if(state.brandId!==brand||state.templates.length!==17||new Set(state.templates.map(t=>t.id)).size!==17||state.templates.find(t=>t.id==='auth-code')?.editable!==false)throw fail('mail_templates_'+brand);
  templates.push({brand,templateCount:state.templates.length,authTemplateReadOnly:true});
 }
 let openai,livekit,resend;
 try{const response=await handleOpenAI(new Request(ORIGIN+'/api/openai/status'),env,forbidden);openai=await response.json();if(!response.ok||typeof openai.configured!=='boolean'||openai.canManage!==true)throw fail('openai_settings');}catch{throw fail('openai_settings');}
 try{livekit=await manageLivekitSettings(new Request(ORIGIN+'/api/livekit/settings'),env,{},forbidden);if(typeof livekit.configured!=='boolean'||livekit.canManage!==true)throw fail('livekit_settings');}catch{throw fail('livekit_settings');}
 try{const response=await handleResend(new Request(ORIGIN+'/api/resend/settings'),env,forbidden);resend=await response.json();if(!response.ok||typeof resend.configured!=='boolean'||resend.canManage!==true)throw fail('resend_settings');}catch{throw fail('resend_settings');}
 for(const status of [openai,livekit,resend])if(status.key||status.apiKey||status.apiSecret||status.OPENAI_API_KEY||status.credentials)throw fail('provider_projection');
 return {gate:'staging-workspace',status:'passed',templates,readableProviders:['openai','livekit','resend'],providerSettingsReadable:true,providerSettingsEditable:true,storedCredentialsReturned:false,databaseWrites:0,objectWrites:0,providerRequests:0,realAccountLoginVerified:false};
}

export async function main(env=process.env){
 let storage;const storageReads=[];
 try{
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_REPOSITORY!=='milobingo/platform'||env.RUNNER_NAME!=='dg-nxttrack-01-nxttrack-staging'||env.APP_URL!==ORIGIN||env.SUPABASE_URL!==PROJECT||env.SUPABASE_STORAGE_BUCKET!=='milo-staging'||!/^[a-f0-9]{40}$/.test(env.RELEASE_SHA||''))throw fail('target');
  if(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==env.RELEASE_SHA)throw fail('source');
  if(!env.DATABASE_URL||!env.SUPABASE_DB_CA_BASE64||!env.SUPABASE_SECRET_KEY||!env.VLAMPIE_SETTINGS_KEY)throw fail('runtime_configuration');
  storage=await createStorageEnvironment(env);
  const SETTINGS=createSupabaseObjectStore({url:env.SUPABASE_URL,secretKey:env.SUPABASE_SECRET_KEY,bucket:env.SUPABASE_STORAGE_BUCKET,database:storage.DB,fetcher:async(url,options={})=>{
   if((options.method||'GET')!=='GET'||new URL(url).origin!==PROJECT)throw fail('unexpected_storage_request');
   const response=await fetch(url,options),entry={httpStatus:response.status};
   if(!response.ok){const body=await response.clone().json().catch(()=>null);entry.storageStatus=['400','401','403','404','500','503'].includes(String(body?.statusCode))?String(body.statusCode):null;entry.code=['NoSuchKey','NoSuchBucket','AccessDenied','InvalidJWT'].includes(body?.code)?body.code:null;}
   storageReads.push(entry);return response;
  }});
  const evidence=await inspectWorkspace({...env,...storage,SETTINGS});
  console.log(JSON.stringify({...evidence,storageReads,releaseSha:env.RELEASE_SHA,releaseId:env.RELEASE_ID,observedAt:new Date().toISOString()}));
 }catch(error){console.log(JSON.stringify({gate:'staging-workspace',status:'failed',phase:error.phase||'runtime_storage',storageReads,databaseWrites:0,objectWrites:0,providerRequests:0}));process.exitCode=1;}
 finally{await storage?.close();}
}
if(process.argv[1]?.endsWith('/staging-workspace-preflight.mjs')&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
