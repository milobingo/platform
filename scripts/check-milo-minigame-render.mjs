import {canvasRuntime} from './canvas-runtime.mjs';
// Actual production Canvas pipeline, without browser, audio or provider calls.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {drawBingoStage} from '../public/bingo-scenes.js';
import {gameFrame,objectPose} from '../public/bingo-choreography.js';
import {gameGroups,GameMotionClock} from '../public/bingo-motion.js';
import {MINIGAMES} from '../server/bingo-model.js';
import {brandGameName} from '../server/show-brands.js';
import {butterflyRevealPose} from '../public/milo-magic-games.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {createCanvas,loadImage,GlobalFonts}=canvasRuntime;
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','Arial');
const out=process.argv[2]||resolve(process.env.TMPDIR||'/tmp','milo-minigame-render');
const games=['plingo','ribbons','mirrors','potion','butterfly'];
const durations={plingo:24,ribbons:28,mirrors:26,potion:26,butterfly:30};
const names=['Noor','Sophie','Daan','Mila','Sam','Luca','Tess','Ravi','Bo','Adam'];
const files=['race-environments.png','show-environments.png','game-sprites.png','horse-gallop-atlas.png','gift-components-atlas.png','hosts/milo-games.webp'];
const images=await Promise.all(files.map(name=>loadImage(resolve(root,'public/assets',name))));
const [races,shows,sprites,gallop,giftParts,brandBackground]=images;
const assets={races,shows,sprites,gallop,giftParts,brandBackground,brandId:'milo'};
await mkdir(out,{recursive:true});

function stageFor(game,count=6,winner=count-1){
 const entrants=Array.from({length:count},(_,i)=>({bookId:'book-'+i,name:names[i%names.length]+(i>=10?' '+i:''),ticket:String(i+1).padStart(4,'0')}));
 return {type:'minigame',playId:'native-qa-'+game,duration:durations[game],result:{id:'native-result-'+game+'-'+count,minigame:game,entrants,winner:entrants[winner],prize:{title:'Het magische verrassingspakket'}}};
}
function checkedContext(ctx,texts){return new Proxy(ctx,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return (...args)=>{for(const a of args)if(typeof a==='number')assert(Number.isFinite(a),String(key)+' received a non-finite coordinate');if(key==='fillText')texts.push(String(args[0]));return value.apply(target,args);};},set(target,key,value){if(typeof value==='number')assert(Number.isFinite(value),String(key)+' must be finite');return Reflect.set(target,key,value,target);}});}
function render(stage,age,{reduced=false,width=1280,height=720}={}){
 const canvas=createCanvas(width,height),texts=[],ctx=checkedContext(canvas.getContext('2d'),texts);
 ctx.scale(width/1920,height/1080);
 const show={brandId:'milo',title:'Milo & Friends BingoShow',scene:'minigame',gameStage:stage,age,reducedMotion:reduced,paused:false};
 assert.equal(drawBingoStage(ctx,show,assets),true);
 const expected=brandGameName(MINIGAMES.find(g=>g.id===stage.result.minigame),'milo');
 assert(texts.includes(expected),'Built public catalog must render the correct title: '+expected);
 return canvas;
}
const pixels=canvas=>Buffer.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data);
function difference(a,b){assert.equal(a.length,b.length);let changed=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>40)changed++;return changed;}
function caption(ctx,text,x,y){ctx.fillStyle='#ffe4ad';ctx.textAlign='left';ctx.textBaseline='middle';ctx.font='600 18px Arial';ctx.fillText(text,x+12,y+18);}

const sheet=createCanvas(1920,5*310),sc=sheet.getContext('2d');sc.fillStyle='#130b22';sc.fillRect(0,0,sheet.width,sheet.height);
const crowdSheet=createCanvas(1920,5*310),cc=crowdSheet.getContext('2d');cc.fillStyle='#130b22';cc.fillRect(0,0,crowdSheet.width,crowdSheet.height);
const thumbnailSheet=createCanvas(1440,3*330),tc=thumbnailSheet.getContext('2d');tc.fillStyle='#130b22';tc.fillRect(0,0,thumbnailSheet.width,thumbnailSheet.height);
const report=[];
for(const [row,game] of games.entries()){
 const stage=stageFor(game),before=structuredClone(stage),snapshots=[];
 const thumbnail=createCanvas(720,290),thumbnailContext=thumbnail.getContext('2d');thumbnailContext.setTransform(720/1790,0,0,290/720,-65*720/1790,-177*290/720);
 drawBingoStage(thumbnailContext,{brandId:'milo',scene:'minigame',gameStage:stage,age:stage.duration*(game==='butterfly'?.77:.66),reducedMotion:false,paused:false},{brandId:'milo'});
 const thumbX=row%2*720,thumbY=Math.floor(row/2)*330;caption(tc,game+' · werkelijk catalogusminiatuur',thumbX,thumbY);tc.drawImage(thumbnail,thumbX,thumbY+36);
 for(const [col,fraction] of [.15,.5,.89,1].entries()){
  const canvas=render(stage,stage.duration*fraction),x=col*480,y=row*310;
  sc.drawImage(canvas,x,y+36,480,270);caption(sc,game+' · '+Math.round(fraction*100)+'%',x,y);
  snapshots.push(pixels(canvas));
  if(col===1||col===3)await writeFile(resolve(out,game+(col===1?'-mid.png':'-winner.png')),canvas.toBuffer('image/png'));
 }
 assert(difference(snapshots[0],snapshots[1])>3000,game+' should visibly progress rather than show a static placeholder');
 assert(difference(snapshots[1],snapshots[3])>3000,game+' should have a distinct final reveal');
 assert.deepEqual(stage,before,game+' rendering must never mutate the canonical result');
 const repeated=render(stage,stage.duration*.5),cloned=render(structuredClone(stage),stage.duration*.5);
 assert(pixels(repeated).equals(pixels(cloned)),game+' seek/reload with the same stored result must retain identical pixels');
 const reducedA=render(stage,1,{reduced:true}),reducedB=render(stage,15,{reduced:true});
 assert(pixels(reducedA).equals(pixels(reducedB)),game+' reduced motion must use a stable final tableau');
 // Hold the authoritative scene clock while transport timestamps continue.
 const clock=new GameMotionClock(),show={scene:'minigame',gameStage:stage,age:stage.duration*.45,paused:false};
 clock.read(show,1000);const held=clock.read({...show,paused:true},1200);
 for(let i=0;i<8;i++)assert.equal(clock.read({...show,age:show.age+i*.25,paused:true},1400+i*100).age,held.age,game+' pause changed the visual clock');
 const frozenA=render(stage,held.age),frozenB=render(stage,held.age);
 assert(pixels(frozenA).equals(pixels(frozenB)),game+' paused pipeline must retain exact pixels');
 let samples=0;
 for(const count of [2,6,10,100])for(const winner of [0,count-1]){
  const sample=stageFor(game,count,winner),snapshot=structuredClone(sample),groups=gameGroups(sample.result);
  assert.equal(new Set(groups.flatMap(g=>g.members.map(e=>e.bookId))).size,count);
  assert.equal(groups.filter(g=>g.winning).length,1);
  assert(groups.find(g=>g.winning).members.some(e=>e.bookId===sample.result.winner.bookId));
  const f=gameFrame(sample,sample.duration*.5),poses=f.groups.map(g=>({group:g,...objectPose(f,g)}));
  if(game==='butterfly')for(let step=0;step<=1000;step++){
   const flight=butterflyRevealPose(f,poses,step/1000);
   assert(flight.y-235*.52*flight.scale>=177,'Butterfly upper wings leave the stage during flight/landing');
   assert(flight.y+235*.55*flight.scale<=817,'Butterfly lower wings overlap participant labels');
  }
  for(const p of poses)for(const key of ['x','y','chipX','chipY','width','height'])assert(Number.isFinite(p[key]),game+' '+key+' must be finite');
  for(const p of poses){assert(p.width>0&&p.height>0);assert(p.chipX-p.width/2>=65&&p.chipX+p.width/2<=1855,game+' label leaves horizontal stage bounds');assert(p.chipY-p.height/2>=177&&p.chipY+p.height/2<=897,game+' label overlaps the header or lower result panel');}
  for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++){const a=poses[i],b=poses[j];assert(Math.abs(a.chipX-b.chipX)>=(a.width+b.width)/2||Math.abs(a.chipY-b.chipY)>=(a.height+b.height)/2,game+' participant labels overlap');}
  const final=render(sample,sample.duration,{width:960,height:540});
  assert.deepEqual(sample,snapshot,game+' changed a stored winner or entrant');
  if(winner===count-1){const col=[2,6,10,100].indexOf(count),x=col*480,y=row*310;cc.drawImage(final,x,y+36,480,270);caption(cc,game+' · '+count+' finalisten',x,y);}
  samples++;
 }
 report.push({game,crowdWinnerSamples:samples,deterministic:true,reducedMotion:'identical pixels',pause:'identical pixels',result:'unchanged'});
}
await writeFile(resolve(out,'five-games-contact-sheet.png'),sheet.toBuffer('image/png'));
await writeFile(resolve(out,'five-games-crowds.png'),crowdSheet.toBuffer('image/png'));
await writeFile(resolve(out,'five-games-catalog-thumbnails.png'),thumbnailSheet.toBuffer('image/png'));
await writeFile(resolve(out,'render-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({games:games.length,crowdWinnerSamples:report.reduce((n,r)=>n+r.crowdWinnerSamples,0),pipeline:'actual drawBingoStage',output:out,checks:report}));
