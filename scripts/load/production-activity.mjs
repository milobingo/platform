// Root-only, read-only preflight for the existing shared Milo media service.
// Credentials stay on the target VPS. No user documents are returned.
import {readFile,realpath,lstat,mkdir,open,rename} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash,X509Certificate} from 'node:crypto';
import {hostname,networkInterfaces} from 'node:os';
import {dirname} from 'node:path';

const directory='/var/lib/milobingo-media/production-setup';
const targets={production:{site:'milobingo-production',project:'msupvdycmtbycaonqgan',origin:'https://milo.dgwebservices.nl'},staging:{site:'milobingo-staging',project:'lfsdgxcpdyghidzkzzvn',origin:'https://milo-staging.dgwebservices.nl'}};
const requireValue=condition=>{if(!condition)throw Error('Activity preflight refused');};
async function trustedDirectory(path){
 for(let at=path;;at=dirname(at)){const info=await lstat(at);requireValue(info.isDirectory()&&info.uid===0&&!(info.mode&0o022));if(at==='/')break;}
 requireValue(await realpath(path)===path);
}
async function save(path,value){
 const temporary=path+'.'+crypto.randomUUID()+'.tmp';
 const fd=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_WRONLY,0o600);
 try{await fd.writeFile(JSON.stringify(value,null,2)+'\n');await fd.sync();}finally{await fd.close();}
 try{const old=await lstat(path);requireValue(old.isFile()&&old.uid===0&&old.nlink===1&&!(old.mode&0o077));}catch(error){if(error.code!=='ENOENT')throw error;}
 await rename(temporary,path);
}
async function inspect(environment,target){
 const release='/srv/sites/'+target.site+'/current',envPath=await realpath(release+'/.runtime.env');
 requireValue(envPath.startsWith('/etc/dg-sites/'+target.site+'.runtime.d/')&&envPath.endsWith('.env'));
 const info=await lstat(envPath);requireValue(info.uid===0&&info.isFile()&&info.nlink===1&&!(info.mode&0o077)&&info.size<150000);
 const env={};for(const line of(await readFile(envPath,'utf8')).trimEnd().split('\n')){const match=/^([A-Z][A-Z0-9_]*)="((?:[^"\\]|\\[\\"])*)"$/.exec(line);requireValue(match&&!Object.hasOwn(env,match[1]));env[match[1]]=match[2].replace(/\\([\\"])/g,'$1');}
 requireValue(env.APP_URL===target.origin&&env.NODE_ENV==='production'&&env.MAIL_ENVIRONMENT===environment&&env.SUPABASE_URL==='https://'+target.project+'.supabase.co');
 const url=new URL(env.DATABASE_URL),username=decodeURIComponent(url.username);
 requireValue(['postgres:','postgresql:'].includes(url.protocol)&&url.pathname==='/postgres'&&url.searchParams.getAll('sslmode').length===1&&url.searchParams.get('sslmode')==='verify-full'&&(url.hostname==='db.'+target.project+'.supabase.co'||url.hostname.endsWith('.pooler.supabase.com')&&username.endsWith('.'+target.project)));
 for(const key of [...url.searchParams.keys()])if(/^ssl/i.test(key)||key==='uselibpqcompat')url.searchParams.delete(key);
 const ca=Buffer.from(env.SUPABASE_DB_CA_BASE64,'base64').toString('utf8'),certificates=[...ca.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)];
 requireValue(certificates.length>0);for(const [pem] of certificates){const certificate=new X509Certificate(pem);requireValue(certificate.ca&&Date.now()>=Date.parse(certificate.validFrom)&&Date.now()<Date.parse(certificate.validTo));}
 const require=createRequire(release+'/.next/standalone/server.js'),{Pool}=require('pg');
 const pool=new Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true,ca},max:1,connectionTimeoutMillis:10000,statement_timeout:10000,options:'-c default_transaction_read_only=on'});pool.on('error',()=>{});
 try{
  const db=await pool.connect();try{
   await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   requireValue((await db.query('SHOW transaction_read_only')).rows[0].transaction_read_only==='on');
   const rows=(await db.query('SELECT id,owner_id,revision,document,updated_at FROM bingo_games ORDER BY id')).rows;
   const now=Date.now(),games=rows.map(row=>({row,game:JSON.parse(row.document)}));
   const outputs=(await db.query('SELECT document FROM studio_outputs')).rows.map(row=>JSON.parse(row.document));
   const calls=(await db.query('SELECT document FROM studio_calls')).rows.map(row=>JSON.parse(row.document));
   const running=games.filter(({game})=>!game.testOnly&&game.status==='running');
   const fresh=running.filter(({row})=>Number(row.updated_at)>now-300000);
   const freshOutputs=outputs.filter(value=>value.producer?.until>now||value.output?.until>now);
   const freshCalls=calls.filter(value=>value.phase!=='completed'&&Math.max(value.updatedAt||0,...Object.values(value.seen||{}))>now-120000);
   const ssl=(await db.query('SELECT ssl,version FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0];requireValue(ssl?.ssl===true);
   await db.query('COMMIT');
   const hashes=rows.map(row=>({id:row.id,sha256:createHash('sha256').update(JSON.stringify(row)).digest('hex')}));
   await save(directory+'/'+environment+'-rows.json',{format:1,observedAt:new Date().toISOString(),rows:hashes});
   return {ids:rows.map(row=>row.id),summary:{activeRealShow:fresh.length>0||freshOutputs.length>0||freshCalls.length>0,gameCount:rows.length,runningStatusRows:running.length,freshRunningRows:fresh.length,freshProducerOrOutputSessions:freshOutputs.length,freshCalls:freshCalls.length,programBroadcastRows:games.filter(({game})=>game.programBroadcast!==undefined).length,tls:ssl,databaseWrites:0,rawDocumentsReturned:false}};
  }finally{db.release();}
 }finally{await pool.end();}
}
try{
 requireValue(process.argv.length===2&&process.getuid()===0&&hostname()==='dg-nxttrack-01'&&Object.values(networkInterfaces()).flat().some(address=>address?.address==='128.140.93.95'));
 await mkdir(directory,{recursive:true,mode:0o700});await trustedDirectory(directory);requireValue(!((await lstat(directory)).mode&0o077));
 const production=await inspect('production',targets.production),staging=await inspect('staging',targets.staging),stagingIds=new Set(staging.ids);
 const report={format:1,host:hostname(),checkedAt:new Date().toISOString(),activeRealShow:production.summary.activeRealShow||staging.summary.activeRealShow,environments:{production:production.summary,staging:staging.summary},namespace:{sharedGameIds:production.ids.filter(id=>stagingIds.has(id)).length,productionBroadcastRows:production.summary.programBroadcastRows},databaseWrites:0,credentialsPrinted:false};
 await save(directory+'/activity.json',report);console.log(JSON.stringify(report));
 if(report.activeRealShow||report.namespace.sharedGameIds)process.exitCode=2;
}catch{console.error(JSON.stringify({status:'activity-check-unavailable',databaseWrites:0,credentialsPrinted:false}));process.exitCode=1;}
