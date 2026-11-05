import {canvasRuntime} from './canvas-runtime.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {VlampieStudio25D,SHOTS} from '../public/studio-25d.js';
import {createMouthTexture,MOUTH_PATCH} from '../public/mouth-texture.js';
const {createCanvas,loadImage,GlobalFonts}=canvasRuntime;
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','Arial');
const out=process.argv[2]||'/workspace/scratch/3168b87d0f33/vlampie-v13-qa';await fs.mkdir(out,{recursive:true});
const image=p=>loadImage(new URL('../public/'+p,import.meta.url).pathname);
const original=await image('assets/vlampie-illustrated-v10.png'),mouth=await image('assets/vlampie-mouth-open-v12.png');
const texture=createMouthTexture(original,mouth,createCanvas);
const composite=createCanvas(1024,1536),cc=composite.getContext('2d');const compose=()=>{cc.clearRect(0,0,1024,1536);cc.drawImage(original,0,0);texture.draw(cc);return Buffer.from(cc.getImageData(0,0,1024,1536).data);};const base=compose();
texture.update({open:1},1,true);const opened=compose();
let changed=0;for(let y=0;y<1536;y++)for(let x=0;x<1024;x++){const i=(y*1024+x)*4;if(!base.subarray(i,i+4).equals(opened.subarray(i,i+4))){changed++;assert(x>=429&&x<595&&y>=366&&y<476,'only mouth patch changes');}}
assert(changed>1000,'mouth visibly opens');texture.update({open:1},1/30,false);assert(base.equals(compose()),'stop restores exact original');
texture.update({open:.65,round:0},1,true);const broad=compose();texture.update({open:.65,round:1},1,true);assert(!broad.equals(compose()),'round and broad vowels have different visible shapes');
const faceSheet=createCanvas(1000,300),f=faceSheet.getContext('2d');f.fillStyle='#102140';f.fillRect(0,0,1000,300);
for(const [i,amount] of [0,.3,.65,1].entries()){texture.update({open:amount},1,amount>0);compose();const copy=await loadImage(composite.toBuffer('image/png'));f.drawImage(copy,390,295,240,200,i*250,0,250,260);f.fillStyle='white';f.font='18px Arial';f.fillText(String(amount),i*250+20,284);}
await fs.writeFile(`${out}/mouth-detail.png`,faceSheet.toBuffer('image/png'));
const canvas=createCanvas(1280,720);canvas.getBoundingClientRect=()=>({width:1280,height:720});
let release;const gate=new Promise(r=>{release=r;});let block=false;
const studio=new VlampieStudio25D(canvas,{canvasFactory:createCanvas,loadImage:async p=>{if(block&&p.includes('sinterklaas'))await gate;return image(p);}});
await studio.load();assert(studio.mouthAvailable);block=true;
const first=studio.setTheme('sinterklaas',false);await studio.setTheme('showtime',false);release();assert.equal(await first,false,'old theme request ignored');assert.equal(studio.theme,'showtime');
await studio.setTheme('sinterklaas',false);assert.equal(studio.theme,'sinterklaas');
assert(studio.images.gifts&&studio.images.biscuits,'festive floor props loaded');
const state={motion:'idle',age:0,energy:65,idle:false,time:2,speaking:true,mouth:{open:.75,round:0},stopped:false,lightShow:false,bingoNumber:42,bingoPending:null,bingoElapsed:9,bingoDrawn:[7,23,61,18,54,9,42]};
const contact=createCanvas(1920,1260),c=contact.getContext('2d');c.fillStyle='#081020';c.fillRect(0,0,1920,1260);
for(const [i,shot] of Object.keys(SHOTS).entries()){
 studio.setCamera(shot,false);for(let j=0;j<5;j++)studio.render(1/30,state);
 assert(!studio.failed);const png=canvas.toBuffer('image/png');await fs.writeFile(`${out}/sinterklaas-${shot}.png`,png);
 const x=i%3*640,y=Math.floor(i/3)*420;c.drawImage(await loadImage(png),x,y,640,360);c.fillStyle='#e6c77a';c.font='24px Arial';c.fillText(shot,x+20,y+393);
}
await fs.writeFile(`${out}/sinterklaas-shots.png`,contact.toBuffer('image/png'));
studio.setCamera('portrait',false);studio.render(1/30,state);const talking=canvas.toBuffer('image/png');studio.render(1/30,{...state,speaking:false,mouth:{open:0},stopped:true});assert(!talking.equals(canvas.toBuffer('image/png')),'renderer mouth changes when stop closes');assert.equal(studio.illustrated.mouthTexture.opening,0);
await studio.setTheme('showtime',false);studio.render(1/30,{...state,speaking:false});assert.equal(studio.theme,'showtime');
studio.dispose();console.log(JSON.stringify({mouthPatchPixelsChanged:changed,identityOutsideMouth:'exact',speechStop:'original restored',themeRace:'last selection wins',themes:2,shots:9}));
