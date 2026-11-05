import test from 'node:test';
import assert from 'node:assert/strict';
import {gameFrame,objectPose,competitionProgress,wheelRotation,gameEvents} from '../public/bingo-choreography.js';
import {MINIGAMES} from '../public/bingo-model.js';
import {createShowAudio} from '../public/show-audio.js';
const stage=(game,count=8,duration=20)=>{const entrants=Array.from({length:count},(_,i)=>({bookId:`book-${i}`,name:`Naam ${i}`,ticket:String(i+1).padStart(4,'0')}));return {type:'minigame',playId:'run-a',duration,result:{id:'result',minigame:game,entrants,winner:entrants.at(-1),prize:{title:'Verrassing'}}};};
test('every moving namechip stays inside the podium and clear of other chips, including shuffles and spinning wheels',()=>{
 for(const count of [1,2,3,4,5,6,8,10,100])for(const game of MINIGAMES){const s=stage(game.id,count);for(let age=0;age<=20;age+=.025){const f=gameFrame(s,age),poses=f.groups.map(g=>objectPose(f,g));for(const p of poses){assert(p.chipX-p.width/2>=65&&p.chipX+p.width/2<=1855,`${game.id}/${count}: horizontal bounds`);assert(p.chipY-p.height/2>=177&&p.chipY+p.height/2<=897,`${game.id}/${count}: vertical bounds`);}for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++){const a=poses[i],b=poses[j];assert(Math.abs(a.chipX-b.chipX)>=(a.width+b.width)/2||Math.abs(a.chipY-b.chipY)>=(a.height+b.height)/2,`${game.id}/${count}: overlapping ${i}/${j} at ${age}`);}}}
});
test('races have multiple overtakes, continuous forward motion, and the stored winner reaches the finish first',()=>{
 for(const game of ['horses','cookies','rockets','boats']){const s=stage(game),groups=gameFrame(s,0).groups;let leader=-1,changes=0;const previous=groups.map(()=>0);for(let i=0;i<=3000;i++){const p=i/3000,positions=groups.map(g=>competitionProgress(p,g,game));positions.forEach((position,j)=>{assert(position>=previous[j]-1e-10);assert(position-previous[j]<.003);previous[j]=position;});const index=positions.indexOf(Math.max(...positions));if(p>.05&&p<.86&&index!==leader){changes++;leader=index;}}assert(changes>=3,`${game} has ${changes} lead changes`);for(const group of groups)assert.equal(competitionProgress(1,group,game)===1,group.winning);}
});
test('unique mechanics survive seeks and snapshots: wheel target, packet permutation, rebounds, and visible elimination',()=>{
 for(const game of MINIGAMES){const s=stage(game.id),again=structuredClone(s),a=gameFrame(s,12),b=gameFrame(again,12);assert.deepEqual(a.groups.map(g=>objectPose(a,g)),b.groups.map(g=>objectPose(b,g)));assert.equal(s.result.winner.bookId,'book-7');}
 const wheel=gameFrame(stage('wheel'),20),winner=wheel.groups.findIndex(g=>g.winning),angle=wheelRotation(wheel)+(winner+.5)*Math.PI*2/wheel.groups.length;assert(Math.abs(Math.atan2(Math.sin(angle+Math.PI/2),Math.cos(angle+Math.PI/2)))<1e-9);
 const original=stage('wheel'),changed=structuredClone(original);changed.result.winner=changed.result.entrants[0];assert.equal(wheelRotation(gameFrame(original,0)),wheelRotation(gameFrame(changed,0)),'the initial sector never reveals the winning book');
 const gifts=stage('gifts',10);const start=gameFrame(gifts,2),swapped=gameFrame(gifts,8);assert.notDeepEqual(start.groups.map(g=>objectPose(start,g).x),swapped.groups.map(g=>objectPose(swapped,g).x));
 for(const game of ['balloons','disco']){const f=gameFrame(stage(game),20),poses=f.groups.map(g=>objectPose(f,g));assert.equal(poses.filter(p=>!p.out).length,1);assert.equal(poses.findIndex(p=>!p.out),f.groups.findIndex(g=>g.winning));assert(poses.every(p=>p.width>0&&Number.isFinite(p.chipY)));}
 const pin=stage('pinball'),f1=gameFrame(pin,5),f2=gameFrame(pin,7),f3=gameFrame(pin,9);const g=f1.groups[0];assert(objectPose(f2,g).y>objectPose(f1,g).y);assert(objectPose(f3,g).y<objectPose(f2,g).y);
});
test('short previews retain all action phases and game sounds scale to the same timeline',()=>{
 for(const game of MINIGAMES)for(const duration of [4,12,20]){const s=stage(game.id,6,duration),events=gameEvents(s);assert(events.every(e=>e.time>=0&&e.time<=duration));assert.equal(new Set(events.map(e=>e.id)).size,events.length);assert.equal(gameFrame(s,duration).reveal,1);const reduced=gameFrame(s,0,true);assert.deepEqual(reduced.groups.map(g=>objectPose(reduced,g)),gameFrame(s,8,true).groups.map(g=>objectPose(gameFrame(s,8,true),g)));}
});
test('game audio plays once per event, pauses immediately and does not replay old beats on seek or unmute',async()=>{
 const started=[],stopped=[];const parameter={value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},cancelScheduledValues(){},setTargetAtTime(){}};
 class Context{state='running';currentTime=0;destination={};createMediaStreamDestination(){return {stream:{getTracks:()=>[]}};}createAnalyser(){return {fftSize:256,connect(){},disconnect(){},getByteTimeDomainData(a){a.fill(128);}};}createGain(){return {gain:{...parameter},connect(){},disconnect(){}};}createOscillator(){return {frequency:{...parameter},connect(){},disconnect(){},start(time){started.push(time);},stop(time){stopped.push(time);}};}async resume(){this.state='running';}async close(){}}
 const audio=createShowAudio({Context});await audio.unlock();const s=stage('wheel'),show=age=>({scene:'minigame',age,gameStage:s,paused:false});audio.tickGame(show(0));assert.equal(started.length,1);audio.tickGame(show(0));assert.equal(started.length,1);
 audio.pause();const before=started.length;audio.tickGame({...show(.67),paused:true});assert.equal(started.length,before);assert(stopped.length>0);audio.resume();await Promise.resolve();audio.tickGame(show(.67));assert.equal(started.length,before+1);
 const next=gameEvents(s).find(e=>e.kind==='tick');audio.tickGame(show(next.time));const once=started.length;audio.tickGame(show(next.time));assert.equal(started.length,once);audio.setEnabled(false);audio.tickGame(show(17));const muted=started.length;audio.setEnabled(true);audio.tickGame(show(17));assert.equal(started.length,muted);
 audio.tickGame(show(10));assert.equal(started.length,muted);audio.tickGame({scene:'host'});audio.dispose();
});
