import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareCharacter,gestureDuration} from '../public/character-3d.js';
const input=new URL('../public/assets/vlampie-presenter-v9-animated.glb',import.meta.url);
const bytes=fs.readFileSync(input),loader=new GLTFLoader();
loader.register(()=>({name:'texture-stub',loadTexture:()=>Promise.resolve(new THREE.Texture())}));
const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const expected=['Idle','Wave','Welcome','Cheer','Think','Bow','Walking','Running'];
assert.deepEqual(gltf.animations.map(c=>c.name),expected);
const c=prepareCharacter(gltf);assert.equal(c.smartRig,true);assert.equal(c.rest.size,29);assert.equal(c.rigProfile,'smart-rig-29');assert.equal(c.bones.Head.name,'Bone_017');assert.equal(c.bones.LeftArm.name,'Bone_027');
assert.equal(c.triangleCount,31050);assert(bytes.length<25*1024*1024);
const bones=[...c.rest.keys()],point=new THREE.Vector3();let frames=0,maxHeight=0,minFloor=Infinity;
function verifyVertices(label){
 c.root.updateMatrixWorld(true);const box=new THREE.Box3();
 for(const mesh of c.skins)for(let i=0;i<mesh.geometry.attributes.position.count;i++){
  mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld);
  assert(Number.isFinite(point.x+point.y+point.z),`${label}: nonfinite vertex`);box.expandByPoint(point);
 }
 assert(box.max.y<3.2&&box.min.y>-.025,`${label}: unexpected height/floor ${box.min.y}, ${box.max.y}`);
 assert(box.max.x-box.min.x<3.6,`${label}: unexpectedly stretched silhouette`);
 minFloor=Math.min(minFloor,box.min.y);maxHeight=Math.max(maxHeight,box.max.y);frames++;
}
for(const motion of ['idle','wave','welcome','cheer','think','bow']){
 c.update(1/60,{motion,age:motion==='idle'?0:gestureDuration[motion]/2,idle:false,energy:85,immediate:true});verifyVertices(motion);
}
for(const clip of ['Walking','Running']){
 const duration=c.actions[clip].getClip().duration;
 for(const phase of [0,.25,.5,.75,.999]){c.setClip('');c.setClip(clip);c.update(duration*phase/(.7+.65*.45),{clip,energy:65,immediate:true});verifyVertices(`${clip} ${phase}`);}
}
for(const clip of ['Walking','Running'])for(let i=0;i<90;i++){c.update(1/60,{clip,energy:65});if(i%30===29)verifyVertices(`${clip} blended ${i}`);}
c.update(1/60,{motion:'wave',age:1800,idle:false,immediate:true});
const stopped=bones.map(b=>b.quaternion.toArray());
c.update(1,{motion:'idle',stopped:true});assert.deepEqual(bones.map(b=>b.quaternion.toArray()),stopped,'Stop must freeze the pose');
const before=bones.map(b=>b.quaternion.clone());
c.update(1/60,{motion:'cheer',age:0,idle:false});
const step=Math.max(...bones.map((b,i)=>b.quaternion.angleTo(before[i])));assert(step<.35,'Interrupted gesture should blend, not snap');
for(const clip of gltf.animations)for(const track of clip.tracks){
 assert([...track.values].every(Number.isFinite));
 for(let i=1;i<track.times.length;i++)assert(track.times[i]>track.times[i-1]);
 const stride=track.getValueSize();
 if(track.name.endsWith('.quaternion')){
  const first=new THREE.Quaternion().fromArray(track.values),last=new THREE.Quaternion().fromArray(track.values,track.values.length-stride);
  assert(first.angleTo(last)<.001,`${clip.name}: loop seam`);
 }
}
console.log(JSON.stringify({status:'passed',clips:expected,posedFrames:frames,vertexCount:c.skins[0].geometry.attributes.position.count,minFloor,maxHeight,stopFreezesPose:true,interruptionMaxDegrees:THREE.MathUtils.radToDeg(step),webGLVerified:false}));
