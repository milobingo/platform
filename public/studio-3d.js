import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {prepareCharacter} from './character-3d.js?v=36';
import {ShowtimeStage,HOST_POSITION,HOST_SCALE,MACHINE_POSITION,MACHINE_SCALE} from './showtime-stage.js?v=36';
import {createStudioEnvironment,addStudioLights,finishDecor} from './studio-lighting.js?v=36';
import {createStudioBackdrop} from './studio-backdrop.js?v=36';
import {createIllustratedPresenter} from './illustrated-presenter.js?v=36';
import {createAudience,createDeskDisplay} from './studio-features.js?v=36';

export const CAMERA_NAMES=['wide','establish','desk','front','portrait','machine','audience','led','side','back','tour'];
export function cameraPreset(name,aspect,showtime=true,hostSpot='front'){
 const tan=Math.tan(THREE.MathUtils.degToRad(36)/2),host=showtime?(hostSpot==='desk'?new THREE.Vector3(-.4,0,-1.65):HOST_POSITION):new THREE.Vector3(),scale=showtime?(hostSpot==='desk'?1.08:HOST_SCALE):1;
 const fit=(target,width,height,lift=.25)=>{const d=Math.max(height/(2*tan),width/(2*tan*Math.max(aspect,.25)))*1.1;return {position:target.clone().add(new THREE.Vector3(0,lift,d)),target};};
 if(showtime&&name==='establish')return fit(new THREE.Vector3(0,2.45,-.3),18.7,7.8,2.9);
 if(showtime&&name==='desk')return fit(new THREE.Vector3(-.4,1.6,-.65),6.2,3.5,.5);
 if(showtime&&name==='led')return fit(new THREE.Vector3(-.4,.67,-.32),4.5,1.5,.1);
 if(showtime&&name==='audience'){const d=Math.max(4.8/(2*tan),5.5/(2*tan*Math.max(aspect,.25)))*1.07,target=new THREE.Vector3(-6.15,1.5,-.4);return {position:target.clone().add(new THREE.Vector3(d*.38,1.1,d*.7)),target};}
 if(name==='wide'||name==='tour'){
  if(!showtime)return cameraPreset('front',aspect,false);
  const d=Math.max(6.6/(2*tan),12.5/(2*tan*Math.max(aspect,.25)))*1.065;
  return {position:new THREE.Vector3(.35,1.83+d*.135,-.35+d),target:new THREE.Vector3(.35,2.08,-.35)};
 }
 if(name==='machine'){
  const d=Math.max((3.85*MACHINE_SCALE+.5)/(2*tan),3*MACHINE_SCALE/(2*tan*Math.max(aspect,.25)))*1.12;
  return {position:MACHINE_POSITION.clone().add(new THREE.Vector3(.4*MACHINE_SCALE,2.1*MACHINE_SCALE,d)),target:MACHINE_POSITION.clone().add(new THREE.Vector3(0,1.7*MACHINE_SCALE,0))};
 }
 const portrait=name==='portrait',height=(portrait?1.36:3.16)*scale,width=(portrait?1.20:2.16)*scale;
 const distance=Math.max(height/(2*tan),width/(2*tan*Math.max(aspect,.25)))*1.09;
 const target=host.clone().add(new THREE.Vector3(0,(portrait?2.08:1.4)*scale,0)),y=target.y+.12;
 const positions={front:[host.x,y,host.z+distance],portrait:[host.x,y,host.z+distance],side:[host.x+distance,y,host.z],back:showtime?[host.x-distance*.76,y+.48,host.z-distance*.61]:[host.x,y,host.z-distance]};
 return positions[name]?{position:new THREE.Vector3(...positions[name]),target}:null;
}

export class VlampieStudio3D{
 constructor(canvas,{onCameraChange=()=>{},onContextState=()=>{},onRenderFailure=()=>{}}={}){
  this.canvas=canvas;this.scene=new THREE.Scene();this.background='studio';this.onCameraChange=onCameraChange;this.onContextState=onContextState;this.onRenderFailure=onRenderFailure;this.contextLost=false;this.failed=false;this.preset='wide';this.presenter='illustrated';this.hostSpot='front';this.appearance='original';this.materialPairs=[];this.effects=true;this.effectsAvailable=true;this.tourTime=0;
  this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
  this.renderer.setPixelRatio(1);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.NeutralToneMapping;this.renderer.toneMappingExposure=1.05;
  this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  this.camera=new THREE.PerspectiveCamera(36,1,.15,90);
  this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;this.controls.dampingFactor=.075;this.controls.enablePan=false;this.controls.minDistance=1.7;this.controls.maxDistance=35;this.controls.maxPolarAngle=Math.PI*.485;this.controls.minPolarAngle=.35;
  this.controls.addEventListener('start',()=>{this.transition=null;this.preset='free';this.onCameraChange('free');});
  this.refreshEnvironment();
  this.handleContextLost=event=>{event.preventDefault();this.contextLost=true;this.onContextState(true);clearTimeout(this.contextTimer);this.contextTimer=setTimeout(()=>this.failRendering(new Error('WebGL context did not recover')),8000);};
  this.handleContextRestored=()=>{
   clearTimeout(this.contextTimer);if(this.failed)return;
   try{this.contextLost=false;this.refreshEnvironment();this.viewWidth=0;this.resize();this.render(0,{stopped:true});this.onContextState(false);}
   catch(error){this.failRendering(error);}
  };
  canvas.addEventListener('webglcontextlost',this.handleContextLost);
  canvas.addEventListener('webglcontextrestored',this.handleContextRestored);
  addStudioLights(this.scene);
  this.stage=new THREE.Group();this.stage.name='ShowtimeEnvironment';this.scene.add(this.stage);
  this.set=new ShowtimeStage();this.stage.add(this.set.root);this.deskDisplay=createDeskDisplay();this.stage.add(this.deskDisplay.root);
  this.hostMount=new THREE.Group();this.scene.add(this.hostMount);
  this.makeFloor();
  this.setBackground('studio');this.resize();this.setCamera('wide',false);this.ro=new ResizeObserver(()=>this.resize());this.ro.observe(canvas);
 }
 refreshEnvironment(){
  const pmrem=new THREE.PMREMGenerator(this.renderer),room=createStudioEnvironment();
  this.env?.dispose();this.env=pmrem.fromScene(room,.045);
  room.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});pmrem.dispose();
  this.scene.environment=this.env.texture;this.scene.environmentIntensity=.85;
 }
 makeFloor(){
  const outside=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.MeshStandardMaterial({color:'#071933',metalness:.4,roughness:.28}));outside.rotation.x=-Math.PI/2;outside.position.y=-.48;outside.receiveShadow=true;this.stage.add(outside);
  // A glossy material reflects the studio's fixed softboxes without rendering
  // the scene again inside its own draw. This removes offscreen floor/effect buffers.
  this.floorMaterial=new THREE.MeshPhysicalMaterial({color:'#081b40',metalness:.46,roughness:.25,clearcoat:.65,clearcoatRoughness:.22,envMapIntensity:1.0});
  const floor=new THREE.Mesh(new THREE.CircleGeometry(4.965,96),this.floorMaterial);
  floor.rotation.x=-Math.PI/2;floor.position.y=.018;floor.receiveShadow=true;floor.name='PolishedStageFloor';this.stage.add(floor);
 }
 async load(onProgress=()=>{}){
  const loader=new GLTFLoader(),textures=new THREE.TextureLoader();
  const [portrait,decor,backdrop,audience]=await Promise.all([textures.loadAsync('assets/vlampie-illustrated-v10.png'),loader.loadAsync('assets/showtime-set.glb?v=10'),textures.loadAsync('assets/showtime-star-backdrop.webp'),textures.loadAsync('assets/audience-atlas-v10.png')]);
  this.decor=decor.scene;this.stage.add(this.decor);finishDecor(this.decor);
  const anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());for(const tx of [portrait,backdrop,audience])tx.anisotropy=anisotropy;
  this.stage.add(createStudioBackdrop(backdrop));this.audience=createAudience(audience);this.stage.add(this.audience.root);
  this.illustrated=createIllustratedPresenter(portrait);this.illustrated.actions={};this.character=this.illustrated;this.hostMount.add(this.illustrated.root);this.character.update(0,{});
  this.setBackground(this.background);onProgress(100);this.render(0,{});return {animations:[],triangles:this.illustrated.triangleCount||0};
 }
 async loadModel(){
  if(this.modelCharacter)return this.modelCharacter;
  if(!this.modelPromise)this.modelPromise=(async()=>{const gltf=await new GLTFLoader().loadAsync('assets/vlampie-presenter-v9-animated.glb');
  this.modelCharacter=prepareCharacter(gltf);
  this.modelCharacter.avatar.traverse(o=>{if(o.isMesh){
   o.castShadow=true;o.receiveShadow=false;o.frustumCulled=false;const materials=Array.isArray(o.material)?o.material:[o.material];
   const original=materials.map(m=>{if(m.map)m.map.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());return new THREE.MeshBasicMaterial({map:m.map,color:m.color,side:m.side,transparent:m.transparent,opacity:m.opacity,alphaTest:m.alphaTest,toneMapped:false});});
   const studio=materials.map(m=>new THREE.MeshStandardMaterial({map:m.map,color:m.color,side:m.side,transparent:m.transparent,opacity:m.opacity,alphaTest:m.alphaTest,metalness:0,roughness:.9,envMapIntensity:.2}));
   this.materialPairs.push({mesh:o,original:Array.isArray(o.material)?original:original[0],studio:Array.isArray(o.material)?studio:studio[0]});for(const m of materials)m.dispose();
  }});
  this.setAppearance(this.appearance);this.hostMount.add(this.modelCharacter.root);this.modelCharacter.update(0,{});this.modelCharacter.root.visible=false;
  return this.modelCharacter;})();
  return this.modelPromise;
 }
 async setPresenter(value){
  const desired=value==='model'?'model':'illustrated';this.presenterRequest=desired;
  if(desired==='model')await this.loadModel();if(this.presenterRequest!==desired)return;
  this.presenter=desired;this.character=desired==='model'?this.modelCharacter:this.illustrated;
  if(this.illustrated)this.illustrated.root.visible=desired==='illustrated';if(this.modelCharacter)this.modelCharacter.root.visible=desired==='model';
 }
 setHostSpot(value){this.hostSpot=value==='desk'?'desk':'front';const studio=this.background==='studio';this.hostMount.position.copy(studio?(this.hostSpot==='desk'?new THREE.Vector3(-.4,0,-1.65):HOST_POSITION):new THREE.Vector3());this.hostMount.scale.setScalar(studio?(this.hostSpot==='desk'?1.08:HOST_SCALE):1);}
 // ResizeObserver and fullscreen callbacks only queue dimensions. Resizing a
 // canvas clears it, so apply the size immediately before drawing the same frame.
 resize(){const r=this.canvas.getBoundingClientRect(),width=Math.round(r.width),height=Math.round(r.height);if(!width||!height)return;this.pendingSize={width,height};}
 applyPendingResize(){
  const size=this.pendingSize;if(!size)return;this.pendingSize=null;
  const {width,height}=size,ratio=Math.min(globalThis.devicePixelRatio||1,1.5,Math.sqrt(2560*1440/(width*height)));
  if(this.viewWidth===width&&this.viewHeight===height&&this.viewPixelRatio===ratio)return;
  this.viewWidth=width;this.viewHeight=height;this.viewPixelRatio=ratio;
  if(this.renderer.getPixelRatio()!==ratio)this.renderer.setPixelRatio(ratio);
  this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
  if(this.preset&&this.preset!=='free')this.setCamera(this.preset,false);
 }
 setAppearance(value){this.appearance=value==='studio'?'studio':'original';for(const pair of this.materialPairs)pair.mesh.material=pair[this.appearance];}
 setEffects(value){this.effects=!!value;this.floorMaterial.envMapIntensity=this.effects?1:.25;this.floorMaterial.clearcoat=this.effects?.65:0;this.set.light.emissiveIntensity=this.effects?3.2:1.25;}
 setBackground(value){
  const changed=this.background!==value;this.background=value;const studio=value==='studio';this.stage.visible=studio;this.setHostSpot(this.hostSpot);
  this.scene.background=studio?new THREE.Color('#050b1b'):value==='blue'?new THREE.Color('#1946a7'):null;
  this.scene.fog=studio?new THREE.Fog('#050b1b',21,47):null;this.renderer.setClearAlpha(value==='transparent'?0:1);
  if(changed&&this.preset!=='free')this.setCamera(studio?this.preset:'front',false);
 }
 setCamera(name,animate=true){
  if(name==='desk')this.setHostSpot('desk');else if(['front','wide','establish','tour'].includes(name))this.setHostSpot('front');
  const pose=cameraPreset(name,this.camera.aspect,this.background==='studio',this.hostSpot);if(!pose)return;
  const {position,target}=pose;this.preset=name;
  if(animate)this.transition={from:this.camera.position.clone(),to:position,fromTarget:this.controls.target.clone(),target,age:0};
  else{this.transition=null;this.camera.position.copy(position);this.controls.target.copy(target);this.controls.update();}
  this.onCameraChange(name);
 }
 render(delta,state={}){
  if(this.contextLost||this.failed)return;
  try{this.applyPendingResize();
  if(this.transition){const t=this.transition;t.age+=delta;const u=Math.min(t.age/.9,1),s=u*u*(3-2*u);this.camera.position.lerpVectors(t.from,t.to,s);this.controls.target.lerpVectors(t.fromTarget,t.target,s);if(u===1)this.transition=null;}
  else if(this.preset==='tour'&&this.background==='studio'&&!state.stopped){this.tourTime+=delta;const pose=cameraPreset('wide',this.camera.aspect),radius=pose.position.distanceTo(pose.target),angle=Math.sin(this.tourTime*.12)*.35;this.controls.target.copy(pose.target);this.camera.position.set(pose.target.x+Math.sin(angle)*radius,pose.position.y+Math.sin(this.tourTime*.17)*.25,pose.target.z+Math.cos(angle)*radius);}
  this.character?.update(delta,state);this.illustrated?.setFacing(this.camera);
  this.audience?.update(state.time||0,this.camera,!state.stopped);this.deskDisplay?.update(state.bingoDrawn||[],state.bingoPending??null);
  if(Number.isFinite(state.bingoNumber)&&state.bingoPending==null&&this.set.number!==state.bingoNumber)this.set.setNumber(state.bingoNumber);
  if(Number.isFinite(state.bingoElapsed)){this.set.drawAge=state.bingoElapsed<5.5?state.bingoElapsed:Infinity;this.set.nextNumber=state.bingoPending??null;}
  this.set.update(delta,{running:!state.stopped,lightShow:state.lightShow!==false});this.controls.update();
  this.renderer.setRenderTarget(null);this.renderer.autoClear=true;this.renderer.render(this.scene,this.camera);}
  catch(error){if(!this.contextLost)this.failRendering(error);}
 }
 failRendering(error){if(this.failed)return;this.failed=true;console.warn('Studio rendering unavailable',error);this.onRenderFailure();}
 dispose(){
  clearTimeout(this.contextTimer);this.ro?.disconnect();this.controls.dispose();this.canvas.removeEventListener('webglcontextlost',this.handleContextLost);this.canvas.removeEventListener('webglcontextrestored',this.handleContextRestored);
  for(const pair of this.materialPairs)for(const key of ['original','studio'])for(const m of Array.isArray(pair[key])?pair[key]:[pair[key]])m.dispose();
  this.scene.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose();}});this.env.dispose();this.renderer.dispose();
 }
}
