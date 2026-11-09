// Real controller boundaries with inert network/media dependencies. No paid
// provider request or device connection is made by these checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame} from '../server/bingo-model.js';
import {ShowRuntime} from '../frontend/show-runtime.js';
import {AudienceRuntime} from '../frontend/call-runtime.js';
import {LiveCallRuntime} from '../frontend/live-call-runtime.js';

const noop=()=>{};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
class Connection{
 constructor(options){this.options=options;this.call=null;this.actions=[];this.lastOK=Date.now();}
 async action(action){this.actions.push(action);throw Error('Unexpected network action');}
 leave(){}dispose(){}
}
function fixture(){
 const game=makeGame({brandId:'milo',title:'Showmomenten',timeZone:'Europe/Amsterdam',date:'2026-11-01T14:00',roundCount:1},'owner','https://bingo.example');
 game.status='running';game.state.epoch='test-epoch';game.state.drawn=[7,19,42];
 const events=[],e={game,production:'milo',demo:false,isOutput:false,clientId:'host',hostId:'milo',speakerId:'milo',camera:'wide',motion:'idle',voicePhase:'idle',magic:null,
  showCues:{active:null,holding:false},runner:{active:false,autoDraw:false,age:0},
  director:{scene:'host',sceneAge:8,sceneRevision:2,paused:false,pending:null,flow:null,config:{},configure(value){Object.assign(this.config,value);},setScene(scene){this.scene=scene;this.sceneRevision++;},pause(){this.paused=true;}},
  audio:{unlock:async()=>true,cue:id=>events.push(['cue',id]),setLevels:noop,pause:noop},
  bridge:{id:'output',sendLocal:noop,cue:id=>events.push(['remote-cue',id]),controls:noop},
  emit:noop,fail:noop,notify:noop,stopSpeech:noop,setCamera(id){this.camera=id;},speak(text){events.push(['speech',text]);},
 };
 return {e,events};
}
const cueState={active:{id:'star-shower',source:'manual'},holding:true};
const gestureState={active:null,holding:true};

for(const [label,state] of [['showcue',cueState],['gebaar',gestureState]]){
 test(`${label} keeps scene, minigame and jingle controls from replacing its choreography`,async()=>{
  const {e,events}=fixture(),r=new ShowRuntime(e);e.showCues={...state};const before=structuredClone(e.game.state);
  await assert.rejects(r.scene('rules'),/showmoment/);await assert.rejects(r.scene('host'),/showmoment/);
  await assert.rejects(r.cue('applause'),/showcue/);
  e.game.status='draft';await assert.rejects(r.previewMinigame('plingo'),/showmoment/);
  assert.equal(r.manual,null);assert.equal(e.camera,'wide');assert.equal(events.length,0);assert.deepEqual(e.game.state,before);
 });

 test(`${label} prevents live-call handoff before any media or server action`,async()=>{
  const {e}=fixture(),r=new LiveCallRuntime(e,{Connection,timers:false});
  r.connection.call={id:'call',gameId:e.game.id,phase:'staged',drawHeld:true};e.game.state.drawHold={id:'call'};e.showCues={...state};
  await assert.rejects(r.action('go-live',{contextConfirmed:true}),/entertainmentmoment/);
  assert.deepEqual(r.connection.actions,[]);assert.equal(r.call.phase,'staged');assert.equal(e.game.state.drawHold.id,'call');r.dispose();
 });
}

test('a cue beginning during audio unlock prevents the awaited scene from taking over',async()=>{
 const {e}=fixture(),gate=deferred(),r=new ShowRuntime(e);e.audio.unlock=()=>gate.promise;
 const pending=r.scene('rules'),rejection=assert.rejects(pending,/showmoment/);e.showCues={...cueState};gate.resolve(true);await rejection;
 assert.equal(r.manual,null);assert.equal(e.camera,'wide');
});

test('automatic audience reactions and approved replies wait for cues, including the validation race',async()=>{
 const {e,events}=fixture(),gate=deferred();let validations=0;
 const r=new AudienceRuntime(e,{Connection,timers:false,api:async()=>{validations++;return gate.promise;}});
 r.review={phase:'review',approved:true,gameId:e.game.id,characterId:'milo',source:{id:'message',name:'Sophie',text:'Mag ik zwaaien?'},text:'Hallo Sophie!'};
 e.showCues={...cueState};assert.equal(r.autoQuiet(),false);await assert.rejects(r.airQuestion(),/showmoment/);assert.equal(validations,0);
 e.showCues={...gestureState};assert.equal(r.autoQuiet(),false);
 e.showCues={active:null,holding:false};assert.equal(r.autoQuiet(),true);
 const pending=r.airQuestion(),rejection=assert.rejects(pending,/showmoment/);e.showCues={...cueState};gate.resolve({valid:true});await rejection;
 assert.equal(validations,1);assert.equal(events.some(([event])=>event==='speech'),false);assert.equal(r.review.phase,'review');assert.equal(e.director.scene,'host');r.dispose();
});

test('authoritative live output suppresses stale animation fields even before media startup',()=>{
 const {e}=fixture(),r=new LiveCallRuntime(e,{Connection,timers:false});r.connection.call={id:'call',gameId:e.game.id,phase:'live',characterId:'milo',context:{callName:'Sophie'}};
 const base={hostId:'milo',showCue:{id:'star-shower'},movement:{id:'dance'},magic:{id:'star-hat'},show:{scene:'host'}};
 for(const output of [null,{stagePatch:value=>value,dispose:noop}]){
  r.output=output;const stage=r.stagePatch(base);assert.equal(stage.showCue,null);assert.equal(stage.movement,null);assert.equal(stage.magic,null);
 }
 assert.equal(base.showCue.id,'star-shower');assert.equal(base.movement.id,'dance');r.dispose();
});

test('an authoritative live handoff clears a stale cue without cancelling the held rundown',()=>{
 const {e}=fixture(),r=new LiveCallRuntime(e,{Connection,timers:false}),flow={kind:'planned',age:4};let resets=0,stops=0;
 e.director.flow=flow;e.camera='magic';e.audio.stop=()=>stops++;
 e.showCues={...cueState,reset(){resets++;this.active=null;this.holding=false;e.camera='wide';e.motion='idle';}};
 r.capture();assert.equal(r.restore,undefined,'Temporary cue framing must not become the call return shot');
 r.connection.call={id:'call',gameId:e.game.id,phase:'live',characterId:'milo',context:{callName:'Sophie'},drawHeld:true};
 r.onCall(r.call);assert.equal(resets,1);assert.equal(stops,1);assert.equal(e.director.flow,flow);assert.equal(e.director.callHold,true);assert.equal(e.director.drawBlocked,true);assert.equal(r.restore.camera,'wide');assert.equal(e.camera,'host');r.dispose();
});

test('preparing a call during entertainment keeps the cue running and acquires the draw hold',async()=>{
 const {e}=fixture();e.demo=true;e.game.books=[{accountId:'parent',profileId:'child',name:'Sophie'}];e.showCues={...cueState};e.camera='magic';
 const r=new LiveCallRuntime(e,{Connection,timers:false}),original=e.showCues.active,drawn=[...e.game.state.drawn];
 await r.prepare(r.queue()[0].id,{callName:'Sophie',reason:'Een gezellige kennismaking'});
 assert.equal(r.call.phase,'preparing');assert.equal(e.showCues.active,original);assert.equal(e.camera,'magic');assert.equal(r.restore,undefined);assert.equal(r.drawHeld,true);assert.equal(e.director.drawBlocked,true);assert.deepEqual(e.game.state.drawn,drawn);assert.equal(r.connection.actions.length,0);r.dispose();
});

test('legacy call output also clears old cues while preserving the source snapshot',()=>{
 const {e}=fixture(),r=new AudienceRuntime(e,{Connection,timers:false});r.connection.call={id:'call',phase:'live',characterId:'stella',name:'Sophie'};
 const base={showCue:{id:'dance'},movement:{id:'dance'},magic:{id:'star-hat'},show:{scene:'host'}},stage=r.stagePatch(base);
 assert.equal(stage.hostId,'stella');assert.equal(stage.showCue,null);assert.equal(stage.movement,null);assert.equal(stage.magic,null);assert.equal(base.showCue.id,'dance');r.dispose();
});
