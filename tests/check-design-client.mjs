import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateSummary,designPending,designRequest,editedDesignScene} from '../frontend/show-design-client.js';
import {normalizeUnpricedDraft,maySaveUnpricedDraft} from '../server/draft-plan.js';
import {makeGame,normalizeBingoPlan} from '../server/bingo-model.js';
import {makeDesignGame,compileDesignProposal,designSlots,normalizeDesignBriefing,validateDesignProposal} from '../server/show-design-model.js';
import {BingoStore} from '../server/bingo-store.js';
import {handleBingo} from '../server/bingo.js';
import {createSqliteDatabase} from '../server/node-storage.js';
const origin='https://studio.example';
const options=normalizeDesignBriefing('Een vrolijk avontuur met sterren en een warm welkom.').options;
function proposal(){return compileDesignProposal(validateDesignProposal({title:'Het sterrenavontuur',logline:'Samen vinden we het licht terug.',storyForm:'Avontuur',tone:'Warm',productionNotes:[],scenes:designSlots(options).map(slot=>({slotId:slot.id,title:slot.title,purpose:slot.purpose,speakerTurns:(slot.role==='random-call'?['Hallo, wat leuk dat je meedoet!','Kies sterren of bubbels. Samen tellen we af!','Dank je wel voor je hulp, zwaai maar naar iedereen.']:['Hallo lieve vrienden, wat fijn dat jullie allemaal meedoen. Samen maken we er een heel gezellige show van!']).map(text=>({speakerId:'milo',text})),operatorNotes:'Wacht op een reactie.',cameraId:null,cueId:slot.role==='magic'?'star-hat':null,durationEstimate:20,fallbackTurns:['random-call','magic'].includes(slot.role)?[{speakerId:'milo',text:'Samen spelen we vrolijk verder, wat een gezellig avontuur!'}]:[]}))},options),options);}

test('client keeps scene identity/position/role while allowing actual spoken text edits',()=>{
 const original={id:'cue-1',slotId:'welcome',role:'welcome',title:'Welkom',speakerTurns:[{speakerId:'milo',text:'Hallo!'}]};
 const changed=editedDesignScene(original,{id:'other',slotId:'closing',role:'finale',title:'Mijn welkom',speakerTurns:[{speakerId:'milo',text:'Mijn handmatige welkom.'}]});
 assert.equal(changed.id,'cue-1');assert.equal(changed.slotId,'welcome');assert.equal(changed.role,'welcome');assert.equal(changed.speakerTurns[0].text,'Mijn handmatige welkom.');assert.equal(original.speakerTurns[0].text,'Hallo!');
});
test('comparison reports only fixed presentation time and the actual compiled cast/cues',()=>{
 const value=proposal(),summary=candidateSummary({proposal:value});assert.equal(summary.rounds,4);assert.equal(summary.interactions,2);assert.equal(summary.magic,2);assert.deepEqual(summary.characters,['milo']);assert(summary.fixedMinutes>0);assert.equal(value.duration.totalRange,null);assert.equal(designPending({status:'writing'}),true);assert.equal(designPending({status:'ready'}),false);
});
test('client makes passive reads and explicit marked writes, preserving actionable server failures',async()=>{
 const previous=globalThis.fetch;const calls=[];
 try{globalThis.fetch=async(url,init)=>{calls.push({url,init});return Response.json({batch:{id:'batch-1'}});};await designRequest('?batchId=batch-1');await designRequest({action:'create',requestId:'same-intent',briefing:'Een vrolijke show'});assert.equal(calls[0].init.method,undefined);assert.equal(calls[0].init.cache,'no-store');assert.equal(calls[1].init.method,'POST');assert.equal(calls[1].init.headers['x-milo-show-design'],'1');assert.equal(JSON.parse(calls[1].init.body).requestId,'same-intent');globalThis.fetch=async()=>Response.json({error:{code:'design_conflict',message:'Jouw invoer blijft bewaard; vergelijk de actuele scène.'}},{status:409});await assert.rejects(designRequest({action:'edit-scene'}),e=>e.status===409&&e.code==='design_conflict'&&/invoer blijft/.test(e.message));}finally{globalThis.fetch=previous;}
});
test('unpriced concepts can save scripts without persisting fictitious prizes or weakening start validation',()=>{
 const game=makeDesignGame(proposal(),options,{owner:'qa-design',origin,id:crypto.randomUUID(),date:'2027-12-01T18:00:00Z'});assert.equal(maySaveUnpricedDraft(game),true);game.plan.blocks.find(b=>b.type==='welcome').text='Mijn handmatige openingszin.';const saved=normalizeUnpricedDraft(game.plan);assert.equal(saved.blocks.find(b=>b.type==='welcome').text,'Mijn handmatige openingszin.');assert.equal(saved.prizes.length,0);assert(saved.blocks.filter(b=>b.type==='round').flatMap(b=>b.goals).every(g=>g.prizeId===''));assert.throws(()=>normalizeBingoPlan(saved),/prijs/);const invalid=structuredClone(saved);invalid.blocks.find(b=>b.type==='round').goals[0].patternId='unknown';assert.throws(()=>normalizeUnpricedDraft(invalid),/patroon/);game.status='running';assert.equal(maySaveUnpricedDraft(game),false);game.status='draft';game.books=[{}];assert.equal(maySaveUnpricedDraft(game),false);game.books=[];game.orders=[{status:'cancelled'}];assert.equal(maySaveUnpricedDraft(game),false);game.orders=[];game.brandId='vlampie';assert.equal(maySaveUnpricedDraft(game),false);
});
test('actual draft save API persists an AI concept edit and CAS, while actual start and book APIs still reject missing prizes',async()=>{
 const db=createSqliteDatabase(':memory:'),store=new BingoStore(db),owner='qa-design',game=makeDesignGame(proposal(),options,{owner,origin,id:crypto.randomUUID(),date:'2027-12-01T18:00:00Z'}),env={DB:db,AUTH_IDENTITY:{user:owner,admin:true}};
 try{await store.create(game);game.plan.blocks.find(b=>b.type==='welcome').text='De aangepaste tekst blijft na herladen precies zo bewaard.';const call=(suffix,body,method='POST')=>handleBingo(new Request(origin+'/api/bingo/games/'+game.id+suffix,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Vlampie-Bingo':'1'},body:JSON.stringify(body)}),env);
  const saved=await call('',{plan:game.plan,expectedPreparationRevision:0},'PUT');assert.equal(saved.status,200,await saved.clone().text());const read=(await store.game(game.id)).data;assert.equal(read.preparationRevision,1);assert.equal(read.plan.prizes.length,0);assert.match(read.plan.blocks.find(b=>b.type==='welcome').text,/aangepaste tekst/);assert.equal((await call('',{plan:game.plan,expectedPreparationRevision:0},'PUT')).status,409);
  const started=await call('/start',{regieId:'qa-design-regie'});assert.equal(started.ok,false);assert.equal((await store.game(game.id)).data.status,'draft');const books=await call('/books',{count:1,requestId:'qa-no-unpriced-book'});assert.equal(books.ok,false);assert.equal((await store.game(game.id)).data.books.length,0);
 }finally{await db.close();}
});
