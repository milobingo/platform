import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {handleChat as verifiedhandleChat} from '../server/chat.js';
import {BingoStore} from '../server/bingo-store.js';
import {makeGame,generateBooks} from '../server/bingo-model.js';

const migrationDirectory=new URL('../drizzle/',import.meta.url);
const migrations=await Promise.all((await fs.readdir(migrationDirectory)).filter(name=>name.endsWith('.sql')).sort().map(name=>fs.readFile(new URL(name,migrationDirectory),'utf8')));
const accounts={
 family:[{id:'mila',name:'Mila',age:8},{id:'finn',name:'Finn',age:10}],
 friend:[{id:'noor',name:'Noor',age:12}],
 moderator:[{id:'jamie',name:'Jamie',age:36}],
 peer:[{id:'robin',name:'Robin',age:40}],
 outsider:[{id:'evi',name:'Evi',age:9}],
};

async function fixture(t){
 const db=new DatabaseSync(':memory:');for(const sql of migrations)db.exec(sql);
 let now=Date.parse('2026-10-07T12:00:00Z');t.mock.method(Date,'now',()=>now);t.after(()=>db.close());
 const execute=(sql,args,read)=>{const statement=db.prepare(sql);if(read||/^\s*SELECT\b|\bRETURNING\b/i.test(sql))return {success:true,results:statement.all(...args),meta:{changes:0}};const meta=statement.run(...args);return {success:true,results:[],meta:{changes:Number(meta.changes),last_row_id:Number(meta.lastInsertRowid)}};};
 const statement=(sql,args=[])=>({sql,args,bind:(...values)=>statement(sql,values),first:async(column)=>{const result=db.prepare(sql).get(...args)||null;return column&&result?result[column]:result;},all:async()=>execute(sql,args,false),run:async()=>execute(sql,args,false)});
 const env={VLAMPIE_ADMIN_EMAIL:'host@example.test',DB:{prepare:sql=>statement(sql),batch:async statements=>{db.exec('BEGIN');try{const result=statements.map(s=>execute(s.sql,s.args,false));db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}}};
 const store=new BingoStore(env.DB);
 for(const [accountId,profiles] of Object.entries(accounts))await store.editFamily(accountId,`${accountId}@example.test`,family=>{family.profiles=structuredClone(profiles);});
 const game=makeGame({title:'Vlampie chat',date:'2026-12-05T19:00',roundCount:4},'host','https://studio.example');generateBooks(game,6,'chat-test-books');
 const participants=Object.entries(accounts).filter(([id])=>id!=='outsider').flatMap(([accountId,profiles])=>profiles.map(profile=>({accountId,...profile})));
 participants.forEach((person,index)=>Object.assign(game.books[index],{accountId:person.accountId,profileId:person.id,name:person.name,age:person.age}));await store.create(game);
 const otherGame=makeGame({title:'Andere show',date:'2026-12-06T19:00',roundCount:4},'host','https://studio.example');generateBooks(otherGame,1,'chat-other-books');Object.assign(otherGame.books[0],{accountId:'outsider',profileId:'evi',name:'Evi',age:9});await store.create(otherGame);
 const base=`/api/bingo/games/${game.id}/chat`;
 const request=(route='',{method='GET',body,user='host',email=user==='host'?'host@example.test':`${user}@example.test`,headers={},signal}={})=>new Request(`https://studio.example${route.startsWith('/api/')?route:base+route}`,{method,headers:{Origin:'https://studio.example','Content-Type':'application/json','x-vlampie-bingo':'1','oai-authenticated-user-id':user,'oai-authenticated-user-email':email,...headers},...(body===undefined?{}:{body:JSON.stringify({requestId:crypto.randomUUID(),...body})}),...(signal?{signal}:{})});
 const call=async(route='',options={},status=200)=>{const response=await handleChat(request(route,options),env);assert(response instanceof Response,'chat route must return a response');const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;};
 const revision=()=>db.prepare('SELECT revision,document FROM bingo_games WHERE id = ?').get(game.id);
 return {db,env,store,game,otherGame,request,call,revision,advance:(ms=2100)=>now+=ms,now:()=>now};
}

const send=(h,user,text,extra={})=>h.call('',{method:'POST',user,body:{text,...(accounts[user]?{profileId:accounts[user][0].id}:{}),...extra}},201);
const write=(h,route,body={},user='host',status=200)=>h.call(route,{method:'POST',user,body},status);
async function members(h){const {members}=await h.call('/members');return Object.fromEntries(members.map(member=>[member.names?.includes('Mila')?'family':member.names?.includes('Noor')?'friend':member.names?.includes('Jamie')?'moderator':member.names?.includes('Robin')?'peer':member.role==='host'?'host':member.name,member]));}
const forbiddenFields=['email','age','accountId','token','cards','bookCode'];
function noPrivateFields(value){if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){assert(!forbiddenFields.includes(key),`private field leaked: ${key}`);noPrivateFields(child);}}
function monotonic(events){for(let i=1;i<events.length;i++)assert(events[i].seq>events[i-1].seq,'event sequence must strictly increase');}

test('chat identity comes from the authenticated account; profile switching retains strict ownership and privacy',async t=>{
 const h=await fixture(t);
 const initial=await h.call('',{user:'family'});assert.deepEqual(initial.self.profiles,[{id:'mila',name:'Mila'},{id:'finn',name:'Finn'}]);assert.equal(initial.self.role,'player');noPrivateFields(initial);
 const host=await send(h,'host','Welkom bij Vlampie! 🔥',{name:'Mila',role:'player',profileId:'mila'});assert.equal(host.message.role,'host');assert.notEqual(host.message.name,'Mila');
 const player=await send(h,'family','Hallo 👋 <b>iedereen</b>',{name:'HOST',role:'host'});assert.equal(player.message.name,'Mila');assert.equal(player.message.role,'player');assert.equal(player.message.profileId,'mila');assert.equal(player.message.text,'Hallo 👋 <b>iedereen</b>');
 h.advance();const switched=await send(h,'family','Finn speelt ook mee!',{profileId:'finn'});assert.equal(switched.message.name,'Finn');assert.equal(switched.message.memberId,player.message.memberId);
 h.advance();await write(h,'',{text:'Spoof',profileId:'noor'},'family',400);await write(h,'',{text:'Spoof',profileId:'does-not-exist'},'family',400);
 const snapshot=await h.call('',{user:'family'});assert.equal(snapshot.messages.length,3);noPrivateFields(snapshot);assert(!JSON.stringify(snapshot).includes('@example.test'));
 assert.deepEqual(snapshot.self.profiles,[{id:'mila',name:'Mila'},{id:'finn',name:'Finn'}]);
});

test('chat enforces sign-in, same-origin access, show membership and non-spoofable host ownership',async t=>{
 const h=await fixture(t);
 await h.call('',{user:''},401);await h.call('',{user:'outsider'},403);await h.call(`/api/bingo/games/${h.otherGame.id}/chat`,{user:'family'},403);
 await h.call('',{user:'someone-else',email:'host@example.test'},403);await h.call('/members',{user:'family'},403);
 await h.call('',{headers:{Origin:'https://evil.example'}},403);
 await h.call('',{headers:{'sec-fetch-site':'cross-site'}},403);
 const response=await handleChat(h.request('',{method:'POST',body:{text:'Not from app'},headers:{'x-vlampie-bingo':''}}),h.env);assert.equal(response.status,403);
 await h.call('',{method:'POST',body:{text:'Bad origin'},headers:{Origin:'https://evil.example'}},403);
 const other=await h.call(`/api/bingo/games/${h.otherGame.id}/chat`,{user:'outsider'});assert.equal(other.self.role,'player');
});

test('chat validates nonempty text, Unicode message limits and stable request identifiers',async t=>{
 const h=await fixture(t);
 for(const text of ['', '   ', '🔥'.repeat(501)])await write(h,'',{text,profileId:'mila'},'family',400);
 await write(h,'',{text:'Hallo',profileId:'mila',requestId:'bad'},'family',400);
 const boundary=await send(h,'family','🔥'.repeat(500));assert.equal([...boundary.message.text].length,500);
 await h.store.mutate(h.game.id,{},game=>{game.status='finished';});h.advance();await write(h,'',{text:'Show afgelopen',profileId:'mila'},'family',403);
});

test('idempotent sends do not duplicate messages and rate limits cover simultaneous tabs and profile switches',async t=>{
 const h=await fixture(t),requestId='same-message-request';
 const replies=await Promise.all(Array.from({length:5},()=>send(h,'family','Een keer graag',{requestId})));
 assert.equal(new Set(replies.map(reply=>reply.message.id)).size,1);assert.equal((await h.call('',{user:'family'})).messages.length,1);
 const replay=await send(h,'family','Andere inhoud mag niet vervangen',{requestId,profileId:'finn'});assert.equal(replay.message.text,'Een keer graag');assert.equal(replay.message.name,'Mila');
 await write(h,'',{text:'Te snel',profileId:'finn'},'family',429);
 const concurrent=await Promise.all(['finn','mila'].map(profileId=>handleChat(h.request('',{method:'POST',user:'family',body:{text:'Nog steeds te snel',profileId}}),h.env)));assert(concurrent.every(response=>response.status===429));
 const separate=await send(h,'friend','Andere account, dezelfde request ID',{requestId});assert.notEqual(separate.message.id,replies[0].message.id);
 h.advance();const next=await send(h,'family','Nu als Finn',{profileId:'finn'});assert.equal(next.message.name,'Finn');assert.equal((await h.call('')).messages.length,3);
 h.advance();const race=await Promise.all(['mila','finn'].map(profileId=>handleChat(h.request('',{method:'POST',user:'family',body:{text:'Tab-race',profileId}}),h.env)));assert.deepEqual(race.map(response=>response.status).sort(),[201,429]);
});

test('host manages moderators; moderators can only delete or mute players and mutes cover the full account',async t=>{
 const h=await fixture(t),roster=await members(h),familyId=roster.family.memberId,modId=roster.moderator.memberId,peerId=roster.peer.memberId;
 const player=await send(h,'family','Bericht ter controle'),host=await send(h,'host','Hostbericht');
 await write(h,`/members/${modId}/role`,{role:'moderator'},'family',403);
 await write(h,`/members/${familyId}/mute`,{seconds:60},'friend',403);
 await write(h,`/messages/${player.message.id}/delete`,{},'friend',403);
 await write(h,`/members/${modId}/role`,{role:'moderator',requestId:'promote-moderator'});
 await write(h,`/members/${modId}/role`,{role:'moderator',requestId:'promote-moderator'});
 await write(h,`/members/${peerId}/role`,{role:'moderator'});
 assert.equal((await h.call('',{user:'moderator'})).self.role,'moderator');
 const peer=await send(h,'peer','Medemoderator');
 await write(h,`/members/${familyId}/role`,{role:'moderator'},'moderator',403);
 await write(h,`/members/${peerId}/mute`,{seconds:60},'moderator',403);
 await write(h,`/messages/${peer.message.id}/delete`,{},'moderator',403);
 await write(h,`/messages/${host.message.id}/delete`,{},'moderator',403);
 await write(h,`/members/${host.message.memberId}/mute`,{seconds:60},'moderator',403);
 await write(h,`/messages/${player.message.id}/delete`,{requestId:'moderator-delete-once'},'moderator');
 await write(h,`/members/${familyId}/mute`,{seconds:60,requestId:'moderator-mute-once'},'moderator');
 const muted=await h.call('',{user:'family'});assert.equal(muted.self.canSend,false);assert(muted.self.mutedUntil>=h.now()+59000);
 h.advance();await write(h,'',{text:'Mila nog steeds stil',profileId:'mila'},'family',403);await write(h,'',{text:'Finn ook stil',profileId:'finn'},'family',403);
 await write(h,`/members/${familyId}/mute`,{seconds:0},'moderator');await send(h,'family','We mogen weer praten',{profileId:'finn'});
 await write(h,`/members/${modId}/role`,{role:'player'});assert.equal((await h.call('',{user:'moderator'})).self.role,'player');
 await write(h,`/members/${familyId}/mute`,{seconds:60},'moderator',403);
 noPrivateFields(await h.call('/members'));
});

test('transaction guards prevent sending after a concurrent mute and moderating after concurrent role changes',async t=>{
 const h=await fixture(t),roster=await members(h),familyId=roster.family.memberId,friendId=roster.friend.memberId,modId=roster.moderator.memberId;
 const beforeNextCommit=operation=>{const batch=h.env.DB.batch;h.env.DB.batch=async statements=>{h.env.DB.batch=batch;await operation();return batch(statements);};};
 beforeNextCommit(()=>write(h,`/members/${familyId}/mute`,{seconds:60}));await write(h,'',{text:'Mag niet tussen de mute door',profileId:'mila'},'family',403);
 assert.equal((await h.call('')).messages.length,0);await write(h,`/members/${familyId}/mute`,{seconds:0});
 const friend=await send(h,'friend','Doelwit wordt moderator'),family=await send(h,'family','Moderator verliest rechten');await write(h,`/members/${modId}/role`,{role:'moderator'});
 beforeNextCommit(()=>write(h,`/members/${friendId}/role`,{role:'moderator'}));await write(h,`/messages/${friend.message.id}/delete`,{},'moderator',403);
 beforeNextCommit(()=>write(h,`/members/${modId}/role`,{role:'player'}));await write(h,`/messages/${family.message.id}/delete`,{},'moderator',403);
 const messages=(await h.call('')).messages;assert(messages.every(message=>!message.deleted));assert.equal(messages.length,2);
});

test('host and moderators can remove their own posts and clean up finished-show chat while players cannot',async t=>{
 const h=await fixture(t),roster=await members(h),modId=roster.moderator.memberId;
 await write(h,`/members/${modId}/role`,{role:'moderator'});
 const host=await send(h,'host','Eigen hostbericht'),moderator=await send(h,'moderator','Eigen moderatorbericht'),player=await send(h,'family','Spelerbericht');
 await write(h,`/messages/${player.message.id}/delete`,{},'family',403);
 await write(h,`/messages/${host.message.id}/delete`,{},'host');await write(h,`/messages/${moderator.message.id}/delete`,{},'moderator');
 await write(h,`/members/${modId}/mute`,{seconds:60},'moderator',403);await write(h,`/members/${modId}/role`,{role:'player'},'moderator',403);
 h.advance();const laterHost=await send(h,'host','Host na afloop opruimen'),laterModerator=await send(h,'moderator','Moderator na afloop opruimen');
 await h.store.mutate(h.game.id,{},game=>{game.status='finished';});h.advance();
 await write(h,`/messages/${laterHost.message.id}/delete`,{},'host');await write(h,`/messages/${laterModerator.message.id}/delete`,{},'moderator');await write(h,`/messages/${player.message.id}/delete`,{},'moderator');
 await write(h,'',{text:'Niet meer uitzenden'},'host',403);await write(h,'',{text:'Niet meer meedoen',profileId:'jamie'},'moderator',403);
 await write(h,`/members/${roster.family.memberId}/mute`,{seconds:60},'moderator',403);await write(h,`/members/${roster.family.memberId}/mute`,{seconds:60},'host');
 await write(h,`/members/${modId}/role`,{role:'player'},'host');assert.equal((await h.call('',{user:'moderator'})).self.role,'player');
 assert((await h.call('')).messages.every(message=>message.deleted&&message.text===''));
});

test('deleted messages disappear from snapshots and historic event replay without exposing the original body',async t=>{
 const h=await fixture(t),secret='DIT-VERWIJDERDE-BERICHT-MAG-NIET-TERUG';
 const sent=await send(h,'family',secret),before=(await h.call('')).cursor;
 await write(h,`/messages/${sent.message.id}/delete`,{requestId:'delete-fixed-message'});
 const after=await h.call('');const removed=after.messages.find(message=>message.id===sent.message.id);if(removed){assert.equal(removed.deleted,true);assert.equal(removed.text,'');}assert(!JSON.stringify(after).includes(secret));
 const replay=await h.call('?after=0');assert(!JSON.stringify(replay).includes(secret));assert(replay.events.some(event=>event.type==='delete'&&event.messageId===sent.message.id));monotonic(replay.events);
 const delta=await h.call('?after='+before);assert(delta.events.some(event=>event.type==='delete'));assert(delta.cursor>before);
 const cursor=after.cursor;await write(h,`/messages/${sent.message.id}/delete`,{requestId:'delete-fixed-message'});assert.equal((await h.call('')).cursor,cursor);
});

test('simultaneous accounts produce ordered events and cursor replay catches every event across pages',async t=>{
 const h=await fixture(t),before=(await h.call('')).cursor;
 const replies=await Promise.all(['host','family','friend','moderator','peer'].map((user,index)=>send(h,user,`Gelijktijdig ${index}`)));
 assert.equal(new Set(replies.map(reply=>reply.message.id)).size,5);
 const delta=await h.call('?after='+before);monotonic(delta.events);assert.equal(new Set(delta.events.filter(event=>event.type==='message').map(event=>event.message.id)).size,5);
 const cursor=delta.cursor;
 for(let index=0;index<125;index++){h.advance();await send(h,'host',`Bericht ${index}`);}
 const expected=(await h.call('')).cursor,seen=[];let next=cursor;
 for(let page=0;page<10;page++){const result=await h.call('?after='+next);assert(result.cursor>=next);seen.push(...result.events);next=result.cursor;if(!result.hasMore)break;assert(page<9,'replay pagination failed to terminate');}
 monotonic(seen);assert.equal(seen.filter(event=>event.type==='message').length,125);assert.equal(next,expected);
 h.advance();const added=await send(h,'host','Na herverbinden');const catchup=await h.call('?after='+next);assert(catchup.events.some(event=>event.message?.id===added.message.id));monotonic(catchup.events);
});

test('100 simultaneous player accounts each receive one durable acknowledgement with no lost cursor events',async t=>{
 const h=await fixture(t),players=Array.from({length:100},(_,index)=>({accountId:`crowd-${index}`,profileId:`crowd-person-${index}`,name:`Speler ${index}`}));
 await Promise.all(players.map(player=>h.store.editFamily(player.accountId,`${player.accountId}@example.test`,family=>{family.profiles=[{id:player.profileId,name:player.name,age:18}];})));
 await h.store.mutate(h.game.id,{},game=>{const offset=game.books.length;generateBooks(game,100,'hundred-chat-participants');players.forEach((player,index)=>Object.assign(game.books[offset+index],{accountId:player.accountId,profileId:player.profileId,name:player.name,age:18}));});
 const before=(await h.call('')).cursor,revision=h.revision();
 const replies=await Promise.all(players.map(async(player,index)=>{const response=await handleChat(h.request('',{method:'POST',user:player.accountId,body:{profileId:player.profileId,text:`Deelnemer ${index} meldt zich`,requestId:`crowd-message-${index}`}}),h.env);return {status:response.status,data:await response.json()};}));
 const failures=replies.filter(reply=>reply.status!==201),statuses=Object.fromEntries([...new Set(replies.map(reply=>reply.status))].map(status=>[status,replies.filter(reply=>reply.status===status).length]));assert.equal(failures.length,0,`100-account send statuses: ${JSON.stringify(statuses)}; sample errors: ${JSON.stringify(failures.slice(0,2))}`);
 assert.equal(new Set(replies.map(reply=>reply.data.message.id)).size,100);assert.deepEqual(h.revision(),revision);
 const events=[];let cursor=before;for(let page=0;page<10;page++){const update=await h.call('?after='+cursor);events.push(...update.events);cursor=update.cursor;if(!update.hasMore)break;assert(page<9,'100-account cursor replay failed to finish');}
 monotonic(events);const delivered=events.filter(event=>event.type==='message').map(event=>event.message.id);assert.equal(delivered.length,100);assert.deepEqual(new Set(delivered),new Set(replies.map(reply=>reply.data.message.id)));
});

test('chat persists independently of bingo documents and checks revoked membership on every read',async t=>{
 const h=await fixture(t),before=h.revision(),familyBefore=await h.store.family('family');
 const sent=await send(h,'family','Bewaar dit gesprek'),roster=await members(h);
 await write(h,`/members/${roster.friend.memberId}/role`,{role:'moderator'});
 await h.call('?after=0');assert.deepEqual(h.revision(),before);assert.deepEqual(await h.store.family('family'),familyBefore);
 const {handleChat:restarted}=await import(`../server/chat.js?restart=${crypto.randomUUID()}`);
 const restoredRequest=h.request('',{user:'family'});const restored=await restarted(restoredRequest,verifiedTestEnvironment(restoredRequest,h.env));assert.equal(restored.status,200);assert((await restored.json()).messages.some(message=>message.id===sent.message.id));
 await h.store.mutate(h.game.id,{},game=>{for(const book of game.books)if(book.accountId==='family')book.admitted=false;});
 await h.call('',{user:'family'},403);await h.call('?after=0',{user:'family'},403);h.advance();await write(h,'',{text:'Geen toegang meer',profileId:'mila'},'family',403);
});

test('SSE delivers an initial chat update and cancellation closes without waiting for heartbeat',async t=>{
 const h=await fixture(t);await send(h,'host','Realtime verbonden');
 const controller=new AbortController(),response=await handleChat(h.request('/stream?after=0',{user:'family',signal:controller.signal}),h.env);
 assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/text\/event-stream/);assert.match(response.headers.get('Cache-Control'),/no-store/);
 const reader=response.body.getReader();let timeout;try{const text=await Promise.race([(async()=>{let buffer='';while(!buffer.includes('data:')){const chunk=await reader.read();assert.equal(chunk.done,false);buffer+=new TextDecoder().decode(chunk.value);}return buffer;})(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('SSE initial update did not arrive')),2000);})]);assert.match(text,/data:/);assert(text.includes('Realtime verbonden')||text.includes('events')||text.includes('messages'),'initial SSE chunk must contain chat state');}finally{clearTimeout(timeout);controller.abort();await reader.cancel();}
});

function handleChat(request,env,...args){return verifiedhandleChat(request,verifiedTestEnvironment(request,env),...args);}
