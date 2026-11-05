import {canvasRuntime} from './canvas-runtime.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {VlampieStudio25D} from '../public/studio-25d.js';
import {DEFAULT_SHOW} from '../public/show-director.js';
import {MINIGAMES} from '../server/bingo-model.js';
const {createCanvas,loadImage,GlobalFonts}=canvasRuntime;
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','Arial');
const out='/workspace/scratch/3168b87d0f33/bingo-scene-check';await fs.mkdir(out,{recursive:true});const image=path=>loadImage(new URL('../public/'+path,import.meta.url).pathname);
const canvas=createCanvas(1920,1080);canvas.getBoundingClientRect=()=>({width:1920,height:1080});const studio=new VlampieStudio25D(canvas,{canvasFactory:createCanvas,loadImage:image,onRenderFailure:e=>{throw e;}});await studio.load();await studio.setTheme('sinterklaas',false);
const entrants=Array.from({length:12},(_,i)=>({bookId:'b'+i,name:['Mila','Daan','Sanne','Nick','Lisa','Sophie','Lucas','Noor','Finn','Sara','Sem','Lotte'][i],ticket:String(i+1).padStart(4,'0')})),winner=entrants[2];
const sheet=createCanvas(1920,4*405),sc=sheet.getContext('2d');sc.fillStyle='#081122';sc.fillRect(0,0,sheet.width,sheet.height);
for(const [index,game] of MINIGAMES.entries())for(const age of [5,20]){const result={id:game.id,minigame:game.id,entrants,winner,prize:{title:'Een feestelijk verrassingspakket'}},show={...DEFAULT_SHOW,scene:'minigame',age,gameStage:{type:'minigame',result,duration:20}};studio.setCamera('wide',false);studio.render(1/30,{time:age,motion:'welcome',show,bingoDrawn:[]});assert(!studio.failed);await fs.writeFile(`${out}/${game.id}-${age}.png`,canvas.toBuffer('image/png'));if(age===20){const x=index%3*640,y=Math.floor(index/3)*405;sc.drawImage(await loadImage(canvas.toBuffer('image/png')),x,y,640,360);sc.fillStyle='#eed4a6';sc.font='22px Arial';sc.fillText(game.name,x+10,y+385);}}
await fs.writeFile(out+'/games.png',sheet.toBuffer('image/png'));
studio.setCamera('front',false);studio.render(1/30,{time:3,motion:'point',show:{...DEFAULT_SHOW,scene:'card',age:3,gameStage:{type:'card',name:'Mila',ticket:'0142',round:'Ronde 1',card:Array.from({length:25},(_,i)=>i===12?0:i+1),drawn:[1,2,3,4,5],pattern:{title:'Een horizontale rij',cells:[0,1,2,3,4]},status:'valid',completeAt:5}},bingoDrawn:[1,2,3,4,5]});assert(!studio.failed);await fs.writeFile(out+'/card.png',canvas.toBuffer('image/png'));studio.dispose();console.log(JSON.stringify({minigames:MINIGAMES.length,frames:23,output:out}));
