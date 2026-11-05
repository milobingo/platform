import {canvasRuntime} from './canvas-runtime.mjs';
// Consecutive-frame QA of the actual production Canvas. This intentionally
// measures motion over time; a set of attractive stills cannot certify it.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {drawBingoStage} from '../public/bingo-scenes.js';
import {plingoBallPose} from '../public/plingo-game.js';
import {gameFrame} from '../public/bingo-choreography.js';
import {minigameDuration} from '../public/milo-minigame-plan.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {createCanvas,loadImage,GlobalFonts}=canvasRuntime;
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','Arial');
const out=process.env.MILO_TEMPORAL_QA_DIR||process.argv.slice(2).find(arg=>!arg.startsWith('--'))||resolve(process.env.TMPDIR||'/tmp','milo-temporal-qa');
const baseline=process.argv.includes('--baseline'),video=process.argv.includes('--video');
await mkdir(out,{recursive:true});
const files=['race-environments.png','show-environments.png','game-sprites.png','horse-gallop-atlas.png','gift-components-atlas.png','hosts/milo-games.webp'];
const [races,shows,sprites,gallop,giftParts,brandBackground]=await Promise.all(files.map(name=>loadImage(resolve(root,'public/assets',name))));
const assets={races,shows,sprites,gallop,giftParts,brandBackground,brandId:'milo'};
const games=['plingo','ribbons','mirrors','potion','butterfly'];
const width=640,height=360,fps=60;
const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
function stageFor(game){
 const entrants=['Noor','Sophie','Daan','Mila','Sam','Luca'].map((name,i)=>({bookId:'book-'+i,name,ticket:String(i+1).padStart(4,'0')}));
 return {type:'minigame',playId:'temporal-'+game,duration:minigameDuration(game),result:{id:'temporal-result-'+game,minigame:game,entrants,winner:entrants[3],prize:{title:'Het magische verrassingspakket'}}};
}
function render(stage,age){
 ctx.setTransform(width/1920,0,0,height/1080,0,0);ctx.clearRect(0,0,1920,1080);
 drawBingoStage(ctx,{brandId:'milo',title:'Milo & Friends BingoShow',scene:'minigame',gameStage:stage,age,reducedMotion:false,paused:false},assets);
 return Buffer.from(ctx.getImageData(0,0,width,height).data);
}
const luma=(pixels,k)=>(pixels[k]*54+pixels[k+1]*183+pixels[k+2]*19)/256;
function compare(a,b,{stage,age}={}){
 let total=0,wide=0,signed=0,board=0,boardCount=0;
 const f=stage?.result.minigame==='plingo'?gameFrame(stage,age):null,ball=f?plingoBallPose(f.result,f.progress,f.groups):null;
 for(let k=0;k<a.length;k+=4){
  const delta=luma(b,k)-luma(a,k),abs=Math.abs(delta);total+=abs;signed+=delta;if(abs>40)wide++;
  if(ball){const x=(k/4%width)*3,y=Math.floor(k/4/width)*3;
   if(x>145&&x<1775&&y>240&&y<725&&!(x>875&&x<1045&&y>415&&y<590)&&Math.hypot(x-ball.x,y-ball.y)>110){board+=abs;boardCount++;}
  }
 }
 const count=a.length/4;return {meanAbsoluteLuma:total/count,meanSignedLuma:signed/count,broadFlashFraction:wide/count,staticBoardLuma:boardCount?board/boardCount:0};
}
const reports=[];
for(const game of games){
 const stage=stageFor(game),before=structuredClone(stage),duration=stage.duration,intro=2,finish=duration-1.2;
 // Windows straddle both text phase switches, late action, and reveal. Each
 // window contains consecutive true 60fps frames, not widely spaced samples.
 const boundaries=[intro,intro+(finish-intro)*.3,intro+(finish-intro)*.75,finish-.35,finish+.6];
 const all=[];
 for(const center of boundaries){let previous=render(stage,Math.max(0,center-.32));
  for(let i=1;i<=40;i++){const age=Math.max(0,center-.32)+i/fps,frame=render(stage,age),m=compare(previous,frame,{stage,age});all.push({age,...m});previous=frame;}
 }
 const metrics={game,framesCompared:all.length,maxMeanAbsoluteLuma:Math.max(...all.map(m=>m.meanAbsoluteLuma)),maxBroadFlashFraction:Math.max(...all.map(m=>m.broadFlashFraction)),maxGlobalBrightnessJump:Math.max(...all.map(m=>Math.abs(m.meanSignedLuma))),maxStaticBoardLuma:Math.max(...all.map(m=>m.staticBoardLuma)),worst:all.slice().sort((a,b)=>b.meanAbsoluteLuma-a.meanAbsoluteLuma).slice(0,3)};
 assert(metrics.maxBroadFlashFraction<.025,game+' changed more than 2.5 percent of the frame abruptly in 1/60s');
 assert(metrics.maxGlobalBrightnessJump<2,game+' has a whole-frame brightness jump');
 const held=render(stage,duration*.63);for(let i=0;i<3;i++)assert(held.equals(render(stage,duration*.63)),game+' must produce identical paused pixels');
 assert.deepEqual(stage,before,game+' changed the stored result');reports.push(metrics);
 console.log(JSON.stringify(metrics));
}
const report={pipeline:'actual drawBingoStage',fps,width,height,mode:baseline?'baseline':'after',reports};
await writeFile(resolve(out,baseline?'temporal-before.json':'temporal-after.json'),JSON.stringify(report,null,2));
if(!baseline){
 const old=await readFile(resolve(out,'temporal-before.json'),'utf8').then(JSON.parse).catch(()=>null);
 if(old)console.log(JSON.stringify({comparison:reports.map(r=>{const before=old.reports.find(x=>x.game===r.game);return {game:r.game,comparableSamples:before?.framesCompared===r.framesCompared,beforePeak:before?.framesCompared===r.framesCompared?before.maxMeanAbsoluteLuma:null,afterPeak:r.maxMeanAbsoluteLuma,note:before?.framesCompared===r.framesCompared?'same windows':'after sampling also includes release; raw peaks are not directly comparable'};})}));
}
if(video){
 const stage=stageFor('plingo'),path=resolve(out,'plingo-stabiel-60fps.mp4');
 const encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgba','-video_size',`${width}x${height}`,'-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',path],{stdio:['pipe','ignore','pipe']});
 let error='';encoder.stderr.on('data',chunk=>error+=chunk);
 for(let i=0;i<=stage.duration*fps;i++){const rgba=render(stage,i/fps);if(!encoder.stdin.write(rgba))await once(encoder.stdin,'drain');}
 encoder.stdin.end();const [code]=await once(encoder,'exit');assert.equal(code,0,error);console.log(JSON.stringify({video:path,fps,frames:stage.duration*fps+1,audio:false}));
}
