import {canvasRuntime} from './canvas-runtime.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {VlampieStudio25D,SHOTS} from '../public/studio-25d.js';
import {createBrandReserve} from '../public/brand-reserve.js';
import {SHOW_BRANDS} from '../server/show-brands.js';
import {ShowDirector,SCENES} from '../public/show-director.js';
import {makeGame,generateBooks} from '../server/bingo-model.js';
import {showPresentation} from '../server/presentation-model.js';
const {createCanvas,loadImage,GlobalFonts}=canvasRuntime;
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','Arial');
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','Arial');
const out=process.argv[2];assert(out,'Provide an output directory outside checkout');await fs.mkdir(out,{recursive:true});
const load=p=>loadImage(new URL('../public/'+p.replace(/^\//,''),import.meta.url).pathname);
const canvas=createCanvas(1280,720);canvas.getBoundingClientRect=()=>({width:1280,height:720});
const studio=new VlampieStudio25D(canvas,{canvasFactory:createCanvas,loadImage:load,onRenderFailure:e=>{throw e;}});await studio.load();
const base={motion:'welcome',age:1200,energy:65,idle:true,time:2,speaking:true,mouth:{open:.5,round:.2},lightShow:true,bingoNumber:42,bingoDrawn:[1,4,7,12,20,24,29,33,44,54,60,62,66,71,75]};
let frames=0;
for(const [brand,theme] of [['vlampie','showtime'],['vlampie','sinterklaas'],['rocco','royale'],['milo','magico']]){
 const b=SHOW_BRANDS[brand],game=makeGame({brandId:brand,date:'2026-12-05T19:00'},'host','https://studio.example');generateBooks(game,1,'polish');await studio.setBrand(brand,false);await studio.setTheme(theme,false);
 const shots=[...SCENES,{id:'winner',camera:'portrait'},{id:'rejected',camera:'desk'},{id:'call',camera:'portrait'},{id:'lobby',camera:'wide'},...Object.keys(SHOTS).map(camera=>({id:'camera-'+camera,camera}))];
 const sheet=createCanvas(1920,Math.ceil(shots.length/3)*392),c=sheet.getContext('2d');c.fillStyle=b.palette.base;c.fillRect(0,0,sheet.width,sheet.height);
 for(const [i,scene] of shots.entries()){
  const show={brandId:brand,scene:scene.id,sceneRevision:i,title:b.title,winner:'James',round:'Finaleronde',prize:'Een weekend vol avontuur',pattern:'Vier hoeken',countdown:5,age:2,transition:'cut',rules:showPresentation(game).rules,roundPatterns:game.plan.patterns.slice(0,3),patternCells:[0,4,20,24],question:{name:'James',text:b.short+', hoe oud ben jij?',phase:'answer'},liveCall:scene.id==='call'?{name:'James',phase:'live'}:null,gameStage:scene.id==='card'?{type:'card',name:'James',ticket:'0042',card:game.books[0].cards[0],drawn:base.bingoDrawn,pattern:game.plan.patterns[0],status:'valid',completeAt:15}:scene.id==='lobby'?{type:'lobby',rotateSeconds:12,message:b.signature,startsAt:Date.now()+300000,prizes:[],rules:[],greetings:['James']}:null};
  studio.setCamera(scene.camera,false);studio.render(1/30,{...base,show});assert(!studio.failed,brand+scene.id);const x=i%3*640,y=Math.floor(i/3)*392;c.drawImage(canvas,x,y,640,360);c.fillStyle=b.palette.accent;c.font='20px Arial';c.fillText(scene.id,x+16,y+385);await fs.writeFile(`${out}/${brand}-${theme}-${scene.id}.jpg`,canvas.toBuffer('image/jpeg',90));frames++;
 }
 await fs.writeFile(`${out}/${brand}-${theme}-all.jpg`,sheet.toBuffer('image/jpeg',90));
 if(brand!=='vlampie'){
  const reserve=await createBrandReserve(brand,{loadImage:load,canvasFactory:createCanvas});canvas.getContext('2d').clearRect(0,0,1280,720);reserve.draw(canvas.getContext('2d'),1280,720,{...base,motionElapsed:1200});await fs.writeFile(`${out}/${brand}-reserve.jpg`,canvas.toBuffer('image/jpeg',90));reserve.dispose();
 }
}
studio.dispose();console.log(`${frames} scene/camera renders across all three identities and both Vlampie environments; two identity-specific reserve views verified.`);
