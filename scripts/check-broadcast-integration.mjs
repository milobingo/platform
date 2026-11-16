// Actual studio/engine integration with injected DOM/canvas boundaries.
// These checks certify composition state and route isolation, not browser pixels.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {CHARACTERS} from '../server/characters.js';
import {CAMERA_PRESETS} from '../public/mf-camera.js';
import {ARENA_LAYOUT} from '../public/mf-broadcast-set.js';

const interval=globalThis.setInterval,clear=globalThis.clearInterval;
globalThis.setInterval=()=>0;globalThis.clearInterval=()=>{};
globalThis.location={origin:'https://studio.example',pathname:'/'};
const values=new Map();
globalThis.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
globalThis.sessionStorage={getItem:()=>null,setItem(){}};
globalThis.BroadcastChannel=class{postMessage(){}close(){}};
globalThis.fetch=async path=>Response.json(path==='/api/auth/session'?{authenticated:true,role:'regie',localAvailable:true}:path==='/api/bingo/games'?{games:[]}:path==='/api/characters'?{characters:Object.values(CHARACTERS),revision:0}:path==='/api/openai/status'?{configured:false}:{});
const gradient={addColorStop(){}};
function context(){return new Proxy({measureText:s=>({width:String(s).length*8}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},{get:(o,k)=>o[k]??(()=>{})});}
class Surface{
 constructor(tag){this.tagName=tag;this.children=[];this.className='';this.hidden=false;this.width=0;this.height=0;this.ctx=context();}
 append(...nodes){this.children.push(...nodes);}appendChild(node){this.children.push(node);}setAttribute(){}remove(){}dispatchEvent(){}
 getContext(){return this.ctx;}getBoundingClientRect(){return {width:1920,height:1080};}
}
globalThis.document={body:{dataset:{brand:'milo'},classList:{contains:()=>false}},createElement:tag=>new Surface(tag)};
globalThis.window={devicePixelRatio:1,addEventListener(){},removeEventListener(){}};
// Bitmap loading is manually controlled. No test makes network/media calls.
const imageRequests=[];
globalThis.Image=class{
 constructor(){this.width=1672;this.height=941;this.complete=false;}
 set src(value){this._src=value;imageRequests.push(this);}
 get src(){return this._src;}
 settle(ok=true){this.complete=true;this.settled=true;(ok?this.onload:this.onerror)?.();}
};
globalThis.CustomEvent=class{};
let nextFrame;
globalThis.requestAnimationFrame=callback=>{nextFrame=callback;return 1;};
globalThis.cancelAnimationFrame=()=>{};
const {mountStudio}=await import('../public/mf-studio.js');
const {StudioEngine}=await import('../frontend/engine.js');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
after(()=>{globalThis.setInterval=interval;globalThis.clearInterval=clear;});

test('preview remains a fixed reference and never takes its selected shot on air before TAKE',async()=>{
 const e=new StudioEngine();await turn();
 try{
  e.director.paused=true;e.camera='wide';e.cameraTransition='smooth';e.cameraDuration=2200;
  e.game.state.drawn=[7,27,42];const before=structuredClone(e.game.state);
  e.setCamera('portrait',false);
  assert.equal(e.stage().camera,'wide');assert.equal(e.stage().cameraDuration,2200);assert.equal(e.stage().cameraTransition,'smooth');
  const preview=e.previewStage();assert.equal(preview.camera,'portrait');assert.equal(preview.movingCamera,false);assert.equal(preview.cameraTransition,'cut');
  await e.takeScene();assert.equal(e.stage().camera,'portrait');assert.deepEqual(e.game.state,before);
 }finally{e.dispose();}
});

test('a deliberately selected shot reframes a paused studio, while pausing an existing move freezes its exact frame',()=>{
 const studio=mountStudio(new Surface('div'),{state:{camera:'wide',movingCamera:false,paused:true,showRoundTitle:false}});
 let clock=100;
 const frames=(count=1)=>{for(let i=0;i<count;i++){clock+=40;nextFrame(clock);}};
 try{
  frames();assert.equal(studio.snapshot().camera.scale,CAMERA_PRESETS.wide.scale);
  studio.update({camera:'portrait'});frames();assert.equal(studio.snapshot().camera.scale,CAMERA_PRESETS.portrait.scale);
  studio.update({camera:'host',paused:false,cameraDuration:2200,cameraTransition:'smooth'});frames(20);
  const moving=studio.snapshot().camera;assert(moving.transitioning);assert(moving.scale>CAMERA_PRESETS.host.scale&&moving.scale<CAMERA_PRESETS.portrait.scale);
  studio.update({camera:'host',paused:true});frames(20);assert.deepEqual(studio.snapshot().camera,moving,'Pause must not finish, restart or jump an unchanged shot');
  studio.update({camera:'host',paused:false});frames(50);assert.equal(studio.snapshot().camera.scale,CAMERA_PRESETS.host.scale);assert.equal(studio.snapshot().camera.transitioning,false);
  studio.update({camera:'machine',paused:true});frames();assert.equal(studio.snapshot().camera.id,'board');
  assert(studio.snapshot().deskBoard.top>=0&&studio.snapshot().deskBoard.bottom<=1080);
 }finally{studio.destroy();}
});

test('the integrated Sterrenplein uses the smaller presenter and a readable five-row desk without altering official history',()=>{
 const drawn=[1,7,27,42,75],state={camera:'board',movingCamera:false,paused:true,drawn,lastNumber:42,showRoundTitle:false};
 const studio=mountStudio(new Surface('div'),{state});
 try{
  nextFrame(100);const snapshot=studio.snapshot();
  assert.equal(snapshot.studio,'sterrenplein-grand');assert(snapshot.presenterLayout.height<=400);assert.equal(snapshot.presenterLayout.height,ARENA_LAYOUT.host.height);
  assert.equal(snapshot.camera.scale,CAMERA_PRESETS.board.scale);assert(snapshot.deskBoard.bottom-snapshot.deskBoard.top>=200);
  assert.deepEqual(snapshot.state.drawn,drawn);assert.deepEqual(drawn,[1,7,27,42,75]);assert.equal(snapshot.state.lastNumber,42);
 }finally{studio.destroy();}
});

test('captions remain clear of the physical number board in every selectable shot',()=>{
 const studio=mountStudio(new Surface('div'),{state:{hostId:'milo',camera:'wide',movingCamera:false,paused:true,speaking:true,showRoundTitle:false,drawn:[7,27,42],lastNumber:42,caption:'Hallo lieve spelers! Alle getrokken nummers blijven op de desk staan. Neem rustig de tijd om je kaart bij te werken. De show gaat zo weer verder en iedereen kan meedoen.'}});
 try{
  let clock=100;
  for(const id of Object.keys(CAMERA_PRESETS)){
   studio.update({camera:id});nextFrame(clock+=40);
   const snapshot=studio.snapshot(),caption=snapshot.caption,board=snapshot.deskBoard;
   assert(caption,`A speaking presenter needs a caption in ${id}`);
   assert(caption.top>=0&&caption.bottom<=1080,`Captions must fit within ${id}`);
   if(board.top>=0&&board.top<1080)assert(caption.top>=board.bottom+8||caption.bottom<=board.top-8,`Captions cover the number board in ${id}`);
  }
 }finally{studio.destroy();}
});

test('a pending or partially loaded scenic asset is not advertised as a ready studio',async()=>{
 const start=imageRequests.length,{mountStudio:freshMount}=await import('../public/mf-studio.js?asset-test=success');
 let ready=0;
 const studio=freshMount(new Surface('div'),{onReady(){ready++;},state:{movingCamera:false,showRoundTitle:false}});
 try{
  await turn();
  const requests=imageRequests.slice(start),room=requests.find(i=>i.src.includes('sterrenplein-grand-room')),desk=requests.find(i=>i.src.includes('sterrenplein-grand-desk'));
  assert(room&&desk,'Both final room and physical desk assets must be requested');
  assert.equal(studio.snapshot().ready,false);assert.equal(ready,0);
  room.settle();await turn();assert.equal(studio.snapshot().ready,false);assert.equal(ready,0);
  desk.settle();await turn();assert.equal(studio.snapshot().ready,true);assert.equal(ready,1);
 }finally{studio.destroy();}
});

test('a failed scenic image keeps the studio unavailable and reports the failure',async()=>{
 const start=imageRequests.length,{mountStudio:freshMount}=await import('../public/mf-studio.js?asset-test=failure');
 let ready=0;const errors=[];
 const studio=freshMount(new Surface('div'),{onReady(){ready++;},onAssetError(...error){errors.push(error);},state:{movingCamera:false,showRoundTitle:false}});
 try{
  await turn();
  const requests=imageRequests.slice(start),room=requests.find(i=>i.src.includes('sterrenplein-grand-room')),desk=requests.find(i=>i.src.includes('sterrenplein-grand-desk'));
  assert(room&&desk);room.settle(false);desk.settle();await turn();
  assert.equal(studio.snapshot().ready,false);assert.equal(ready,0);assert(errors.length>0,'Asset loading failure must be surfaced to the caller');
 }finally{studio.destroy();}
});

test('finishing an image load after unmount cannot revive the studio or notify readiness',async()=>{
 const start=imageRequests.length,{mountStudio:freshMount}=await import('../public/mf-studio.js?asset-test=unmounted');
 let ready=0;
 const studio=freshMount(new Surface('div'),{onReady(){ready++;},state:{movingCamera:false,showRoundTitle:false}});
 await turn();
 const requests=imageRequests.slice(start),room=requests.find(i=>i.src.includes('sterrenplein-grand-room')),desk=requests.find(i=>i.src.includes('sterrenplein-grand-desk'));
 assert(room&&desk);studio.destroy();room.settle();desk.settle();await turn();
 assert.equal(ready,0);assert.equal(studio.snapshot().ready,false);
});
