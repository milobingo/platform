import {writeFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {postgresTlsOptions} from '../../server/node-postgres-tls.js';
import {auditShowTimes} from '../audit-show-times.mjs';
import {auditDatabase,loadManifest,manifestThrough,V70_BASELINE_FILENAME,verifyDatabaseClientTls} from './database.mjs';
import {stagingRestoreTargetOptions} from './staging-restore-target.mjs';

// Dedicated read-only staging inventory. Never print connection strings, source
// JSON documents, titles, emails, book codes or provider configuration.
const expectedProjectRef='lfsdgxcpdyghidzkzzvn';
try{
 const fullManifest=await loadManifest();
 let audit=await auditDatabase({expectedProjectRef,manifest:fullManifest});
 if(!audit.ok)audit=await auditDatabase({expectedProjectRef,manifest:manifestThrough(fullManifest,V70_BASELINE_FILENAME)});
 if(!audit.ok)throw Error('The exact managed baseline is not ready.');
 const pool=new Pool({...postgresTlsOptions(process.env.DATABASE_URL,{caBase64:process.env.SUPABASE_DB_CA_BASE64}),max:1,connectionTimeoutMillis:10000,statement_timeout:15000});
 let shows;
 try{
  const client=await pool.connect();
  try{
   verifyDatabaseClientTls(client,new URL(process.env.DATABASE_URL).hostname);
   await client.query('BEGIN READ ONLY');
   const {rows}=await client.query(`SELECT id,revision,document::jsonb->>'date' AS date,document::jsonb->>'timeZone' AS "timeZone",
    CASE WHEN jsonb_typeof(document::jsonb->'books')='array' THEN jsonb_array_length(document::jsonb->'books') ELSE 0 END AS "bookCount",
    CASE WHEN jsonb_typeof(document::jsonb->'orders')='array' THEN jsonb_array_length(document::jsonb->'orders') ELSE 0 END AS "orderCount"
    FROM public.bingo_games ORDER BY id LIMIT 1001`);
   if(rows.length>1000)throw Error('Inventory must be explicitly split.');
   // pg returns bigint revision values as decimal strings. Preserve the strict
   // JSON safe-integer contract rather than silently skipping existing shows.
   shows=auditShowTimes({schemaVersion:1,shows:rows.map(row=>({...row,revision:Number(row.revision)}))});
   await client.query('ROLLBACK');
  }finally{client.release();}
 }finally{await pool.end();}
 const result={observedAt:new Date().toISOString(),releaseSha:process.env.RELEASE_SHA,audit,showTimes:shows,sourceWrites:false};
 if(process.env.RESTORE_TEST_DATABASE_URL){
  const scratch=new Pool(stagingRestoreTargetOptions(process.env.RESTORE_TEST_DATABASE_URL));
  try{
   await scratch.query('BEGIN READ ONLY');
   const r=(await scratch.query(`SELECT current_setting('server_version_num')::int AS version,r.rolsuper AS superuser,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%') AS "userRelations"
    FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
   if(!r.superuser||r.userRelations!==0||Math.floor(r.version/10000)!==Math.floor(audit.connection.version/10000))throw Error('Scratch not empty or compatible.');
   result.restoreEndpoint={...r,reachableThroughDedicatedRelays:true,sourceCredentialUsedForScratch:false};
   await scratch.query('ROLLBACK');
  }finally{await scratch.end();}
 }
 await writeFile('staging-v70-inventory.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({ok:true,sourceWrites:false,postgresVersion:audit.connection.version,sourceBytes:audit.connection.databaseSizeBytes,tables:audit.applicationTables.length,showTimes:shows.summary,restoreReachable:!!result.restoreEndpoint}));
}catch{
 console.error(JSON.stringify({ok:false,code:'staging_inventory_failed',message:'De read-only inventarisatie is gestopt. Controleer de beheerdersverbinding, exacte basis en de afzonderlijke lege herstelserver; verbindingswaarden worden niet gelogd.'}));process.exitCode=1;
}
