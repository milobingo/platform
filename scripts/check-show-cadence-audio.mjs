import test from 'node:test';
import assert from 'node:assert/strict';
import {ShowDirector} from '../public/show-director.js';
import {ShowRunner} from '../public/show-runner.js';
import {defaultPlan} from '../public/plan-model.js';
import {bingoNumberText,roundSpeech,prizeSpeech,FIXED_SHOW_SPEECH} from '../public/bingo-speech.js';
import {createShowAudio} from '../public/show-audio.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
function directorFixture({brandId='milo',number=1,drawn=[],...config}={}){
 const events=[],director=new ShowDirector({config:{brandId,voice:true,sound:false,comments:true,...config},random:{getRandomValues(word){word[0]=Array.from({length:75},(_,i)=>i+1).filter(n=>!drawn.includes(n)).indexOf(number);}},onEvent:event=>events.push(event)});
 director.drawn=[...drawn];return {director,events};
}
function reveal(d){assert.equal(d.draw(),true);d.tick(1.15);d.tick(4.3);assert.equal(d.scene,'reveal');}
function finish(d){for(let n=0;d.flow&&n<1000;n++)d.tick(.05);assert.equal(d.flow,null);}

test('all 75 live Milo number calls use exactly the prepared Dutch letter/name script',()=>{
 const boundaries={1:'Bernhard één! Één!',15:'Bernhard vijftien! Vijftien!',16:'Izaak zestien! Zestien!',30:'Izaak dertig! Dertig!',31:'Nico eenendertig! Eenendertig!',45:'Nico vijfenveertig! Vijfenveertig!',46:'Gerard zesenveertig! Zesenveertig!',60:'Gerard zestig! Zestig!',61:'Otto eenenzestig! Eenenzestig!',75:'Otto vijfenzeventig! Vijfenzeventig!'};
 for(let number=1;number<=75;number++){const {director:d,events}=directorFixture({number});reveal(d);assert.equal(d.number,number);assert.deepEqual(events.filter(e=>e.type==='speech').map(e=>e.text),[bingoNumberText(number)]);if(boundaries[number])assert.equal(bingoNumberText(number),boundaries[number]);}
});

test('Milo official cadence preserves spin/commit and limits the post-speech board/host tail to 900ms',()=>{
 const {director:d,events}=directorFixture({number:5,drawn:[1,2,3,4],drawCadence:'official'});reveal(d);
 assert(Math.abs(d.flow.steps[0].duration+d.flow.steps[1].duration-5.45)<1e-10);assert.deepEqual(d.flow.steps.slice(3).map(s=>s.duration),[.45,.45]);
 d.tick(3.2,{voiceBusy:true});assert.equal(events.filter(e=>e.type==='numberfinished').length,0);assert.equal(d.scene,'reveal');
 d.tick(.001,{voiceBusy:false});assert.equal(d.scene,'board');assert.deepEqual(events.find(e=>e.type==='numberfinished'),{type:'numberfinished',number:5,index:4,count:5});d.tick(.45);d.tick(.45);
 assert.equal(d.flow,null);assert.deepEqual(events.filter(e=>e.type==='speech').map(e=>e.text),[bingoNumberText(5)],'a fifth ball never inserts required banter');assert.equal(events.filter(e=>e.type==='numberfinished').length,1);
});

test('number-finished opportunities remain silent while voice, pause, call, claim or cancellation blocks progress',()=>{
 for(const flag of ['paused','callHold','externalHold','narrationHold','drawBlocked']){const {director:d,events}=directorFixture();reveal(d);d[flag]=true;d.tick(60);assert.equal(events.filter(e=>e.type==='numberfinished').length,0,flag);d[flag]=false;d.tick(3.2);assert.equal(events.filter(e=>e.type==='numberfinished').length,1,flag);finish(d);assert.equal(events.filter(e=>e.type==='numberfinished').length,1);}
 const {director:d,events}=directorFixture();reveal(d);d.cancel();d.tick(60);assert.equal(events.filter(e=>e.type==='numberfinished').length,0);
});

test('a synchronous optional-number listener can cancel safely and never reopens the draw',()=>{
 const {director:d,events}=directorFixture();d.onEvent=event=>{events.push(event);if(event.type==='numberfinished')d.cancel();};reveal(d);assert.doesNotThrow(()=>d.tick(3.2));assert.equal(d.flow,null);assert.equal(d.scene,'reveal');assert.equal(events.filter(e=>e.type==='commit').length,1);
});

test('Vlampie retains its number text, 5-second tail and fifth-ball comment even with official config',()=>{
 const {director:d,events}=directorFixture({brandId:'vlampie',number:5,drawn:[1,2,3,4],drawCadence:'official'});reveal(d);assert.equal(events.find(e=>e.type==='speech').text,'Nummer 5. 5!');assert.deepEqual(d.flow.steps.slice(3).map(s=>s.duration),[2.2,2.8]);finish(d);assert.equal(events.filter(e=>e.type==='speech').length,2);
});

test('round, prize, bingo and finale speech share manifest identity and official runner uses no second timer',()=>{
 const {director:d,events}=directorFixture({round:'Ronde 3',pattern:'Boven én onder',prize:'Een vliegende hoed'});d.take('round');assert.equal(events.findLast(e=>e.type==='speech').text,roundSpeech(d.config.round,d.config.pattern));d.take('prize');assert.equal(events.findLast(e=>e.type==='speech').text,prizeSpeech(d.config.prize));d.take('finale');assert.equal(events.findLast(e=>e.type==='speech').text,FIXED_SHOW_SPEECH.thanks);d.cancel();d.reportBingo();assert.equal(events.findLast(e=>e.type==='speech').text,FIXED_SHOW_SPEECH.bingo);
 const other=directorFixture().director,runner=new ShowRunner(other),plan=defaultPlan();plan.blocks=[plan.blocks.find(b=>b.type==='round')];runner.autoDraw=false;runner.start(plan);other.cancel();runner.phase='drawing';runner.tick(600);assert.equal(other.flow,null);assert.equal(runner.age,0);assert.deepEqual(other.drawn,[]);
});

test('Milo winner announcement is a prepared fixed script while the actual winner remains visible; Vlampie retains the named script',()=>{
 for(const brandId of ['milo','vlampie']){const {director:d,events}=directorFixture({brandId});d.reportBingo('Sophie','Boekje 17');d.resolveBingo(true,{checked:true});assert.equal(events.findLast(e=>e.type==='speech').text,brandId==='milo'?FIXED_SHOW_SPEECH.winner:'Bingo bevestigd! Gefeliciteerd Sophie! Een groot applaus voor jou!');assert.equal(d.visual().winner,'Sophie');}
});

function audioFixture({pendingResume=false}={}){
 const nodes=[],gains=[],destinations=[],tracks=[{readyState:'live',stop(){this.readyState='ended';}}];let context,resolveResume;
 function parameter(){return {value:0,events:[],setValueAtTime(v,t){this.value=v;this.events.push(['value',v,t]);},linearRampToValueAtTime(v,t){this.value=v;this.events.push(['linear',v,t]);},exponentialRampToValueAtTime(v,t){this.value=v;this.events.push(['exponential',v,t]);},cancelScheduledValues(){},setTargetAtTime(v,t){this.value=v;this.events.push(['target',v,t]);}};}
 const connectable=()=>({connections:[],connect(to){this.connections.push(to);},disconnect(){this.disconnected=true;}});
 class Context{
  state='running';currentTime=0;destination={name:'speakers'};
  constructor(){context=this;}
  createMediaStreamDestination(){const node={...connectable(),stream:{getTracks:()=>tracks,getAudioTracks:()=>tracks}};destinations.push(node);return node;}
  createAnalyser(){return {...connectable(),fftSize:256,getByteTimeDomainData(a){a.fill(128);}};}
  createGain(){const node={...connectable(),gain:parameter()};gains.push(node);return node;}
  createOscillator(){const node={...connectable(),frequency:parameter(),stops:[],start(time){this.startedAt=time;},stop(time){this.stops.push(time);}};nodes.push(node);return node;}
  async resume(){if(pendingResume)await new Promise(resolve=>{resolveResume=resolve;});this.state='running';}
  async close(){this.state='closed';}
 }
 const audio=createShowAudio({Context});return {audio,nodes,gains,tracks,destinations,get context(){return context;},resolveResume(){resolveResume?.();},music(){return nodes.filter(node=>node.connections[0]?.connections[0]===gains[1]);},effects(){return nodes.filter(node=>node.connections[0]?.connections[0]===gains[0]);}};
}
const musicShow=(scene='host',extra={})=>({brandId:'milo',scene,paused:false,...extra});

test('Milo music requires active-show permission and continues across scenes/cues on the separate program bus',async()=>{
 const h=audioFixture();await h.audio.unlock();h.audio.tickGame(musicShow());assert.equal(h.nodes.length,0);h.audio.enableBackground(true);h.audio.tickGame(musicShow());assert.equal(h.music().length,3);const initial=h.music();h.audio.cue('spin');h.audio.cue('reveal');assert(initial.every(n=>n.stops.length===1),'effects do not stop the scheduled music');assert(h.effects().length>0);
 for(const [i,scene]of ['board','round','prize','rules','patterns','host'].entries()){h.context.currentTime=(i+1)*3.2;h.audio.tickGame(musicShow(scene));}assert.equal(h.music().length,21);const once=h.nodes.length;h.audio.tickGame(musicShow());assert.equal(h.nodes.length,once,'repeated snapshots never schedule the same beat twice');assert.equal(h.destinations.length,1);assert(h.gains[1].connections[0].connections.includes(h.destinations[0]));assert(h.gains[0].connections[0].connections.includes(h.destinations[0]));h.audio.dispose();assert.equal(h.tracks[0].readyState,'ended');
});

test('number scenes and presenter voice duck gentle music independently of effect cues',async()=>{
 const h=audioFixture();await h.audio.unlock();h.audio.enableBackground(true);h.audio.tickGame(musicShow());const full=h.gains[1].gain.value;h.audio.tickGame(musicShow('draw'));const numbers=h.gains[1].gain.value;assert(numbers<full/3);h.audio.tickGame(musicShow('host'));assert.equal(h.gains[1].gain.value,full);h.audio.duck(true);assert.equal(h.gains[1].gain.value,numbers);h.audio.duck(false);assert.equal(h.gains[1].gain.value,full);h.audio.dispose();
});

test('held, paused, finished, cancelled and disconnected shows stop music immediately without late replay',async()=>{
 for(const state of [{paused:true},{externalHold:true},{drawBlocked:true},{callHold:true},{cancelledAt:1},{status:'finished'},{scene:'checking'},{scene:'winner'},{scene:'call'}]){
  const h=audioFixture();await h.audio.unlock();h.audio.enableBackground(true);h.audio.tickGame(musicShow());const chord=h.music();h.context.currentTime=1;h.audio.tickGame(musicShow('host',state));assert(chord.every(n=>n.stops.length===2),JSON.stringify(state));const count=h.nodes.length;h.context.currentTime=20;h.audio.tickGame(musicShow('host',state));assert.equal(h.nodes.length,count);h.audio.dispose();
 }
 const h=audioFixture();await h.audio.unlock();h.audio.enableBackground(true);h.audio.tickGame(musicShow());h.audio.enableBackground(false);h.context.currentTime=60;h.audio.tickGame(musicShow());assert.equal(h.music().length,3);h.audio.dispose();
});

test('mute/disable/explicit stop silence both buses; resume starts a fresh current chord, not missed music',async()=>{
 for(const stop of [audio=>audio.setMuted(true),audio=>audio.setEnabled(false),audio=>audio.pause(),audio=>audio.stop()]){const h=audioFixture();await h.audio.unlock();h.audio.enableBackground(true);h.audio.tickGame(musicShow());h.audio.cue('reveal');const before=[...h.nodes];stop(h.audio);assert(before.every(n=>n.stops.length>=2));h.audio.dispose();}
 const h=audioFixture();await h.audio.unlock();h.audio.enableBackground(true);h.audio.tickGame(musicShow());h.audio.pause();h.context.currentTime=95;await h.audio.resume();h.audio.tickGame(musicShow());assert.equal(h.music().length,6);assert(h.music().slice(3).every(n=>n.startedAt>=95));h.audio.dispose();
});

test('late AudioContext resume cannot undo pause, cancellation permission or disposal',async()=>{
 for(const terminal of ['pause','disable','dispose']){const h=audioFixture({pendingResume:true}),unlock=h.audio.unlock();h.audio.enableBackground(true);if(terminal==='pause')h.audio.pause();else if(terminal==='disable'){h.audio.enableBackground(false);h.audio.setEnabled(false);}else h.audio.dispose();h.resolveResume();assert.equal(await unlock,terminal==='pause','unlock reports audio permission without resuming the paused programme');h.audio.tickGame(musicShow());assert.equal(h.nodes.length,0);h.audio.dispose();}
});

test('Vlampie lobby music retains the existing scene policy and needs no new Milo permission',async()=>{
 const h=audioFixture();await h.audio.unlock();h.audio.tickGame({brandId:'vlampie',scene:'lobby',paused:false});assert.equal(h.music().length,3);h.context.currentTime=2;h.audio.tickGame({brandId:'vlampie',scene:'pause',paused:false});assert.equal(h.music().length,6);h.context.currentTime=4;h.audio.tickGame({brandId:'vlampie',scene:'host',paused:false});assert.equal(h.music().length,6);h.context.currentTime=6;h.audio.tickGame({brandId:'vlampie',scene:'opening',paused:false});assert.equal(h.music().length,9);h.audio.dispose();
});

test('a late pending server commit cannot emit optional speech after its director flow is cancelled',async()=>{
 const {director:d,events}=directorFixture();let finishCommit;d.requestPick=async()=>({number:9,token:'pending'});d.requestCommit=()=>new Promise(resolve=>{finishCommit=resolve;});d.draw();d.tick(1.15);await flush();d.tick(4.3);await flush();d.cancel();finishCommit({number:9});await flush();d.tick(60);assert.equal(events.filter(e=>e.type==='numberfinished').length,0);assert.equal(events.filter(e=>e.type==='speech').length,0);assert.deepEqual(d.drawn,[]);
});
