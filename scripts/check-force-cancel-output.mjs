import test from 'node:test';
import assert from 'node:assert/strict';
import {createSqliteDatabase,createPostgresDatabase} from '../server/node-storage.js';
import {BingoStore} from '../server/bingo-store.js';
import {makeGame,forceCancelGame} from '../server/bingo-model.js';
import {handleOutput,cancelGameOutput} from '../server/output.js';
import {OutputBridge} from '../public/output-bridge.js';
import {Pool} from 'pg';
import {readFile,readdir} from 'node:fs/promises';

async function fixture(t,{postgres=false}={}){
 let db,admin,schema;
 if(postgres){
  const source=new URL(process.env.MILO_TEST_DATABASE_URL);assert(['localhost','127.0.0.1','[::1]'].includes(source.hostname)&&/test/i.test(source.pathname));
  admin=new Pool({connectionString:source.toString()});schema='milo_cancel_output_'+crypto.randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
  const client=await admin.connect();try{await client.query('SET search_path TO '+schema);for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort())await client.query((await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replaceAll('public.',schema+'.').replaceAll('SCHEMA public','SCHEMA '+schema));}finally{client.release();}
  source.searchParams.set('options','-c search_path='+schema);db=await createPostgresDatabase(source.toString(),{allowLoopback:true});
 }else db=createSqliteDatabase(':memory:');
 t.after(async()=>{await db.close();if(admin){await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}});
 const store=new BingoStore(db),game=makeGame({brandId:'milo',title:'Geannuleerde uitzending',date:'2027-12-05T19:00:00Z'},'host','https://studio.example');game.status='running';game.state.control={id:crypto.randomUUID(),until:Date.now()+60000};game.state.drawn=[7,19,41];await store.create(game);
 const clientId=game.state.control.id,instanceId=crypto.randomUUID(),state={producer:{id:clientId,instanceId,generation:1,gameId:game.id,until:Date.now()+60000},generation:1,seq:1,publishedAt:Date.now(),snapshot:{gameId:game.id,drawn:[7,19,41],lastNumber:41,paused:false,speaking:true,caption:'Oude tekst'},show:{scene:'host',title:game.title,liveCall:true},voice:{id:'old-voice',clip:'a'.repeat(64),text:'Oude tekst',phase:'play'},routing:true,events:[{id:'old-resume',kind:'resume',at:Date.now()}],mixer:{voice:100,music:25,effects:50},output:{id:crypto.randomUUID(),until:Date.now()+7000,audioReady:true,generation:1,seq:1}};
 await db.prepare('INSERT INTO studio_outputs (owner_id,revision,document) VALUES (?,0,?)').bind('host',JSON.stringify(state)).run();
 const send=async body=>{const response=await handleOutput(new Request('https://studio.example/api/output',{method:body?'POST':'GET',headers:{Origin:'https://studio.example','Content-Type':'application/json','X-Vlampie-Output':'1'},...(body?{body:JSON.stringify({clientId,instanceId,generation:1,...body})}:{})}),{DB:db,AUTH_IDENTITY:{user:'host',admin:true}});return {status:response.status,...await response.json()};};
 const cancel=()=>store.mutate(game.id,{},g=>forceCancelGame(g,{by:'host',reason:'PRIVATE-AUDIT-REASON',requestId:'output-cancel-request',binding:'test'},Date.now()));
 const row=()=>db.prepare('SELECT document FROM studio_outputs WHERE owner_id = ?').bind('host').first();
 return {db,store,game,state,send,cancel,row};
}
function assertSilent(state){assert(state.cancelledAt);assert.equal(state.routing,false);assert.equal(state.voice,null);assert.deepEqual(state.events,[]);assert.equal(state.output,null);assert.equal(state.snapshot.paused,true);assert.equal(state.snapshot.speaking,false);assert.deepEqual(state.snapshot.drawn,[7,19,41]);assert.equal(state.snapshot.lastNumber,41);assert.equal(state.snapshot.caption,'Deze show is geannuleerd.');assert(!JSON.stringify(state).includes('PRIVATE-AUDIT-REASON'));}

test('fresh relay GET and heartbeat silence a cancelled game even when persistent relay cleanup has not run',async t=>{
 const h=await fixture(t),before=(await h.row()).document;await h.cancel();assertSilent((await h.send()).state);assert.equal((await h.row()).document,before,'read projection does not rewrite the stored relay');
 const heartbeat=await h.send({action:'output-heartbeat',audioReady:true,seq:1});assert.equal(heartbeat.status,200);assertSilent(heartbeat.state);assert.equal((await h.row()).document,before,'a stale output cannot recreate its audio lease');
 for(const action of ['publish','producer-claim']){const denied=await h.send({action,seq:99,expectedGeneration:1,snapshot:h.state.snapshot,voice:h.state.voice,routing:true});assert.equal(denied.status,409);assert.equal(denied.code,'show_cancelled');assertSilent(denied.state);}
});

for(const postgres of [false,true])test(`publication loses an atomic game CAS when cancellation commits before its transaction (${postgres?'PostgreSQL':'SQLite'})`,{skip:postgres&&!process.env.MILO_TEST_DATABASE_URL},async t=>{
 const h=await fixture(t,{postgres}),batch=h.db.batch.bind(h.db);let raced=false;
 h.db.batch=async statements=>{if(!raced&&statements.some(s=>s.sql.startsWith('UPDATE studio_outputs'))){raced=true;await h.cancel();}return batch(statements);};
 const response=await h.send({action:'publish',seq:2,snapshot:{...h.state.snapshot,caption:'Must never publish'},voice:h.state.voice,routing:true});assert(raced);assert.equal(response.status,409);assert.equal(response.code,'show_cancelled');assertSilent(response.state);assert.equal(JSON.parse((await h.row()).document).seq,1);
});

test('a publication that wins first is removed by cancellation without losing the last board',async t=>{
 const h=await fixture(t);assert.equal((await h.send({action:'publish',seq:2,snapshot:h.state.snapshot,show:h.state.show,voice:h.state.voice,routing:true})).status,200);await h.cancel();assert.deepEqual(await cancelGameOutput({DB:h.db},'host',h.game.id),{pending:false});assertSilent(JSON.parse((await h.row()).document));
});

test('cleanup of an older cancelled show leaves a newer show relay byte for byte intact',async t=>{
 const h=await fixture(t);await h.cancel();const other=makeGame({brandId:'vlampie',title:'Andere uitzending',date:'2027-12-06T19:00:00Z'},'host','https://studio.example');await h.store.create(other);
 const newer={...h.state,producer:{...h.state.producer,gameId:other.id},snapshot:{...h.state.snapshot,gameId:other.id}};await h.db.prepare('UPDATE studio_outputs SET document = ? WHERE owner_id = ?').bind(JSON.stringify(newer),'host').run();const before=(await h.row()).document;
 assert.deepEqual(await cancelGameOutput({DB:h.db},'host',h.game.id),{pending:false});assert.equal((await h.row()).document,before);
});

test('an existing output stops all audio and ignores delayed local packets after cancellation, without reconnecting or resuming',async()=>{
 const messages=[],audio=[],gameId=crypto.randomUUID(),state={cancelledAt:Date.now(),cancelledGameId:gameId,producer:{id:'regie',instanceId:'instance',gameId,generation:3,until:Date.now()+60000},seq:10,publishedAt:Date.now(),snapshot:{gameId,drawn:[7,19,41],lastNumber:41},show:{scene:'host',liveCall:true},voice:null,routing:false,events:[]};let callStops=0;
 const bridge=Object.assign(Object.create(OutputBridge.prototype),{isOutput:true,targetGameId:gameId,active:true,audioReady:true,latest:state,seen:new Set(),showAudio:{setMuted:v=>audio.push(['muted',v]),stop:()=>audio.push(['stop']),setLevels(){},resume:()=>assert.fail('Cancelled show resumed')},receive:message=>messages.push(message),onCallStop:()=>callStops++});
 bridge.consume(state);assert.equal(bridge.active,false);assert.equal(bridge.audioReady,false);assert(callStops);assert(audio.some(e=>e[0]==='stop'));assert.equal(messages.find(e=>e.kind==='snapshot').payload.lastNumber,41);const count=messages.length;
 bridge.consume({...state,cancelledAt:null,cancelledGameId:null,seq:999,producer:{...state.producer,generation:4},routing:true,voice:{id:'stale',phase:'play'},events:[{id:'stale-resume',kind:'resume',at:Date.now()}],snapshot:{...state.snapshot,paused:false,speaking:true}});assert.equal(messages.length,count);assert.equal(bridge.connected,false);assert.equal(bridge.voiceCurrent('stale','stale'),false);
 await assert.rejects(bridge.activate(),/geannuleerd/);await assert.rejects(bridge.playProgramTest(),/geannuleerd/);assert(!messages.some(e=>e.kind==='speech-start'));
});
