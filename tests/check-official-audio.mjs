import test from 'node:test';
import assert from 'node:assert/strict';
import {createSqliteDatabase} from '../server/node-storage.js';
import {BingoStore} from '../server/bingo-store.js';
import {makeGame,activateBlock,reserveBall,commitBall} from '../server/bingo-model.js';
import {handleBingo} from '../server/bingo.js';
import {handleOutput} from '../server/output.js';
import {officialBallBinding,officialBallKey,officialVoiceMatches} from '../public/official-audio.js';
import {bingoNumberText,dutchNumber,SPEECH_POLICY_VERSION,FIXED_SHOW_SPEECH} from '../public/bingo-speech.js';
import {PresenterMouthEnvelope,presenterMouthTarget} from '../public/presenter-mouth.js';

const origin='https://studio.example',owner='audio-regie',regieId='11111111-1111-4111-8111-111111111111',outputId='22222222-2222-4222-8222-222222222222';
async function fixture(t){
 const DB=createSqliteDatabase(':memory:');t.after(()=>DB.close());const env={DB,AUTH_IDENTITY:{user:owner,admin:true}},store=new BingoStore(DB),game=makeGame({brandId:'milo',title:'Fictieve audiorepetitie',date:'2026-12-05T18:00:00Z'},owner,origin),now=Date.now();
 game.status='running';activateBlock(game,game.plan.blocks.findIndex(block=>block.type==='round'),0,now-40000);const pending=reserveBall(game,now-20000);commitBall(game,pending.token,now-20000);game.state.control={id:regieId,until:now+60000};await store.create(game);
 const read=async()=>(await store.game(game.id)).data;
 const invoke=async(action,body={},status=200)=>{const response=await handleBingo(new Request(origin+'/api/bingo/games/'+game.id+'/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Vlampie-Bingo':'1'},body:JSON.stringify({regieId,requestId:crypto.randomUUID(),...body})}),env),data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;};
 const claim=async(body={})=>invoke('audio-cue',{cueId:'official-ball',commitId:game.state.lastCommit.token,expectedEpoch:game.state.epoch,...body});
 const output=async(body={},status=200)=>{const response=await handleOutput(new Request(origin+'/api/output',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Vlampie-Output':'1'},body:JSON.stringify({action:'output-audio-start',clientId:outputId,voiceId:'official-voice',commitId:game.state.lastCommit.token,...body})}),env),data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;};
 const outputState=()=>{const ball=officialBallBinding(game);return {generation:1,seq:2,publishedAt:Date.now(),producer:{id:regieId,instanceId:crypto.randomUUID(),generation:1,gameId:game.id,until:Date.now()+15000},output:{id:outputId,generation:1,seq:2,audioReady:true,until:Date.now()+7000},snapshot:{gameId:game.id,lastNumber:ball.number,drawn:game.state.drawn,officialBall:ball},voice:{id:'official-voice',clip:'a'.repeat(64),text:bingoNumberText(ball.number),officialBall:ball,preparedOnly:true,phase:'play'},routing:true};};
 const seedOutput=async state=>DB.prepare('INSERT INTO studio_outputs(owner_id,revision,document) VALUES (?,0,?) ON CONFLICT(owner_id) DO UPDATE SET document=excluded.document').bind(owner,JSON.stringify(state)).run();
 return {DB,store,game,read,invoke,claim,output,outputState,seedOutput};
}

test('all 75 official clips say their exact Dutch number once and have a new cache policy',()=>{
 assert.equal(SPEECH_POLICY_VERSION,'milo-dutch-bingo-v4-once');
 for(let number=1;number<=75;number++)assert.equal(bingoNumberText(number),['Bernhard','Izaak','Nico','Gerard','Otto'][Math.floor((number-1)/15)]+' '+dutchNumber(number)+'!');
 assert.equal(bingoNumberText(15,'vlampie'),'Nummer 15. 15!');
});
test('only a server commit binds the board, caption and one exact prepared Dutch fragment',async t=>{
 const h=await fixture(t),ball=officialBallBinding(h.game),snapshot=h.outputState().snapshot,voice=h.outputState().voice;
 assert(ball);assert.equal(officialVoiceMatches(voice,snapshot),true);
 for(const changed of [{number:ball.number===75?74:75},{commitId:'another-commit'},{index:ball.index+1},{epoch:'another-generation'},{policyVersion:'old-policy'}])assert.equal(officialVoiceMatches({...voice,officialBall:{...ball,...changed}},snapshot),false);
 assert.equal(officialVoiceMatches({...voice,text:bingoNumberText(ball.number)+' '+dutchNumber(ball.number)},snapshot),false);
 assert.equal(officialVoiceMatches({...voice,preparedOnly:false},snapshot),false);
 assert.equal(officialBallBinding({...h.game,state:{...h.game.state,lastCommit:h.game.state.pending}}),null);
});
test('two director requests and later tabs reserve one persisted announcement, preserving the official game',async t=>{
 const h=await fixture(t),before=structuredClone(h.game.state),results=await Promise.all([h.claim(),h.claim()]);assert.equal(results.filter(result=>result.claimed).length,1);
 assert(results.every(result=>result.text===bingoNumberText(before.lastCommit.number)));assert.deepEqual((await h.read()).state,before);
 const current=await h.read();await h.store.mutate(h.game.id,{},g=>{g.state.epoch='next-price-step';});const replay=await h.claim({expectedEpoch:'next-price-step'});assert.equal(replay.claimed,false);assert.equal(Object.keys(current.audioCues).length,1);
 await h.invoke('audio-cue',{cueId:'official-ball',commitId:'uncommitted-next-ball',expectedEpoch:'next-price-step'},409);
});
test('a claim window is announced once per server window without resetting its end or official ball',async t=>{
 const h=await fixture(t),endsAt=Date.now()+30000;await h.store.mutate(h.game.id,{},g=>{g.state.window={id:'test-window',status:'open',endsAt,claims:[]};});const before=(await h.read()).state;
 const results=await Promise.all([h.invoke('audio-cue',{cueId:'bingo-window',windowId:'test-window'}),h.invoke('audio-cue',{cueId:'bingo-window',windowId:'test-window'})]);assert.equal(results.filter(result=>result.claimed).length,1);assert.match(results[0].text,/BINGO-melding/);assert.doesNotMatch(results[0].text,/gewonnen|winnaar/);assert.deepEqual((await h.read()).state,before);
});
test('OBS atomically records first playback before sound and rejects replay after refresh or a second output tab',async t=>{
 const h=await fixture(t);await h.claim();await h.seedOutput(h.outputState());const results=await Promise.all([h.output(),h.output()]);assert.equal(results.filter(result=>result.audioStart.allowed).length,1);assert(results.every(result=>!('officialAudioStarted'in result.state)));
 const resumed=await h.output();assert.equal(resumed.audioStart.allowed,false);await h.output({clientId:crypto.randomUUID()},409);
 const game=await h.read();assert.equal(game.state.drawn.length,1);assert.equal(game.state.lastCommit.token,h.game.state.lastCommit.token);
});
test('OBS refuses stale numbers, wrong epochs, paused games and revoked output leases',async t=>{
 for(const condition of ['stale-number','stale-epoch','paused','expired-output'])await t.test(condition,async child=>{
  const h=await fixture(child);await h.claim();const state=h.outputState();if(condition==='stale-number')state.voice.officialBall={...state.voice.officialBall,number:76};if(condition==='stale-epoch')state.voice.officialBall={...state.voice.officialBall,epoch:'stale'};if(condition==='expired-output')state.output.until=Date.now()-1;if(condition==='paused')await h.store.mutate(h.game.id,{},g=>{g.state.paused=true;});await h.seedOutput(state);await h.output({},409);assert.equal((await h.read()).state.drawn.length,1);
 });
});
test('a BINGO window playback also survives output refresh without repeating or extending its timer',async t=>{
 const h=await fixture(t),window={id:'one-durable-window',status:'open',endsAt:Date.now()+30000,claims:[]};await h.store.mutate(h.game.id,{},g=>{g.state.window=window;});await h.invoke('audio-cue',{cueId:'bingo-window',windowId:window.id});const state=h.outputState();state.voice={...state.voice,officialBall:undefined,bingoWindow:{gameId:h.game.id,id:window.id,policyVersion:SPEECH_POLICY_VERSION},text:FIXED_SHOW_SPEECH.bingo};await h.seedOutput(state);
 const first=await h.output({windowId:window.id}),again=await h.output({windowId:window.id});assert.equal(first.audioStart.allowed,true);assert.equal(again.audioStart.allowed,false);assert.equal((await h.read()).state.window.endsAt,window.endsAt);
});
test('presentation emergency recovery logs one authorized step and never clears actual game holds or starts a ball',async t=>{
 const h=await fixture(t),state=structuredClone(h.game.state),requestId=crypto.randomUUID(),body={requestId,confirmed:true,reason:'cue-stuck',expectedEpoch:state.epoch,expectedBlockIndex:state.blockIndex};
 const results=await Promise.all([h.invoke('presentation-recover',body),h.invoke('presentation-recover',body)]);assert(results.every(result=>result.recovered));const current=await h.read();assert.equal(current.events.filter(event=>event.type==='presentation-recovered').length,1);for(const key of ['phase','paused','pending','drawClock','blockIndex','roundIndex','goalIndex','drawn','window','resultId','lastCommit'])assert.deepEqual(current.state[key],state[key]);
 await h.invoke('presentation-recover',{...body,requestId:crypto.randomUUID(),expectedEpoch:'stale-tab'},409);
 for(const hold of ['pending','window','resultId','drawHold','callId']){await h.store.mutate(h.game.id,{},g=>{g.state[hold]=hold==='window'?{id:'held-window',status:'open',endsAt:Date.now()+30000}:hold==='pending'?{number:2,token:'uncommitted'}:'official-hold';});const before=(await h.read()).state;await h.invoke('presentation-recover',{...body,requestId:crypto.randomUUID()},409);assert.deepEqual((await h.read()).state,before);await h.store.mutate(h.game.id,{},g=>{g.state[hold]=state[hold];});}
});
test('presenter mouth opens clearly on measured speech, closes on silence and never animates another speaker',()=>{
 const mouth=new PresenterMouthEnvelope();for(let frame=0;frame<6;frame++)mouth.read(.25,{speaking:true});assert(mouth.value>.55);for(let frame=0;frame<50;frame++)mouth.read(0,{speaking:true});assert.equal(mouth.value,0);
 assert.equal(presenterMouthTarget(1,{speaking:false}),0);assert.equal(presenterMouthTarget(1,{speaking:true,enabled:false}),0);assert.equal(presenterMouthTarget(.005,{speaking:true}),0);
 for(const hz of [30,60,120]){const envelope=new PresenterMouthEnvelope();for(let frame=0;frame<hz/2;frame++)envelope.read(.18,{speaking:true,delta:1/hz});assert(Math.abs(envelope.value-presenterMouthTarget(.18,{speaking:true}))<.001);}
});
