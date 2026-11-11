import {readFile} from 'node:fs/promises';
import {createStorageEnvironment} from '../../server/node-storage.js';
import {verifyRuntimeDatabase} from './release-preflight.mjs';
import {inspectWorkspace} from './staging-workspace-preflight.mjs';

// Bundled into the immutable artifact and executed only as the app account.
// The root broker supplies the candidate's own protected EnvironmentFile.
let storage;
try{
 const env=process.env;
 if(process.getuid?.()===0||env.NODE_ENV!=='production'||env.MILO_LOCAL_AUTH!=='false'||!/^https:\/\//.test(env.APP_URL||'')||!['staging','production'].includes(env.MAIL_ENVIRONMENT)||!env.DATABASE_URL||!env.VLAMPIE_SETTINGS_KEY)throw Error('runtime_configuration');
 const tableNames=JSON.parse(await readFile(new URL('./schema-tables.json',import.meta.url),'utf8'));
 if(!Array.isArray(tableNames)||!tableNames.length||tableNames.some(name=>typeof name!=='string'||!/^[a-z_]+$/.test(name)))throw Error('schema_contract');
 await verifyRuntimeDatabase(env.DATABASE_URL,{tableNames,caBase64:env.SUPABASE_DB_CA_BASE64});
 storage=await createStorageEnvironment(env);
 const result=await inspectWorkspace({...env,...storage});
 console.log(JSON.stringify({...result,releaseSha:env.RELEASE_SHA,releaseId:env.RELEASE_ID,configVersion:env.CONFIG_VERSION,execution:'unprivileged-app-account'}));
}catch{
 console.error(JSON.stringify({gate:'protected-runtime-audit',status:'failed',databaseWrites:0,objectWrites:0,providerRequests:0,credentialsPrinted:false}));
 process.exitCode=1;
}finally{await storage?.close();}
