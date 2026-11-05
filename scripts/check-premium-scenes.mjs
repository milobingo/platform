import {canvasRuntime} from './canvas-runtime.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {VlampieStudio25D} from '../public/studio-25d.js';
import {DEFAULT_SHOW} from '../public/show-director.js';
const {createCanvas,loadImage,GlobalFonts}=canvasRuntime;
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','Arial');
const out='/workspace/scratch/3168b87d0f33/premium-scenes';await fs.mkdir(out,{recursive:true});
const canvas=createCanvas(1280,720);canvas.getBoundingClientRect=()=>({width:1280,height:720});const studio=new VlampieStudio25D(canvas,{canvasFactory:createCanvas,loadImage:path=>loadImage(new URL('../public/'+path,import.meta.url).pathname),onRenderFailure:error=>{throw error;}});await studio.load();await studio.setTheme('sinterklaas',false);studio.setCamera('wide',false);
let presenterDraws=0;const drawPresenter=studio.illustrated.draw;studio.illustrated.draw=function(...args){presenterDraws++;return drawPresenter.apply(this,args);};
const show=(game,count,age)=>{const entrants=Array.from({length:count},(_,i)=>({bookId:'book-'+i,name:['Mila','Daan','Sanne','Nick','Lisa','Sophie','Lucas','Noor'][i%8],ticket:String(i+1).padStart(4,'0')}));return {...DEFAULT_SHOW,scene:'minigame',age,gameStage:{type:'minigame',result:{id:game,minigame:game,entrants,winner:entrants[2],prize:{title:'Het verrassingspakket'}},duration:20}};};
for(const [game,count,age] of [['horses',8,5],['horses',6,20],['wheel',8,9],['gifts',6,9],['pinball',8,9]]){
 studio.render(1/60,{time:age,motion:'welcome',show:show(game,count,age),bingoDrawn:[]});assert(!studio.failed);const png=canvas.toBuffer('image/png');assert(png.length>10000);await fs.writeFile(`${out}/${game}-${count}-${age}.png`,png);
}
assert.equal(presenterDraws,0,'the hidden presenter is not drawn underneath a minigame');const before=studio.frameCount,times=[],state={time:10,motion:'idle',show:show('horses',8,10)};
for(let i=0;i<60;i++){state.show.age=10+i/60;const start=performance.now();studio.render(1/60,state);times.push(performance.now()-start);}assert.equal(studio.frameCount-before,60,'each 60 Hz animation frame is rendered');
state.show.reducedMotion=true;state.show.age=0;studio.render(1/60,state);const reduced=Buffer.from(studio.ctx.getImageData(0,0,1280,720).data);state.show.age=8;studio.render(1/60,state);assert(reduced.equals(Buffer.from(studio.ctx.getImageData(0,0,1280,720).data)),'reduced motion holds the revealed scene');
studio.dispose();times.sort((a,b)=>a-b);console.log(JSON.stringify({frames:65,cadence:'60 Hz',hiddenPresenterDraws:presenterDraws,reducedMotion:'exact pixels',medianMs:times[30],p95Ms:times[57],output:out}));
