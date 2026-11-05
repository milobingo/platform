import test from 'node:test';
import assert from 'node:assert/strict';
import {ShowDirector,chooseBingoNumber} from '../public/show-director.js';
const random={getRandomValues(word){word[0]=0;return word;}};
const make=()=>{const events=[],director=new ShowDirector({config:{voice:false,sound:false},random,onEvent:event=>events.push(event)});return {director,events};};
function finish(director){for(let i=0;i<500&&director.flow;i++)director.tick(.1);assert.equal(director.flow,null);}
function reach(director,scene){for(let i=0;i<500&&director.scene!==scene;i++)director.tick(.1);assert.equal(director.scene,scene);}

test('preview selection does not change program, draw a number, or move its camera',()=>{
 const {director:d,events}=make();d.select('draw');assert.equal(d.preview,'draw');assert.equal(d.scene,'standby');assert.equal(d.number,null);assert.equal(d.pending,null);assert.deepEqual(d.drawn,[]);assert(!events.some(e=>e.type==='camera'||e.type==='commit'));
});
test('only a completed spin publishes a result, and all 75 balls remain unique',()=>{
 const {director:d,events}=make();for(let n=1;n<=75;n++){assert.equal(d.draw(),true);reach(d,'draw');assert.equal(d.pending,n);assert.equal(d.number,n===1?null:n-1);d.tick(4.1);assert.equal(d.drawn.length,n-1);d.tick(.3);assert.equal(d.scene,'reveal');assert.equal(d.pending,null);assert.equal(d.number,n);assert.equal(d.drawn.length,n);finish(d);}
 assert.deepEqual(d.drawn,Array.from({length:75},(_,i)=>i+1));assert.equal(events.filter(e=>e.type==='commit').length,75);assert.equal(d.draw(),false);
});
test('pausing a spin retains its number and age; resuming commits exactly once',()=>{
 const {director:d}=make();d.draw();reach(d,'draw');d.tick(1.2);const age=d.flow.age,pending=d.pending;d.pause();d.tick(50);assert.equal(d.flow.age,age);assert.equal(d.pending,pending);assert.equal(d.drawn.length,0);assert.equal(d.draw(),true);finish(d);assert.deepEqual(d.drawn,[pending]);
});
test('a bingo claim suspends the spin; rejected bingo resumes that same spin',()=>{
 const {director:d}=make();d.draw();reach(d,'draw');d.tick(2);const pending=d.pending,age=d.flow.age;d.reportBingo('Sanne','VL-42');assert.equal(d.scene,'checking');d.tick(100);assert.equal(d.drawn.length,0);assert.equal(d.draw(),false);assert.equal(d.take('finale'),false);assert.equal(d.resolveBingo(false),true);reach(d,'draw');assert.equal(d.pending,pending);assert.equal(d.flow.age,age);finish(d);assert.deepEqual(d.drawn,[pending]);
});
test('a winner needs regie confirmation and approval discards an unfinished ball',()=>{
 const {director:d,events}=make();d.draw();finish(d);d.draw();reach(d,'draw');d.reportBingo('Sanne');assert.equal(d.resolveBingo(true),false);assert.equal(d.scene,'checking');assert.equal(d.resolveBingo(true,{checked:true}),true);assert.equal(d.pending,null);finish(d);assert.equal(d.lastWinner,'Sanne');assert.deepEqual(d.drawn,[1]);assert.equal(events.filter(e=>e.type==='commit').length,1);
});
test('switching away before reveal never lights an uncompleted ball',()=>{
 const {director:d}=make();d.draw();reach(d,'draw');assert.equal(d.pending,1);d.take('pause');assert.equal(d.pending,null);assert.deepEqual(d.drawn,[]);assert.equal(d.number,null);d.tick(20);assert.equal(d.scene,'pause');
});
test('a spoken number stays on screen until the actual speech finishes',()=>{
 const {director:d}=make();d.configure({voice:true});d.draw();reach(d,'reveal');d.tick(30,{voiceBusy:true});assert.equal(d.scene,'reveal');d.tick(.1,{voiceBusy:false});assert.equal(d.scene,'board');
});
test('manual camera mode suppresses subsequent automatic camera cuts',()=>{
 const {director:d,events}=make();d.configure({autoCamera:false});d.draw();finish(d);assert.equal(events.filter(e=>e.type==='camera').length,1);assert.deepEqual(d.drawn,[1]);
});
test('reveal snapshots atomically contain the committed number, never the old ball',()=>{
 let d;const seen=[];d=new ShowDirector({config:{voice:false,sound:false},random,onEvent:e=>{if(e.type==='change'||e.type==='commit')seen.push(d.visual());}});d.draw();finish(d);d.draw();finish(d);for(const view of seen.filter(v=>v.scene==='reveal'))assert.equal(view.number,view.drawnCount);
});
test('opening, round, prize and finale preserve drawn history; reset clears it',()=>{
 const {director:d}=make();d.draw();finish(d);for(const scene of ['opening','round','prize','finale']){d.take(scene);finish(d);assert.deepEqual(d.drawn,[1]);}d.reset();assert.deepEqual(d.drawn,[]);assert.equal(d.number,null);assert.equal(d.pending,null);
});
test('uniform selection rejects overflowing random values',()=>{
 let count=0;const rng={getRandomValues(word){word[0]=count++===0?4294967295:0;return word;}};assert.equal(chooseBingoNumber([],rng),1);assert.equal(count,2);assert.equal(chooseBingoNumber(Array.from({length:75},(_,i)=>i+1),rng),null);
});
