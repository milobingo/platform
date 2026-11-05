import * as THREE from 'three';

// Bright softboxes separated by dark space give brass and glass readable reflections.
export function createStudioEnvironment(){
 const room=new THREE.Scene();room.background=new THREE.Color('#0b1120');
 const panel=(width,height,color,intensity,position)=>{
  const material=new THREE.MeshBasicMaterial({color:new THREE.Color(color).multiplyScalar(intensity),side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,height),material);mesh.position.set(...position);mesh.lookAt(0,0,0);room.add(mesh);
 };
 panel(6,5,'#fff5e3',5,[-5,4,5]);panel(3,7,'#e5edff',4,[6,2,3]);
 panel(7,3,'#ffffff',3,[0,7,-1]);panel(5,1.4,'#ffc57e',3.5,[-3,1,-6]);
 panel(2,6,'#5578ed',1.7,[5,0,-5]);panel(7,.7,'#ffffff',2,[0,-2,6]);
 return room;
}

export function addStudioLights(scene){
 scene.add(new THREE.HemisphereLight('#d2e3ff','#10152b',.62));
 const key=new THREE.DirectionalLight('#fff0d8',2.9);key.position.set(-3,7,6);key.castShadow=true;
 key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-8,right:8,top:8,bottom:-5,near:.5,far:24});key.shadow.normalBias=.03;key.shadow.bias=-.0001;scene.add(key);
 const fill=new THREE.DirectionalLight('#bfd2ff',1.15);fill.position.set(5,4,4);scene.add(fill);
 const rim=new THREE.DirectionalLight('#ffd591',2.8);rim.position.set(-1,5,-4);scene.add(rim);
 const spot=(color,intensity,position,target,angle)=>{
  const light=new THREE.SpotLight(color,intensity,18,angle,.65,2);light.position.set(...position);light.target.position.set(...target);scene.add(light,light.target);return light;
 };
 spot('#ffe0a4',65,[-3,6.1,3],[-1.95,.8,2],.46);
 spot('#e9f2ff',65,[4.5,6.1,2],[3.9,2.4,.45],.50);
 for(const x of [-5.3,-2.5,2.5,5.3])spot('#285eff',22,[x,.35,-3.35],[x,3.3,-4.55],.5);
}

export function finishDecor(root){
 root.traverse(o=>{if(!o.isMesh)return;const m=o.material,lit=m.emissive&&m.emissive.getHex()!==0;
  o.castShadow=!lit;o.receiveShadow=!lit;
  if(/Royal blue — enamel|Midnight blue — painted structure/i.test(m.name)){
   const finish=new THREE.MeshPhysicalMaterial({name:m.name,color:m.color,metalness:.34,roughness:.25,clearcoat:.55,clearcoatRoughness:.2});o.material=finish;m.dispose();
  }
 });
}
