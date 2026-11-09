import {canvasRuntime} from './canvas-runtime.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {transform} from 'esbuild';
import {makeGame,activateBlock,reserveBall,commitBall} from '../server/bingo-model.js';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ShowtimeStage,MACHINE_SCALE,MACHINE_POSITION} from '../public/showtime-stage.js';
import {createStudioBackdrop} from '../public/studio-backdrop.js';
import {VlampieStudio3D,cameraPreset,CAMERA_NAMES} from '../public/studio-3d.js';
const {createCanvas}=canvasRuntime;
const bytes=fs.readFileSync(new URL('../public/assets/showtime-set.glb',import.meta.url));
const set=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
let meshes=0,triangles=0;set.scene.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;assert([...o.geometry.attributes.position.array].every(Number.isFinite));}});
assert(meshes<=20);assert(triangles<180000);
const manifest=JSON.parse(fs.readFileSync(new URL('../source-assets/showtime-set.manifest.json',import.meta.url)));
assert(manifest.parts.left_audience_tiers.max[0]<-4.9);assert(manifest.parts.right_audience_tiers.min[0]>4.9);
assert(manifest.parts.left_audience_tiers.min[0]>-8.6&&manifest.parts.right_audience_tiers.max[0]<8.6,'Audience must fit inside side walls');
const backdrop=createStudioBackdrop(new THREE.Texture());backdrop.updateMatrixWorld(true);
const wallBounds=new THREE.Box3().setFromObject(backdrop.getObjectByName('CurvedBlueStarWall'));
assert(wallBounds.max.z<=-3.99&&wallBounds.min.z<-4.7);assert(wallBounds.max.y>6.6);assert(backdrop.getObjectByName('LeftStudioWall')&&backdrop.getObjectByName('RightStudioWall'));
// Stable rendering uses a single direct scene pass and no render-to-texture floor.
const pipeline=fs.readFileSync(new URL('../public/studio-3d.js',import.meta.url),'utf8');
assert(!/EffectComposer|UnrealBloomPass|new Reflector/.test(pipeline));
let signLights=0;set.scene.traverse(o=>{if(!o.isMesh||!/marquee bulbs/i.test(o.material.name))return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)if(p.getZ(i)>-2.73&&p.getY(i)>2.85&&p.getY(i)<4)signLights++;});assert(signLights>100,'BINGO needs actual lights on the letter faces');
// Rear foundation and cap must not occupy the same depth as the stage top.
let foundationFaces=0;
set.scene.traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position,index=o.geometry.index;
 for(let i=0;i<(index?.count??p.count);i+=3){const v=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,index?index.getX(i+k):i+k));
  const ys=v.map(a=>a.y),xs=v.map(a=>a.x);
  if(o.geometry.attributes.normal.getY(index?index.getX(i):i)>.99&&Math.max(...xs)-Math.min(...xs)>10&&Math.max(...ys)-Math.min(...ys)<1e-6&&Math.abs(ys[0])<.03&&v.every(a=>a.z< -3.2&&a.z> -4.5)){
   foundationFaces++;assert(ys[0]<-.015,'Rear foundation must be below the stage, not coplanar');
  }
 }
});assert(foundationFaces>=4);
const floor={stage:new THREE.Group()};VlampieStudio3D.prototype.makeFloor.call(floor);floor.stage.updateMatrixWorld(true);
const surface=floor.stage.getObjectByName('PolishedStageFloor');assert(surface.material.isMeshPhysicalMaterial&&surface.receiveShadow);assert(surface.position.y>.015);assert(!floor.stage.children.some(o=>o.isReflector));
// A real resize may clear the canvas only when a replacement frame is drawn.
let rect={width:800.1,height:450.1},pixelRatio=1,cameraResets=0;const events=[];
const resizing={canvas:{getBoundingClientRect:()=>rect},renderer:{getPixelRatio:()=>pixelRatio,setPixelRatio:r=>{pixelRatio=r;events.push('ratio');},setSize(){events.push('size');},setRenderTarget:t=>assert.equal(t,null),render(){events.push('draw');}},scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(36,1,.15,90),preset:'wide',controls:{update(){}},set:{update(){}},setCamera(){cameraResets++;},applyPendingResize(){VlampieStudio3D.prototype.applyPendingResize.call(this);},failRendering(error){throw error;}};
VlampieStudio3D.prototype.resize.call(resizing);assert.deepEqual(events,[],'ResizeObserver must not clear the canvas');
VlampieStudio3D.prototype.render.call(resizing,0);assert.deepEqual(events,['size','draw']);assert.equal(cameraResets,1);
rect={width:800.2,height:450.2};VlampieStudio3D.prototype.resize.call(resizing);VlampieStudio3D.prototype.render.call(resizing,0);assert.equal(events.filter(x=>x==='size').length,1);
rect={width:3840,height:2160};VlampieStudio3D.prototype.resize.call(resizing);assert.equal(events.filter(x=>x==='size').length,1);VlampieStudio3D.prototype.render.call(resizing,0);assert.equal(events.at(-1),'draw');assert(resizing.viewWidth*resizing.viewHeight*pixelRatio**2<=2560*1440+.01);
const beforeLoss=events.length;resizing.contextLost=true;VlampieStudio3D.prototype.render.call(resizing,0);assert.equal(events.length,beforeLoss);resizing.contextLost=false;VlampieStudio3D.prototype.render.call(resizing,0);assert.equal(events.at(-1),'draw');
let recoveredError=false;resizing.character={update(){throw new Error('simulated animation fault');}};resizing.failRendering=()=>{recoveredError=true;};VlampieStudio3D.prototype.render.call(resizing,0);assert(recoveredError,'Animation faults must reach the viewer recovery handler');
const stage=new ShowtimeStage({canvasFactory:()=>createCanvas(512,512)});stage.draw(17);const matrix=new THREE.Matrix4(),position=new THREE.Vector3();
stage.root.updateMatrixWorld(true);const machineBounds=new THREE.Box3().setFromObject(stage.machine);assert.equal(stage.machine.scale.x,MACHINE_SCALE);assert(machineBounds.max.y>4.6);assert(Math.abs(machineBounds.min.y+.48)<.002,'Machine plinth must reach the studio floor');
for(const aspect of [16/9,4/3,9/16]){const pose=cameraPreset('machine',aspect),camera=new THREE.PerspectiveCamera(36,aspect,.15,90);camera.position.copy(pose.position);camera.lookAt(pose.target);camera.updateMatrixWorld(true);for(const y of [machineBounds.min.y,machineBounds.max.y]){const p=new THREE.Vector3(MACHINE_POSITION.x,y,MACHINE_POSITION.z).project(camera);assert(Math.abs(p.y)<1,'Machine close-up must include its new height');}}
for(let i=0;i<330;i++){stage.update(1/60);for(let j=0;j<stage.balls.count;j++){stage.balls.getMatrixAt(j,matrix);position.setFromMatrixPosition(matrix);assert(position.length()+.125<1.03,'Balls must stay inside the glass');}}
assert.equal(stage.number,17);assert.equal(stage.nextNumber,null);
const frozen=stage.time;stage.update(1,{running:false});assert.equal(stage.time,frozen);
let cameras=0;for(const aspect of [16/9,4/3,9/16])for(const name of CAMERA_NAMES){const c=cameraPreset(name,aspect);assert([...c.position,...c.target].every(Number.isFinite));assert(c.position.distanceTo(c.target)>1);cameras++;}
// /klassiek is a native redirect to the active React studio. The historical
// HTML fixture is not a production shell and cannot define its required IDs.
const require=createRequire(import.meta.url),route=fs.readFileSync(new URL('../app/klassiek/page.tsx',import.meta.url),'utf8'),routeModule={exports:{}};
const compiled=await transform(route,{loader:'tsx',format:'cjs'});
vm.runInNewContext(compiled.code,{module:routeModule,exports:routeModule.exports,require:id=>{assert.equal(id,'next/navigation');return require(id);}});
assert.throws(()=>routeModule.exports.default(),error=>error.digest==='NEXT_REDIRECT;replace;/;307;','The former classic URL must resolve to the active native studio');
// Reuse the actual React Stage integration, with only its renderer boundary
// mocked. It checks current UI settings, 14 camera bindings, pause and unmount
// disposal. The real GLB/physics/rendering checks above remain independent.
const activeUi=spawnSync(process.execPath,[new URL('./check-milo-ui.mjs',import.meta.url).pathname],{encoding:'utf8',timeout:30000,env:process.env});
assert.equal(activeUi.status,0,(activeUi.stdout||'')+(activeUi.stderr||'')+(activeUi.error?.message||''));assert.match(activeUi.stdout,/Vlampie adapter:.*14 cameras, mouth, pause and cleanup/);
// Keep the historical page-cache lifecycle regression explicitly scoped to its
// two registered handlers. Running the rest of an obsolete app initializer
// would require DOM that this native route intentionally no longer publishes.
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const lifecycleStart=app.indexOf("window.addEventListener('pagehide'"),lifecycleEnd=app.indexOf("document.addEventListener('visibilitychange'",lifecycleStart);assert(lifecycleStart>=0&&lifecycleEnd>lifecycleStart);
const pageEvents={},lifecycle={animationFrame:71,lastTime:0,performance:{now:()=>1234},disposals:0,scheduled:0,cancelled:0,updates:0,window:{addEventListener:(name,fn)=>{pageEvents[name]=fn;}},narration:{cancel(){}},$:()=>({value:'private-fixture-key'}),cancelChat(){},isShow:false,bingoHost:{dispose(){}},outputBridge:{dispose(){}},showTimer:0,clearInterval(){},showAudio:{dispose(){}},previewStudio:{dispose(){}},dashboard:{dispose(){}},stopSpeech(){},clearDemo(){},cancelAnimationFrame(){lifecycle.cancelled++;},requestAnimationFrame(){return ++lifecycle.scheduled;},draw(){},resizeObserver:{disconnect(){}},rig3D:{dispose(){lifecycle.disposals++;},resize(){}},channel:{close(){}},toolsLifecycle:{abort(){}},voiceList(){},updateUI(){lifecycle.updates++;}};
vm.createContext(lifecycle);vm.runInContext(app.slice(lifecycleStart,lifecycleEnd),lifecycle);
pageEvents.pagehide({persisted:true});assert.equal(lifecycle.disposals,0);pageEvents.pageshow({persisted:true});pageEvents.pageshow({persisted:true});assert.equal(lifecycle.scheduled,1);assert.equal(lifecycle.lastTime,1234);pageEvents.pagehide({persisted:false});assert.equal(lifecycle.disposals,1);
// The obsolete drawBingo UI helper now delegates. Test the official server
// reserve/commit boundary: a preview never counts and exact commit retry never
// appends twice, through all 75 unique balls and the exhausted-deck boundary.
const game=makeGame({brandId:'vlampie',date:'2027-12-05T19:00:00Z',roundCount:1},'showtime-fixture','https://studio.example');game.status='running';activateBlock(game,game.plan.blocks.findIndex(block=>block.type==='round'));
for(let i=0;i<75;i++){const pending=reserveBall(game);assert.equal(game.state.drawn.length,i);const committed=commitBall(game,pending.token);assert.equal(game.state.drawn.length,i+1);assert.deepEqual(commitBall(game,pending.token),committed);assert.equal(game.state.drawn.length,i+1);}
assert.equal(new Set(game.state.drawn).size,75);assert.deepEqual([...game.state.drawn].sort((a,b)=>a-b),Array.from({length:75},(_,index)=>index+1));assert.equal(game.state.pending,null);assert.throws(()=>reserveBall(game),/Alle 75 ballen/);
console.log(JSON.stringify({status:'passed',setMeshes:meshes,setTriangles:triangles,cameraChecks:cameras,foundationFaces,directRendering:true,signLights,queuedResize:true,pixelBudget:true,renderFailureRecovery:true,browserCacheRecovery:true,legacyPageCacheHandlers:true,activeNativeRedirect:true,activeReactStageBindings:true,ballsStayInside:true,drawsWithoutRepetition:75,officialReserveCommit:true,numberReveal:true,pause:true,browserVerified:false}));
