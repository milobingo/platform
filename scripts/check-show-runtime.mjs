import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,generateBooks} from '../server/bingo-model.js';
import {productionSettings} from '../server/production-model.js';
import {ShowRuntime} from '../frontend/show-runtime.js';
import {MILO_MAGIC_GAME_IDS,minigameDuration} from '../public/milo-minigame-plan.js';

const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))};
function fixture(){
 const game=makeGame({brandId:'milo',title:'De echte première',date:'2026-11-01T14:00',roundCount:4},'owner','https://bingo.example');generateBooks(game,1,'runtime-test');
 const calls=[],engine={game,production:'milo',demo:false,voicePhase:'idle',camera:'host',motion:'idle',hostId:'milo',characters:[{id:'milo',speed:1}],runner:{active:false},director:{paused:true,pending:null,flow:null,visual:()=>({scene:'host',age:17,paused:true,sceneRevision:3})},audio:{unlock:async()=>true,cue:id=>calls.push(['cue',id]),setLevels:levels=>calls.push(['levels',levels])},voice:{setVolume:v=>calls.push(['volume',v])},bridge:{sendLocal(){},cue:id=>calls.push(['remote-cue',id])},emit(){},notify(){},setCamera(id){this.camera=id;},fail(message){throw Error(message);},async post(action,body){calls.push([action,body]);return {game:this.game};},editPlan(fn){this.game.plan=structuredClone(this.game.plan);fn(this.game.plan);this.dirty=true;},async resultNext(){calls.push(['finish-result',this.game.state.resultId]);this.game.state.resultId=null;}};
 return {engine,calls,runtime:new ShowRuntime(engine)};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('all five Milo practices use the complete choreography and never create an official result',async()=>{
 const {engine,calls,runtime}=fixture(),before=structuredClone(engine.game);
 for(const id of MILO_MAGIC_GAME_IDS){
  await runtime.previewMinigame(id);const view=runtime.visual();
  assert.equal(view.preview,true);assert.equal(view.gameStage.result.minigame,id);
  assert.equal(view.gameStage.duration,minigameDuration(id));assert.equal(runtime.manual.endAfter,minigameDuration(id)+2);
  runtime.tick(.3);runtime.pause(true);const age=runtime.manual.age;runtime.tick(.35);assert.equal(runtime.manual.age,age);
  runtime.returnToShow();assert.equal(runtime.holding,false);
 }
 assert.deepEqual(engine.game,before);assert.equal(calls.length,0,'Practice must not call a winner/draw endpoint or create a paid session');
 engine.production='vlampie';await assert.rejects(runtime.previewMinigame('potion'),/bestaand beslisspel/);
 assert.throws(()=>runtime.setMinigames(['butterfly']),/beschikbaar/);
});

test('each Milo reveal retains the stored winner through pause and acknowledges only after its own full duration',async()=>{
 for(const id of MILO_MAGIC_GAME_IDS){
  const {engine,calls,runtime}=fixture(),winner={bookId:'fixed-winner',name:'Noor',ticket:'0042'};
  engine.game.status='running';engine.game.results=[{id:'fixed-'+id,minigame:id,winner,entrants:[winner,{bookId:'other',name:'Sam',ticket:'0043'}],prize:{title:'Verrassing'},acknowledged:false}];engine.game.state.resultId='fixed-'+id;
  const before=structuredClone(engine.game.books);await runtime.presentResult();
  const saved=structuredClone(runtime.manual.gameStage.result),duration=minigameDuration(id);
  for(let i=0;i<Math.floor(duration/.35);i++)runtime.tick(.35);
  assert.equal(calls.filter(c=>c[0]==='finish-result').length,0,'The reveal cannot be cut short at a legacy 20-second deadline');
  runtime.pause(true);const age=runtime.manual.age;for(let i=0;i<20;i++)runtime.tick(.35);assert.equal(runtime.manual.age,age);
  assert.deepEqual(runtime.manual.gameStage.result,saved);runtime.pause(false);
  for(let i=0;i<12;i++)runtime.tick(.35);await flush();
  assert.equal(calls.filter(c=>c[0]==='finish-result').length,1);assert.equal(runtime.manual.winner,'Noor');assert.deepEqual(engine.game.books,before);
 }
});

test('manual scene clock advances above a paused show, holds independently and restores the original flow',async()=>{
 const {engine,runtime}=fixture(),savedFlow={kind:'planned',age:7};engine.director.flow=savedFlow;
 await runtime.scene('rules');assert.equal(runtime.holding,true);assert.equal(engine.director.flow,savedFlow);assert.equal(engine.director.paused,true);
 runtime.tick(.2);assert.equal(runtime.visual(engine.director.visual()).age,.2);assert.equal(runtime.visual().paused,false);
 runtime.pause(true);runtime.tick(.3);assert.equal(runtime.manual.age,.2);assert.equal(runtime.visual().paused,true);
 runtime.pause(false);runtime.tick(.1);assert(Math.abs(runtime.manual.age-.3)<.0001);
 runtime.returnToShow();assert.equal(runtime.holding,false);assert.equal(engine.director.flow,savedFlow);assert.equal(engine.director.paused,true);assert.equal(engine.camera,'host');
});

test('a real minigame presents the fixed server winner then acknowledges once, without regenerating a card or choosing a winner',async()=>{
 const {engine,calls,runtime}=fixture(),before=JSON.stringify(engine.game.books),winner={bookId:'book-fixed',name:'Noor',ticket:'0042'},result={id:'result-fixed',type:'bingo',minigame:'rockets',winner,entrants:[winner,{bookId:'book-other',name:'Sam',ticket:'0068'}],prize:{title:'Het sterrenpakket'},acknowledged:false};
 engine.game.status='running';engine.game.results=[result];engine.game.state.resultId=result.id;engine.game.state.pending={number:19,token:'reserved-before-claim'};engine.director.flow={kind:'draw'};
 await runtime.presentResult();assert.equal(runtime.manual.gameStage.result.winner.bookId,'book-fixed');assert.equal(calls.filter(c=>c[0]==='finish-result').length,0);
 for(let i=0;i<64;i++)runtime.tick(.35);await flush();assert.equal(calls.filter(c=>c[0]==='finish-result').length,1);assert.equal(runtime.manual.scene,'winner');assert.equal(runtime.manual.winner,'Noor');
 for(let i=0;i<24;i++)runtime.tick(.35);await flush();assert.equal(runtime.holding,false);assert.equal(calls.filter(c=>c[0]==='finish-result').length,1);assert.equal(JSON.stringify(engine.game.books),before);assert.equal(engine.game.state.pending.number,19);
});

test('manual scene changes cannot interrupt a reserved draw or open claim window',async()=>{
 const {engine,runtime}=fixture();engine.game.state.pending={number:19};await assert.rejects(runtime.scene('prize'),/lopende trekking/);engine.game.state.pending=null;engine.game.state.window={status:'open'};await assert.rejects(runtime.scene('rules'),/meldvenster/);assert.equal(runtime.manual,null);
});

test('lobby uses only approved opted-in greetings and keeps preview separate from programme',async()=>{
 const {engine,runtime}=fixture();engine.game.participation=[{name:'Noor',greeting:true,greetingApproved:true},{name:'Sam',greeting:true,greetingApproved:false},{name:'Tess',greeting:false,greetingApproved:true}];
 runtime.previewScene('lobby');assert.equal(runtime.holding,false);assert.equal(engine.camera,'host');assert.equal(engine.previewShow.scene,'lobby');assert.deepEqual(engine.previewShow.gameStage.greetings,['Noor']);
 await runtime.scene('lobby');assert.deepEqual(runtime.visual().gameStage.greetings,['Noor']);
});

test('story and minigame changes preserve book identities and mark only preparation dirty',()=>{
 const {engine,runtime}=fixture(),before=JSON.stringify(engine.game.books),roundIds=engine.game.plan.blocks.filter(b=>b.type==='round').map(b=>b.id);
 runtime.applyStory('golden-spark');assert.equal(engine.game.plan.blocks.filter(b=>b.type==='story').length,4);assert.deepEqual(engine.game.plan.blocks.filter(b=>b.type==='round').map(b=>b.id),roundIds);assert.equal(JSON.stringify(engine.game.books),before);assert.equal(engine.dirty,true);
 assert.throws(()=>runtime.applyStory('parcel-mystery'),/Bevestig/);runtime.applyStory('parcel-mystery',{replace:true});assert.equal(engine.game.plan.blocks.filter(b=>b.type==='story').length,4);
 assert.throws(()=>runtime.setMinigames([]),/minstens/);runtime.setMinigames(['rockets']);assert.deepEqual(engine.game.settings.minigames,['rockets']);
});

test('saved production uses revision and safe audio levels while initialization makes no paid request',async()=>{
 const {engine,calls,runtime}=fixture();let upstream=0;const prior=globalThis.fetch;globalThis.fetch=async()=>{upstream++;throw Error('Unexpected paid request');};
 try{const p=productionSettings(engine.game.production);p.lobby.message='Wat gezellig dat je erbij bent.';await runtime.saveProduction(p);assert.equal(calls.find(c=>c[0]==='production')[1].revision,0);assert.equal(upstream,0);engine.game.production={...p,revision:4};await runtime.saveProduction({...p,revision:0});assert.equal(calls.filter(c=>c[0]==='production').at(-1)[1].revision,0,'A stale draft must retain its old revision so the server rejects it');assert.deepEqual(runtime.mix({voice:150,music:-8,effects:32}),{voice:100,music:0,effects:32});}finally{globalThis.fetch=prior;}
});
