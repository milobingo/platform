// Export the actual articulated Canvas puppet in Studio 01, without audio/providers.
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createCanvas,loadHarness,drawStudio,sampleOptions,DEFAULT_OUT} from './check-milo-puppet-render.mjs';
const out=process.argv[2]||DEFAULT_OUT;await mkdir(out,{recursive:true});
const fps=60,width=1280,height=720,video=resolve(out,'milo-bewegingen.mp4');
const segments=[
 {motion:'idle',duration:2.2,label:'Milo · Ademhaling en rustige blik'},
 {motion:'wave',duration:4.8,label:'Zwaaien · schouder, elleboog en pols'},
 {motion:'clap',duration:5,label:'Applaus · beide handen bewegen naar elkaar'},
 {motion:'speak',duration:3.5,speaking:true,label:'Spreekgebaren · knikken, handen en mond'},
 {motion:'bow',duration:4.2,label:'Buiging · gecontroleerd terug naar rust'},
 {motion:'magic',duration:6,magic:true,magicId:'silk-stars',label:'Magiebeweging · lichaam, armen en handen'}
];
const harness=await loadHarness(),rig=harness.newRig(),canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
const encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgba','-video_size',`${width}x${height}`,'-framerate',String(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',video],{stdio:['pipe','ignore','pipe']});
let stderr='';encoder.stderr.on('data',b=>stderr+=b);let total=0,frames=0;
try{
 for(const segment of segments){
  for(let frame=0;frame<Math.ceil(segment.duration*fps);frame++){
   const time=frame/fps,opts=sampleOptions(segment.motion,time,{idleTime:total+time,deltaTime:1/fps,speaking:!!segment.speaking,mouth:segment.speaking?.18+(Math.sin(time*17)+1)*.22:0,...(segment.magic?{magicId:segment.magicId,magicProgress:time/15}:{})});
   drawStudio(ctx,harness,rig,opts,{width,height,shot:segment.magic?'magic':'host',magic:segment.magic,label:segment.label});
   const rgba=Buffer.from(ctx.getImageData(0,0,width,height).data.buffer);if(!encoder.stdin.write(rgba))await once(encoder.stdin,'drain');frames++;
  }
  total+=segment.duration;
 }
 encoder.stdin.end();const [exit]=await once(encoder,'exit');if(exit!==0)throw Error(stderr||'Video encoding failed');
 console.log(JSON.stringify({video,fps,frames,duration:frames/fps,audio:false,source:'Actual Canvas puppet and accepted Studio 01 assets'}));
}finally{rig.dispose();harness.restore();if(encoder.exitCode===null)encoder.kill();}
