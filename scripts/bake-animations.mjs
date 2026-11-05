import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const siteDir=process.env.VLAMPIE_SITE_DIR||(fs.existsSync(path.resolve(scriptDir,'../node_modules/three'))?path.resolve(scriptDir,'..'):'/workspace/sites/vlampie-studio');
const THREE=await import(pathToFileURL(path.join(siteDir,'node_modules/three/build/three.module.js')));
const {GLTFLoader}=await import(pathToFileURL(path.join(siteDir,'node_modules/three/examples/jsm/loaders/GLTFLoader.js')));
const modulePath=process.env.VLAMPIE_CHARACTER_MODULE||path.join(siteDir,'public/character-3d.js');
const {prepareCharacter,gestureDuration,smartRigNames}=await import(pathToFileURL(modulePath));

const defaultDir='/workspace/scratch/159666656eb7/new-vlampie';
const source=process.argv[2]||`${defaultDir}/character-base.glb`;
const locomotionSource=process.argv[3]||path.join(siteDir,'legacy/assets/vlampie-animated.glb');
const output=process.argv[4]||`${defaultDir}/vlampie-presenter-animated.glb`;
const dir=path.dirname(path.resolve(output));fs.mkdirSync(dir,{recursive:true});
const fps=30;
function unpack(path){const bytes=fs.readFileSync(path);let json,bin;for(let off=12;off<bytes.length;){const len=bytes.readUInt32LE(off),type=bytes.readUInt32LE(off+4),data=bytes.subarray(off+8,off+8+len);if(type===0x4e4f534a)json=JSON.parse(data);if(type===0x004e4942)bin=data;off+=8+len;}return {bytes,json,bin};}
async function load(path){const {bytes}=unpack(path);const loader=new GLTFLoader();loader.register(()=>({name:'texture-stub',loadTexture(){return Promise.resolve(new THREE.Texture())}}));const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');return {gltf,c:prepareCharacter(gltf)};}
const original=unpack(source),target=await load(source),old=await load(locomotionSource),c=target.c;
const bones=[];c.avatar.traverse(o=>{if(o.isBone)bones.push(o);});
const semantics=Object.keys(smartRigNames);
const nodeIds=new Map(original.json.nodes.map((n,i)=>[n.name,i]));
const clips=[],reports=[];
const q=new THREE.Quaternion(),p=new THREE.Vector3();
const newRestHips=c.rest.get(c.bones.Hips),oldRestHips=old.c.rest.get(old.c.bones.Hips);
const footSets=c.skins.map(mesh=>{const geo=mesh.geometry,points=[];for(let i=0;i<geo.attributes.position.count;i++){mesh.getVertexPosition(i,p).applyMatrix4(mesh.matrixWorld);if(p.y<.24)points.push(i);}return {mesh,points};});
const oldFootSets=old.c.skins.map(mesh=>{const points=[];for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,p).applyMatrix4(mesh.matrixWorld);if(p.y<.24)points.push(i);}return {mesh,points};});
function minFeetY(sets=footSets){let y=Infinity;for(const {mesh,points}of sets)for(const i of points)y=Math.min(y,mesh.getVertexPosition(i,p).applyMatrix4(mesh.matrixWorld).y);return y;}
function allFinite(){for(const b of bones)if(![...b.position,...b.quaternion,...b.scale].every(Number.isFinite))return false;return true;}
function sampleTimes(duration){const times=Array.from({length:Math.floor(duration*fps)+1},(_,i)=>i/fps);if(duration-times.at(-1)>1e-6)times.push(duration);else times[times.length-1]=duration;return times;}
function sampleClip(name,duration,pose){const times=sampleTimes(duration),rotations=new Map(bones.map(b=>[b.name,[]])),positions=[];let minFoot=Infinity,maxFoot=-Infinity,minHipsX=Infinity,maxHipsX=-Infinity,minHipsZ=Infinity,maxHipsZ=-Infinity,finite=true,nonPelvisTranslationMax=0;
 for(const t of times){pose(t,duration);c.root.updateMatrixWorld(true);for(const b of bones){const out=rotations.get(b.name);b.quaternion.normalize();if(out.length&&out.slice(-4).reduce((s,x,i)=>s+x*b.quaternion.toArray()[i],0)<0)b.quaternion.set(-b.quaternion.x,-b.quaternion.y,-b.quaternion.z,-b.quaternion.w);out.push(...b.quaternion.toArray());if(b!==c.bones.Hips)nonPelvisTranslationMax=Math.max(nonPelvisTranslationMax,b.position.distanceTo(c.rest.get(b).position));}positions.push(...c.bones.Hips.position);c.bones.Hips.getWorldPosition(p);minHipsX=Math.min(minHipsX,p.x);maxHipsX=Math.max(maxHipsX,p.x);minHipsZ=Math.min(minHipsZ,p.z);maxHipsZ=Math.max(maxHipsZ,p.z);const fy=minFeetY();minFoot=Math.min(minFoot,fy);maxFoot=Math.max(maxFoot,fy);finite&&=allFinite();}
 let seamAngle=0,quatNormError=0,minQuaternionDot=1;for(const r of rotations.values()){seamAngle=Math.max(seamAngle,new THREE.Quaternion().fromArray(r,0).angleTo(new THREE.Quaternion().fromArray(r,r.length-4)));for(let i=0;i<r.length;i+=4){quatNormError=Math.max(quatNormError,Math.abs(Math.hypot(...r.slice(i,i+4))-1));if(i)minQuaternionDot=Math.min(minQuaternionDot,r.slice(i-4,i).reduce((sum,v,k)=>sum+v*r[i+k],0));}}
 const seamPosition=new THREE.Vector3().fromArray(positions).distanceTo(new THREE.Vector3().fromArray(positions,positions.length-3));
 clips.push({name,duration,times,rotations,positions});reports.push({name,duration,samples:times.length,sampleRate:fps,finalInterval:times.at(-1)-times.at(-2),allFinite:finite,quaternionNormMaxError:quatNormError,minimumAdjacentQuaternionDot:minQuaternionDot,seamMaxQuaternionAngleDegrees:THREE.MathUtils.radToDeg(seamAngle),seamPelvisPositionDistance:seamPosition,worldHipsHorizontalRange:{x:maxHipsX-minHipsX,z:maxHipsZ-minHipsZ},nonPelvisTranslationMaxDelta:nonPelvisTranslationMax,floor:{minFootY:minFoot,maxLowestFootY:maxFoot}});console.log(name,JSON.stringify(reports.at(-1)));}
for(const motion of ['idle','wave','welcome','cheer','think','bow']){const duration=motion==='idle'?6:gestureDuration[motion]/1000;sampleClip(motion[0].toUpperCase()+motion.slice(1),duration,(t,d)=>c.update(1/fps,{motion,age:t*1000,energy:65,idle:motion==='idle',time:motion==='idle'?Math.sin(2*Math.PI*t/d)*.9:0,immediate:true}));}
// Rest-world conjugation: q_new_world(t) = q_old_world(t) * inverse(q_old_rest_world) * q_new_rest_world.
// Local target translations remain untouched, except for the pelvis's in-place world-vertical motion.
const retargetSettings={verticalScale:.75,runningArmWeight:1,walkingArmWeight:1,loopBlendSeconds:1/30,floorCorrection:'upward only from target foot mesh minimum; preserve positive source airborne clearance at 0.75 scale'};
for(const clipName of ['Walking','Running']){
 const sourceClip=old.gltf.animations.find(a=>a.name===clipName);if(!sourceClip)throw new Error(`Missing source clip ${clipName}`);
 const mixer=new THREE.AnimationMixer(old.c.avatar),action=mixer.clipAction(sourceClip);action.play();action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;
 const duration=sourceClip.duration,armWeight=clipName==='Running'?retargetSettings.runningArmWeight:retargetSettings.walkingArmWeight;
 function retarget(t){action.reset().play();mixer.setTime(t);old.c.root.updateMatrixWorld(true);c.resetPose();
  for(const semantic of semantics){const src=old.c.bones[semantic],dst=c.bones[semantic];if(!src||!dst)continue;const targetQ=src.getWorldQuaternion(new THREE.Quaternion()).multiply(old.c.rest.get(src).worldQ.clone().invert()).multiply(c.rest.get(dst).worldQ).normalize();
   if(armWeight<1&&/Shoulder|Arm|Hand/.test(semantic))targetQ.slerpQuaternions(c.rest.get(dst).worldQ,targetQ,armWeight);
   dst.quaternion.copy(dst.parent.getWorldQuaternion(q).invert().multiply(targetQ)).normalize();dst.updateWorldMatrix(false,true);
  }
  old.c.bones.Hips.getWorldPosition(p);const dy=(p.y-oldRestHips.worldP.y)*retargetSettings.verticalScale;
  const localDelta=c.bones.Hips.parent.worldToLocal(newRestHips.worldP.clone().add(new THREE.Vector3(0,dy,0))).sub(newRestHips.position);
  c.bones.Hips.position.copy(newRestHips.position).add(localDelta);c.root.updateMatrixWorld(true);
  const sourceClearance=Math.max(0,minFeetY(oldFootSets))*retargetSettings.verticalScale;const floorRaise=Math.max(0,sourceClearance-minFeetY());if(floorRaise>0){const correctedWorld=c.bones.Hips.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,floorRaise,0));c.bones.Hips.position.copy(c.bones.Hips.parent.worldToLocal(correctedWorld));c.root.updateMatrixWorld(true);}
 }
 // End at the exact first frame. A short smooth tail closes small source-loop mismatches.
 retarget(0);const first=new Map(bones.map(b=>[b,{q:b.quaternion.clone(),p:b.position.clone()}]));
 sampleClip(clipName,duration,(t,d)=>{retarget(Math.min(t,d));const start=Math.max(0,d-retargetSettings.loopBlendSeconds);if(t>start){const raw=(t-start)/(d-start),blend=raw*raw*(3-2*raw);for(const b of bones){b.quaternion.slerp(first.get(b).q,blend);if(b===c.bones.Hips)b.position.lerp(first.get(b).p,blend);}c.root.updateMatrixWorld(true);}});
 mixer.stopAllAction();}
const g=structuredClone(original.json),segments=[original.bin],baseLength=original.bin.length;let binaryLength=baseLength;
g.bufferViews??=[];g.accessors??=[];g.animations=[];
g.extensionsUsed=Array.from(new Set([...(g.extensionsUsed||[]),'KHR_materials_unlit']));for(const material of g.materials||[]){material.extensions={...material.extensions,KHR_materials_unlit:{}};}
function appendFloat(values,type,min,max){const typed=new Float32Array(values),data=Buffer.from(typed.buffer);const padding=(4-binaryLength%4)%4;if(padding){segments.push(Buffer.alloc(padding));binaryLength+=padding;}const view=g.bufferViews.length;g.bufferViews.push({buffer:0,byteOffset:binaryLength,byteLength:data.length});segments.push(data);binaryLength+=data.length;const accessor={bufferView:view,componentType:5126,count:values.length/({SCALAR:1,VEC3:3,VEC4:4}[type]),type};if(min)accessor.min=min;if(max)accessor.max=max;g.accessors.push(accessor);return g.accessors.length-1;}
for(const clip of clips){const input=appendFloat(clip.times,'SCALAR',[0],[clip.duration]),animation={name:clip.name,samplers:[],channels:[],extras:{source:clip.name==='Walking'||clip.name==='Running'?'Retargeted with rest-world quaternion conjugation':'Baked from prepareCharacter procedural gesture',fps}};
 for(const b of bones){const output=appendFloat(clip.rotations.get(b.name),'VEC4'),sampler=animation.samplers.length;animation.samplers.push({input,output,interpolation:'LINEAR'});animation.channels.push({sampler,target:{node:nodeIds.get(b.name),path:'rotation'}});}
 const output=appendFloat(clip.positions,'VEC3'),sampler=animation.samplers.length;animation.samplers.push({input,output,interpolation:'LINEAR'});animation.channels.push({sampler,target:{node:nodeIds.get(c.bones.Hips.name),path:'translation'}});g.animations.push(animation);}
g.buffers=[{byteLength:binaryLength}];g.asset.generator=`Vlampie presenter animation baker; preserved source mesh, skin, texture and node data`;
const bin=Buffer.concat(segments),json=Buffer.from(JSON.stringify(g)),jsonPadding=(4-json.length%4)%4,binPadding=(4-bin.length%4)%4,total=12+8+json.length+jsonPadding+8+bin.length+binPadding,header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(total,8);header.writeUInt32LE(json.length+jsonPadding,12);header.writeUInt32LE(0x4e4f534a,16);const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(bin.length+binPadding,0);binHeader.writeUInt32LE(0x004e4942,4);fs.writeFileSync(output,Buffer.concat([header,json,Buffer.alloc(jsonPadding,32),binHeader,bin,Buffer.alloc(binPadding)]));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const report={source,locomotionSource,output,modulePath,fps,retargetSettings,boneCount:bones.length,vertexCount:c.skins.reduce((n,m)=>n+m.geometry.attributes.position.count,0),normalizationScale:c.root.scale.x,sourceGeometryTextureAndBindBytesPreserved:bin.subarray(0,baseLength).equals(original.bin),sourceBinarySha256:sha(original.bin),outputBytes:total,outputSha256:sha(fs.readFileSync(output)),rigProfile:c.rigProfile,staticFaceBones:c.rigProfile==='smart-rig-29'?[]:['Bone_015','Bone_028','Bone_029','Bone_030','Bone_031','Bone_032','Bone_033'],clips:reports};
const serialized={allChannelValuesFinite:true,maximumQuaternionNormErrorFloat32:0,maximumLoopSeamComponentDeltaFloat32:0,faceBoneMaximumLocalRotationVariation:0,channelsPerClip:bones.length+1,allEightClipsHaveAllBoneRotationsAndOnePelvisTranslation:g.animations.every(a=>a.channels.length===bones.length+1&&a.channels.filter(ch=>ch.target.path==='translation').length===1),KHR_materials_unlit:g.materials.every(m=>!!m.extensions.KHR_materials_unlit)};
for(const clip of clips)for(const [name,values]of [...clip.rotations,['pelvisPosition',clip.positions]]){const n=name==='pelvisPosition'?3:4,v=new Float32Array(values);serialized.allChannelValuesFinite&&=v.every(Number.isFinite);for(let k=0;k<n;k++)serialized.maximumLoopSeamComponentDeltaFloat32=Math.max(serialized.maximumLoopSeamComponentDeltaFloat32,Math.abs(v[k]-v[v.length-n+k]));if(n===4)for(let i=0;i<v.length;i+=4){serialized.maximumQuaternionNormErrorFloat32=Math.max(serialized.maximumQuaternionNormErrorFloat32,Math.abs(Math.hypot(...v.slice(i,i+4))-1));if(report.staticFaceBones.includes(name))for(let k=0;k<4;k++)serialized.faceBoneMaximumLocalRotationVariation=Math.max(serialized.faceBoneMaximumLocalRotationVariation,Math.abs(v[i+k]-v[k]));}}
report.serializedValidation=serialized;fs.writeFileSync(`${dir}/animation-report.json`,JSON.stringify(report,null,2));
console.log('Wrote',output,total);
