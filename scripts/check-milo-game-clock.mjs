// Exercise the real mountStudio/frame loop, intercepting only the final graphics
// call to inspect the exact age it receives. No browser, assets or providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const moduleUrl=new URL('../public/mf-studio.js',import.meta.url);
let source=await readFile(moduleUrl,'utf8');
const graphicsImport="import {drawShowGraphics} from './show-graphics.js';";
assert(source.includes(graphicsImport),'The test must intercept the actual graphics boundary');
source=source.replace(graphicsImport,"const drawShowGraphics=(ctx,{show})=>globalThis.__miloClockDraw(show);");
source=source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_,quote,url)=>`from '${new URL(url,moduleUrl).href}'`);
const {mountStudio}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

function makeShow(id){
 const entrants=Array.from({length:6},(_,i)=>({bookId:'book-'+i,name:'Kind '+i,ticket:String(i+1).padStart(4,'0')}));
 return {scene:'minigame',sceneRevision:1000,age:7.5,paused:false,transition:'cut',gameStage:{type:'minigame',playId:'clock-'+id,duration:30,result:{id:'result-'+id,minigame:id,entrants,winner:entrants[4],prize:{title:'Verrassing'}}}};
}

async function harness(show,work){
 const keys=['document','window','Image','fetch','requestAnimationFrame','cancelAnimationFrame','CustomEvent','ResizeObserver','__miloClockDraw'];
 const originals=Object.fromEntries(keys.map(k=>[k,globalThis[k]])),draws=[];
 const gradient={addColorStop(){}};
 const context=()=>new Proxy({measureText:s=>({width:String(s).length*8}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},{get:(o,k)=>o[k]??(()=>{})});
 class Surface{
  constructor(){this.children=[];this.width=0;this.height=0;this.ctx=context();}
  append(...nodes){this.children.push(...nodes);}appendChild(node){this.children.push(node);}
  setAttribute(){}remove(){}dispatchEvent(){}getContext(){return this.ctx;}getBoundingClientRect(){return {width:1280,height:720};}
 }
 globalThis.document={createElement:()=>new Surface()};
 globalThis.window={devicePixelRatio:1,addEventListener(){},removeEventListener(){}};
 globalThis.Image=class{set src(_){} };globalThis.fetch=async()=>({ok:true,json:async()=>({})});globalThis.CustomEvent=class{};globalThis.ResizeObserver=undefined;
 let nextFrame,now=100,cancelled=false;
 globalThis.requestAnimationFrame=fn=>{nextFrame=fn;return 1;};globalThis.cancelAnimationFrame=()=>{cancelled=true;};
 globalThis.__miloClockDraw=visual=>draws.push({age:visual.age,playId:visual.gameStage?.playId,result:visual.gameStage?.result});
 let studio;
 try{
  studio=mountStudio(new Surface(),{state:{show,movingCamera:false,paused:false,blink:false}});
  const frame=(count=1)=>{for(let i=0;i<count;i++){nextFrame(now);now+=1000/60;}return draws.at(-1);};
  await work({studio,draws,frame});
 }finally{
  studio?.destroy();assert(cancelled,'Unmount cancels the actual frame loop');
  for(const key of keys)originals[key]===undefined?delete globalThis[key]:globalThis[key]=originals[key];
 }
}

test('all five Milo scenes keep a one-second visual clock above repeated 100 ms output snapshots',async()=>{
 for(const id of ['plingo','ribbons','mirrors','potion','butterfly']){
  const show=makeShow(id),original=structuredClone(show);
  await harness(show,({studio,draws,frame})=>{
   frame();const start=draws.at(-1).age;
   for(let i=1;i<=120;i++){
    if(i%6===0)studio.update({show:structuredClone(show)});
    frame();
   }
   for(let i=1;i<draws.length;i++)assert(draws[i].age>=draws[i-1].age-1e-9,id+' rewound at frame '+i);
   const elapsed=draws.at(-1).age-start;
   assert(Math.abs(elapsed-2)<.035,id+' repeated snapshots changed the real-time rate: '+elapsed);
   assert.equal(draws.at(-1).result.winner.bookId,original.gameStage.result.winner.bookId);
   assert.deepEqual(show,original,'The renderer never edits the result or its source snapshot');
  });
 }
});

test('older packets cannot rewind the same play, while new plays and explicit paused seeks reset exactly',async()=>{
 const show=makeShow('plingo');
 await harness(show,({studio,draws,frame})=>{
  frame(30);const advanced=draws.at(-1).age;
  studio.update({show:{...show,age:6.9}});frame();assert(draws.at(-1).age>=advanced,'An older source packet rewound the reveal');
  studio.update({show:{...show,age:7.8}});frame();assert(draws.at(-1).age>=advanced,'A delayed newer source value rewound the reveal');
  const replacement={...show,age:1.25,gameStage:{...show.gameStage,playId:'new-explicit-play'}};
  studio.update({show:replacement});frame();assert(Math.abs(draws.at(-1).age-1.25)<.035,'A new play must start from its supplied age');
  const seek={...replacement,paused:true,age:3.125,seekRevision:1};
  studio.update({paused:true,show:seek});frame();assert.equal(draws.at(-1).age,3.125,'Explicit paused seek must be exact');
  studio.update({show:{...seek,age:2.875,seekRevision:2}});frame();assert.equal(draws.at(-1).age,2.875,'Backwards explicit seek must not be mistaken for a stale packet');
  frame(18);assert.equal(draws.at(-1).age,2.875,'The sought frame must remain frozen');
 });
});

test('actual studio minigame age freezes on pause and resumes without a catch-up jump',async()=>{
 const show=makeShow('butterfly');
 await harness(show,({studio,draws,frame})=>{
  frame(20);
  const pause={...show,age:draws.at(-1).age,paused:true};
  studio.update({paused:true,show:pause});frame();const held=draws.at(-1).age;
  for(let i=0;i<30;i++){if(i%6===0)studio.update({show:{...pause}});frame();assert.equal(draws.at(-1).age,held);}
  studio.update({paused:false,show:{...pause,paused:false}});frame();const resumed=draws.at(-1).age;
  assert(resumed>=held&&resumed-held<.04,'Resume must not include time spent paused');
  frame(60);assert(Math.abs(draws.at(-1).age-resumed-1)<.035,'Resume must continue at normal speed');
 });
});
