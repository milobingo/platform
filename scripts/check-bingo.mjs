import {gameRequestFixture} from './game-request-fixture.mjs';
import {verifiedTestEnvironment} from './verified-test-identity.mjs';
import {importLegacyFixture} from './legacy-fixture-bundle.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {PDFDocument} from 'pdf-lib';
import {bookPdf,PRINT_VERSION} from '../server/bingo-pdf.js';
import {handleBingo as verifiedhandleBingo} from '../server/bingo.js';
import {BingoStore} from '../server/bingo-store.js';
import {makeGame,generateBooks,cardSignature,activateBlock,beginBingo,claimBook,settleWindow,completionIndex,familyDefault,activeGoal,checkAccount,reserveBall,commitBall,MINIGAMES,minigamesForBrand} from '../server/bingo-model.js';
import {ShowDirector} from '../public/show-director.js';
import {ShowRunner} from '../public/show-runner.js';
const migrations=await Promise.all((await fs.readdir(new URL('../drizzle/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort().map(x=>fs.readFile(new URL('../drizzle/'+x,import.meta.url),'utf8')));
export function setup(){
 const db=new DatabaseSync(':memory:');migrations.forEach(s=>db.exec(s));const files=new Map();
 const statement=(sql,args=[])=>({sql,args,bind:(...values)=>statement(sql,values),first:async()=>db.prepare(sql).get(...args)||null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({results:[],meta:db.prepare(sql).run(...args)})});
 const env={VLAMPIE_ADMIN_EMAIL:'host@example.test',DB:{prepare:sql=>statement(sql),batch:async statements=>{db.exec('BEGIN');try{const rows=[];for(const s of statements){const q=db.prepare(s.sql);if(/RETURNING|^SELECT/i.test(s.sql))rows.push({results:q.all(...s.args)});else{q.run(...s.args);rows.push({results:[]});}}db.exec('COMMIT');return rows;}catch(e){db.exec('ROLLBACK');throw e;}}},SETTINGS:{get:async k=>files.has(k)?{body:files.get(k)}:null,put:async(k,v)=>files.set(k,v)}};
 // Real SQLite statements execute serially, just as a D1 batch does; writes with no RETURNING use run.
 const originalPrepare=env.DB.prepare;env.DB.prepare=sql=>{const s=originalPrepare(sql);const bind=s.bind;s.bind=(...args)=>{const b=bind(...args);if(!/RETURNING|^SELECT/i.test(sql))b.all=async()=>{await b.run();return {results:[]};};return b;};return s;};
 const store=new BingoStore(env.DB);
 const req=(route,{method='GET',body,user='host',email=user==='host'?'host@example.test':user+'@example.test',headers={}}={})=>new Request('https://studio.example/api/bingo'+route,{method,headers:{Origin:'https://studio.example','x-vlampie-bingo':'1','Content-Type':'application/json','oai-authenticated-user-id':user,'oai-authenticated-user-email':email,...headers},...(body===undefined?{}:{body:JSON.stringify({regieId:'regie-main',requestId:crypto.randomUUID(),...body})})});
 const call=async(route,options={},status=200)=>{const response=await handleBingo(req(route,options),env);const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;};
 return {db,env,store,req,call,files};
}
const create=h=>h.call('/games',{method:'POST',body:{title:'Pakjesavond',timeZone:'Europe/Amsterdam',date:'2026-12-05T19:00',roundCount:4}},201);
async function linked(h,count=3){const {game}=await create(h);const generated=await h.call(`/games/${game.id}/generate`,{method:'POST',body:{count}},201);const {result:person}=await h.call('/profiles',{method:'POST',user:'family',body:{name:'Mila',age:8}},201);for(const b of generated.game.books)await h.call(`/games/${game.id}/register`,{method:'POST',user:'family',body:{profileId:person.id,code:b.code}});await h.call(`/games/${game.id}/start`,{method:'POST',body:{}});const index=game.plan.blocks.findIndex(b=>b.type==='round');await h.call(`/games/${game.id}/activate`,{method:'POST',body:{blockIndex:index}});return (await h.store.game(game.id)).data;}
test('simultaneous creation retries make one show and retain legacy retry identity',async()=>{
 const h=setup(),requestId='create-show-retry',body={title:'Eén kinderbingo',timeZone:'Europe/Amsterdam',date:'2026-12-05T19:00',roundCount:4,requestId};
 // Hold all initial reads until every caller has observed an empty catalogue,
 // reproducing the race that a check-then-insert alone cannot prevent.
 const originalGames=BingoStore.prototype.games;let reads=0,release;
 const ready=new Promise(resolve=>release=resolve);
 BingoStore.prototype.games=async function(){const rows=await originalGames.call(this);if(++reads===8)release();await ready;return rows;};
 let responses;
 try{responses=await Promise.all(Array.from({length:8},()=>handleBingo(h.req('/games',{method:'POST',body}),h.env)));}
 finally{BingoStore.prototype.games=originalGames;}
 const data=await Promise.all(responses.map(response=>response.json()));
 assert.equal(responses.filter(r=>r.status===201).length,1);
 assert(responses.every(r=>[200,201].includes(r.status)));
 assert.equal(new Set(data.map(d=>d.game.id)).size,1);
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM bingo_games').get().n,1);
 assert(data.every(d=>!('deck' in d.game.state)));
 const retry=await h.call('/games',{method:'POST',body:{...body,title:'A changed retry must not overwrite the show'}});
 assert.equal(retry.game.title,'Eén kinderbingo');
 const other=await h.call('/games',{method:'POST',body:{...body,requestId:'different-create-request'}},201);
 assert.notEqual(other.game.id,retry.game.id);
 const secondHost=await handleBingo(h.req('/games',{method:'POST',body,user:'second-host',email:'second@example.test'}),{...h.env,VLAMPIE_ADMIN_EMAIL:'second@example.test'});
 assert.equal(secondHost.status,201);assert.notEqual((await secondHost.json()).game.id,retry.game.id);
 const legacy=makeGame(body,'host','https://studio.example');legacy.createRequestId='legacy-create-retry';await h.store.create(legacy);
 const legacyRetry=await h.call('/games',{method:'POST',body:{...body,requestId:legacy.createRequestId}});
 assert.equal(legacyRetry.game.id,legacy.id);
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM bingo_games').get().n,4);
 h.db.close();
});
test('50 A5 books have 200 unique cards, persistent reprints, unique codes and show-specific activation',async()=>{
 const h=setup(),{game}=await create(h),route=`/games/${game.id}`;
 const generated=await h.call(route+'/generate',{method:'POST',body:{count:50,requestId:'batch-request-50'}},201);assert.equal(generated.game.books.length,50);assert.equal(new Set(generated.game.books.flatMap(b=>b.cards.map(cardSignature))).size,200);assert.equal(new Set(generated.game.books.map(b=>b.ticket)).size,50);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM bingo_codes').get().n,50);
 for(const b of generated.game.books)for(const card of b.cards){assert.equal(card[12],0);assert.equal(new Set(card.filter(Boolean)).size,24);card.forEach((n,i)=>{if(n)assert(n>=i%5*15+1&&n<=i%5*15+15);});}
 const again=await h.call(route+'/generate',{method:'POST',body:{count:50,requestId:'batch-request-50'}},201);assert.deepEqual(again.game.books,generated.game.books);
 const pdf=await handleBingo(h.req(generated.pdf.replace('/api/bingo','')),h.env);assert.equal(pdf.status,200);const bytes=new Uint8Array(await pdf.arrayBuffer());const doc=await PDFDocument.load(bytes);assert.equal(doc.getPageCount(),50);assert(doc.getPages().every(p=>Math.abs(p.getWidth()-148*72/25.4)<.01&&Math.abs(p.getHeight()-210*72/25.4)<.01));await fs.writeFile(path.join(tmpdir(),`milo-bingo-test-50-${process.pid}.pdf`),bytes);
 const reprint=await handleBingo(h.req(generated.pdf.replace('/api/bingo','')),h.env);assert.deepEqual(new Uint8Array(await reprint.arrayBuffer()),bytes);
 const more=await h.call(route+'/generate',{method:'POST',body:{count:2}},201);assert.equal(new Set(more.game.books.flatMap(b=>b.cards.map(cardSignature))).size,208);const large=await h.call(route+'/generate',{method:'POST',body:{count:150}},201);assert.equal(large.game.books.length,202);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM bingo_codes').get().n,202);
 const profile=(await h.call('/profiles',{method:'POST',user:'family',body:{name:'Mila',age:8}},201)).result;
 const newer=(await create(h)).game;await h.call(`/games/${newer.id}/register`,{method:'POST',user:'family',body:{profileId:profile.id,code:generated.game.books[0].code}},400);await h.call(`/games/${newer.id}/register`,{method:'POST',user:'family',body:{profileId:profile.id,token:generated.game.books[0].token}},400);
 await h.call(route+'/register',{method:'POST',user:'family',body:{profileId:profile.id,token:generated.game.books[0].token}});
 await h.call('/profiles',{method:'POST',user:'thief',body:{name:'Daan',age:9}},201);const thief=(await h.store.family('thief')).data.profiles[0];await h.call(route+'/register',{method:'POST',user:'thief',body:{profileId:thief.id,code:generated.game.books[0].code}},409);
 await h.call(route+'/books/'+generated.game.books[0].id+'/pdf',{user:'thief'},403);await h.call('/profiles',{method:'POST',user:'family',body:{name:'Fout',age:-1}},400);h.db.close();
});
test('A5 appearance is persisted, reprints are isolated and legacy books remain printable',async()=>{
 const h=setup(),{game}=await create(h),route=`/games/${game.id}`;
 await h.call(route+'/generate',{method:'POST',body:{count:1,printMode:'invalid'}},400);
 const generated=await h.call(route+'/generate',{method:'POST',body:{count:1,printMode:'mono',requestId:'a5-idempotent'}},201),batch=generated.batch,pdfRoute=generated.pdf.replace('/api/bingo','');
 assert.deepEqual(batch.print,{format:'A5',mode:'mono',template:PRINT_VERSION});
 const repeated=await h.call(route+'/generate',{method:'POST',body:{count:1,printMode:'color',requestId:'a5-idempotent'}},201);assert.deepEqual(repeated.batch,batch);assert.equal(repeated.game.books.length,1);
 const oldKey=`bingo-pdfs/${game.id}/${batch.id}`;h.files.set(oldKey,new TextEncoder().encode('OLD A4'));
 const before=(await h.store.game(game.id)).data;
 const download=async suffix=>{const response=await handleBingo(h.req(pdfRoute+suffix),h.env);assert.equal(response.status,200);assert.match(response.headers.get('Content-Disposition'),/A5/);return new Uint8Array(await response.arrayBuffer());};
 const mono=await download(''),color=await download('?mode=color');assert.notDeepEqual(color,mono);assert.deepEqual(await download('?mode=mono'),mono);assert.deepEqual(await download('?mode=color'),color);
 assert.equal(h.files.size,3);assert([...h.files.keys()].some(k=>k.includes('/A5/color/')));assert([...h.files.keys()].some(k=>k.includes('/A5/mono/')));assert.deepEqual((await h.store.game(game.id)).data,before);
 await h.call(pdfRoute+'?mode=invalid',{},400);await h.call(pdfRoute+'?mode=color',{user:'stranger'},403);
 const individual=`${route}/books/${before.books[0].id}/pdf`,one=await handleBingo(h.req(individual),h.env);assert.match(one.headers.get('Content-Disposition'),/zwart-wit/);await h.call(individual+'?mode=mono',{user:'stranger'},403);
 await h.store.mutate(game.id,{},g=>{delete g.batches[0].print;});assert.deepEqual(await download(''),mono);
 for(const roundCount of [1,8]){const g=makeGame({timeZone:'Europe/Amsterdam',date:'2026-12-05T19:00',roundCount},'host','https://studio.example');generateBooks(g,1,'compatibility');const doc=await PDFDocument.load(await bookPdf(g,[g.books[0].id],{mode:'mono'}));assert.equal(doc.getPageCount(),Math.ceil(roundCount/4));}
 h.db.close();
});
test('JA freezes before book selection, one fixed window permits multiple books and preserves a reserved ball after false bingo',async()=>{
 const h=setup(),g=await linked(h),route=`/games/${g.id}`,pending=(await h.call(route+'/reserve',{method:'POST',body:{}})).pending;
 await h.call(route+'/begin',{method:'POST',user:'family',body:{epoch:'stale'}},409);
 const first=await h.call(route+'/begin',{method:'POST',user:'family',body:{epoch:g.state.epoch}});assert.equal(first.game.state.phase,'window');assert.equal(first.game.state.window.claims.length,0);assert(first.game.state.window.endsAt-first.game.state.window.startedAt>=30000);
 const next=await h.call(route+'/begin',{method:'POST',user:'family',body:{epoch:g.state.epoch}});assert.equal(next.game.state.window.endsAt,first.game.state.window.endsAt);await h.call(route+'/commit',{method:'POST',body:{token:pending.token}},409);
 const claim=await h.call(route+'/claim',{method:'POST',user:'family',body:{windowId:first.game.state.window.id,bookId:g.books[0].id}});assert.equal(claim.claim.status,'false');assert.equal(claim.family.falseCounts[g.id],1);
 await h.call(route+'/claim',{method:'POST',user:'family',body:{windowId:'old-window',bookId:g.books[1].id}},409);
 const dup=await h.call(route+'/claim',{method:'POST',user:'family',body:{windowId:first.game.state.window.id,bookId:g.books[0].id}});assert.equal(dup.family.falseCounts[g.id],1);
 await h.store.mutate(g.id,{},state=>settleWindow(state,first.game.state.window.endsAt));const held=(await h.call(route+'/reserve',{method:'POST',body:{}})).pending;assert.deepEqual(held,pending);
 const commit=await h.call(route+'/commit',{method:'POST',body:{token:held.token}});assert.equal(commit.game.state.drawn.length,1);const repeat=await h.call(route+'/commit',{method:'POST',body:{token:held.token}});assert.equal(repeat.game.state.drawn.length,1);h.db.close();
});
test('retroactive priority, tied games and result reveal are canonical and cannot reroll',async()=>{
 const h=setup(),g=await linked(h),route=`/games/${g.id}`;
 await h.store.mutate(g.id,{},state=>{state.settings.retroBalls=5;state.settings.minigames=['horses'];activeGoal(state).pattern.cells=[0];activeGoal(state).pattern.variant='fixed';state.books[1].cards[0][0]=state.books[0].cards[0][0];state.books[2].cards[0][0]=state.books[0].cards[0][0]%15+1;state.state.drawn=[state.books[0].cards[0][0],state.books[2].cards[0][0]].filter((n,i,a)=>a.indexOf(n)===i);});
 const first=await h.call(route+'/begin',{method:'POST',user:'family',body:{epoch:g.state.epoch}});
 for(const b of g.books)await h.call(route+'/claim',{method:'POST',user:'family',body:{windowId:first.game.state.window.id,bookId:b.id}});
 const saved=await h.store.mutate(g.id,{},state=>settleWindow(state,first.game.state.window.endsAt));const result=saved.game.results[0];assert.equal(result.completeAt,1);assert.equal(result.entrants.length,2);assert.equal(result.minigame,'horses');assert(result.entrants.some(e=>e.bookId===result.winner.bookId));
 const player=await h.call(route+'?player=1',{user:'family'});assert.equal(player.game.results.length,0);assert(!('deck' in player.game.state));assert(!('pending' in player.game.state));assert(!player.game.books.some(b=>'token' in b));
 assert.deepEqual((await h.call(route)).game.results[0],result);assert.deepEqual((await h.call(route)).game.results[0],result);
 const finish=await h.call(route+'/finish-result',{method:'POST',body:{resultId:result.id}});assert.equal(finish.applied,true);assert.equal((await h.call(route+'/finish-result',{method:'POST',body:{resultId:result.id}})).applied,false);assert.equal((await h.call(route+'?player=1',{user:'family'})).game.results.length,1);h.db.close();
});
test('false-bingo sanctions apply to all persons in one account for this show and host can unblock',async()=>{
 const h=setup(),g=await linked(h),route=`/games/${g.id}`;await h.store.mutate(g.id,{},state=>{state.settings.falseLimit=2;state.settings.cooldownSeconds=0;});const announced=await h.call(route+'/begin',{method:'POST',user:'family',body:{epoch:g.state.epoch}});
 for(let i=0;i<2;i++)await h.call(route+'/claim',{method:'POST',user:'family',body:{windowId:announced.game.state.window.id,bookId:g.books[i].id}});const f=(await h.store.family('family')).data;assert.equal(f.blockedGames[g.id],true);assert.equal(f.falseCounts[g.id],2);assert.doesNotThrow(()=>checkAccount(f,{id:'next-show'}));await h.call(route+'/claim',{method:'POST',user:'family',body:{windowId:announced.game.state.window.id,bookId:g.books[2].id}},403);const unblocked=await h.call(route+'/unblock',{method:'POST',body:{accountId:'family',reset:true}});assert.equal(unblocked.family.blockedGames[g.id],undefined);assert.equal(unblocked.family.falseCounts[g.id],0);h.db.close();
});
test('CAS batches do not save a family penalty without its claim, even for colliding request IDs',async()=>{
 const h=setup(),g=makeGame({timeZone:'Europe/Amsterdam',date:'2026-12-05T19:00'},'host','https://studio.example');await h.store.create(g);await Promise.all(['a','b'].map(id=>h.store.family(id)));
 await Promise.all(['a','b'].map(accountId=>h.store.mutate(g.id,{accountId,requestId:'same-client-id'},(state,f)=>{state.events.push({accountId});f.falseCounts[g.id]=(f.falseCounts[g.id]||0)+1;})));
 const stored=(await h.store.game(g.id)).data,families=await h.store.families();assert.equal(families.reduce((n,f)=>n+(f.data.falseCounts[g.id]||0),0),stored.events.length);assert.equal(stored.events.length,1);
 await Promise.all(['a','b'].map(accountId=>h.store.mutate(g.id,{accountId,requestId:accountId+':claim:same-id'},(state,f)=>{state.events.push({accountId});f.falseCounts[g.id]=(f.falseCounts[g.id]||0)+1;})));assert.equal((await h.store.game(g.id)).data.events.length,3);h.db.close();
});
test('host lease, origin and identity prevent unauthorized writes and concurrent controllers',async()=>{
 const h=setup(),g=await linked(h),route=`/games/${g.id}`;await h.call(route+'/reserve',{method:'POST',user:'family',body:{}},403);await h.call(route+'/reserve',{method:'POST',body:{regieId:'regie-second'}},409);await h.call(route+'/heartbeat',{method:'POST',body:{regieId:'regie-second'}},409);await h.call(route+'/pause',{method:'POST',body:{paused:true},headers:{Origin:'https://other.example'}},403);await h.call('/me',{user:''},401);h.db.close();
});
test('late complete bingo has no false penalty and two-row patterns require two full rows',()=>{
 const card=Array.from({length:25},(_,i)=>i+1);card[12]=0;const p={variant:'doubleRows',cells:[0,1,2,3,4],freeCenter:true};assert.equal(completionIndex(card,p,[1,2,3,4,5]),null);assert.equal(completionIndex(card,p,[1,2,3,4,5,6,7,8,9,10]),10);
 const g=makeGame({timeZone:'Europe/Amsterdam',date:'2026-12-05T19:00'},'host','https://studio.example'),f=familyDefault();generateBooks(g,1,'batch');g.status='running';const book=g.books[0];book.accountId='a';activateBlock(g,g.plan.blocks.findIndex(b=>b.type==='round'));const numbers=activeGoal(g).pattern.cells.map(i=>book.cards[0][i]).filter(Boolean);g.state.drawn=[...numbers,...Array.from({length:75},(_,i)=>i+1).filter(n=>!numbers.includes(n)).slice(0,10)];beginBingo(g,f,'a','request',100);assert.equal(claimBook(g,f,'a',book.id,101).status,'late');assert.equal(f.falseCounts[g.id],undefined);assert(MINIGAMES.some(game=>game.id==='plingo'));
});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('async runner gates wait safely and pause buffers a draw acknowledgement until resume',async()=>{
 let release;const events=[],d=new ShowDirector({onEvent:e=>events.push(e)}),r=new ShowRunner(d);r.beforeBlock=()=>new Promise(resolve=>release=resolve);r.start(makeGame({timeZone:'Europe/Amsterdam',date:'2026-12-05T19:00'},'h','https://studio.example').plan);r.tick(1);assert.equal(r.phase,'sync');await flush();release();await flush();assert.equal(r.index,0);
 d.cancel();let ball;d.requestPick=()=>new Promise(resolve=>ball=resolve);d.draw();d.tick(2);await flush();d.pause();const count=events.length;ball({number:42,token:'token'});await flush();assert.equal(d.paused,true);assert.equal(events.length,count);d.resume();assert.equal(d.scene,'draw');assert.equal(d.pending,42);
 let commit;d.requestCommit=()=>new Promise(resolve=>commit=resolve);d.tick(5);await flush();d.pause();const before=events.length;commit({number:42});await flush();assert.equal(events.length,before);d.resume();assert.equal(d.scene,'reveal');assert.deepEqual(d.drawn,[42]);
});
test('host configuration, delayed poll and lost winner acknowledgement keep the correct local progression',async t=>{
 const {parseHTML}=await import('linkedom'),{BingoHost}=await import('../public/bingo-host.js');const h=setup(),g=await linked(h);const parsed=parseHTML(await fs.readFile(new URL('./fixtures/legacy-studio.html',import.meta.url),'utf8'));globalThis.document=parsed.document;globalThis.location={hash:''};globalThis.localStorage={getItem:()=>g.id,setItem(){}};
 const proto=parsed.window.HTMLSelectElement.prototype,desc=Object.getOwnPropertyDescriptor(proto,'value');if(!desc.set)Object.defineProperty(proto,'value',{configurable:true,get:desc.get,set(v){for(const o of this.options)o.selected=o.value===String(v);}});
 let deferPoll=null,loseAck=0;globalThis.fetch=async(url,options={})=>{const response=await handleBingo(h.req(url.replace('/api/bingo',''),{method:options.method||'GET',...(options.body?{body:JSON.parse(options.body)}:{})}),h.env);if(options.method==='GET'&&deferPoll&&url===`/api/bingo/games/${g.id}`){const wait=deferPoll;deferPoll=null;await wait;}if(loseAck&&url.endsWith('/finish-result')){loseAck--;throw new Error('Response connection lost');}return response;};
 const d=new ShowDirector({config:{voice:false}}),runner=new ShowRunner(d),host=new BingoHost({director:d,runner,getPlanner:()=>null});t.after(()=>{host.dispose();h.db.close();});await host.loading;assert.equal(document.querySelectorAll('input[data-minigame]').length,minigamesForBrand('vlampie').length);assert(document.querySelector('[data-dashboard-page="spellen"]'));
 // A tie result exists durably before presentation. Only the winning reveal changes local progression.
 const saved=await h.store.mutate(g.id,{},state=>{const winner={bookId:state.books[0].id,name:'Mila',ticket:'0001',accountId:'family'},r={id:crypto.randomUUID(),type:'bingo',roundIndex:0,goalIndex:0,winner,entrants:[winner],minigame:null,prize:{title:'Pakje'},acknowledged:false};state.results.push(r);state.state.phase='result';state.state.goalWon=true;state.state.resultId=r.id;});host.accept(saved.game);host.regieId='regie-main';host.recoveryConfirmed=true;
 let release;deferPoll=new Promise(resolve=>release=resolve);const poll=host.poll();await flush();loseAck=3;await assert.rejects(host.presentResult(),/onderbroken/);assert.equal(d.approvals,0);const result=host.game.results[0];await host.finishPresentation(result);assert.equal(d.approvals,1);release();await poll;assert.notEqual(host.game.state.phase,'result');assert.equal(d.approvals,1);await host.finishPresentation(result);assert.equal(d.approvals,1);host.dispose();
});
test('game tabs preserve edits across navigation and save all settings before generating books',async t=>{
 const {parseHTML}=await import('linkedom'),{BingoHost}=await import('../public/bingo-host.js'),h=setup(),{game:g}=await create(h),parsed=parseHTML(await fs.readFile(new URL('./fixtures/legacy-studio.html',import.meta.url),'utf8'));
 globalThis.document=parsed.document;globalThis.location={hash:''};globalThis.localStorage={getItem:()=>g.id,setItem(){}};
 const proto=parsed.window.HTMLSelectElement.prototype,desc=Object.getOwnPropertyDescriptor(proto,'value');if(!desc.set)Object.defineProperty(proto,'value',{configurable:true,get:desc.get,set(v){for(const o of this.options)o.selected=o.value===String(v);}});
 Object.defineProperty(parsed.window.HTMLInputElement.prototype,'checked',{configurable:true,get(){return this.hasAttribute('checked');},set(v){if(v)this.setAttribute('checked','');else this.removeAttribute('checked');}});
 globalThis.fetch=(url,options={})=>handleBingo(h.req(url.replace('/api/bingo',''),{method:options.method||'GET',...(options.body?{body:JSON.parse(options.body)}:{})}),h.env);
 const d=new ShowDirector({config:{voice:false}}),runner=new ShowRunner(d),host=new BingoHost({director:d,runner,getPlanner:()=>null});t.after(()=>{host.dispose();h.db.close();});await host.loading;host.regieId='regie-main';
 const click=node=>node.dispatchEvent(new parsed.window.Event('click',{bubbles:true})),change=node=>node.dispatchEvent(new parsed.window.Event('change',{bubbles:true}));
 const panel=()=>[...document.querySelectorAll('[data-game-panel]')].filter(p=>!p.hidden).map(p=>p.dataset.gamePanel);
 assert.equal(document.querySelectorAll('[role="tab"]').length,8);assert.deepEqual(panel(),['overview']);
 const windowInput=document.getElementById('game-window');windowInput.value='75';change(windowInput);click(document.getElementById('game-tab-minigames'));assert.deepEqual(panel(),['minigames']);
 const horse=document.querySelector('input[data-minigame="horses"]');horse.checked=false;change(horse);assert.equal(horse.closest('.minigame-option').querySelector('[data-minigame-state]').textContent,'Uitgeschakeld');
 click(document.getElementById('game-tab-rounds'));const prize=document.querySelector('[data-goal-prize]');prize.value=g.plan.prizes.at(-1).id;change(prize);const prizeId=prize.value;
 click(document.getElementById('game-tab-settings'));assert.equal(windowInput,document.getElementById('game-window'));assert.equal(windowInput.value,'75');assert(!horse.checked);
 const key=new parsed.window.Event('keydown',{bubbles:true});Object.defineProperty(key,'key',{value:'ArrowRight'});document.getElementById('game-tab-settings').dispatchEvent(key);assert.deepEqual(panel(),['overview']);assert.equal(document.getElementById('game-tab-overview').getAttribute('aria-selected'),'true');
 click(document.getElementById('game-tab-books'));document.getElementById('bingo-generate-count').value='2';document.getElementById('bingo-print-mode').value='mono';click(document.querySelector('[data-game-action="generate"]'));for(let i=0;i<100&&host.busy;i++)await flush();assert.equal(host.busy,false);assert.equal(document.getElementById('bingo-host-error').hidden,true);
 const saved=(await h.store.game(g.id)).data;assert.equal(saved.settings.claimSeconds,75);assert(!saved.settings.minigames.includes('horses'));assert.equal(saved.plan.blocks.find(b=>b.type==='round').goals[0].prizeId,prizeId);assert.equal(saved.books.length,2);assert.deepEqual(panel(),['books']);assert.equal(document.querySelectorAll('.pdf-batch').length,1);assert.equal(saved.batches[0].print.mode,'mono');assert.equal(document.querySelectorAll('.pdf-batch a[href*="?mode="]').length,2);
});
test('player confirmation sends nothing for NEE, then JA opens the host window before any card choice',async()=>{
 const {parseHTML}=await import('linkedom'),h=setup(),g=await linked(h);const {document,window}=parseHTML(await fs.readFile(new URL('./fixtures/legacy-player.html',import.meta.url),'utf8'));for(const name of ['window','document','customElements','HTMLElement','Element','Document','ShadowRoot','CSSStyleSheet','Event','CustomEvent','Node'])if(window[name])globalThis[name]=window[name];globalThis.location={search:`?spel=${g.id}`,pathname:'/spelen',hash:'',origin:'https://studio.example'};globalThis.history={replaceState(){},pushState(){}};globalThis.sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;window.scrollTo=()=>{};window.HTMLElement.prototype.focus=function(){};window.HTMLElement.prototype.showModal=function(){this.open=true;this.setAttribute('open','');};window.HTMLElement.prototype.close=function(){this.open=false;this.removeAttribute('open');};
 for(const dialog of document.querySelectorAll('dialog')){dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>dialog.removeAttribute('open');}
 const proto=window.HTMLSelectElement.prototype,desc=Object.getOwnPropertyDescriptor(proto,'value');if(!desc.set)Object.defineProperty(proto,'value',{configurable:true,get:desc.get,set(v){for(const o of this.options)o.selected=o.value===String(v);}});
 const sent=[];globalThis.fetch=async(url,options={})=>{if(url.startsWith('/api/player/session')){const me=await (await handleBingo(h.req('/me',{user:'family'}),h.env)).json();return Response.json({...me,authenticated:true,method:'platform',needsOnboarding:false});}if(url.startsWith('/api/player/brand'))return Response.json({brandId:g.brandId});if(url.startsWith('/api/calls'))return Response.json({call:null,serverTime:Date.now()});if(url.includes('/chat'))return Response.json({messages:[],cursor:0,self:{role:'player',canSend:true,profiles:[]},serverTime:Date.now()});if(options.method&&options.method!=='GET')sent.push(url);return handleBingo(h.req(url.replace('/api/bingo',''),{user:'family',method:options.method||'GET',...(options.body?{body:JSON.parse(options.body)}:{})}),h.env);};const originalInterval=globalThis.setInterval;globalThis.setInterval=()=>0;try{await importLegacyFixture('public/bingo-player.js');for(let i=0;i<15;i++)await flush();const click=id=>document.getElementById(id).dispatchEvent(new window.Event('click',{bubbles:true}));click('player-bingo');assert(document.getElementById('player-confirm').hasAttribute('open'));assert.equal(sent.length,0);click('confirm-no');assert.equal(sent.length,0);assert.equal((await h.store.game(g.id)).data.state.window,null);click('player-bingo');click('confirm-yes');const deadline=Date.now()+2000;while(!document.getElementById('player-claims').hasAttribute('open')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));const current=(await h.store.game(g.id)).data;assert.equal(current.state.phase,'window');assert.equal(current.state.window.claims.length,0);assert(document.getElementById('player-claims').hasAttribute('open'));assert.equal(document.querySelectorAll('[data-claim]').length,3);assert(sent[0].endsWith('/begin'));}finally{globalThis.setInterval=originalInterval;h.db.close();}
});
test('100 households can announce simultaneously without losing claims across 400 show books',async()=>{
 const h=setup(),g=makeGame({timeZone:'Europe/Amsterdam',date:'2026-12-05T19:00',settings:{retroBalls:75}},'host','https://studio.example');generateBooks(g,150,'one');generateBooks(g,150,'two');generateBooks(g,100,'three');for(let i=0;i<100;i++){const account='household-'+i,f=familyDefault(account+'@example.test');f.profiles=[{id:'p-'+i,name:'Speler '+i,age:10}];h.db.prepare('INSERT INTO bingo_families VALUES (?,1,?)').run(account,JSON.stringify(f));for(const b of g.books.slice(i*4,i*4+4)){b.accountId=account;b.profileId=f.profiles[0].id;b.name=f.profiles[0].name;}}
 g.status='running';activateBlock(g,g.plan.blocks.findIndex(b=>b.type==='round'));g.state.drawn=[...g.state.deck];await h.store.create(g);
 const announced=await Promise.all(Array.from({length:100},(_,i)=>h.call(`/games/${g.id}/begin`,{method:'POST',user:'household-'+i,body:{epoch:g.state.epoch}})));const w=announced[0].game.state.window;assert.equal((await h.store.game(g.id)).data.state.window.announcements.length,100);
 // Four book claims per household follow the same account/window while different households race.
 await Promise.all(Array.from({length:100},async(_,i)=>{for(const b of g.books.slice(i*4,i*4+4))await h.call(`/games/${g.id}/claim`,{method:'POST',user:'household-'+i,body:{windowId:w.id,bookId:b.id}});}));
 const saved=(await h.store.game(g.id)).data;assert.equal(saved.state.window.claims.length,400);assert(saved.state.window.claims.every(c=>c.status==='valid'));assert(saved.revision>=501);h.db.close();
});

function handleBingo(request,env,...args){return gameRequestFixture(verifiedhandleBingo,request,verifiedTestEnvironment(request,env),...args);}
