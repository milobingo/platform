import test from 'node:test';
import assert from 'node:assert/strict';
import {deskBoardCells,drawDeskNumberBoard,DESK_BOARD} from '../public/mf-desk-board.js';

test('desk shows all 75 numbers in five rows of fifteen and only highlights committed balls',()=>{
 const drawn=[1,15,16,42,75,42,0,76,-1,NaN,'7'],before=[...drawn];
 const cells=deskBoardCells(drawn,27);
 assert.equal(cells.length,75);assert.equal(new Set(cells.map(c=>c.number)).size,75);
 for(let row=0;row<5;row++)assert.deepEqual(cells.filter(c=>c.row===row).map(c=>c.number),Array.from({length:15},(_,i)=>row*15+i+1));
 assert.deepEqual(cells.filter(c=>c.drawn).map(c=>c.number),[1,15,16,42,75]);
 assert(!cells.some(c=>c.last),'A reserved/stale lastNumber must never illuminate an uncommitted ball');
 assert.deepEqual(deskBoardCells(drawn,42).filter(c=>c.last).map(c=>c.number),[42]);
 assert.deepEqual(drawn,before,'Displaying the board must not mutate official draw order');
 assert(!deskBoardCells(null,42).some(c=>c.drawn||c.last));
});

test('actual desk paint contains 75 readable labels within the desk and one last-ball accent',()=>{
 const labels=[],gradient={addColorStop(){}};
 const ctx=new Proxy({createLinearGradient:()=>gradient,fillText(value,x,y){labels.push({value:String(value),x,y,color:this.fillStyle});}},{get:(o,k)=>o[k]??(()=>{})});
 drawDeskNumberBoard(ctx,[7,13,27,42],27);
 const numbers=labels.filter(l=>/^\d+$/.test(l.value));
 assert.equal(numbers.length,75);assert.equal(new Set(numbers.map(l=>l.x)).size,15);assert.equal(new Set(numbers.map(l=>l.y)).size,5);
 for(const label of numbers){assert(label.x>DESK_BOARD.x&&label.x<DESK_BOARD.x+DESK_BOARD.width);assert(label.y>DESK_BOARD.y&&label.y<DESK_BOARD.y+DESK_BOARD.height);}
 assert.deepEqual(numbers.filter(l=>l.color==='#36213c').map(l=>l.value),['27']);
 assert.deepEqual(numbers.filter(l=>l.color==='#edfff7').map(l=>l.value),['7','13','42']);
 assert(labels.some(l=>l.value==='4 / 75'));
});
