import test from 'node:test';
import assert from 'node:assert/strict';
import {gameGroups,motionFrame,raceProgress,GameMotionClock} from '../public/bingo-motion.js';
import {MINIGAMES} from '../public/bingo-model.js';
const stage=(game,count=100)=>{const entrants=Array.from({length:count},(_,i)=>({bookId:`book-${i}`,name:`Speler ${i}`,ticket:String(i).padStart(4,'0')}));return {type:'minigame',playId:'play-a',duration:20,result:{id:'result-a',minigame:game,entrants,winner:entrants[count-1],prize:{title:'Prijs'}}};};
test('all registered games keep every book in the same object throughout the animation',()=>{
 for(const game of MINIGAMES)for(const count of [2,6,8,12,100,400]){
  const s=stage(game.id,count),initial=gameGroups(s.result).map(g=>g.members.map(m=>m.bookId));
  assert.equal(new Set(initial.flat()).size,count);assert.equal(initial.flat().length,count);
  for(const age of [0,3.99,4.01,8,12,18.79,19.5,20,24])assert.deepEqual(motionFrame(s,age).groups.map(g=>g.members.map(m=>m.bookId)),initial);
  assert.deepEqual(gameGroups(structuredClone(s.result)).map(g=>g.members.map(m=>m.bookId)),initial);
  assert.equal(gameGroups(s.result).filter(g=>g.winning).length,1);
  // The layout does not preferentially place a winner in a particular object.
  const different=structuredClone(s.result);different.winner=different.entrants[0];assert.deepEqual(gameGroups(different).map(g=>g.members.map(m=>m.bookId)),initial);
 }
});
test('races and paths move forward continuously through the former finish jump',()=>{
 for(const seed of [0,.1,.5,.9,.999])for(const winning of [false,true]){
  let previous=0;const group={seed,winning};
  for(let i=0;i<=10000;i++){const progress=raceProgress(i/10000,group);assert(progress>=previous,`${winning}/${seed} at ${i}`);assert(progress-previous<.0002);previous=progress;}
  assert.equal(raceProgress(0,group),0);assert(winning?previous===1:previous<.92);
 }
});
test('reveal crossfades over the last 1.2 seconds and reduced motion immediately shows the winner',()=>{
 const s=stage('horses',6);assert.equal(motionFrame(s,1).run,0);assert.equal(motionFrame(s,18.8).reveal,0);
 assert(Math.abs(motionFrame(s,19.4).reveal-.5)<1e-10);assert.equal(motionFrame(s,20).reveal,1);
 assert.equal(motionFrame(s,0,true).reveal,1);assert.equal(motionFrame(s,0,true).run,1);
});
test('visual clock advances between 10 Hz snapshots, freezes for pause and resets for replay',()=>{
 const clock=new GameMotionClock(),s=stage('horses',6);let previous=-1;
 for(let i=0;i<=600;i++){const now=i*1000/60,age=Math.floor(now/100)/10,visual=clock.read({scene:'minigame',age,paused:false,gameStage:s},now);assert(visual.age>=previous);if(i>0)assert(visual.age>previous);assert(Math.abs(visual.age-now/1000)<.13);previous=visual.age;}
 const paused=clock.read({scene:'minigame',age:10,paused:true,gameStage:s},10016).age;
 assert.equal(clock.read({scene:'minigame',age:10,paused:true,gameStage:s},14000).age,paused);
 assert.equal(clock.read({scene:'minigame',age:10,paused:false,gameStage:s},14016).age,paused);
 assert(clock.read({scene:'minigame',age:10.02,paused:false,gameStage:s},14032).age>paused);
 assert.equal(clock.read({scene:'minigame',age:0,paused:false,gameStage:{...s,playId:'play-b'}},14048).age,0);
 clock.read({scene:'host',age:30},14060);assert.equal(clock.key,'');
});
