import {canvasRuntime} from './canvas-runtime.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {VlampieStudio25D} from '../public/studio-25d.js';
import {SHOW_BRANDS,showBrand,brandId,brandText,brandMention,switchPlanBrand} from '../server/show-brands.js';
import {ShowDirector,SCENES} from '../public/show-director.js';
import {defaultPlan} from '../server/plan-model.js';
import {makeGame,generateBooks,MINIGAMES,playerGame} from '../server/bingo-model.js';
import {speechStyle,showPresentation} from '../server/presentation-model.js';
import {callInstructions} from '../server/calls.js';
const {createCanvas,loadImage}=canvasRuntime;
const out=process.argv[2]||'/workspace/scratch/3168b87d0f33/show-worlds-qa';await fs.mkdir(out,{recursive:true});
const canvas=createCanvas(1280,720);canvas.getBoundingClientRect=()=>({width:1280,height:720});
const studio=new VlampieStudio25D(canvas,{canvasFactory:createCanvas,loadImage:p=>loadImage(new URL('../public/'+p.replace(/^\//,''),import.meta.url).pathname),onRenderFailure:e=>{throw e;}});await studio.load();
const base={motion:'welcome',age:1200,energy:65,idle:true,time:2,speaking:false,lightShow:true,bingoNumber:42,bingoDrawn:[1,4,7,12,20,24,29,33,44,54,60,62,66,71,75]};
let count=0;const timings=[];
for(const brand of ['rocco','milo']){
 const b=SHOW_BRANDS[brand];assert.equal(brandId(b),brand);assert.equal(brandText('Vraag aan Vlampie',b),'Vraag aan '+b.name);assert(brandMention(b.mention+' hoe gaat het?',b));
 const game=makeGame({brandId:brand,date:'2026-12-05T19:00'},'host','https://studio.example');assert.equal(playerGame(game,'guest').brandId,brand);assert(speechStyle(showPresentation(game).profile).includes(b.name));assert(callInstructions(game,'James').includes(b.name));generateBooks(game,2,'brands');
 assert.equal(game.plan.blocks.find(x=>x.type==='welcome').text,b.intro);const custom=defaultPlan();custom.blocks[1].text='Mijn eigen tekst blijft staan.';assert.equal(switchPlanBrand(custom,'vlampie',brand).blocks[1].text,custom.blocks[1].text);
 const d=new ShowDirector({config:{voice:true}});d.theme=b.theme;d.brandId=brand;for(let i=0;i<6;i++){assert(d.draw());for(let j=0;j<100;j++)d.tick(1,{voiceBusy:false});}assert.equal(d.drawn.length,6);
 await studio.setBrand(brand,false);await studio.setTheme(b.theme,false);assert.equal(studio.brandId,brand);
 const contact=createCanvas(1920,Math.ceil((SCENES.length+2)/3)*392),c=contact.getContext('2d');c.fillStyle=b.palette.base;c.fillRect(0,0,contact.width,contact.height);
 const scenes=[...SCENES,{id:'lobby',camera:'wide'},{id:'call',camera:'portrait'}];
 for(const [i,scene] of scenes.entries()){
  const show={brandId:brand,scene:scene.id,sceneRevision:i,title:b.title,round:'Finaleronde',prize:'Een schitterende hoofdprijs',pattern:'Vier hoeken',countdown:5,age:2,transition:'cut',rules:showPresentation(game).rules,roundPatterns:game.plan.patterns.slice(0,3),patternCells:[0,4,20,24],question:{name:'James',text:b.short+', hoe oud ben jij?',phase:'answer'},gameStage:scene.id==='card'?{type:'card',name:'James',ticket:'0042',card:game.books[0].cards[0],drawn:base.bingoDrawn,pattern:game.plan.patterns[0],status:'valid',completeAt:15}:scene.id==='lobby'?{type:'lobby',rotateSeconds:12,message:b.signature,startsAt:Date.now()+300000,prizes:[],rules:[],greetings:['James']}:null};
  studio.setCamera(scene.camera,false);const start=performance.now();studio.render(1/30,{...base,show});timings.push(performance.now()-start);assert(!studio.failed,brand+scene.id);const x=i%3*640,y=Math.floor(i/3)*392;c.drawImage(canvas,x,y,640,360);c.fillStyle=b.palette.accent;c.font='20px sans-serif';c.fillText(scene.id,x+18,y+385);await fs.writeFile(`${out}/${brand}-${scene.id}.jpg`,canvas.toBuffer('image/jpeg',90));count++;
 }
 await fs.writeFile(`${out}/${brand}-scenes.jpg`,contact.toBuffer('image/jpeg',90));
 const entrants=Array.from({length:6},(_,i)=>({bookId:'book'+i,ticket:String(i+1).padStart(4,'0'),name:['James','Mila','Noah','Emma','Luca','Sara'][i]}));
 for(const m of MINIGAMES){const result={id:'result',minigame:m.id,entrants,winner:entrants[2],prize:{title:'De hoofdprijs'}};studio.render(1/30,{...base,show:{brandId:brand,scene:'minigame',transition:'cut',age:12,gameStage:{type:'minigame',playId:m.id,duration:24,result}}});assert(!studio.failed,m.id);await fs.writeFile(`${out}/${brand}-game-${m.id}.jpg`,canvas.toBuffer('image/jpeg',85));count++;}
 studio.setCamera('wide',false);const eight=await studio.export8K({...base,show:{brandId:brand,scene:'still',title:b.title}});assert.equal(eight.width,7680);assert.equal(eight.height,4320);await fs.writeFile(`${out}/${brand}-still-8k.jpg`,eight.toBuffer('image/jpeg',85));eight.width=1;
}
await studio.setBrand('vlampie',false);await studio.setTheme('sinterklaas',false);studio.render(1/30,base);assert.equal(studio.brandId,'vlampie');assert(!studio.failed);studio.dispose();timings.sort((a,b)=>a-b);console.log(JSON.stringify({scenes:count,identities:'round-trip OK',draws:'6 per host',eightK:'7680x4320 export verified',medianMs:timings[Math.floor(timings.length/2)],out}));
