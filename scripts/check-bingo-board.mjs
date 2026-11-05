import {canvasRuntime} from './canvas-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {BINGO_BOARD,bingoBoardState,bingoBoardKey,drawBingoBoard} from '../public/bingo-board.js';
const {createCanvas}=canvasRuntime;
const flat=board=>board.rows.flat();

test('five rows of fifteen include every number once, and preview 42 is unlit',()=>{
 const board=bingoBoardState({bingoNumber:42,bingoDrawn:[]});
 assert.equal(board.rows.length,5);assert.ok(board.rows.every(row=>row.length===15));
 assert.deepEqual(flat(board).map(cell=>cell.number),Array.from({length:75},(_,i)=>i+1));
 assert.equal(flat(board).filter(cell=>cell.lit).length,0);assert.equal(board.latest,null);
});

test('pending balls stay dark; completed draws stay lit beyond the last seven',()=>{
 const drawn=[2,5,17,26,32,41,54,60,69,75];
 const board=bingoBoardState({bingoDrawn:drawn,bingoPending:13,bingoNumber:13});
 assert.deepEqual(flat(board).filter(cell=>cell.lit).map(cell=>cell.number),drawn);
 assert.equal(flat(board).find(cell=>cell.number===13).lit,false);
 assert.deepEqual(flat(board).filter(cell=>cell.latest).map(cell=>cell.number),[75]);
 const completed=bingoBoardState({bingoDrawn:[...drawn,13]});
 assert.equal(flat(completed).filter(cell=>cell.lit).length,11);assert.equal(completed.latest,13);
});

test('cache observes earlier history, full boards, reset, theme and duplicate input',()=>{
 const a=bingoBoardState({bingoDrawn:[1,2,3,4,5,6,7,8,9]});
 const b=bingoBoardState({bingoDrawn:[10,2,3,4,5,6,7,8,9]});
 assert.notEqual(bingoBoardKey(a,'showtime'),bingoBoardKey(b,'showtime'));
 assert.notEqual(bingoBoardKey(a,'showtime'),bingoBoardKey(a,'sinterklaas'));
 const full=bingoBoardState({bingoDrawn:Array.from({length:75},(_,i)=>i+1)});
 assert.equal(flat(full).filter(cell=>cell.lit).length,75);
 assert.deepEqual(bingoBoardState({bingoDrawn:[0,1,1,76,2.5,'3',75]}).drawn,[1,75]);
 assert.equal(flat(bingoBoardState({bingoDrawn:[],bingoNumber:42})).filter(cell=>cell.lit).length,0);
});

test('both board themes render all numbers and change only after a completed draw',()=>{
 for(const theme of ['showtime','sinterklaas']){
  const canvas=createCanvas(BINGO_BOARD.width,BINGO_BOARD.height),ctx=canvas.getContext('2d'),numbers=[];
  const fillText=ctx.fillText.bind(ctx);ctx.fillText=(text,...args)=>{if(/^\d+$/.test(text))numbers.push(Number(text));fillText(text,...args);};
  drawBingoBoard(ctx,bingoBoardState({bingoDrawn:[]}),theme);
  assert.deepEqual(numbers,Array.from({length:75},(_,i)=>i+1));
  const region=()=>Buffer.from(ctx.getImageData(50,65,1380,BINGO_BOARD.height-65).data),empty=region();
  drawBingoBoard(ctx,bingoBoardState({bingoDrawn:[],bingoPending:17}),theme);
  assert(empty.equals(region()),'pending draw does not reveal its number');
  drawBingoBoard(ctx,bingoBoardState({bingoDrawn:[17]}),theme);
  assert(!empty.equals(region()),'completed number illuminates');
  drawBingoBoard(ctx,bingoBoardState({bingoDrawn:[],bingoNumber:42}),theme);
  assert(empty.equals(region()),'reset restores the unlit board');
 }
});

test('only the regie owns a show director and show clocks cannot commit a result',async()=>{
 const source=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const start=source.indexOf('function advanceBingo(delta){'),end=source.indexOf("$('#draw-ball')",start);
 const fn=source.slice(start,end);
 for(const isShow of [true,false]){
  const state={bingoElapsed:4.2,bingoPending:17,bingoDrawn:[]};
  const context=vm.createContext({state,isShow});vm.runInContext(fn+'\nadvanceBingo(.2);',context);
  assert.deepEqual(state.bingoDrawn,[]);assert.equal(state.bingoPending,17);
 }
 assert.match(source,/if\(isShow\)return;\s*director=new ShowDirector/);
});
