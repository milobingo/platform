import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const project=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const out=process.argv[2]?path.resolve(process.argv[2]):path.join(project,'public/assets');fs.mkdirSync(out,{recursive:true});
class NodeFileReader { readAsArrayBuffer(blob){blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.({target:this});});} readAsDataURL(blob){blob.arrayBuffer().then(v=>{this.result=`data:${blob.type};base64,${Buffer.from(v).toString('base64')}`;this.onloadend?.({target:this});});} }
globalThis.FileReader=NodeFileReader;
const scene=new THREE.Scene(); scene.name='SHOWTIME_static_environment';
const buckets=new Map(); const boundsByPart={}; let part='stage',placement=new THREE.Matrix4();
const M={
 gold:new THREE.MeshStandardMaterial({name:'Champagne gold — satin cast brass',color:'#e6bb72',metalness:.82,roughness:.23}),
 brightGold:new THREE.MeshStandardMaterial({name:'Pale polished gold — bevel and typography',color:'#ffdc82',metalness:.70,roughness:.22}),
 darkGold:new THREE.MeshStandardMaterial({name:'Deep bronze — recessed profiles',color:'#8e561e',metalness:.68,roughness:.32}),
 blue:new THREE.MeshStandardMaterial({name:'Royal blue — enamel',color:'#092e91',metalness:.32,roughness:.25}),
 darkBlue:new THREE.MeshStandardMaterial({name:'Midnight blue — painted structure',color:'#071a48',metalness:.28,roughness:.29}),
 velvet:new THREE.MeshStandardMaterial({name:'Royal blue velvet',color:'#071b53',metalness:.02,roughness:.88}),
 velvetLight:new THREE.MeshStandardMaterial({name:'Cobalt velvet highlights',color:'#0c307b',metalness:.02,roughness:.8}),
 upholstery:new THREE.MeshStandardMaterial({name:'Navy audience upholstery',color:'#102044',metalness:.01,roughness:.91}),
 black:new THREE.MeshStandardMaterial({name:'Shadow plinth',color:'#0b1021',metalness:.16,roughness:.45}),
 bulb:new THREE.MeshStandardMaterial({name:'Warm incandescent marquee bulbs',color:'#fff0b0',emissive:'#ffb64d',emissiveIntensity:3.2,roughness:.25,metalness:0}),
 strip:new THREE.MeshStandardMaterial({name:'Champagne illuminated stage ribbon',color:'#fff0bd',emissive:'#ffc868',emissiveIntensity:2.8,roughness:.27,metalness:0}),
 blueStrip:new THREE.MeshStandardMaterial({name:'Electric blue inset light ribbon',color:'#488eff',emissive:'#1652ff',emissiveIntensity:1.7,roughness:.3,metalness:0}),
};
function put(g,m,x=0,y=0,z=0,rot=null){const mesh=new THREE.Mesh(g,m);mesh.position.set(x,y,z);if(rot)mesh.rotation.set(...rot);mesh.updateMatrix();g=g.clone().applyMatrix4(mesh.matrix).applyMatrix4(placement);if(g.index)g=g.toNonIndexed();for(const k of Object.keys(g.attributes))if(!['position','normal','uv'].includes(k))g.deleteAttribute(k);if(!g.attributes.uv)g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));if(!g.attributes.normal)g.computeVertexNormals();if(!buckets.has(m))buckets.set(m,[]);buckets.get(m).push(g);g.computeBoundingBox();boundsByPart[part]??=new THREE.Box3();boundsByPart[part].union(g.boundingBox);return mesh;}
function box(w,h,d,m,x,y,z,r=0){return put(r?new RoundedBoxGeometry(w,h,d,2,r):new THREE.BoxGeometry(w,h,d),m,x,y,z);}
function cyl(rt,rb,h,m,x,y,z,seg=80){return put(new THREE.CylinderGeometry(rt,rb,h,seg,1,false),m,x,y,z);}
function ball(r,m,x,y,z,seg=10){return put(new THREE.SphereGeometry(r,seg,6),m,x,y,z);}
function line(points,r,m,segments=64){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));return put(new THREE.TubeGeometry(curve,segments,r,10,false),m);}
function bar(a,b,r,m){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),g=new THREE.CylinderGeometry(r,r,av.distanceTo(bv),8);const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),bv.clone().sub(av).normalize());g.applyQuaternion(q);return put(g,m,...av.add(bv).multiplyScalar(.5).toArray());}
function extrude(shape,depth,bevel,m,x,y,z){const g=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,steps:1,curveSegments:20});return put(g,m,x,y,z);}
function ellipseArc(cx,cy,z,rx,ry,start,end,r,m,count=90){const p=[];for(let i=0;i<=count;i++){const a=start+(end-start)*i/count;p.push([cx+rx*Math.cos(a),cy+ry*Math.sin(a),z]);}return line(p,r,m,count);}
function horizontalArc(radius,y,start,end,r,m,count=128){const p=[];for(let i=0;i<=count;i++){const a=start+(end-start)*i/count;p.push([radius*Math.cos(a),y,radius*Math.sin(a)]);}return line(p,r,m,count);}
function starShape(r,inner=r*.45){const s=new THREE.Shape();for(let i=0;i<10;i++){const a=Math.PI/2+i*Math.PI/5,rr=i%2?inner:r;const x=Math.cos(a)*rr,y=Math.sin(a)*rr;i?s.lineTo(x,y):s.moveTo(x,y);}s.closePath();return s;}
function star(x,y,z,r){extrude(starShape(r),.035,.012,M.darkGold,x,y,z);extrude(starShape(r*.95),.035,.012,M.brightGold,x,y,z+.035);extrude(starShape(r*.79),.04,.01,M.blue,x,y,z+.075);const rr=r*.68,inner=rr*.45;const verts=[];for(let i=0;i<10;i++){const a=Math.PI/2+i*Math.PI/5,b=Math.PI/2+(i+1)*Math.PI/5;verts.push(0,0,.12,Math.cos(a)*(i%2?inner:rr),Math.sin(a)*(i%2?inner:rr),0,Math.cos(b)*((i+1)%2?inner:rr),Math.sin(b)*((i+1)%2?inner:rr),0);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.computeVertexNormals();put(g,M.brightGold,x,y,z+.12);}

// Three concentric physical stage levels; highest surface exactly Y=0.
part='circular_stage';
cyl(5.49,5.49,.16,M.black,0,-.40,0,144);
cyl(5.46,5.46,.045,M.gold,0,-.331,0,144);
cyl(5.26,5.26,.155,M.darkBlue,0,-.244,0,144);
cyl(5.245,5.245,.026,M.gold,0,-.171,0,144);
cyl(5.03,5.03,.162,M.blue,0,-.081,0,144);
// Narrow luminous strips sit within the vertical risers, not above the floor.
horizontalArc(5.49,-.392,0,Math.PI*2,.022,M.strip,160);
horizontalArc(5.26,-.254,0,Math.PI*2,.018,M.strip,160);
horizontalArc(5.032,-.118,0,Math.PI*2,.014,M.gold,160);
horizontalArc(4.88,.003,0,Math.PI*2,.012,M.brightGold,160);
horizontalArc(4.63,.004,0,Math.PI*2,.007,M.gold,160);
// Fine radial seams read as crafted floor inlays rather than a separate floor plane.
for(let k=0;k<12;k++){const a=k*Math.PI/6;bar([4.63*Math.cos(a),.004,4.63*Math.sin(a)],[4.87*Math.cos(a),.004,4.87*Math.sin(a)],.004,M.darkGold);}

// Curved continuous presenter desk, independently grounded on the stage.
part='presenter_desk';const dx=-.40,dz=-.88;
function deskShape(s=1){const sh=new THREE.Shape();sh.moveTo(-2.03*s,.27*s);sh.quadraticCurveTo(-2.19*s,-.07*s,-1.97*s,-.22*s);sh.quadraticCurveTo(0,-.75*s,1.97*s,-.22*s);sh.quadraticCurveTo(2.19*s,-.07*s,2.03*s,.27*s);sh.quadraticCurveTo(0,.58*s,-2.03*s,.27*s);return sh;}
function deskSlab(y,h,s,m,bevel=.018){const g=new THREE.ExtrudeGeometry(deskShape(s*1.11),{depth:h,bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,curveSegments:36});g.rotateX(-Math.PI/2);put(g,m,dx,y,dz);}
deskSlab(.025,.12,1.032,M.black,.016);deskSlab(.14,.055,1.015,M.gold,.013);deskSlab(.20,.87,1,M.blue,.015);deskSlab(1.07,.045,1.025,M.gold,.012);deskSlab(1.115,.085,1.045,M.darkBlue,.02);deskSlab(1.205,.031,1.045,M.brightGold,.012);
deskSlab(1.245,.016,1.015,M.darkBlue,.005);
for(const y of [.24,1.04]){const p=[];for(let i=0;i<=64;i++){const x=-1.99+i*3.98/64;const zz=.22+.265*(1-Math.pow(x/1.99,2));p.push([dx+x*1.11,y,dz+zz*1.11+.013]);}line(p,.018,M.gold,72);}
for(const x of [-2.015,2.015]){cyl(.055,.07,.94,M.gold,dx+x*1.11,.64,dz+.178,16);box(.1,.06,.28,M.brightGold,dx+x*1.11,1.105,dz+.1,.01);}
// Front reserved for a live curved LED number screen.


// Architectural frame in front of the curved, textured wall added by the runtime.
part='rear_wall';
// A bounded foundation under the wings and arches joins all feet to floor level.
// Keep both foundation surfaces below the circular stage where they overlap.
box(13.48,.48,1.10,M.darkBlue,0,-.26,-3.84,.012);box(13.50,.035,1.12,M.gold,0,-.038,-3.84,.009);
box(13.5,.16,.34,M.gold,0,.08,-3.98,.018);
const wallZ=x=>-4.75+.75*(x/8.6)**2;
for(const y of [.12,6.65]){const points=[];for(let i=0;i<=96;i++){const x=-8.6+i*17.2/96;points.push([x,y,wallZ(x)+.14]);}line(points,.07,M.gold,96);line(points.map(p=>[p[0],p[1]-.10,p[2]+.025]),.018,M.strip,96);}
for(let i=0;i<=12;i++){const x=-8.4+i*1.4,z=wallZ(x)+.09;box(.075,6.4,.09,M.gold,x,3.35,z,.012);box(.018,6.17,.025,M.blueStrip,x+.12,3.34,z+.015);}
// Return walls and illuminated friezes enclose the sides instead of ending in black.
for(const side of [-1,1])for(const z of [-3.4,-1.4,.6,2.6,4.6]){box(.12,6.6,.07,M.gold,side*8.48,3.15,z,.012);box(.04,6.35,.025,M.blueStrip,side*8.40,3.14,z+.10);}
for(const side of [-1,1])for(const y of [.10,6.65]){bar([side*8.5,y,-4],[side*8.5,y,4.9],.065,M.gold);bar([side*8.4,y-.10,-4],[side*8.4,y-.10,4.9],.015,M.strip);}
// Low dado and softly luminous vertical cobalt inset seams.
box(13.25,.33,.14,M.blue,0,.27,-3.72,.018);box(13.3,.045,.16,M.brightGold,0,.47,-3.7,.012);
for(const x of [-6.08,-4.96,4.96,6.08])bar([x,.48,-3.775],[x,5.25,-3.775],.009,M.blueStrip);

// Main grand arch: deep, layered brass profiles, embedded bulbs, supporting piers.
part='central_marquee_arch';const archZ=-3.54,rx=4.24,ry=5.18,base=.22;
const archBand=new THREE.Shape();archBand.absellipse(0,base,rx+.16,ry+.16,0,Math.PI,false);archBand.lineTo(-rx+.16,base);archBand.absellipse(0,base,rx-.16,ry-.16,Math.PI,0,true);archBand.closePath();extrude(archBand,.20,.016,M.gold,0,0,archZ-.08);
for(const [off,r,mat] of [[-.15,.045,M.darkGold],[.16,.025,M.brightGold],[-.16,.025,M.brightGold]])ellipseArc(0,base,archZ+.10,rx+off,ry+off,0,Math.PI,r,mat,112);
ellipseArc(0,base,archZ+.09,rx-.34,ry-.27,0,Math.PI,.026,M.blueStrip,110);
ellipseArc(0,base,archZ+.065,rx-.41,ry-.35,0,Math.PI,.023,M.gold,110);
for(let i=0;i<=32;i++){const a=Math.PI*i/32;const x=rx*Math.cos(a),y=base+ry*Math.sin(a);cyl(.070,.08,.044,M.darkGold,x,y,archZ+.155,12);ball(.06,M.bulb,x,y,archZ+.17,10);}
for(const side of [-1,1]){box(.40,.29,.58,M.darkGold,side*rx,.145,archZ,.035);box(.36,.09,.62,M.gold,side*rx,.32,archZ,.022);}
// Secondary low arch frames the curtain opening beneath the title.
ellipseArc(0,.05,-3.46,3.08,3.11,0,Math.PI,.082,M.gold,96);
ellipseArc(0,.05,-3.42,2.95,2.98,0,Math.PI,.025,M.brightGold,96);
for(let i=0;i<=24;i++){const a=Math.PI*i/24;ball(.043,M.bulb,3.08*Math.cos(a),.05+3.11*Math.sin(a),-3.365,9);}

// Sculpted sunburst side wings, matching the fan geometry of the reference.
part='side_fan_wings';
for(const side of [-1,1]){
 const pivot=[side*4.35,.28,-3.46];const points=[];
 for(let i=0;i<=36;i++){const t=i/36;points.push([side*(4.4+2.24*Math.sin(t*Math.PI/2)),.32+5.07*Math.cos(t*Math.PI/2),-3.49]);}
 line(points,.115,M.gold,72);line(points.map(p=>[p[0]+side*.10,p[1]+.035,p[2]+.05]),.025,M.brightGold,72);
 for(let i=0;i<=5;i++){const t=i/5;const edge=[side*(4.4+2.24*Math.sin(t*Math.PI/2)),.32+5.07*Math.cos(t*Math.PI/2),-3.44];bar(pivot,edge,.035,M.gold);}
 for(let i=0;i<=17;i++){const t=i/17;ball(.059,M.bulb,side*(4.4+2.24*Math.sin(t*Math.PI/2)),.32+5.07*Math.cos(t*Math.PI/2),-3.352,10);}
 box(.32,.21,.49,M.gold,side*6.64,.105,-3.48,.025);
 // Gold-edged splayed apron panel mounted at the base of each fan.
 box(2.35,.50,.30,M.blue,side*5.42,.26,-3.55,.05);box(2.4,.04,.34,M.brightGold,side*5.42,.51,-3.53,.01);
 star(side*3.78,4.51,-3.19,.34);star(side*3.44,2.86,-3.03,.35);
}

// Wide scalloped crown sign: brass backing, royal-blue infill, real extruded type.
part='showtime_logo';
function plaque(s=1){const p=new THREE.Shape();p.moveTo(-2.93*s,-1.0*s);p.bezierCurveTo(-1.65*s,-1.38*s,1.65*s,-1.38*s,2.93*s,-1*s);p.lineTo(3.19*s,.58*s);p.bezierCurveTo(2.55*s,.97*s,1.23*s,1.10*s,0,1.10*s);p.bezierCurveTo(-1.23*s,1.10*s,-2.55*s,.97*s,-3.19*s,.58*s);p.closePath();return p;}
extrude(plaque(),.13,.033,M.darkGold,0,3.85,-3.38);
extrude(plaque(.985),.09,.025,M.brightGold,0,3.85,-3.22);
extrude(plaque(.959),.10,.022,M.blue,0,3.85,-3.095);
// Attached round-ended separator / illuminated lower lip follows the lettering curve.
const divider=[],lip=[];for(let i=0;i<=64;i++){const x=-2.75+i*5.5/64;divider.push([x,3.93+.135*(1-(x/2.75)**2),-2.922]);lip.push([x,2.76-.20*(1-(x/2.75)**2),-2.89]);}line(divider,.034,M.gold,64);line(lip,.075,M.gold,64);
for(let i=0;i<=18;i++){const x=-2.63+i*5.26/18;ball(.042,M.bulb,x,2.76-.20*(1-(x/2.75)**2),-2.805,9);}
const font=new FontLoader().parse(JSON.parse(fs.readFileSync(path.join(project,'node_modules/three/examples/fonts/helvetiker_bold.typeface.json'),'utf8')));
function textMesh(text,width,y,z,size,lit=false,targetHeight=null){
 const g=new TextGeometry(text,{font,size,depth:.11,curveSegments:7,bevelEnabled:true,bevelThickness:.018,bevelSize:.015,bevelSegments:2});g.computeBoundingBox();const bb=g.boundingBox.clone(),scale=width/(bb.max.x-bb.min.x),sy=targetHeight?targetHeight/(bb.max.y-bb.min.y):scale;g.translate(-.5*(bb.min.x+bb.max.x),-bb.min.y,0);g.scale(scale,sy,1);put(g,M.brightGold,0,y,z);
 // Broad, genuine shadow bevel behind the face gives the title a handcrafted marquee profile.
 const under=g.clone();under.scale(1.009,1.025,1);put(under,M.darkGold,0,y-.008,z-.035);
 if(lit){const shapes=font.generateShapes(text,size);const contourSets=shapes.map(s=>({outer:s.getPoints(8),holes:s.holes.map(h=>h.getPoints(8))}));
 function inPoly(p,poly){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!=(b.y>p.y)&&(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x))c=!c;}return c;}
 function edgeDist(p,poly){let d=1e5;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j],v=b.clone().sub(a);if(v.lengthSq()<1e-12)continue;const t=THREE.MathUtils.clamp(p.clone().sub(a).dot(v)/v.lengthSq(),0,1);d=Math.min(d,p.distanceTo(a.clone().addScaledVector(v,t)));}return d;}
 for(let yy=bb.min.y+.09;yy<bb.max.y-.035;yy+=.145/scale)for(let xx=bb.min.x+.065;xx<bb.max.x-.025;xx+=.145/scale){const p=new THREE.Vector2(xx,yy);const inside=contourSets.some(c=>inPoly(p,c.outer)&&!c.holes.some(h=>inPoly(p,h))&&edgeDist(p,c.outer)>.028/scale&&c.holes.every(h=>edgeDist(p,h)>.025/scale));if(inside)ball(.03,M.bulb,(xx-.5*(bb.min.x+bb.max.x))*scale,y+(yy-bb.min.y)*sy,z+.152,10);}
 }
 return {text,width,y,height:(bb.max.y-bb.min.y)*sy,z};
}
const title=textMesh("VLAMPIE’S",5.45,4.17,-2.87,.68,false,.76);
const bingo=textMesh('BINGO',4.72,2.89,-2.83,1.1,true,1.04);
star(0,5.39,-3.23,.595);star(-.72,5.18,-3.23,.16);star(.72,5.18,-3.23,.16);
// Back braces connect the layered sign securely into the architectural frame.
for(const x of [-2.3,2.3])box(.12,2.7,.35,M.darkGold,x,3.76,-3.56,.01);

// Two audience banks face inward, with three ascending rows on each side.
for(const bank of [-1,1]){
 part=bank<0?'left_audience_tiers':'right_audience_tiers';
 placement.makeRotationY(-bank*(Math.PI/2-.20));placement.setPosition(bank*5.85,0,-.50);
 for(let row=0;row<3;row++){
  const top=.22+row*.43,z=-row*.86;
  box(4.12,top+.48,.84,M.darkBlue,0,(top-.48)/2,z,.018);
  box(4.15,.045,.87,M.gold,0,top,z,.01);box(4.04,.018,.79,M.upholstery,0,top+.034,z,.003);
  bar([-2.03,top-.13,z+.435],[2.03,top-.13,z+.435],.016,M.strip);
  for(let col=0;col<5;col++){
   const x=-1.55+col*.775;
   for(const side of [-1,1])bar([x+side*.19,top+.05,z+.13],[x+side*.19,top+.37,z+.13],.022,M.darkGold);
   put(new RoundedBoxGeometry(.57,.115,.49,1,.05),M.upholstery,x,top+.40,z+.03);
   put(new RoundedBoxGeometry(.55,.59,.14,1,.065),M.velvet,x,top+.72,z-.19);
   for(const side of [-1,1]){bar([x+side*.28,top+.22,z-.13],[x+side*.28,top+.56,z+.24],.018,M.gold);bar([x+side*.28,top+.56,z-.11],[x+side*.28,top+.56,z+.25],.023,M.gold);}
  }
 }
 for(const end of [-1,1]){
  const rail=[];for(let row=0;row<3;row++){const z=-row*.86,top=.22+row*.43;bar([end*2.02,top+.03,z],[end*2.02,top+.91,z],.025,M.gold);ball(.05,M.brightGold,end*2.02,top+.94,z);rail.push([end*2.02,top+.92,z]);}line(rail,.031,M.gold,24);
 }
 placement.identity();
}
// Compact access stairs from the main floor toward the rear riser.
part='back_access_steps';
for(let i=0;i<3;i++){const h=.12*(i+1),z=-2.43-i*.36;box(1.24,h,.38,M.blue,2.9,h/2,z,.012);box(1.25,.025,.39,M.gold,2.9,h,z,.009);bar([2.28,h-.022,z+.19],[3.52,h-.022,z+.19],.013,M.strip);}
// Distant blue-gold flecks physically inlaid in the curtain opening.
part='curtain_sparkle_inlays';let seed=17;function rnd(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}
for(let i=0;i<130;i++){const x=(rnd()-.5)*5.8,y=.55+rnd()*1.85;const r=.004+rnd()*.007;ball(r,i%8===0?M.brightGold:M.blueStrip,x,y,-3.78,6);}

// Merge by finish: a dozen draw calls for the full architectural set.
let triangles=0,vertices=0;
for(const [mat,geoms] of buckets){const merged=mergeVertices(mergeGeometries(geoms,false),1e-5);const mesh=new THREE.Mesh(merged,mat);mesh.name=mat.name;mesh.castShadow=!['bulb','strip','blueStrip'].includes(Object.keys(M).find(k=>M[k]===mat));mesh.receiveShadow=true;mesh.userData={staticEnvironment:true};scene.add(mesh);triangles+=(merged.index?merged.index.count:merged.attributes.position.count)/3;vertices+=merged.attributes.position.count;}
scene.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(scene);const manifest={asset:'showtime-set.glb',description:'Royal-blue and champagne-gold physical show set; beveled real 3D title, layered marquee arches, curved star-wall frame, curved presenter desk, two inward-facing audience banks, and stepped circular stage.',units:'meters',coordinateSystem:'Y up, front is +Z',stageTopY:0,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},meshCount:scene.children.length,materialCount:buckets.size,triangles,vertices,title,bingo,clearZones:{host:{center:[-1.95,0,2],height:3.456},machine:{center:[3.9,.025,.45],diameter:3.6,height:4.7}},parts:Object.fromEntries(Object.entries(boundsByPart).map(([k,b])=>[k,{min:b.min.toArray(),max:b.max.toArray()}])),noRealtimeLights:true,noMascot:true,noBingoMachine:true,noSurroundingFloorPlane:true};
scene.userData=manifest;
const exporter=new GLTFExporter();const buffer=await exporter.parseAsync(scene,{binary:true,onlyVisible:true,trs:false,maxTextureSize:1024});fs.writeFileSync(path.join(out,'showtime-set.glb'),Buffer.from(buffer));fs.writeFileSync(path.join(out,'showtime-set.manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({file:path.join(out,'showtime-set.glb'),bytes:buffer.byteLength,...manifest},null,2));
