import {canvasRuntime} from './canvas-runtime.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {VlampieStudio25D} from '../public/studio-25d.js';
import {DEFAULT_SHOW} from '../public/show-director.js';
const {createCanvas,loadImage}=canvasRuntime;
const out=process.argv[2]||'/tmp/vlampie-finale-check';await fs.mkdir(out,{recursive:true});
const canvas=createCanvas(1280,720);canvas.getBoundingClientRect=()=>({width:1280,height:720});
const studio=new VlampieStudio25D(canvas,{canvasFactory:createCanvas,loadImage:p=>loadImage(new URL('../public/'+p,import.meta.url).pathname),onRenderFailure:e=>{throw e;}});await studio.load();
const mask=createCanvas(1280,720),mc=mask.getContext('2d'),draw=studio.illustrated.draw.bind(studio.illustrated),audience=studio.drawAudienceReaction.bind(studio);let capture=false,simulateOldLayer=false;
studio.drawAudienceReaction=(...args)=>{if(!simulateOldLayer)audience(...args);};
studio.illustrated.draw=(ctx,placement,state,delta)=>{
 draw(ctx,placement,state,delta);
 if(capture){mc.save();mc.setTransform(ctx.getTransform());draw(mc,placement,state,0);mc.restore();}
 if(simulateOldLayer&&state.show.audience)audience(ctx,'master',state,studio.images.master);
};
const results=[];
for(const theme of ['showtime','sinterklaas']){
 await studio.setTheme(theme,false);
 for(const camera of ['wide','front']){
  studio.setCamera(camera,false);
  const state={motion:'cheer',age:1300,energy:65,idle:false,time:2,speaking:false,mouth:{open:0},lightShow:false,bingoNumber:42,bingoDrawn:[7,42],show:{...DEFAULT_SHOW,scene:'finale',age:1.3,number:42,audience:false}};
  for(let i=0;i<20;i++)studio.render(1/30,state);
  mc.clearRect(0,0,1280,720);capture=true;studio.render(1/30,{...state,stopped:true});capture=false;
  const before=Buffer.from(studio.ctx.getImageData(0,0,1280,720).data),host=mc.getImageData(0,0,1280,720).data;
  studio.render(1/30,{...state,stopped:true,show:{...state.show,audience:true}});
  const after=Buffer.from(studio.ctx.getImageData(0,0,1280,720).data);let hostPixels=0,hostChanges=0,backgroundChanges=0;
  // Original art is slightly translucent (alpha 250–253). Allow its intended
  // background transmission while detecting any audience painted over it.
  for(let i=0;i<before.length;i+=4){const changed=!before.subarray(i,i+4).equals(after.subarray(i,i+4));if(host[i+3]>=250){hostPixels++;if([0,1,2].some(c=>Math.abs(before[i+c]-after[i+c])>6))hostChanges++;}else if(changed)backgroundChanges++;}
  assert(hostPixels>5000,'the test captures Vlampie’s opaque silhouette');assert.equal(hostChanges,0,'audience reaction must not repaint Vlampie’s hands or body');assert(backgroundChanges>100,'the audience effect still runs');
  await fs.writeFile(`${out}/${theme}-${camera}-finale.png`,canvas.toBuffer('image/png'));
  simulateOldLayer=true;studio.render(1/30,{...state,stopped:true,show:{...state.show,audience:true}});simulateOldLayer=false;
  const old=studio.ctx.getImageData(0,0,1280,720).data;let oldHostChanges=0;for(let i=0;i<before.length;i+=4)if(host[i+3]>=250&&[0,1,2].some(c=>Math.abs(before[i+c]-old[i+c])>6))oldHostChanges++;
  assert(oldHostChanges>50,'the regression check detects the original arm occlusion');results.push({theme,camera,hostPixels,hostChanges,backgroundChanges,oldHostChanges});
 }
}
studio.dispose();console.log(JSON.stringify({results,output:out}));
