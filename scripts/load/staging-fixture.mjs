import {hostname,networkInterfaces} from 'node:os';
import {constants} from 'node:fs';
import {lstat,mkdir,open,readFile,realpath,rename,rm,unlink} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {makeGame} from '../../server/bingo-model.js';
import {BingoStore} from '../../server/bingo-store.js';
import {createPostgresDatabase} from '../../server/node-storage.js';
import {postgresTlsOptions} from '../../server/node-postgres-tls.js';
import {PROGRAMME_FIXTURE_TAG,isProgrammeTestFixture,programmeFixtureUuid} from '../../server/programme-test-fixture.js';
import {broadcastConfiguration,handleProgramBroadcast,programHlsCapability,programService,programViewerToken} from '../../server/program-broadcast.js';

export const FIXTURE_ORIGIN='https://milo-staging.dgwebservices.nl';
const project='lfsdgxcpdyghidzkzzvn',manifestRoot='/var/lib/milobingo-media/fixtures';
const runtimeLink='/srv/sites/milobingo-staging/current/.runtime.env',broadcastPath='/etc/milobingo-broadcast/staging.json';
const generation=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const fail=(code='fixture_guard')=>{throw Object.assign(Error('De technische stagingfixture voldoet niet aan de veilige voorwaarden.'),{code});};
const items=data=>Array.isArray(data.items)?data.items:[];
const field=(entry,snake,camel)=>entry?.[snake]??entry?.[camel];

export function validateFixtureTarget(env,{host,uid,addresses}={}){
 if(host!=='dg-nxttrack-01'||uid!==0||!addresses?.includes('128.140.93.95'))fail('fixture_host');
 if(env.NODE_ENV!=='production'||env.APP_URL!==FIXTURE_ORIGIN||env.MAIL_ENVIRONMENT!=='staging'||env.MILO_LOCAL_AUTH!=='false'||env.SUPABASE_URL!==`https://${project}.supabase.co`||env.SUPABASE_STORAGE_BUCKET!=='milo-staging'||!env.SUPABASE_DB_CA_BASE64)fail('fixture_environment');
 let database;try{database=new URL(env.DATABASE_URL);}catch{fail('fixture_database');}
 const username=decodeURIComponent(database.username),direct=database.hostname===`db.${project}.supabase.co`,pooler=database.hostname.endsWith('.pooler.supabase.com')&&username.endsWith('.'+project);
 if(!['postgres:','postgresql:'].includes(database.protocol)||!database.username||!database.password||database.pathname!=='/postgres'||(!direct&&!pooler)||database.searchParams.getAll('sslmode').length!==1||database.searchParams.get('sslmode')!=='verify-full')fail('fixture_database');
 postgresTlsOptions(env.DATABASE_URL,{caBase64:env.SUPABASE_DB_CA_BASE64});return true;
}
export function makeProgrammeFixture(now=Date.now()){
 const ownerId=crypto.randomUUID(),game=makeGame({brandId:'milo',title:'TECHNISCHE MEDIAPROEF '+new Date(now).toISOString().slice(0,10),date:new Date(now+86400000).toISOString()},ownerId,FIXTURE_ORIGIN,now);
 const marker=crypto.randomUUID(),initialGeneration=crypto.randomUUID().replaceAll('-','');
 game.testOnly=true;game.technicalFixture={tag:PROGRAMME_FIXTURE_TAG,hidden:true,gameId:game.id,ownerId,marker,createdAt:now};
 game.ordering={enabled:false};game.programBroadcast={version:1,enabled:true,status:'prepared',generation:initialGeneration};
 const manifest={format:1,tag:PROGRAMME_FIXTURE_TAG,origin:FIXTURE_ORIGIN,gameId:game.id,ownerId,marker,createdAt:now,room:'programme-'+game.id,generation:initialGeneration,status:'pending'};
 return {game,manifest};
}
export function validateFixtureManifest(manifest){
 const keys=['format','tag','origin','gameId','ownerId','marker','createdAt','room','generation','status','removedAt'];
 if(!manifest||Object.keys(manifest).some(key=>!keys.includes(key))||manifest.format!==1||manifest.tag!==PROGRAMME_FIXTURE_TAG||manifest.origin!==FIXTURE_ORIGIN||!programmeFixtureUuid(manifest.gameId)||!programmeFixtureUuid(manifest.ownerId)||!programmeFixtureUuid(manifest.marker)||!Number.isSafeInteger(manifest.createdAt)||manifest.createdAt<1||manifest.room!=='programme-'+manifest.gameId||!generation(manifest.generation)||!['pending','active','removed'].includes(manifest.status))fail('fixture_manifest');
 return manifest;
}
export function assertFixtureRecord(row,manifest){
 validateFixtureManifest(manifest);const game=row?.data,tag=game?.technicalFixture;
 if(manifest.status==='removed'||!game||!isProgrammeTestFixture(game)||row.owner_id!==manifest.ownerId||game.ownerId!==manifest.ownerId||game.id!==manifest.gameId||tag.marker!==manifest.marker||tag.createdAt!==manifest.createdAt||game.brandId!=='milo'||game.origin!==FIXTURE_ORIGIN)fail('fixture_identity');
 if(game.status!=='draft'||game.startedAt||game.finishedAt||game.cancelledAt||game.cancellation||game.ordering?.enabled!==false||!generation(game.programBroadcast?.generation)||game.programBroadcast?.version!==1)fail('fixture_changed');
 for(const key of ['books','batches','orders','results','participation','mailDomainEvents'])if(game[key]!==undefined&&(!Array.isArray(game[key])||game[key].length))fail('fixture_real_records');
 if(game.state?.drawn?.length||game.state?.pending||game.state?.window||game.state?.drawHold||game.state?.callId||game.state?.resultId||game.state?.phase!=='lobby')fail('fixture_gameplay');
 return game;
}
export async function assertNoFixtureBusinessRows(db,manifest){
 for(const table of ['bingo_codes','bingo_chat_events','bingo_chat_members','bingo_chat_messages','bingo_chat_operations','bingo_chat_rooms','bingo_payment_receipts']){
  const row=await db.prepare('SELECT COUNT(*) AS count FROM '+table+' WHERE game_id = ?').bind(manifest.gameId).first();if(Number(row?.count)!==0)fail('fixture_related_records');
 }
 for(const [table,column]of [['app_user_roles','user_id'],['bingo_families','account_id'],['studio_outputs','owner_id'],['studio_calls','owner_id']]){
  const row=await db.prepare('SELECT COUNT(*) AS count FROM '+table+' WHERE '+column+' = ?').bind(manifest.ownerId).first();if(Number(row?.count)!==0)fail('fixture_owner_in_use');
 }
}
export async function createFixtureRecord(db,fixture){
 validateFixtureManifest(fixture.manifest);const store=new BingoStore(db);await assertNoFixtureBusinessRows(db,fixture.manifest);
 if(await store.game(fixture.manifest.gameId))fail('fixture_exists');await store.create(fixture.game);
 assertFixtureRecord(await store.game(fixture.manifest.gameId),fixture.manifest);return {...fixture.manifest,status:'active'};
}
export async function cleanupFixtureResources(settings,manifest,fetcher=fetch){
 const room=manifest.room,expected='programme-'+manifest.gameId;
 const ingresses=items(await programService(settings,'Ingress','ListIngress',{room_name:room},fetcher));
 if(ingresses.some(entry=>field(entry,'room_name','roomName')!==room||field(entry,'participant_identity','participantIdentity')!==expected||entry.name!=='milo-programme-'+manifest.gameId))fail('fixture_foreign_ingress');
 const people=(await programService(settings,'RoomService','ListParticipants',{room},fetcher,{ignoreMissing:true})).participants||[];
 if(people.some(person=>(person.tracks||[]).length&&person.identity!==expected))fail('fixture_foreign_publisher');
 const egresses=items(await programService(settings,'Egress','ListEgress',{room_name:room,active:true},fetcher));
 if(egresses.some(entry=>field(entry,'room_name','roomName')!==room))fail('fixture_foreign_egress');
 for(const entry of egresses)await programService(settings,'Egress','StopEgress',{egress_id:field(entry,'egress_id','egressId')},fetcher);
 for(let attempt=0;attempt<20;attempt++){
  if(!items(await programService(settings,'Egress','ListEgress',{room_name:room,active:true},fetcher)).length)break;
  if(attempt===19)fail('fixture_egress_still_active');await new Promise(resolve=>setTimeout(resolve,1000));
 }
 for(const entry of ingresses)await programService(settings,'Ingress','DeleteIngress',{ingress_id:field(entry,'ingress_id','ingressId')},fetcher);
 await programService(settings,'RoomService','DeleteRoom',{room},fetcher,{ignoreMissing:true});
 return {ingresses:ingresses.length,egresses:egresses.length,roomClosed:true};
}
export async function removeFixtureRecord(db,manifest,{cleanup,removeMedia=async()=>{}}={}){
 const store=new BingoStore(db),row=await store.game(manifest.gameId);
 if(!row){validateFixtureManifest(manifest);if(manifest.status==='active')fail('fixture_missing');return {...manifest,status:'removed',removedAt:manifest.removedAt||Date.now()};}
 assertFixtureRecord(row,manifest);await assertNoFixtureBusinessRows(db,manifest);
 if(row.data.programBroadcast.control?.until>Date.now())fail('fixture_control_busy');
 if(typeof cleanup!=='function')fail('fixture_cleanup_required');await cleanup();
 const current=await store.game(manifest.gameId);assertFixtureRecord(current,manifest);await assertNoFixtureBusinessRows(db,manifest);
 // A concurrent change, including a real booking, prevents the exact DELETE.
 // Never delete by title, by owner alone or by a broad test tag.
 if(current.revision!==row.revision||current.document!==row.document)fail('fixture_changed_during_cleanup');
 await removeMedia();
 const removed=await db.prepare('DELETE FROM bingo_games WHERE id = ? AND owner_id = ? AND revision = ? AND document = ? RETURNING id').bind(manifest.gameId,manifest.ownerId,current.revision,current.document).first();
 if(!removed||await store.game(manifest.gameId))fail('fixture_delete_conflict');return {...manifest,status:'removed',removedAt:Date.now()};
}

async function rootDirectory(path,mode=0o700){
 await mkdir(path,{recursive:true,mode});const actual=await realpath(path);if(actual!==path)fail('fixture_symlink');
 for(let at=path;;at=dirname(at)){const info=await lstat(at);if(!info.isDirectory()||info.uid!==0||(info.mode&0o022))fail('fixture_parent');if(at==='/')break;}
 const info=await lstat(path);if(info.mode&0o077)fail('fixture_private_directory');
}
function manifestPath(path){const result=resolve(path);if(dirname(result)!==manifestRoot||!programmeFixtureUuid(result.split('/').at(-1)?.replace(/\.json$/,''))||!result.endsWith('.json'))fail('fixture_manifest_path');return result;}
async function privateJson(path){const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await handle.stat();if(!info.isFile()||info.uid!==0||info.nlink!==1||(info.mode&0o077)||info.size>16384)fail('fixture_private_file');return JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}}
async function writePrivate(path,value,{exclusive=false}={}){
 const temporary=path+'.'+crypto.randomUUID()+'.tmp',handle=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
 try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
 if(exclusive){try{const existing=await lstat(path);if(existing)fail('fixture_file_exists');}catch(error){if(error.code!=='ENOENT'){await unlink(temporary);throw error;}}}
 else{try{const existing=await lstat(path);if(!existing.isFile()||existing.uid!==0||existing.nlink!==1||(existing.mode&0o077))fail('fixture_private_file');}catch(error){if(error.code!=='ENOENT'){await unlink(temporary);throw error;}}}
 await rename(temporary,path);
}
async function runtimeEnvironment(){
 if(hostname()!=='dg-nxttrack-01'||process.getuid?.()!==0||!Object.values(networkInterfaces()).flat().some(address=>address?.address==='128.140.93.95'))fail('fixture_host');
 const path=await realpath(runtimeLink);if(!path.startsWith('/etc/dg-sites/milobingo-staging.runtime.d/')||!path.endsWith('.env'))fail('fixture_runtime_path');
 const info=await lstat(path);if(!info.isFile()||info.uid!==0||info.nlink!==1||(info.mode&0o077)||info.size>150000)fail('fixture_runtime_file');
 const raw=await readFile(path,'utf8'),environment={};
 for(const line of raw.trimEnd().split('\n')){const match=/^([A-Z][A-Z0-9_]*)="((?:[^"\\]|\\[\\"])*)"$/.exec(line);if(!match||Object.hasOwn(environment,match[1]))fail('fixture_runtime_format');environment[match[1]]=match[2].replace(/\\([\\"])/g,'$1');}
 validateFixtureTarget(environment,{host:hostname(),uid:process.getuid?.(),addresses:Object.values(networkInterfaces()).flat().map(address=>address?.address)});
 return {...environment,MILO_BROADCAST_CONFIG:broadcastPath};
}
async function removeMedia(settings,manifest){
 if(!settings.hls)return;const root=await realpath(settings.hls.root),path=join(root,manifest.gameId);let actual;try{actual=await realpath(path);}catch(error){if(error.code==='ENOENT')return;throw error;}if(actual!==path)fail('fixture_media_symlink');
 await rm(path,{recursive:true});
}
export async function main(argv=process.argv.slice(2)){
 let db;
 try{
  const [action,...rest]=argv;if(!['create','inspect','prepare','start-hls','access','stop','remove'].includes(action))fail('fixture_action');
  const options={};for(let i=0;i<rest.length;i+=2){if(rest[i]!=='--manifest'||!rest[i+1]||options.manifest)fail('fixture_arguments');options.manifest=manifestPath(rest[i+1]);}
  const environment=await runtimeEnvironment();await rootDirectory(manifestRoot);const settings=await broadcastConfiguration(environment);if(!settings||settings.url!==FIXTURE_ORIGIN.replace(/^https:/,'wss:')||settings.hls?.root!=='/srv/sites/milobingo-staging/shared/broadcast-hls'||settings.hls?.egressRoot!=='/out')fail('fixture_media_target');
  db=await createPostgresDatabase(environment.DATABASE_URL,{caBase64:environment.SUPABASE_DB_CA_BASE64});
  if(action==='create'){
   if(options.manifest)fail('fixture_create_path');const fixture=makeProgrammeFixture(),path=join(manifestRoot,fixture.game.id+'.json');await writePrivate(path,fixture.manifest,{exclusive:true});
   const manifest=await createFixtureRecord(db,fixture);await writePrivate(path,manifest);console.log(JSON.stringify({action,created:true,manifest:path,gameId:manifest.gameId,room:manifest.room,realAccountsCreated:0}));return;
  }
  if(!options.manifest)fail('fixture_manifest_required');const manifest=validateFixtureManifest(await privateJson(options.manifest));
  if(options.manifest!==join(manifestRoot,manifest.gameId+'.json'))fail('fixture_manifest_path');
  if(action==='remove'){
   const removed=await removeFixtureRecord(db,manifest,{cleanup:()=>cleanupFixtureResources(settings,manifest),removeMedia:()=>removeMedia(settings,manifest)});await writePrivate(options.manifest,removed);
   const session=join(manifestRoot,manifest.gameId+'-session.json');try{const info=await lstat(session);if(!info.isFile()||info.uid!==0||info.nlink!==1||(info.mode&0o077))fail('fixture_private_file');await unlink(session);}catch(error){if(error.code!=='ENOENT')throw error;}
   console.log(JSON.stringify({action,removed:true,gameId:manifest.gameId,realAccountsModified:0}));return;
  }
  const store=new BingoStore(db),row=await store.game(manifest.gameId),game=assertFixtureRecord(row,manifest);await assertNoFixtureBusinessRows(db,manifest);
  if(action==='inspect'){console.log(JSON.stringify({action,gameId:game.id,room:manifest.room,generation:game.programBroadcast.generation,status:game.programBroadcast.status,empty:true}));return;}
  const env={...environment,DB:db,AUTH_IDENTITY:{user:manifest.ownerId,admin:true}};
  if(action==='access'){
   if(game.programBroadcast.enabled!==true||game.programBroadcast.status==='stopped')fail('fixture_stopped');
   const credentials=await programViewerToken(settings,game),cap=programHlsCapability(settings,game),sessionPath=join(manifestRoot,manifest.gameId+'-session.json');
   await writePrivate(sessionPath,{format:'milo-staging-media-session-v1',createdAt:Date.now(),gameId:game.id,room:manifest.room,generation:game.programBroadcast.generation,...credentials,hlsUrl:FIXTURE_ORIGIN+'/api/broadcast/hls/'+cap.capability+'/live.m3u8',hlsExpiresAt:cap.expiresAt});
   await writePrivate(options.manifest,{...manifest,generation:game.programBroadcast.generation});console.log(JSON.stringify({action,privateSessionFile:sessionPath,viewerTokenSeconds:120,hlsReadyNotVerified:true}));return;
  }
  const response=await handleProgramBroadcast(new Request(FIXTURE_ORIGIN+'/api/broadcast/'+game.id+'/control',{method:'POST',headers:{Origin:FIXTURE_ORIGIN,'Content-Type':'application/json','X-Milo-Broadcast':'1'},body:JSON.stringify({action:action==='stop'?'stop':action,requestId:crypto.randomUUID()})}),env),result=await response.json();if(!response.ok)fail(result.error?.code||'fixture_provider');
  const current=assertFixtureRecord(await store.game(game.id),manifest);await writePrivate(options.manifest,{...manifest,generation:current.programBroadcast.generation});
  if(action==='prepare'){const sessionPath=join(manifestRoot,game.id+'-session.json');await writePrivate(sessionPath,{format:'milo-staging-media-session-v1',createdAt:Date.now(),gameId:game.id,room:manifest.room,generation:current.programBroadcast.generation,whip:result.whip,encoder:result.encoder});console.log(JSON.stringify({action,privateSessionFile:sessionPath,configured:true}));}
  else console.log(JSON.stringify({action,status:result.status?.state,hlsAvailable:result.status?.hls?.available===true}));
 }catch(error){console.error(JSON.stringify({ok:false,code:/^[a-z_]+$/.test(error.code||'')?error.code:'fixture_failed',credentialsPrinted:false}));process.exitCode=1;}
 finally{await db?.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
