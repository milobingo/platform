import {canvasRuntime} from './canvas-runtime.mjs';
// Actual mountStudio + actual approved Milo/scenery bitmaps rendered by native
// Canvas. This verifies wiring/pixels locally; it does not certify browser audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCanvas} from './check-milo-puppet-render.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {Image:NativeImage}=canvasRuntime;
const assetPath=url=>{assert(String(url).startsWith('/assets/'),'Only local project assets may load');return resolve(root,'public',String(url).slice(1));};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const pixels=canvas=>Buffer.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data);
function changed(a,b){let count=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>40)count++;return count;}

test('real studio wires articulated Milo to preview, movement, speech and held-show clocks',async()=>{
 const keys=['document','window','Image','fetch','requestAnimationFrame','cancelAnimationFrame','CustomEvent','ResizeObserver'];
 const originals=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
 class Surface{
  constructor(tag){this.tagName=tag;this.children=[];}
  append(...nodes){this.children.push(...nodes);}appendChild(node){this.children.push(node);return node;}
  setAttribute(){}remove(){}dispatchEvent(){}
  getBoundingClientRect(){return {width:1280,height:720};}
 }
 class LocalImage extends NativeImage{set src(value){super.src=readFileSync(assetPath(value));}get src(){return super.src;}}
 globalThis.document={createElement(tag){if(tag!=='canvas')return new Surface(tag);const canvas=createCanvas(1,1);canvas.setAttribute=()=>{};return canvas;}};
 globalThis.window={devicePixelRatio:1,addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})};
 globalThis.Image=LocalImage;globalThis.ResizeObserver=undefined;globalThis.CustomEvent=class{};
 globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await readFile(assetPath(url),'utf8'))});
 let nextFrame,now=100,cancelled=false;
 globalThis.requestAnimationFrame=callback=>{nextFrame=callback;return 1;};
 globalThis.cancelAnimationFrame=()=>{cancelled=true;};
 let studio;
 try{
  const {mountStudio}=await import('../public/mf-studio.js?native-milo-integration');
  const errors=[];
  studio=mountStudio(new Surface('div'),{onAssetError:(id,error)=>errors.push(`${id}: ${error.message}`),state:{hostId:'milo',camera:'host',movingCamera:false,paused:true,showRoundTitle:false,showCaptions:false,blink:false,drawn:[7,23,42],lastNumber:42}});
  // Manifest loading can replace an initially loaded rig; await those turns as
  // well as scenic readiness so this never accidentally tests the placeholder.
  await studio.preload(['milo']);await turn();await studio.preload(['milo']);await turn();
  assert.deepEqual(errors,[],'All actual project images must load');
  const initial=studio.snapshot();
  assert(initial.ready);assert.deepEqual(initial.characters,['milo']);
  assert.equal(initial.characterRigs.milo.kind,'articulated');
  assert(initial.characterRigs.milo.parts>=12);assert(initial.characterRigs.milo.joints>=15);
  assert.equal(initial.presenterLayout.height,370,'Animation must not enlarge Milo');
  const tick=(count=1)=>{let result;for(let i=0;i<count;i++){nextFrame(now+=40);result=pixels(studio.canvas);}return result;};
  const idle=tick(),held=studio.snapshot();
  const preview=elapsed=>({id:'wave',instanceId:'native-wave',source:'preview',paused:true,elapsed,duration:4.8});
  studio.update({motion:'wave',movement:preview(1.1)});const wave=tick();
  const waveChange=changed(idle,wave);assert(waveChange>1000,'Actual studio pixels must visibly articulate Milo’s wave');
  assert.equal(studio.snapshot().time,held.time);assert.equal(studio.snapshot().performerTime,held.performerTime);
  studio.update({motion:'wave',movement:preview(1.4)});const wrist=tick();
  const wristChange=changed(wave,wrist);assert(wristChange>100,'Paused preview seeks must update the visible elbow/wrist');
  assert.equal(studio.snapshot().movement.elapsed,1.4,'Preview timestamp must remain exact');
  assert(wrist.equals(tick(4)),'Unchanged paused preview must hold exactly the same pixels');

  // The engine activates the stage while a manual cue plays even when the
  // rundown is held; verify that exact stage-level route here.
  studio.update({paused:false,movement:{id:'wave',instanceId:'live-wave',elapsed:1.1,duration:4.8}});
  const movingStart=tick(),movementStart=studio.snapshot();const movingEnd=tick(10),movementEnd=studio.snapshot();
  assert(movementEnd.movement.elapsed>movementStart.movement.elapsed+.3);
  assert(movementEnd.performerTime>movementStart.performerTime+.3);
  assert(changed(movingStart,movingEnd)>100,'Live movement clock must reach the actual rendered joints');
  studio.update({paused:true});const frozen=tick(),freeze=studio.snapshot();
  assert(frozen.equals(tick(5)),'Stopping a movement must hold the exact studio pixels');
  assert.equal(studio.snapshot().movement.elapsed,freeze.movement.elapsed);assert.equal(studio.snapshot().performerTime,freeze.performerTime);

  studio.update({movement:null,motion:'idle',speaking:true,speechActive:true});
  const speechStart=tick(),beforeSpeech=studio.snapshot();const speechEnd=tick(14),afterSpeech=studio.snapshot();
  const speechChange=changed(speechStart,speechEnd);
  assert(speechChange>250,'Manual speech must animate real body/mouth pixels while the show is held');
  assert.equal(afterSpeech.time,freeze.time,'Speaking must not advance the paused show');
  assert(afterSpeech.performerTime>beforeSpeech.performerTime+.5,'Speech needs a live performer clock');
  assert.deepEqual(afterSpeech.state.drawn,[7,23,42],'Animation cannot alter the official drawn numbers');
  studio.update({speechActive:false});const heldSpeech=tick(),stopped=studio.snapshot();
  assert(heldSpeech.equals(tick(6)),'Pausing speech must freeze the performer and mouth exactly');
  assert.equal(studio.snapshot().performerTime,stopped.performerTime);
  studio.update({speaking:false});const closedMouth=tick();
  assert(closedMouth.equals(tick(3)),'After speech closes the mouth, the stopped character remains still');
  console.log(JSON.stringify({studio:'actual mountStudio',rig:initial.characterRigs.milo.kind,waveChangedPixels:waveChange,wristChangedPixels:wristChange,speechChangedPixels:speechChange,paused:'identical pixels',showTime:afterSpeech.time,performerTime:afterSpeech.performerTime}));
 }finally{
  studio?.destroy();assert(cancelled,'Unmount must cancel its frame loop');
  for(const key of keys)originals[key]===undefined?delete globalThis[key]:globalThis[key]=originals[key];
 }
});
