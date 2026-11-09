// Render the production magic module and mountStudio against actual project
// imagery. Provider connections and official game state are outside this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {canvasRuntime} from './canvas-runtime.mjs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCanvas} from './check-milo-puppet-render.mjs';
import {drawExtraMagic,extraMagicState,EXTRA_MAGIC_IDS} from '../public/milo-magic-effects.js';
import {miloPoseAt} from '../public/milo-motion.js';
import {MAGIC_CUES,getMagicCue} from '../public/magic-cues.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {Image:NativeImage}=canvasRuntime;
const pixels=c=>Buffer.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);
const digest=c=>createHash('sha256').update(pixels(c)).digest('hex');
const draw=(id,elapsed,extra={})=>{
 const c=createCanvas(1920,1080),native=c.getContext('2d');
 // Native Canvas tolerates some radii that browsers reject. Check actual draw
 // arguments as well, including the first tiny bubble before its reveal.
 const guarded=new Proxy(native,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{for(const n of args.filter(v=>typeof v==='number'))assert(Number.isFinite(n),id+':'+String(key)+' has non-finite geometry');if(key==='arc')assert(args[2]>=0);if(key==='ellipse')assert(args[2]>=0&&args[3]>=0);return value.apply(target,args);};},set(target,key,value){return Reflect.set(target,key,value,target);}});
 drawExtraMagic(guarded,{id,elapsed,duration:getMagicCue(id)?.duration,...extra});return c;
};
const turn=()=>new Promise(r=>setImmediate(r));

test('ten separate illusions are finite, deterministic, visible and isolated from their caller',()=>{
 const hashes=new Set();
 for(const id of EXTRA_MAGIC_IDS){
  const cue=getMagicCue(id),opts={id,elapsed:cue.duration*.70,duration:cue.duration,wrist:{x:1580,y:720}},before=structuredClone(opts);
  const frame=draw(id,opts.elapsed,{wrist:opts.wrist});
  hashes.add(digest(frame));assert.equal(digest(frame),digest(draw(id,opts.elapsed,{wrist:opts.wrist})),id+' must not reroll between identical frames');
  const a=frame.getContext('2d').getImageData(0,0,1920,1080).data;let visible=0;for(let i=3;i<a.length;i+=4)if(a[i]>80)visible++;
  assert(visible>2500,id+' needs a substantial visible prop, not just particles');
  for(const p of [0,.02,.15,.165,.18,.2,.4,.6,.8,.9,.98,1]){const s=extraMagicState({...opts,elapsed:cue.duration*p});assert(Object.values(s).filter(v=>typeof v==='number').every(Number.isFinite));assert(s.alpha>=0&&s.alpha<=1);draw(id,cue.duration*p,{wrist:opts.wrist});}
  assert.deepEqual(opts,before,'renderer must not mutate caller/game objects');
  assert.equal(extraMagicState({...opts,elapsed:0}).alpha,0);assert.equal(extraMagicState({...opts,elapsed:cue.duration}).alpha,0);
 }
 assert.equal(hashes.size,10,'Every trick requires visibly different geometry');
 assert.equal(drawExtraMagic(createCanvas(10,10).getContext('2d'),{id:'not-an-act'}),false);
});

test('all new Milo magic performances remain continuous and have their own arm choreography',()=>{
 const poses=new Set();
 for(const id of EXTRA_MAGIC_IDS){
  const duration=getMagicCue(id).duration;let previous;
  for(let i=0;i<=duration*60;i++){
   const t=i/60,p=miloPoseAt({motion:'magic',magicId:id,time:t,idleTime:t,magicProgress:t/duration});
   for(const [key,value]of Object.entries(p)){
    assert(Number.isFinite(value),id+':'+key+' non-finite');assert(Math.abs(value)<3.15,id+':'+key+' unsafe turn');
    if(previous)assert(Math.abs(value-previous[key])<.16,id+':'+key+' jumps between adjacent frames');
   }
   previous=p;
  }
  const pose=miloPoseAt({motion:'magic',magicId:id,time:duration*.66,magicProgress:.66});
  poses.add(JSON.stringify(['leftUpper','leftForearm','leftHand','rightUpper','rightForearm','rightHand'].map(k=>pose[k])));
 }
 assert.equal(poses.size,10);
});

test('reduced motion holds a complete still tableau throughout the middle of every extra act',()=>{
 for(const id of EXTRA_MAGIC_IDS){const d=getMagicCue(id).duration;assert.equal(digest(draw(id,d*.35,{reducedMotion:true})),digest(draw(id,d*.75,{reducedMotion:true})),id+' reduced-motion geometry must hold still');}
});

test('actual studio magic holds preview pixels, preserves game fields, accepts custom duration and creates unique broadcast thumbnails',async()=>{
 const keys=['document','window','Image','fetch','requestAnimationFrame','cancelAnimationFrame','CustomEvent','ResizeObserver'];
 const originals=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
 class Surface{constructor(tag){this.tagName=tag;this.children=[];}append(...n){this.children.push(...n);}appendChild(n){this.children.push(n);return n;}setAttribute(){}remove(){}dispatchEvent(){}getBoundingClientRect(){return {width:1280,height:720};}}
 const assetPath=url=>{assert(String(url).startsWith('/assets/'));return resolve(root,'public',String(url).slice(1));};
 class LocalImage extends NativeImage{set src(v){super.src=readFileSync(assetPath(v));}get src(){return super.src;}}
 globalThis.document={createElement(tag){if(tag!=='canvas')return new Surface(tag);const c=createCanvas(1,1);c.setAttribute=()=>{};return c;}};
 globalThis.window={devicePixelRatio:1,addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})};
 globalThis.Image=LocalImage;globalThis.ResizeObserver=undefined;globalThis.CustomEvent=class{};
 globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await readFile(assetPath(url),'utf8'))});
 let nextFrame,now=100,studio;const rendered=[];
 globalThis.requestAnimationFrame=cb=>{nextFrame=cb;return 1;};globalThis.cancelAnimationFrame=()=>{};
 const tick=()=>{nextFrame(now+=40);return pixels(studio.canvas);};
 const output=resolve(process.env.TMPDIR||'/tmp','milo-magic-qa'),previewDir=resolve(root,'public/assets/milo-friends/studio/show-cues'),generate=process.argv.includes('--generate');
 try{
  const {mountStudio,MAGIC_MOMENTS}=await import('../public/mf-studio.js?extra-magic-native-qa');
  assert.equal(MAGIC_MOMENTS.length,12);assert.deepEqual(MAGIC_MOMENTS.map(c=>c.id),MAGIC_CUES.map(c=>c.id));
  const official={drawn:[7,23,42],lastNumber:42,roundTitle:'Ronde 2',cards:[{id:'original-card'}],winners:[{id:'winner-on-server'}]};
  const errors=[];
  studio=mountStudio(new Surface('div'),{onFrameRendered:state=>rendered.push(state.outputVersion),onAssetError:(id,e)=>errors.push(`${id}: ${e.message}`),state:{outputVersion:{generation:'fixture-generation',seq:5},...structuredClone(official),hostId:'milo',camera:'magic',movingCamera:false,paused:true,showRoundTitle:false,showCaptions:false,blink:false}});
  const preload=studio.preload(['milo']);tick();assert.equal(rendered.length,0,'Incomplete actor/assets cannot acknowledge a published frame');await preload;assert(studio.snapshot().characterRigs.milo,'One preload must await the in-flight actor and manifest');tick();assert.deepEqual(rendered.at(-1),{generation:'fixture-generation',seq:5});assert.deepEqual(errors,[]);assert(studio.snapshot().ready);assert.equal(studio.snapshot().characterRigs.milo.kind,'articulated');
  const sheet=createCanvas(1280,5*382),sc=sheet.getContext('2d'),hashes=new Set();sc.fillStyle='#160b28';sc.fillRect(0,0,sheet.width,sheet.height);
  if(generate){await mkdir(output,{recursive:true});await mkdir(previewDir,{recursive:true});}
  for(let i=0;i<EXTRA_MAGIC_IDS.length;i++){
   const id=EXTRA_MAGIC_IDS[i],cue=getMagicCue(id),elapsed=cue.duration*(id==='cookie-mystery'?.81:.70);
   const packet={id,startedAt:'preview-'+id,elapsed:elapsed*1000,duration:cue.duration,playing:true};
   studio.update({magic:packet,movement:{id:'magic',instanceId:'preview-'+id,source:'preview',paused:true,elapsed,duration:cue.duration}});
   const a=tick(),snap=studio.snapshot();
   assert.equal(snap.magic.id,id);assert.equal(snap.magic.duration,cue.duration);assert(Math.abs(snap.magic.elapsed-elapsed)<1e-6);assert(a.equals(tick()),id+' paused cue must hold exact pixels');
   studio.update({magic:packet});assert(a.equals(tick()),id+' repeated source snapshot must not reroll/restart');
   for(const [key,value]of Object.entries(official))assert.deepEqual(snap.state[key],value,'Magic cannot change '+key);
   hashes.add(digest(studio.canvas));
   const x=(i%2)*640,y=Math.floor(i/2)*382;
   sc.drawImage(studio.canvas,x,y,640,360);sc.fillStyle='#ffe4a6';sc.font='600 15px "Trebuchet MS"';sc.textAlign='left';sc.fillText(cue.title,x+14,y+377);
   if(generate){const thumb=createCanvas(640,360);thumb.getContext('2d').drawImage(studio.canvas,0,0,640,360);await writeFile(resolve(previewDir,id+'.webp'),thumb.toBuffer('image/webp',88));await writeFile(resolve(output,id+'.png'),studio.canvas.toBuffer('image/png'));}
  }
  assert.equal(hashes.size,10,'Real studio output must show ten different acts');
  studio.update({magic:{id:'flower-hat',startedAt:'preview-short',elapsed:2100,duration:3,playing:true},movement:{id:'magic',instanceId:'preview-short',source:'preview',paused:true,elapsed:2.1,duration:3}});tick();assert.equal(studio.snapshot().magic.duration,3,'Explicit shortened rundown duration remains honored');
  studio.update({magic:null,movement:null});tick();assert.equal(studio.snapshot().magic,null);
  if(generate)await writeFile(resolve(output,'magic-contact-sheet.jpg'),sheet.toBuffer('image/jpeg',88));
  console.log(JSON.stringify({renderer:'actual mountStudio + articulated Milo + approved decor',acts:10,distinctFrames:hashes.size,paused:'identical pixels',state:'unchanged',thumbnails:generate?previewDir:'pass --generate to write',contactSheet:generate?resolve(output,'magic-contact-sheet.jpg'):null}));
 }finally{studio?.destroy();for(const k of keys)originals[k]===undefined?delete globalThis[k]:globalThis[k]=originals[k];}
});
