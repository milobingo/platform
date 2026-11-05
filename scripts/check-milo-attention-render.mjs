// Local visual QA: actual approved pixels and the production puppet, no audio.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createCanvas,loadHarness,drawPortrait,DEFAULT_OUT} from './check-milo-puppet-render.mjs';

const out=process.argv[2]||DEFAULT_OUT;await mkdir(out,{recursive:true});
const cases=[
 ['Aandacht links','idle',3,{attentionX:-1,expression:'curious'}],
 ['Aandacht rechts','idle',3,{attentionX:1,expression:'curious'}],
 ['Kijkt omhoog','idle',8,{attentionY:-1,expression:'curious'}],
 ['Kijkt naar nummerbord','idle',8,{attentionY:1,expression:'curious'}],
 ['Warm praten','speak',6,{speaking:true,mouth:.6,expression:'warm'}],
 ['Aandachtig luisteren','listen',16,{attentionX:.7,expression:'listening'}],
 ['Rustige nieuwsgierigheid','idle',28,{expression:'curious'}],
 ['Knipperen','idle',45,{blink:1,expression:'neutral'}]
];
const harness=await loadHarness(),sheet=createCanvas(1600,960),ctx=sheet.getContext('2d');
ctx.fillStyle='#1b1424';ctx.fillRect(0,0,sheet.width,sheet.height);
try{
 const reports=[];
 for(let i=0;i<cases.length;i++){
  const [title,motion,time,extra]=cases[i],render=drawPortrait(harness,motion,time,{...extra,idleTime:time},{width:600,height:720});
  const x=(i%4)*400,y=Math.floor(i/4)*480,head=render.result.head;
  // Neck/head anchor follows the real rig: this crop follows the character.
  ctx.drawImage(render.canvas,head.x-168,head.y-290,336,336,x,y+50,400,400);
  ctx.fillStyle='#ffe3a1';ctx.font='600 18px "Trebuchet MS"';ctx.fillText(title,x+14,y+31);
  for(const v of Object.values(render.result.pose))assert(Number.isFinite(v),title+' pose is finite');
  reports.push({title,eyeX:render.result.pose.eyeX,eyeY:render.result.pose.eyeY,headRot:render.result.pose.headRot});
  render.rig.dispose();
 }
 assert(reports[1].eyeX>reports[0].eyeX,'Left/right attention must reach the gaze pose');
 assert(reports[3].eyeY>reports[2].eyeY,'Up/down attention must reach the gaze pose');
 await writeFile(resolve(out,'attention-contact-sheet.png'),sheet.toBuffer('image/png'));
 await writeFile(resolve(out,'attention-report.json'),JSON.stringify(reports,null,2));
 console.log(JSON.stringify({samples:cases.length,source:'actual Milo puppet',output:resolve(out,'attention-contact-sheet.png')}));
}finally{harness.restore();}
