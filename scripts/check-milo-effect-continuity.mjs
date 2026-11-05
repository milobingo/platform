import {canvasRuntime} from './canvas-runtime.mjs';
// Consecutive-frame checks of the real effect renderers, not selected stills.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {gameFrame,objectPose} from '../public/bingo-choreography.js';
import {drawRibbonGame} from '../public/milo-ribbon-game.js';
import {drawMirrorGame,drawPotionGame,drawButterflyGame} from '../public/milo-magic-games.js';
import {magicParticleAt,seededUnit,settledMagicTime} from '../public/milo-minigame-art.js';
const {createCanvas}=canvasRuntime;

test('wrapped decorative particles disappear before relocating and never strobe',()=>{
 const options={height:100,seed:'boundary-check',strength:.6};
 for(let i=0;i<25;i++){
  const k=seededUnit(options.seed+':'+i),speed=7+k*7,start=seededUnit(options.seed+':y'+i),wrap=start*100/speed;
  const a=magicParticleAt({age:wrap-.0001,duration:120},i,options),b=magicParticleAt({age:wrap+.0001,duration:120},i,options);
  assert(a.alpha<1e-8&&b.alpha<1e-8,'Particle may not reset while visible');
  let previous=magicParticleAt({age:0,duration:120},i,options);
  for(let n=1;n<=1800;n++){
   const p=magicParticleAt({age:n/60,duration:120},i,options);
   assert(Math.abs(p.alpha-previous.alpha)<.025,'No abrupt light pulse');previous=p;
  }
 }
});

test('secondary movement eases into a held result independently of future transport time',()=>{
 const f={duration:26,age:0},before=settledMagicTime({...f,age:22.4}),next=settledMagicTime({...f,age:22.4+1/60});
 assert(next>=before&&next-before<=1/60+1e-10);
 assert.equal(settledMagicTime({...f,age:26}),settledMagicTime({...f,age:60}));
 assert.equal(settledMagicTime({...f,age:26,reduced:true}),0);
});

const ui={palettes:['#e9c587','#8fc6df','#d5a3b6','#b9afe5','#9abdaa','#dda984'],
 label(c,text,x,y,size=20,color='#fff'){c.font=`${size}px Arial`;c.textAlign='center';c.textBaseline='middle';c.fillStyle=color;c.fillText(String(text),x,y);},
 winnerHalo(c,x,y,size,reveal){c.save();c.globalAlpha*=reveal;c.strokeStyle='#ffdc9e';c.lineWidth=2;c.beginPath();c.ellipse(x,y,size,size*.8,0,0,Math.PI*2);c.stroke();c.restore();}};
const renderers={ribbons:drawRibbonGame,mirrors:drawMirrorGame,potion:drawPotionGame,butterfly:drawButterflyGame};
function stageFor(id){const entrants=Array.from({length:6},(_,i)=>({bookId:'b'+i,name:'Kind '+i,ticket:String(i+1)}));return {duration:28,result:{id:'effect-sequence-'+id,minigame:id,entrants,winner:entrants[3],prize:{title:'Verrassing'}}};}
function pixels(c){return Buffer.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);}
function render(c,stage,age){const ctx=c.getContext('2d'),f=gameFrame(stage,age);ctx.setTransform(c.width/1920,0,0,c.height/1080,0,0);ctx.fillStyle='#1b102b';ctx.fillRect(0,0,1920,1080);const poses=f.groups.map(g=>({group:g,...objectPose(f,g)}));renderers[f.game](ctx,f,{brandId:'milo'},ui,poses);return pixels(c);}
function meanLight(p){let sum=0;for(let i=0;i<p.length;i+=4)sum+=p[i]*.2126+p[i+1]*.7152+p[i+2]*.0722;return sum/(p.length/4);}

test('actual decorative renderers have stable consecutive-frame light and a quiet final tableau',()=>{
 const reports=[];
 for(const id of Object.keys(renderers)){
  const c=createCanvas(640,360),stage=stageFor(id),snapshot=structuredClone(stage);
  let light=meanLight(render(c,stage,10)),maxStep=0;
  for(let n=1;n<=90;n++){const next=meanLight(render(c,stage,10+n/60));maxStep=Math.max(maxStep,Math.abs(next-light));light=next;}
  assert(maxStep<.6,id+' has an abrupt whole-scene light change');
  const final=render(c,stage,28);
  for(let n=1;n<=12;n++)assert(final.equals(render(c,stage,28+n/30)),id+' result should be held without fluttering secondary effects');
  assert.deepEqual(stage,snapshot,'Effects may never change the saved winner');reports.push({id,sequentialFrames:91,maxMeanLuminanceStep:maxStep,final:'identical pixels'});
 }
 console.log(JSON.stringify({effects:reports}));
});
