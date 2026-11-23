// A bounded, root-only production media smoke fixture. No Auth users, books,
// orders or game rounds are created. The existing staging CLI stays unchanged.
import {hostname,networkInterfaces} from 'node:os';
import {constants} from 'node:fs';
import {lstat,mkdir,open,readFile,realpath,rename,rm,unlink,link} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {makeGame} from '../../server/bingo-model.js';
import {BingoStore} from '../../server/bingo-store.js';
import {createPostgresDatabase} from '../../server/node-storage.js';
import {postgresTlsOptions} from '../../server/node-postgres-tls.js';
import {PROGRAMME_FIXTURE_TAG,isProgrammeTestFixture,programmeFixtureUuid} from '../../server/programme-test-fixture.js';
import {broadcastConfiguration,handleProgramBroadcast,programHlsCapability,programService,programViewerToken} from '../../server/program-broadcast.js';

export const ORIGIN='https://milo.dgwebservices.nl';
const project='msupvdycmtbycaonqgan',root='/var/lib/milobingo-media/production-setup',manifestPath=root+'/fixture.json';
const tag='milo-production-media-smoke-v1',runtimeLink='/srv/sites/milobingo-production/current/.runtime.env';
const fail=()=>{throw Error('Production smoke fixture refused');};
const check=value=>{if(!value)fail();};
async function assertNoFixtureBusinessRows(db,manifest){
 for(const table of ['bingo_codes','bingo_chat_events','bingo_chat_members','bingo_chat_messages','bingo_chat_operations','bingo_chat_rooms','bingo_payment_receipts']){
  const row=await db.prepare('SELECT COUNT(*) AS count FROM '+table+' WHERE game_id = ?').bind(manifest.gameId).first();check(Number(row?.count)===0);
 }
 for(const [table,column] of [['app_user_roles','user_id'],['bingo_families','account_id'],['studio_outputs','owner_id'],['studio_calls','owner_id']]){
  const row=await db.prepare('SELECT COUNT(*) AS count FROM '+table+' WHERE '+column+' = ?').bind(manifest.ownerId).first();check(Number(row?.count)===0);
 }
}
async function cleanupFixtureResources(settings,manifest){
 const room=manifest.room,field=(value,a,b)=>value?.[a]??value?.[b];
 const ingress=(await programService(settings,'Ingress','ListIngress',{room_name:room})).items||[];
 check(ingress.every(value=>field(value,'room_name','roomName')===room&&field(value,'participant_identity','participantIdentity')===room&&value.name==='milo-programme-'+manifest.gameId));
 const people=(await programService(settings,'RoomService','ListParticipants',{room},fetch,{ignoreMissing:true})).participants||[];check(people.every(value=>!value.tracks?.length||value.identity===room));
 const egress=(await programService(settings,'Egress','ListEgress',{room_name:room,active:true})).items||[];check(egress.every(value=>field(value,'room_name','roomName')===room));
 for(const value of egress)await programService(settings,'Egress','StopEgress',{egress_id:field(value,'egress_id','egressId')});
 for(let attempt=0;attempt<20;attempt++){
  if(!((await programService(settings,'Egress','ListEgress',{room_name:room,active:true})).items||[]).length)break;
  check(attempt!==19);await new Promise(done=>setTimeout(done,1000));
 }
 for(const value of ingress)await programService(settings,'Ingress','DeleteIngress',{ingress_id:field(value,'ingress_id','ingressId')});
 await programService(settings,'RoomService','DeleteRoom',{room},fetch,{ignoreMissing:true});return {ingresses:ingress.length,egresses:egress.length,roomClosed:true};
}
async function privateJson(path){
 const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const info=await fd.stat();check(info.isFile()&&info.uid===0&&info.nlink===1&&!(info.mode&0o077)&&info.size<=150000);return JSON.parse(await fd.readFile('utf8'));}finally{await fd.close();}
}
async function write(path,value,{exclusive=false}={}){
 check(dirname(path)===root);const temporary=path+'.'+crypto.randomUUID()+'.tmp';
 const fd=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_WRONLY,0o600);
 try{await fd.writeFile(JSON.stringify(value,null,2)+'\n');await fd.sync();}finally{await fd.close();}
 if(exclusive){try{await link(temporary,path);}finally{await unlink(temporary);}return;}
 try{await privateJson(path);}catch(error){if(error.code!=='ENOENT'){await unlink(temporary);throw error;}}
 await rename(temporary,path);
}
export function validateProductionFixture(manifest,game){
 check(manifest?.format===1&&manifest.tag===tag&&manifest.origin===ORIGIN&&programmeFixtureUuid(manifest.gameId)&&programmeFixtureUuid(manifest.ownerId)&&programmeFixtureUuid(manifest.marker)&&manifest.room==='programme-'+manifest.gameId&&Number.isSafeInteger(manifest.createdAt)&&['pending','active','removed'].includes(manifest.status));
 if(game){
  check(manifest.status!=='removed'&&isProgrammeTestFixture(game)&&game.id===manifest.gameId&&game.ownerId===manifest.ownerId&&game.origin===ORIGIN&&game.technicalFixture.marker===manifest.marker&&game.technicalFixture.scope===tag&&game.technicalFixture.createdAt===manifest.createdAt&&game.createdAt===manifest.createdAt);
  check(game.status==='draft'&&!game.startedAt&&!game.finishedAt&&!game.cancelledAt&&game.ordering?.enabled===false&&game.state?.phase==='lobby'&&!game.state.pending&&!game.state.window&&!game.state.drawHold&&!game.state.resultId&&!game.state.callId&&!game.state.drawn?.length);
  for(const key of ['books','batches','orders','results','participation','mailDomainEvents'])check(game[key]===undefined||Array.isArray(game[key])&&game[key].length===0);
  check(game.programBroadcast?.version===1&&/^[a-f0-9]{32}$/.test(game.programBroadcast.generation));
 }
 return manifest;
}
async function runtime(){
 check(process.getuid()===0&&hostname()==='dg-nxttrack-01'&&Object.values(networkInterfaces()).flat().some(value=>value?.address==='128.140.93.95'));
 await mkdir(root,{recursive:true,mode:0o700});
 for(let path=root;;path=dirname(path)){const info=await lstat(path);check(info.isDirectory()&&info.uid===0&&!(info.mode&0o022));if(path==='/')break;}
 check(await realpath(root)===root&&!((await lstat(root)).mode&0o077));
 const path=await realpath(runtimeLink);check(path.startsWith('/etc/dg-sites/milobingo-production.runtime.d/')&&path.endsWith('.env'));
 const info=await lstat(path);check(info.uid===0&&info.isFile()&&info.nlink===1&&!(info.mode&0o077)&&info.size<=150000);
 const env={};for(const line of(await readFile(path,'utf8')).trimEnd().split('\n')){const match=/^([A-Z][A-Z0-9_]*)="((?:[^"\\]|\\[\\"])*)"$/.exec(line);check(match&&!Object.hasOwn(env,match[1]));env[match[1]]=match[2].replace(/\\([\\"])/g,'$1');}
 const db=new URL(env.DATABASE_URL),username=decodeURIComponent(db.username);
 check(env.APP_URL===ORIGIN&&env.SUPABASE_URL==='https://'+project+'.supabase.co'&&env.NODE_ENV==='production'&&env.MAIL_ENVIRONMENT==='production'&&env.MILO_LOCAL_AUTH==='false');
 check(['postgres:','postgresql:'].includes(db.protocol)&&db.pathname==='/postgres'&&db.searchParams.get('sslmode')==='verify-full'&&(db.hostname==='db.'+project+'.supabase.co'||db.hostname.endsWith('.pooler.supabase.com')&&username.endsWith('.'+project)));
 postgresTlsOptions(env.DATABASE_URL,{caBase64:env.SUPABASE_DB_CA_BASE64});return {...env,MILO_BROADCAST_CONFIG:'/etc/milobingo-broadcast/production.json'};
}
async function freshActivity(){
 const value=await privateJson(root+'/activity.json'),age=Date.now()-Date.parse(value.checkedAt);
 check(value.format===1&&value.host==='dg-nxttrack-01'&&age>=-5000&&age<=60000&&value.activeRealShow===false&&value.namespace.sharedGameIds===0&&value.namespace.productionBroadcastRows===0);
}
export async function main(args=process.argv.slice(2)){
 let db;try{
  check(args.length===1&&['create','inspect','prepare','access','start-hls','stop','remove'].includes(args[0]));const action=args[0],env=await runtime(),settings=await broadcastConfiguration(env);
  check(settings?.url==='wss://milo.dgwebservices.nl'&&settings.hls?.root==='/srv/sites/milobingo-production/shared/broadcast-hls'&&settings.hls.egressRoot==='/out-production');
  db=await createPostgresDatabase(env.DATABASE_URL,{caBase64:env.SUPABASE_DB_CA_BASE64});const store=new BingoStore(db);
  if(action==='create'){
   await freshActivity();try{await lstat(manifestPath);fail();}catch(error){if(error.code!=='ENOENT')throw error;}
   const now=Date.now(),ownerId=crypto.randomUUID(),game=makeGame({brandId:'milo',title:'Afgeschermde technische mediacontrole',date:new Date(now+86400000).toISOString()},ownerId,ORIGIN,now);
   const manifest={format:1,tag,origin:ORIGIN,gameId:game.id,ownerId,marker:crypto.randomUUID(),createdAt:now,room:'programme-'+game.id,status:'pending'};
   game.testOnly=true;game.technicalFixture={tag:PROGRAMME_FIXTURE_TAG,scope:tag,hidden:true,gameId:game.id,ownerId,marker:manifest.marker,createdAt:now};game.ordering={enabled:false};game.programBroadcast={version:1,enabled:true,generation:crypto.randomUUID().replaceAll('-',''),status:'prepared'};
   validateProductionFixture(manifest,game);await assertNoFixtureBusinessRows(db,manifest);check(!await store.game(game.id));
   const rooms=(await programService(settings,'RoomService','ListRooms',{})).rooms||[];check(!rooms.some(value=>value.name===manifest.room));
   const ingresses=(await programService(settings,'Ingress','ListIngress',{room_name:manifest.room})).items||[];check(ingresses.length===0);
   await write(manifestPath,manifest,{exclusive:true});await store.create(game);manifest.status='active';await write(manifestPath,manifest);console.log(JSON.stringify({action,created:true,hidden:true,realAccountsCreated:0,realOrdersCreated:0,manifest:manifestPath}));return;
  }
  const manifest=validateProductionFixture(await privateJson(manifestPath));const row=await store.game(manifest.gameId);
  if(action==='remove'&&manifest.status==='removed'){check(!row);console.log(JSON.stringify({action,removed:true,replayed:true,realAccountsModified:0,realOrdersModified:0}));return;}
  if(action==='remove'&&manifest.status==='pending'&&!row){const cleaned=await cleanupFixtureResources(settings,manifest);await assertNoFixtureBusinessRows(db,manifest);await write(manifestPath,{...manifest,status:'removed',removedAt:Date.now()});console.log(JSON.stringify({action,removed:true,...cleaned,realAccountsModified:0,realOrdersModified:0}));return;}
  check(manifest.status==='active'||action==='remove'&&manifest.status==='pending');check(row?.owner_id===manifest.ownerId);validateProductionFixture(manifest,row.data);await assertNoFixtureBusinessRows(db,manifest);
  if(action==='inspect'){console.log(JSON.stringify({action,hidden:true,status:row.data.status,empty:true,providerConfigured:true}));return;}
  if(action==='access'){
   const game=row.data,viewer=await programViewerToken(settings,game),relay=await programViewerToken(settings,game),cap=programHlsCapability(settings,game);
   const prior=await privateJson(root+'/encoder.json');check(prior.gameId===manifest.gameId&&prior.whip.url.startsWith(ORIGIN+'/whip/'));
   const value={format:tag,origin:ORIGIN,livekitUrl:settings.url,testOnly:true,fixture:{tag,hidden:true,gameId:game.id,ownerId:manifest.ownerId,marker:manifest.marker,generation:game.programBroadcast.generation,createdAt:manifest.createdAt,orderingEnabled:false,realAccounts:0,realOrders:0},whipUrl:prior.whip.url,viewerToken:viewer.token,relayViewerToken:relay.token,hlsUrl:ORIGIN+'/api/broadcast/hls/'+cap.capability+'/live.m3u8',seconds:60};
   await write(root+'/smoke-config.json',value);console.log(JSON.stringify({action,privateConfig:root+'/smoke-config.json',viewerPublish:false,viewerDataPublish:false,viewerTokenSeconds:120,credentialsPrinted:false}));return;
  }
  if(action==='remove'){
   const cleaned=await cleanupFixtureResources(settings,manifest);const current=await store.game(manifest.gameId);validateProductionFixture(manifest,current?.data);await assertNoFixtureBusinessRows(db,manifest);
   const media=join(settings.hls.root,manifest.gameId);try{check(await realpath(media)===media);await rm(media,{recursive:true});}catch(error){if(error.code!=='ENOENT')throw error;}
   const removed=await db.prepare('DELETE FROM bingo_games WHERE id = ? AND owner_id = ? AND revision = ? AND document = ? RETURNING id').bind(manifest.gameId,manifest.ownerId,current.revision,current.document).first();check(removed?.id===manifest.gameId&&!await store.game(manifest.gameId));
   await write(manifestPath,{...manifest,status:'removed',removedAt:Date.now()});for(const name of ['encoder.json','smoke-config.json']){try{await privateJson(root+'/'+name);await unlink(root+'/'+name);}catch(error){if(error.code!=='ENOENT')throw error;}}
   console.log(JSON.stringify({action,removed:true,...cleaned,realAccountsModified:0,realOrdersModified:0}));return;
  }
  const response=await handleProgramBroadcast(new Request(ORIGIN+'/api/broadcast/'+manifest.gameId+'/control',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json','X-Milo-Broadcast':'1'},body:JSON.stringify({action,requestId:crypto.randomUUID()})}),{...env,DB:db,AUTH_IDENTITY:{user:manifest.ownerId,admin:true}}),value=await response.json();check(response.ok);
  if(action==='prepare'){check(value.whip?.url?.startsWith(ORIGIN+'/whip/'));await write(root+'/encoder.json',{gameId:manifest.gameId,whip:value.whip,encoder:value.encoder});}
  console.log(JSON.stringify({action,configured:true,state:value.status?.state,hlsAvailable:value.status?.hls?.available===true,credentialsPrinted:false}));
 }catch{console.error(JSON.stringify({status:'production-fixture-refused',credentialsPrinted:false}));process.exitCode=1;}finally{await db?.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
