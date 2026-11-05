import {canvasRuntime} from './canvas-runtime.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {VlampieStudio25D,SHOTS} from '../public/studio-25d.js';
const {createCanvas,loadImage,GlobalFonts}=canvasRuntime;
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','Arial');
const out=process.argv[2]||'/workspace/scratch/159666656eb7/studio25d-v11/qa';
await fs.mkdir(out,{recursive:true});
const canvas=createCanvas(1280,720);let rect={width:1280,height:720};canvas.getBoundingClientRect=()=>rect;
const studio=new VlampieStudio25D(canvas,{canvasFactory:createCanvas,loadImage:p=>loadImage(new URL('../public/'+p,import.meta.url).pathname),onRenderFailure:e=>{throw e;}});
await studio.load();
const state={motion:'idle',age:0,energy:65,idle:true,time:2,speaking:false,stopped:false,lightShow:true,bingoNumber:42,bingoPending:null,bingoElapsed:9,bingoDrawn:[7,23,61,18,54,9,42]};
const contact=createCanvas(1920,1260),c=contact.getContext('2d');c.fillStyle='#081020';c.fillRect(0,0,1920,1260);
const times=[];
for(const [i,shot] of Object.keys(SHOTS).entries()){
 studio.setCamera(shot,false);
 for(let frame=0;frame<15;frame++){const start=performance.now();studio.render(1/30,{...state,time:2+frame/30});times.push(performance.now()-start);}
 assert(!studio.failed,shot+' renders');
 const pixels=studio.ctx.getImageData(0,0,1280,720).data;
 // Dark LED pixels are intentional; detect uncovered clear-color pixels instead.
 let covered=0;for(let j=0;j<pixels.length;j+=16)if(pixels[j+3]===255&&(pixels[j]!==4||pixels[j+1]!==10||pixels[j+2]!==24))covered++;
 assert(covered>1280*720/4*.99,shot+' covers frame');
 await fs.writeFile(`${out}/${shot}.png`,canvas.toBuffer('image/png'));
 const x=i%3*640,y=Math.floor(i/3)*420;c.drawImage(await loadImage(canvas.toBuffer('image/png')),x,y,640,360);c.fillStyle='#e6c77a';c.font='24px sans-serif';c.fillText(shot,x+20,y+393);
}
await fs.writeFile(`${out}/shots.png`,contact.toBuffer('image/png'));
studio.setCamera('desk',false);studio.render(1/30,state);
const before=Buffer.from(studio.ctx.getImageData(0,0,1280,720).data);
for(let i=0;i<10;i++)studio.render(1/30,{...state,stopped:true,time:7+i});
assert(before.equals(Buffer.from(studio.ctx.getImageData(0,0,1280,720).data)),'pause holds exact scene');
studio.setCamera('machine',false);studio.render(1/30,{...state,bingoPending:52});await fs.writeFile(`${out}/machine-drawing.png`,canvas.toBuffer('image/png'));
const pending=Buffer.from(studio.ctx.getImageData(0,0,1280,720).data);studio.render(1/30,{...state,time:3,bingoPending:52});assert(!pending.equals(Buffer.from(studio.ctx.getImageData(0,0,1280,720).data)),'balls rotate');
studio.setCamera('wide',true);for(let i=0;i<18;i++)studio.render(1/30,{...state,time:3+i/30});assert(studio.transitionAge>=.5,'transition completes');
studio.setCamera('portrait',true);for(let i=0;i<18;i++)studio.render(1/30,{...state,stopped:true});assert(studio.transitionAge>=.5,'camera transitions while performer paused');
rect={width:390,height:219};studio.resize();assert.equal(canvas.width,1280,'resize queued');studio.render(1/30,state);assert.equal(canvas.width,390,'resize applied at frame');await fs.writeFile(`${out}/mobile.png`,canvas.toBuffer('image/png'));
rect={width:390,height:844};studio.resize();studio.render(1/30,state);await fs.writeFile(`${out}/portrait-fullscreen.png`,canvas.toBuffer('image/png'));
studio.setBackground('transparent');studio.render(1/30,state);const alpha=studio.ctx.getImageData(0,0,1,1).data[3];assert.equal(alpha,0,'overlay transparent');
studio.setBackground('blue');studio.render(1/30,state);assert.equal(studio.ctx.getImageData(190,422,1,1).data[3],255,'blue opaque');
studio.dispose();times.sort((a,b)=>a-b);console.log(JSON.stringify({shots:Object.keys(SHOTS).length,pause:'exact pixels',balls:'animated',resize:'queued',overlay:'transparent',medianMs:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],output:out}));
