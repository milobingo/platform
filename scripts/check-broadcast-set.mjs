import test from 'node:test';
import assert from 'node:assert/strict';
import {ARENA_LAYOUT,drawBroadcastSet,drawBroadcastDesk} from '../public/mf-broadcast-set.js';

function canvasBoundary(){
 const labels=[],gradient={addColorStop(){}};
 const context=new Proxy({createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,measureText:value=>({width:String(value).length*8}),fillText(value,x,y){labels.push({value:String(value),x,y,color:this.fillStyle,font:this.font});}},{get:(o,k)=>o[k]??(()=>{})});
 return {context,labels};
}
test('Sterrenplein keeps the presenter below the title with a visible upper body and the board inside the physical desk',()=>{
 const a=ARENA_LAYOUT;
 const hostTop=a.host.y-a.host.height,visibleBody=a.desk.occlusionY-hostTop;
 assert(a.desk.width>=900);assert(a.host.height<=400,'the presenter must remain subordinate to the full-size desk');
 assert(visibleBody>=a.host.height*.6,'at least sixty percent of the rig remains visible above the desktop');
 assert(visibleBody<a.host.height,'the desk must actually occlude the lower body');
 assert(a.board.width>=630);assert(a.board.x>a.desk.x&&a.board.x+a.board.width<a.desk.x+a.desk.width);
 assert(a.board.y>a.desk.occlusionY&&a.board.y+a.board.height<a.desk.y+a.desk.height);
 assert(a.board.height>=120,'all five rows need a substantial physical display');
 assert((a.brand.bottom??a.brand.y)<hostTop,'the presenter must not cover the shown title');
});
test('scenery never invents an uncommitted last number and leaves official state untouched',()=>{
 const state={drawn:[7,13,42],lastNumber:27,pattern:{title:'Vier hoeken',cells:[0,4,20,24]}};
 const before=structuredClone(state),{context,labels}=canvasBoundary();
 drawBroadcastSet(context,{state,time:12});
 assert(!labels.some(l=>l.value==='27'),'the latest-number display must reject an uncommitted number');
 assert(labels.some(l=>l.value==='3 / 75'));
 assert.deepEqual(state,before);
 const confirmed=canvasBoundary();drawBroadcastSet(confirmed.context,{state:{...state,lastNumber:42},time:12});assert(confirmed.labels.some(l=>l.value==='42'));
});
test('the physical showdesk carries all 75 numbers in five rows, and only supplied numbers light up',()=>{
 const state={drawn:[7,13,42],lastNumber:42},before=structuredClone(state),{context,labels}=canvasBoundary();
 drawBroadcastDesk(context,{state,time:0});
 const numbers=labels.filter(l=>/^\d+$/.test(l.value));assert.equal(numbers.length,75);assert.equal(new Set(numbers.map(l=>l.x)).size,15);assert.equal(new Set(numbers.map(l=>l.y)).size,5);
 assert.deepEqual(numbers.filter(l=>l.color==='#36213c').map(l=>l.value),['42']);
 assert.deepEqual(numbers.filter(l=>l.color==='#edfff7').map(l=>l.value),['7','13']);assert.deepEqual(state,before);
});
