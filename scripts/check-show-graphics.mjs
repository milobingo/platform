import {canvasRuntime} from './canvas-runtime.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {VlampieStudio25D} from '../public/studio-25d.js';
import {DEFAULT_SHOW} from '../public/show-director.js';
import {createBlinkTexture,EYE_PATCHES} from '../public/blink-texture.js';
const {createCanvas,loadImage,GlobalFonts}=canvasRuntime;
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','Arial');
const out=process.argv[2]||'/workspace/scratch/3168b87d0f33/vlampie-v18-show';await fs.mkdir(out,{recursive:true});
const image=path=>loadImage(new URL('../public/'+path,import.meta.url).pathname);
const original=await image('assets/vlampie-illustrated-v10.png'),closed=await image('assets/vlampie-blink-v18.png');
const blink=createBlinkTexture(original,closed,createCanvas),face=createCanvas(1024,1536),fc=face.getContext('2d');
const compose=()=>{fc.clearRect(0,0,1024,1536);fc.drawImage(original,0,0);blink.draw(fc);return Buffer.from(fc.getImageData(0,0,1024,1536).data);};const before=compose();blink.update(1);const after=compose();let changed=0;
for(let y=0;y<1536;y++)for(let x=0;x<1024;x++){const i=(y*1024+x)*4;if(!before.subarray(i,i+4).equals(after.subarray(i,i+4))){changed++;assert(EYE_PATCHES.some(([ex,ey,w,h])=>x>=ex&&x<ex+w&&y>=ey&&y<ey+h),'only eyelid pixels may change');}}
assert(changed>1000);await fs.writeFile(`${out}/blink.png`,face.toBuffer('image/png'));blink.update(0);assert(before.equals(compose()),'open eyes restore exact original');
const canvas=createCanvas(1280,720);let rect={width:1280,height:720};canvas.getBoundingClientRect=()=>rect;
const studio=new VlampieStudio25D(canvas,{canvasFactory:createCanvas,loadImage:image,onRenderFailure:error=>{throw error;}});await studio.load();
const scenes=[['opening','establish'],['host','desk'],['draw','machine'],['reveal','machine'],['board','led'],['round','wide'],['prize','wide'],['pause','tour'],['checking','portrait'],['winner','portrait'],['audience','audience'],['finale','wide']];
for(const theme of ['showtime','sinterklaas']){
 await studio.setTheme(theme,false);const sheet=createCanvas(1920,1680),sc=sheet.getContext('2d');sc.fillStyle='#081122';sc.fillRect(0,0,1920,1680);
 for(const [i,[scene,camera]] of scenes.entries()){
  studio.setCamera(camera,false);const show={...DEFAULT_SHOW,scene,age:1.5,number:42,drawnCount:7,winner:'Sanne',claim:{name:'Sanne',card:'VL-0142'},reducedMotion:false};
  const state={motion:scene==='winner'?'cheer':'idle',age:1300,energy:65,idle:true,time:2,speaking:false,mouth:{open:0},stopped:false,lightShow:true,bingoNumber:42,bingoPending:scene==='draw'?17:null,bingoDrawn:[7,23,61,18,54,9,42],show};
  studio.render(1/30,state);assert(!studio.failed,scene);await fs.writeFile(`${out}/${theme}-${scene}.png`,canvas.toBuffer('image/png'));
  const x=i%3*640,y=Math.floor(i/3)*420;sc.drawImage(await loadImage(canvas.toBuffer('image/png')),x,y,640,360);sc.fillStyle='#e7c687';sc.font='23px Arial';sc.fillText(scene,x+20,y+395);
 }
 await fs.writeFile(`${out}/${theme}-scenes.png`,sheet.toBuffer('image/png'));
}
rect={width:390,height:219};studio.resize();studio.setCamera('machine',false);studio.render(1/30,{time:2,show:{...DEFAULT_SHOW,scene:'reveal',age:1,number:75,drawnCount:75},bingoNumber:75,bingoDrawn:[75]});await fs.writeFile(`${out}/mobile-reveal.png`,canvas.toBuffer('image/png'));
studio.dispose();console.log(JSON.stringify({themes:2,scenes:scenes.length,blinkChangedPixels:changed,identityOutsideEyes:'exact',output:out}));
