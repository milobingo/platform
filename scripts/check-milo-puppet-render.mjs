// Pixel-level QA of the real Milo Canvas puppet. No browser, provider or game server.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {canvasRuntime} from './canvas-runtime.mjs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {motionEnvelope} from '../public/mf-show-effects.js';
import {MOTION_CUES} from '../server/show-cues.js';
import {ARENA_LAYOUT,STUDIO_ART,drawBroadcastSet,drawBroadcastDesk} from '../public/mf-broadcast-set.js';
import {CAMERA_PRESETS} from '../public/mf-camera.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const {createCanvas,loadImage,GlobalFonts}=canvasRuntime;
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','Trebuchet MS');
export const DEFAULT_OUT=process.env.MILO_RENDER_QA_DIR||resolve(process.env.TMPDIR||'/tmp','milo-puppet-qa');
export const samples=[
 ['Rust / ademhaling','idle',1.8],['Zwaaien · omhoog','wave',1.1],['Zwaaien · pols','wave',2.4],['Aanwijzen','point',1.8],
 ['Juichen','cheer',1.6],['Nadenken','think',2],['Applaus · contact','clap',Math.PI*3/5.6],['Applaus · open','clap',Math.PI*4/5.6],
 ['Dansje','dance',1.3],['Buiging','bow',2],['Verwondering','surprise',1.5],['Luisteren','listen',2],
 ['Praten / gebaren','speak',2,{speaking:true,mouth:.75}],['Knipperen','idle',2,{blink:1}],
 ['Sterrenhoed · aanloop','magic',3,{magicId:'star-hat',magicProgress:3/14}],['Sterrenhoed · onthulling','magic',8,{magicId:'star-hat',magicProgress:8/14}],
 ['Linten · voorbereiden','magic',3,{magicId:'silk-stars',magicProgress:3/15}],['Linten · vlinder','magic',9,{magicId:'silk-stars',magicProgress:9/15}],
 ['Terug naar rust','wave',4.78],['Beweging beperkt','wave',2,{reducedMotion:true}],
 ['Energie 1,43 · zwaaien','wave',2,{energy:1.43}],['Energie 1,43 · applaus','clap',Math.PI*3/5.6,{energy:1.43}],
 ['Energie 1,43 · juichen','cheer',1.6,{energy:1.43}],['Energie 1,43 · buiging','bow',2,{energy:1.43}]
];
export async function loadHarness(){
 const prior=globalThis.document;
 globalThis.document={createElement(name){assert.equal(name,'canvas');return createCanvas(1,1);}};
 const {createMiloPuppet}=await import('../public/milo-puppet.js');
 const path=name=>resolve(root,'public',name.replace(/^\//,''));
 const [image,talkImage,profiles,room,desk]=await Promise.all([
  loadImage(path('assets/milo-friends/characters/milo.png')),loadImage(path('assets/milo-friends/characters/milo-talk.png')),
  readFile(path('assets/milo-friends/characters/rigs-a.json'),'utf8').then(JSON.parse),loadImage(path(STUDIO_ART.room)),loadImage(path(STUDIO_ART.desk))
 ]);
 return {image,talkImage,assets:{room,desk},newRig:()=>createMiloPuppet(image,{talkImage,profile:profiles.milo}),restore(){if(prior===undefined)delete globalThis.document;else globalThis.document=prior;}};
}
function backdrop(ctx,w,h){
 ctx.fillStyle='#1a1227';ctx.fillRect(0,0,w,h);
 ctx.fillStyle='#221a30';for(let y=0;y<h;y+=24)for(let x=0;x<w;x+=24)if((x/24+y/24)%2===0)ctx.fillRect(x,y,24,24);
}
export function sampleOptions(motion,time,extra={}){
 const duration=MOTION_CUES.find(c=>c.id===motion)?.duration;
 return {time,idleTime:1+time,motion,energy:1,motionBlend:duration?motionEnvelope(time,duration):1,deltaTime:1/60,paused:false,...extra};
}
export function drawPortrait(harness,motion,time,extra={},size={width:440,height:520}){
 const canvas=createCanvas(size.width,size.height),ctx=canvas.getContext('2d'),rig=harness.newRig();
 const layout={x:size.width/2,y:size.height-20,height:size.height-75};
 const result=rig.draw(ctx,{...layout,...sampleOptions(motion,time,extra),immediate:true});
 return {canvas,ctx,rig,result,layout};
}
export function drawStudio(ctx,harness,rig,opts,{width=1280,height=720,shot='host',magic=false,label=''}={}){
 ctx.setTransform(width/1920,0,0,height/1080,0,0);ctx.fillStyle='#160c28';ctx.fillRect(0,0,1920,1080);
 const camera=CAMERA_PRESETS[shot]||CAMERA_PRESETS.host,state={drawn:[7,23,42],lastNumber:42};
 ctx.save();ctx.translate(960,540);ctx.scale(camera.scale,camera.scale);ctx.translate(-camera.x,-camera.y);
 drawBroadcastSet(ctx,{state,time:opts.idleTime??opts.time,camera,assets:harness.assets});
 let result;
 if(!magic){ctx.save();ctx.beginPath();ctx.rect(0,0,1920,ARENA_LAYOUT.desk.occlusionY);ctx.clip();result=rig.draw(ctx,{...ARENA_LAYOUT.host,...opts});ctx.restore();drawBroadcastDesk(ctx,{state,time:opts.time,assets:harness.assets});}
 else{drawBroadcastDesk(ctx,{state,time:opts.time,assets:harness.assets});result=rig.draw(ctx,{...ARENA_LAYOUT.magic,...opts});}
 ctx.restore();
 if(label){ctx.fillStyle='#160c28d9';ctx.fillRect(0,1005,1920,75);ctx.font='600 26px "Trebuchet MS"';ctx.fillStyle='#ffe5a5';ctx.textAlign='left';ctx.fillText(label,44,1053);}
 return result;
}
function rgba(canvas){return Buffer.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data);}
function delta(a,b){assert.equal(a.length,b.length);let changed=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])+Math.abs(a[i+3]-b[i+3])>35)changed++;return changed;}
export async function runChecks(out=DEFAULT_OUT){
 await mkdir(out,{recursive:true});const harness=await loadHarness();
 try{
  const cw=360,ch=460,cols=4,rows=Math.ceil(samples.length/cols),sheet=createCanvas(cw*cols,ch*rows),sc=sheet.getContext('2d');
  sc.fillStyle='#100a1c';sc.fillRect(0,0,sheet.width,sheet.height);
  const snapshots=[];
  for(let i=0;i<samples.length;i++){
   const [title,motion,time,extra={}]=samples[i],render=drawPortrait(harness,motion,time,extra,{width:cw,height:ch-44});
   const x=i%cols*cw,y=Math.floor(i/cols)*ch;sc.save();sc.translate(x,y);backdrop(sc,cw,ch);sc.drawImage(render.canvas,0,44);sc.fillStyle='#ffe3a1';sc.font='600 15px "Trebuchet MS"';sc.textAlign='left';sc.fillText(title,14,28);sc.restore();
   snapshots.push({title,anchors:render.result?.hands,head:render.result?.head});
   if(i<2)await writeFile(resolve(out,i===0?'neutral.png':'wave.png'),render.canvas.toBuffer('image/png'));
   const pix=rgba(render.canvas);let opaque=0;for(let k=3;k<pix.length;k+=4)if(pix[k]>240)opaque++;
   assert(opaque>render.canvas.width*render.canvas.height*.10,title+' must draw a visible performer');
   assert(opaque<render.canvas.width*render.canvas.height*.8,title+' must retain a transparent cutout');
   for(const hand of Object.values(render.result?.hands||{})){
    assert(Number.isFinite(hand.x)&&Number.isFinite(hand.y),title+' hand anchor finite');
    assert(hand.x>0&&hand.x<render.canvas.width&&hand.y>0&&hand.y<render.canvas.height,title+' hands remain inside the test framing');
   }
   for(const corner of [3,render.canvas.width*4-1,pix.length-render.canvas.width*4+3,pix.length-1])assert.equal(pix[corner],0,title+' must not paint an opaque rectangle');
   render.rig.dispose();
  }
  await writeFile(resolve(out,'motions-contact-sheet.png'),sheet.toBuffer('image/png'));
  const idle=drawPortrait(harness,'idle',2),wave=drawPortrait(harness,'wave',2);
  const change=delta(rgba(idle.canvas),rgba(wave.canvas));assert(change>1800,'Wave must visibly change the performer, independently of camera/effects');
  const leftLift=idle.result.hands.left.y-wave.result.hands.left.y,rightLift=idle.result.hands.right.y-wave.result.hands.right.y;
  assert(Math.max(leftLift,rightLift)>35,'At least one waving hand must rise substantially, not drop down');
  const frozen=rgba(wave.canvas),frozenOpts={...wave.layout,...sampleOptions('wave',2),paused:true};
  for(let i=0;i<20;i++){wave.ctx.clearRect(0,0,wave.canvas.width,wave.canvas.height);wave.rig.draw(wave.ctx,{...frozenOpts,time:2+i*.2,idleTime:3+i*.2});}
  assert(frozen.equals(rgba(wave.canvas)),'Paused puppet holds exact pixels');
  const clapContact=drawPortrait(harness,'clap',Math.PI*3/5.6),clapOpen=drawPortrait(harness,'clap',Math.PI*4/5.6);
  const gap=render=>Math.hypot(render.result.hands.left.x-render.result.hands.right.x,render.result.hands.left.y-render.result.hands.right.y);
  const clapGap={contact:gap(clapContact),open:gap(clapOpen)};
  assert(clapGap.open-clapGap.contact>20,'Clap hands visibly come together, then reopen');
  for(const render of [idle,wave,clapContact,clapOpen])render.rig.dispose();
  const studio=createCanvas(1920,1080),ctx=studio.getContext('2d'),rig=harness.newRig();
  drawStudio(ctx,harness,rig,{...sampleOptions('wave',2),immediate:true},{width:1920,height:1080,label:'Milo · Zwaaien · werkelijk studiobeeld'});
  await writeFile(resolve(out,'studio-wave.png'),studio.toBuffer('image/png'));rig.dispose();
  const report={backend:'@napi-rs/canvas — actual production puppet',samples:samples.length,waveChangedPixels:change,handLiftPixels:{left:leftLift,right:rightLift},clapGapPixels:clapGap,paused:'identical pixels',output:out,anchors:snapshots};
  await writeFile(resolve(out,'render-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,anchors:undefined}));
 }finally{harness.restore();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await runChecks(process.argv[2]||DEFAULT_OUT);
