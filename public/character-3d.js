import * as THREE from 'three';

const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const smooth=x=>{x=THREE.MathUtils.clamp(x,0,1);return x*x*x*(x*(x*6-15)+10)};
export const gestureDuration={idle:Infinity,wave:4400,welcome:3600,cheer:5000,think:4100,bow:3600};
export const smartRigNames46={Hips:'Bone_001',Spine:'Bone_004',Spine1:'Bone_003',Spine2:'Bone_002',Neck:'Bone_017',Head:'Bone_016',LeftShoulder:'Bone_027',LeftArm:'Bone_026',LeftForeArm:'Bone_025',LeftHand:'Bone_024',RightShoulder:'Bone_022',RightArm:'Bone_021',RightForeArm:'Bone_020',RightHand:'Bone_019',LeftUpLeg:'Bone_009',LeftLeg:'Bone_008',LeftFoot:'Bone_007',LeftToeBase:'Bone_006',RightUpLeg:'Bone_014',RightLeg:'Bone_013',RightFoot:'Bone_012',RightToeBase:'Bone_011'};
export const smartRigNames29={"Hips":"Bone_001","Spine":"Bone_005","Spine1":"Bone_004","Spine2":"Bone_002","Neck":"Bone_018","Head":"Bone_017","LeftShoulder":"Bone_028","LeftArm":"Bone_027","LeftForeArm":"Bone_026","LeftHand":"Bone_025","RightShoulder":"Bone_023","RightArm":"Bone_022","RightForeArm":"Bone_021","RightHand":"Bone_020","LeftUpLeg":"Bone_010","LeftLeg":"Bone_009","LeftFoot":"Bone_008","LeftToeBase":"Bone_007","RightUpLeg":"Bone_015","RightLeg":"Bone_014","RightFoot":"Bone_013","RightToeBase":"Bone_012"};
export const smartRigNames=smartRigNames46;

export function prepareCharacter(gltf){
  const avatar=gltf.scene,root=new THREE.Group(),bones={},rest=new Map(),skins=[];
  root.name='Vlampie';root.add(avatar);
  avatar.traverse(o=>{if(o.isSkinnedMesh)skins.push(o);if(o.isBone)bones[o.name.replace(/^mixamorig[:_]?/,'')]=o;});
  const smartRig=!!bones.Bone_000;
  const rawBoneCount=Object.keys(bones).length;
  const rigProfile=smartRig?(rawBoneCount===29?'smart-rig-29':rawBoneCount===46?'smart-rig-46':'unsupported-smart-rig'):'named-humanoid';
  if(rigProfile==='unsupported-smart-rig')throw new Error(`Unsupported SmartRig profile: ${rawBoneCount} bones`);
  const rigNames=rigProfile==='smart-rig-29'?smartRigNames29:smartRigNames46;
  if(smartRig)for(const [name,source]of Object.entries(rigNames)){
    if(!bones[source])throw new Error(`Missing ${source} in ${rigProfile}`);
    bones[name]=bones[source];
  }
  skins.forEach(m=>m.skeleton.pose());root.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(root,true),size=box.getSize(V(0,0,0));
  const scale=2.7/size.y;root.scale.setScalar(scale);
  root.position.set(-(box.min.x+box.max.x)*scale/2,-box.min.y*scale,-(box.min.z+box.max.z)*scale/2);
  root.updateMatrixWorld(true);
  for(const b of new Set(Object.values(bones)))rest.set(b,{position:b.position.clone(),quaternion:b.quaternion.clone(),scale:b.scale.clone(),worldQ:b.getWorldQuaternion(new THREE.Quaternion()),worldP:b.getWorldPosition(V(0,0,0))});
  // Retain a small spatial sample of the soles for contact correction after pose blending.
  const footSamples=[],samplePoint=V(0,0,0);
  for(const mesh of skins){const cells=new Map();for(let i=0;i<mesh.geometry.attributes.position.count;i++){
    mesh.getVertexPosition(i,samplePoint).applyMatrix4(mesh.matrixWorld);if(samplePoint.y>.08)continue;
    const key=`${Math.floor(samplePoint.x/.045)},${Math.floor(samplePoint.z/.045)}`,prior=cells.get(key);
    if(!prior||samplePoint.y<prior.y)cells.set(key,{index:i,y:samplePoint.y});
  }for(const value of cells.values())footSamples.push({mesh,index:value.index});}
  const floorY=root.position.y,mixer=new THREE.AnimationMixer(avatar),actions={};
  for(const original of gltf.animations){
    const clip=original.clone();
    for(const track of clip.tracks){
      if(!smartRig&&bones.Hips&&track.name===`${bones.Hips.name}.position`)for(let i=0;i<track.values.length;i+=3){track.values[i]=rest.get(bones.Hips).position.x;track.values[i+2]=rest.get(bones.Hips).position.z;}
    }
    actions[clip.name]=mixer.clipAction(clip);
  }
  function resetPose(){for(const [b,r]of rest){b.position.copy(r.position);b.quaternion.copy(r.quaternion);b.scale.copy(r.scale);}root.updateMatrixWorld(true);}
  function aim(name,child,direction,weight=1){
    const b=bones[name],c=bones[child];if(!b||!c)return;
    const r=rest.get(b),cr=rest.get(c),original=cr.worldP.clone().sub(r.worldP).normalize();
    const q=new THREE.Quaternion().setFromUnitVectors(original,direction.clone().normalize()).multiply(r.worldQ);
    q.premultiply(b.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    b.quaternion.slerp(q,weight);b.updateWorldMatrix(false,true);
  }
  function turn(name,axis,angle){
    const b=bones[name];if(!b||!angle)return;
    const q=new THREE.Quaternion().setFromAxisAngle(axis,angle).multiply(b.getWorldQuaternion(new THREE.Quaternion()));
    b.quaternion.copy(b.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));b.updateWorldMatrix(false,true);
  }
  let active='',initialized=false;
  function setClip(name){
    if(active===name)return;
    mixer.stopAllAction();resetPose();active=actions[name]?name:'';
    if(active)actions[active].reset().setEffectiveWeight(1).play();
  }
  function update(delta,{clip='',motion='idle',age=0,energy=65,idle=true,time=0,speaking=false,stopped=false,immediate=false}={}){
    if(stopped)return;
    const previous=new Map([...rest.keys()].map(b=>[b,{position:b.position.clone(),quaternion:b.quaternion.clone()}]));
    setClip(clip);resetPose();root.position.y=floorY;
    if(active){mixer.timeScale=.7+energy/100*.45;mixer.update(delta);}
    else{
      const e=.6+energy/100*.6;
      if(idle){turn('Spine',V(1,0,0),Math.sin(time*1.7)*.006*e);turn('Spine1',V(0,0,1),Math.sin(time*.75)*.009*e);}
      const duration=gestureDuration[motion]??4000;
      const blend=motion==='idle'?0:smooth(age/800)*smooth((duration-age)/850)*(.72+Math.min(energy,85)/300);
      const swing=idle?Math.sin(time*1.3)*.012:0;
      const targets={LeftArm:V(.23,-1,.035+swing),RightArm:V(-.23,-1,.035-swing),LeftForeArm:V(.12,-1,.10),RightForeArm:V(-.12,-1,.10)};
      const apply=(name,x,y,z)=>{
        const from=targets[name].normalize(),to=V(x,y,z).normalize();
        const rotation=new THREE.Quaternion().setFromUnitVectors(from,to);
        from.applyQuaternion(new THREE.Quaternion().slerp(rotation,blend));
      };
      // Friendly gestures stay below shoulder height to protect the jacket's silhouette.
      if(motion==='wave'){apply('RightArm',-.68,-.46,.1);apply('RightForeArm',-.13+Math.sin(age*.0065)*.16,.96,.22);}
      if(motion==='welcome'){apply('LeftArm',.50,-.83,.13);apply('RightArm',-.50,-.83,.13);apply('LeftForeArm',.50,-.22,.74);apply('RightForeArm',-.50,-.22,.74);}
      if(motion==='cheer'){apply('LeftArm',.59,-.43,.10);apply('RightArm',-.59,-.43,.10);apply('LeftForeArm',.13,.98,.15);apply('RightForeArm',-.13,.98,.15);turn('Spine1',V(0,0,1),Math.sin(age*.005)*blend*.025);}
      if(motion==='think'){apply('RightArm',-.28,-.86,.22);apply('RightForeArm',.26,.73,.51);turn('Head',V(0,1,0),blend*.10);turn('Head',V(0,0,1),blend*-.035);}
      if(motion==='bow'){turn('Spine',V(1,0,0),blend*.12);turn('Spine1',V(1,0,0),blend*.08);turn('Head',V(1,0,0),blend*.06);}
      aim('LeftArm','LeftForeArm',targets.LeftArm);aim('RightArm','RightForeArm',targets.RightArm);
      aim('LeftForeArm','LeftHand',targets.LeftForeArm);aim('RightForeArm','RightHand',targets.RightForeArm);
      if(motion==='wave')turn('RightHand',V(0,0,1),Math.sin(age*.0065)*blend*.075);
      if(idle)turn('Head',V(0,1,0),Math.sin(time*.57)*.028);
      if(speaking){turn('Head',V(1,0,0),Math.sin(time*5.5)*.014);turn('Spine2',V(0,1,0),Math.sin(time*2.4)*.009);}
    }
    // Blend from the actual previous pose, including interrupted gestures and clips.
    if(initialized&&!immediate){const a=1-Math.exp(-Math.min(delta,.1)/.11);for(const [b,p]of previous){b.quaternion.slerpQuaternions(p.quaternion,b.quaternion.clone(),a);b.position.lerpVectors(p.position,b.position.clone(),a);}}
    initialized=true;root.updateMatrixWorld(true);
    if(footSamples.length){let lowest=Infinity;for(const {mesh,index}of footSamples){mesh.getVertexPosition(index,samplePoint).applyMatrix4(mesh.matrixWorld);lowest=Math.min(lowest,samplePoint.y);}
      if(lowest<0){root.position.y-=lowest;root.updateMatrixWorld(true);}
    }
  }
  return {root,avatar,bones,skins,rest,mixer,actions,smartRig,rigProfile,resetPose,setClip,update,triangleCount:skins.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0)};
}
