import {constants} from 'node:fs';
import {lstat,open,realpath,unlink} from 'node:fs/promises';
import {hostname,userInfo} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const directory='/var/backups/milobingo-staging';
const filename='bootstrap-inputs.json';
const fail=()=>{throw new Error('Staging credential handoff refused.');};

export function credentialPayload(environment){
 const values={DATABASE_URL:environment.DATABASE_URL,SUPABASE_SECRET_KEY:environment.SUPABASE_SECRET_KEY};
 for(const [key,value] of Object.entries(values))if(typeof value!=='string'||!value||value.length>(key==='DATABASE_URL'?8192:16384)||/[\u0000-\u001f\u007f]/.test(value))fail();
 let database;try{database=new URL(values.DATABASE_URL);}catch{fail();}
 const ref='lfsdgxcpdyghidzkzzvn';
 if(!['postgres:','postgresql:'].includes(database.protocol)||!database.username||!database.password||!database.pathname||database.pathname==='/'||database.hash)fail();
 if(database.hostname!==`db.${ref}.supabase.co`&&!(database.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(database.username).endsWith(`.${ref}`)))fail();
 if(!values.SUPABASE_SECRET_KEY.startsWith('sb_secret_'))fail();
 const body=JSON.stringify(values)+'\n';
 if(Buffer.byteLength(body)>32768)fail();
 return body;
}

export async function writeExclusive(parent,body){
 if(typeof body!=='string'||Buffer.byteLength(body)>32768)fail();
 // The held descriptor prevents path substitution after the parent check.
 const path=`/proc/self/fd/${parent.fd}/${filename}`;
 let file,created=false;
 try{
  file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  created=true;
  await file.chmod(0o600);
  await file.writeFile(body,'utf8');
  await file.sync();
  const info=await file.stat();
  if(!info.isFile()||info.nlink!==1||info.uid!==process.getuid()||(info.mode&0o777)!==0o600||info.size>32768)fail();
  await parent.sync();
 }catch{
  if(created)await unlink(path).catch(()=>{});
  fail();
 }finally{await file?.close();}
}

async function main(){
 const environment=process.env;
 if(hostname()!=='dg-nxttrack-01'||userInfo().username!=='run-mil-stg'||process.getuid()!==1001||environment.GITHUB_REPOSITORY!=='milobingo/platform'||environment.GITHUB_REF!=='refs/heads/main'||environment.GITHUB_EVENT_NAME!=='workflow_dispatch'||environment.RUNNER_NAME!=='dg-nxttrack-01-nxttrack-staging'||environment.GITHUB_WORKSPACE!=='/home/run-mil-stg/_work/platform/platform'||!/^[a-f0-9]{40}$/.test(environment.RELEASE_SHA||''))fail();
 const head=execFileSync('/usr/bin/git',['rev-parse','--verify','HEAD'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'},stdio:['ignore','pipe','pipe']}).trim();
 if(head!==environment.RELEASE_SHA)fail();
 if(await realpath(directory)!==directory)fail();
 for(let path=dirname(directory);;path=dirname(path)){
  const info=await lstat(path);
  if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==0||(info.mode&0o022)!==0)fail();
  if(path==='/')break;
 }
 const parent=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{
  const info=await parent.stat();
  if(!info.isDirectory()||info.uid!==process.getuid()||(info.mode&0o777)!==0o700)fail();
  await writeExclusive(parent,credentialPayload(environment));
 }finally{await parent.close();}
 console.log('Staging bootstrap credential handoff prepared; values are not printed.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Staging credential handoff refused; no secret values are printed.');process.exitCode=1;});
