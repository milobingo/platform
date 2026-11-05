import test from 'node:test';
import assert from 'node:assert/strict';
import {createNumberGrid} from '../public/number-grid.js';

function boardHarness(){
 const document={createElement(tagName){
  const classes=new Set();return {tagName,attrs:{},classList:{toggle(name,active){if(active)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},setAttribute(name,value){this.attrs[name]=value;},removeAttribute(name){delete this.attrs[name];}};
 }};
 const element={ownerDocument:document,replaceChildren(...children){this.children=children;}};
 return {element,grid:createNumberGrid(element),called:()=>element.children.filter(cell=>cell.classList.contains('is-called')).map(cell=>Number(cell.textContent)),latest:()=>element.children.filter(cell=>cell.classList.contains('is-latest')).map(cell=>Number(cell.textContent))};
}

test('the read-only regie grid contains all 75 ordered numbers and exposes their state',()=>{
 const h=boardHarness(),board=h.grid.update({bingoDrawn:[],bingoNumber:42});
 assert.deepEqual(h.element.children.map(cell=>Number(cell.textContent)),Array.from({length:75},(_,i)=>i+1));
 assert(h.element.children.every(cell=>cell.tagName==='li'));
 assert.deepEqual(h.called(),[]);assert.deepEqual(h.latest(),[]);assert.equal(board.latest,null);
 assert.equal(h.element.children[41].attrs['aria-label'],'Nummer 42, nog niet getrokken');
});

test('a pending ball stays unlit while the full draw history and previous latest ball remain visible',()=>{
 const h=boardHarness(),drawn=[2,5,17,26,32,41,54,60,69,75];
 h.grid.update({bingoDrawn:drawn});const cells=[...h.element.children];
 const pending=h.grid.update({bingoDrawn:drawn,bingoPending:13,bingoNumber:13});
 assert.deepEqual(h.called(),drawn);assert.deepEqual(h.latest(),[75]);assert.equal(pending.latest,75);
 assert.equal(h.element.children[74].attrs['aria-current'],'true');
 h.grid.update({bingoDrawn:[...drawn,13],bingoPending:null,bingoNumber:13});
 assert.deepEqual(h.called(),[2,5,13,17,26,32,41,54,60,69,75]);assert.deepEqual(h.latest(),[13]);
 assert.equal(h.element.children[74].attrs['aria-current'],undefined);
 assert.equal(h.element.children[12].attrs['aria-label'],'Nummer 13, laatste getrokken bal');
 assert(h.element.children.every((cell,i)=>cell===cells[i]),'drawing does not rebuild the grid');
});

test('a full board and reset update the existing grid without retaining stale illumination',()=>{
 const h=boardHarness(),cells=[...h.element.children];
 h.grid.update({bingoDrawn:Array.from({length:75},(_,i)=>75-i)});
 assert.equal(h.called().length,75);assert.deepEqual(h.latest(),[1]);
 const reset=h.grid.update({bingoDrawn:[],bingoPending:null,bingoNumber:42});
 assert.deepEqual(h.called(),[]);assert.deepEqual(h.latest(),[]);assert.equal(reset.latest,null);
 assert(h.element.children.every(cell=>cell.attrs['aria-current']===undefined));
 assert(h.element.children.every((cell,i)=>cell===cells[i]));
});
