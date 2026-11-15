// Local SQLite and isolated provider stubs only. No real families or providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../scripts/live-calls-fixture.mjs';
import {verifiedTestEnvironment} from '../scripts/verified-test-identity.mjs';
import {gameRequestFixture} from '../scripts/game-request-fixture.mjs';
import {obsLiveCall} from '../server/node-obs-access.js';
import {playerGame} from '../server/bingo-model.js';
import {handleBingo} from '../server/bingo.js';
import {handleLiveCalls} from '../server/live-calls.js';
import {canonicalRoundWinner,ensureWinnerCallCue,eligibleCallEntries,callEntryAvailability,reserveCallCue,scheduleCallCue,winnerAnnouncementText,winnerCallGreeting,WINNER_SPEECH_VERSION,CALL_PRESENCE_MS} from '../server/call-cues.js';
const currentGame=async h=>(await h.bingo.game(h.game.id)).data;
async function officialResult(h,roundIndex=0,{acknowledged=true,enabled=true,goalIndex}={}){
 let result;
 await h.bingo.mutate(h.game.id,{},g=>{const rounds=g.plan.blocks.filter(b=>b.type==='round'),round=rounds[roundIndex];round.callFullCardWinner=enabled;goalIndex??=round.goals.length-1;const goal=round.goals[goalIndex],book=g.books[0];result={id:crypto.randomUUID(),type:'bingo',roundId:round.id,goalId:goal.id,roundIndex,goalIndex,epoch:'fixture-official',goalKey:JSON.stringify([g.id,round.id,goal.id]),pattern:structuredClone(g.plan.patterns.find(p=>p.id===goal.patternId)),prize:structuredClone(g.plan.prizes.find(p=>p.id===goal.prizeId)),completeAt:24,winner:{bookId:book.id,accountId:book.accountId,profileId:book.profileId,name:book.name,ticket:book.ticket,completeAt:24},entrants:[],acknowledged,createdAt:Date.now()-1000,...(acknowledged?{acknowledgedAt:Date.now()-500}:{})};result.entrants=[{...result.winner}];g.results.push(result);g.state.roundIndex=roundIndex;g.state.goalIndex=goalIndex;g.state.goalWon=true;g.state.phase=acknowledged?'running':'result';g.state.resultId=acknowledged?null:result.id;g.state.window={status:'closed',endsAt:Date.now()-1000};});
 return result;
}
async function bingo(h,action,body={},status=200,{user}={}){const request=h.req(user?'player':'host',{regieId:h.ids.host,...body},{path:'/api/bingo/games/'+h.game.id+'/'+action,...(user?{user}:{})});const response=await gameRequestFixture(handleBingo,request,verifiedTestEnvironment(request,h.env));const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;}
async function randomCue(h,id){
 id??=(await currentGame(h)).plan.blocks.find(b=>b.type==='random-call')?.id||'random-fixture-1';
 await h.bingo.mutate(h.game.id,{},g=>{if(!g.plan.blocks.some(b=>b.id===id))g.plan.blocks.push({id,type:'random-call',title:'Willekeurig belmoment'});g.state.blockIndex=g.plan.blocks.findIndex(b=>b.id===id);});return (await h.invoke('host',{action:'cue-schedule',blockId:id})).cue;
}
async function publishResult(h,result){
 const voiceId=crypto.randomUUID();const row=await h.env.DB.prepare('SELECT document FROM studio_outputs WHERE owner_id = ?').bind('host').first(),output=JSON.parse(row.document);output.voice={id:voiceId,text:winnerAnnouncementText(result),at:Date.now()};output.output.voiceAck={id:voiceId,status:'ended'};output.snapshot.scene='winner';await h.env.DB.prepare('UPDATE studio_outputs SET document = ? WHERE owner_id = ?').bind(JSON.stringify(output),'host').run();return h.invoke('host',{action:'cue-result-announced',resultId:result.id,voiceId,scriptVersion:WINNER_SPEECH_VERSION});
}
async function closeCall(h){await h.step('host','cancel');await h.step('host','confirm-return',{confirmed:true,manual:true,note:'Fictieve ouder bevestigt zichtbaar en hoorbaar de uitzending.'});await h.step('host','resume-draw');}

test('each round including finale creates exactly one canonical full-card winner cue only when explicitly enabled',async t=>{
 const h=await fixture(t);for(let index=0;index<4;index++){const result=await officialResult(h,index),g=await currentGame(h),cue=ensureWinnerCallCue(g,result);assert(cue);assert.equal(cue.resumeTarget,index===3?'ending':'next-round');assert.equal(cue.status,'waiting-announcement');assert.equal(ensureWinnerCallCue(g,result),cue);assert.equal(g.callCues.filter(c=>c.source==='winner').length,1);g.plan.blocks.filter(b=>b.type==='round')[index].callFullCardWinner=false;assert.equal(canonicalRoundWinner(g,result),null);}
});

test('corners, both rows, lotteries, provisional results, wrong goal/prize and losing finalists never produce winner cues',async t=>{
 const h=await fixture(t);for(const goalIndex of [0,1]){const result=await officialResult(h,0,{goalIndex}),g=await currentGame(h);assert.equal(ensureWinnerCallCue(g,result),null);}
 const result=await officialResult(h,3),base=await currentGame(h);
 for(const change of [r=>r.acknowledged=false,r=>r.type='lottery',r=>r.goalId='other',r=>r.prize.id='other',r=>r.winner.profileId='sibling',r=>r.pattern.id='other']){const g=structuredClone(base),r=structuredClone(result);change(r);g.results=g.results.map(old=>old.id===r.id?r:old);assert.equal(ensureWinnerCallCue(g,r),null);}
});

test('finish-result persists the canonical cue once and blocks advancing until the explicit call outcome',async t=>{
 const h=await fixture(t),result=await officialResult(h,3,{acknowledged:false});const before=(await currentGame(h)).results[0];const first=await bingo(h,'finish-result',{resultId:result.id});assert.equal(first.game.callCues.length,1);assert.equal(first.game.callCues[0].resumeTarget,'ending');const second=await bingo(h,'finish-result',{resultId:result.id});assert.equal(second.game.callCues.length,1);assert.deepEqual(second.game.results[0].winner,before.winner);await bingo(h,'reserve',{},409);await bingo(h,'finish',{},409);await h.invoke('host',{action:'cue-skip',cueId:first.game.callCues[0].id});assert.equal((await currentGame(h)).state.drawHold,undefined);
});

test('fair random pool deduplicates children across books/tabs and separates consent/presence from prior history',async t=>{
 const h=await fixture(t),g=await currentGame(h),entry=g.participation[0],now=Date.now();g.books.push({...g.books[0],id:'extra-book'});g.participation.push({...entry,id:'other-tab'});assert.equal(eligibleCallEntries(g,now,{random:true}).length,1);
 for(const field of ['callConsentEnabled','parentConsent','micChecked','headphones','connectionChecked']){const copy=structuredClone(g);copy.participation.forEach(e=>e[field]=false);assert.equal(eligibleCallEntries(copy,now).length,0,field);}
 g.participation.forEach(e=>e.callPresenceAt=now-CALL_PRESENCE_MS-1);assert.equal(eligibleCallEntries(g,now).length,0);g.participation.forEach(e=>e.callPresenceAt=now);g.callHistory=[{source:'winner',profileId:entry.profileId,accountId:entry.accountId,invitedAt:now}];assert.equal(eligibleCallEntries(g,now,{random:true}).length,0);assert.equal(eligibleCallEntries(g,now).length,1);assert.equal(callEntryAvailability(g,{...entry,callStatus:'done'},now).available,true);
});

test('only two persisted random source cues exist; skip/refresh cannot reroll or create a third chance',async t=>{
 const h=await fixture(t),g=await currentGame(h);g.plan.blocks=g.plan.blocks.filter(b=>b.type!=='random-call');g.plan.blocks.push(...[1,2,3].map(i=>({id:'chance-'+i,type:'random-call'})));
 for(let i=1;i<=2;i++){g.state.blockIndex=g.plan.blocks.findIndex(b=>b.id==='chance-'+i);const cue=scheduleCallCue(g,{blockId:'chance-'+i});assert.equal(scheduleCallCue(g,{blockId:'chance-'+i}).id,cue.id);assert.equal(cue.randomIndex,i);cue.status='skipped';}
 g.state.blockIndex=g.plan.blocks.findIndex(b=>b.id==='chance-3');assert.throws(()=>scheduleCallCue(g,{blockId:'chance-3'}));assert.equal(g.callCues.length,2);
});

test('two host tabs reserve one random target, one existing call and one draw hold atomically without any provider request',async t=>{
 const h=await fixture(t),cue=await randomCue(h),[a,b]=await Promise.all([h.invoke('host',{action:'cue-invite',cueId:cue.id}),h.invoke('host',{action:'cue-invite',cueId:cue.id})]);assert.equal(a.call.id,b.call.id);assert.equal(a.call.mode,'prepared');assert.equal(a.call.phase,'ringing');const g=await currentGame(h);assert.equal(g.callHistory.length,1);assert.equal(g.state.drawHold.callId,a.call.id);assert.equal(h.upstream.length,0);await closeCall(h);const retry=await h.invoke('host',{action:'cue-invite',cueId:cue.id});assert.equal(retry.call.id,a.call.id);assert.equal(retry.call.phase,'completed');assert.equal((await currentGame(h)).callHistory.length,1);assert.equal((await currentGame(h)).state.drawHold,null);
});

test('PostgreSQL: concurrent regie tabs reserve the same durable cue with one call, invitation and hold',{skip:!process.env.MILO_TEST_DATABASE_URL},async t=>{
 const h=await fixture(t,{postgres:true}),cue=await randomCue(h),otherTab=crypto.randomUUID(),request=h.req('host',{action:'cue-invite',cueId:cue.id},{clientId:otherTab});
 const [a,b,second]=await Promise.all([h.invoke('host',{action:'cue-invite',cueId:cue.id}),h.invoke('host',{action:'cue-invite',cueId:cue.id}),handleLiveCalls(request,verifiedTestEnvironment(request,h.env),async()=>{throw Error('No provider is allowed in this transaction test.');})]);
 assert([200,409].includes(second.status));const other=await second.json();if(second.status===200)assert.equal(other.call.id,a.call.id);
 assert.equal(a.call.id,b.call.id);const game=await currentGame(h);
 assert.equal(game.callHistory.length,1);assert.equal(game.state.drawHold.callId,a.call.id);assert.equal(game.callCues.find(c=>c.id===cue.id).callId,a.call.id);assert.equal(h.upstream.length,0);
 await closeCall(h);assert.equal((await currentGame(h)).state.drawHold,null);
});

test('a different regie tab cannot race the leased output into a second invitation or live conversation',async t=>{
 const h=await fixture(t),cue=await randomCue(h),request=h.req('host',{action:'cue-invite',cueId:cue.id},{clientId:crypto.randomUUID()});
 const [first,second]=await Promise.all([h.invoke('host',{action:'cue-invite',cueId:cue.id}),handleLiveCalls(request,verifiedTestEnvironment(request,h.env),async()=>{throw Error('No provider in the tab race test.');})]);
 assert([200,409].includes(second.status));const response=await second.json();if(second.status===200)assert.equal(response.call.id,first.call.id);
 const game=await currentGame(h);assert.equal(game.callHistory.length,1);assert.equal(game.state.drawHold.callId,first.call.id);assert.equal((await h.current()).phase,'ringing');assert.equal(h.upstream.length,0);
});

test('empty/unreachable pool or withdrawn winner skips with prepared bridge and never installs a hold',async t=>{
 const h=await fixture(t);await h.bingo.mutate(h.game.id,{},g=>g.participation[0].callPresenceAt=null);const cue=await randomCue(h),response=await h.invoke('host',{action:'cue-invite',cueId:cue.id});assert.equal(response.call,null);assert.equal(response.cues[0].status,'skipped');assert(response.cues[0].fallbackText);assert.equal((await currentGame(h)).state.drawHold,undefined);assert.equal((await currentGame(h)).callHistory,undefined);assert.equal(h.upstream.length,0);
 const result=await officialResult(h,0);await publishResult(h,result);const w=await h.invoke('host',{action:'cue-invite',cueId:'winner:'+result.id});assert.equal(w.call,null);assert.equal(w.cues.find(c=>c.resultId===result.id).status,'skipped');assert.deepEqual((await currentGame(h)).results[0].winner,result.winner);
});

test('winner cue requires actual ended canonical output speech, then targets only the winning child and freezes facts',async t=>{
 const h=await fixture(t),result=await officialResult(h,0);await h.bingo.mutate(h.game.id,{},g=>ensureWinnerCallCue(g,g.results[0]));await h.invoke('host',{action:'cue-invite',cueId:'winner:'+result.id},409);await h.invoke('host',{action:'cue-result-announced',resultId:result.id,voiceId:'fabricated'},409);await publishResult(h,result);const response=await h.invoke('host',{action:'cue-invite',cueId:'winner:'+result.id});assert.equal(response.call.profileId,result.winner.profileId);assert.equal(response.call.source,'winner');assert.deepEqual(response.call.context.confirmedFacts,[{confirmed:true,resultId:result.id,round:'Ronde 1',prize:result.prize.title,type:'bingo'}]);assert.equal(response.call.resumeTarget,'next-round');
});

test('winner has priority over random; random may use a later planned pause and random history does not prevent later winner calls',async t=>{
 const h=await fixture(t),random=await randomCue(h),result=await officialResult(h,0);await publishResult(h,result);const defer=await h.invoke('host',{action:'cue-invite',cueId:random.id});assert.equal(defer.cues.find(c=>c.id===random.id).status,'deferred');assert.equal((await currentGame(h)).state.drawHold,undefined);await h.invoke('host',{action:'cue-skip',cueId:'winner:'+result.id});await h.bingo.mutate(h.game.id,{},g=>{g.plan.blocks.push({id:'later-safe-pause',type:'pause'});g.state.blockIndex=g.plan.blocks.length-1;});const invited=await h.invoke('host',{action:'cue-invite',cueId:random.id});assert(invited.call);await closeCall(h);const final=await officialResult(h,3);await publishResult(h,final);const winner=await h.invoke('host',{action:'cue-invite',cueId:'winner:'+final.id});assert.equal(winner.call.profileId,invited.call.profileId);assert.equal(winner.call.resumeTarget,'ending');
});

test('live agreement is separate from opt-in; prepared calls cannot silently start a realtime session',async t=>{
 const h=await fixture(t);await h.invoke('host',{action:'prepare',entryId:h.entryId});await h.step('host','ring');const call=await h.current();await h.step('player','answer',{checkpointId:call.checkpoint.id,heardLastNumber:call.checkpoint.lastNumber,cardsUpdated:true,youtubeMuted:true});await h.step('host','heartbeat',{target:'backstage',connected:true,micReady:true,playerTrackReceived:true});await h.step('player','heartbeat',{target:'backstage',connected:true,micReady:true});await h.step('host','backstage-ready',{soundChecked:true,explanationGiven:true});await h.step('host','stage');await h.step('host','go-live',{contextConfirmed:true},409);await h.step('player','agree-live',{agreed:true});await h.step('host','go-live',{contextConfirmed:true});await h.step('output',undefined,{sdp:'v=0\r\n'},409,{path:'/api/live-calls/realtime'});assert.equal(h.upstream.filter(r=>r.url.includes('openai.com')).length,0);
});

test('magic choice and effect rights are durable and once-only across concurrent host/family/output requests',async t=>{
 const h=await fixture(t);await h.live();await h.step('player','magic-choice',{choice:'stars'},409);await h.step('output','magic-ready');await Promise.all([h.step('player','magic-choice',{choice:'stars'}),h.step('host','magic-choice',{choice:'bubbles'})]);let c=await h.current();const chosen=structuredClone(c.magic);assert(['stars','bubbles'].includes(chosen.choice));const body={magicId:chosen.id,effectId:chosen.effectId},claims=await Promise.all([h.step('output','magic-claim',body),h.step('output','magic-claim',body)]);assert.equal(claims.filter(x=>x.effectGranted).length,1);await h.step('output','magic-played',body);c=await h.current();assert(c.magic.playedAt);await h.step('player','magic-choice',{choice:chosen.choice==='stars'?'bubbles':'stars'});assert.equal((await h.current()).magic.choice,chosen.choice);assert.equal((await h.step('output','magic-claim',body)).effectGranted,false);
});

test('consent withdrawal closes the current call immediately and leaves its authoritative hold for verified return',async t=>{
 const h=await fixture(t);await h.live();const call=await h.current();await bingo(h,'participation',{kind:'call',profileId:call.profileId,enabled:false},200,{user:'family'});const stopped=await h.current();assert.equal(stopped.phase,'returning');assert.equal(stopped.muted,true);assert.equal(stopped.resourcesClosed,true);assert.equal((await currentGame(h)).participation[0].callConsentEnabled,false);assert((await currentGame(h)).state.drawHold);await h.step('host','go-live',{contextConfirmed:true},409);
});

test('Milo safely closes unanswered and answered calls without YouTube evidence or a return form',async t=>{
 const h=await fixture(t);await h.prepare();await h.step('host','ring');await h.step('player','decline');assert.equal((await h.current()).returnState.cue,undefined);await h.step('host','confirm-return',{confirmed:true});await h.step('host','resume-draw');await h.backstage();await h.step('host','cancel');await h.step('player','player-returned',{confirmed:true});assert.equal((await h.current()).returnState.method,'call-audio-closed');await h.step('host','confirm-return',{confirmed:true});await h.step('host','resume-draw');assert.equal((await currentGame(h)).state.drawHold,null);
});

test('presence is per admitted child/account, expires independently, does not consume invitation history or bypass equipment checks',async t=>{
 const h=await fixture(t),before=await currentGame(h);await bingo(h,'participation',{kind:'presence',profileId:'sophie',visible:true},200,{user:'family'});await bingo(h,'participation',{kind:'presence',profileId:'sophie',visible:true},200,{user:'family'});let g=await currentGame(h);assert(g.participation[0].callPresenceAt);assert.equal(g.callHistory,undefined);assert.equal(g.participationLimits.family,undefined);assert.equal(g.participation[0].technicalReadyAt,before.participation[0].technicalReadyAt);await bingo(h,'participation',{kind:'presence',profileId:'sophie',visible:false},200,{user:'family'});g=await currentGame(h);assert.equal(callEntryAvailability(g,g.participation[0]).available,false);await bingo(h,'participation',{kind:'presence',profileId:'sophie',visible:true},400,{user:'other-family'});await h.invoke('player',{action:'cue-schedule',entryId:h.entryId},403);
});

test('a consent withdrawal committed while go-live is waiting prevents live transition and media token issuance',async t=>{
 const h=await fixture(t);await h.backstage();await h.step('host','backstage-ready',{soundChecked:true,explanationGiven:true});await h.step('host','stage');let entered,release;const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),original=h.env.DB.batch;let gated=false;
 h.env.DB.batch=async statements=>{if(!gated&&statements.some(s=>s.sql.startsWith('UPDATE studio_calls')&&JSON.parse(s.args[2]).switchingLive)){gated=true;entered();await gate;}return original(statements);};
 const going=h.step('host','go-live',{contextConfirmed:true},409);await waiting;await bingo(h,'participation',{kind:'call',profileId:'sophie',enabled:false},200,{user:'family'});release();await going;const call=await h.current();assert.equal(call.phase,'returning');assert(call.muted);assert((await currentGame(h)).state.drawHold);await h.step('player',undefined,{target:'live'},403,{path:'/api/live-calls/token'});assert.equal(h.upstream.filter(r=>r.url.includes('openai.com')).length,0);
});

test('manual cards keep a chosen presenter/explicit AI mode across refresh and never pause/draw merely when scheduled',async t=>{
 const h=await fixture(t),body={action:'cue-schedule',entryId:h.entryId,characterId:'stella',mode:'ai',context:{callName:'Sophie',note:'Privé: rustig begroeten.'},requestId:'manual-card-stable'},a=await h.invoke('host',body),b=await h.invoke('host',body);assert.equal(a.cue.id,b.cue.id);assert.equal(a.cue.characterId,'stella');assert.equal(a.cue.mode,'ai');assert.equal((await currentGame(h)).state.drawHold,undefined);const invited=await h.invoke('host',{action:'cue-invite',cueId:a.cue.id});assert.equal(invited.call.characterId,'stella');assert.equal(invited.call.mode,'ai');const player=await h.invoke('player');assert.equal(player.cues,undefined);assert(!JSON.stringify(player).includes('rustig begroeten'));
});

test('selection survives a provider-configuration failure and a retry never picks another child',async t=>{
 const h=await fixture(t);await h.bingo.mutate(h.game.id,{},g=>g.participation.push({...g.participation[0],id:'other-child-entry',profileId:'sam',name:'Sam'}));const cue=await randomCue(h);h.env.OPENAI_API_KEY='';await h.invoke('host',{action:'cue-invite',cueId:cue.id,mode:'ai'},503);let g=await currentGame(h),selected=g.callCues.find(c=>c.id===cue.id);assert(selected.selectedAt);assert(selected.entryId);const selectedId=selected.entryId;assert.equal(g.state.drawHold,undefined);assert.equal(g.callHistory,undefined);await h.bingo.mutate(h.game.id,{},game=>game.participation.find(e=>e.id===selectedId).callPresenceAt=null);const retried=await h.invoke('host',{action:'cue-invite',cueId:cue.id,mode:'prepared'});selected=retried.cues.find(c=>c.id===cue.id);assert.equal(selected.entryId,selectedId);assert.equal(selected.status,'skipped');assert.equal(retried.call,null);assert.equal((await currentGame(h)).state.drawHold,undefined);
});

test('Milo start enforces two scheduled random chances only for a new enabled-call draft',async t=>{
 const h=await fixture(t);await h.bingo.mutate(h.game.id,{},g=>{g.status='draft';g.plan.blocks=g.plan.blocks.filter(b=>b.type!=='random-call');g.state.phase='lobby';g.state.roundIndex=-1;});const response=await bingo(h,'start',{},409);assert.equal(response.error.code,'call_rundown');assert.equal((await currentGame(h)).status,'draft');
});


test('a random immediately after a round winner is durably deferred beyond its original planned pause',async t=>{
 const h=await fixture(t),result=await officialResult(h,0);await publishResult(h,result);let g=await currentGame(h),random=g.callCues.find(c=>c.source==='random');assert(random);assert.equal(random.status,'deferred');await h.invoke('host',{action:'cue-skip',cueId:'winner:'+result.id});await h.bingo.mutate(h.game.id,{},game=>game.state.blockIndex=game.plan.blocks.findIndex(b=>b.id===random.sourceBlockId));const samePause=await h.invoke('host',{action:'cue-invite',cueId:random.id});assert.equal(samePause.call,null);assert.equal(samePause.cues.find(c=>c.id===random.id).status,'deferred');assert.equal((await currentGame(h)).state.drawHold,undefined);await h.bingo.mutate(h.game.id,{},game=>{game.plan.blocks.push({id:'next-real-planned-pause',type:'pause'});game.state.blockIndex=game.plan.blocks.length-1;});const next=await h.invoke('host',{action:'cue-invite',cueId:random.id});assert.equal(next.call.phase,'ringing');assert.equal(next.call.cueId,random.id);
});

test('call checkpoints preserve a pre-existing manual pause through cancellation, verified return and release',async t=>{
 const h=await fixture(t);await h.bingo.mutate(h.game.id,{},g=>g.state.paused=true);const cue=await randomCue(h),invited=await h.invoke('host',{action:'cue-invite',cueId:cue.id});assert.equal(invited.call.checkpoint.paused,true);await bingo(h,'pause',{paused:false},409);await closeCall(h);const g=await currentGame(h);assert.equal(g.state.paused,true);assert.equal(g.state.drawHold,null);assert.deepEqual(g.state.drawn,[7,13,27]);
});

test('family and OBS projections exclude cue history, other families, consent/presence and private notes',async t=>{
 const h=await fixture(t),g=await currentGame(h);g.callCues=[{id:'private-cue',context:{note:'PRIVATE_CUE_NOTE'}}];g.callHistory=[{accountId:'OTHER_ACCOUNT',profileId:'OTHER_CHILD'}];g.participation.push({...g.participation[0],id:'OTHER_ENTRY',accountId:'OTHER_ACCOUNT',profileId:'OTHER_CHILD',name:'Other child'});const family=playerGame(g,'family');assert.equal(family.callCues,undefined);assert.equal(family.callHistory,undefined);assert(!JSON.stringify(family).includes('OTHER_ACCOUNT'));assert(!JSON.stringify(family).includes('PRIVATE_CUE_NOTE'));const output=obsLiveCall({id:'one-call',mode:'prepared',source:'winner',cueId:'cue-1',accountId:'PRIVATE_ACCOUNT',profileId:'PRIVATE_PROFILE',callConsentEnabled:true,callPresenceAt:123,context:{callName:'Oefenkind',note:'PRIVATE_CALL_NOTE'},magic:{id:'magic-1',choice:'stars',effectId:'call-stars',effectClaim:{id:'claim-1',outputId:'output-1',claimedAt:1,secret:'PRIVATE_MAGIC'}}});assert.equal(output.mode,'prepared');assert.equal(output.magic.choice,'stars');assert(!JSON.stringify(output).includes('PRIVATE_'));assert.equal(output.callConsentEnabled,undefined);assert.equal(output.callPresenceAt,undefined);
});


test('only the owner can edit an uninvited manual control card; the invited card and canonical facts remain protected',async t=>{
 const h=await fixture(t),planned=await h.invoke('host',{action:'cue-schedule',entryId:h.entryId,context:{callName:'Sophie'}}),body={action:'cue-context',cueId:planned.cue.id,context:{callName:'Sofietje',pronunciation:'Soo-fie',note:'ALLEEN_REGIE'},characterId:'stella',mode:'prepared'};await h.invoke('player',body,403);const edited=await h.invoke('host',body);assert.equal(edited.cue.context.callName,'Sofietje');assert.equal(edited.cue.characterId,'stella');assert.equal((await currentGame(h)).state.drawHold,undefined);const invited=await h.invoke('host',{action:'cue-invite',cueId:planned.cue.id});assert.equal(invited.call.context.callName,'Sofietje');assert.equal(invited.call.characterId,'stella');await h.invoke('host',{...body,context:{callName:'Wrong'}},409);const player=await h.invoke('player');assert(!JSON.stringify(player).includes('ALLEEN_REGIE'));
});

test('technical readiness lasts the same show/device context beyond thirty minutes, with recent independent presence',async t=>{
 const h=await fixture(t),g=await currentGame(h),now=Date.now(),entry=g.participation[0];Object.assign(entry,{technicalReadyAt:now-3*60*60*1000,technicalGameId:g.id,technicalContext:'device-a',callPresenceContext:'device-a',callPresenceAt:now});assert.equal(callEntryAvailability(g,entry,now).available,true);entry.callPresenceContext='device-b';assert.equal(callEntryAvailability(g,entry,now).available,false);entry.callPresenceContext='device-a';entry.technicalGameId='another-show';assert.equal(callEntryAvailability(g,entry,now).available,false);
});

test('emergency recovery revokes a live call, closes its isolated rooms and releases only its own hold without drawing',async t=>{
 const h=await fixture(t);await h.live();await h.step('player',undefined,{target:'live'},200,{path:'/api/live-calls/token'});const before=await currentGame(h),call=await h.current(),result=await h.step('host','emergency-recover',{expectedVersion:call.version,reason:'audio-stuck',confirmed:true});assert.equal(result.recovered,true);assert.equal(result.call.phase,'completed');assert(result.call.mediaRevokedAt);assert.equal(result.call.resourcesClosed,true);const after=await currentGame(h);assert.equal(after.state.drawHold,null);assert.deepEqual(after.state.drawn,before.state.drawn);assert.equal(after.state.paused,before.state.paused);assert(after.events.some(event=>event.type==='call-emergency-recovered'&&event.callId===call.id));assert(h.upstream.some(request=>request.url.endsWith('/RemoveParticipant')&&JSON.parse(request.options.body).revoke_token_ts));await h.step('player',undefined,{target:'live'},409,{path:'/api/live-calls/token'});await h.step('output',undefined,{sdp:'v=0\r\n'},409,{path:'/api/live-calls/realtime'});const again=await h.step('host','emergency-recover',{expectedVersion:call.version,reason:'audio-stuck',confirmed:true});assert.equal(again.recovered,true);assert.equal((await currentGame(h)).events.filter(event=>event.type==='call-emergency-recovered').length,1);
});

test('emergency recovery rejects wrong role, stale version and missing confirmation; an open official window remains locked',async t=>{
 const h=await fixture(t);await h.prepare();let c=await h.current();await h.step('player','emergency-recover',{expectedVersion:c.version,reason:'cue-stuck',confirmed:true},403);await h.step('host','emergency-recover',{expectedVersion:c.version-1,reason:'cue-stuck',confirmed:true},409);await h.step('host','emergency-recover',{expectedVersion:c.version,reason:'cue-stuck'},400);await h.bingo.mutate(h.game.id,{},g=>{g.state.window={id:'official-open',status:'open',endsAt:Date.now()+30000};});c=await h.current();const result=await h.step('host','emergency-recover',{expectedVersion:c.version,reason:'cue-stuck',confirmed:true});assert.equal(result.recovered,false);assert.match(result.blockedBy,/meldvenster/);const game=await currentGame(h);assert.equal(game.state.window.id,'official-open');assert.equal(game.state.drawHold.callId,c.id);assert(result.call.mediaRevokedAt);assert.equal(result.call.resourcesClosed,true);
});

test('unconfirmed provider cleanup keeps the emergency hold and a late AI response cannot restart audio',async t=>{
 const h=await fixture(t);await h.live();let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);h.setUpstream(async url=>{if(url==='https://api.openai.com/v1/live/sessions'){entered();await gate;return Response.json({session:{id:'live_emergency_late'},transport:{sdp:'v=0\r\nanswer'}});}return Response.json({});});const pending=h.step('output',undefined,{sdp:'v=0\r\n'},409,{path:'/api/live-calls/realtime'});await started;const c=await h.current(),recovery=await h.step('host','emergency-recover',{expectedVersion:c.version,reason:'connection-lost',confirmed:true});assert.equal(recovery.recovered,false);assert.equal(recovery.call.resourcesClosed,false);assert((await currentGame(h)).state.drawHold);release();await pending;const closed=await h.current();assert(closed.mediaRevokedAt);assert.equal(closed.phase,'returning');assert.equal(closed.resourcesClosed,true);const completed=await h.step('host','emergency-recover',{expectedVersion:closed.version,reason:'connection-lost',confirmed:true});assert.equal(completed.recovered,true);assert.equal((await currentGame(h)).state.drawHold,null);
});


test('winner announcement and greeting bind only the acknowledged child name and exact canonical price; random callers inherit no prior prize',async t=>{
 const h=await fixture(t),result=await officialResult(h,0);assert(winnerAnnouncementText(result).includes(result.winner.name));assert(winnerAnnouncementText(result).includes(result.prize.title));assert(!winnerAnnouncementText({...result,acknowledged:false}).includes(result.prize.title));assert(!winnerAnnouncementText({...result,winner:{...result.winner,name:'<script>parent</script>'}}).includes('<script>'));
 await publishResult(h,result);await h.invoke('host',{action:'cue-invite',cueId:'winner:'+result.id});const call=await h.current(),line=winnerCallGreeting(call);assert(line.startsWith('Hoi '+call.context.callName+'!'));assert(line.includes(result.prize.title));assert(!line.includes('toverassistent'));assert(!winnerCallGreeting({...call,winnerResultId:'other-result'}).includes(result.prize.title));await closeCall(h);
 await h.bingo.mutate(h.game.id,{},g=>{g.callHistory=[];});const cue=await randomCue(h,(await currentGame(h)).plan.blocks.filter(block=>block.type==='random-call')[1].id);const response=await h.invoke('host',{action:'cue-invite',cueId:cue.id});assert.equal(response.call.source,'random');assert.deepEqual(response.call.context.confirmedFacts,[]);
});

test('Dutch prepared fallback silences the AI first and only switches after confirmed provider hangup',async t=>{
 const h=await fixture(t);await h.live();await h.step('output',undefined,{sdp:'v=0\r\n'},200,{path:'/api/live-calls/realtime'});const result=await h.step('output','prepared-fallback');assert.equal(result.fallback,true);assert.equal(result.call.mode,'prepared');assert.equal(result.call.phase,'live');assert.equal(result.call.realtimeStopped,true);assert.equal(result.call.aiMuted,false);assert(h.upstream.some(request=>request.url.endsWith('/hangup')));assert((await currentGame(h)).state.drawHold);await h.step('output',undefined,{sdp:'v=0\r\n'},409,{path:'/api/live-calls/realtime'});
});


test('AI-plan custom random dialogue freezes the canonical source block and presenter into the one existing call',async t=>{
 const h=await fixture(t);await h.bingo.mutate(h.game.id,{},g=>{const block=g.plan.blocks.find(block=>block.type==='random-call');block.speakerId='stella';block.preparedCallLines={greeting:'Wat gezellig dat jij er bent!',choice:'Sterren of bubbels?',thank:'Dank je wel voor je hulp!',fallback:'Dan toveren wij samen.'};});const cue=await randomCue(h);assert.equal(cue.characterId,'stella');const invited=await h.invoke('host',{action:'cue-invite',cueId:cue.id});assert.equal(invited.call.characterId,'stella');assert.equal(invited.call.sourceBlockId,cue.sourceBlockId);assert.equal(invited.call.preparedLines.choice,'Sterren of bubbels?');await h.bingo.mutate(h.game.id,{},g=>{g.plan.blocks.find(block=>block.id===cue.sourceBlockId).preparedCallLines.choice='Een nieuwe tekst';});assert.equal((await h.current()).preparedLines.choice,'Sterren of bubbels?');const obs=obsLiveCall(invited.call);assert.equal(obs.preparedLines.greeting,'Wat gezellig dat jij er bent!');assert.equal(Object.hasOwn(obs,'accountId'),false);
});


test('a fresh regie tab can explicitly emergency-recover an expired owner without its own rebind causing a stale-version loop',async t=>{
 const h=await fixture(t);await h.prepare();await h.calls.mutate('host',c=>{c.seen.host=Date.now()-21000;return c;});const polled=await h.invoke('host'),newHost=crypto.randomUUID();const response=await h.step('host','emergency-recover',{expectedVersion:polled.call.version,reason:'connection-lost',confirmed:true},200,{clientId:newHost});assert.equal(response.recovered,true);assert.equal((await h.current()).hostId,newHost);assert.equal((await currentGame(h)).state.drawHold,null);
});
