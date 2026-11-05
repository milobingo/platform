import * as THREE from 'three';

export const HOST_POSITION=new THREE.Vector3(-1.95,0,2.0);
export const HOST_SCALE=1.28;
export const MACHINE_POSITION=new THREE.Vector3(3.9,.025,.45);
export const MACHINE_SCALE=1.32;
const GOLD='#e6ba6e',BLUE='#093596';
export class ShowtimeStage{
 constructor({canvasFactory=()=>document.createElement('canvas')}={}){
  this.root=new THREE.Group();this.root.name='Showtime';this.time=0;this.number=42;this.drawAge=Infinity;this.canvasFactory=canvasFactory;
  this.gold=new THREE.MeshStandardMaterial({color:GOLD,metalness:.82,roughness:.22});
  this.blue=new THREE.MeshPhysicalMaterial({color:BLUE,metalness:.32,roughness:.25,clearcoat:.65,clearcoatRoughness:.2});
  this.light=new THREE.MeshStandardMaterial({color:'#fff0c1',emissive:'#ffc56c',emissiveIntensity:3.2,roughness:.3});
  this.makeMachine();this.makeRig();
 }
 mesh(geometry,material,parent,x=0,y=0,z=0){const o=new THREE.Mesh(geometry,material);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;}
 makeMachine(){
  const group=new THREE.Group();group.name='BingoMachine';group.position.copy(MACHINE_POSITION);group.scale.setScalar(MACHINE_SCALE);this.root.add(group);this.machine=group;
  // A separate plinth supports the enlarged machine across the podium's edge.
  const supportHeight=(MACHINE_POSITION.y+.48)/MACHINE_SCALE;
  this.mesh(new THREE.CylinderGeometry(1.30,1.36,supportHeight,96),this.blue,group,0,-supportHeight/2,0);
  this.mesh(new THREE.CylinderGeometry(1.35,1.36,.045,96),this.gold,group,0,-supportHeight+.035,0);
  this.mesh(new THREE.CylinderGeometry(1.34,1.34,.017,96),this.light,group,0,-supportHeight+.069,0);
  this.mesh(new THREE.CylinderGeometry(1.19,1.26,.16,64),this.gold,group,0,.08,0);
  this.mesh(new THREE.CylinderGeometry(1.10,1.17,.78,64),this.blue,group,0,.54,0);
  this.mesh(new THREE.CylinderGeometry(1.20,1.20,.09,64),this.gold,group,0,.985,0);
  this.mesh(new THREE.CylinderGeometry(1.13,1.13,.022,64),this.light,group,0,.89,0);
  for(let i=0;i<24;i++){const a=i*Math.PI/12;this.mesh(new THREE.CylinderGeometry(.025,.025,.62,8),this.gold,group,Math.sin(a)*1.12,.53,Math.cos(a)*1.12);}
  const star=new THREE.Shape();for(let i=0;i<10;i++){const a=Math.PI/2+i*Math.PI/5,r=i%2?.095:.215,x=Math.cos(a)*r,y=Math.sin(a)*r;i?star.lineTo(x,y):star.moveTo(x,y);}star.closePath();
  this.mesh(new THREE.ExtrudeGeometry(star,{depth:.025,bevelEnabled:true,bevelSize:.012,bevelThickness:.012,bevelSegments:2}),this.gold,group,0,.55,1.15);
  for(const x of [-.89,.89]){this.mesh(new THREE.CylinderGeometry(.038,.05,1.38,12),this.gold,group,x,1.67,0);this.mesh(new THREE.SphereGeometry(.09,12,8),this.gold,group,x,2.3,0);}
  const drum=new THREE.Group();drum.position.y=2.25;drum.name='GlassDrum';group.add(drum);this.drum=drum;
  const glass=new THREE.MeshPhysicalMaterial({color:'#e2edff',metalness:0,roughness:.045,transparent:true,opacity:.10,depthWrite:false,side:THREE.FrontSide,clearcoat:1,clearcoatRoughness:.035,envMapIntensity:1.7});
  const globe=this.mesh(new THREE.SphereGeometry(1.03,64,40),glass,drum);globe.castShadow=false;globe.receiveShadow=false;globe.renderOrder=3;
  this.cage=new THREE.Group();drum.add(this.cage);
  for(let i=0;i<3;i++){const ring=this.mesh(new THREE.TorusGeometry(1.045,.025,12,96),this.gold,this.cage);ring.rotation.y=i*Math.PI/3;}
  for(const h of [-.68,.68]){const ring=this.mesh(new THREE.TorusGeometry(Math.sqrt(1.03**2-h**2),.018,8,60),this.gold,drum,0,h,0);ring.rotation.x=Math.PI/2;}
  this.mesh(new THREE.CylinderGeometry(.14,.19,.15,32),this.gold,group,0,3.33,0);
  this.mesh(new THREE.SphereGeometry(.095,16,12),this.gold,group,0,3.47,0);
  this.mesh(new THREE.TorusGeometry(.17,.021,10,40),this.gold,group,0,3.48,0);
  this.balls=new THREE.InstancedMesh(new THREE.SphereGeometry(.125,16,12),new THREE.MeshStandardMaterial({roughness:.28,metalness:.05}),36);this.balls.name='BingoBalls';this.balls.castShadow=true;this.balls.frustumCulled=false;drum.add(this.balls);
  const colors=['#eb5156','#2d83ea','#ffd264','#e8f0ff','#56b6a8','#a56eda'];for(let i=0;i<36;i++)this.balls.setColorAt(i,new THREE.Color(colors[i%colors.length]));
  this.ballLabels=[];
  for(let i=0;i<12;i++){
   const c=this.canvasFactory();c.width=c.height=96;const cx=c.getContext('2d');cx.fillStyle='#fff9e8';cx.beginPath();cx.arc(48,48,45,0,Math.PI*2);cx.fill();cx.fillStyle='#111b33';cx.font='bold 49px sans-serif';cx.textAlign='center';cx.textBaseline='middle';cx.fillText(String(i*5+3),48,51);
   const tx=new THREE.CanvasTexture(c);tx.colorSpace=THREE.SRGBColorSpace;
   const label=new THREE.Sprite(new THREE.SpriteMaterial({map:tx,depthWrite:false}));label.scale.set(.15,.15,1);drum.add(label);this.ballLabels.push(label);
  }
  const badge=new THREE.Group();badge.position.set(0,2.32,1.05);group.add(badge);
  this.mesh(new THREE.CylinderGeometry(.49,.49,.065,64),this.gold,badge).rotation.x=Math.PI/2;
  this.numberCanvas=this.canvasFactory();this.numberCanvas.width=this.numberCanvas.height=512;this.numberTexture=new THREE.CanvasTexture(this.numberCanvas);this.numberTexture.colorSpace=THREE.SRGBColorSpace;
  this.mesh(new THREE.CircleGeometry(.43,64),new THREE.MeshBasicMaterial({map:this.numberTexture,toneMapped:false}),badge,0,0,.04);
  this.badge=badge;this.setNumber(42);this.dummy=new THREE.Object3D();this.updateBalls(0);
 }
 makeRig(){
  const rig=new THREE.Group();rig.name='LightingRig';this.root.add(rig);
  const steel=new THREE.MeshStandardMaterial({color:'#263348',metalness:.8,roughness:.4});
  for(const z of [-2.9,1.5])for(const y of [6.2,6.52]){const truss=this.mesh(new THREE.CylinderGeometry(.045,.045,13.5,10),steel,rig,0,y,z);truss.rotation.z=Math.PI/2;}
  for(let x=-6.5;x<6.6;x+=.65)for(const z of [-2.9,1.5]){const bar=this.mesh(new THREE.CylinderGeometry(.02,.02,.71,6),steel,rig,x,6.36,z);bar.rotation.z=Math.PI/2-.46;}
  this.beams=[];this.spots=[];
  const beamMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,forceSinglePass:true,uniforms:{color:{value:new THREE.Color('#fbb968')},level:{value:.055}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec2 vUv; uniform vec3 color; uniform float level; void main(){float edge=pow(max(0.0,sin(vUv.x*3.14159265)),1.4);float a=pow(vUv.y,1.6)*edge*level; gl_FragColor=vec4(color,a);}' });
  const locations=[[-4.5,6.15,1.5],[0,6.15,1.5],[4.5,6.15,1.5],[-4.5,6.15,-2.9],[4.5,6.15,-2.9]];
  locations.forEach((p,i)=>{
   const mount=new THREE.Group();mount.position.set(...p);rig.add(mount);
   const target=new THREE.Vector3(i%2?2:-2,0,i<3?-.8:1.8),direction=target.clone().sub(mount.position).normalize();mount.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0),direction);
   this.mesh(new THREE.CylinderGeometry(.14,.18,.34,16),steel,mount,0,-.1,0);
   this.mesh(new THREE.CylinderGeometry(.135,.135,.02,16),this.light,mount,0,-.28,0);
   const mat=beamMaterial.clone();if(i%2)mat.uniforms.color.value.set('#83afff');
   const beam=this.mesh(new THREE.ConeGeometry(1.2,5.8,24,1,true),mat,mount,0,-3.18,0);beam.castShadow=false;beam.receiveShadow=false;beam.renderOrder=4;this.beams.push({mount,base:mount.quaternion.clone(),beam});
  });
 }
 setNumber(number){this.number=Math.max(1,Math.min(75,Math.round(number)));const ctx=this.numberCanvas.getContext('2d');ctx.fillStyle='#fff9e9';ctx.fillRect(0,0,512,512);ctx.strokeStyle='#ddbd73';ctx.lineWidth=8;ctx.beginPath();ctx.arc(256,256,237,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#07182d';ctx.font='800 270px Arial,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(this.number),256,273);this.numberTexture.needsUpdate=true;}
 draw(number,elapsed=0){this.nextNumber=number;this.drawAge=Math.max(0,elapsed);if(this.drawAge>=4.3)this.setNumber(number);}
 updateBalls(mix){
  const t=this.time;
  for(let i=0;i<36;i++){
   const phi=i*2.39996,r=.14+.64*Math.sqrt((i+.5)/36),x=Math.sin(phi)*r,z=Math.cos(phi)*r;
   const y=-.75+Math.floor(i/12)*.17;
   const airborne=new THREE.Vector3(Math.sin(phi+t*(1.2+i%3*.13))*.72,Math.sin(t*(2.1+i%4*.12)+i)*.61,Math.cos(phi+t*1.1)*.60);
   if(airborne.length()>.86)airborne.setLength(.86);
   this.dummy.position.set(x,y,z).lerp(airborne,mix);if(this.dummy.position.length()>.88)this.dummy.position.setLength(.88);this.dummy.rotation.set(t*mix,i,0);this.dummy.updateMatrix();this.balls.setMatrixAt(i,this.dummy.matrix);
   if(i<12)this.ballLabels[i].position.copy(this.dummy.position).add(new THREE.Vector3(0,0,.113));
  }this.balls.instanceMatrix.needsUpdate=true;
 }
 update(delta,{running=true,lightShow=true}={}){
  this.beams.forEach(({beam})=>{beam.visible=lightShow;});if(!running)return;this.time+=delta;this.drawAge+=delta;
  const mix=Number.isFinite(this.drawAge)?Math.max(0,Math.min(1,this.drawAge/.45,(4.3-this.drawAge)/.85)):0;
  this.cage.rotation.x+=delta*(mix*2.7+.08);this.cage.rotation.z=Math.sin(this.time*.35)*.06;
  this.updateBalls(mix);
  if(this.drawAge>=4.3&&this.nextNumber!=null){this.setNumber(this.nextNumber);this.nextNumber=null;}
  this.badge.scale.setScalar(1+(this.drawAge>4.3&&this.drawAge<5.4?Math.sin((this.drawAge-4.3)/1.1*Math.PI)*.10:0));
  this.beams.forEach(({mount,base,beam},i)=>{beam.visible=lightShow;mount.quaternion.copy(base);if(lightShow)mount.rotateZ(Math.sin(this.time*.2+i)*.08);});
 }
 dispose(){this.root.traverse(o=>{o.geometry?.dispose();const mats=o.material?(Array.isArray(o.material)?o.material:[o.material]):[];for(const m of mats){m.map?.dispose();m.dispose();}});}
}
