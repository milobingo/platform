import test from 'node:test';
import assert from 'node:assert/strict';
import {freezeClaimDialog,claimDialogCurrent,familyClaimState} from '../frontend/family-claim.js';
import {makeGame,playerGame,activateBlock,generateBooks} from '../server/bingo-model.js';
import {publishGameRules,assertRulesCurrent,projectedGameRules} from '../server/game-rules.js';
import {handlePublicRules} from '../server/game-rules-api.js';
import {createSqliteDatabase} from '../server/node-storage.js';
import {BingoStore} from '../server/bingo-store.js';
import {dispatchNodeRequest} from '../server/node-runtime.js';

function fixture(brandId='milo'){
 const game=makeGame({date:'2027-11-18T13:30',timeZone:'Europe/Amsterdam',roundCount:1,brandId},'host','https://studio.example');
 generateBooks(game,2,'fixture');for(const b of game.books)Object.assign(b,{accountId:'family',profileId:b.id,name:'Voorbeeld'});
 publishGameRules(game);game.status='running';activateBlock(game,game.plan.blocks.findIndex(b=>b.type==='round'));
 return game;
}
test('the parent sees a frozen goal while later polls cannot retarget the dialog',()=>{
 const game=fixture(),view=playerGame(game,'family'),dialog=freezeClaimDialog(view);
 assert(claimDialogCurrent(dialog,view));
 view.state.goal.pattern.title='Nieuw patroon';assert.notEqual(dialog.goal.pattern.title,view.state.goal.pattern.title);
 for(const field of ['gameId','brandId','roundId','goalId','epoch','patternVersion']){
  const changed=structuredClone(view);changed.state.claimContext[field]='changed';assert.equal(claimDialogCurrent(dialog,changed),false,field);
 }
});
test('two initial dialogs can join one shared window and a closed historic claim is not current',()=>{
 const view=playerGame(fixture(),'family'),dialog=freezeClaimDialog(view),bookId=view.books[0].id;
 view.state.claimContext={...view.state.claimContext,windowId:'shared',windowStatus:'open',windowSequence:1};
 assert(claimDialogCurrent(dialog,view));
 view.state.window={id:'shared',status:'closed',endsAt:100,claims:[{bookId,status:'false'}]};
 assert.equal(familyClaimState(view,bookId,101),null);
 view.state.window={id:'new',status:'open',endsAt:200,claims:[]};assert.equal(familyClaimState(view,bookId,150),null);
 const bound=freezeClaimDialog(view);view.state.claimContext.windowId='later';assert.equal(claimDialogCurrent(bound,view),false);
});
for(const brand of ['milo','vlampie'])test(`${brand}: binding rules cannot be hidden by presentation edits or changed after participation`,()=>{
 const game=fixture(brand);game.status='draft';const original=projectedGameRules(game);
 assert(original.rules.some(r=>r.id==='core-sanctions'));assert(original.rules.some(r=>r.id==='core-priority'));
 game.presentationSelection={ruleIds:[]};assertRulesCurrent(game);
 game.settings.retroBalls=9;assert.throws(()=>assertRulesCurrent(game),e=>e.code==='rules_unpublished');
 assert.throws(()=>publishGameRules(game),e=>e.code==='rules_locked');
 assert.equal(game.rulesPublication.version,original.version);
});
test('rules are available before login and expose no family, book or private settings data',async()=>{
 const DB=createSqliteDatabase(':memory:'),game=fixture();game.status='draft';await new BingoStore(DB).create(game);
 const response=await handlePublicRules(new Request('https://studio.example/spelregels?spel='+game.id),{DB});
 assert.equal(response.status,200);const html=await response.text();assert.match(html,/Bindende spelregels/);assert(!html.includes(game.books[0].id));assert(!html.includes('accountId'));
 const post=await handlePublicRules(new Request('https://studio.example/spelregels?spel='+game.id,{method:'POST'}),{DB});assert.equal(post.status,405);
 await DB.close();
});

async function nativeRulesFixture(t){
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const env={DB,NODE_ENV:'development',MILO_LOCAL_AUTH:'true'};let cookie='';
 const call=async(path,{method='POST',body={}}={},status=200)=>{
  const response=await dispatchNodeRequest(new Request('http://localhost:3000'+path,{method,headers:{Origin:'http://localhost:3000',Cookie:cookie,'Content-Type':'application/json','X-Vlampie-Bingo':'1',...(path.startsWith('/api/player/')?{'X-Vlampie-Player':'1'}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)})}),{env,providerFetch:()=>{throw Error('No providers in rules tests');}});
  for(const value of response.headers.getSetCookie())cookie=value.split(';')[0];const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
 };
 await call('/auth/local',{body:{role:'regie'}});
 const {game}=await call('/api/bingo/games',{body:{brandId:'milo',title:'Regels voor deelname',date:'2027-11-18T13:30',timeZone:'Europe/Amsterdam',roundCount:1}},201);
 await call(`/api/bingo/games/${game.id}/publish-rules`);return {DB,call,id:game.id,store:new BingoStore(DB)};
}
test('native game PUT explicitly republishes version 2 before participation and preserves version 1 plus a reasoned audit',async t=>{
 const h=await nativeRulesFixture(t),path='/api/bingo/games/'+h.id,before=(await h.store.game(h.id)).data,plan=structuredClone(before.plan);plan.prizes[0].title='Gecontroleerde nieuwe prijs';
 const body={plan,settings:{...before.settings,retroBalls:4},publishRules:true,rulesChangeReason:'Prijs en terugkijkmarge gecontroleerd vóór deelname.',requestId:'rules-republish-api-fixture'};
 const result=await h.call(path,{method:'PUT',body}),saved=(await h.store.game(h.id)).data;
 assert.equal(result.game.rulesPublication.version,2);assert.equal(saved.rulesPublication.version,2);assert.notEqual(saved.rulesPublication.id,before.rulesPublication.id);assert.deepEqual(saved.rulesHistory,[before.rulesPublication]);assert.equal(saved.rulesPublication.contract.retroBalls,4);assert.equal(saved.plan.prizes[0].title,plan.prizes[0].title);
 assert.deepEqual(saved.events.filter(event=>event.type==='rules-republished').map(({at,...event})=>{assert(Number.isFinite(at));return event;}),[{type:'rules-republished',previousVersion:1,version:2,reason:body.rulesChangeReason}]);
 await h.call(path,{method:'PUT',body});const replayed=(await h.store.game(h.id)).data;assert.equal(replayed.rulesHistory.length,1);assert.equal(replayed.events.filter(event=>event.type==='rules-republished').length,1);
});
test('native game PUT requires explicit publication and a meaningful reason; rejected edits leave the complete stored game unchanged',async t=>{
 const h=await nativeRulesFixture(t),path='/api/bingo/games/'+h.id,before=await h.DB.prepare('SELECT revision,document FROM bingo_games WHERE id = ?').bind(h.id).first(),current=JSON.parse(before.document),settings={...current.settings,retroBalls:4};
 await h.call(path,{method:'PUT',body:{settings}},409);assert.deepEqual(await h.DB.prepare('SELECT revision,document FROM bingo_games WHERE id = ?').bind(h.id).first(),before);
 await h.call(path,{method:'PUT',body:{settings,publishRules:true,rulesChangeReason:'kort'}},400);assert.deepEqual(await h.DB.prepare('SELECT revision,document FROM bingo_games WHERE id = ?').bind(h.id).first(),before);
});
for(const participation of ['linked-book','active-order'])test(`native game PUT atomically refuses republishing after ${participation} without changing plan, rules or revision`,async t=>{
 const h=await nativeRulesFixture(t),path='/api/bingo/games/'+h.id;
 if(participation==='active-order')await h.call(path+'/orders/config',{body:{enabled:true,unitPriceCents:250,maxQuantity:30}});
 const generated=participation==='linked-book'?await h.call(path+'/generate',{body:{count:1}},201):null;
 await h.call('/auth/local',{body:{role:'player'}});const onboard=await h.call('/api/player/onboarding',{body:{name:'Volwassen ouder',dateOfBirth:'1990-01-01'}});
 if(generated)await h.call(path+'/register',{body:{profileId:onboard.family.profiles[0].id,code:generated.game.books[0].code}});
 else await h.call(path+'/orders',{body:{quantity:1,profileIds:[onboard.family.profiles[0].id]}},201);
 await h.call('/auth/local',{body:{role:'regie'}});
 const before=await h.DB.prepare('SELECT revision,document FROM bingo_games WHERE id = ?').bind(h.id).first(),game=JSON.parse(before.document),plan=structuredClone(game.plan);plan.prizes[0].title='Niet toegestane prijswijziging';
 const blocked=await h.call(path,{method:'PUT',body:{plan,settings:{...game.settings,retroBalls:4},publishRules:true,rulesChangeReason:'Deze wijziging mag na deelname niet worden gepubliceerd.'}},409);
 assert.equal(blocked.error.code,'rules_locked');assert.deepEqual(await h.DB.prepare('SELECT revision,document FROM bingo_games WHERE id = ?').bind(h.id).first(),before);
});
