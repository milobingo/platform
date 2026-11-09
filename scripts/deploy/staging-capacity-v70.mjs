import {Pool} from 'pg';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createPostgresDatabase} from '../../server/node-storage.js';
import {postgresTlsOptions} from '../../server/node-postgres-tls.js';
import {BingoStore} from '../../server/bingo-store.js';
import {handleBingo} from '../../server/bingo.js';
import {makeGame,generateBooks,activateBlock,activeGoal,claimContext,familyDefault} from '../../server/bingo-model.js';
import {publishGameRules} from '../../server/game-rules.js';
import {gameCapacity} from '../../server/game-capacity.js';
import {loadManifest,validateTarget,verifyDatabaseClientTls} from './database.mjs';

const PROJECT='lfsdgxcpdyghidzkzzvn',TABLES=['bingo_games','bingo_families','bingo_codes'];
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw Object.assign(new Error('De begrensde Milo-capaciteitsproef is gestopt. Geen credentials of speldocumenten worden gelogd.'),{code});};
const check=(condition,code)=>{if(!condition)fail(code);};
export function capacitySchema(runId){check(typeof runId==='string'&&/^[1-9][0-9]{0,19}$/.test(runId),'capacity_run_id');return 'milo_v70_fixture_'+runId;}
export function capacityTarget(env,runId){
 const schema=capacitySchema(runId),target=validateTarget(env,PROJECT);
 check(![...target.database.searchParams.keys()].some(key=>['options','search_path'].includes(key.toLowerCase())),'capacity_base_options');
 check(!!env.SUPABASE_DB_CA_BASE64,'capacity_ca_required');
 return {schema,target};
}

async function publicFingerprint(client,tables){
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  const result=[];
  for(const table of tables){check(/^[a-z_]+$/.test(table),'capacity_table_name');const row=(await client.query(`WITH row_hashes AS (SELECT encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex') AS h FROM public.${quote(table)} t) SELECT count(*)::text AS rows,encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') AS digest FROM row_hashes`)).rows[0];result.push({table,rows:row.rows,digest:row.digest});}
  await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK');throw error;}
}
async function schemaObjects(client,schema){
 const relations=(await client.query('SELECT c.oid::text AS oid,c.relname AS name,c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.oid',[schema])).rows;
 const types=(await client.query('SELECT t.oid::text AS oid,t.typname AS name FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 ORDER BY t.oid',[schema])).rows;
 const functions=(await client.query('SELECT p.oid::text AS oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1',[schema])).rows;
 return {relations,types,functions};
}
async function createFixtureSchema(client,schema){
 await client.query('BEGIN');
 try{
  check(!(await client.query('SELECT to_regnamespace($1) AS namespace',[schema])).rows[0].namespace,'capacity_schema_collision');
  await client.query(`CREATE SCHEMA ${quote(schema)} AUTHORIZATION CURRENT_USER`);
  const roles=(await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname")).rows.map(r=>r.rolname),grantees=['PUBLIC',...roles.map(quote)].join(',');
  await client.query(`REVOKE ALL ON SCHEMA ${quote(schema)} FROM ${grantees}`);
  for(const table of TABLES){await client.query(`CREATE TABLE ${quote(schema)}.${quote(table)} (LIKE public.${quote(table)} INCLUDING ALL)`);await client.query(`ALTER TABLE ${quote(schema)}.${quote(table)} ENABLE ROW LEVEL SECURITY`);await client.query(`REVOKE ALL ON TABLE ${quote(schema)}.${quote(table)} FROM ${grantees}`);}
  for(const role of roles)check(!(await client.query('SELECT has_schema_privilege($1,$2,$3) AS allowed',[role,schema,'USAGE'])).rows[0].allowed,'capacity_browser_access');
  const objects=await schemaObjects(client,schema);check(objects.functions.length===0&&objects.relations.filter(r=>r.kind==='r').length===3&&objects.relations.every(r=>['r','i'].includes(r.kind)),'capacity_fixture_contract');
  const identity=(await client.query('SELECT oid::text AS oid,nspowner::text AS owner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];
  await client.query('COMMIT');return {objects,identity,browserRolesChecked:roles.length};
 }catch(error){await client.query('ROLLBACK');throw error;}
}
async function removeFixtureSchema(client,schema,created){
 await client.query('BEGIN');
 try{
  const identity=(await client.query('SELECT oid::text AS oid,nspowner::text AS owner FROM pg_namespace WHERE nspname=$1',[schema])).rows[0];check(hash(identity)===hash(created.identity),'capacity_cleanup_identity');
  await client.query(`LOCK TABLE ${TABLES.map(table=>quote(schema)+'.'+quote(table)).join(',')} IN ACCESS EXCLUSIVE MODE`);
  check(hash(await schemaObjects(client,schema))===hash(created.objects),'capacity_cleanup_unknown_objects');
  await client.query(`DROP TABLE ${TABLES.map(table=>quote(schema)+'.'+quote(table)).join(',')} RESTRICT`);
  await client.query(`DROP SCHEMA ${quote(schema)} RESTRICT`);await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}
}
export function qualifyCapacitySql(sql,schema){
 check(/^milo_v70_fixture_[1-9][0-9]{0,19}$/.test(schema)&&typeof sql==='string'&&/^\s*(SELECT|INSERT|UPDATE)\b/i.test(sql),'capacity_sql_fence');
 const tokens=[];
 for(let i=0;i<sql.length;){
  const char=sql[i];
  if(char==="'"||char==='"'){const start=i++,end=char;let closed=false;for(;i<sql.length;i++)if(sql[i]===end){if(sql[i+1]===end){i++;continue;}i++;closed=true;break;}check(closed,'capacity_sql_literal');const raw=sql.slice(start,i);tokens.push({raw,identifier:char==='"'?raw.slice(1,-1).replaceAll('""','"'):null,string:char==="'"});continue;}
  const word=/^[a-z_][a-z0-9_]*/i.exec(sql.slice(i));if(word){tokens.push({raw:word[0],identifier:word[0].toLowerCase()});i+=word[0].length;continue;}
  check(char!==';'&&char!=='$'&&sql.slice(i,i+2)!=='--'&&sql.slice(i,i+2)!=='/*','capacity_sql_fence');tokens.push({raw:char});i++;
 }
 let relation=false;
 return tokens.map((token,index)=>{
  if(!token.identifier){if(relation&&token.raw.trim())fail('capacity_relation_fence');return token.raw;}
  const name=token.identifier.toLowerCase();
  if(relation){check([...TABLES,'json_each'].includes(name),'capacity_relation_fence');relation=false;}
  if(['from','join','into','update'].includes(name))relation=true;
  if(TABLES.includes(name)){
   const previous=tokens.slice(0,index).findLast(t=>t.raw.trim()),next=tokens.slice(index+1).find(t=>t.raw.trim());check(previous?.raw!=='.'&&next?.raw!=='.','capacity_qualified_input');return quote(schema)+'.'+quote(name);
  }
  check(!name.startsWith('bingo_'),'capacity_relation_fence');return token.raw;
 }).join('');
}
function fencedDatabase(db,metrics,schema){
 const execute=db.execute.bind(db),batch=db.batch.bind(db),prepare=db.prepare.bind(db);
 db.prepare=sql=>{qualifyCapacitySql(sql,schema);return prepare(sql);};
 db.execute=async(sql,args)=>{const result=await execute(qualifyCapacitySql(sql,schema),args);if(/bingo_games/.test(sql))for(const row of result.results)if(row.document)metrics.peakDocumentBytes=Math.max(metrics.peakDocumentBytes,Buffer.byteLength(row.document));if(/^UPDATE/i.test(sql)&&/RETURNING/i.test(sql)&&!result.results.length)metrics.storageConflicts++;return result;};
 db.batch=async statements=>{const qualified=statements.map(s=>{check(s.database===db,'capacity_foreign_statement');return prepare(qualifyCapacitySql(s.sql,schema)).bind(...s.args);});const result=await batch(qualified);if(!result[0]?.results?.length)metrics.storageConflicts++;return result;};return db;
}
async function parallel(items,limit,operation){let index=0,error;await Promise.all(Array.from({length:limit},async()=>{while(!error){const current=index++;if(current>=items.length)return;try{await operation(items[current],current);}catch(cause){error=cause;}}}));if(error)throw error;}

export async function runCapacityScenario(database,{schema,leaseSeconds=180,concurrency=10,deadline=Date.now()+240000}={}){
 check([30,60,180].includes(leaseSeconds)&&Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=10,'capacity_bounds');
 const metrics={households:100,books:400,cardCount:1600,successfulOperations:0,apiAttempts:0,apiConflicts:0,retries:0,storageConflicts:0,peakDocumentBytes:0},db=fencedDatabase(database,metrics,schema),store=new BingoStore(db),started=performance.now(),latencies=[];
 const budget=()=>check(Date.now()<deadline,'capacity_time_budget');
 const game=makeGame({brandId:'milo',date:'2027-12-05T19:00:00Z',roundCount:4,settings:{claimSeconds:leaseSeconds}},'fixture-capacity-host','https://capacity.example.test');
 while(game.books.length<400)generateBooks(game,Math.min(150,400-game.books.length),'fixture-batch-'+game.books.length);
 for(const [i,book] of game.books.entries())Object.assign(book,{accountId:'fixture-family-'+Math.floor(i/4),profileId:'fixture-child-'+i,name:'Fixture '+i});
 game.status='running';activateBlock(game,game.plan.blocks.findIndex(b=>b.type==='round'));activeGoal(game).pattern.cells=[0];game.books.forEach(book=>{book.cards[0][0]=1;});game.state.drawn=[1];
 // The fixture uses the real current rules contract before any API action.
 const publication=structuredClone(game);publication.status='draft';publishGameRules(publication);game.rulesPublication=publication.rulesPublication;
 const identities=hash(game.books),captured=claimContext(game);check(gameCapacity(game).startReady,'capacity_fixture_oversized');await store.create(game);
 await parallel(Array.from({length:100},(_,i)=>i),concurrency,async i=>{budget();const family=familyDefault('fixture-family-'+i+'@example.test');family.ownerName='Fictief huishouden '+i;family.profiles=Array.from({length:4},(_,j)=>({id:'fixture-child-'+(i*4+j),name:'Fixture '+(i*4+j),age:8}));await db.prepare('INSERT INTO bingo_families (account_id,revision,document) VALUES (?,1,?)').bind('fixture-family-'+i,JSON.stringify(family)).run();});
 await db.prepare('INSERT INTO bingo_codes (code,game_id) SELECT value,? FROM json_each(?)').bind(game.id,JSON.stringify(game.books.map(book=>book.code))).run();
 const api=async(action,body,user,requestId,method='POST')=>{budget();const response=await handleBingo(new Request('https://capacity.example.test/api/bingo/games/'+game.id+(action?'/'+action:''),{method,headers:{Origin:'https://capacity.example.test','X-Vlampie-Bingo':'1','Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({regieId:'fixture-capacity-regie',requestId,...body})}:{})}),{DB:db,AUTH_IDENTITY:{user,email:user+'@example.test',admin:user==='fixture-capacity-host',method:'isolated-capacity-fixture'}});return {status:response.status,data:await response.json()};};
 const operate=async(action,body,user,requestId)=>{const began=performance.now();for(let attempt=0;attempt<20;attempt++){budget();metrics.apiAttempts++;const response=await api(action,body,user,requestId);if(response.status===200){metrics.successfulOperations++;latencies.push(performance.now()-began);return response.data;}check(response.status===409&&response.data.error?.code==='conflict','capacity_api_refused');metrics.apiConflicts++;metrics.retries++;await new Promise(done=>setTimeout(done,25+attempt*10));}fail('capacity_retry_exhausted');};
 const windows=[];await parallel(Array.from({length:100},(_,i)=>i),concurrency,async i=>{const result=await operate('begin',{claimContext:captured},'fixture-family-'+i,'capacity-begin-'+i);windows.push(result.game.state.claimContext);});
 check(new Set(windows.map(w=>w.windowId)).size===1,'capacity_multiple_windows');const context=windows[0],claims=[];
 await parallel(game.books,concurrency,async(book,i)=>{const result=await operate('claim',{claimContext:context,bookId:book.id},book.accountId,'capacity-claim-'+i);check(result.claim?.status==='valid','capacity_invalid_claim');claims.push(result.claim);});
 check(metrics.successfulOperations===500&&claims.length===400&&new Set(claims.map(c=>c.id)).size===400,'capacity_operation_count');
 const saved=(await store.game(game.id)).data;check(saved.state.window.claims.length===400&&saved.state.window.announcements.length===100&&hash(saved.books)===identities,'capacity_ids_or_claims_changed');
 const duplicate=await api('claim',{claimContext:context,bookId:game.books[0].id},game.books[0].accountId,'capacity-claim-0');check(duplicate.status===200&&duplicate.data.claim.id===claims.find(c=>c.bookId===game.books[0].id).id,'capacity_retry_changed_claim');
 const foreign=await api('claim',{claimContext:context,bookId:game.books[0].id},'fixture-family-1','capacity-foreign-claim');check(foreign.status===403,'capacity_foreign_claim');
 while(Date.now()<saved.state.window.endsAt){budget();await new Promise(done=>setTimeout(done,Math.min(1000,saved.state.window.endsAt-Date.now())));}
 const settlement=await Promise.all([api('',{},'fixture-capacity-host','capacity-settle-1','GET'),api('',{},'fixture-capacity-host','capacity-settle-2','GET')]);check(settlement.every(r=>r.status===200),'capacity_settlement_refused');
 const settled=(await store.game(game.id)).data,winner=settled.results[0];check(settled.results.length===1&&winner.entrants.length===400&&settled.events.filter(e=>e.type==='window-closed').length===1&&hash(settled.books)===identities,'capacity_settlement_invariant');
 const after=await api('',{},'fixture-capacity-host','capacity-settle-repeat','GET');check(after.status===200&&after.data.game.results[0].id===winner.id&&after.data.game.results[0].winner.bookId===winner.winner.bookId,'capacity_redrawn_winner');
 const late=await api('claim',{claimContext:context,bookId:game.books[0].id},game.books[0].accountId,'capacity-after-deadline');check(late.status===409,'capacity_late_claim');
 const family=(await store.family(game.books[0].accountId)).data;check(!(family.falseCounts[game.id]>0),'capacity_boundary_sanction');
 const codes=(await db.prepare('SELECT code FROM bingo_codes WHERE game_id = ?').bind(game.id).all()).results;check(hash(codes.map(r=>r.code).sort())===hash(game.books.map(b=>b.code).sort()),'capacity_codes_changed');
 latencies.sort((a,b)=>a-b);return {...metrics,boundaryApiResponses:6,totalApiResponses:metrics.apiAttempts+6,elapsedMs:Math.round(performance.now()-started),concurrency,leaseSeconds,latencyMs:{p50:Math.round(latencies[249]),p95:Math.round(latencies[474]),max:Math.round(latencies.at(-1))},results:1,entrants:400,idsPreserved:true,realDeadlineObserved:true,boundaryChecks:{exactReplay:true,foreignBookRefused:true,lateClaimRefused:true,noBoundarySanction:true},providerCalls:0,fixtureIdentitiesOnly:true};
}

export async function stagingCapacityProof({env=process.env,runId,leaseSeconds=180,poolFactory=options=>new Pool(options),databaseFactory=createPostgresDatabase,tlsVerifier=verifyDatabaseClientTls,scenario=runCapacityScenario}={}){
 const startedAt=Date.now(),workDeadline=startedAt+240000;
 if(env.RELEASE_SHA!==undefined)check(/^[a-f0-9]{40}$/.test(env.RELEASE_SHA),'capacity_release_sha');
 const {schema,target}=capacityTarget(env,runId),tls=postgresTlsOptions(env.DATABASE_URL,{caBase64:env.SUPABASE_DB_CA_BASE64}),pool=poolFactory({...tls,max:1,connectionTimeoutMillis:10000,statement_timeout:15000,lock_timeout:5000,idle_in_transaction_session_timeout:30000});
 let client,created,db,before,after,result,error,cleaned=false,publicUnchanged=false;
 try{
  client=await pool.connect();tlsVerifier(client,target.database.hostname);
  const identity=(await client.query('SELECT r.oid::text AS oid,r.rolsuper OR r.rolbypassrls AS bypass FROM pg_roles r WHERE r.rolname=current_user')).rows[0];
  const manifest=await loadManifest(),tables=[...manifest.tables.keys()];
  const owners=(await client.query("SELECT relowner::text AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relkind='r'",[tables])).rows;
  check(owners.length===23&&(identity.bypass||owners.every(r=>r.owner===identity.oid)),'capacity_source_visibility');before=await publicFingerprint(client,tables);
  created=await createFixtureSchema(client,schema);
  // The native adapter performs a harmless initial public-table shape read.
  // All subsequent scenario relations are lexically pinned to our schema;
  // correctness does not depend on a pooler's startup search_path behavior.
  db=await databaseFactory(env.DATABASE_URL,{caBase64:env.SUPABASE_DB_CA_BASE64});
  check(Date.now()<workDeadline,'capacity_time_budget');result=await scenario(db,{schema,leaseSeconds,concurrency:10,deadline:workDeadline});
 }catch(cause){error=cause;}
 finally{
  try{await db?.close();}catch(cause){error=cause;}
  try{if(created){await removeFixtureSchema(client,schema,created);cleaned=true;}}catch(cause){error=cause;}
  try{if(before){after=await publicFingerprint(client,before.map(r=>r.table));publicUnchanged=hash(before)===hash(after);check(publicUnchanged,'capacity_public_data_changed');}}catch(cause){error=cause;}
  finally{client?.release();await pool.end();}
 }
 if(Date.now()-startedAt>300000)error=Object.assign(new Error('De proef overschreed de vijfminutengrens.'),{code:'capacity_time_budget'});
 if(error){error.capacityEvidence={ok:false,runId,releaseSha:env.RELEASE_SHA||null,fixtureSchema:schema,fixtureCreated:!!created,fixtureSchemaRemoved:cleaned,publicTablesUnchanged:publicUnchanged,publicTables:before||[],code:typeof error.code==='string'&&error.code.startsWith('capacity_')?error.code:'capacity_failed'};throw error;}
 return {ok:true,runId,releaseSha:env.RELEASE_SHA||null,fixtureSchema:schema,fixtureSchemaRemoved:cleaned,publicTablesUnchanged:true,publicTables:before,storage:'native PostgreSQL adapter against isolated staging schema',...result};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  check(process.argv.length===3&&process.argv[2]==='--run-id='+process.env.GITHUB_RUN_ID&&process.env.GITHUB_REPOSITORY==='milobingo/platform'&&process.env.GITHUB_REF==='refs/heads/main'&&process.env.GITHUB_EVENT_NAME==='workflow_dispatch','capacity_workflow_identity');
  check(/^[a-f0-9]{40}$/.test(process.env.RELEASE_SHA||''),'capacity_release_sha');
  const head=execFileSync('/usr/bin/git',['rev-parse','--verify','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'}}).trim();check(head===process.env.RELEASE_SHA,'capacity_checkout_sha');
  const result=await stagingCapacityProof({runId:process.env.GITHUB_RUN_ID});await writeFile('staging-v70-capacity.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({ok:true,successfulOperations:result.successfulOperations,apiAttempts:result.apiAttempts,apiConflicts:result.apiConflicts,peakDocumentBytes:result.peakDocumentBytes,elapsedMs:result.elapsedMs,fixtureSchemaRemoved:result.fixtureSchemaRemoved,publicTablesUnchanged:true}));
 }catch(error){if(error.capacityEvidence)await writeFile('staging-v70-capacity.json',JSON.stringify(error.capacityEvidence,null,2)+'\n',{mode:0o600});console.error(JSON.stringify({ok:false,code:typeof error.code==='string'&&error.code.startsWith('capacity_')?error.code:'capacity_failed',message:'De geïsoleerde capaciteitsproef is gestopt. Controleer cleanup en behoud de bestaande release; geen credential- of driverdetails gelogd.'}));process.exitCode=1;}
}
