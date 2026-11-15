import test from 'node:test';
import assert from 'node:assert/strict';
import {createSqliteDatabase} from '../server/node-storage.js';
import {BingoStore} from '../server/bingo-store.js';
import {handleBingo} from '../server/bingo.js';
import {makeGame,generateBooks,activateBlock} from '../server/bingo-model.js';
import {premierePlan} from '../server/premiere-plan.js';
import {defaultPresentation,freezePresentation} from '../server/presentation-model.js';
import {productionDefaults} from '../server/production-model.js';
import {orderingAvailable} from '../server/bingo-order-model.js';

const origin='https://duplicate.example',newDate='2027-12-02T13:30',newUtc='2027-12-02T12:30:00.000Z',canary='NEVER-COPY-RUNTIME-CREDENTIAL-123';
async function fixture(t,{status='draft',brand='milo',selection}={}){
 const db=createSqliteDatabase(':memory:'),store=new BingoStore(db);t.after(()=>db.close());
 const game=makeGame({brandId:brand,title:'Mijn volledige bronshow',date:'2026-12-02T13:30',timeZone:'Europe/Amsterdam',...(brand==='milo'?{roundCount:4,plan:premierePlan(),settings:{mode:'auto',rulesProfile:'milo-standard-v1',youtubeId:'ezsA3hsxIEc',claimSeconds:45,retroBalls:4,consolationEnabled:true}}:{roundCount:2,settings:{youtubeId:'ezsA3hsxIEc',claimSeconds:45}})},'host',origin);
 generateBooks(game,2,'source-only-book-batch');game.books[0].accountId='private-family';game.books[0].name=canary;
 if(status!=='draft'){game.status='running';activateBlock(game,game.plan.blocks.findIndex(block=>block.type==='round'));}
 game.production=productionDefaults();Object.assign(game.production,{revision:17,checks:{sound:true,picture:true,books:true,prizes:true},levels:{voice:73,music:13,effects:27,secret:canary}});Object.assign(game.production.lobby,{message:'Onze eigen wachtkamertekst.',startAt:'2026-12-02T12:29:00.000Z'});Object.assign(game.production.calls,{enabled:true,instructions:'Eigen gesprekstekst.',connection:'Geteste eigen verbinding',requirements:{headphones:true,returnAudio:true,hostMic:true,externalConnection:true},token:canary});game.production.memory={enabled:true,message:'Onze eigen herinnering.',token:canary};game.production.secret=canary;
 game.ordering={enabled:true,unitPriceCents:725,maxQuantity:9,description:'Eigen uitleg over onze bingobladen.',deadline:'2026-12-01T12:30:00Z',paymentProviderToken:canary};
 game.presentationSelection=selection||{profileId:'grand-show',ruleIds:['regel-kaart','regel-bingo'],secret:canary};game.presentationSnapshot={frozenAt:17,profile:{secret:canary}};game.settings.secret=canary;
 Object.assign(game,{orders:[{id:'sold-order',payment:{token:canary},bookIds:game.books.map(book=>book.id),status:'fulfilled'}],payments:{token:canary},events:[{type:'old-live-event',secret:canary}],results:[{id:'old-result',winner:{name:canary}}],participation:[{accountId:'private-family',name:canary}],emptyAnnouncements:{'private-family':{count:9}},audioCues:{'number-nine-audience':{at:17,token:canary}},obsAccess:{token:canary},publicToken:canary,callId:canary,createRequestId:'old-source-creation-request',operationReceipts:[{id:'old-request',secret:canary}],ops:['old-request'],broadcastRevision:22,preparationRevision:7,rulesHistory:[{secret:canary}],apiKey:canary});
 Object.assign(game.state,{drawn:[7,15],history:[{roundIndex:0,drawn:[9]}],pending:{number:27,token:canary},window:{id:'source-window',status:'open',endsAt:Date.now()+60000,claims:[],announcements:[]},control:{id:canary,until:Date.now()+60000},drawHold:{id:canary},callId:canary,drawClock:{nextAt:Date.now()+15000}});
 if(status==='finished')Object.assign(game,{status:'finished',finishedAt:17});if(status==='cancelled')Object.assign(game,{status:'finished',finishedAt:17,cancelledAt:17,cancellation:{requestId:canary}});
 game.rulesPublication={id:'old-publication',version:17,finalizedAt:17,contract:{gameId:game.id},rules:[]};
 await store.create(game);
 const raw=async id=>db.prepare('SELECT * FROM bingo_games WHERE id = ?').bind(id).first();
 const invoke=async(body={},options={})=>{
  const response=await handleBingo(new Request(origin+'/api/bingo'+(options.path||'/games/'+game.id+'/duplicate'),{method:options.method||'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Vlampie-Bingo':'1',...options.headers},body:JSON.stringify({title:'Onze volgende show',date:newDate,timeZone:'Europe/Amsterdam',requestId:'copy-'+crypto.randomUUID(),expectedPreparationRevision:7,...body})}),{DB:db,AUTH_IDENTITY:options.identity===undefined?{user:'host',admin:true}:options.identity});
  return {status:response.status,data:await response.json()};
 };
 return {db,store,game,raw,invoke,read:async id=>(await store.game(id||game.id)).data};
}

for(const status of ['draft','running','finished','cancelled'])test(`duplicating ${status} retains only the complete show configuration and never mutates its source`,async t=>{
 const h=await fixture(t,{status}),before=await h.raw(h.game.id),copied=await h.invoke();assert.equal(copied.status,201,JSON.stringify(copied));const game=await h.read(copied.data.game.id);
 assert.notEqual(game.id,h.game.id);assert.equal(game.status,'draft');assert.equal(game.title,'Onze volgende show');assert.equal(game.date,newUtc);assert.equal(game.brandId,'milo');assert.equal(game.origin,origin);assert.equal(game.ownerId,'host');assert.equal(game.preparationRevision,0);
 const expectedPlan=structuredClone(h.game.plan);expectedPlan.title=game.title;assert.deepEqual(game.plan,expectedPlan);for(const field of ['youtubeId','claimSeconds','retroBalls','mode','rulesProfile','consolationEnabled'])assert.equal(game.settings[field],h.game.settings[field]);assert.deepEqual(game.presentationSelection,{profileId:'grand-show',ruleIds:['regel-kaart','regel-bingo']});
 assert.deepEqual(game.production.levels,{voice:73,music:13,effects:27});assert.equal(game.production.revision,0);assert.deepEqual(game.production.checks,{sound:false,picture:false,books:false,prizes:false});assert.deepEqual(game.production.calls.requirements,{headphones:false,returnAudio:false,hostMic:false,externalConnection:false});assert.equal(game.production.calls.enabled,true);assert.equal(game.production.calls.instructions,'Eigen gesprekstekst.');assert.equal(game.production.calls.connection,'Geteste eigen verbinding');assert.equal(game.production.lobby.message,'Onze eigen wachtkamertekst.');assert.equal(game.production.lobby.startAt,'2027-12-02T12:29:00.000Z');assert.equal(game.production.memory.message,'Onze eigen herinnering.');
 assert.deepEqual(game.ordering,{enabled:true,unitPriceCents:725,maxQuantity:9,description:'Eigen uitleg over onze bingobladen.',deadline:'2027-12-01T12:30:00.000Z'});assert.equal(orderingAvailable(game,Date.parse('2027-11-30T12:30Z')),true);assert.equal(game.rulesPublication.contract.maxOrderQuantity,9);assert.equal(game.rulesPublication.version,1);assert.notEqual(game.rulesPublication.id,h.game.rulesPublication.id);assert.equal(game.rulesPublication.contract.gameId,game.id);assert.equal(game.rulesPublication.finalizedAt,undefined);assert.equal(game.rulesPublication.automatic,true);
 assert.deepEqual(game.books,[]);assert.deepEqual(game.batches,[]);assert.deepEqual(game.results,[]);assert.deepEqual(game.events,[]);assert.deepEqual(game.ops,[]);assert.deepEqual(game.state,{phase:'lobby',blockIndex:-1,roundIndex:-1,goalIndex:0,goalOpenedAt:0,epoch:'',drawn:[],history:[],deck:[],pending:null,window:null,windowSequence:0,resultId:null,goalWon:false,paused:false});
 for(const key of ['orders','payments','participation','emptyAnnouncements','audioCues','obsAccess','publicToken','callId','operationReceipts','broadcastRevision','rulesHistory','apiKey','presentationSnapshot','startedAt','finishedAt','cancelledAt','cancellation','createRequestId'])assert.equal(Object.hasOwn(game,key),false,key);
 assert(!JSON.stringify(game).includes(canary));assert.equal(copied.data.game.state.deck,undefined);assert.deepEqual(await h.raw(h.game.id),before);
});

test('Vlampie retains its production, host and patterns without receiving the Milo default profile',async t=>{
 const h=await fixture(t,{brand:'vlampie'}),copied=await h.invoke(),game=await h.read(copied.data.game.id);assert.equal(copied.status,201);assert.equal(game.brandId,'vlampie');assert.equal(game.plan.leadId,h.game.plan.leadId);assert.equal(game.settings.rulesProfile,undefined);assert.equal(game.rulesPublication,undefined);assert.deepEqual(game.plan.blocks,h.game.plan.blocks);assert.equal(game.plan.blocks.filter(block=>block.type==='round').length,2);
});

test('owner, role, origin, explicit JSON, unique request and input allowlist fail closed before any copy',async t=>{
 const h=await fixture(t),before=await h.raw(h.game.id);
 for(const options of [{identity:null},{identity:{user:'family',admin:false}},{identity:{user:'other-host',admin:true}},{headers:{Origin:'https://other.example'}},{headers:{'X-Vlampie-Bingo':'0'}},{headers:{'Content-Type':'text/plain'}}])assert([401,403,415].includes((await h.invoke({},options)).status));
 for(const body of [{requestId:''},{requestId:'short'},{title:''},{title:'x'.repeat(61)},{date:'not-a-date'},{expectedPreparationRevision:-1},{expectedPreparationRevision:7.1},{books:[{id:canary}]},{settings:{apiKey:canary}},{plan:h.game.plan},{production:{secret:canary}}])assert.equal((await h.invoke(body)).status,400);
 assert.deepEqual(await h.raw(h.game.id),before);assert.equal((await h.store.games()).length,1);
});

test('same-request concurrent copies converge, canonical dates replay, and changed source/payload never reuse the receipt',async t=>{
 const h=await fixture(t),requestId='same-copy-request-123',responses=await Promise.all(Array.from({length:8},()=>h.invoke({requestId})));assert.equal(responses.filter(item=>item.status===201).length,1);assert(responses.every(item=>[200,201].includes(item.status)));assert.equal(new Set(responses.map(item=>item.data.game.id)).size,1);const id=responses[0].data.game.id;
 const retry=await h.invoke({requestId,date:newUtc});assert.equal(retry.status,200);assert.equal(retry.data.replayed,true);assert.equal(retry.data.game.id,id);
 for(const patch of [{title:'Andere naam'},{date:'2027-12-03T13:30'},{expectedPreparationRevision:6}]){const conflict=await h.invoke({requestId,...patch});assert.equal(conflict.status,409);assert.equal(conflict.data.error.code,'request_conflict');}
 const another=makeGame({brandId:'milo',date:'2027-12-02T12:30Z'},'host',origin);await h.store.create(another);const wrongSource=await h.invoke({requestId},{path:'/games/'+another.id+'/duplicate'});assert.equal(wrongSource.status,409);assert.equal(wrongSource.data.error.code,'request_conflict');assert.equal((await h.store.games()).length,3);
 await h.store.mutate(h.game.id,{},game=>{game.preparationRevision++;game.plan.blocks[0].title='Na de succesvolle duplicatie gewijzigd';});const oldRequest=await h.invoke({requestId});assert.equal(oldRequest.status,200);assert.equal(oldRequest.data.game.id,id);assert.equal((await h.read(id)).plan.blocks[0].title,h.game.plan.blocks[0].title);
 const stale=await h.invoke();assert.equal(stale.status,409);assert.equal(stale.data.error.code,'preparation_conflict');
});

test('a preparation edit racing the guarded insert rejects without touching the source or creating a target',async t=>{
 const h=await fixture(t),execute=h.db.execute.bind(h.db);let raced=false;
 h.db.execute=async(sql,args)=>{if(!raced&&/^INSERT INTO bingo_games .* SELECT/.test(sql)){raced=true;await h.store.mutate(h.game.id,{},game=>{game.preparationRevision++;game.plan.blocks[0].title='De nieuwere opgeslagen voorbereiding';});}return execute(sql,args);};
 const response=await h.invoke();assert.equal(response.status,409,JSON.stringify(response));assert.equal(response.data.error.code,'preparation_conflict');assert(raced);assert.equal((await h.store.games()).length,1);assert.equal((await h.read()).preparationRevision,8);assert.equal((await h.read()).plan.blocks[0].title,'De nieuwere opgeslagen voorbereiding');
});

test('ordinary creation and duplication share an owner request namespace without accepting changed input',async t=>{
 const h=await fixture(t),ordinaryId='ordinary-create-request-123',creation={title:'Onze volgende show',date:newDate,timeZone:'Europe/Amsterdam',requestId:ordinaryId};
 const created=await h.invoke(creation,{path:'/games'});assert.equal(created.status,201);const collision=await h.invoke({requestId:ordinaryId});assert.equal(collision.status,409);assert.equal(collision.data.error.code,'request_conflict');
 const requestId='duplicate-first-request-123',copied=await h.invoke({requestId});assert.equal(copied.status,201);const reverse=await h.invoke({...creation,requestId},{path:'/games'});assert.equal(reverse.status,409);assert.equal(reverse.data.error.code,'request_conflict');
 const createRetry=await h.invoke({...creation,date:newUtc},{path:'/games'});assert.equal(createRetry.status,200);assert.equal(createRetry.data.game.id,created.data.game.id);const changed=await h.invoke({...creation,title:'Veranderde naam'},{path:'/games'});assert.equal(changed.status,409);assert.equal(changed.data.error.code,'request_conflict');
});

test('a deleted presentation choice is retained as IDs, while starting stays closed until a valid replacement is chosen',async t=>{
 const h=await fixture(t,{selection:{profileId:'removed-profile',ruleIds:['removed-rule']}}),copied=await h.invoke(),game=await h.read(copied.data.game.id);assert.equal(copied.status,201);assert.deepEqual(game.presentationSelection,{profileId:'removed-profile',ruleIds:['removed-rule']});assert.throws(()=>freezePresentation(game,{document:defaultPresentation(),revision:0}),/profiel bestaat niet/);
 await h.store.mutate(game.id,{},draft=>{generateBooks(draft,1,'replacement-test-book');Object.assign(draft.books[0],{accountId:'new-family',admitted:true});});
 const before=await h.raw(game.id),start=await h.invoke({expectedPreparationRevision:0,regieId:'duplicate-start-regie'},{path:'/games/'+game.id+'/start'});assert.equal(start.status,400);assert.equal(start.data.error.code,'presentation_choice');assert.deepEqual(await h.raw(game.id),before);
 const replacement={profileId:'grand-show',ruleIds:['regel-kaart']},saved=await h.invoke({presentationSelection:replacement,expectedPreparationRevision:0},{path:'/games/'+game.id,method:'PUT'});assert.equal(saved.status,200,JSON.stringify(saved));const started=await h.invoke({expectedPreparationRevision:1,regieId:'duplicate-start-regie'},{path:'/games/'+game.id+'/start'});assert.equal(started.status,200,JSON.stringify(started));assert.equal((await h.read(game.id)).status,'running');assert.equal((await h.read(game.id)).presentationSnapshot.profile.id,'grand-show');
});

test('an unconfirmed storage failure creates no partial copy and the identical retry succeeds once',async t=>{
 const h=await fixture(t),before=await h.raw(h.game.id),execute=h.db.execute.bind(h.db),requestId='storage-retry-duplicate-123';let failed=false;
 h.db.execute=async(sql,args)=>{if(!failed&&/^INSERT INTO bingo_games .* SELECT/.test(sql)){failed=true;throw Error('Injected storage outage');}return execute(sql,args);};
 const first=await h.invoke({requestId});assert.equal(first.status,503);assert.equal((await h.store.games()).length,1);assert.deepEqual(await h.raw(h.game.id),before);const retry=await h.invoke({requestId});assert.equal(retry.status,201);const again=await h.invoke({requestId});assert.equal(again.status,200);assert.equal(again.data.game.id,retry.data.game.id);assert.equal((await h.store.games()).length,2);assert.deepEqual(await h.raw(h.game.id),before);
});

test('ordinary creation accepts only fresh normalized rehearsal configuration without copying runtime',async t=>{
 const h=await fixture(t),body={title:'Mijn opgeslagen repetitie',date:newDate,timeZone:'Europe/Amsterdam',requestId:'rehearsal-create-config-123',brandId:'milo',roundCount:4,plan:h.game.plan,settings:h.game.settings,production:{...h.game.production,lobby:{...h.game.production.lobby,startAt:'2027-12-02T12:29Z'}},ordering:{...h.game.ordering,deadline:'2027-12-01T12:30Z'},presentationSelection:{profileId:'grand-show',ruleIds:['regel-kaart']},orders:h.game.orders,results:h.game.results,state:h.game.state};const created=await h.invoke(body,{path:'/games'});assert.equal(created.status,201,JSON.stringify(created));const game=await h.read(created.data.game.id);assert.equal(game.production.lobby.startAt,'2027-12-02T12:29:00.000Z');assert.equal(game.production.checks.sound,false);assert.equal(game.production.calls.requirements.hostMic,false);assert.equal(game.ordering.deadline,'2027-12-01T12:30:00.000Z');assert.equal(game.rulesPublication.contract.maxOrderQuantity,9);assert.deepEqual(game.results,[]);assert.equal(game.orders,undefined);assert(!JSON.stringify(game).includes(canary));
});
