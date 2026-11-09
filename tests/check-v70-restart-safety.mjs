import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStorageEnvironment} from '../server/node-storage.js';
import {BingoStore} from '../server/bingo-store.js';
import {makeGame,generateBooks,activateBlock,activeGoal,beginBingo,claimBook,settleWindow,familyDefault} from '../server/bingo-model.js';
import {handleBingo} from '../server/bingo.js';
import {MailStore} from '../server/mail-store.js';

for(const accepted of [true,false])test(`restart with retained v70 data preserves the saved prize and ${accepted?'accepted':'uncertain'} mail without replay`,async t=>{
 const directory=await mkdtemp(join(tmpdir(),'milo-v70-restart-')),config={SQLITE_PATH:join(directory,'app.sqlite'),OBJECT_STORAGE_PATH:join(directory,'objects')};
 let storage=await createStorageEnvironment(config),offers=0;t.after(async()=>{await storage?.close();await rm(directory,{recursive:true,force:true});});
 const adapter={id:'offline-test',send:async()=>{offers++;return accepted?{accepted:true,messageId:'fixture-acceptance'}:{accepted:false,uncertain:true};}};
 const environment=()=>({...storage,VLAMPIE_SETTINGS_KEY:'32'.repeat(32),MAIL_FROM:'studio@example.test',MAIL_ORGANIZATION_EMAIL:'studio@example.test',ORDER_MAIL_DELIVERY:adapter,AUTH_IDENTITY:{user:'host',email:'organizer@example.test',admin:true}});
 const game=makeGame({brandId:'milo',date:'2027-11-18T13:30',timeZone:'Europe/Amsterdam',roundCount:1},'host','https://studio.example');generateBooks(game,2,'restart-fixture');game.books.forEach((book,i)=>Object.assign(book,{accountId:'parent',profileId:'child-'+i,name:'Fixture '+i}));game.status='running';const block=game.plan.blocks.findIndex(entry=>entry.type==='round');activateBlock(game,block);activeGoal(game).pattern.cells=[0];game.books[0].cards[0][0]=1;game.state.drawn=[1];const family=familyDefault('parent@example.test');family.profiles=[{id:'adult',name:'Volwassen accountbeheerder',dateOfBirth:'1990-01-01'}];
 beginBingo(game,family,'parent','fixture-announcement',Date.now()-40000);claimBook(game,family,'parent',game.books[0].id,game.state.window.startedAt+1);const result=settleWindow(game,Date.now());assert(result?.winner);
 let store=new BingoStore(storage.DB);await store.create(game);await store.editFamily('parent','parent@example.test',f=>Object.assign(f,family));
 const official={books:structuredClone(game.books),drawn:[...game.state.drawn],winner:structuredClone(result.winner),resultId:result.id};
 const call=async(action,body,requestId)=>{const response=await handleBingo(new Request(`https://studio.example/api/bingo/games/${game.id}/${action}`,{method:'POST',headers:{Origin:'https://studio.example','X-Vlampie-Bingo':'1','Content-Type':'application/json'},body:JSON.stringify({regieId:'restart-regie',requestId,...body})}),environment());return {status:response.status,data:await response.json()};};
 assert.equal((await call('finish-result',{resultId:result.id},'publish-once-001')).status,200);assert.equal(offers,1);const before=(await new MailStore(storage.DB).list('delivery','milo'))[0];assert.equal(before.status,accepted?'accepted':'uncertain');assert.equal(before.uncertain,!accepted);
 await storage.close();storage=null;storage=await createStorageEnvironment(config);store=new BingoStore(storage.DB);
 for(const requestId of ['publish-once-001','publish-new-request-002'])assert.equal((await call('finish-result',{resultId:result.id},requestId)).status,200);
 const saved=(await store.game(game.id)).data;assert.equal(offers,1);assert.equal(saved.results.length,1);assert.equal(saved.results[0].id,official.resultId);assert.deepEqual(saved.results[0].winner,official.winner);assert.deepEqual(saved.books,official.books);assert.deepEqual(saved.state.drawn,official.drawn);
 const denied=await call('activate',{blockIndex:block,goalIndex:0},'do-not-reroll-003');assert.equal(denied.status,409);
 const records=await new MailStore(storage.DB).list('delivery','milo');assert.equal(records.length,1);assert.equal(records[0].id,before.id);assert.equal(records[0].attempts,1);assert.equal(records[0].uncertain,!accepted);
});
