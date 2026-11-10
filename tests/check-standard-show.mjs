import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Pool} from 'pg';
import {createSqliteDatabase,createPostgresDatabase} from '../server/node-storage.js';
import {BingoStore} from '../server/bingo-store.js';
import {handleBingo} from '../server/bingo.js';
import {handlePublicRules} from '../server/game-rules-api.js';
import {makeGame,generateBooks,activateBlock,activeGoal,reserveBall,commitBall,completionIndex,beginBingo,claimBook,settleWindow,familyDefault,playerGame} from '../server/bingo-model.js';
import {rulesCurrent,prepareAutomaticRules,publishGameRules} from '../server/game-rules.js';
import {STANDARD_MILO_PROFILE,STANDARD_DRAW_RESERVATION_MS,isStandardMiloGame,standardMiloDiffers,drawDueAt,patternRequirement} from '../server/standard-show.js';

const origin='https://studio.example',date='2027-01-01T18:00:00Z';
function show(input={}){return makeGame({brandId:'milo',title:'Standaardshow',date,...input},'host',origin,100000);}
async function at(time,operation){const previous=Date.now;Date.now=()=>time;try{return await operation();}finally{Date.now=previous;}}
async function fixture(t,{postgres=false,game=show()}={}){
 let db,admin,schema;
 if(postgres){
  const source=new URL(process.env.MILO_TEST_DATABASE_URL);assert(['localhost','127.0.0.1','[::1]'].includes(source.hostname)&&/test/i.test(source.pathname),'A standard-show integration must use a local test database');
  admin=new Pool({connectionString:source.toString()});schema='milo_standard_'+crypto.randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
  const client=await admin.connect();try{await client.query('SET search_path TO '+schema);for(const name of (await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort())await client.query((await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replaceAll('public.',schema+'.').replaceAll('SCHEMA public','SCHEMA '+schema));}finally{client.release();}
  source.searchParams.set('options','-c search_path='+schema);db=await createPostgresDatabase(source.toString(),{allowLoopback:true});
 }else db=createSqliteDatabase(':memory:');
 const store=new BingoStore(db);await store.create(game);
 t.after(async()=>{await db.close();if(admin){await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}});
 const request=async(action='',body,options={})=>{
  const method=options.method||(body===undefined?'GET':'POST'),path=options.path||`/api/bingo/games/${game.id}${action?'/'+action:''}`;
  const response=await handleBingo(new Request(origin+path,{method,headers:{Origin:origin,'X-Vlampie-Bingo':'1','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify({regieId:'regie-main',requestId:crypto.randomUUID(),...body})})}),{DB:db,AUTH_IDENTITY:{user:options.user||'host',email:'fixture@example.test',admin:options.user?false:true}});
  return {status:response.status,data:await response.json()};
 };
 return {db,store,game,request,read:async()=>(await store.game(game.id)).data};
}
function admitted(game){generateBooks(game,1,'standard-show-books');Object.assign(game.books[0],{accountId:'family',profileId:'child',name:'Sam'});return game;}

test('new Milo defaults contain exactly ten authoritative goals; both outer rows are required and the centre stays free',()=>{
 const game=show();assert(isStandardMiloGame(game));assert.equal(game.settings.rulesProfile,STANDARD_MILO_PROFILE);assert.equal(game.settings.mode,'auto');assert.equal(standardMiloDiffers(game),false);
 generateBooks(game,1,'ten-goals');const rounds=game.plan.blocks.filter(block=>block.type==='round');assert.deepEqual(rounds.map(round=>round.goals.length),[3,3,3,1]);
 let count=0;
 for(const [roundIndex,round] of rounds.entries()){
  const card=game.books[0].cards[roundIndex];assert.equal(card[12],0);assert.equal(round.interval,15);assert.equal(round.newBoard,true);
  for(const [goalIndex,goal] of round.goals.entries()){
   const pattern=game.plan.patterns.find(candidate=>candidate.id===goal.patternId),drawn=pattern.cells.filter(cell=>cell!==12).map(cell=>card[cell]);
   assert.equal(completionIndex(card,pattern,drawn),drawn.length,`goal ${++count} must validate its own displayed pattern`);
   assert.equal(completionIndex(card,pattern,drawn.slice(0,-1)),null,'Every real marked number is required');
   if(goalIndex===1){assert.equal(completionIndex(card,pattern,card.slice(0,5)),null);assert.equal(completionIndex(card,pattern,card.slice(20,25)),null);assert.match(patternRequirement(pattern),/allebei vol.*Eén volle rij is geen bingo/);}
  }
 }
 assert.equal(count,10);
 const custom=show({roundCount:1}),vlampie=show({brandId:'vlampie'});assert.equal(isStandardMiloGame(custom),false);assert.equal(custom.plan.blocks.filter(block=>block.type==='round').length,1);assert.equal(vlampie.settings.mode,'guided');assert.equal(vlampie.settings.rulesProfile,undefined);assert(vlampie.plan.blocks.filter(block=>block.type==='round').every(round=>round.interval===4));
});

test('each new round selects its own card and resets the board; price steps retain official numbers and the prior round remains reviewable',()=>{
 const game=show();generateBooks(game,1,'round-cards');game.status='running';const indices=game.plan.blocks.flatMap((block,index)=>block.type==='round'?[index]:[]);
 for(const [roundIndex,index] of indices.entries()){
  activateBlock(game,index,0,200000+roundIndex*100000);assert.equal(game.state.roundIndex,roundIndex);assert.deepEqual(game.state.drawn,[]);assert.equal(game.state.deck.length,75);assert.equal(new Set(game.state.deck).size,75);
  const official=[...game.books[0].cards[roundIndex]].filter(Boolean);game.state.drawn=official;
  for(let goal=1;goal<game.plan.blocks[index].goals.length;goal++){activateBlock(game,index,goal,220000+goal*1000);assert.deepEqual(game.state.drawn,official);assert.equal(activeGoal(game).round.id,game.plan.blocks[index].id);}
 }
 assert.equal(game.state.history.length,3);for(const prior of game.state.history)assert.deepEqual(prior.drawn,game.books[0].cards[prior.roundIndex].filter(Boolean));
});

test('the server rejects a single row at the second price step through the real claim path',()=>{
 const game=admitted(show()),family=familyDefault();game.status='running';activateBlock(game,game.plan.blocks.findIndex(block=>block.type==='round'),1,100000);
 game.state.drawn=game.books[0].cards[0].slice(0,5);beginBingo(game,family,'family','one-row',120000);
 assert.equal(claimBook(game,family,'family',game.books[0].id,120001).status,'false');
});

test('15-second official cadence survives reload and retries, blocks every hold and never catches up overdue balls',()=>{
 const game=admitted(show());game.status='running';activateBlock(game,game.plan.blocks.findIndex(block=>block.type==='round'),0,100000);
 assert.equal(drawDueAt(game),115000);assert.throws(()=>reserveBall(game,115000-STANDARD_DRAW_RESERVATION_MS-1),error=>error.code==='draw_wait');
 const pending=reserveBall(game,110700);assert.equal(game.state.drawn.length,0);assert.throws(()=>commitBall(game,pending.token,114999),error=>error.code==='draw_wait');
 const committed=commitBall(game,pending.token,115000);assert.equal(drawDueAt(game),130000);assert.deepEqual(commitBall(game,pending.token,200000),committed);assert.equal(drawDueAt(game),130000);
 const reloaded=JSON.parse(JSON.stringify(game));assert.equal(drawDueAt(reloaded),130000);assert.throws(()=>reserveBall(reloaded,125699),error=>error.code==='draw_wait');
 for(const change of [g=>g.state.paused=true,g=>g.state.window={status:'open'},g=>g.state.phase='window',g=>g.state.phase='result',g=>g.state.resultId='minigame-result',g=>g.state.drawHold={id:'call'},g=>g.state.callId='call']){const blocked=structuredClone(game);change(blocked);assert.throws(()=>reserveBall(blocked,500000));assert.deepEqual(blocked.state.drawn,[committed.number]);}
 const overdue=reserveBall(game,900000);commitBall(game,overdue.token,905450);assert.equal(game.state.drawn.length,2);assert.equal(drawDueAt(game),920450);assert.throws(()=>reserveBall(game,905451),error=>error.code==='draw_wait');
});

test('an empty bingo window restarts a fresh 15 seconds while preserving official balls and claims',()=>{
 const game=admitted(show()),family=familyDefault();game.status='running';activateBlock(game,game.plan.blocks.findIndex(block=>block.type==='round'),0,100000);game.state.drawn=[1,2];
 beginBingo(game,family,'family','empty-window',120000);assert.throws(()=>reserveBall(game,190000));settleWindow(game,150000);assert.deepEqual(game.state.drawn,[1,2]);assert.equal(drawDueAt(game),165000);assert.equal(game.state.window.status,'closed');assert.equal(game.events.filter(event=>event.type==='window-closed').length,1);
});

test('rules are visible before participation; automatic draft edits do not exhaust publication history and bound rules stay locked',async t=>{
 const h=await fixture(t),preview=playerGame(h.game,'family');assert.equal(preview.rulesPublication.published,false);assert(preview.showRules.some(rule=>rule.id==='core-order'));assert.match(preview.showRules.find(rule=>rule.id==='core-order').text,/Eén volle rij is geen bingo/);
 const response=await handlePublicRules(new Request(origin+'/spelregels?spel='+h.game.id),{DB:h.db});assert.equal(response.status,200);assert.match(await response.text(),/Spelregels vooraf/);
 const game=structuredClone(h.game);prepareAutomaticRules(game,100000);const first=game.rulesPublication.id;
 for(let n=0;n<30;n++){game.plan.prizes[0].title='Prijs '+n;prepareAutomaticRules(game,100001+n);assert(rulesCurrent(game));}
 assert.equal(game.rulesPublication.id,first);assert.equal(game.rulesPublication.version,1);assert.equal(game.rulesHistory,undefined);
 admitted(game);game.settings.retroBalls++;assert.throws(()=>prepareAutomaticRules(game,200000),error=>error.code==='rules_locked');
});

test('creating a new show automatically publishes the actual stable-ID rules, without touching the separate Vlampie show',async t=>{
 const h=await fixture(t),created=await h.request('',{brandId:'milo',title:'Nieuw',date},{path:'/api/bingo/games'});assert.equal(created.status,201);const game=created.data.game;assert.equal(game.rulesPublication.contract.gameId,game.id);assert.equal(game.rulesPublication.version,1);assert.equal(game.rulesPublication.finalizedAt,undefined);assert(isStandardMiloGame(game));
 const other=await h.request('',{brandId:'vlampie',title:'Vlampie apart',date},{path:'/api/bingo/games'});assert.equal(other.status,201);assert.equal(other.data.game.rulesPublication,undefined);assert.equal(other.data.game.settings.rulesProfile,undefined);
});

test('the atomic start saves one final rules contract and rejects a second regie tab without a second show-start',async t=>{
 const h=await fixture(t,{game:admitted(show())}),[a,b]=await Promise.all([h.request('start',{expectedPreparationRevision:0}),h.request('start',{expectedPreparationRevision:0,regieId:'regie-other'})]);
 assert.deepEqual([a.status,b.status].sort(),[200,409]);const game=await h.read();assert.equal(game.status,'running');assert(game.rulesPublication.finalizedAt);assert(rulesCurrent(game));assert.equal(game.events.filter(event=>event.type==='show-started').length,1);
 assert.equal((await h.request('start',{expectedPreparationRevision:0})).status,409);assert.equal((await h.read()).events.filter(event=>event.type==='show-started').length,1);
 const custom=show({roundCount:1});admitted(custom);await h.store.create(custom);const response=await h.request('',{expectedPreparationRevision:0},{path:'/api/bingo/games/'+custom.id+'/start'});assert.equal(response.status,200);assert.equal(response.data.game.plan.blocks.filter(block=>block.type==='round').length,1,'Automatic rules never replace a custom plan');
});

test('a stale draft tab cannot start an already running show after the control lease expires; an exact start retry remains safe',async t=>{
 const h=await fixture(t,{game:admitted(show())}),start={expectedPreparationRevision:0,requestId:'start-once-fixture'};
 assert.equal((await at(200000,()=>h.request('start',start))).status,200);const index=h.game.plan.blocks.findIndex(block=>block.type==='round');await at(210000,()=>h.request('activate',{blockIndex:index}));
 const pending=(await at(220700,()=>h.request('reserve',{}))).data.pending;assert.equal((await at(225000,()=>h.request('commit',{token:pending.token}))).status,200);
 const before=JSON.stringify(await h.read()),blocked=await at(300000,()=>h.request('start',{expectedPreparationRevision:0,regieId:'stale-other-tab'}));assert.equal(blocked.status,409);assert.equal(blocked.data.error.code,'show_running');assert.equal(JSON.stringify(await h.read()),before);
 const retry=await at(300001,()=>h.request('start',start));assert.equal(retry.status,200);assert.equal(retry.data.game.state.drawn.length,1);assert.equal(JSON.stringify(await h.read()),before);assert.equal(retry.data.game.events.filter(event=>event.type==='show-started').length,1);
});

test('preparation CAS rejects stale tabs; a failed write cannot change stored preparation, rules or the running status',async t=>{
 const h=await fixture(t),body={plan:structuredClone(h.game.plan),settings:h.game.settings,expectedPreparationRevision:0};body.plan.blocks[0].title='Mijn voorbereiding';
 const first=await h.request('',body,{method:'PUT'});assert.equal(first.status,200);assert.equal(first.data.game.preparationRevision,1);
 const before=JSON.stringify(await h.read()),stale=await h.request('',{...body,plan:h.game.plan},{method:'PUT'});assert.equal(stale.status,409);assert.equal(stale.data.error.code,'preparation_conflict');assert.equal(JSON.stringify(await h.read()),before);
 const original=h.db.execute.bind(h.db);h.db.execute=async(sql,args)=>{if(/^UPDATE bingo_games SET revision/.test(sql))throw Error('Synthetic storage outage');return original(sql,args);};
 const warn=console.error;console.error=()=>{};try{const failed=await h.request('',{...body,expectedPreparationRevision:1},{method:'PUT'});assert.equal(failed.status,503);}finally{console.error=warn;h.db.execute=original;}
 assert.equal(JSON.stringify(await h.read()),before);
});

test('a historical manually published Milo draft converts once on autosave; its history is preserved and participation locks future core edits',async t=>{
 const game=show({roundCount:1});publishGameRules(game,110000);const original=structuredClone(game.rulesPublication),h=await fixture(t,{game});
 const settings={...game.settings,retroBalls:4},converted=await h.request('',{settings,expectedPreparationRevision:0},{method:'PUT'});assert.equal(converted.status,200);
 let saved=await h.read();assert.equal(saved.rulesPublication.version,2);assert.equal(saved.rulesPublication.automatic,true);assert.deepEqual(saved.rulesHistory,[original]);assert(rulesCurrent(saved));const automaticId=saved.rulesPublication.id;
 for(let n=0;n<30;n++){
  const plan=structuredClone(saved.plan);plan.prizes[0].title='Nieuwe conceptprijs '+n;
  const result=await h.request('',{plan,expectedPreparationRevision:saved.preparationRevision},{method:'PUT'});assert.equal(result.status,200);saved=await h.read();
  assert.equal(saved.rulesPublication.id,automaticId);assert.equal(saved.rulesPublication.version,2);assert.deepEqual(saved.rulesHistory,[original]);assert(rulesCurrent(saved));
 }
 await h.store.mutate(game.id,{},g=>{generateBooks(g,1,'historical-bound-book');Object.assign(g.books[0],{accountId:'family',profileId:'child',name:'Sam'});});saved=await h.read();const before=JSON.stringify(saved);
 const blocked=await h.request('',{settings:{...saved.settings,retroBalls:5},expectedPreparationRevision:saved.preparationRevision},{method:'PUT'});assert.equal(blocked.status,409);assert.equal(blocked.data.error.code,'rules_locked');assert.equal(JSON.stringify(await h.read()),before);
 const plan=structuredClone(saved.plan);plan.blocks.find(block=>block.type==='welcome').text='Nieuwe presentatietekst zonder gewijzigde speelregels.';
 const noncore=await h.request('',{plan,expectedPreparationRevision:saved.preparationRevision},{method:'PUT'});assert.equal(noncore.status,200);assert.deepEqual((await h.read()).rulesHistory,[original]);assert.equal((await h.read()).rulesPublication.id,automaticId);
});

test('pause, resume and regie reload preserve the exact show and claims while resetting only the draw timer',async t=>{
 const h=await fixture(t,{game:admitted(show())});await at(200000,()=>h.request('start',{}));const index=h.game.plan.blocks.findIndex(block=>block.type==='round');await at(210000,()=>h.request('activate',{blockIndex:index}));
 const pending=(await at(220700,()=>h.request('reserve',{}))).data.pending;assert.equal((await at(225000,()=>h.request('commit',{token:pending.token}))).status,200);
 await at(226000,()=>h.request('pause',{paused:true}));assert.equal((await at(900000,()=>h.request('reserve',{}))).status,409);await at(900001,()=>h.request('pause',{paused:false}));let saved=await h.read();assert.equal(drawDueAt(saved),915001);assert.equal(saved.state.drawn.length,1);
 await at(905000,()=>h.request('pause',{paused:false,restartClock:true,requestId:'resume-clock-once'}));saved=await h.read();assert.equal(drawDueAt(saved),920000);await at(906000,()=>h.request('pause',{paused:false,restartClock:true,requestId:'resume-clock-once'}));assert.equal(drawDueAt(await h.read()),920000,'The same resume request cannot keep postponing the next ball');
 const family=familyDefault();await h.store.mutate(h.game.id,{},game=>beginBingo(game,family,'family','open-window',920000));saved=await h.read();const window=structuredClone(saved.state.window),epoch=saved.state.epoch,drawn=[...saved.state.drawn];
 const heldClock=drawDueAt(saved);await at(930000,()=>h.request());await at(930000,()=>h.request('heartbeat',{}));saved=await h.read();assert.deepEqual(saved.state.window,window);assert.equal(saved.state.epoch,epoch);assert.deepEqual(saved.state.drawn,drawn);assert.equal(saved.state.phase,'window');assert.equal(drawDueAt(saved),heldClock,'Opening regie never resets or releases an existing claim window');assert.equal((await h.request('reserve',{})).status,409);
 await h.store.mutate(h.game.id,{},game=>{game.state.drawHold={id:'active-call'};game.state.resultId='saved-minigame';game.state.phase='result';});assert.equal((await h.request('heartbeat',{})).status,200);saved=await h.read();assert.equal(saved.state.drawHold.id,'active-call');assert.equal(saved.state.resultId,'saved-minigame');assert.deepEqual(saved.state.drawn,drawn);assert.equal(saved.events.filter(event=>event.type==='show-started').length,1);
});

test('standard rules load only after an explicit authorized draft action and retain custom cues and prizes',async t=>{
 const game=show({roundCount:1});game.plan.blocks[1].text='Mijn eigen welkom';game.plan.prizes[0].title='Mijn eigen prijs';const h=await fixture(t,{game}),original=JSON.stringify((await h.read()).plan);await h.request();assert.equal(JSON.stringify((await h.read()).plan),original);
 const loaded=await h.request('load-standard',{expectedPreparationRevision:0});assert.equal(loaded.status,200);assert.equal(standardMiloDiffers(loaded.data.game),false);assert.equal(loaded.data.game.plan.blocks[1].text,'Mijn eigen welkom');assert.equal(loaded.data.game.plan.prizes[0].title,'Mijn eigen prijs');
 await h.store.mutate(game.id,{},g=>{g.status='running';});assert.equal((await h.request('load-standard',{expectedPreparationRevision:1})).status,409);
 const bound=admitted(show({roundCount:1}));await h.store.create(bound);assert.equal((await h.request('',{expectedPreparationRevision:0},{path:'/api/bingo/games/'+bound.id+'/load-standard'})).status,409);
});

test('PostgreSQL preparation CAS and atomic start use the actual production adapter',{skip:!process.env.MILO_TEST_DATABASE_URL},async t=>{
 const h=await fixture(t,{postgres:true,game:admitted(show())});const first=await h.request('',{plan:h.game.plan,settings:h.game.settings,expectedPreparationRevision:0},{method:'PUT'});assert.equal(first.status,200);assert.equal(first.data.game.preparationRevision,1);
 const [a,b]=await Promise.all([h.request('start',{expectedPreparationRevision:1}),h.request('start',{expectedPreparationRevision:1,regieId:'another-regie'})]);assert.deepEqual([a.status,b.status].sort(),[200,409]);const game=await h.read();assert.equal(game.status,'running');assert(rulesCurrent(game));assert(game.rulesPublication.finalizedAt);assert.equal(game.events.filter(event=>event.type==='show-started').length,1);
 const clock=Date.now()+20000,index=game.plan.blocks.findIndex(block=>block.type==='round');await at(clock,()=>h.request('activate',{blockIndex:index}));
 const pending=(await at(clock+10700,()=>h.request('reserve',{}))).data.pending;assert(pending);assert.equal((await at(clock+14999,()=>h.request('commit',{token:pending.token}))).status,409);assert.equal((await at(clock+15000,()=>h.request('commit',{token:pending.token}))).status,200);
 const reloaded=(await new BingoStore(h.db).game(game.id)).data;assert.equal(reloaded.state.drawn.length,1);assert.equal(drawDueAt(reloaded),clock+30000);assert.equal(reloaded.state.lastCommit.at,clock+15000);
});
